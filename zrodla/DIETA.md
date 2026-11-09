# Segment „Dieta” – plan budowy

Plan ustalony z Kamilem (czat „Dieta”, listopad 2026). Budowa w dwóch częściach, każda w osobnym czacie.
Czytaj tylko potrzebne fragmenty `zrodla/src/app.html` (grep + zakres linii). Nie zmieniaj zachowania
istniejących segmentów (trening, plany, ćwiczenia, historia, manekin) – dieta to nowa, osobna część.
Po każdej części: build_web, test (jasny i ciemny, 390 px), commit, push, krótkie podsumowanie po polsku.

## Ustalenia (nie zmieniać bez pytania Kamila)
- Nowa, piąta zakładka **Dieta** na dolnym pasku.
- Produkty w dwóch warstwach:
  1. **Baza ogólna** – wspólna dla wszystkich: 242 produkty ogólne z `zrodla/content/produkty.csv`
     (wbudowane w stronę), a w części 2 także produkty zeskanowane przez kogokolwiek (Firebase `foods/`).
     Nie jest wyświetlana w całości – tylko w wynikach wyszukiwania i skanu.
  2. **Moje produkty** – osobne dla każdej osoby. Produkt trafia tu sam, gdy zostanie dodany do posiłku,
     utworzony ręcznie albo oznaczony gwiazdką. Domyślny widok przy dodawaniu jedzenia; sortowanie:
     ★ na górze, potem najczęściej / ostatnio używane.
- Poprawki produktu (wartości, nazwa) są osobiste: zapisują się w „Moich produktach” i mają pierwszeństwo
  przed bazą ogólną. Bazy ogólnej użytkownik nie edytuje (wyjątek: zeskanowane produkty w `foods/` – poprawka trafia tam
  dopiero po potwierdzeniu przez kilka osób, patrz część 2b).
- Wartości produktów zawsze **na 100 g** (płyny: na 100 ml), węglowodany **bez błonnika** (jak na polskich etykietach).
- Wpis w dzienniku zapisuje **kopię** nazwy i wyliczonych makro (kcal, B, W, T) – późniejsza zmiana produktu
  nie zmienia historii.

## Dane startowe: `zrodla/content/produkty.csv`
Separator `;`, nagłówek: `id;nazwa;kategoria;jednostka;kcal;bialko;wegle;tluszcz;blonnik;porcja_g;porcja_opis`.
- `id` – stały identyfikator (slug nazwy). Nie zmieniaj istniejących id (odwołują się do nich zapisane dane).
- `jednostka` – `g` albo `ml`; `porcja_g` i `porcja_opis` mogą być puste.
- Kategorie: mieso, ryby, nabial, jaja, zbozowe, straczkowe, warzywa, owoce, orzechy, tluszcze, suplementy,
  przekaski, slodycze, sosy, napoje, inne.
- Dane wygenerował Gemini i zostały sprawdzone (kcal ≈ 4B+4W+9T, poza piwem – alkohol). Węgle w orzechach
  i nasionach już bez błonnika.
- **Porządki (poprawki po części 1), obecnie 242 produkty.** Id produktów, które zostały, się nie zmieniły. Usunięte produkty,
  które ktoś ma w „Moich produktach”, zostają tam bez zmian, a wpisy w dziennikach nie są ruszane. Zasady nazw:
  1. Zboża, makarony, kasze, kuskus, komosa, ryż, soczewica, groch: „(przed gotowaniem)” i „(po ugotowaniu)”.
  2. Mięso i ryby: „(przed gotowaniem)”; pierś z kurczaka po obróbce jest jedna, uśredniona („Pierś z kurczaka (po obróbce)”, porcja 150 g).
  3. Ziemniaki → jedno „Ziemniaki” (średnia wartości, bez wersji gotowanych); marchew, brokuł, burak, bataty – jedna wersja surowa bez dopisku;
     pozostałe warzywa bez „(surowy/surowe)”; papryka → jedno „Papryka” (średnia czerwonej i żółtej).
  4. Płatki bez „(surowe)”; osobno „Owsianka na wodzie”.
  5. „Jajko kurze” (całe, surowe); usunięte: jajko gotowane, białko, żółtko.
  6. Fasola czerwona, fasola biała, ciecierzyca – tylko wersja sucha; soczewica w dwóch wersjach (przed gotowaniem / po ugotowaniu).
  7. Usunięte: herbata, kawa czarna, ocet jabłkowy, soja (nasiona suche).
  8. Napoje roślinne (owsiany, sojowy) przeniesione do kategorii „napoje”. „(odsączony)” zostaje.
  9. Edamame „(fasolka sojowa gotowana)” bez zmian (nie pasowało do żadnej zasady).
  Średnie liczone z zaokrągleniem „w górę od połowy”: kcal do całości, makro do 0,1.
- **Kontrola:** `python3 -I zrodla/check_produkty.py` – brak duplikatów id i nazw, 11 pól w każdym wierszu, id tylko `[a-z0-9-]`
  (bezpieczne jako klucz w bazie), kategorie i jednostki, zakresy, porcja_g i porcja_opis razem, kcal ≈ 4B+4W+9T z tolerancją 15%
  (dopuszczalne też liczenie z błonnikiem po 2 kcal/g albo z węglami netto + błonnik – brokuł, fasolka, chia); wyjątek: piwa. Uruchom po każdej zmianie CSV.

Wbudowanie: w obu skryptach (`build.py`, `build_web.py`) wczytaj CSV i wstaw jako JSON w miejsce
`__FOODS_JSON__` – tak samo jak `__EXERCISES_JSON__` (`<script type="application/json" id="fooddata">`,
`.replace('<', '\\u003c')`, `assert count == 1`). Format w JS, krótkie klucze:
`{id, n:nazwa, c:kategoria, u:'g'|'ml', k, b, w, t, f:blonnik, pg:porcja_g|null, po:porcja_opis|''}`.

---

## CZĘŚĆ 1 – podstawa diety

### Stan i zapis
Dieta **nie** wchodzi do `S` (dokument `state` jest zapisywany w całości przy każdej zmianie). Osobno:
- `DIET = {goals:{k, b, w, t}, mine:[…], v:2}` – cele i „Moje produkty” (w pamięci `mine` to tablica).
  - Firebase: `folders/{fid}/data/diet` w formacie `{v:2, goals:{k, b, w, t}, mine:{[id produktu]:produkt}}` – **każdy produkt i każdy
    cel to osobne pole dokumentu**, zapis `setDoc(…, {merge:true})` tylko zmienionych pól (usunięcie produktu: `deleteField()`;
    pusty cel zapisuje `null`), tak samo jak dni. Zmiany z dwóch urządzeń się więc nie gubią. Zmiany czekające na zapis (`dietPut`,
    `dietDel`, `dietGoalsDirty`) są ponownie nakładane na dokument przychodzący z bazy, a przy błędzie zapisu wracają do kolejki.
  - Stary dokument (`mine` jako tablica, `v` ≠ 2) czytamy normalnie (`DIET_OLD`) i przy pierwszym zapisie **jednorazowo zastępujemy
    w całości** nowym formatem (scalanie mapy z polem-tablicą zastąpiłoby całe pole). `id` produktu jest czyszczone do `[A-Za-z0-9_-]`
    (klucz pola); produkt bez id jest odrzucany.
  - localStorage: `lsKey('diet')`.
- Dni: `DAYS = {'2026-11-09': {meals:{sn:[], ob:[], ko:[], pr:[]}}, …}` – osobny dokument na dzień.
  - Firebase: `folders/{fid}/diet/{RRRR-MM-DD}` w formacie `{date, e:{[id wpisu]:{…wpis, m:'sn'|'ob'|'ko'|'pr'}}}`,
    zapis `setDoc(…, {merge:true})` tylko zmienionych wpisów (usunięcie: `deleteField()`), więc zapis nigdy nie nadpisuje
    wpisów z innych urządzeń ani dni spoza wczytanych 60 (poprawka po przeglądzie części 1). `normalizeDay` czyta też
    stary format `{meals}`; taki dzień przy pierwszym zapisie przechodzi na nowy (`DAY_OLD`). Reguła odczytu `diet/{day}`
    bez warunku na id (inaczej zapytanie o listę dni jest odrzucane).
  - localStorage: `lsKey('dietDays')` (cały obiekt, format `{meals}`).
  - Klucz daty: istniejąca funkcja `dayKey(d)`.
- Wpis w posiłku: `{id:uid(), pid:id produktu|null, n:nazwa, g:gramy|null, k, b, w, t, o:kolejność (czas dodania)}`
  (makro już przeliczone na zjedzoną ilość, zaokrąglone do 0,1; `pid:null` = szybki wpis samych liczb).
  Pola opcjonalne: `u:'ml'` (płyn) oraz przy wpisie w sztukach `q` (liczba sztuk, ułamki dozwolone, zaokrąglone do 0,01),
  `po` (opis porcji, np. „1 jajko M”) i `pg` (gramy w jednej porcji) – zapisane w wpisie, więc późniejsza zmiana produktu
  nie zmienia ani opisu, ani edycji. Przy zapisie do bazy brakujące `q/po/pg/u` są kasowane przez `deleteField()` (scalanie samo ich nie usuwa).
- Produkt w `mine`: `{id, n, brand:'', u, k, b, w, t, f, pg, po, src:'gen'|'own'|'scan', ean:'', star:false, uses:0, last:0}`.
  Produkt z bazy ogólnej trafia do `mine` z tym samym `id` i `src:'gen'`; własny dostaje `id:'o-'+uid()`.
