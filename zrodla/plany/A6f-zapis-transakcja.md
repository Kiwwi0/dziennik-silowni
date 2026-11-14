# A6f – zapis kolejki transakcją z warunkiem „tylko nowsze niż w bazie” (plan)

Gałąź robocza `a6f-wip` (po przeglądzie scalenie do `a6-zapis`). **Bez scalania do `main` i bez wdrożenia.**
Podstawa: A6 pkt 4–6 i sekcje A6d–A6e w `A6-zapis-planow-i-treningow.md`.

Stan wyjściowy: `a6f-wip` @ 18f9d75 (łatki w `zapis.js` i `flushFire`, testy 3c, 3d, 26f, 32, 33). `node testy/zapis/test_zapis.js` zielony (66),
test 32 na 40 ziarnach `SEED = k*7919`: czerwony tylko k = 9 (ziarno 71271), przebieg 42.

## 0. Przyczyna

Zwykły zapis to `setDoc(ref, data, {mergeFields})` bez warunku (`flushFire`, gałąź `zLay === 'v3'`). Baza przyjmuje go zawsze, niezależnie od tego,
co w niej jest w chwili dotarcia. Do tego Firestore działa z `persistentLocalCache` (IndexedDB, wiele kart): `setDoc` wysłany bez sieci czeka w IndexedDB
**także po zamknięciu karty** i dociera, gdy urządzenie wróci do sieci – czasem długo po tym, jak inne urządzenie zmieniło albo usunęło ten sam plan,
a nawet po tym, jak ta sama karta wysłała już nowszą wersję z kolejki w localStorage. Skutek: starsza `pm.<id>`, starsze usunięcie albo starszy nagrobek
nadpisują nowszy stan, a pozostałe urządzenia muszą to potem „odkręcać” przy odczycie (samo-naprawa, łatki z `a6f-wip`). Łatki po stronie odczytu
nie domkną wszystkich kolejności dotarcia – stąd czerwony test 32 na ziarnie 71271.

**Przebieg 42 (ziarno 71271)** pokazuje drugą, prostszą odmianę tego samego: zapis na podstawie **nieaktualnego widoku**, bez żadnego opóźnienia w SDK.
`U2:add` P3 (czeka), `Z2:add` P3 później (większy `u`), `Z2:wys` – w bazie P3 = „Z2+2”; `U2` od początku nie dostał migawki, `U2:wys` zapisuje swoje
starsze P3 = „U2+1” bez warunku i nadpisuje nowsze. Wynik: baza `P3: U2+1`, oczekiwane `Z2+2`. Nasłuch w prawdziwej aplikacji też bywa spóźniony
(telefon wybudzony z tła wysyła kolejkę, zanim przyjdzie migawka), więc to realny przypadek. Transakcja go zamyka: przed zapisem `U2` scala swoją kolejkę
z dokumentem, wpis P3 przegrywa (`remote-later`) i nie jest wysyłany.

## 1. Decyzja

Każdy zapis kolejki (`flushFire`) idzie **jedną transakcją**: `runTransaction` → `tx.get(ref)` → czysta funkcja `ZP.txPlan(...)` liczy zapis z tego,
co **właśnie przeczytała** → `tx.set(ref, data, {mergeFields})` (albo pełny dokument przy migracji/naprawie). Transakcja Firestore jest optymistyczna:
jeśli dokument zmieni się między odczytem a zatwierdzeniem (dowolnym zapisem – także `setDoc` starej karty), SDK powtarza funkcję na świeżym dokumencie
(do 5 razy). Dzięki temu warunek „nowsze niż w bazie” jest sprawdzany na stanie, na który zapis faktycznie trafia.

Nic nie wysyła się „na ślepo”: bez sieci transakcja się nie zaczyna, zmiany czekają w kolejce w localStorage (która już istnieje) i nic nie dociera
później z IndexedDB SDK. To usuwa źródło spóźnionych zapisów nowego kodu. Jedynym źródłem zapisów bez warunku zostają **stare karty** (`setDoc(S)`
w całości) – ich obsługa (tryb `repair`, pkt 6 planu A6) się nie zmienia.

