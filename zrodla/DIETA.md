# Segment „Dieta” – plan budowy

Plan ustalony z Olkiem (czat „Dieta”, listopad 2026). Budowa w dwóch częściach, każda w osobnym czacie.
Czytaj tylko potrzebne fragmenty `zrodla/src/app.html` (grep + zakres linii). Nie zmieniaj zachowania
istniejących segmentów (trening, plany, ćwiczenia, historia, manekin) – dieta to nowa, osobna część.
Po każdej części: build_web, test (jasny i ciemny, 390 px), commit, push, krótkie podsumowanie po polsku.

## Ustalenia (nie zmieniać bez pytania Olka)
- Nowa, piąta zakładka **Dieta** na dolnym pasku.
- Produkty w dwóch warstwach:
  1. **Baza ogólna** – wspólna dla wszystkich: 242 produkty ogólne z `zrodla/content/produkty.csv`
     (wbudowane w stronę), a w części 2 także produkty zeskanowane przez kogokolwiek (Firebase `foods/`).
     Nie jest wyświetlana w całości – tylko w wynikach wyszukiwania i skanu.
  2. **Moje produkty** – osobne dla każdej osoby. Produkt trafia tu sam, gdy zostanie dodany do posiłku,
     utworzony ręcznie albo oznaczony gwiazdką. Domyślny widok przy dodawaniu jedzenia; sortowanie:
     ★ na górze, potem najczęściej / ostatnio używane.
- Poprawki produktu (wartości, nazwa) są osobiste: zapisują się w „Moich produktach” i mają pierwszeństwo
  przed bazą ogólną. Bazy ogólnej użytkownik nie edytuje.
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

## CZĘŚĆ 2 – skaner kodów kreskowych i wspólna baza (osobny czat, po przetestowaniu części 1 przez Olka)
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
- Kamery i OFF nie da się sprawdzić z sesji (proxy) – test odczytu na wygenerowanych obrazkach kodów, resztę testuje Olek na telefonie.

## Na później (nie robić bez prośby)
Ważenie i wykres masy ciała (średnia 7-dniowa), kalkulator zapotrzebowania (Mifflin-St Jeor), inne cele w dni treningowe,
gotowe posiłki/przepisy, kopiowanie dnia, woda, suplementy, podsumowanie tygodnia, zdjęcie talerza (AI – wymaga klucza i pośrednika).
