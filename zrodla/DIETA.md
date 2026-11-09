# Segment „Dieta” – plan budowy

Plan ustalony z Olkiem (czat „Dieta”, listopad 2026). Budowa w dwóch częściach, każda w osobnym czacie.
Czytaj tylko potrzebne fragmenty `zrodla/src/app.html` (grep + zakres linii). Nie zmieniaj zachowania
istniejących segmentów (trening, plany, ćwiczenia, historia, manekin) – dieta to nowa, osobna część.
Po każdej części: build_web, test (jasny i ciemny, 390 px), commit, push, krótkie podsumowanie po polsku.

## Ustalenia (nie zmieniać bez pytania Olka)
- Nowa, piąta zakładka **Dieta** na dolnym pasku.
- Produkty w dwóch warstwach:
  1. **Baza ogólna** – wspólna dla wszystkich: 260 produktów ogólnych z `zrodla/content/produkty.csv`
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

Wbudowanie: w obu skryptach (`build.py`, `build_web.py`) wczytaj CSV i wstaw jako JSON w miejsce
`__FOODS_JSON__` – tak samo jak `__EXERCISES_JSON__` (`<script type="application/json" id="fooddata">`,
`.replace('<', '\\u003c')`, `assert count == 1`). Format w JS, krótkie klucze:
`{id, n:nazwa, c:kategoria, u:'g'|'ml', k, b, w, t, f:blonnik, pg:porcja_g|null, po:porcja_opis|''}`.

---

## CZĘŚĆ 1 – podstawa diety

### Stan i zapis
Dieta **nie** wchodzi do `S` (dokument `state` jest zapisywany w całości przy każdej zmianie). Osobno:
- `DIET = {goals:{k, b, w, t}, mine:[…], v:1}` – cele i „Moje produkty”.
  - Firebase: `folders/{fid}/data/diet`; localStorage: `lsKey('diet')`.
- Dni: `DAYS = {'2026-11-09': {meals:{sn:[], ob:[], ko:[], pr:[]}}, …}` – osobny dokument na dzień.
  - Firebase: `folders/{fid}/diet/{RRRR-MM-DD}`; localStorage: `lsKey('dietDays')` (cały obiekt).
  - Klucz daty: istniejąca funkcja `dayKey(d)`.
- Wpis w posiłku: `{id:uid(), pid:id produktu|null, n:nazwa, g:gramy|null, k, b, w, t}`
  (makro już przeliczone na zjedzoną ilość, zaokrąglone do 0,1; `pid:null` = szybki wpis samych liczb).
- Produkt w `mine`: `{id, n, brand:'', u, k, b, w, t, f, pg, po, src:'gen'|'own'|'scan', ean:'', star:false, uses:0, last:0}`.
  Produkt z bazy ogólnej trafia do `mine` z tym samym `id` i `src:'gen'`; własny dostaje `id:'o-'+uid()`.
- Wczytywanie/zapis wzoruj na istniejących: `persist`/`flush` (debounce), `openFolder` (onSnapshot dla
  `data/diet` i kolekcji `diet` – wystarczą ostatnie ~60 dni: `orderBy(documentId)`/`where` po id albo pole `date`),
  `closeFolder` (odpięcie nasłuchu, wyczyszczenie `DIET`/`DAYS`), tryb lokalny (`store.mode === 'local'`).
  Dzień zapisuj osobno (`setDoc` dokumentu dnia) przy zmianie wpisów tego dnia.
- `firestore.rules`: w `match /data/{docId}` dopuść `docId in ['state', 'diet']`; dodaj
  `match /diet/{day} { allow read, write: if isMember(fid) && day.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}$'); }`.
  Reguły wgrywa sam workflow `.github/workflows/rules.yml` po pushu zmian w `firestore.rules`.
- Kopia zapasowa (`exportCopy` / `importAsk`, segment 5): dołącz `diet` i `dietDays`, zachowując zgodność
  ze starymi kopiami (brak pól = pusta dieta).

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
- **`dietQty`**: nazwa, makro na 100 g; pole ilości w g/ml (domyślnie porcja, jeśli jest, inaczej 100) + przycisk
  porcji („1 jajko M · 50 g”), wybór posiłku, **makro przeliczone na żywo**, przycisk „Dodaj”/„Zapisz”. Przy dodaniu:
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
