# B2 – 30 nowych ćwiczeń z planów Kamila (plan, segment 3: Biblioteka ćwiczeń)

Źródło: plany „lato” (L) i „jesień 6.2” (J). Sprawdzenie bazy (112 ćwiczeń, `main` @ bb40151) zrobione 2026-11-15.
Decyzje Kamila: **warianty jednorącz/jednonóż jako osobne ćwiczenia**, **nowa grupa „Rozgrzewka”**, **film + opis, bez animacji**,
**Arnold Curl = hantle z rotacją nadgarstka**.

Już są w bazie (nic nie dodawać, najwyżej hasło w `EX_ALIAS`): Butterfly, Dips Chest, Incline Bench Press, DB Bench Press, Bench Press,
Underhand Pullup (`Chin-Up`), Lateral Raises, Dumbbell Front Raise, Incline Dumbbell Curl, DB Tricep Extension, Leg Extension, Seated Leg Curl,
Lying Leg Curl, Hyperextension, Seated Thigh Adduction (`Thigh_Adductor`), Standing Calf Raises, Seated Machine ABS Curl (`Ab_Crunch_Machine`),
Allahy (`Cable_Crunch`), Cardio.

## 1. Skrypt budujący (`zrodla/build_data.py`)
Ponad połowy ćwiczeń nie ma w free-exercise-db, a `build_data.py` bierze z niej `en`, sprzęt, mięśnie i poziom (`db[eid]` → KeyError).
- Nagłówek z 4. polem dla ćwiczeń spoza free-exercise-db:
  `@Kroc_Row | Wiosłowanie Kroc | reps | en=Kroc Row; eq=Hantle; level=średni; p=lats,middle back; s=biceps,forearms`
  (nazwy mięśni jak klucze `MUSCLES`, sprzęt jak wartości `EQUIP`). Gdy pole jest, `db` nie jest potrzebna. Gdy id jest w `db`,
  pole może nadpisać pojedyncze wartości (np. `eq=`).
- Zdjęcia: przełącznik `--bez-zdjec`. `web/img` nie istnieje, miniatury idą z `ANIM` albo litery (`thumb`), więc zdjęcia nie są potrzebne;
  ćwiczenie bez zdjęć w `db` nie może wywalać skryptu.
- `GROUPS` w skrypcie: dodać `"ROZGRZEWKA": "Rozgrzewka"`; nowy plik `content/4_rozgrzewka.txt`.
- **Test regresji:** po zmianie skrypt uruchomiony na samym `dist/exercises.json` z free-exercise-db (sparse checkout, bez zdjęć:
  `git clone --depth 1 --filter=blob:none --sparse https://github.com/yuhonas/free-exercise-db` + `git sparse-checkout set --no-cone /dist/exercises.json`)
  ma dać dla 112 starych ćwiczeń dokładnie te same wpisy co obecny `dist/exercises.json` (porównać skryptem przed dopisaniem nowych).
- Ćwiczenia z id w free-exercise-db (kolumna „FEDB”) bierz stamtąd, ale sprawdź opis/obrazki – jeśli FEDB pokazuje inny ruch niż w planie, użyj własnego id.

## 2. Ćwiczenia (30)
Kolumny: id · nazwa PL · grupa · sprzęt · tryb · FEDB · co to jest. Nazwy PL można dopracować, angielska nazwa z planu idzie do `en` albo `EX_ALIAS`.

**Klatka piersiowa**
1. `Smith_Machine_Incline_Bench_Press` · Wyciskanie na suwnicy Smitha na ławce skośnej · Maszyna · reps · FEDB tak.

**Plecy**
2. `Unilateral_Chest_Supported_Lat_Pulldown` · Ściąganie jednorącz na maszynie z podparciem klatki · Maszyna · reps · własne (FEDB `One_Arm_Lat_Pulldown` to wyciąg bez podparcia). Maszyna dźwigniowa/wyciąg z poduszką na klatkę, jedna ręka, łokieć w dół do biodra.
3. `Head_Supported_DB_Row` · Wiosłowanie hantlami w opadzie z czołem opartym o ławkę · Hantle · reps · własne. Stoisz w opadzie, czoło na oparciu ławki skośnej, oba hantle do bioder.
4. `Kroc_Row` · Wiosłowanie hantlem jednorącz Kroc · Hantle · reps · własne. Ciężki hantel, dużo powtórzeń (15–30), wolna ręka na ławce/stojaku, lekki ruch tułowia dozwolony.
5. `Wide_Grip_Machine_Row` · Wiosłowanie na maszynie szerokim chwytem · Maszyna · reps · własne. Jak `Leverage_Iso_Row`, chwyt szeroki nachwytem, łokcie szeroko (więcej górnej części pleców i tyłu barków).
6. `Cable_One_Arm_Row` · Przyciąganie linki wyciągu dolnego jednorącz siedząc · Wyciąg · reps · sprawdź FEDB (`Seated_One-arm_Cable_Pulley_Rows`).
7. `Cable_Pullover` · Pullover na wyciągu górnym · Wyciąg · reps · własne. Stojąc w lekkim opadzie, lina/drążek, proste ręce z góry do bioder (ruch ramion jak `Straight-Arm_Pulldown`, inny uchwyt i zakres – opisać różnicę).
8. `Kelso_Shrug` · Szrugsy Kelso (ściąganie łopatek z podparciem klatki) · Hantle · reps · własne. Leżąc przodem na ławce skośnej, proste ręce, samo ściąganie łopatek do siebie, bez zginania łokci. Mięśnie: kaptury (środek), równoległoboczne.