- Wczytywanie/zapis wzoruj na istniejących: `persist`/`flush` (debounce), `openFolder` (onSnapshot dla
  `data/diet` i kolekcji `diet` – wystarczą ostatnie ~60 dni: `orderBy(documentId)`/`where` po id albo pole `date`),
  `closeFolder` (odpięcie nasłuchu, wyczyszczenie `DIET`/`DAYS`), tryb lokalny (`store.mode === 'local'`).
  Dzień zapisuj osobno (`setDoc` dokumentu dnia) przy zmianie wpisów tego dnia.
- `firestore.rules`: w `match /data/{docId}` dopuść `docId in ['state', 'diet']`; dodaj
  `match /diet/{day} { allow read, write: if isMember(fid) && day.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'); }`.
  Reguły wgrywa sam workflow `.github/workflows/rules.yml` po pushu zmian w `firestore.rules`.
- `DIET` zapisuje się w całości, dlatego zmiany produktów i celów czekają, aż dokument przyjdzie z bazy (`dietLoaded`, `dietCanEdit`).
- **Posiłki w ciągu dnia nie są stałe** (poprawka po części 1): lista każdej osoby to `DIET.meals = [{id, n}]` (domyślnie Śniadanie `sn`, Obiad `ob`,
  Kolacja `ko`, Przekąski `pr`; do 10 posiłków, nazwa do 30 znaków, minimum 1). `MEALS = [[id, nazwa]]` jest odbiciem tej listy (`syncMeals()`).
  W bazie to pole `meals` (tablica) w `folders/{fid}/data/diet`, zapisywana w całości przy zmianie (`dietMealsDirty`, ostatnia zmiana wygrywa;
  zmiana oczekująca na zapis ma pierwszeństwo nad snapshotem). Dokument bez `meals` = cztery domyślne. Id nowego posiłku: `m` + 6 znaków `[a-z0-9]`.
  Wpisy w dniach trzymają id posiłku (`m`); dzień ma tablicę dla każdego posiłku, ale kod nie zakłada, że ma je wszystkie (`||= []`).
  **Usunięcie posiłku nie kasuje wpisów** – w dniach, które je mają, pokazują się w sekcji „Inny posiłek” (bez przycisku „Dodaj”, liczą się do sum dnia).
  Arkusz `dietMeals` (przycisk „Posiłki” na dole zakładki, obok „Cele”): zmiana nazwy na żywo, strzałki w górę/w dół, usunięcie z potwierdzeniem, pole „Nowy posiłek”.
  Chipy wyboru posiłku w `dietQty` pochodzą z listy. Import kopii dopisuje posiłki z kopii, których id brakuje (kopia bez `diet.meals` nic nie zmienia).
- Kopia zapasowa (segment 5) zawiera `diet` i `dietDays`; stara kopia bez tych pól zostawia obecną dietę nietkniętą.
  - **Eksport w dwóch krokach** (schowek na iPhonie działa tylko zaraz po stuknięciu): „Przygotuj kopię” (`exportPrep`, asynchronicznie
    pobiera z Firebase **wszystkie** dni z `folders/{fid}/diet`, także starsze niż 60, i scala je z lokalnymi przez `mergeDays`;
    przy błędzie pobierania kopia zawiera dni z tego urządzenia i pokazuje ostrzeżenie) → „Kopiuj” (`exportCopy`, synchronicznie
    `navigator.clipboard.writeText`, awaryjnie zaznaczenie pola). „Przygotuj od nowa” czyści wynik.
  - **Import** (`importAsk`): plany, własne ćwiczenia i ustawienia zastępowane kopią; treningi, dni diety i „Moje produkty” z kopii
    **dochodzą** do obecnych (przy tym samym id wygrywa produkt obecny); cele diety zastępowane tylko wtedy, gdy kopia ma jakikolwiek cel.
    Dni scalane po wpisach (istniejące zostają). Bez prawa edycji diety (`dietCanEdit`) import diety się nie wykonuje.
  - Okno 60 dni (`DIET_WINDOW`) dla odczytu na bieżąco bez zmian – dni starszych niż 60 nie są ruszane.

### Wygląd zakładki Dieta (`vDiet()`)
1. **Pasek daty**: ‹ dziś › (strzałki = dzień wcześniej/później; nie dalej niż dziś), stuknięcie w datę wraca do dziś.
2. **Karta podsumowania dnia**: kcal zjedzone / cel, duży pasek; pod spodem trzy mniejsze paski B / W / T
   (g zjedzone / cel). Brak celów → przycisk „Ustaw cel”. Przekroczenie celu: pasek w kolorze ostrzegawczym
   (bez czerwonych alarmów).
3. **Posiłki**: Śniadanie, Obiad, Kolacja, Przekąski (`sn`, `ob`, `ko`, `pr`). Każdy: nagłówek z sumą kcal i B,
   lista wpisów (nazwa, ilość, kcal; stuknięcie = edycja ilości / usunięcie), przycisk „+ Dodaj”.
4. Na dole drobny link „Cele” (otwiera arkusz celów).

Używaj istniejących klas i wzorców (karty, `row`, `btn`, `iconbtn`, `dayrow`, paski z historii/tygodnia),
kolorów ze zmiennych CSS (oba motywy), `svg()` i `ICON` (dodaj ikonę zakładki, np. jabłko/talerz).
`TABS`: dodaj `{id:'dieta', label:'Dieta', title:'Dieta', icon:…}`; `.tabbar .wrap` → `repeat(5, …)`;
`render()` → gałąź `ui.tab === 'dieta' ? vDiet()`. Sprawdź, że 5 zakładek mieści się w 390 px (etykiety nie łamią się).

### Arkusze (`SHEETS`)
- **`dietAdd`** (posiłek w parametrze): pole wyszukiwania na górze + przyciski „Szybki wpis” i „Nowy produkt”.
  - Puste pole: lista „Moje produkty” (★, potem `uses`/`last`). Pusta lista → krótka podpowiedź „Wyszukaj produkt”.
  - Wpisany tekst: sekcja „Moje produkty” (pasujące) i „Baza ogólna” (pasujące z bazy, bez tych już w `mine`),
    max ~30 wyników. Wyszukiwanie bez polskich znaków i wielkości liter (np. „platki” znajduje „Płatki”),
    po każdym słowie (wszystkie słowa muszą pasować). Przy pozycji: nazwa, marka (jeśli jest), kcal i B na 100.
  - Stuknięcie produktu → arkusz `dietQty`.
- **`dietQty`**: nazwa, makro na 100 g; **produkt z porcją (`pg`) ma przełącznik „szt. | g”, domyślnie szt.**; tryb szt.: licznik − / + (krok 1,
  najmniej 0,5, największa liczba tak, by ≤ 5000 g) z polem do wpisania ułamka (np. 0,5) i podglądem „3 × 1 jajko M = 150 g”;
  tryb g: pole ilości w g/ml (domyślnie 100, a po przełączeniu ze sztuk – przeliczone) + przycisk porcji („1 jajko M · 50 g”);
  produkt bez porcji ma tylko pole g/ml. W dzienniku wpis w sztukach: „3 × 1 jajko M (150 g)”, wpis w gramach: „150 g”.
  Edycja wpisu otwiera się w tym samym trybie (wpis ze `q` → sztuki); zmiana na g usuwa `q/po/pg`. Wybór posiłku, **makro przeliczone na żywo**, przycisk „Dodaj”/„Zapisz”. Przy dodaniu:
  wpis do dnia, produkt do `mine` (jeśli go nie ma), `uses++`, `last=Date.now()`. W edycji wpisu także „Usuń”.
  Gwiazdka ★ i „Edytuj produkt” (otwiera `dietProd`).
- **`dietQuick`**: nazwa (opcjonalna, domyślnie „Szybki wpis”), kcal, B, W, T → wpis z `pid:null`.
- **`dietProd`**: tworzenie/edycja produktu w `mine` (nazwa, marka, g/ml, kcal, B, W, T, błonnik na 100, porcja g + opis).
  Walidacja jak niżej. Edycja produktu z bazy ogólnej zapisuje kopię w `mine` (ten sam `id`) – baza się nie zmienia.
  Usunięcie z „Moich produktów” nie usuwa wpisów z dni.
- **`dietGoals`**: kcal, B, W, T (g). Podpowiedź pod polami: „B×4 + W×4 + T×9 = X kcal” (informacyjnie, bez blokowania).
  Kalkulator zapotrzebowania – dopiero w późniejszym etapie.

### Walidacja i limity
- Na 100 g: kcal 0–900; B, W, T, błonnik 0–100; B+W+T+błonnik ≤ 105. Ilość wpisu 1–5000 g. Cele: kcal 0–10000, makro 0–1000.
- Gdy |4B+4W+9T − kcal| > 15% i kcal > 30 → łagodne ostrzeżenie „Wartości się nie sumują – sprawdź etykietę” (zapis dozwolony).
- Pola liczbowe jak w reszcie aplikacji (`inputmode="decimal"`, przecinek i kropka, wzorce z `limitInput`).

### Test części 1
Wersja testowa (`build.py`, localStorage) wg CLAUDE.md, 390×844, jasny i ciemny:
brak `pageerror`, brak przewijania w bok; scenariusz: ustaw cele → dodaj „Płatki owsiane” 50 g do śniadania →
szybki wpis → nowy produkt własny → edycja i usunięcie wpisu → przełączenie dnia → odświeżenie strony (dane zostają).
Zrzuty ekranu tylko na końcu (zakładka Dieta, `dietAdd` z wynikami, `dietQty`) – oba motywy.
Sprawdź też, że pozostałe 4 zakładki wyglądają jak przed zmianą.

---