## 2. Algorytm (`ZP.txPlan(doc, S, z, now, normOld)` – czysta, bez zmiany `S` i `z`)

1. `layout(doc)`:
   - `'v3'` → kroki 2–4;
   - `'old'` / `'empty'` → dotychczasowe `ZP.migrate` (pełny dokument v3, `tx.set` bez scalania); `holdDoc` → `{hold:true}` bez zapisu.
     Ścieżka `noop` znika: jeśli ktoś zdążył zmigrować, ta sama transakcja od razu robi zapis v3 (krok 2).
2. `R = remoteV3(doc)`, `mg = merge(S, z.q, z.kn, R, now)` – **ten sam algorytm scalania co w nasłuchu**. Wpis kolejki, który przegrywa z bazą,
   po `merge` już w kolejce nie jest (`remote-later`, `deleted-later`, `restored`), więc do zapisu idzie tylko to, co jest nowsze niż dokument.
3. `bw = buildWrite(mg.S, mg.q, now, {tombs:tombInfo(doc)})` (czyszczenie nagrobków po 60 dniach liczone z **tego** dokumentu, nie z ostatniej migawki).
4. Dodatkowe warunki, których `merge` dziś nie pilnuje (bo przy zapisie na ślepo nie miał czego), sprawdzane na `doc` tuż przed zwróceniem zapisu:
   - **pozycja** `pm.<id>` z `u`: zapis tylko gdy `!(doc.pt[id] >= u)` i `!later(doc.pm[id].u, J(doc), u, J(lokalna))`; identyczna treść i `u` = pomijamy pole (nic do zapisania);
   - **usunięcie** (`pd[id] = ts`): `pm.<id> = deleteField()` tylko gdy `!(doc.pm[id].u > ts)`;
   - **nagrobek** `pt.<id> = ts`: tylko gdy `ts > (doc.pt[id] ?? -1)` – starszy nagrobek nie nadpisuje nowszego (dziś nadpisuje);
   - **kolejność** `po`/`pos`: tylko gdy `q.po > doc.pos` (merge już to robi – zostaje);
   - **ustawienia**: bez znaczników – jak dziś wygrywa zapis, który dotrze później (A6 pkt 4, świadomie bez zmian).
   Pominięty wpis wraca w wyniku jako `lost` (zdejmowany z kolejki, nie jest zapisywany jako znany czas).
5. Wynik: `{kind:'v3'|'full'|'hold', data, fields | doc, sent, written, lost, mx, notes}`. Gdy po scaleniu nie ma czego zapisać – `{kind:'none'}` (bez `tx.set`).

Funkcja jest czysta, bo SDK może ją wywołać kilka razy (ponowienie transakcji); `S`, `z.q`, `z.kn` zmieniają się dopiero w `.then`.

### Po zatwierdzeniu (`ZP.afterTx(z, res, now)` w `done`, przez `ZP.settle`)
- `afterSend(z, res.sent, res.written)` jak dziś (zdejmuje tylko wpisy, które się od wysłania nie zmieniły);
- wpisy z `res.lost` schodzą z kolejki tylko, jeśli mają nadal ten sam znacznik (użytkownik mógł je w międzyczasie znowu zmienić – wtedy zostają);
- `q.mx = max(q.mx, res.mx)` – kolejna zmiana dostanie znacznik większy niż wszystko, co transakcja widziała;
- `S` **nie** jest podmieniane wynikiem `merge` z transakcji (karta mogła w tym czasie zmienić `S`); widok wyrównuje następna migawka nasłuchu – tak jak dziś.

## 3. Zmiany w `app.html` (`flushFire`)
- Jedna ścieżka zamiast dwóch (`zLay === 'v3'` / migracja): `runTransaction` z `ZP.txPlan`; `tx.set(ref, zUnDel(data), {mergeFields:fields})` albo `tx.set(ref, doc)`.
  `zLay` zostaje tylko do komunikatów i ostrzeżenia o rozmiarze.