**Barki**
9. `One-Arm_Incline_Lateral_Raise` · Unoszenie hantla bokiem jednorącz na ławce skośnej · Hantle · reps · FEDB tak – sprawdź, czy to leżenie bokiem na ławce skośnej (tak jest w planie L); jeśli nie, własne id.
10. `Single_Arm_Reverse_Butterfly` · Odwrotne rozpiętki jednorącz na maszynie · Maszyna · reps · własne. Jak `Reverse_Machine_Flyes`, jedna ręka (tył barku).

**Biceps**
11. `Single_Arm_Machine_Preacher_Curl` · Uginanie ramienia jednorącz na modlitewniku (maszyna) · Maszyna · reps · własne (FEDB `Machine_Preacher_Curls` jest oburącz).
12. `Arnold_Curl` · Uginanie hantli z rotacją nadgarstka (Arnold curl) · Hantle · reps · własne. Start chwytem młotkowym, w trakcie uginania obrót do podchwytu, opuszczanie z powrotem do młotkowego.
13. `Elbow_Supported_Biceps_Curl` · Uginanie ramienia z podpartym łokciem · Hantle · reps · własne. Łokieć oparty (o oparcie ławki skośnej / kolano / poduszkę), uginanie jednorącz bez ruchu łokcia.

**Triceps**
14. `Unilateral_Rope_Triceps_Pushdown` · Prostowanie ramienia jednorącz na wyciągu górnym (lina) · Wyciąg · reps · własne. Ściąganie w dół jedną ręką, łokieć przy boku.
15. `Smith_JM_Press` · Wyciskanie JM na suwnicy Smitha · Maszyna · reps · własne (FEDB `JM_Press` to wolna sztanga). Wąski chwyt, łokcie w przód, sztanga schodzi nad górną część klatki/szyję, ruch między wyciskaniem wąskim a francuskim.

**Czworogłowe uda**
16. `Smith_Single-Leg_Split_Squat` · Przysiad wykroczny na suwnicy Smitha · Maszyna · reps · FEDB tak (sprawdź).
17. `Landmine_Sissy_Squat` · Przysiad sissy z landmine · Sztanga · reps · własne. Koniec sztangi w landmine trzymany przy klatce, pięty uniesione, kolana daleko w przód, tułów odchylony – akcent na mięsień prosty uda.
18. `Split_Squat_Isometric_Hold` · Przysiad wykroczny – izometryczne trzymanie · Masa ciała · **time** · własne. Trzymanie dolnej pozycji wykroku (tylne kolano tuż nad podłogą), opcjonalnie z hantlami.
19. `Zercher_Box_Squat` · Przysiad Zerchera do skrzyni · Sztanga · reps · własne (FEDB `Zercher_Squats` bez skrzyni). Sztanga w zgięciach łokci, siad na skrzynię/ławkę i wstanie.

**Dwugłowe uda**
20. `Landmine_B-Stance_RDL` · Rumuński martwy ciąg B-stance z landmine · Sztanga · reps · własne. Ciężar na nodze przedniej, tylna noga na palcach jako podpórka, uchwyt końca sztangi w landmine.

**Pośladki i biodra** (tu też przywodziciele, jak `Thigh_Adductor`)
21. `Single_Leg_Hip_Thrust` · Hip thrust jednonóż · Masa ciała · reps · własne. Łopatki na ławce (inaczej niż `Single_Leg_Glute_Bridge` z leżenia), opcjonalnie hantel na biodrze.
22. `Unilateral_Hyperextension` · Wyprosty tułowia jednonóż na ławce rzymskiej · Maszyna · reps · własne. Jedna noga zablokowana, druga swobodnie; pośladki, dwugłowe, prostowniki.
23. `Copenhagen_Plank_Weighted` · Deska kopenhaska z obciążeniem · Masa ciała · **time** · własne. Podpór bokiem, górna noga na ławce (kolano lub kostka), dolna w powietrzu, obciążenie na biodrze. Mięśnie: przywodziciele, skośne brzucha.

**Brzuch**
24. `Incline_Bench_Leg_Raise` · Unoszenie nóg leżąc na ławce skośnej · Masa ciała · reps · własne (podobne FEDB `Flat_Bench_Lying_Leg_Raise`). Głowa wyżej, trzymasz ławkę za głową, unosisz nogi i miednicę.