## CZĘŚĆ 2 – skaner kodów kreskowych i wspólna baza (osobny czat, po przetestowaniu części 1 przez Kamila)
- **Podpowiedź przy zbożowych i strączkowych:** przy zeskanowanym produkcie z kategorii zbożowe/strączkowe (ryż, makaron, kasze, płatki, suche strączki)
  pokaż w `dietQty` (i w `dietProd` po skanie) podpowiedź „Wartości z etykiety – waż przed gotowaniem”, bo etykieta podaje wartości suchego produktu.
- Przycisk **📷 Skanuj** w `dietAdd`. Aparat przez `getUserMedia` (tylna kamera), odczyt kodów EAN-13/EAN-8/UPC
  biblioteką ładowaną **dopiero po kliknięciu** (np. ZXing z cdnjs/jsdelivr, dokładna wersja; sprawdź działanie na iOS Safari
  i w trybie ekranu głównego). Zamknięcie aparatu po odczycie; pole do ręcznego wpisania cyfr kodu jako zapas.
- Szukanie po kodzie: 1) `mine` (pole `ean`), 2) wspólna baza `foods/{ean}`, 3) Open Food Facts
  `https://world.openfoodfacts.org/api/v2/product/{ean}.json?fields=product_name,brands,nutriments,serving_quantity,serving_size,quantity`
  (`energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`, `fiber_100g`), 4) brak → `dietProd` z wpisanym kodem.
- Znaleziony produkt → `dietQty`; po dodaniu trafia do `mine` (`src:'scan'`, `ean`) i – jeśli nie ma go we wspólnej bazie – do `foods/{ean}`.
- Wspólna baza `foods/{ean}`: `{n, brand, u, k, b, w, t, f, pg, po, q:nazwa bez polskich znaków małymi literami, src:'off'|'user', at}` –
  **bez** informacji, kto dodał. Reguły: `get` dla każdego; `list` z limitem ≤ 30 (wyszukiwanie po prefiksie `q`);
  tylko `create` (bez update/delete), id = 8–14 cyfr, walidacja pól i zakresów jak w części 1, `signedIn()`.
- Wyszukiwarka w `dietAdd` pokazuje też pasujące produkty ze wspólnej bazy (zapytanie po prefiksie, z opóźnieniem po wpisywaniu).
- Atrybucja: przy produktach z OFF dopisek „Dane: Open Food Facts (ODbL)”; to samo w ustawieniach.
- Service worker (`build_web.py`): nie zapisuje odpowiedzi z openfoodfacts.org w pamięci podręcznej.
- Kamery i OFF nie da się sprawdzić z sesji (proxy) – test odczytu na wygenerowanych obrazkach kodów, resztę testuje Kamil na telefonie.

### Stan części 2 (zbudowane, listopad 2026)
- Kod: `app.html`, sekcja „wspólna baza (foods/{ean}), Open Food Facts i skaner”: `sharedGet/sharedPut/sharedSearch`, `offGet/offToProd`, `loadZX/zxDecoder`,
  `scanStart/scanStop/scanLookup/scanResolve`, `SHEETS.dietScan`, `dryHint`. Kolejność szukania kodu: Moje (`ean`/id) → `foods/{ean}` → OFF → ręczny `dietProd`.
- Kod 12-cyfrowy (UPC-A) zapisujemy jako 13 cyfr z zerem z przodu. Ręcznie wpisany kod sprawdzamy cyfrą kontrolną, odczyt z aparatu tylko długością.
- Produkt z OFF ma w `mine` pole `off:true` (atrybucja „Dane: Open Food Facts (ODbL)” w `dietQty`/`dietProd` i w ustawieniach). Id zeskanowanego produktu = ean.
- Do `foods/` trafia produkt przy pierwszym dodaniu do posiłku (`SHARED_NEW`): `src:'off'` (nietknięte dane OFF) albo `src:'user'` (wpisane ręcznie). Poprawka produktu
  z OFF w `dietProd` jest osobista i nie jest wysyłana. Reguły tylko `create`, więc zła wartość we wspólnej bazie zostaje do ręcznej poprawki w konsoli Firebase.
- Podpowiedź „waż przed gotowaniem”: dopasowanie po nazwie (`DRY_RE`, wyjątki `DRY_NOT`), bo zeskanowany produkt nie ma kategorii.
- Biblioteka ZXing 0.21.3 z jsdelivr, bez SRI (nie dało się policzyć skrótu bez dostępu do CDN); service worker trzyma ją w cache `libs`, a OFF pomija.
- **Niesprawdzone w sesji:** prawdziwy odczyt kodu przez ZXing i kamera na iPhonie (Safari i ekran główny) – test z atrapą ZXing sprawdził tylko resztę przepływu.

## CZĘŚĆ 2b – weryfikacja danych zeskanowanych produktów (plan z listopada 2026, budowa w osobnym czacie)

### Problem
Dane produktu z Open Food Facts (OFF) i ze wspólnej bazy `foods/` czasem różnią się od etykiety (nazwa, drobne różnice w wartościach).
Poprawka w „Edytuj produkt” jest dziś tylko osobista, a reguły `foods/` pozwalają tylko na `create`, więc błąd zostaje we wspólnej bazie na zawsze.

### Ustalenia z przeglądu źródeł (listopad 2026)
Aplikacja działa w całości w przeglądarce (bez serwera), więc źródło musi działać z CORS i bez tajnego klucza (klucz w stronie widzi każdy).
- **Open Food Facts** – jedyne sensowne źródło polskich EAN: bez klucza, ODbL (atrybucja + wspólna baza pochodna też na ODbL),
  limit odczytu produktu na IP (dokumentacja podaje obecnie 15/min, starsze źródła 100/min; przy aplikacji na telefonach limit liczy się na użytkownika).
  Wysyłanie poprawek do OFF wymaga konta (login i hasło w żądaniu) – nie da się tego zrobić bezpiecznie z publicznej strony. **Odrzucone.**
- **USDA FoodData Central** – CC0, darmowy klucz (1000 zapytań/h na klucz; klucz w stronie byłby wspólny dla wszystkich), produkty markowe z rynku USA –
  brak potwierdzenia pokrycia polskich EAN. **Odrzucone.**
- **FatSecret** – ma dane polskie (fatsecret.pl), ale darmowy pakiet obejmuje zbiór USA, a tokeny OAuth 2.0 trzeba pobierać przez własny serwer pośredniczący
  (brak CORS, lista IP). **Odrzucone.**
- **Edamam, Nutritionix** – klucz API (w stronie byłby jawny), plany płatne lub darmowe z małym limitem, nacisk na rynek USA. **Odrzucone.**
- **GS1 eProdukty / Verified by GS1** – wiarygodne nazwy i producenci, ale bez publicznego API z wartościami odżywczymi dla przeglądarki. **Odrzucone.**
- Pośrednicy oparci na OFF (np. DietlyAPI) nie są niezależnym źródłem kontrolnym.
- **Niepotwierdzone:** aktualna liczba polskich produktów w OFF (ok. 18 tys. w 2024 r., strona statystyk blokuje boty), obsługa CORS w USDA i Edamam,
  aktualne darmowe limity Nutritionix i Edamam.
- Wniosek: drugie źródło kontrolne nie wchodzi w grę – weryfikacja przez **potwierdzenia użytkowników** we własnej bazie Firebase.

### Rozważone warianty
- **A. Porównanie i ostrzeżenie (tylko lokalnie)** – `dietQty` pokazuje różnice między „Moimi produktami” a `foods/` i pozwala przejąć wspólne wartości.
  Bez zmian w regułach, mały koszt, zero ryzyka dla prywatności, ale wspólna baza nadal się nie poprawia.
- **B. Awans poprawki po zgodności kilku osób (wybrany, razem z A)** – poprawka zgłaszana anonimowo; gdy tę samą wersję potwierdzą 3 osoby
  (i ma więcej głosów niż obecna), zastępuje dane w `foods/{ean}`. Średni koszt (ok. 200–250 linii JS + ok. 50 linii reguł).
  Ryzyka: logowanie anonimowe = jedno urządzenie to jeden głos (dwa telefony jednej osoby to dwa głosy, wyczyszczenie danych daje nowy głos);
  przy małej liczbie użytkowników próg może długo nie zostać osiągnięty; reguły są bardziej złożone (do przeglądu przez Opus).
- **C. Druga baza jako źródło kontrolne** – odrzucone (patrz wyżej: brak polskich danych, klucz jawny w stronie, potrzebny serwer).

### Zasady (wariant B + A)
- Dwa rodzaje poprawki, głosowane osobno: **`w`** – wartości (`u, k, b, w, t, f, pg, po`) i **`n`** – nazwa z marką (`n, brand`).
- Jedno urządzenie (anonimowy `uid`) = jeden głos na rodzaj na produkt; głosu nie można zmienić ani cofnąć (świadome uproszczenie).
- Próg awansu `FIX_MIN = 3` (stała w `app.html` i w `firestore.rules` – zmieniać razem). Awans tylko, gdy grupa ma ≥ 3 głosy **i** więcej głosów
  niż wersja obecna (`cw`/`cn` w `foods/{ean}`, domyślnie 1 – pierwszy dodający).
- Nikt nie widzi, kto głosował: głosy są nieczytelne dla innych (tylko własny `get`, bez `list`), grupy i produkt mają tylko liczniki.
- Nie ma głosów „przeciw” – „Ukryj” chowa zgłoszenie tylko na tym urządzeniu.
- Poprawki nie są wysyłane do OFF. Produkt z OFF po awansie ma dopisek „Dane: Open Food Facts (ODbL), poprawione przez użytkowników”.
- Porównanie „takie samo” po zaokrągleniu: kcal i porcja do 1, makro do 0,1, nazwa i marka przez `phraseKey` (bez polskich znaków i wielkości liter).