- `navigator.onLine === false` → zwolnij `zBusy`, bez toastu, czekaj na `online` (jak dziś w migracji). Błąd transakcji z siecią = `zFailed` jak dziś.
- Lustro: **bez zmian** – nadal osobna transakcja `flushMirror` po udanym zapisie (`q.m`). (Możliwe później: lustro w tej samej transakcji – oszczędza 1 odczyt
  i 1 zapis, ale rusza testy 17, 18, 26 i krok dymny; poza zakresem A6f.)
- `syncShares()` po zatwierdzeniu, nie przed.
- Wysyłka treningów (`saveSession`, `sessResend`) – **bez zmian** (każdy trening to osobny dokument z niezmiennym id, ostatni zapis wygrywa i tak jest dobrze).

## 4. Bez sieci (kolejka w localStorage)
- Brak sieci = brak transakcji = brak zapisu w IndexedDB SDK. Kolejka `dz.f.<konto>.zq` (już istnieje, zapis tylko przez `ZP.store`/`ZP.settle`) przeżywa zamknięcie karty.
- Wysyłka rusza: po `online`, po otwarciu konta (pierwsza migawka z serwera), po `visibilitychange` (zakryta karta próbuje raz), po ponowieniu z `backoff`.
- Strata względem dziś: zapis nie dzieje się „w tle” po zamknięciu karty offline – wyśle się przy następnym otwarciu strony z siecią. To jest właśnie zamierzone
  (żadnego spóźnionego zapisu), a dane nie giną.
- Transakcja przerwana po zatwierdzeniu na serwerze (zerwane połączenie, brak odpowiedzi): ponowienie scala z dokumentem, który ma już ten zapis → te same `u`
  i treść → pole pominięte albo zapisane identycznie (idempotentne).

## 5. Koszt odczytu
- Każdy zapis kolejki = **+1 odczyt dokumentu** (transakcja czyta `data/state`), przy konflikcie do 5 odczytów. Zapis lustra już dziś czyta 1 dokument w swojej transakcji.
  Razem: ok. 2 odczyty + 2 zapisy na jedną serię zmian (zapis jest odkładany o 600 ms, więc seria kliknięć = 1 transakcja).
- Plan bezpłatny Firestore (Spark): 50 000 odczytów i 20 000 zapisów dziennie na projekt. Nawet 300 serii zmian dziennie na konto to ~600 odczytów – ok. 1% limitu.
- Transfer: transakcja pobiera cały dokument (zwykle kilkadziesiąt KB, najwyżej ~900 KB – próg lustra). Przy telefonie na danych komórkowych to pomijalne przy typowych planach.
- Opóźnienie: odczyt + zatwierdzenie = 2 wymiany z serwerem zamiast 1; zapis i tak dzieje się w tle, widok się nie zmienia.

## 6. Łatki z `a6f-wip` – co zostaje

Reguła: po wpięciu transakcji każdą łatkę wyłączam osobno i puszczam cały `test_zapis.js` + test 32 na 40 ziarnach. **Zielono bez łatki → usuwam** (mniej kodu
do utrzymania). **Czerwono → zostaje**, z testem, który ją pilnuje, i zdaniem w sekcji A6f planu A6.

