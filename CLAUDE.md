# Dziennik siłowni – przewodnik dla Claude

Aplikacja treningowa Kamila (iPhone 11 Pro, Windows). Strona: https://kiwwi0.github.io/dziennik-silowni/
Interfejs i rozmowa po polsku. Kamil prosi: ostrożnie z poprawkami, a przed czymś kosztownym (duże przebudowy,
model 3D, długie testy) najpierw powiedz mu o koszcie. Każdy czat zajmuje się jednym segmentem (lista niżej),
czytaj tylko potrzebne fragmenty kodu (grep + zakres linii), nie cały plik.
Na starcie dołącz repozytorium od razu z prawem zapisu (add_repo z `access: "push"`), bo każda zmiana kończy się
wdrożeniem przez push do `main`. Przy dostępie tylko do odczytu nie da się wdrożyć zmian.

## Repozytorium
- `web/` – gotowa strona (GitHub Pages). Wdraża się sama po pushu do `main` i zielonym teście (`test.yml`), ok. 2–3 min.
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
  `SHEETS.pin` (tryby `enter`, `new`, `set`, `change`, `del`, `nopin`, `gone`), ACT `pinGo`, `pinChange`, `pinSetOwn`.
  Bramka prób PIN-u (zlecenie A3, plan w `zrodla/plany/A3-pin-i-dostep.md`): `folders/{id}/secret/gate` (liczniki i czasy okien, bez skrótów;
  5 prób / 15 min i 10 / dobę, stałe `GATE_15`, `GATE_DAY` – zmieniać razem z regułami) i żeton `folders/{id}/tries/{uid}` (skrót + czas serwera,
  ważny 15 min). Próba = transakcja `pinTry`; wejście na konto = `pinCheck` (próba + zapis `members`); stan okien liczy `gateState`.
  Generacja dostępu `gen` (w `folders/{id}` i `members/{uid}`, brak = 0): zmiana PIN-u (ACT `pinChange`) podnosi ją o 1 i wylogowuje inne urządzenia
  (`watchFolders` porównuje `gen` z `accGen`). Aplikacja działa ze starymi i nowymi regułami: odrzucony odczyt bramki = tryb „stare reguły”.
  Reset zapomnianego PIN-u (tylko konsola Firebase): policz skrót `SHA-256("dziennik-silowni:" + id + ":" + PIN)` (przepis w komentarzu bloku
  „PIN folderu” w app.html), wpisz go w `secret/pin` → `hash`; gdy PIN mógł wyciec, zwiększ `gen` w folderze o 1; gdy konto jest zablokowane
  limitem, usuń dokument `secret/gate`. Reguły wdrażają się dopiero po zatwierdzeniu: workflow „Reguły bazy Firebase” (`rules.yml`, `firebase.json`)
  rusza po pushu zmian w `firestore.rules`, ale zadanie czeka na zatwierdzenie przez Kamila w środowisku GitHuba „produkcja”
  (Review deployments). Sekret `FIREBASE_SERVICE_ACCOUNT` jest sekretem tego środowiska, a jego klucz należy do osobnego konta
  usługi z samą rolą Firebase Rules Admin (nie do firebase-adminsdk-fbsvc). Nie wgrywaj reguł inaczej niż przez ten workflow.
  Zadanie „test” (testy reguł na emulatorze w `testy-regul/`) rusza przy zmianie `firestore.rules`, `firebase.json`, `testy-regul/` i `rules.yml`, także w pull requestach. Deploy ma `needs: test` i rusza tylko po pushu zmieniającym `firestore.rules` albo ręcznie na `main`.
  Lokalnie: `cd testy-regul && npm ci && npx --yes firebase-tools@13.35.1 emulators:exec --only firestore --project demo-dziennik "npm test"`
  (wymaga Javy 21 i pobrania emulatora z storage.googleapis.com – w sesji Claude zwykle zablokowane, wtedy sprawdza Actions).
  Każda zmiana `firestore.rules` wymaga dopisania lub poprawienia testu w tym samym commicie.
  Po pushu powiedz Kamilowi, żeby zatwierdził wdrożenie, i sprawdź wynik: `gh run list -R Kiwwi0/dziennik-silowni -w rules.yml -L 1`
  (do zatwierdzenia status to „waiting”).
  Udostępnianie planów: `shares/{KOD}` (6 znaków), w app.html `sharePayload`, `syncShares`, `shareSanitize`, `SHEETS.share/shareImp`,
  ACT `planShare`, `shareFind`, `shareAdd`, `shareStop`; link `?plan=KOD`.