### Zmiany w danych (Firebase)
- `foods/{ean}` – nowe **opcjonalne** pola (stare dokumenty bez nich są ważne): `fw`/`fn` – klucz grupy, z której przyszły obecne wartości/nazwa,
  `cw`/`cn` – liczba głosów tej grupy (int 1–1000). Przy awansie zmienia się też `at` (`Date.now()`), a przy awansie nazwy – `q`.
- `foods/{ean}/fix/{key}` – grupa zgłoszeń jednej wersji. `key` = `w_` albo `n_` + 12 znaków hex SHA-256 (`crypto.subtle`) z postaci kanonicznej
  (w: zaokrąglone wartości jako JSON w stałej kolejności; n: `phraseKey(n) + '|' + phraseKey(brand)`).
  Dane: rodzaj w → `{u, k, b, w, t, f, pg, po, c, at}`, rodzaj n → `{n, brand, c, at}` (`c` – liczba głosów). Zapisane wartości pochodzą od pierwszego zgłaszającego.
- `foods/{ean}/v/{vid}` – głos; `vid` = `w_` albo `n_` + `uid`, dane tylko `{g: key}` (klucz grupy tego samego rodzaju).

### Reguły (`firestore.rules`)
- `validFood`: `hasOnly` rozszerzone o `fw, fn, cw, cn` (`hasAll` bez zmian); gdy są: `fw`/`fn` pasują do `^[wn]_[0-9a-f]{12}$`, `cw`/`cn` int 1–1000.
- `match /foods/{ean}/v/{vid}`: `get` tylko gdy `vid == vid[0:2] + request.auth.uid` (własny głos), `list/update/delete` – nie;
  `create`: `signedIn()`, `vid.matches('^[wn]_')`, `vid[2:] == request.auth.uid`, dane `hasOnly/hasAll(['g'])`, `g` zgodne ze wzorem i tego samego rodzaju co `vid`.
- `match /foods/{ean}/fix/{key}`: `get` każdy, `list` z `limit ≤ 10`, `delete` – nie.
  Funkcja `voteNew(ean, key)`: `v = .../foods/$(ean)/v/$(key[0:2] + request.auth.uid)`; `!exists(v) && existsAfter(v) && getAfter(v).data.g == key`.
  `create`: `signedIn()`, `exists(foods/$(ean))`, klucz pasuje do wzoru, `validFix` (te same zakresy co `validFood` dla danego rodzaju, `c == 1`, `at is int`), `voteNew`.
  `update`: `affectedKeys().hasOnly(['c', 'at'])`, `c == resource.data.c + 1`, `voteNew`.
- `foods/{ean}` – `allow update: if signedIn() && validFood(nowe) && (awansW || awansN)`:
  - awansW: zmienione pola tylko z `k, b, w, t, f, u, pg, po, fw, cw, at`; `g = getAfter(.../fix/$(nowe.fw))`; `g.data.c >= 3`;
    `g.data.c > resource.data.get('cw', 1)`; `nowe.cw == g.data.c`; każde z 8 pól wartości równe polu w `g.data`.
  - awansN: zmienione pola tylko z `n, brand, q, fn, cn, at`; analogicznie z `fn`, `cn` i polami `n`, `brand`.
  - `delete` nadal zabronione. Wywołań `get/exists` w jednej transakcji ≤ 7 (limit Firestore 20).
- Do sprawdzenia przy budowie: wycinanie napisów `key[0:2]` w regułach i `getAfter` w transakcji. Wynik wdrożenia: `gh run list -R Kiwwi0/dziennik-silowni -w rules.yml -L 1`.

### Kod (`app.html`, sekcja wspólnej bazy)
- `FIX_MIN = 3`, `fixCanon(kind, p)`, `fixKey(kind, p)` (async, SHA-256), `fixDiff(a, b)` → lista różnic `{pole, moje, wspólne}`.
- `fixLoad(ean)` – przy otwarciu `dietQty` produktu z `ean` (gdy `sharedOn()`): `sharedGet(ean)`, lista `fix` (limit 10) i własne głosy (2× `get`);
  wynik w pamięci `FIXC` (Map ean → {shared, groups, voted:{w,n}}), bez ponownych odczytów w tej samej sesji poza odświeżeniem po głosie.
- `fixVote(ean, kind, p)` – `runTransaction` (dodaj do importów Firebase, jeśli go nie ma): odczyt `foods/{ean}`, `fix/{key}`, własnego głosu;
  gdy głos już jest → toast „To urządzenie już zgłosiło poprawkę tego produktu”; inaczej zapis głosu, `fix` (create `c:1` albo update `c+1`)
  i – gdy nowe `c ≥ FIX_MIN`, `c > (cw|cn || 1)` i wersja różni się od obecnej – aktualizacja `foods/{ean}`. Potem `sharedCache.clear()`, toast
  „Zgłoszono anonimowo (2 z 3)” albo „Wspólna baza poprawiona”. Brak `foods/{ean}` → jak dziś `sharedPut` (create), bez głosowania.
- `dpSave` (edycja produktu z `ean`, Firebase włączony): pole wyboru **„Zgłoś poprawkę do wspólnej bazy (anonimowo)”**, domyślnie zaznaczone;
  po zapisie osobistym `fixVote` dla rodzajów, które różnią się od `foods/{ean}`. Zapis osobisty działa jak dziś niezależnie od wyniku głosu.
- Gdy wersja we wspólnej bazie zmieni się, kopia w „Moich produktach” **nie** jest nadpisywana sama – tylko przyciskiem „Użyj wspólnych”.
- Ukryte zgłoszenia: localStorage `lsKey('fixHide')` (zbiór `ean:key`).

### Wygląd w arkuszach
- **`dietQty`** (produkt z `ean`, Firebase włączony), pod makro mała karta „Wspólna baza” (istniejące klasy kart, kolory ze zmiennych, oba motywy, bez czerwieni):
  1. Moja kopia różni się od `foods/`: „Twoje dane różnią się od wspólnej bazy” + różnice w jednej, dwóch linijkach (np. „kcal 352 · wspólna 340”, „nazwa: …”);
     przyciski „Użyj wspólnych” (nadpisuje w mojej kopii tylko różniące się pola, zostają ★, `uses`, `last`) i „Zgłoś moje” (ukryty, gdy ten rodzaj już zgłoszony).
  2. Jest zgłoszenie (grupa różna od `foods/`, nieukryta, bez mojego głosu): „Zgłoszona poprawka · 1 z 3 potwierdzeń” + wartości w skrócie
     („352 kcal · B 12,5 · W 60,1 · T 6”) albo nowa nazwa; przyciski „Zgodne z moją etykietą” i „Ukryj”. Najwyżej jedna grupa na rodzaj (z największym `c`).
  3. Brak różnic i zgłoszeń → karty nie ma. Ładowanie nie blokuje dodawania (karta dorysowuje się po `fixLoad`); offline → karty nie ma.
- **`dietProd`** (edycja produktu z `ean`): pole wyboru opisane wyżej, pod nim drobny opis „Zmieni wspólną bazę, gdy tę samą poprawkę potwierdzą 3 osoby”.
- Atrybucja: „Dane: Open Food Facts (ODbL), poprawione przez użytkowników”, gdy produkt ma `fw` albo `fn`.
- Szerokość 390 i 360 px bez przewijania w bok; przyciski w karcie mogą zawijać się do dwóch linii.

### Test części 2b
- Wersja testowa (`build.py`) z atrapą Firebase w Playwright (w pamięci: `getDoc`, `setDoc`, `getDocs`, `runTransaction`, prosta symulacja reguł
  w atrapie: brak `update` bez głosu, jeden głos na `uid`), 390×844 i 360 px, jasny i ciemny, brak `pageerror`, brak przewijania w bok.
- Scenariusz: produkt w `foods/` → urządzenie 1 (uid1) poprawia kcal w `dietProd` → grupa `c:1`, `foods/` bez zmian → uid1 drugi raz – odmowa →
  uid2 widzi „1 z 3”, „Zgodne z moją etykietą” → `c:2` → uid3 potwierdza → `foods/` ma nowe wartości, `fw`, `cw:3` → uid4 z kopią starych wartości
  widzi różnicę i „Użyj wspólnych” → kopia zgodna. Osobno: zmiana nazwy (rodzaj `n`), „Ukryj”, brak karty offline i w trybie lokalnym.
- Reguły: wdrożenie przez workflow + `gh run list`; prawdziwy przepływ (trzy urządzenia, np. iPhone Kamila, Windows i telefon Marty) sprawdza Kamil.
- Zrzuty tylko na końcu: `dietQty` z kartą (oba przypadki) i `dietProd` z polem wyboru, oba motywy. Po budowie przegląd zmian przez Opus w krótkim czacie
  (`git diff`, szczególnie `firestore.rules`).