**Rozgrzewka** (nowa grupa; sprzęt Masa ciała; `level` początkujący; **bez mięśni w `MUSCLE_EX`** i z pustym `primary` – nie liczą się do serii)
25. `Inchworm_Worlds_Greatest_Stretch` · Inchworm z rozciąganiem „world's greatest stretch” · reps. Zejście dłońmi do podporu, wykrok, łokieć do stopy, skręt z ręką w górę, powrót.
26. `Cat_Cow` · Koci grzbiet (cat–cow) · reps. W klęku podpartym naprzemiennie zaokrąglanie i wyginanie pleców (FEDB `Cat_Stretch` – sprawdź).
27. `Shin_Box_Get_Up` · Wstawanie z pozycji shin box · reps. Siad z nogami zgiętymi 90/90, wstanie na kolana bez rąk, powrót, zmiana strony.
28. `Eccentric_Split_Squat` · Przysiad wykroczny z powolnym opuszczaniem · reps. Opuszczanie 3–5 s, szybki powrót.
29. `Dynamic_Push_Ups` · Pompki dynamiczne · reps. Szybkie, eksplozywne wypchnięcie.
30. `Inverted_Row_Drop_Catch` · Podciąganie australijskie z puszczeniem i złapaniem drążka · reps. W górze puść drążek na chwilę, złap, kontrolowane opuszczenie.

Dla każdego: 3–5 kroków techniki i 1–3 „Na co uważać” po polsku, w stylu istniejących wpisów (`content/1_gora.txt`).

## 3. Zmiany w `zrodla/src/app.html` i `zrodla/src/muscles.js`
- `GROUPS`: dopisać `'Rozgrzewka'` na końcu (po `Cardio`).
- `MUSCLE_EX` w `muscles.js`: wpis dla ćwiczeń 1–24 (klucze tylko z istniejącej listy mięśni w tym pliku; wzoruj się na podobnych ćwiczeniach).
  Rozgrzewka bez wpisu.
- Kolejność: `ORDER_TIERS` – nowe id do właściwych poziomów; w `exOrd` grupa `Rozgrzewka` → przed wszystkim (np. `-10`, z etykietą w `ORD_LABEL`).
- Wszystkie miejsca, gdzie `Cardio` jest traktowane osobno (`grep -n "Cardio" zrodla/src/app.html`: `exOrd`, `swapCandidates`, ocena planu,
  pokrycie programu, mapa tygodnia `WK_GROUPS`, `planGroupSets`, `planTime`): sprawdzić, czy Rozgrzewka ma działać tak samo
  (nie liczy się do serii partii, zamienniki tylko w obrębie rozgrzewki, ocena planu nie karze za „brak mięśni”). Ostrożnie – to kod segmentu 1 i 4,
  zmieniać tylko to, co konieczne, i wypisać w podsumowaniu.
- `EX_ALIAS`: angielskie nazwy z planu dla nowych ćwiczeń i dla tych, które już są (np. `Chin-Up:'underhand pullup'`, `Ab_Crunch_Machine:'abs curl'`,
  `Thigh_Adductor:'seated thigh adduction'`, `Cable_Crunch` – „allahy” już w nazwie).
- Filmy: `addYT` – polskie filmy z techniką. Kolejność źródeł jak w komentarzu przy `YT_SRC`: najpierw Michał Wrzosek (Atlas ćwiczeń, Olimp) – `W`,
  potem SFD `S`, DWS `D`, FitNOW `F`, inne `P`. Strony YouTube zwykle nie da się otworzyć z sesji – id filmu brać z wyników WebSearch
  (`allowed_domains: ["youtube.com"]`), tylko gdy tytuł jednoznacznie pokazuje to samo ćwiczenie. Brak pewnego filmu = bez filmu (lista braków w podsumowaniu,
  Kamil wklei linki sam). Najwyżej 1–2 wyszukiwania na ćwiczenie.
- Karta bez filmu i bez animacji: sprawdzić, co pokazuje `mediaHTML` → `animFigure` dla id bez `ANIM` (nie może być błędu ani pustej ramki;
  jeśli trzeba, nie pokazywać ramki wcale). To samo przy zepsutym YouTube (`ytBroken`).

## 4. Test i wdrożenie
- Gałąź `b2-cwiczenia-z-planow`, pull request do `main` (test.yml rusza sam).
- `python3 -I zrodla/build.py`, `python3 -I zrodla/build_web.py .`, `python3 testy/dymny/dymny.py --silniki chromium`, `node testy/zapis/test_zapis.js`.
- Nowy krok w teście dymnym: wszystkie 30 id są w `EX`; karta każdego otwiera się bez `pageerror`; chip „Rozgrzewka” filtruje 6 ćwiczeń;
  wyszukiwarka znajduje „kroc row” i „kelso”; ćwiczenie z rozgrzewki w planie nie zmienia wyniku pokrycia programu.
- Po zielonym teście: podsumowanie dla Kamila (co dodane, które bez filmu, co zmieniono poza biblioteką). Scalenie do `main` dopiero po przeglądzie.
