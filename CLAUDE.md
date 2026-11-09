# Dziennik siłowni – przewodnik dla Claude

Aplikacja treningowa Olka (iPhone 11 Pro, Windows). Strona: https://kiwwi0.github.io/dziennik-silowni/
Interfejs i rozmowa po polsku. Olek prosi: ostrożnie z poprawkami, a przed czymś kosztownym (duże przebudowy,
model 3D, długie testy) najpierw powiedz mu o koszcie. Każdy czat zajmuje się jednym segmentem (lista niżej),
czytaj tylko potrzebne fragmenty kodu (grep + zakres linii), nie cały plik.
Na starcie dołącz repozytorium od razu z prawem zapisu (add_repo z `access: "push"`), bo każda zmiana kończy się
wdrożeniem przez push do `main`. Przy dostępie tylko do odczytu nie da się wdrożyć zmian.

## Repozytorium
- `web/` – gotowa strona (GitHub Pages). Wdraża się sama po pushu do `main` (zmiany w `web/**`), ok. 1 min.
  Nie edytuj `web/index.html` ręcznie – zawsze buduj ze źródeł.
- `zrodla/` – źródła strony: `src/app.html` (cała aplikacja: CSS + JS, ok. 200 KB), `src/*.js`, `content/`,
  `dist/exercises.json` (baza ćwiczeń), skrypty budujące.
- `DziennikSilowni/`, `project.yml` – aplikacja na iPhone'a (SwiftUI, buduje się w GitHub Actions do .ipa).
  Jest starsza niż strona (bez manekina, oceny planu itd.).
  Workflow „Zbuduj aplikację na iPhone'a” rusza tylko przy zmianach w `DziennikSilowni/`, `Resources/`, `project.yml`
  (albo ręcznie w Actions). Strona wdraża się workflow „Strona siłownia” (`pages.yml`).
- `firebase-config.json`, `firestore.rules` – baza Firebase (plany i treningi każdej osoby w osobnym folderze).
  Każdy folder ma 4-cyfrowy PIN: logowanie anonimowe Firebase, skrót PIN-u w `folders/{id}/secret/pin` (nieczytelny),
  dostęp urządzenia = `folders/{id}/members/{uid}` (reguły porównują skrót). W app.html: `pinHash`, `requestFolder`, `askPin`,
  `SHEETS.pin`, ACT `pinGo`. Reguły wdrażają się same: workflow „Reguły bazy Firebase” (`rules.yml`, `firebase.json`)
  po pushu zmian w `firestore.rules` (sekret `FIREBASE_SERVICE_ACCOUNT`, konto firebase-adminsdk-fbsvc z rolą Firebase Rules Admin).
  Po pushu sprawdź wynik: `gh run list -R Kiwwi0/dziennik-silowni -w rules.yml -L 1`.
  Udostępnianie planów: `shares/{KOD}` (6 znaków), w app.html `sharePayload`, `syncShares`, `shareSanitize`, `SHEETS.share/shareImp`,
  ACT `planShare`, `shareFind`, `shareAdd`, `shareStop`; link `?plan=KOD`.

## Budowanie, test, wdrożenie (z katalogu repozytorium)
- Strona: `python3 -I zrodla/build_web.py .` → `web/` (wstawia bazę ćwiczeń, Firebase, manekina 3D, wersję service workera).
- Wersja testowa: `python3 -I zrodla/build.py` → `zrodla/dist/index.html` (bez Firebase i bez 3D; dane w localStorage).
- Test w Playwright (Chrome jest zainstalowany): `chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])`,
  strona podana przez `page.route` (szkielet `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">
  </head><body>` + zawartość `dist/index.html`), viewport 390×844, `color_scheme` light i dark. Sprawdzaj: brak `pageerror`,
  brak przewijania w bok (`document.documentElement.scrollWidth > innerWidth`), zrzut ekranu. Dane testowe: `S.plans = samplePlans()`
  albo `templatePlans(TEMPLATES.find(t => t.id === 'fbw2'))`, potem `render()`. iPhone: `p.devices['iPhone 11 Pro']` bez `default_browser_type`.
- Wdrożenie: build_web → commit → push `main`. Strona żywa nie jest osiągalna z sesji (proxy), testuj lokalnie.

## Jak zbudowany jest `zrodla/src/app.html`
- Stan: `S = {plans, custom, settings}` (osobny dla każdej osoby), `SESS` (zapisane treningi), `ACTIVE` (trwający trening,
  localStorage `dz.active`). Zapis: `commit()` / `persist()` (plany), `saveActive()` (trening), `saveSession()`.
- Widoki: `render()` → `vHome`, `vPlans`, `vExercises`, `vHistory`; trening to nakładka `renderWorkout()`.
- Arkusze od dołu: `SHEETS[typ]`, otwieranie `openSheet({type, ...})`, odświeżenie `renderSheet()`.
- Kliknięcia: `data-act="x"` → `ACT.x(el)`. Pola: `data-bind="x"` → `BIND.x(t)`.
- Pomocnicze: `esc`, `fmtN`, `pl` (odmiana), `svg(ikona)`, `toast`, `confirmBox`, `LS` (localStorage), `getEx(id)`.
- Kolory jako zmienne CSS w `:root`, ciemny motyw w `@media (prefers-color-scheme: dark)` i `:root[data-theme="dark"]`.
- Limity wpisów: `LIM` (200 kg, 100 powt., 3600 s), `MAX_SETS = 20`, `limitInput`, `clampSets`.