### Stan części 2b (zbudowane, 9.11.2026)
- **Reguły (`firestore.rules`):** `validFood` rozszerzone o opcjonalne `fw/fn/cw/cn` (fw ↔ `^w_[0-9a-f]{12}$`, fn ↔ `^n_…`, cw/cn int 1–1000); `create` w `foods/`
  odrzuca te pola (ustawia je tylko awans). `update` w `foods/{ean}` tylko jako awans: `promoW` / `promoN` (zmienione pola z listy, `getAfter` grupy `fix`,
  `c >= 3`, `c > cw|cn` (domyślnie 1), `cw|cn == c`, pola równe polom grupy). Nowe: `foods/{ean}/v/{vid}` (`get` tylko własny, `create` bez zmian i usuwania, `{g}`),
  `foods/{ean}/fix/{key}` (`get` każdy, `list` z limitem ≤ 10, `create` z `validFix` + `voteNew`, `update` tylko `c`+1 i `at`). Funkcje: `voteNew`, `numOk`, `validFix`, `promoW`, `promoN`.
  **Odstępstwo od planu:** zamiast wycinania `key[0:2]` rodzaj bierze `key.split('_')[0]`, a własny głos to `$(rodzaj + '_' + request.auth.uid)` w ścieżce
  (nie wiadomo, czy reguły obsługują wycinanie napisów i doklejanie do ścieżek, a w sesji nie ma emulatora). **Wdrożenie reguł 9.11.2026: kompilacja i wgranie przeszły (`rules.yml` – success).**
- **Kod (`app.html`, sekcja „weryfikacja danych zeskanowanych produktów (część 2b)”, przed `DRY_RE`):** `FIX_MIN`, `FIXC`, `fixVal/fixCanon/fixKey/fixData/fixDiff`,
  `fixLoad` (1× `getDoc` produktu, lista `fix` z limitem 10, 2× własny głos; odpowiedź z pamięci podręcznej = „nie wiadomo” → brak karty), `fixVote` (`runTransaction`:
  głos + `fix` create/update + ewentualny awans `foods/`), `fixToast`, `fixReport`, `fixAuto` (po zapisie w `dietProd`), `fixCardHTML`/`fixPaint`.
  ACT: `fixUse`, `fixMine`, `fixConfirm`, `fixHide`; BIND `dpRep`. Produkt ma pole `fx` (wspólna baza poprawiona przez użytkowników; `cleanProd`, `fromShared`) –
  stąd dopisek „Dane: Open Food Facts (ODbL), poprawione przez użytkowników” w `dietQty` i `dietProd`. Ukryte zgłoszenia: `lsKey('fixHide')` (do 200 wpisów `ean:key`).
- **Wygląd:** w `dietQty` pod nagłówkiem `#dq-fix` (ukryty, gdy pusty): karta „Twoje dane różnią się od wspólnej bazy” (do 5 różnic, „Użyj wspólnych”, „Zgłoś moje”)
  i karta „Zgłoszona poprawka · N z 3 potwierdzeń” („Zgodne z moją etykietą”, „Ukryj”); „Użyj wspólnych” zmienia w kopii tylko różniące się rodzaje (wartości i/lub nazwę),
  zostają ★, `uses`, `last`. „Zgłoś moje” znika, gdy rodzaj już zgłoszony albo gdy zgłoszenie takie jak moje jest widoczne niżej. W `dietProd` (edycja produktu z `ean`,
  Firebase włączony) pole „Zgłoś poprawkę do wspólnej bazy (anonimowo)”, domyślnie zaznaczone (`s.fixEan`, `s.rep`).
- **Test (wersja testowa + atrapa Firebase w Playwright, symulacja reguł jak w `firestore.rules`):** 390×844 i 360×780, jasny i ciemny – bez `pageerror`, bez przewijania w bok.
  Scenariusz z planu przeszedł: u1 poprawia kcal → grupa c:1, `foods/` bez zmian → drugi głos u1 odrzucony → u2 widzi „1 z 3” → 2 → u3 potwierdza → `foods/` ma nowe wartości,
  `fw`, `cw:3` → u4 ze starą kopią widzi różnicę i „Użyj wspólnych”; osobno rodzaj `n` (awans nazwy, `q` przeliczone, wartości bez zmian), „Ukryj”, brak karty offline
  i w trybie lokalnym, odznaczone pole = brak zgłoszenia, `update` `foods/` bez awansu odrzucony w atrapie.
- **Niesprawdzone w sesji:** prawdziwe reguły Firestore (atrapa to moje lustro reguł, nie emulator – składnia przeszła kompilację przy wdrożeniu, ale zachowanie reguł na prawdziwych danych sprawdzi dopiero głosowanie z urządzeń), prawdziwe głosowanie z trzech
  urządzeń (iPhone Kamila, Windows, telefon Marty) i `crypto.subtle` na iPhonie (wymaga https – strona jest na https). Nie zrobiono jeszcze przeglądu `git diff` przez Opus (szczególnie `firestore.rules`).

## CZĘŚĆ 3 – dodatki do diety (plan ustalony z Kamilem 9.11.2026, budowa w osobnych czatach)
Pięć etapów, **w tej kolejności, każdy osobno**: zbudować → przetestować → wdrożyć → dopisać „Stan etapu 3.x (zbudowane)” pod jego planem.
Zasady wspólne:
- Wszystkie nowe dane osoby idą do dokumentu `folders/{fid}/data/diet` jako **osobne pola** (zapis `setDoc(…, {merge:true})` tylko
  zmienionych pól, usuwanie `deleteField()`, kolejka zmian oczekujących nakładana na snapshot – dokładnie jak `mine`/`goals`).
  Reguły Firebase się nie zmieniają (dokument `diet` jest już dozwolony). localStorage: ten sam `lsKey('diet')`.
- `normalize` diety: brakujące nowe pola = wartości domyślne; stary dokument działa bez zmian.
- Kopia zapasowa: nowe pola są w `diet`; import **dopisuje** (przy tym samym kluczu wygrywa obecna wartość), profil i cele treningowe
  zastępowane tylko, gdy kopia je ma.
- Wygląd: istniejące klasy (karty, `row`, `btn`, `iconbtn`, paski, `chartCard`/`drawChart` z historii), kolory ze zmiennych CSS, oba motywy.
- Test każdego etapu: wersja testowa (`build.py`), 390×844 **i 360×780**, jasny i ciemny, brak `pageerror`, brak przewijania w bok,
  odświeżenie strony (dane zostają), pozostałe zakładki bez zmian. Zrzuty tylko na końcu.
- Nie ruszać zachowania trwających funkcji diety (części 1, 2, 2b) poza opisanymi miejscami.

### Etap 3.1 – masa ciała (zakładka Historia)
**Dane:** pole `wt` w dokumencie diety: `{'RRRR-MM-DD': kg}` (mapa; w bazie zapis zagnieżdżony `{wt:{[dzień]:kg}}` z merge,
usunięcie `{wt:{[dzień]:deleteField()}}`). W pamięci `DIET.wt`. Kg 30–300, krok 0,1 (zaokrąglenie do 0,1). Jeden pomiar na dzień
(nowy wpis tego dnia zastępuje stary). Brak limitu dni (to małe liczby), ale bez okna 60 dni – całe pole.
**Liczenie:** `wtAvg7(day)` = średnia pomiarów z 7 dni kończących się na `day` (tylko dni z pomiarem; brak → null).
Trend: różnica średniej 7-dniowej dziś i 7 dni temu (kg/tydz.), pokazywana, gdy obie istnieją.
**Wygląd:** w `vHistory` nowa karta **„Masa ciała”** (pod istniejącymi wykresami treningowymi, przed kalendarzem):
- góra: ostatni pomiar (kg, data), średnia 7-dniowa, trend „−0,4 kg/tydz.” (bez kolorów ocen),
- wykres: kropki = pomiary, linia = średnia 7-dniowa; przełącznik zakresu 30 / 90 dni / wszystko (wzorem `CHARTS`/`drawChart`),
- przycisk „+ Waga” → arkusz `wtAdd`: data (domyślnie dziś, `input type=date`, nie później niż dziś), pole kg (`inputmode=decimal`,
  podpowiedź = ostatni pomiar), „Zapisz”; gdy na ten dzień jest pomiar – „Usuń”,
- stuknięcie „Pomiary” → lista ostatnich pomiarów (data, kg), stuknięcie = edycja w `wtAdd`.
- Brak pomiarów → karta z krótkim tekstem „Waż się rano, po toalecie – średnia z tygodnia pokaże trend” i przyciskiem „+ Waga”.
- Bez dostępu do diety (`dietCanEdit` = false) przycisk dodawania nieaktywny.
**Test:** dodaj 10 pomiarów na różne dni (przez `wtAdd` i bezpośrednio w `DIET.wt` + `render()`), sprawdź średnią 7-dniową
na znanych liczbach, edycję, usunięcie, zakresy wykresu, odświeżenie.

#### Stan etapu 3.1 (zbudowane, 9.11.2026)
- **Dane:** `DIET.wt` (`cleanWt` w `normalizeDiet`: dni `RRRR-MM-DD`, 30–300 kg, zaokrąglenie 0,1; stary dokument → `{}`), stałe `WT_MIN/WT_MAX`.
  Kolejka `wtPut`/`wtDel` (dni); `persistDiet(put, del, goals, meals, wp, wd)` – dwa nowe parametry; `flushDiet` wysyła
  `{wt:{[dzień]:kg | deleteField()}}` z merge (stary format v:1 – cały `wt` w pełnym zapisie), przy błędzie dni wracają do kolejki;
  snapshot nakłada oczekujące dni, podpis porównania zawiera `wt`; `dietOpen`/`dietClose` czyszczą kolejkę.
  `dietRefresh` odświeża też zakładkę Historia, a pierwsze wczytanie diety z bazy przerysowuje Historię (włącza przycisk „Waga”).
