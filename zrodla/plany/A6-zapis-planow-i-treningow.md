# A6 – zapis planów i treningów odporny na dwa urządzenia i nieudany zapis (plan)

Zlecenie A6 z raportu audytu: E1-09 (plany nadpisywane w całości) i E1-10 (nieudany zapis treningu znika z historii).
Segment 5 (Ustawienia i dane). Gałąź `a6-zapis`. Plik powstał przed kodem, a po przeglądach A6b i A6c został **zaktualizowany do stanu faktycznego**:
pkt 1–10 opisują działanie (z poprawkami tam, gdzie kod poszedł inaczej), pkt 11 to lista wszystkich zmian A6b i A6c z numerami testów.

Stan wyjściowy: `main` @ `e82b8c6`. Kod: `zrodla/src/app.html` – `store`, `persist`, `flush`, `commit`, `openFolder`
(nasłuch `data/state` i nasłuch `sessions`), `saveSession`, `deleteSession`, `normalize`. Wzór: `persistDiet` / `flushDiet`.

Nie ruszamy: `persistDiet`, `flushDiet`, `saveActive` i trwającego treningu (`pushActive`, `watchActive`), `firestore.rules`,
`rules.yml`, `testy-regul/`, gałęzi `a3-reguly` (PR #1), formatu kopii zapasowej (`exportCopy`, `importSanitize`), `shareSanitize`,
bloku PIN-u i dostępu (`pinTry`, `pinCheck`, `watchFolders` w części o `gen`). Tryby „cloud” (claude.ai) i „local” zostają bez zmian –
nowy zapis dotyczy tylko trybu „fire” (strona z bazą Firebase).

## 0. Co jest nie tak (potwierdzone w kodzie)

**E1-09.** `flush` robi `setDoc(folders/{id}/data/state, S)` – cały dokument, bez scalania. Nasłuch (`openFolder`, linia z `store.dirty`)
przy czekającym lokalnym zapisie **pomija** każdą zmianę z bazy (`if (store.dirty) return;`), a po wysłaniu `flush` nadpisuje cały
dokument stanem lokalnym, który tej zmiany nie ma. Telefon bez sieci: zmienia plan A, `dirty` zostaje, laptop zmienia plan B,
telefon wraca do sieci, jego `setDoc` zastępuje cały dokument, więc plan B z laptopa ginie bez komunikatu.

**E1-10.** `saveSession` robi `setDoc` na dokumencie treningu; błąd kończy się tylko toastem. Nasłuch `sessions` przy następnym
odczycie **zastępuje** `SESS` listą z serwera (`SESS = list`), więc trening, którego baza nie przyjęła, znika z historii
(a z `LS` zostaje nadpisany).

## 1. Decyzje projektowe (skrót)

1. Plany i własne ćwiczenia w bazie to **mapy po identyfikatorze + osobna tablica kolejności**. W pamięci aplikacji `S.plans`
   i `S.custom` zostają **tablicami** (reszta kodu, kopia zapasowa, udostępnianie – bez zmian).
2. Zapis **scalający po pozycjach**: do bazy idą tylko zmienione plany/ćwiczenia/ustawienia, wskazane w **kolejce zmian**
   zapisanej w pamięci przeglądarki (przetrwa zamknięcie karty), z ponawianiem po błędzie.
3. Rozstrzyganie konfliktów po pozycji: **wygrywa późniejsza zmiana** (znacznik czasu `u` przy pozycji); niewysłana lokalna zmiana
   wygrywa tylko dla swojej pozycji, o ile nie jest starsza od tego, co przyszło z bazy. Usunięcie zostawia **nagrobek** z czasem.
4. **Lustro w starym układzie**: dokument nadal zawiera tablice `plans`, `custom` i mapę `settings` jak dotąd, żeby stara karta
   czytała dane poprawnie, a wycofanie zmiany niczego nie psuło (pkt 6, 8).
5. Treningi: **lista identyfikatorów niewysłanych treningów** w `localStorage`, osobna dla konta. Odczyt z bazy nie zastępuje
   listy lokalnej bezwarunkowo – niewysłane wracają do historii i są wysyłane ponownie.
6. Logikę scalania i kolejki wydzielamy do `zrodla/src/zapis.js` (bez interfejsu i bez Firebase); `build.py` i `build_web.py`
   wklejają ją do strony (jak `anim.js`), a testy Node ładują ten sam plik.

## 2. Format dokumentu `folders/{id}/data/state`

### Przed (v2 – obecny)
```
{ v:2,
  plans:[ {id, name, items:[{id, exId, mode, rest, restAfter, note, ssNext?, sets:[…]}], share?} , … ],
  custom:[ {id, name, group, equipment, mode, steps, tips, primary, secondary, custom:true, level} , … ],
  settings:{ restSet, restEx, autoRest, sound, bar, perWeek, …(klucze z DEF_SETTINGS) } }
```
Kolejność planów = kolejność w tablicy. Zapis: cały dokument naraz.

### Po (v3)
```
{ v:3, full:<czas>,                 // znacznik „układ v3 kompletny” (pkt 6) – ustawia go tylko migracja/naprawa w transakcji
  pm:{ <idPlanu>:{…plan jak wyżej…, u:<ms>} },   po:[idPlanu,…],  pos:<ms>     // plany, kolejność, czas ostatniej zmiany kolejności
  cm:{ <idĆwiczenia>:{…ćwiczenie…, u:<ms>} },    co:[id,…],       cos:<ms>     // własne ćwiczenia
  pt:{ <idPlanu>:<ms> },  ct:{ <idĆwiczenia>:<ms> },                            // nagrobki usuniętych (czas usunięcia)
  settings:{ klucz:wartość, … },                                                // jak dotąd (mapa), zapisywana po kluczach
  plans:[…], custom:[…] }                                                       // LUSTRO w starym układzie dla starych kart
```
- `u` (czas zmiany pozycji, ms) siedzi **tylko w dokumencie i w `localStorage`**, nie w `S` – kopia zapasowa i udostępnianie
  wyglądają tak samo jak dziś.
- Identyfikatory planów/ćwiczeń to `uid()` (a–z 0–9) albo ze starej kopii (`SAFE_ID`: `A-Za-z0-9_-`), więc nadają się na nazwy pól.
- `S.plans` = `po` przefiltrowane do istniejących w `pm`, a potem brakujące w `pm` dopisane po `u`, potem po id (dwa urządzenia
  dodające plan naraz nadpisują sobie `po`, ale oba plany są w `pm`, więc żaden nie ginie).
- Rozmiar: lustro podwaja treść, a limit dokumentu to 1 MiB. Plany to kilka–kilkadziesiąt KB. Próg `DOC_MAX` = **900 000 bajtów UTF-8
  całego dokumentu** (pm + nagrobki + ustawienia + lustro, liczone `TextEncoder`, nie znaki samego lustra): powyżej niego migracja i naprawa
  pomijają lustro (`fullDoc` → `mirrorSkipped`, toast „Plany są bardzo duże: starsza wersja strony na innym urządzeniu nie zobaczy ich w całości.”),
  a transakcja lustra usuwa stare lustro z dokumentu (`mirrorPatch` → `drop`; nieaktualne byłoby gorsze niż brak). Zwykły zapis (setDoc z `mergeFields`)
  nie zna rozmiaru dokumentu, więc ostrzega: rozmiar dokumentu z ostatniego odczytu + dane zapisu > `DOC_WARN` = 950 000 bajtów → toast
  „Plany zbliżają się do limitu rozmiaru w bazie (1 MB na konto). Zapis może się nie udać – usuń nieużywane plany.” (raz na otwarcie konta; zapis i tak idzie).
- `firestore.rules`: blok `data/{docId}` pozwala członkowi na dowolny kształt `state`, więc **reguły się nie zmieniają**.

## 3. Kolejka zmian i znaczniki (pamięć przeglądarki, osobno dla konta)

Klucze localStorage konta (nazwy z `ZP.zKey`, `ZP.stateKey`, `ZP.sessKey`; usunięcie konta kasuje je razem z resztą danych konta):
- `dz.f.<idKonta>.zq` – **jedna wartość `{q, kn}`**: kolejka zmian i znane czasy (osobnego klucza `.zu` nie ma);
- `dz.f.<idKonta>.state` – lokalna kopia `S` (plany, własne ćwiczenia, ustawienia);
- `dz.f.<idKonta>.unsent` – lista niewysłanych treningów (pkt 7).
```
q  (kolejka): { p:{id:u}, pd:{id:czasUsunięcia}, c:{id:u}, cd:{id:czas}, s:{klucz:u}, po:czas|0, co:czas|0,
                f:czas|0 (trzeba odtworzyć dokument v3), m:czas|0 (trzeba odświeżyć lustro), t:ostatni znacznik, mx:największy czas widziany w bazie }
kn (znane):   { p:{id:u}, c:{id:u}, v3:true|false (urządzenie widziało układ v3), pt:{id:czas}, ct:{id:czas} (nagrobki z ostatniego odczytu v3, młodsze niż 60 dni),
                h:{p:{id:[skrót,…]}, c:{…}} (skróty kilku ostatnich wersji pozycji, pkt 11 A6b-4) }
```
- Czasy są **rosnące na urządzeniu**: `stampQ = max(Date.now(), q.t+1, q.mx+1)`, więc dwie zmiany w jednej milisekundzie się nie zlewają, a urządzenie z zegarem
  „do tyłu” nie wystawi zmiany starszej od czegokolwiek, co już widziało w bazie (`q.mx`; czasy z bazy dalej niż 30 dni w przód są pomijane).
- **Wykrywanie zmian bez dotykania 40 miejsc wywołujących `commit()`/`persist()`:** `persist()` robi `split(S)` i porównuje
  z poprzednim `split` (`store.last`) po JSON-ie każdej pozycji. Zmieniony/nowy plan → `kolejka.p[id] = stamp`; zniknął →
  `kolejka.pd[id] = stamp`; zmiana tablicy kolejności → `kolejka.po`; zmieniony klucz ustawień → `kolejka.s[klucz]`.
  Kolejka idzie do `localStorage` od razu.
- Przycisk „Przywróć dane” (import kopii) podmienia `S` w całości – diff sam zobaczy: zmienione/nowe plany do wysłania, brakujące
  jako usunięte (zachowanie jak dziś: kopia zastępuje plany).

## 4. Algorytm scalania (`ZP.merge`) i zapis (`ZP.buildWrite`)

### Odczyt (nasłuch `data/state`) – zamiast `if (store.dirty) return;`
Wejście: stan lokalny `split(S)`, kolejka, `zu`, dokument z bazy `r` (po rozpoznaniu układu, pkt 6). Dla każdej pozycji `id`
(osobno plany i własne ćwiczenia):

| Sytuacja lokalna | Zdalnie | Wynik |
|---|---|---|
| bez zmian, `id` znany (`zu`) | jest, `u_r` | bierz zdalną; `zu[id]=u_r` |
| bez zmian, `id` znany | **brak** i jest nagrobek / układ v3 kompletny | usuń lokalnie (usunięto na innym urządzeniu) |
| bez zmian, `id` znany | jest, ale `u_r < zu[id]` | serwer ma starszą wersję niż ta, którą mam zatwierdzoną (spóźniony zapis z innego urządzenia): **zachowaj lokalną i dołóż do kolejki** (samo-naprawa) |
| bez zmian, `id` nieznany | jest | dodaj (nowa pozycja z innego urządzenia) |
| **w kolejce** (edycja lub nowa), `u_l` | jest, `(u_r, JSON)` > `(u_l, JSON)` | zdalna **późniejsza** wygrywa: weź zdalną, wyjmij z kolejki, odnotuj w `notes` |
| w kolejce, `u_l` | jest, nie późniejsza | zostaje lokalna (wyśle się) |
| w kolejce, `u_l` | brak + nagrobek `ts > u_l` | usunięto później niż edytowano: usuń lokalnie, wyjmij z kolejki |
| w kolejce, `u_l` | brak, brak nagrobka lub `ts < u_l` | zostaje lokalna (wyśle się, może przywrócić plan – edycja jest późniejsza od usunięcia) |
| w kolejce jako **usunięcie** (`pd`), czas `t` | jest, `u_r > t` | edycja z innego urządzenia późniejsza od mojego usunięcia: plan zostaje, wyjmij z `pd` |
| w kolejce jako usunięcie | brak lub `u_r ≤ t` | zostaje usunięty (nagrobek się wyśle) |

Równe `u` rozstrzyga porównanie tekstu JSON (stały, jednakowy na każdym urządzeniu). **Zmiany różnych planów z dwóch urządzeń zostają
obie**, bo każdy plan jest osobnym polem i osobną pozycją tabeli.
- **Kolejność:** jeśli lokalnie czeka zmiana kolejności (`po > 0`) i jej czas ≥ `pos` z bazy, wygrywa lokalna; inaczej zdalna. W obu
  przypadkach wynik jest uzgadniany z istniejącymi pozycjami (usunięte znikają, brakujące dopisane na końcu).
- **Ustawienia:** klucze w kolejce (`s`) wygrywają, reszta z bazy. Dla **tego samego klucza** ustawień z dwóch urządzeń wygrywa
  zapis, który dojdzie do bazy później (bez znaczników czasu – ustawienia to proste wartości, a lustro w starym układzie
  musi zostać zwykłą mapą).
- Wynik przechodzi przez istniejące `normalize` (przycięcie wartości do `LIM`, spłaszczenie starych układów).
- Po scaleniu aplikacja robi `render()` tylko, gdy `S` się zmieniło (jak dziś), i **nigdy nie gubi** zmian z kolejki.

### Zapis (`flush`) – zamiast `setDoc(S)`
`setDoc(ref, dane, {mergeFields:[…]})` z listą tylko zmienionych pól (mergeFields zastępuje wskazane pole w całości, więc usunięte
z planu pola nie zostają w bazie; zwykłe `merge:true` scalałoby zagnieżdżone obiekty i zostawiało stare pola):
- plan/ćwiczenie edytowane: `pm.<id>` = `{…pozycja, u}`; usunięte: `pm.<id>` = `deleteField()` i `pt.<id>` = czas usunięcia;
- `po`, `pos` (gdy zmieniono kolejność lub dodano/usunięto plan); to samo dla `co`, `cos`; ustawienia: `settings.<klucz>`;
- `v`:3. **Lustro `plans` / `custom` NIE idzie w zwykłym zapisie** (taki zapis nie sprawdza, czy dokument jest nadal w układzie v3, i mógłby nadpisać lustro
  świeżo zapisane przez starą kartę): po udanym zapisie `afterSend` wpisuje `q.m`, a lustro odświeża osobna transakcja (`flushMirror`: czyta dokument i zapisuje
  lustro tylko, gdy ma on `full`; `ZP.mirrorPatch` → `skip` / `same` / `set` / `drop`, lustro liczone z `pm`/`po`/nagrobków dokumentu);
- nagrobki starsze niż 60 dni są przy okazji usuwane (`deleteField`), razem ze starszym wpisem `pm.<id>` ukrytym pod nimi (wpis nowszy od nagrobka zostaje).
- **Wysyłka:** na wpis kolejki przypada licznik „wysłano wersję `u`”. Po `then` wpis jest usuwany **tylko jeśli w międzyczasie się nie
  zmienił** (porównanie `u`), `kn[id]=u`. Zajętość zapisu jest **osobna dla konta** (`ZP.newBusy`, `zBusy`): trwająca wysyłka jednego konta nie blokuje
  drugiego, a ponownie otwarte konto nie wysyła w tym samym czasie drugi raz (po zakończeniu starej wysyłki zapis rusza dla bieżącego `Z`).
  Po `catch`: wpis zostaje, ponowienie po 2 s, 5 s, 15 s, 60 s (potem co 60 s), jeden
  toast „Nie udało się zapisać zmian w bazie. Spróbuję ponownie.” na serię błędów (nie na każde ponowienie). Ponowienie także po
  zdarzeniu `online` i po otwarciu konta.
- Zapis offline: Firestore sam trzyma zapis w pamięci i wyśle po powrocie sieci; jeśli karta zostanie zamknięta, kolejka w
  `localStorage` i tak pozwoli wysłać zmiany od nowa (zapis jest idempotentny).
- Blind-write (bez transakcji) wolno wysłać tylko, gdy to urządzenie **widziało układ v3** (`kn.v3`, w aplikacji `zLay === 'v3'`). W przeciwnym razie (stary
  układ albo brak dokumentu) zmiany czekają w kolejce, aż zrobi się migrację (pkt 5).
- **Zapis do localStorage jedną funkcją (A6c):** kolejka (`.zq`) i stan (`.state`) są zapisywane wyłącznie przez `ZP.store` / `ZP.settle` → `ZP.saveAll`
  (zapis planów, odczyt z bazy, koniec wysyłki, ścieżka noop, koniec transakcji lustra). Kolejka łączy się z zapisaną przez drugą kartę tej samej przeglądarki
  (`saveZ`/`mergeQ`: suma wpisów, przy tym samym id większy znacznik), a stan z zapisanym stanem (`mergeState`: pozycje, które druga karta ma w kolejce
  z innym znacznikiem, usunięcia, kolejność i ustawienia drugiej karty zostają). Wpisy, które karta sama zdjęła przy scalaniu z bazą, schodzą też z zapisanej kolejki
  (`ZP.dropped`). Stare `Z` (konto zamknięte albo otwarte od nowa w trakcie wysyłki) nie dotyka localStorage (`zCur(fid)`). Pamięć karty (`S`, `Z`) zostaje bez zmian –
  cudzych wpisów karta nie wysyła, dopiero odświeżona karta czyta je z localStorage.
- **Stan po cudzej wysyłce (A6d):** `mergeState(stored, S, q, mq, kn, mkn)` dostaje też znane czasy tej karty (`z.kn`) i scalone (`mkn`, wynik `saveZ`, który `saveAll` przekazuje dalej).
  Sytuacja: druga karta (B) wysłała zmianę P2 i jej wpis zszedł z kolejki (`settle`), a ta karta (A) zapisuje zmianę P1, zanim dostanie migawkę. W scalonej kolejce nie ma już P2, więc
  samo porównanie wpisów nie widzi nowszej wersji, a zapisany stan wracał do starej treści P2 – karta otwarta później (offline) edytowałaby i wysyłała starą treść z nowszym znacznikiem.
  Teraz, gdy `mkn.p[id] > kn.p[id]` (`mkn.c` dla własnych ćwiczeń), a ta karta nie ma własnego wpisu (zmiany ani usunięcia) dla `id`, pozycja idzie z zapisanego stanu. Tak samo nagrobki:
  nagrobek `mkn.pt[id]` (`mkn.ct`), którego ta karta nie zna, usuwa pozycję ze stanu (usunięty plan nie wraca), chyba że znany czas pozycji jest od niego nowszy; `afterSend` zapisuje w `kn.pt`/`kn.ct`
  nagrobek wysłanego usunięcia (jest już w bazie), żeby objąć też okno przed odczytem z bazy. Własne wpisy tej karty mają pierwszeństwo (rozstrzyga je `merge` z bazą).
  **Skutek uboczny, zamierzony:** karta, która w pamięci nadal ma wpis kolejki (otwarta, zanim druga go wysłała), po cudzej wysyłce przy kolejnym zapisie dopisuje go z powrotem do zapisanej
  kolejki (`saveZ` łączy kolejki sumą) – ta pozycja zostanie wysłana jeszcze raz. Zapis jest idempotentny (ta sama treść, ten sam `u`), więc to tylko dodatkowy zapis, nie utrata ani cofnięcie danych.

## 5. Migracja ze starego układu (jednorazowa, przy pierwszym zapisie)

- Czytanie dokumentu v2 nic nie zmienia w bazie: `S.plans` = tablica jak dotąd, wszystkie pozycje mają `u = 0` (domyślnie).
- **Dokument nieznanego kształtu** (istnieje, ale nie ma ani tablicy `plans`, ani mapy `pm`; `ZP.holdDoc`): migracja jest **wstrzymana** (`migrate` → `hold`),
  dokument zostaje nietknięty, zmiany czekają w kolejce. Odczyt takiego dokumentu **nie jest scalany jak pusty** (`ZP.remoteHold`, tryb `hold` w `merge` zwraca stan
  i kolejkę bez zmian – wcześniej plan bez wpisu w kolejce znikał z widoku, choć baza była nietknięta). Użytkownik dostaje toast „Konto w bazie ma nieznany układ danych.
  Nie zapisuję do niego; plany zostają w tej przeglądarce, spróbuję po kolejnym odczycie.” (raz na otwarcie konta); po kolejnym odczycie z poprawnym dokumentem
  zwykła ścieżka (`flush` po odczycie) ponawia migrację.
- **Pierwszy zapis** (czyli pierwsza niepusta kolejka na dokumencie w starym układzie albo bez dokumentu): `runTransaction`
  (wymaga sieci; bez niej zmiany czekają w kolejce, nic nie ginie): czyta aktualny dokument, scala go z kolejką tym samym algorytmem
  (zdalne pozycje z `u = 0`), zapisuje **pełny** dokument v3 (`set` bez scalania: `v:3`, `full`, `pm`, `po`, `pos`, `cm`, `co`, `cos`,
  `pt`/`ct` puste, `settings`, lustro `plans`/`custom`). Pozycje nietknięte dostają `u = 0`, edytowane `u = czas edycji` – dzięki temu
  migracja jednego urządzenia nie „przebija” czekającej, starszej, lecz prawdziwej edycji z drugiego.
- Transakcja gwarantuje, że dwa urządzenia migrujące naraz nie nadpiszą się (jedno ponawia na świeżym dokumencie).
- Nic nie ginie: pola `plans`, `custom`, `settings` zostają w starym układzie (lustro), ustawienia i własne ćwiczenia przechodzą
  1:1 (kolejność = kolejność tablicy), plany o starych kształtach (`days`) przechodzą przez istniejące `flattenPlans`.
- Konto bez dokumentu (nowe): pierwsza zmiana tworzy go od razu w układzie v3 tą samą transakcją.

## 6. Stara karta – jak nowa wersja to wykrywa i naprawia bez utraty danych

**Ryzyko.** Urządzenie z otwartą starą wersją (telefon, ikona na ekranie głównym, karta w tle) nadal robi `setDoc(S)` na cały
dokument w starym układzie. Taki zapis **kasuje** wszystko, czego stary kod nie zna: `pm`, `po`, `pt`, `full`… i zastępuje plany
tym, co ta karta ma w pamięci.

**Dwie rzeczy zapobiegają szkodzie:**
1. **Lustro.** Dokument v3 nadal ma tablice `plans`/`custom` i mapę `settings` w starym układzie, więc stara karta **czyta
   dane poprawnie** (bez lustra widziałaby pustą listę planów i pierwszy zapis wyczyściłby konto). Stara karta zapisuje więc to, co
   widziała, razem ze swoją zmianą.
2. **Wykrycie po stronie nowej wersji.** Układ v3 jest „kompletny” tylko, gdy w dokumencie jest `full` (+ `pm`, `cm` jako mapy).
   Zapis starej karty zastępuje cały dokument, więc `full` znika, a `v` wraca do 2. Każde urządzenie z nową wersją widzi
   w nasłuchu: „układ starszy, a wiem, że kiedyś był v3” (`kn.v3`) = **stara karta nadpisała dokument**.

**Naprawa (na każdym urządzeniu z nową wersją, którym przyjdzie taka migawka z serwera; transakcja, więc bez wyścigów):**
- Traktuj tablice z dokumentu jak „zapis starej karty”: pozycje z `u = 0`. Z tych pozycji bierz **nowe** (planów, których nie mam) i
  **zmienione** (stara karta edytowała plan; nowsza lokalna, czekająca zmiana nadal wygrywa dla swojej pozycji – pkt 4).
- **Nigdy nie usuwaj na podstawie takiego zapisu**: plan, którego w zapisie starej karty brakuje, zostaje i jest odtwarzany w
  bazie (stara karta nie zostawia nagrobków, więc nie da się odróżnić „usunęła” od „nie miała”). Cena: plan usunięty na starej
  karcie może wrócić – ostrzeżenie w komunikacie.
- Zapisz w transakcji pełny dokument v3 na nowo (`full`, `pm`, … i lustro). Stara karta dostaje przez nasłuch lustro i sama się
  odświeża (jeśli nic nie ma w toku).
- Komunikaty (toast): w odczycie z bazy „Starsza wersja strony zapisała dane na innym urządzeniu. Scalam je.” (gdy scalenie przyjęło zmianę lub nowy plan ze starej karty),
  po transakcji naprawy „Starsza wersja strony zapisała dane na innym urządzeniu. Scaliłem je z danymi na tym urządzeniu.”
  Sprawdzenie tego w kodzie: `ZP.layout(dok)` zwraca `'v3' | 'old' | 'empty'`; „stara po v3” = `'old'` i `kn.v3`.
- Przy naprawie (tryb `repair`) kopia ze starej karty jest pomijana, gdy to **znana wcześniejsza wersja** pozycji (skrót w `kn.h`: `old-card-stale`, `old-card-ignored`)
  albo gdy znamy **nagrobek** pozycji; nagrobki młodsze niż 60 dni przechodzą do nowego dokumentu (`fullDoc`).
- `build_web.py` liczy wersję service workera z treści strony, więc nowa wersja pobierze się przy najbliższym uruchomieniu strony;
  karta już otwarta (np. iPhone w tle) działa na starym kodzie do odświeżenia. Dlatego ta naprawa jest potrzebna.

**Czego ta naprawa nie uratuje (do wiedzy):** zmiana zrobiona *tylko* na starej karcie i zapisana w całości na dokumencie
bez lustra, którego żadne nowe urządzenie nie widziało (np. wszystkie nowe urządzenia były wyłączone) – przy pierwszym
otwarciu nowej wersji zostanie to potraktowane jak zwykła migracja ze starego układu (pkt 5), więc **nic nie ginie**, a lokalne
zmiany z kolejki są scalane z tym, co jest w tablicach.

## 7. Treningi (E1-10)

- `dz.f.<idKonta>.unsent` = lista identyfikatorów treningów, których baza **jeszcze nie potwierdziła** (osobna dla konta,
  także gdy ten sam przeglądarkowy profil ma kilka kont).
- `saveSession(s)`: dopisz `s.id` do listy **przed** wysłaniem, zapisz trening do `dz.f.<id>.sessions` (jak dziś), wyślij `setDoc`;
  `then` → usuń id z listy; `catch` → zostaw na liście, toast „Trening zapisany w tej przeglądarce. Wyślę go do bazy, gdy się uda.”
  i ponowienie (jak w pkt 4).
- Nasłuch `sessions` (`ZP.mergeSessions`): lista z serwera + **treningi z listy `unsent`, których serwer nie ma** (z poprzedniego
  `SESS`/`localStorage`). Trening z listy, który serwer ma **jako potwierdzony** (migawka nie z pamięci podręcznej, dokument bez
  `hasPendingWrites`) → usuń z listy. Treningi z listy, których nie ma w migawce **z serwera** → ponowne `setDoc` (z opóźnieniem
  narastającym, żeby odrzucony zapis nie zapętlił się).
- **Usunięty trening nie wraca:** `deleteSession` usuwa id z `unsent` **przed** wysłaniem `deleteDoc`; scalanie przywraca tylko to,
  co jest na liście. Trening usunięty na innym urządzeniu, a potwierdzony tutaj, nie jest na liście, więc znika zgodnie z serwerem.
- Inwariant: id na liście ⇒ trening jest w `localStorage` (`sessions`) – nadpisanie `SESS` zawsze go zachowuje.
- Import kopii (`saveSession` w pętli) i `maybeMoveLocalData` korzystają z tej samej ścieżki, więc też są objęte.
- Trwający trening (`saveActive`, `_active`) bez zmian.

## 8. Ryzyka i wycofanie

| Ryzyko | Co robimy |
|---|---|
| Rozjazd zegarów dwóch urządzeń przy edycji tego samego planu | „Późniejsza” = czas urządzenia, ale znacznik zmiany nie jest mniejszy od największego czasu widzianego w bazie (`q.mx`), więc zegar „do tyłu” nie przegra ze zmianą, którą już widział. Zegar „do przodu” wygra (czasy dalej niż 30 dni w przód są pomijane w `mx`). Zmiany różnych planów tego nie dotyczą. |
| `mergeFields` / `deleteField` / transakcja nie były sprawdzone na prawdziwej bazie | Logika jest testowana na sztucznym „serwerze”; sam Firebase **nie jest testowany** (brak emulatora w sesji). Pierwsze wdrożenie ostrożnie: kopia każdego konta, sprawdzenie dwoma urządzeniami (pkt 9). |
| Dokument >1 MiB (lustro podwaja rozmiar) | Próg 900 000 bajtów UTF-8 całego dokumentu: powyżej niego lustro jest pomijane (migracja) albo usuwane (transakcja lustra) z ostrzeżeniem; zwykły zapis ostrzega przy 950 000 B (pkt 2). |
| Usunięcie planu na starej karcie wróci | Opisane w pkt 6; komunikat. |
| Pętla ponawiania odrzuconego zapisu | Narastające opóźnienia, jedno ostrzeżenie na serię. |
| Nagrobki rosną | Czyszczone po 60 dniach przy zapisie (razem ze starszym wpisem pod nagrobkiem); zapamiętane znane nagrobki (`kn.pt`, `kn.ct`) też wygasają po 60 dniach przy zapisie do localStorage. |
| Dwie karty tej samej przeglądarki | Kolejka i stan łączone jedną funkcją zapisu (pkt 4, „Zapis do localStorage jedną funkcją”). Karta, która nie została odświeżona, nie wysyła cudzych wpisów. |
| Dokument konta o nieznanym kształcie | Migracja wstrzymana, plany lokalne zostają w widoku, komunikat, ponowienie po kolejnym odczycie (pkt 5). |
| `persist()` wywoływane przy ~40 akcjach | Wykrywanie zmian przez porównanie JSON-ów, więc wywołania zostają bez zmian; koszt: JSON każdej pozycji przy każdym `persist()` (pomijalny przy kilkunastu planach). |

**Wycofanie.** Lustro w starym układzie sprawia, że dokument v3 jest **poprawnym dokumentem v2** dla starego kodu (stary kod
czyta `plans`/`custom`/`settings`, resztę ignoruje). Wycofanie = `git revert` commitów na `main` i nowe wdrożenie `web/`; dane zostają,
stary kod przy pierwszym zapisie zastąpi dokument starym układem (który jest aktualny, bo to lustro). Przed wdrożeniem właściciel
zapisuje kopię każdego konta (Ustawienia → Kopia zapasowa) – to zabezpieczenie na wszelki wypadek.

## 9. Testy

**Nowy plik `testy/zapis/test_zapis.js`** (Node, bez bibliotek): `node testy/zapis/test_zapis.js`; dopisany do `CLAUDE.md` i
do `test.yml`. Sztuczny „serwer” (mapa dokumentów, `mergeFields`, `deleteField`) i dwa urządzenia (`Urządzenie` z kolejką,
`S`, `zu`), przypadki:
1. dwa urządzenia zmieniają **różne** plany (jedno offline) → oba zostają po powrocie sieci (scenariusz z E1-09);
2. ten sam plan na dwóch urządzeniach → wygrywa późniejsza (w obie strony kolejności dotarcia do serwera);
3. usunięcie planu na A, edycja tego planu na B: wcześniejsza edycja → usunięty; późniejsza → plan zostaje;
4. usunięcie planu na A **nie wskrzesza go** z B (B bez zmian), także po nagrobku;
5. migracja ze starego układu (plany ze starymi kształtami `days`, własne ćwiczenia, ustawienia) → nic nie ginie, `S.plans` tablicą;
6. zapis starej karty po migracji (`setDoc` w układzie v2) → wykrycie, naprawa, nic z kolejki nie ginie, usunięcia nie wskrzeszają;
7. kolejność planów (zmiana na A, dodanie na B) i ustawienia (różne klucze z dwóch urządzeń);
8. samo-naprawa spóźnionego zapisu o starszym `u`;
9. kolejka: ponowienie po błędzie, przeżycie „zamknięcia karty” (serializacja do tekstu i odtworzenie), brak podwójnej wysyłki;
10. treningi: niepotwierdzony wraca po odczycie z bazy i jest wysyłany ponownie; potwierdzony znika z listy; **usunięty nie wraca**;
    lista osobna dla dwóch kont.
11. (A6b, A6c) zegar, nagrobki, lustro, historia wersji, dwie karty, rozmiar, zajętość konta, lista niewysłanych bez treningu w pamięci, usunięcie konta,
    migracja wstrzymana, nagrobek w trybie naprawy, wygasanie nagrobków – numery testów w pkt 11. Test 31 czyta `zrodla/src/app.html` (statyczny): pilnuje wywołań,
    których nie widać z Node (`folderDeleteGo` → `ZP.accountKeys`, `done` → `ZP.settle` z `zCur(fid)`, ścieżki noop/lustro/odczyt przez `ZP.store`, brak osobnych zapisów
    `.zq`/`.state`, obsługa dokumentu nieznanego kształtu).

**Test dymny (`testy/dymny/dymny.py`)** – musi zostać zielony (Chromium i WebKit; WebKit zwykle tylko w Actions).
- Krok pierwotny „zapis: scalanie planów, kolejka, nieudany zapis treningu, stara karta (sztuczny Firebase)”: sztuczny `FB` wstawiony w `page.evaluate` (kolejka, odczyt, nieudany zapis treningu, stara karta).
- Krok A6c „zapis: dwie karty, konto zamknięte w trakcie wysyłki, nieznany kształt dokumentu, rozmiar, usunięcie konta (sztuczny Firebase)” (ten sam sztuczny Firebase, druga karta symulowana przez `ZP.store`
  na wspólnym localStorage) sprawdza te ścieżki na prawdziwym kodzie strony. Od A6d ma też **strażnika**: `LS.set` jest owinięty, a zapis klucza pasującego do `/^dz\.f\..+\.(zq|state)$/` poza wywołaniem
  `ZP.store` / `ZP.settle` (owiniętych flagą) trafia na listę naruszeń, którą krok sprawdza na końcu (sprawdza też, że sam strażnik wykrywa zapis próbny).
- **Eksport i import kopii przed i po zmianie** (krok „kopia zapasowa”): ten sam stan (`S`, `SESS`) eksportowany starym (z `main`) i nowym kodem daje identyczny JSON; import kopii z `main` w nowym kodzie przywraca identyczny stan.

**Czego nie da się sprawdzić bez prawdziwego Firebase** (i bez dwóch prawdziwych kart w prawdziwej przeglądarce): zachowanie `mergeFields`+`deleteField`, transakcji i odpowiedzi
z pamięci podręcznej (`fromCache`, `hasPendingWrites`) na prawdziwym SDK; praca w trybie samolotowym na telefonie; zgodność z
regułami na żywej bazie (reguły nie ograniczają kształtu `state`, więc nie powinno być przeszkód). To trzeba sprawdzić na
wdrożonej stronie dwoma urządzeniami.

## 10. Kolejność pracy i podział

1. Ten plan na gałęzi `a6-zapis` (commit z samym plikiem).
2. `zrodla/src/zapis.js` + `testy/zapis/test_zapis.js` (najpierw testy logiki), potem wpięcie w `app.html` (`persist`, `flush`,
   `openFolder`, `saveSession`, `deleteSession`, `initStore` bez zmian), `build.py`/`build_web.py` (wklejenie `zapis.js`), nowy krok
   dymny, `web/` zbudowane, `CLAUDE.md` i `test.yml`. Osobne commity: logika+testy, wpięcie, test dymny+web, dokumentacja.
3. **Bez wdrożenia i bez scalania do `main`.** Przegląd przez drugi czat (Opus) na podstawie `git diff main..a6-zapis`;
   wdrożenie po jego zgodzie robi osobny czat. Przed wdrożeniem – kopia każdego konta.
4. Przeglądy: A6b (poprawki po pierwszym przeglądzie, commity A6b-1…6e) i A6c (poprawki po drugim przeglądzie, pkt 11).

## 11. Zmiany po przeglądach (A6b i A6c) – stan faktyczny

Poniżej wszystko, co kod robi inaczej niż pierwotny plan (pkt 1–10 są poprawione tak, żeby zgadzały się z tym stanem). Numery testów – `testy/zapis/test_zapis.js`.

### A6b
- **A6b-1 – zegary.** `stampQ = max(teraz, q.t+1, q.mx+1)`; `merge` zapamiętuje największe `u`, czasy nagrobków i `pos`/`cos` z bazy w `q.mx` (czasy dalej niż 30 dni w przód pomija). Test 13.
- **A6b-2 – nagrobki.** Wpis `pm.<id>` ukryty pod nagrobkiem trafia do kolejki jako usunięcie z oryginalnym czasem nagrobka; `buildWrite` czyszczący nagrobek po 60 dniach zabiera
  starszy `pm.<id>` (nowszy zostaje); `fullDoc` przenosi nagrobki młodsze niż 60 dni (`kn.pt`/`kn.ct` z odczytu v3 + czekające usunięcia); naprawa po starej karcie nie wskrzesza pozycji z nagrobkiem. Testy 14, 15, 16, 16b.
- **A6b-3 – lustro.** Zwykły zapis nie zawiera `plans`/`custom`; lustro odświeża osobna transakcja `flushMirror` (`ZP.mirrorOf`, `mirrorPatch`, `afterMirror`, kolejka `q.m`), tylko gdy dokument ma `full`. Testy 17, 18 (5b dostosowany).
- **A6b-4 – historia wersji.** `kn.h` trzyma skróty (32-bitowy FNV-1a + długość) 6 ostatnich wersji każdej pozycji (do 300 pozycji); w trybie naprawy kopia ze starej karty równa znanej wcześniejszej wersji jest pomijana
  (`old-card-stale`, `old-card-ignored`), więc nie cofa nowszej zmiany ani nie wskrzesza usuniętego. Testy 19, 19b, 19c.
- **A6b-5 – dwie karty (kolejka).** `ZP.mergeQ`/`saveZ`: suma wpisów, przy tym samym id większy znacznik (edycja kontra usunięcie: późniejsze), wysłane wpisy schodzą z zapisanej kolejki tylko, gdy nikt nie dał im nowszego znacznika;
  znane czasy: większy z obu, nagrobki: suma. Testy 20, 20b.
- **A6b-6a – rozmiar.** Limit 900 000 bajtów UTF-8 całego dokumentu (pm + nagrobki + ustawienia + lustro); za duży dokument = lustro pomijane (`fullDoc`) albo usuwane (`mirrorPatch` → `drop`). Test 21.
- **A6b-6b – zajętość konta.** `ZP.newBusy` (`zBusy` osobno dla konta) i `ZP.settle` (`afterSend` + zapis do localStorage tylko dla bieżącego `Z`). Test 22.
- **A6b-6c – lista niewysłanych treningów.** `mergeSessions` i `sessResend` nie zdejmują z listy id bez treningu w pamięci; zdejmuje je potwierdzenie serwera albo usunięcie treningu. Testy 23, 12b.
- **A6b-6d – usunięcie konta.** `ZP.zKey`/`sessKey`/`accountKeys`; `folderDeleteGo` kasuje `.zq` i `.unsent` razem z resztą danych konta. Test 24 (+ 31 i krok dymny: wywołanie w `folderDeleteGo`).
- **A6b-6e – migracja wstrzymana** dla dokumentu bez `plans` i `pm` (`migrate` → `hold`, bez `tx.set`). Test 25.

### A6c
1. **Kolejka i stan przy dwóch kartach – jedno miejsce zapisu.** `ZP.saveAll` (przez `ZP.store` / `ZP.settle`) zapisuje `.zq` i `.state`; wszystkie ścieżki w `app.html` (`persist`, odczyt z bazy w `openFolder`, `done`,
   noop, `flushMirror`) idą tą funkcją; stan łączy `ZP.mergeState`, a wpisy zdjęte przez scalenie `ZP.dropped`. Osobne ścieżki (`zSaveFor`, bezpośredni `LS.set` stanu w trybie fire) zniknęły. `openFolder` czyta stan z tego samego klucza
   (`ZP.stateKey`). Testy 26, 26b, 26c (Node), 31 (statyczny), krok dymny „dwie karty…” (zapis, odczyt z bazy, noop, odświeżenie strony).
2. **Nagrobek w trybie naprawy.** Urządzenie, które nigdy nie widziało planu, ale zna nagrobek (`kn.pt`), nie wskrzesza go po zapisie starej karty; test sprawdza też, że nie chroni go historia wersji. Test 27 (po wyłączeniu gałęzi `tomb !== undefined` jest czerwony).
3. **Testy wywołań w `app.html`.** Test 31 (statyczny) i krok dymny: `folderDeleteGo` czyści `ZP.accountKeys`; `done` zapisuje przez `ZP.settle` z `zCur(fid)` (jawnego `Z === z` w `done` nie ma – warunek jest w `ZP.store`: `current === z`); wysyłka przeciągnięta
   przez ponowne otwarcie konta nie rusza zapisanej kolejki nowego `Z`.
4. **Migracja wstrzymana.** `ZP.holdDoc`, `ZP.remoteHold`, tryb `hold` w `merge`; komunikat i ponowienie po kolejnym odczycie (pkt 5). Test 28 i krok dymny.
5. **Ten plik** zaktualizowany do stanu faktycznego (próg w bajtach UTF-8, brak klucza `.zu`, teksty toastów, A6b i A6c).
6. **Drobne.** Zrobione: wygasanie znanych nagrobków `kn.pt`/`kn.ct` po 60 dniach w `saveZ` (test 29); ostrzeżenie o rozmiarze przy zwykłym zapisie, `DOC_WARN` (test 30, krok dymny).
   **Niezrobione celowo:** zerowanie `zBusy` w `openFolder` – od A6b-6b zajętość jest osobna dla konta właśnie po to, żeby ponownie otwarte konto nie wysyłało drugi raz równolegle ze starą wysyłką; reset przy otwarciu
   zdjąłby tę ochronę, a spóźniony `done` starej wysyłki zwolniłby flagę nowej. Wysyłka zawsze się kończy (sukces albo `zFailed`), więc flaga nie zostaje na stałe.

### A6d (poprawki po przeglądzie A6c)
1. **`ZP.mergeState` nie cofa stanu po wysyłce drugiej karty.** `saveAll` przekazuje scalone `kn` (wynik `saveZ`) i `z.kn` tej karty; pozycja z nowszym znanym czasem bez własnego wpisu tej karty idzie z zapisanego stanu,
   nagrobki `kn.pt`/`kn.ct` usuwają pozycję ze stanu; `afterSend` zapisuje nagrobek wysłanego usunięcia w `kn.pt`/`kn.ct` (pkt 4). Testy 26d (wysłana zmiana P2, zapis P1, karta otwarta później), 26d-2 (własny wpis ma pierwszeństwo,
   wpis wraca do zapisanej kolejki), 26d-3 (usunięcie wysłane przez drugą kartę: oba warianty nagrobka, edycja usuniętego planu zostaje). Bez przekazania `kn` do `mergeState` czerwone są 26d i 26d-3.
2. **Kolejność planów i ustawienie na drugiej karcie.** Test 26d-4: karta B odwraca kolejność i zmienia ustawienie, karta A zapisuje tuż po niej; podmiana `mq[K.o] > q[K.o] ? B[K.o] : A[K.o]` na `A[K.o]` albo wyłączenie
   `out.s[k] = B.s[k]` robi ten test czerwonym (wcześniej żaden test tego nie wykrywał).
3. **Strażnik zapisu `.zq` / `.state`.** Test 31 (statyczny) obejmuje `LS.set` z `lsKey('state')`, `ZP.stateKey`, `ZP.zKey`, `zKey`, także przez zmienną (`const k2 = lsKey('state'); LS.set(k2, S)`); jedyny dozwolony bezpośredni
   zapis stanu to `persist` w trybach local i cloud. Statyczny test nie zobaczy klucza zbudowanego inaczej, więc krok dymny A6c łapie to w czasie działania (opis w pkt 9). Zdanie o teście 31 w `CLAUDE.md` poprawione.
4. **`ZP.accountKeys` zawiera `stateKey`** (`.zq`, `.unsent`, `.state`); `folderDeleteGo` nie kasuje już `.state` na sztywno, tylko przez `ZP.accountKeys`. Testy 24 i 31, krok dymny (usunięcie konta).
5. **Ten plik:** literówka w pkt 4, porządek w akapicie o teście dymnym (pkt 9: najpierw krok pierwotny, potem A6c i strażnik), opis poprawki 1 i skutku ubocznego (ponowna, idempotentna wysyłka) w pkt 4, ta sekcja.