## Segmenty (osobny czat na każdy) i ich kod
1. **Tworzenie planów** – `vPlans`, `vPlanEditor`, `vItem`, `newItem`, `TEMPLATES`/`templatePlans`, kolejność ćwiczeń
   (`ORDER_TIERS`, `exOrd`, `suggestOrder`, `vOrderHint`), ocena planu (`planReview`, `planReviewCard`, `planBadge`, `planTime`,
   `PR_*`), pokrycie programu (`planGroupSets`, `programSets`, `programGaps`, `coverageCard`), podpowiedzi (`planNext`, `nextCard`),
   `SHEETS.templates/pick/addToPlan`; ACT `newPlan`, `editPlan`, `psetAdd`, `itemSS`, `itemSwap`, `covAdd`, `order*`, `tplAdd`;
   BIND `planName`, `pset`, `note`.
2. **Trening w praktyce** – `startWorkoutFrom`, `newWorkoutEx`, `wCard`, `renderWorkout`, `curIndex`, `afterSetDone`, superserie
   (`ssRange`, `ssPos`, `ssUnlink`), przerwy i minutnik (`startTimer`, `updateTimer`, `onTimerEnd`, `tick`, `alarm`, `requestWake`),
   `platesHTML`, progresja (`kgStep`, `progSuggest`, `progHint`), `lastFor`, `buildSession`, `endWorkout`,
   `SHEETS.finish/summary/swap`; ACT `startPlan`, `toggleSet`, `wAddSet`, `wDelSet`, `wRest`, `wMenu`, `wSS`, `wSwap`, `wProg`,
   `wNoteOpen`, `wMove`, `wDelEx`, `wAddEx`, `tb*`, `finishOpen`, `finishSave`, `discardAsk`; BIND `wset`, `wnote`, `finUpd`.
3. **Biblioteka ćwiczeń** – `EX`/`EXMAP` (z `dist/exercises.json`; `build_data.py` buduje go z `content/*.txt`, wymaga free-exercise-db),
   `allEx`, `filterEx`, `vExercises`, `fillExList`, `SHEETS.ex/custom`, filmy YouTube (`YT_SRC`, `YTV`, `ytMount`, `ytFigure`…),
   zapasowe animacje (`src/anim.js`, `src/anim_ex.js`, `animMount`…); ACT `exOpen`, `exInfo`, `custom*`, `yt*`.
4. **Historia i analiza** – `vHistory`, `sessRow`, `progress`, wykresy (`CHARTS`, `chartCard`, `drawChart`), `calendarCard`, `weekStreak`,
   mapa tygodnia (`WK_GROUPS`, `WK_TARGET`, `perWeek`, `freqSeg`, `weekStats`, `wkHeat`, `wkSuggest`, `weekCard`, `vWeek`),
   `SHEETS.session`; ACT `hist`, `calNav`, `sessOpen`, `sessDel`, `wkMore`, `setFreq`.
5. **Ustawienia i dane** – `applyTheme` (skrypt na początku), `SHEETS.settings/folders`, ACT `setTheme`, `setStep`, `folder*`,
   `exportCopy`, `importAsk`; BIND `setting`; zapis i Firebase (`store`, `initFirebase`, `openFolder`, `initStore`, `persist`,
   `flush`, `saveSession`, `normalize`), `DEF_SETTINGS`, `firestore.rules`.
6. **Manekin i mięśnie** (kosztowny) – `src/muscles.js` (`MUSCLE_EX` – mięśnie ćwiczeń), `src/anim_body.js` (płaski manekin `BODYMAP`,
   `bodyMapFigs`), `src/miesnie3d.js` (obracany 3D, three.js, model `web/models/miesnie.glb` 4,5 MB); w app.html `bodyMap`,
   `exMuscles`, `BM3`, `bm3dMount`; `zrodla/model3d/` – jak powstał model (BodyParts3D, licencja CC BY-SA). Nie generuj modelu od nowa bez zgody.
7. **Dieta** – w budowie, cały plan i ustalenia w `zrodla/DIETA.md` (czytaj go zamiast tego czatu); dane startowe
   produktów `zrodla/content/produkty.csv`. **Aplikacja na iPhone'a** (`DziennikSilowni/`) – osobny czat.

## Oszczędzanie limitu (Olek ma plan Pro)
Duże zadania: plan pisze Opus (do pliku w repo), buduje Sonnet w nowym czacie, sprawdza Opus w nowym, krótkim czacie
(czyta tylko `git diff` / zmiany z commita). Gdy zadanie lepiej zrobić w nowym czacie, powiedz to Olkowi wprost
i podaj gotowe zdanie do wklejenia oraz model do wybrania (Sonnet / Opus).

Po każdej zmianie: build_web, test (jasny i ciemny, 390 px), commit, push, krótkie podsumowanie dla Olka po polsku.