- **Import kopii:** brakujące dni pomiarów dochodzą, istniejące zostają (tekst potwierdzenia uzupełniony). Eksport – `wt` jest w `diet`.
- **Liczenie:** `wtAvg7(day)`, `wtTrend(day)` (dziś vs 7 dni temu), `wtDays()`, `fmtKg` (zawsze 1 miejsce po przecinku, minus „−”).
- **Wygląd:** `wtCard()` w `vHistory`, widok „Treningi”: nad kalendarzem (wykresy treningowe są w „Postępach”, więc karta stoi
  na górze „Treningów”); przy braku treningów – pod komunikatem „Jeszcze pusto”. Kafelki „Ostatni · data” i „Średnia 7 dni”,
  linia trendu, przełącznik `ui.wtRange` (30 / 90 dni / wszystko, ACT `wtRange`), wykres `drawWt` (wywoływany z `drawChart`
  dla `type:'wt'`; oś X według dat, kropki = pomiary, linia = średnia 7 dni, podpowiedź po dotknięciu), przycisk „Pomiary · N”.
  Klasy CSS `.wt-card`, `.wt-h`, `.wt-tr`, `.wt-f`, `.wt-row`. `dietReady()` – stan przycisku bez komunikatu.
- **Arkusze:** `SHEETS.wtAdd` (data `type=date` z `max` = dziś, kg z podpowiedzią ostatniego pomiaru, napis o zastąpieniu
  istniejącego pomiaru i „Usuń” odświeżane przez `wtHint()` po zmianie daty), `SHEETS.wtList` (do 120 ostatnich, różnica do
  poprzedniego pomiaru, stuknięcie = edycja). ACT `wtAdd` (`data-d` = dzień), `wtSave`, `wtDel` (z potwierdzeniem), `wtList`; BIND `wtf`.
  Kod arkuszy i akcji jest przed `route()` na końcu skryptu.
- **Test (wersja testowa):** 390×844 i 360×780, jasny i ciemny – bez `pageerror`, bez przewijania w bok; średnia 7 dni na znanych
  liczbach (80,317 / 81,0 → trend −0,7), walidacja (20 kg, data jutro), edycja z listy, usunięcie, zakresy, odświeżenie strony,
  karta z treningami nad kalendarzem. Zapis do Firebase niesprawdzony na żywo (strona nieosiągalna z sesji) – do sprawdzenia przez Kamila.

### Etap 3.2 – kalkulator zapotrzebowania (arkusz celów)
**Dane:** pole `prof` w dokumencie diety: `{sex:'m'|'k', by:rok urodzenia, h:wzrost cm, pal:1.2|1.375|1.55|1.725|1.9, goal:'red'|'utr'|'masa'}`
(zapisywane jako całe pole – małe). Limity: wzrost 120–230, rok urodzenia: wiek 14–100.
**Wzory (z podanymi źródłami w arkuszu, drobnym tekstem):**
- BMR Mifflin-St Jeor (1990): `10·kg + 6,25·cm − 5·wiek + 5` (m) / `− 161` (k). Waga = `wtAvg7(dziś)`, a gdy brak – ostatni pomiar;
  brak pomiarów → pole „Waga (kg)” w arkuszu (zapisuje pomiar na dziś do `wt`).
- Zapotrzebowanie TDEE = BMR × PAL. Opisy PAL: 1,2 „praca siedząca, bez treningów”, 1,375 „1–3 treningi/tydz.”, 1,55 „3–5 treningów”,
  1,725 „6–7 treningów lub praca fizyczna”, 1,9 „bardzo ciężka praca + treningi”.
- Cel kcal: redukcja = TDEE × 0,80; utrzymanie = TDEE; masa = TDEE × 1,10 (lekka nadwyżka ogranicza przyrost tłuszczu). Zaokrąglić do 10 kcal.
  Nigdy mniej niż BMR (wtedy cel = BMR i dopisek „Nie schodź poniżej podstawowej przemiany materii”).
- Białko (Morton i in. 2018 – meta-analiza, ISSN 2017; przy deficycie wyżej – Helms i in. 2014): redukcja **2,2 g/kg**, utrzymanie i masa **1,8 g/kg**.
  Przy BMI ≥ 30 liczyć od masy odpowiadającej BMI 25 dla wzrostu (inaczej białko wychodzi zawyżone).
- Tłuszcz: **25% kcal** (zalecany zakres 20–35%), ale nie mniej niż **0,6 g/kg**.
- Węglowodany: reszta kcal ÷ 4. Gdy wyjdzie < 50 g – ostrzeżenie zamiast cichego wyniku.
- Gramy zaokrąglone do 5 g.
**Wygląd:** w `dietGoals` przycisk „Oblicz z kalkulatora” → arkusz `dietCalc`: płeć (chipy), rok urodzenia, wzrost, waga (tylko informacja
„z średniej 7 dni: 82,4 kg” albo pole), aktywność (lista z opisami), cel (chipy Redukcja / Utrzymanie / Masa). Wynik na żywo:
BMR, TDEE, cel kcal, B/W/T w g i % kcal. Przycisk **„Ustaw jako cele”** → zapisuje `goals` (i `prof`), wraca do `dietGoals`
z wypełnionymi polami; „Anuluj” nic nie zmienia poza `prof`. Pod wynikiem: „To punkt startu – po 2–3 tygodniach skoryguj o trend wagi.”
**Test:** m, rok 1990 (wiek 36 w 2026), 180 cm, 80 kg, PAL 1,55, utrzymanie: BMR 1750, TDEE 2712,5 → 2710 kcal, B 144 → 145 g,
T 75 g (25%, ≥ 48 g), W = (2710 − 145·4 − 75·9)/4 = 363,75 → 365 g (węgle liczone z zaokrąglonych B i T). Redukcja i BMI ≥ 30 – osobny przypadek. Zapis celów.

#### Stan etapu 3.2 (zbudowane, 9.11.2026)
- **Dane:** `DIET.prof` (`cleanProf` w `normalizeDiet`: `sex`, `by` – wiek 14–100, `h` 120–230, `pal` z `PALS`, `goal` z `PROF_GOALS`; brakujące pola = `null`,
  zupełnie puste = `null`; stary dokument → `null`). Zapis całego pola: flaga `dietProfDirty`, `persistDiet(put, del, goals, meals, wp, wd, prof)` –
  nowy 7. parametr; `flushDiet` wysyła `prof` z merge (stary format v:1 – w pełnym zapisie), przy błędzie wraca do kolejki; snapshot nakłada
  oczekujący profil, podpis porównania zawiera `prof`; `dietOpen`/`dietClose` czyszczą flagę. Import kopii: profil zastępowany tylko, gdy kopia go ma.
- **Liczenie:** `calcNeeds(p, kg)` (BMR Mifflin-St Jeor, TDEE, cel kcal ×0,8/×1/×1,1 do 10 kcal, nie mniej niż BMR (`floored`), białko 2,2/1,8 g/kg
  – przy BMI ≥ 30 od masy dla BMI 25 (`high`, `ref`), tłuszcz 25% kcal i min. 0,6 g/kg, węgle = reszta z zaokrąglonych B i T; gramy do 5 g),
  `calcRead(s)` (walidacja pól → `{p, kg}` albo `{err}`), `calcWeight()` (średnia 7 dni z dziś → ostatni pomiar → brak = pole w arkuszu).
- **Wygląd:** w `SHEETS.dietGoals` na górze przycisk „Oblicz z kalkulatora” (ACT `dietCalc`) → `SHEETS.dietCalc`: chipy płci i celu, rok urodzenia, wzrost,
  masa (informacja albo pole), lista aktywności `.dc-pal` z opisami; wynik na żywo w `#dc-out` (`calcOut`, bez przerysowywania arkusza): BMR, TDEE,
  cel kcal, B/W/T w g i % kcal, ostrzeżenia (podłoga BMR, BMI ≥ 30, węgle < 50 g), tekst „punkt startu”, drobne źródła. ACT `dietCalc`, `dcSet`, `dcApply`; BIND `dc`.
  „Ustaw jako cele” zapisuje `goals` + `prof` (masa z pola → pomiar na dziś w `wt`), wraca do `dietGoals` z wypełnionymi polami. „Anuluj”/X/tło
  zapisują tylko profil (`calcSaveProf` w `closeSheet`), cele bez zmian. Klasy CSS `.dc-pal`, `.dc-out`, `.dc-mac`, `.dc-src`. Kod przed arkuszami masy ciała.
- **Test (wersja testowa):** 390×844 i 360×780, jasny i ciemny – bez `pageerror`, bez przewijania w bok; przypadek z planu (m, 1990, 180 cm, 80 kg, PAL 1,55,
  utrzymanie: BMR 1750, TDEE 2712,5, 2710 kcal, B 145, T 75, W 365), redukcja (2170 kcal, B 175, T 60, W 235), BMI ≥ 30 (B 145 z masy 81 kg), podłoga BMR,
  walidacja roku i wzrostu, „Anuluj” zapisuje tylko profil, „Ustaw jako cele” wypełnia pola celów, masa z pola → pomiar, odświeżenie (profil i cele zostają),
  zakładki bez zmian. Zapis `prof` do Firebase niesprawdzony na żywo (strona nieosiągalna z sesji) – do sprawdzenia przez Kamila.

### Etap 3.3 – inne cele w dni treningowe
**Dane:** pole `goalsT:{k,b,w,t}` w dokumencie diety (każde makro osobnym polem, jak `goals`; puste = `null`).
W dniu: pole `tr` w dokumencie dnia `folders/{fid}/diet/{dzień}`: `true` / `false` = ręcznie ustawione, brak pola = automatycznie
(`deleteField()` przy powrocie do automatu). localStorage: w obiekcie dnia.
**Dzień treningowy:** `isTrainDay(day)` = `DAYS[day].tr`, jeśli ustawione; inaczej czy w `SESS` jest zapisany trening z tą datą
(sprawdź, które pole daty ma sesja, i użyj `dayKey`). Trwający trening (`ACTIVE`) dzisiaj też się liczy.
`goalsFor(day)` = dzień treningowy i `goalsT` ma jakąkolwiek wartość → `goalsT` (brakujące makro z `goals`), inaczej `goals`.
Wszystkie miejsca pokazujące cel dnia (karta podsumowania, paski) używają `goalsFor(dzień)`.
**Wygląd:**
- W `dietGoals` dwie zakładki-chipy: „Zwykły dzień” / „Dzień treningowy”. Druga pusta = „Jak w zwykły dzień”. Przycisk „Skopiuj ze zwykłego”.
  Kalkulator (3.2) wypełnia tylko aktywną zakładkę.