| Łatka (kod w 18f9d75) | Co robi | Przewidywanie |
|---|---|---|
| **reassert-tomb** (`merge`, gałąź „brak zdalnej”) | starsze usunięcie skasowało w bazie nowszy wpis (`tomb < KN[id]`) → karta, która zna nowszą wersję, wysyła ją ponownie | **zbędna** – usunięcie starsze niż `pm.<id>` w bazie nie przejdzie warunku z kroku 4 (a `merge` w transakcji da `restored`). Stare karty nagrobków nie piszą. Usuwam; test 3c przepisany: usunięcie offline po powrocie sieci **w ogóle nie trafia** do bazy |
| **stale-delete** w `merge` (`pdel < KN[id]`, pozycja jest) | usunięcie przejęte z innej karty, starsze niż znana wersja → odrzucone przed wysyłką | **prawdopodobnie zbędna** w zapisie (w transakcji `restored`, bo w bazie jest wersja nowsza od usunięcia). Ale działa też przy odczycie bez sieci i w nowej karcie przed migawką (widok nie gubi planu) – rozstrzyga mutacja |
| stale-delete w `mergeState` | pozycja z usunięciem starszym niż znana wersja zostaje w zapisanym stanie | **zostaje** – dotyczy localStorage (zamknięta karta, nowa karta offline), nie zapisu do bazy |
| **najnowszy znany nagrobek** (`rememberTombs` + `tomb = max(Rt, kn.pt)` w `merge`, `maxT` w `saveZ`) | baza mogła dostać starszy nagrobek po nowszym; pamięć urządzenia trzyma nowszy | w bazie nagrobek już nie maleje (krok 4). **Zostaje** jako ochrona przy migawce spóźnionej względem własnej transakcji i przy zapisach starej wersji, jeśli mutacja nie pokaże, że nic nie wnosi; `maxT` w `saveZ` zostaje (łączenie przez maksimum jest po prostu poprawne) |
| **noop czeka na migawkę** (`flushFire`, `k.lay` w `kartaSv`, test 33) | po `noop` nie wysyłać na ślepo przed odczytem v3 | **zbędna** – nie ma `noop` ani zapisu na ślepo; wysyłka przed migawką jest bezpieczna (transakcja czyta dokument). Test 33 zastępuje sprawdzenie, że `flushFire` nie ma `setDoc` na `data/state`; w 26f asercja „przed migawką nic nie idzie” → „przed migawką usunięcie P1 nie trafia do bazy” |

## 7. Testy

**`testy/zapis/test_zapis.js` – sztuczne urządzenie (`Urz.wyslij`)**
- Ścieżka v3 = transakcja: `doc = sv.get()` → `ZP.txPlan` → `sv.merge(data, fields)` → `ZP.afterTx`. Migracja jak dziś, ale w tej samej funkcji.
- Bez sieci: `wyslij()` nic nie robi (zamiast `outbox`). `wracaSiec()` = `online = true` + `wyslij()`.
- Nowy pomocnik `zapisNaSlepo(bw)` (stary `sv.merge` bez warunku) – tylko do testów, które celowo symulują spóźniony zapis (stara wersja kodu, test 14),
  żeby samo-naprawa przy odczycie dalej była sprawdzana.
- Testy z `online = false` (1, 2b, 3a, 3b, 4, 4b, 5, 5c, 6b, 9, 13, 14 – ok. 13 miejsc): ten sam wynik końcowy, inna droga (zapis po powrocie sieci, nie z `outbox`).
  Przegląd każdego: oczekiwania się nie zmieniają; jeśli któryś test sprawdzał właśnie spóźnione dotarcie, przechodzi na `zapisNaSlepo`.
- `kartaSv` (testy 26*, 32): `wyslij` = ta sama transakcja (`txPlan` na `sv.get()` + `ZP.settle`), bez `k.lay`.
- **Nowe przypadki (34a–34h):**
  a) edycja starsza niż `pm.<id>` w bazie nie jest zapisywana, wpis schodzi z kolejki, migawka daje wersję z bazy;
  b) edycja starsza niż nagrobek nie wskrzesza planu;
  c) usunięcie starsze niż edycja w bazie nie usuwa planu (`restored`);
  d) starszy nagrobek nie nadpisuje nowszego (`pt` w bazie bez zmian);
  e) ponowienie transakcji: dokument zmienia się między pierwszym a drugim wywołaniem `txPlan` (wynik zależy tylko od drugiego, `z` nietknięte);
  f) bez sieci: nic nie trafia do bazy, kolejka przeżywa zamknięcie karty, po powrocie sieci wysyła się raz, nie nadpisuje nowszej zmiany z innego urządzenia;
  g) zmiana zrobiona w trakcie transakcji (między `txPlan` a `afterTx`) nie ginie i wysyła się w kolejnej;
  h) transakcja zatwierdzona, odpowiedź zgubiona: ponowienie nic nie psuje (idempotentne).