## Budowanie, test, wdrożenie (z katalogu repozytorium)
- Strona: `python3 -I zrodla/build_web.py .` → `web/` (wstawia bazę ćwiczeń, Firebase, manekina 3D, wersję service workera).
- Wersja testowa: `python3 -I zrodla/build.py` → `zrodla/dist/index.html` (bez Firebase i bez 3D; dane w localStorage).
- Test: `python3 testy/dymny/dymny.py --silniki chromium` (lokalnie Chrome z `/usr/bin/google-chrome`; WebKit zwykle tylko w Actions) zamiast własnych skryptów,
  a zasada brzmi: nowy błąd = nowy krok w tym teście (błąd aplikacji, którego nie naprawiasz od razu, wpisz do `ZNANE_BLEDY` z numerem).
- Test logiki zapisu planów i treningów (A6): `node testy/zapis/test_zapis.js` (Node, bez przeglądarki i bez Firebase; sztuczny serwer i dwa urządzenia,
  plik `zrodla/src/zapis.js` jest ten sam, który `build.py` i `build_web.py` wklejają do strony). Nowy błąd w scalaniu/kolejce = nowy przypadek tam.
  Test dymny ma kroki „zapis: …” (sztuczny Firebase w `SZTUCZNY_FIREBASE`) i „kopia zapasowa” (porównanie z `testy/zapis/kopia_przed.json` – eksport z `main` @ e82b8c6
  na stanie z `kopia_stan.json`; zmiana formatu kopii = świadoma zmiana tego pliku). Żaden z nich nie sprawdza prawdziwego Firebase (SDK, tryb samolotowy) – to robi właściciel po wdrożeniu.
- Szkielet strony, z którego korzysta test (jak w prawdziwej stronie z build_web): `<!doctype html><html lang="pl"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><style>[hidden]{display:none!important}</style></head><body>` + zawartość `zrodla/dist/index.html`
  (podana przez `page.route`); reguła `[hidden]` jest konieczna, bo bez niej ukryta warstwa arkuszy zasłania przyciski. Dane testowe: `S.plans = templatePlans(TEMPLATES.find(t => t.id === 'fbw2'))`, potem `render()`.
- Automat `test.yml` (push i pull request): build + build_web + `git diff --exit-code web/` + test dymny w Chromium i WebKit (iPhone 11 Pro i 390×844, jasny i ciemny).
- Wdrożenie: build_web → commit → push `main`; `pages.yml` wdraża po zielonym `test.yml` (czerwony test wstrzymuje wdrożenie). Strona żywa nie jest osiągalna z sesji (proxy), testuj lokalnie.

## Jak zbudowany jest `zrodla/src/app.html`
- Stan: `S = {plans, custom, settings}` (osobny dla każdej osoby), `SESS` (zapisane treningi), `ACTIVE` (trwający trening,
  localStorage `dz.active`). Zapis: `commit()` / `persist()` (plany), `saveActive()` (trening), `saveSession()`.
  Zapis w bazie (tryb „fire”, zlecenie A6, plan w `zrodla/plany/A6-zapis-planow-i-treningow.md`): `data/state` w układzie v3 (mapy `pm`/`cm` po id z czasem `u`, kolejność `po`/`co`,
  nagrobki `pt`/`ct`, znacznik `full`, lustro `plans`/`custom`/`settings` w starym układzie dla starych kart). `persist()` porównuje stan z poprzednim i wpisuje zmiany do kolejki
  (`Z.q`, localStorage `dz.f.<konto>.zq`); `flushFire()` wysyła tylko zmienione pozycje (`mergeFields`), a migrację i naprawę po starej karcie robi transakcją; nasłuch w `openFolder` scala
  (`ZP.merge`, zrodla/src/zapis.js). Treningi: lista niewysłanych `dz.f.<konto>.unsent` (`sessMark`/`sessUnmark`/`sessSend`/`sessResend`, `ZP.mergeSessions`).
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

## Oszczędzanie limitu (Kamil ma plan Pro)
Duże zadania: plan pisze Opus (do pliku w repo), buduje Sonnet w nowym czacie, sprawdza Opus w nowym, krótkim czacie
(czyta tylko `git diff` / zmiany z commita). Gdy zadanie lepiej zrobić w nowym czacie, powiedz to Kamilowi wprost
i podaj gotowe zdanie do wklejenia oraz model do wybrania (Sonnet / Opus).

Po każdej zmianie: build_web, test dymny, commit, push, krótkie podsumowanie dla Kamila po polsku.