- Na pasku daty mała plakietka „Trening” / „Odpoczynek”; stuknięcie przełącza po kolei: automatycznie → ręcznie trening → ręcznie odpoczynek
  → automatycznie (toast z opisem stanu). Gdy `goalsT` puste, plakietka i tak widoczna, ale zmiana nie zmienia celów.
**Test:** cele zwykłe 2500, treningowe 2800; dzień z sesją w `SESS` → 2800; przełącznik na odpoczynek → 2500; powrót do auto;
odświeżenie (stan `tr` zostaje); dzień bez `goalsT` → zwykłe cele.

#### Stan etapu 3.3 (zbudowane, 9.11.2026)
- **Dane:** `DIET.goalsT` (`normalizeDiet`: te same limity co `goals`, brak → wszystkie `null`; stary dokument działa bez zmian). Osobna flaga `dietGoalsTDirty`,
  `persistDiet(put, del, goals, meals, wp, wd, prof, goalsT)` – 8. parametr; `flushDiet` wysyła `goalsT` z merge (stary format v:1 – w pełnym zapisie), przy błędzie wraca
  do kolejki; snapshot nakłada oczekujące `goalsT`, podpis porównania je zawiera; `dietOpen`/`dietClose` czyszczą flagę. Dzień: `normalizeDay` zachowuje `tr` (tylko boolean),
  `persistDay(k, put, del, tr)` – 4. parametr (`undefined` bez zmian, `true`/`false` ustaw, `null` → `deleteField()`); `mergeDays` (eksport) przenosi `tr`.
- **Import kopii:** `goalsT` zastępowane tylko, gdy kopia ma jakąkolwiek wartość; `tr` dnia dochodzi tylko, gdy obecny dzień go nie ma (tekst potwierdzenia uzupełniony).
- **Liczenie:** `isTrainDay(k)` (`DAYS[k].tr`, inaczej zapisany trening z `SESS` o tym `dayKey` albo trwający `ACTIVE` dzisiaj w tym folderze), `goalsFor(k)` (dzień treningowy
  i `goalsT` ma wartość → `goalsT`, brakujące makro ze zwykłych celów; inaczej `goals`). Używa go `vDiet` (karta podsumowania i paski) – etapy 3.4+ mają też używać `goalsFor(dzień)`.
- **Wygląd:** w `SHEETS.dietGoals` chipy „Zwykły dzień” / „Dzień treningowy” (`s.tab`, pola `s.f` / `s.fT`, ACT `dgTab`), w drugiej zakładce opis „puste = jak w zwykły dzień”
  i „Skopiuj ze zwykłego” (ACT `dgCopy`); `dgSave` waliduje obie zakładki (błąd przełącza na właściwą), `goalsHint` liczy dla aktywnej. Kalkulator (`dcApply`) wypełnia i zapisuje tylko
  aktywną zakładkę. Plakietka „Trening” / „Odpoczynek” pod datą (`.dt-mid`, `.dt-tr`; obrys przerywany = automatycznie, wypełniona = ręcznie), ACT `dietTr`: automatycznie → ręcznie
  trening → ręcznie odpoczynek → automatycznie, toast opisuje stan (i że `goalsT` jest puste, więc cele bez zmian).
- **Test (wersja testowa):** 390×844 i 360×780, jasny i ciemny – 76 sprawdzeń, bez `pageerror`, bez przewijania w bok (Dieta, arkusz, pozostałe zakładki); cele 2500 / 2800 (B 160),
  dzień bez sesji → 2500, z sesją w `SESS` → 2800, pełny cykl przełącznika, ręczny odpoczynek przy sesji → 2500, odświeżenie (`tr` i cele zostają), wczoraj → zwykłe, brak `goalsT` → zwykłe,
  „Skopiuj ze zwykłego”, kalkulator wypełnia tylko zakładkę treningową (2710 kcal, B 145) i nie rusza zwykłych celów. Zapis `goalsT` i `tr` do Firebase niesprawdzony na żywo
  (strona nieosiągalna z sesji) – do sprawdzenia przez Kamila.

### Etap 3.4 – podsumowanie tygodnia (karta w Diecie)
**Liczenie:** tydzień pon–nd zawierający wybrany dzień (dni przyszłe pomijane). Dni z ≥ 1 wpisem = „dni z wpisami”.
Średnie kcal, B, W, T z dni z wpisami (do 0,1, kcal do całości). Dzień **w celu**: kcal w zakresie ±10% `goalsFor(dzień).k`
(dzień bez celu kcal – nie liczy się ani jako w celu, ani poza). Liczba „dni w celu / dni z wpisami”.
Jeśli są pomiary wagi (3.1) – zmiana średniej 7-dniowej w tym tygodniu.
**Wygląd:** karta **„Tydzień”** pod kartą podsumowania dnia (zwinięta do jednej linii: „Śr. 2410 kcal · 5/6 dni w celu”, stuknięcie rozwija):
7 kropek pon–nd (w celu = kolor akcentu, poza celem = kolor ostrzegawczy, bez wpisów = pusta, przyszłość = wyszarzona; dzień treningowy
z małą kreską pod kropką), stuknięcie kropki przenosi na ten dzień; średnie B/W/T z celami średnimi tygodnia; zmiana wagi.
Stan zwinięcia w `LS` (nie w bazie).
**Test:** wpisy w 4 dniach tygodnia o znanych sumach → średnie i licznik w celu; tydzień przełomu miesiąca; dzień bez wpisów nie zaniża średniej.

#### Stan etapu 3.4 (zbudowane, 9.11.2026)
- **Dane:** brak nowych pól w bazie – wszystko liczone z już wczytanych dni (`DAYS`), celów (`goalsFor`) i wagi (`wtTrend`). Stan zwinięcia karty: `LS` `dz.dtWeek` (domyślnie zwinięta).
- **Liczenie:** `dietWeek(k)` – tydzień pon–nd z dniem `k`; dni przyszłe i starsze niż `dietMinKey()` (niewczytane) pomijane. Średnie z dni z wpisami, kcal do całości, B/W/T do 0,1;
  cele średnie B/W/T = średnia z `goalsFor` tych dni. Dzień „w celu” = kcal w ±10% `goalsFor(dzień).k`; dzień bez celu kcal nie liczy się ani w celu, ani poza,
  więc w „N/M dni w celu” M = dni z wpisami **i** z celem kcal (bez żadnego celu pokazujemy tylko średnią). Zmiana wagi = `wtTrend` ostatniego dnia tygodnia, który już był.
- **Wygląd:** `dietWeekCard(key)` w `vDiet` pod kartą podsumowania dnia; nagłówek „Tydzień · Śr. 2563 kcal · 3/4 dni w celu” (ACT `dietWk` rozwija), rozwinięta: 7 kropek
  (w celu = akcent, poza = ostrzegawcza, bez celu = szara pełna, bez wpisów = pusta, przyszłość = wyszarzona), kreska pod kropką = dzień treningowy, ACT `dietWkDay` przenosi na dzień,
  średnie B/W/T z celami, linia z wagą. CSS `.dt-wk*`.
- **Test (wersja testowa):** 390×844 i 360×780, jasny i ciemny – 64 sprawdzenia, bez `pageerror`, bez przewijania w bok: 4 dni o znanych sumach (2500/2700/2800/2250 → śr. 2563, 3/4 w celu,
  granica ±10% włącznie), dzień bez wpisów nie zaniża średniej, przełom miesiąca (28.09–4.10), brak celu, tydzień bez wpisów, zmiana wagi, odświeżenie (stan zwinięcia zostaje), przyszłe dni wyszarzone.

### Etap 3.5 – kopiowanie i moje gotowe posiłki
(Kamil: kopiowanie całego dnia i posiłku + możliwość zapisania często jedzonego posiłku i dodawania go jednym stuknięciem.)
**Kopiowanie:**
- Nagłówek posiłku: przycisk „⋯” → menu: „Kopiuj na…”, „Zapisz jako gotowy posiłek”.
- Pasek daty / dół zakładki: „Kopiuj dzień na…”.
- Arkusz `dietCopy`: data docelowa (`input type=date`, nie później niż dziś; domyślnie dziś, a gdy źródłem jest dziś – pole puste
  i trzeba wybrać datę; ten sam dzień dozwolony tylko przy kopii posiłku na inny posiłek), przy posiłku także posiłek docelowy (chipy z `MEALS`, domyślnie ten sam). Skróty: „Na dziś”, „Na wczoraj”.
- Kopiowane wpisy **dopisują się** (nic nie jest nadpisywane), dostają nowe `id` (`uid()`) i nowe `o` (z zachowaniem kolejności),
  reszta pól bez zmian (to już kopie wartości). Wpisy z usuniętego posiłku („Inny posiłek”) przy kopii dnia trafiają do pierwszego posiłku z listy.
  Zapis dnia docelowego jak zwykle (merge tylko nowych wpisów). Toast „Skopiowano 5 wpisów” z przyciskiem „Cofnij” (usuwa właśnie dodane).