- **Test 32 (losowy):** bez zmian w treści; dochodzi zmienna `SEEDS=40` (pętla `SEED = k*7919`, k = 1..40) do ręcznego przebiegu. CI: domyślne ziarno + 71271
  (przebieg 42 jako stały przypadek regresji). Jeden przebieg całego pliku trwa ułamek sekundy, więc 40 ziaren to kilkanaście sekund.
- **Test 33 (statyczny):** zamiast noop – w `flushFire` nie ma `FB.setDoc(zStateRef(…)`, zapis `data/state` tylko przez `tx.set` w `runTransaction`.
- Testy 3c, 3d, 26e, 26f: wynik końcowy bez zmian; 3c i 26f zmieniają **stan pośredni** (patrz pkt 6), 3d bez zmian.

**Test dymny (`testy/dymny/dymny.py`)**
- Sztuczny `runTransaction`: `tx.set(ref, data, opts)` z obsługą `mergeFields` i `deleteField` (dziś `tx.set` zawsze zastępuje dokument), opcjonalne ponowienie,
  gdy `sv.doc` zmieni się w trakcie (do testu „konflikt”).
- Krok „zapis: …”: sprawdzenie, że po zmianie planu w logu sztucznego serwera jest `tx` z `mergeFields`, a nie `merge` z `setDoc`; offline (`sv.fail`) → nic w bazie, kolejka w localStorage,
  po powrocie – jeden zapis.

## 8. Ryzyka

| Ryzyko | Co robimy |
|---|---|
| `tx.set(…, {mergeFields})` z `deleteField()` w transakcji – nie sprawdzone na prawdziwym SDK | To udokumentowane API (`Transaction.set` przyjmuje `SetOptions`). Sprawdzenie dwoma urządzeniami po wdrożeniu (jak w A6 pkt 9). |
| Transakcja przy `persistentMultipleTabManager` | Transakcje zawsze idą do serwera, pamięć podręczna tylko je odbija; brak znanych ograniczeń. Sprawdzenie po wdrożeniu. |
| Zapis tylko w trybie online – iPhone w tle | Kolejka w localStorage; wyśle się po powrocie na stronę. Nic nie ginie. |
| Stara karta (`setDoc(S)` bez warunku) | Bez zmian: tryb `repair`. Transakcja nowego kodu po zapisie starej karty widzi układ `old` i robi naprawę w tej samej transakcji. |
| Konflikt (dwa urządzenia zapisują naraz) | SDK powtarza funkcję; przy 5 nieudanych próbach – `zFailed` i ponowienie z `backoff`. |

## 9. Kolejność pracy (osobne commity na `a6f-wip`)
1. Ten plan.
2. `zapis.js`: `txPlan`, `afterTx`, warunki z kroku 4 + testy 34a–34h + przestawienie `Urz.wyslij` (najpierw testy Node).
3. `app.html`: `flushFire` jedną transakcją, bez `noop`; test 33 (statyczny).
4. Łatki: wyłączanie po kolei według pkt 6, usunięcie zbędnych (osobny commit na każdą).
5. Test 32 na 40 ziarnach, test dymny (sztuczny `runTransaction`), `build_web`, `web/`.
6. Dokumentacja: sekcja A6f w planie A6 (pkt 4 „Zapis”, pkt 8, pkt 11), zdanie w `CLAUDE.md` (zapis transakcją).
7. Przegląd krytyczny w tym samym czacie, poprawki, scalenie `a6f-wip` → `a6-zapis`.