- Pole `tr` dnia **nie** jest kopiowane.
**Gotowe posiłki:**
- Dane: pole `tpl` w dokumencie diety: `{[id]:{id, n:nazwa, items:[…], uses, last}}`, każdy gotowy posiłek osobnym polem (merge, usunięcie
  `deleteField()`). `items` = kopie wpisów bez `id`/`o`/`m` (`pid, n, g, q, po, pg, u, k, b, w, t`). Id `t-` + `uid()`. Max 50 posiłków,
  30 składników, nazwa do 40 znaków.
- Tworzenie: „Zapisz jako gotowy posiłek” z menu posiłku (nazwa domyślnie „Śniadanie 9.11”, do zmiany) albo w `dietAdd` → „Gotowe” → „Nowy”
  (pusty, składniki dodawane wyszukiwarką jak w `dietAdd`, ilość przez `dietQty` w trybie „do zestawu”).
- `dietAdd`: nowy przełącznik u góry **„Produkty | Gotowe”**. „Gotowe”: lista (sortowanie `uses`/`last`), przy pozycji nazwa, kcal i B,
  liczba składników. Stuknięcie → arkusz `dietTpl`: lista składników, mnożnik (chipy ×0,5 ×1 ×1,5 ×2 + pole), posiłek docelowy,
  sumy na żywo, „Dodaj” (wstawia osobne wpisy przeskalowane: g, q i makro × mnożnik, zaokrąglenia jak w części 1; `uses++`, `last`;
  produkty z `pid` dostają `uses++` w `mine`, jeśli tam są). Także „Edytuj” (nazwa, usuwanie składnika, zmiana ilości) i „Usuń” z potwierdzeniem.
- Wyszukiwanie w `dietAdd` przeszukuje też nazwy gotowych posiłków (sekcja „Gotowe” nad „Moimi produktami”).
**Test:** kopia posiłku wczoraj→dziś, kopia dnia, „Cofnij”; zapisanie posiłku jako gotowego, dodanie ×1,5 (sprawdzić liczby), edycja, usunięcie;
odświeżenie; dzień z „Innym posiłkiem”.

#### Stan etapu 3.5 (zbudowane, 9.11.2026)
- **Dane:** `DIET.tpl` = mapa `{[id]: {id, n, items, uses, last}}` (`cleanTpl` w `normalizeDiet`: id `[A-Za-z0-9_-]` do 60 znaków, nazwa do 40, do 30 składników, do 50 posiłków; `tplItem` = wpis bez `id`/`o`/`m`;
  stary dokument → `{}`). Kolejka `tplPut`/`tplDel`; `persistDiet(put, del, goals, meals, wp, wd, prof, goalsT, tp, td)` – dwa nowe parametry (9. i 10.); `flushDiet` wysyła `tpl:{[id]: gotowy | deleteField()}`
  z merge (lista `items` to tablica, więc zapisuje się w całości; stary format v:1 – cały `tpl` w pełnym zapisie), przy błędzie id wracają do kolejki; snapshot nakłada oczekujące posiłki, podpis porównania zawiera `tpl`;
  `dietOpen`/`dietClose` czyszczą kolejkę. Import kopii: brakujące gotowe posiłki dochodzą (do limitu 50), istniejące zostają (tekst potwierdzenia uzupełniony). Eksport – `tpl` jest w `diet`.
- **Kopiowanie:** w nagłówku posiłku „⋯” (`.dt-more`, tylko gdy są wpisy; także „Inny posiłek”) → `dietMealMenu`: „Kopiuj na…” (`mealCopy` → `dietCopy`) i „Zapisz jako gotowy posiłek” (`mealTpl`). Na dole zakładki „Kopiuj dzień”
  (`dietCopyDay`, tylko gdy dzień ma wpisy). `SHEETS.dietCopy` (`scope:'day'|'meal'`, `copySource`): `input type=date` (max = dziś, min = okno 60 dni w trybie Firebase), skróty „Na dziś” / „Na wczoraj” (`dcDay`), chipy posiłku docelowego (`dcMeal`);
  źródło = dziś → pole puste. `dcGo` waliduje (brak daty, przyszłość, poza oknem, ten sam dzień przy kopii dnia, ten sam dzień i posiłek przy kopii posiłku), dopisuje kopie z nowym `id` (`uid()`) i `o = Date.now()+i`
  (kolejność zachowana), wpisy z usuniętych posiłków trafiają do pierwszego posiłku z listy, `tr` nie jest kopiowane, `persistDay(d, nowe id)`; po kopii widok przechodzi na dzień docelowy.
  Nowy `toastUndo(msg, fn)` (toast z przyciskiem „Cofnij”, 7 s, `ACT.toastUndo`, CSS `#toast.act`, `.toast-btn`) – „Skopiowano 5 wpisów” i „Cofnij” usuwa dokładnie dopisane wpisy (`persistDay(d, [], ids)`).
- **Gotowe posiłki:** `dietAdd` ma przełącznik „Produkty | Gotowe” (`s.tab`, ACT `dtTab`; domyślnie Produkty). „Gotowe”: lista (`tplList`: `uses`, `last`, nazwa; wiersz `tplRow`: nazwa, liczba składników, B, kcal), filtr po nazwie, przycisk
  „Nowy gotowy posiłek” (`tplNew`). W zakładce „Produkty” wpisanie tekstu pokazuje sekcję „Gotowe” (do 10) nad „Moimi produktami”. Stuknięcie → `SHEETS.dietTpl` (`tplOpen`): lista składników przeskalowana na żywo (`tplScale`, `tplOut`), chipy ×0,5 ×1 ×1,5 ×2 (`tplMult`)
  i własny mnożnik 0,1–10 (BIND `tplMult`), chipy posiłku (ponownie użyte `dqMeal`), sumy, „Dodaj” (`tplUse`: osobne wpisy; g, `q`, makro × mnożnik, przy sztukach `g = q × pg`; blokada, gdy ilość wyjdzie poza 0,1–5000 albo `q` < 0,01; `uses++`/`last` gotowego posiłku
  i `uses++` produktów z `pid` obecnych w `mine`), „Edytuj” (`tplEdit`) i „Usuń” z potwierdzeniem (`tplDel`). `SHEETS.dietTplEdit` (szkic w stanie arkusza: `tid`, `n`, `items`): nazwa, składniki z ilością i kcal (stuknięcie = zmiana ilości, X = usunięcie),
  „Dodaj składnik” (`tplItemAdd` → `dietAdd` z `toTpl:true` – bez skanera, szybkiego wpisu i przełącznika, z „Nowy produkt” → `dietQty` z `toTpl:true`: tytuł „Dodaj do zestawu” / „Edytuj składnik”, bez wyboru posiłku i „Usuń”;
  `dqSave` w tym trybie wpisuje składnik do szkicu i wraca do `dietTplEdit`), sumy, „Zapisz” (`tplSave`: nazwa 1–40 znaków, 1–30 składników, do 50 posiłków). „Zapisz jako gotowy posiłek” z menu otwiera ten sam arkusz z wpisami posiłku i nazwą „Śniadanie 9.11”.
  Składniki bez ilości (szybki wpis) są w gotowym posiłku, ale ich ilości nie da się edytować (tylko usunąć); mnożnik skaluje im same makro. CSS `.tp-seg`, `.tp-ing`, `.tp-mult`. Kod arkuszy i akcji jest przed `route()`.
- **Test (wersja testowa):** 390×844 i 360×780, jasny i ciemny – bez `pageerror`, bez przewijania w bok (Dieta, wszystkie nowe arkusze, błędy walidacji, pozostałe zakładki): kopia posiłku wczoraj→dziś (3 wpisy, nowe `id`) i „Cofnij” (źródło bez zmian),
  kopia dnia (kolejność, „Inny posiłek” → Śniadanie, `tr` niekopiowane), walidacje dat i posiłku, zapis gotowego posiłku z menu (nazwa domyślna, składniki bez `id`/`o`/`m`), dodanie ×1,5 (75 g → 277,5 kcal; 300 ml → 150 kcal; suma 427,5 kcal), mnożnik 0 zablokowany,
  edycja (nazwa, ilość 50→100 g, usunięcie składnika), sekcja „Gotowe” w wyszukiwarce, nowy gotowy posiłek ze składnikiem z wyszukiwarki, usunięcie, odświeżenie strony (dane zostają), limity 50 / 30 / 40 znaków, stary dokument bez `tpl`.
  Zapis `tpl` i kopii dni do Firebase niesprawdzony na żywo (strona nieosiągalna z sesji) – do sprawdzenia przez Kamila.

## Na później (nie robić bez prośby)
Woda, suplementy, zdjęcie talerza (AI – wymaga klucza i pośrednika).

## Poprawka: wczytanie diety z bazy
- Objaw: „Zapisz cele” (i inne zmiany w diecie) kończyło się toastem „Chwila, wczytuję dietę z bazy…”, także po odświeżeniu.
- Przyczyna: w folderze, który nie ma jeszcze dokumentu `data/diet`, Firestore z `persistentLocalCache` przy kolejnym
  wczytaniu strony od razu podaje z pamięci „dokumentu brak” (`fromCache:true`), a potwierdzenie z serwera to już tylko
  zmiana metadanych. Bez `includeMetadataChanges` ten drugi snapshot nie wywołuje funkcji, więc `dietLoaded` zostawało false
  na zawsze i `dietCanEdit()` blokowało zapis. Etap 3.3 nie miał z tym związku (błąd był od części 1).
- Zmiana: `onSnapshot(… data/diet, {includeMetadataChanges:true}, …)` w `dietOpen`. Blokada `dietCanEdit` zostaje,
  bo do czasu wczytania nie wiadomo, czy dokument nie jest w starym formacie (`DIET_OLD`, v:1, tablica `mine`).
