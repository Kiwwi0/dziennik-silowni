# A3 – PIN, bramka prób i odbieranie dostępu (plan)

Zlecenie A3 z raportu audytu: E1-01 (krytyczny), E1-02 (krytyczny), E7-01 (ważny). Segment 5 (Ustawienia i dane).
Ten plik to **sam plan** – nie zmienia kodu ani reguł. Budowa: Sonnet w nowym czacie, przegląd: Opus w osobnym czacie.

Stan wyjściowy (commit `9058896`): `firestore.rules` (167 linii), `testy-regul/regul.test.js` (blok „znane dziury”),
w `zrodla/src/app.html`: `pinHash`, `pinMode`, `askPin`, `requestFolder`, `SHEETS.pin`, `SHEETS.folders`,
ACT `pinGo`, `folderCreate`, `folderOpen`, `folderDelete`, `folderDeleteGo`, `folderSwitch`.

Ustalenia, których plan nie zmienia: PIN 4-cyfrowy, logowanie anonimowe, darmowy plan Firebase (bez funkcji w chmurze),
bez logowania e-mailem i kontem Google. Bloki reguł `foods`, `shares`, `data`, `diet`, `sessions` – bez zmian w treści
(zmienia się tylko funkcja `isMember`, której używają). Usuwanie konta nadal wymaga PIN-u sprawdzanego przez bazę.

---

## 0. Co sprawdziłem w projekcie z audytu i co poprawiłem

| Punkt projektu z audytu | Wykonalne? | Zmiana w tym planie |
|---|---|---|
| Bramka `secret/gate` **nieczytelna dla nikogo** | Nie da się tego połączyć z resztą wymagań. Aplikacja nie zna stanu licznika, więc nie wie, czy zapisać „+1” czy „nowe okno”, i nie pokaże „Spróbuj za … min”. | Bramka jest **czytelna (`get`) dla zalogowanych**, bez `list`. Zawiera tylko liczniki i czasy okien – żadnych skrótów. Ujawnia jedynie, że ktoś niedawno próbował. Zapis próby robi transakcja (odczyt + zapis), więc dwa urządzenia naraz nie przeskoczą limitu. |
| Próba = dwa zapisy; drugi sprawdza `get(tries/{uid})`, nie `getAfter` | Tak. `get` widzi stan sprzed zapisu, więc żetonu nie da się dołożyć w tym samym zapisie grupowym. | Dodatkowo żeton musi być **świeży (≤ 15 min)**, a pole `at` w żetonie = `request.time` (czas serwera). |
| Limit 5 / 15 min i 10 / dobę | Tak, przy **stałych oknach** (początek okna = pierwsza próba po wygaśnięciu poprzedniego). Przesuwanego okna reguły nie policzą (brak pętli). | Bez zmian. Na granicy okien możliwy krótki zryw (np. 5 prób tuż przed i 5 tuż po końcu okna 15 min), ale limit dobowy 10 nadal obowiązuje. |
| Sekret tylko z nowym kontem albo przez członka; tryb `set` znika | Tak. | Tryb `set` zostaje **tylko dla urządzenia, które już jest członkiem** konta bez PIN-u (stare dane). Obcy dostaje komunikat zamiast formularza. Sekret da się usunąć **tylko razem z folderem** (zamyka drugą połowę E1-02). |
| Numer generacji, `isMember` wymaga zgodności | Tak. Brak pola `gen` = 0 po obu stronach, więc **żadne istniejące urządzenie nie traci dostępu i niczego nie trzeba migrować**. | – |
| Zmiana PIN-u po podaniu starego | Tak, ale stary PIN musi przejść **przez bramkę** (żeton). Inaczej zalogowane urządzenie (np. skradziony telefon) mogłoby bez limitu sprawdzać PIN-y przepisywaniem swojego wpisu. | Gałąź „członek przepisuje swój wpis” działa **tylko wtedy, gdy w tym samym zapisie zmienia się sekret** – nie jest wyrocznią PIN-u. |
| Usuwanie konta wymaga PIN-u sprawdzanego przez bazę | Dziś baza sprawdza PIN tylko przy zapisie wpisu `members`, a samo usunięcie folderu wymaga bycia członkiem. | Usunięcie folderu wymaga **świeżego żetonu z poprawnym PIN-em** i znika razem z `secret/pin` i `secret/gate` w jednym zapisie grupowym. |

---

## 1. Schemat dokumentów

### Nowe

| Ścieżka | Pola | Kto czyta | Kto pisze |
|---|---|---|---|
| `folders/{fid}/secret/gate` | `n15` int (próby w oknie 15 min), `w15` timestamp (początek okna 15 min), `nd` int (próby w oknie dobowym), `wd` timestamp (początek okna dobowego), `at` timestamp (czas ostatniej próby = `request.time`) | każdy zalogowany (`get`), bez `list` | każdy zalogowany, ale tylko według zasad bramki (pkt 2); usuwa członek razem z folderem |
| `folders/{fid}/tries/{uid}` | `hash` string 64 znaki (skrót, który urządzenie chce sprawdzić), `at` timestamp (= `request.time`) | nikt | tylko urządzenie `uid`, tylko w tym samym zapisie co zwiększenie bramki; usuwa samo urządzenie |

Bramka powstaje **leniwie** przy pierwszej próbie na danym koncie (dla istniejących kont nie trzeba nic przygotowywać).

### Zmienione

| Ścieżka | Zmiana |
|---|---|
| `folders/{fid}` | nowe opcjonalne pole `gen` int ≥ 0 (generacja dostępu; brak = 0). Pole `pin` przy tworzeniu musi być `true`; później nie może zmienić się z `true` na `false`, a z `false`/braku na `true` tylko, gdy po zapisie istnieje `secret/pin`. `gen` rośnie tylko o 1 i tylko razem ze zmianą `secret/pin`. |
| `folders/{fid}/members/{uid}` | nowe opcjonalne pole `gen` int (brak = 0). Wpis daje dostęp tylko, gdy `gen` wpisu = `gen` folderu. Aplikacja zapisuje `gen` tylko, gdy > 0 (zgodność ze starymi regułami w okresie przejściowym). |
| `folders/{fid}/secret/pin` | bez zmian w polach (`hash`). Zmienne są tylko zasady: utworzenie z nowym kontem albo przez członka, zmiana (nowa) przez członka ze starym PIN-em przez bramkę, usunięcie tylko z folderem. |

Wzór skrótu bez zmian: `SHA-256("dziennik-silowni:" + fid + ":" + pin)` (`pinHash`). Nie zmieniamy go, bo zmiana
wylogowałaby wszystkich, a bezpieczeństwo daje teraz bramka, nie tajność wzoru.

---

## 2. Reguły – pełna treść zmienianych bloków

Zastępuje w `firestore.rules`: funkcje `isMember`, `isMemberAfter`, `validFolder` (linie 8–14) oraz cały blok
`match /folders/{fid}` aż do `match /data/{docId}` (linie 126–150). Bloki `data`, `diet`, `sessions`, `shares`, `foods`
zostają słowo w słowo. Komentarz w nagłówku (linia 4, „Reset zapomnianego PIN-u…”) – nowa procedura z pkt 3.4.

### 2.1 Funkcje (w miejsce linii 7–14)

```
    function signedIn() { return request.auth != null; }
    function fPath(fid) { return /databases/$(database)/documents/folders/$(fid); }
    function pinPath(fid) { return /databases/$(database)/documents/folders/$(fid)/secret/pin; }
    function gatePath(fid) { return /databases/$(database)/documents/folders/$(fid)/secret/gate; }
    function mPath(fid) { return /databases/$(database)/documents/folders/$(fid)/members/$(request.auth.uid); }
    function tPath(fid) { return /databases/$(database)/documents/folders/$(fid)/tries/$(request.auth.uid); }

    // Członek = własny wpis members z generacją równą generacji konta (brak pola gen = 0, jak w danych sprzed A3).
    // Brak wpisu lub folderu: get() kończy się błędem, a błąd = odmowa. 2 odczyty.
    function isMember(fid) {
      return signedIn() && get(mPath(fid)).data.get('gen', 0) == get(fPath(fid)).data.get('gen', 0);
    }
    function validFolder(d) {
      return d.keys().hasOnly(['name', 'createdAt', 'updatedAt', 'pin', 'gen'])
        && d.name is string && d.name.size() > 0 && d.name.size() <= 40
        && (!('pin' in d) || d.pin is bool)
        && (!('gen' in d) || (d.gen is int && d.gen >= 0));
    }
    function validHash(d) {
      return d.keys().hasOnly(['hash']) && d.keys().hasAll(['hash'])
        && d.hash is string && d.hash.size() == 64;
    }
    // Żeton: to urządzenie przeszło przez bramkę najwyżej 15 min temu ze skrótem h (odczyt sprzed zapisu – get, nie getAfter).
    function triedPin(fid, h) {
      let t = get(tPath(fid)).data;
      return t.hash == h && t.at > request.time - duration.value(15, 'm');
    }
    // Świeży żeton z poprawnym PIN-em (usuwanie konta).
    function pinFresh(fid) { return triedPin(fid, get(pinPath(fid)).data.hash); }
    // Sekret powstaje albo zmienia się w tym samym zapisie.
    function pinChanging(fid) {
      return !exists(pinPath(fid)) || getAfter(pinPath(fid)).data.hash != get(pinPath(fid)).data.hash;
    }

    // Bramka prób: stałe okna – 15 min (≤ 5 prób) i doba (≤ 10 prób). Czas tylko z request.time.
    // GATE_15 = 5, GATE_DAY = 10 – zmieniać razem ze stałymi o tych nazwach w app.html.
    function gateKeys(n) {
      return n.keys().hasOnly(['n15', 'w15', 'nd', 'wd', 'at']) && n.keys().hasAll(['n15', 'w15', 'nd', 'wd', 'at'])
        && n.at == request.time;
    }
    function gateFirst(n) {
      return gateKeys(n) && n.n15 == 1 && n.w15 == request.time && n.nd == 1 && n.wd == request.time;
    }
    function gateNext(o, n) {
      return gateKeys(n)
        && (request.time > o.w15 + duration.value(15, 'm')
              ? (n.n15 == 1 && n.w15 == request.time)
              : (n.n15 == o.n15 + 1 && n.n15 <= 5 && n.w15 == o.w15))
        && (request.time > o.wd + duration.value(1, 'd')
              ? (n.nd == 1 && n.wd == request.time)
              : (n.nd == o.nd + 1 && n.nd <= 10 && n.wd == o.wd));
    }
    // Zmiana folderu: urządzenie jest członkiem po zapisie; pin nie znika; gen +1 tylko razem ze zmianą istniejącego sekretu.
    function folderUpdOk(fid) {
      let o = resource.data;
      let n = request.resource.data;
      let og = o.get('gen', 0);
      let ng = n.get('gen', 0);
      return getAfter(mPath(fid)).data.get('gen', 0) == ng
        && (n.get('pin', false) == o.get('pin', false) || (n.get('pin', false) == true && existsAfter(pinPath(fid))))
        && (ng == og || (ng == og + 1 && exists(pinPath(fid)) && pinChanging(fid)));
    }
```

`isMemberAfter` znika (jedynym miejscem użycia był `folders` update – zastępuje go `folderUpdOk`).

### 2.2 Blok `folders/{fid}` (w miejsce linii 126–150; dalej bez zmian `data`, `diet`, `sessions`)

```
    match /folders/{fid} {
      allow read: if true;
      // Nowe konto: folder + secret/pin + własny wpis members w jednym zapisie grupowym (pinGo, tryb 'new').
      allow create: if signedIn() && validFolder(request.resource.data)
        && request.resource.data.get('pin', false) == true
        && request.resource.data.get('gen', 0) == 0
        && existsAfter(pinPath(fid));
      allow update: if signedIn() && validFolder(request.resource.data) && folderUpdOk(fid);
      // Usunięcie konta: członek ze świeżym żetonem poprawnego PIN-u; sekret znika w tym samym zapisie.
      allow delete: if isMember(fid) && pinFresh(fid) && !existsAfter(pinPath(fid));

      // Skrót PIN-u – nikt go nie odczyta.
      match /secret/pin {
        allow read: if false;
        // Tylko razem z nowym kontem (folder powstaje w tym samym zapisie) albo przez członka konta, które sekretu nie ma.
        allow create: if signedIn() && validHash(request.resource.data)
          && ((!exists(fPath(fid)) && existsAfter(fPath(fid))) || isMember(fid));
        // Zmiana PIN-u: członek, świeży żeton z OBECNYM PIN-em, inny skrót, generacja konta +1 w tym samym zapisie.
        allow update: if isMember(fid) && validHash(request.resource.data)
          && request.resource.data.hash != resource.data.hash
          && triedPin(fid, resource.data.hash)
          && getAfter(fPath(fid)).data.get('gen', 0) == get(fPath(fid)).data.get('gen', 0) + 1;
        // Usunąć można tylko razem z kontem.
        allow delete: if isMember(fid) && !existsAfter(fPath(fid));
      }

      // Bramka prób (bez skrótów). Czytelna, żeby aplikacja pokazała „Spróbuj za … min” i zapisała próbę w transakcji.
      match /secret/gate {
        allow get: if signedIn();
        allow create: if signedIn() && exists(pinPath(fid)) && gateFirst(request.resource.data);
        allow update: if signedIn() && gateNext(resource.data, request.resource.data);
        allow delete: if isMember(fid) && !existsAfter(fPath(fid));
      }

      // Żeton próby: skrót do sprawdzenia; powstaje tylko w tym samym zapisie co zwiększenie bramki.
      match /tries/{uid} {
        allow read: if false;
        allow create, update: if signedIn() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['hash', 'at']) && request.resource.data.keys().hasAll(['hash', 'at'])
          && request.resource.data.hash is string && request.resource.data.hash.size() == 64
          && request.resource.data.at == request.time
          && getAfter(gatePath(fid)).data.at == request.time;
        allow delete: if signedIn() && request.auth.uid == uid;
      }

      // Urządzenia z dostępem. Wpis = skrót równy sekretowi + generacja równa generacji konta, oraz jedno z:
      //  (a) świeży żeton z tym samym skrótem (logowanie, sprawdzenie PIN-u przed usunięciem/zmianą),
      //  (b) nowe konto – folder powstaje w tym samym zapisie,
      //  (c) członek ustawia lub zmienia PIN w tym samym zapisie (bez tego warunku wpis byłby wyrocznią PIN-u bez limitu).
      match /members/{uid} {
        allow get: if signedIn() && request.auth.uid == uid;
        allow list: if false;
        allow create, update: if signedIn() && request.auth.uid == uid
          && request.resource.data.keys().hasOnly(['hash', 'at', 'gen'])
          && request.resource.data.keys().hasAll(['hash', 'at'])
          && request.resource.data.get('gen', 0) == getAfter(fPath(fid)).data.get('gen', 0)
          && request.resource.data.hash == getAfter(pinPath(fid)).data.hash
          && (triedPin(fid, request.resource.data.hash)
            || !exists(fPath(fid))
            || (isMember(fid) && pinChanging(fid)));
        allow delete: if signedIn() && request.auth.uid == uid;
      }
```

Uwaga do bloku `secret`: dotychczasowe `match /secret/{doc}` znika; zostają dwa dosłowne dopasowania. Każdy inny
dokument w `secret/` i zapytanie `list` na tej kolekcji są odrzucane domyślnie.

### 2.3 Ograniczenia reguł Firestore – jak plan się w nich mieści

**Limit odczytów** (`get`/`exists`/`getAfter`/`existsAfter`): 10 na jedną operację, 20 na cały zapis grupowy lub transakcję.
Liczę ostrożnie, jakby każde wywołanie liczyło się osobno (w praktyce powtórzony odczyt tego samego dokumentu bywa liczony raz).
Emulator pilnuje tych limitów, więc testy z pkt 5 wychwycą przekroczenie.

| Zapis (kto) | Operacje | Odczyty (najgorszy przypadek) |
|---|---|---|
| Próba (transakcja `pinTry`) | update/create `gate` + set `tries/{uid}` | gate: 0–1 (`exists(pin)` przy create), tries: 1 (`getAfter(gate)`) → **≤ 2** |
| Logowanie (`members` set po żetonie) | 1 | getAfter folder, getAfter pin, get tries → **3** |
| Nowe konto (batch) | folder create, pin create, members create | 1 + 2 + 4 → **7** |
| Ustawienie PIN-u przez członka (batch) | folder update (pin→true), pin create, members set | 2 + 4 + 8 → **≤ 14** |
| Zmiana PIN-u (batch) | folder update (gen+1), pin update, members set | najgorsze liczenie (każde wywołanie osobno) → **19 z 20** (poprzednio błędnie podano ≤ 15) |
| Usunięcie konta (batch) | folder delete, pin delete, gate delete | 5 + 3 + 3 → **11** |
| Każdy odczyt/zapis `data`, `diet`, `sessions`, `shares` | 1 | `isMember` = **2** (dziś 1) |

Najcięższa pojedyncza operacja to wpis `members` w gałęzi (c): getAfter folder, getAfter pin, get tries, exists folder,
get member, get folder, exists pin, get pin = **8 ≤ 10**.

**Czas:** wyłącznie `request.time`. Aplikacja zapisuje czasy przez `serverTimestamp()` (reguła wymaga `== request.time`),
więc zegar telefonu nie ma wpływu na licznik. Okna liczone jako `timestamp + duration.value(15, 'm')` / `(1, 'd')`.
Na granicy okna zegar telefonu może się różnić od serwera – aplikacja wtedy ponawia raz z drugim wariantem (pkt 4).

**Zapisy grupowe:** `get`/`exists` widzą stan **sprzed** całego zapisu, `getAfter`/`existsAfter` – stan **po**. Na tym stoi cały projekt:
- żeton w `members` czytany przez `get` → nie da się dołożyć żetonu i wpisu w jednym batchu;
- `tries` wymaga `getAfter(gate).at == request.time` → żeton powstaje tylko w zapisie, który zwiększył bramkę;
- sekret tworzony przy nowym koncie wymaga `!exists(folder) && existsAfter(folder)` → nie da się go założyć na istniejącym koncie;
- `serverTimestamp()` daje ten sam `request.time` dla wszystkich operacji jednego zapisu.

**Błędy w regułach:** `get()` nieistniejącego dokumentu kończy się błędem; błąd w `&&` = odmowa, w `||` przegrywa z `true`.
Gałęzie (a)/(b)/(c) w `members` korzystają z tego świadomie (np. brak żetonu nie psuje gałęzi „nowe konto”).

---

## 3. Przejście dla istniejących danych

### 3.1 Zalogowane urządzenia
Istniejące wpisy `members/{uid}` mają `{hash, at}` bez `gen`, foldery nie mają `gen`. Nowy `isMember` porównuje
`gen` z wartością domyślną 0 po obu stronach → **0 == 0, dostęp zostaje, nikt nie podaje PIN-u ponownie**.
Nie ma skryptu migracji ani zapisu „na start”. Pierwsza zmiana PIN-u na danym koncie ustawi `gen = 1`
i dopiero wtedy stare wpisy tego konta przestaną działać – zgodnie z decyzją P8.

### 3.2 Bramka dla istniejących kont
`secret/gate` nie istnieje – powstaje przy pierwszej próbie (`gateFirst`). Nic nie trzeba przygotowywać.

### 3.3 Konto, które nadal nie ma sekretu
Przypadki: (1) stare konto sprzed wprowadzenia PIN-ów, bez `pin: true`, bez `secret/pin` i bez członków;
(2) konto, z którego członek usunął sekret (druga połowa E1-02) – ma członków, nie ma sekretu.
- **Przed wdrożeniem reguł** właściciel w konsoli Firebase przegląda `folders` i notuje konta bez pola `pin: true`
  albo bez dokumentu `secret/pin`.
- Po wdrożeniu nikt obcy nie założy takiemu kontu sekretu (tryb `set` dla obcych znika).
- Przypadek (2): urządzenie, które jest członkiem, widzi w ustawieniach konta przycisk **„Ustaw PIN”** (gałąź „członek” w `secret/pin` create).
- Przypadek (1): nikt nie ma dostępu do danych (tak jest już dziś – reguły wymagają członkostwa). Obcy widzi komunikat
  „To konto nie ma PIN-u…” (pkt 4). Właściciel albo ustawia PIN w konsoli (3.4), albo usuwa konto w konsoli.
- Konta bez sekretu **nie da się usunąć z aplikacji** (usunięcie wymaga żetonu poprawnego PIN-u) – najpierw „Ustaw PIN”.

### 3.4 Reset zapomnianego PIN-u (nowa procedura, tylko konsola)
Tryb `set` dla obcych znika, więc dotychczasowe „usuń secret/pin i pole pin” już nie wystarczy. Nowa procedura:
1. W przeglądarce (konsola narzędzi deweloperskich) policz skrót nowego PIN-u:
   `crypto.subtle.digest('SHA-256', new TextEncoder().encode('dziennik-silowni:ID_KONTA:1234')).then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('')))`
2. W konsoli Firebase wpisz wynik w `folders/{id}/secret/pin` → pole `hash`.
3. Jeśli PIN mógł wyciec – zwiększ o 1 pole `gen` w `folders/{id}` (typ number; brak pola = 0, więc wpisz 1). To wyloguje wszystkie urządzenia.
4. Jeśli konto jest zablokowane limitem – usuń dokument `folders/{id}/secret/gate`.
Konsola omija reguły, więc to jedyna droga „ratunkowa”. Ten opis trafia do komentarza w `firestore.rules` (linia 4) i do bloku „PIN folderu” w `app.html`.

---

## 4. Zmiany w `zrodla/src/app.html`

Zgodność w obie strony: **nowa aplikacja działa zarówno ze starymi, jak i z nowymi regułami.** Wykrywanie: odczyt
`secret/gate` przy starych regułach daje `permission-denied` (stare `secret/{doc}`: `read: false`), przy nowych – przechodzi.
Wtedy aplikacja przełącza się w tryb „stare reguły” i robi to co dziś. Ten tryb **zostaje na stałe**, żeby wycofanie reguł nie zepsuło aplikacji.

### 4.1 Nowe stałe i funkcje (blok „PIN folderu”, przy `pinHash`)
- `GATE_15 = 5`, `GATE_DAY = 10`, `GATE_15_MS = 15*60e3`, `GATE_DAY_MS = 864e5` – z komentarzem „zmieniać razem z regułami”.
- `gateRef(fid)`, `tryRef(fid)` – ścieżki.
- `gateState(g, now)` → `{fresh15, freshDay, n15, nd, waitMin, left}`; `waitMin` > 0, gdy limit wyczerpany
  (minuty do końca okna, które blokuje; zaokrąglone w górę, co najmniej 1).
- `waitText(min)` → „12 min” albo, od 60 min, „5 godz. 20 min”.
- `async pinTry(fid, hash)` – transakcja `FB.runTransaction`: `tx.get(gate)` i `tx.get(folder)` (dla `gen`), wylicza stan;
  gdy limit wyczerpany → zwraca `{limit: waitMin}` bez zapisu; inaczej `tx.set(gate, {...})` (nowe okno: `serverTimestamp()`,
  stare okno: przepisany `Timestamp` z odczytu) i `tx.set(tries/{uid}, {hash, at: serverTimestamp()})`; zwraca `{ok, gen, left}`.
  Odczyt bramki odrzucony → `{legacy: true}`. Zapis odrzucony mimo udanego odczytu (różnica zegarów na granicy okna):
  jedno ponowienie z odwróconą decyzją dla okna, którego granica jest bliżej niż 2 min; drugi błąd → `{limit: 1}`
  (a gdy konto nie ma sekretu – `{nopin: true}`, patrz 4.2).
- `async pinCheck(fid, hash)` – `pinTry`, potem `setDoc(members/{uid}, {hash, at: Date.now(), ...(gen ? {gen} : {})})`.
  Wynik: `{ok, gen}` | `{bad, left}` | `{limit}` | `{legacy, ok|bad}` (w trybie starych reguł sam `setDoc` jak dziś) | `{net}`.
- `accGen(fid)` – generacja zapisana przy kluczu `accKey(fid)`; stara wartość `true` = 0.

### 4.2 Zmieniane funkcje
- **`pinHash`** – bez zmian.
- **`pinMode(s)`** – kolejność: `del` → `change` (nowe, `s.change`) → `new` → `set` tylko gdy `s.setOwn` (członek konta bez PIN-u) →
  folder na liście: `pin ? 'enter' : 'nopin'` → brak folderu: `foldersReady ? 'gone' : 'wait'`. Tryb `set` dla obcych znika.
- **`askPin(f, isNew=false, opt={})`** – przyjmuje `opt.changed` (PIN zmieniony na innym urządzeniu) i przekazuje do arkusza.
- **`requestFolder(f, skipCheck)`** – szybka ścieżka z `LS` tylko, gdy `accGen(f.id) === (f.gen||0)`.
  Po odczycie własnego wpisu: `gen` wpisu = `gen` folderu → otwórz i zapisz `LS.set(accKey, gen)`;
  wpis istnieje, ale `gen` się różni → `askPin(f, false, {changed:true})`.
- **`watchFolders`** (fragment z `FOLDER`) – gdy otwarty folder ma inne `gen` niż `accGen` i nie trwa własna zmiana PIN-u
  (`store.pinBusy`): `closeFolder()`, `LS.del(accKey)`, `askPin(f, false, {changed:true})`. Potrzebne, bo działający
  nasłuch nie zawsze dostaje błąd od razu.
- **`openFolder`** – obsługa `permission-denied` jak dziś, ale z `askPin(f, false, {changed: (f.gen||0) !== accGen(f.id)})`.
- **`initStore`** – szybka ścieżka jak w `requestFolder` (porównanie `gen`).
- **`SHEETS.pin`** – nowe tryby `change`, `nopin`, `gone`; nowy tryb `set` (tylko członek); notka o limicie; komunikaty z 4.3.
- **`SHEETS.folders`** – w sekcji „Konto „X””: przycisk `data-act="pinChange"` „Zmień PIN i wyloguj inne urządzenia”
  (gdy `pin`), albo `data-act="pinSetOwn"` „Ustaw PIN” z krótkim opisem (gdy konto nie ma PIN-u). Bez ikony albo `svg('edit','i s')`.
- **`ACT.pinGo`** – przebudowa:
  - `enter`: `pinCheck(stary skrót)` → otwórz konto, `LS.set(accKey, gen)`.
  - `del`: `pinCheck` → `ACT.folderDeleteGo(f)` dopiero po `ok` (nic nie jest usuwane przy złym PIN-ie lub limicie).
  - `new`: batch jak dziś (folder `{name, createdAt, updatedAt, pin:true}` bez `gen`, `secret/pin`, `members` `{hash, at}`).
  - `set` (członek): batch `folder.update({pin:true, updatedAt})`, `secret/pin` set `{hash}`, `members` set `{hash, at, ...gen}`.
  - `change`: walidacja (3 pola, nowy ≠ obecny, nowy = powtórzony) → `pinCheck(skrót obecnego)` → przy `ok`
    `store.pinBusy = true`; batch: `folder.update({gen: g+1, updatedAt})`, `secret/pin.update({hash: nowy})`,
    `members` set `{hash: nowy, at, gen: g+1}` → `LS.set(accKey, g+1)`; `store.pinBusy = false`.
    W trybie starych reguł – komunikat „Zmiana PIN-u zadziała po aktualizacji bazy…”, bez zapisów.
- **`ACT.pinChange`** (nowa) – `openSheet({type:'pin', id, name, change:true, err:'', busy:false})`, fokus na `#pin0`.
- **`ACT.pinSetOwn`** (nowa) – `openSheet({type:'pin', id, name, setOwn:true, ...})`.
- **`ACT.folderDelete`** – bez zmian (tekst potwierdzenia zostaje).
- **`ACT.folderDeleteGo`** – kolejność: kody `shares` → `sessions` → `diet` → `data/diet`, `data/state` →
  **jeden batch**: delete `folders/{id}`, `secret/pin`, `secret/gate` → potem własne `members/{uid}` i `tries/{uid}`.
  (Dziś folder i sekret usuwane osobno, sekret po folderze – przy nowych regułach to by nie przeszło.)
- **`ACT.folderCreate`, `ACT.folderOpen`, `ACT.folderSwitch`** – bez zmian w logice.
- Obsługa Enter (linia ~3364): dodać pole `pin0` (obecny PIN) w kolejności `pin0 → pin1 → pin2 → pinGo`.
- Komentarz bloku „PIN folderu” – opis bramki, żetonu, generacji i procedury z 3.4.
- `CLAUDE.md` (sekcja o Firebase) – dopisać `secret/gate`, `tries/{uid}`, `gen`, nowe nazwy funkcji (`pinTry`, `pinCheck`, `gateState`, ACT `pinChange`, `pinSetOwn`) i nową procedurę resetu.

### 4.3 Teksty (po polsku)
| Gdzie | Tekst |
|---|---|
| Limit (okno < 60 min) | „Za dużo prób. Spróbuj za 12 min.” |
| Limit (≥ 60 min) | „Za dużo prób. Spróbuj za 5 godz. 20 min.” |
| Zły PIN, są próby | „Zły PIN. Pozostało prób: 3.” |
| Zły PIN, to była ostatnia w oknie | „Zły PIN. Następna próba za 15 min.” (minuty z `gateState`) |
| Notka w trybie `enter` | „Ze względów bezpieczeństwa możesz spróbować 5 razy w ciągu 15 minut i 10 razy w ciągu doby.” |
| `enter` po zmianie PIN-u gdzie indziej | „PIN do konta „X” został zmieniony na innym urządzeniu. Podaj nowy PIN.” |
| `enter`, zapomniany PIN | „Nie pamiętasz PIN-u? Właściciel aplikacji może ustawić nowy – dane zostaną.” |
| `nopin` (obcy) | Tytuł „Konto bez PIN-u”; „Konto „X” nie ma jeszcze PIN-u. Ustawić go może urządzenie, na którym to konto jest już otwarte, albo właściciel aplikacji.” Przycisk tylko „Zamknij”. |
| `gone` | „Tego konta już nie ma.” |
| `set` (członek) | Tytuł „Ustaw PIN”; „Konto „X” nie ma PIN-u. Ustaw 4 cyfry – od teraz nowe telefony i przeglądarki otworzą je tylko po podaniu PIN-u.” |
| `change` | Tytuł „Zmień PIN”; „Podaj obecny PIN i nowy. Pozostałe urządzenia zostaną wylogowane z konta „X” i będą musiały podać nowy PIN.” Pola: „Obecny PIN”, „Nowy PIN”, „Powtórz nowy PIN”. Przycisk „Zmień PIN”. |
| `change`, błędy | „Nowy PIN musi różnić się od obecnego.” / „Zły obecny PIN. Pozostało prób: 2.” / „Zmiana PIN-u zadziała po aktualizacji bazy. Spróbuj później.” |
| `change`, sukces (toast) | „PIN zmieniony. Pozostałe urządzenia muszą podać nowy PIN.” |
| `set`, błąd | „Nie udało się ustawić PIN-u. Odśwież stronę i spróbuj ponownie.” |
| Konto bez sekretu, a `pin: true` | „Nie udało się sprawdzić PIN-u. Poproś właściciela aplikacji o sprawdzenie tego konta.” |
| Bez zmian | „PIN to dokładnie 4 cyfry.”, „PIN-y się różnią. Wpisz ten sam dwa razy.”, „Nie udało się połączyć z bazą. Sprawdź internet i spróbuj ponownie.” |
| Znika | „Ktoś przed chwilą ustawił PIN do tego konta. Wpisz go.” i obecny tekst trybu `set` dla obcych. |

Odmiana „próba/próby/prób” niepotrzebna dzięki formie „Pozostało prób: N”.

---

## 5. Testy emulatora (`testy-regul/regul.test.js`)

Nowe pomocnicze: `serverTimestamp`, `Timestamp`, `runTransaction` z `firebase/firestore`;
`proba(db, uid, hash)` – ta sama transakcja co `pinTry` w aplikacji; `wejdz(db, uid, hash, gen)` – zapis `members`;
`seedGate(db, {n15, w15Min, nd, wdMin})` – bramka z czasami „N minut temu” (`Timestamp.fromMillis(Date.now() - …)`);
`seedFolder` – dotychczasowy (wpis członka **bez** `gen` = dane sprzed A3), plus opcja `gen`.
Zasada pliku bez zmian: każdy „tak” ma parę „nie”.

### 5.1 Wymagane przypadki
| # | Opis testu | Oczekiwanie |
|---|---|---|
| 1 | Zły skrót: próba przez bramkę z błędnym skrótem, potem `members` z tym skrótem | próba – tak; wpis – **nie** |
| 2a | 5 prób w 15 min (każda przez bramkę) – tak; **szósta** – nie | 5× tak, 6. nie |
| 2b | Bramka: okno 15 min wygasło (`w15` 20 min temu, `n15` 5), `nd` = 10 w bieżącej dobie → **jedenasta** próba – nie; para: `nd` = 9 → tak | nie / tak |
| 2c | Okno 15 min wygasło (`w15` 16 min temu, `n15` 5, `nd` 5) → próba tak, a `n15` po zapisie = 1; doba wygasła (`wd` 25 h temu, `nd` 10) → tak | tak |
| 3 | Poprawny PIN po żetonie: próba z dobrym skrótem, potem `members` | tak, i odczyt `data/state` – tak |
| 4a | Wpis `members` bez żetonu (dobry skrót) | nie |
| 4b | Żeton i wpis w **jednym** zapisie grupowym (bramka + tries + members) | nie |
| 4c | Żeton starszy niż 15 min (seed `at` 16 min temu) | nie |
| 4d | Żeton z innym skrótem niż wpis | nie |
| 5a | Nowe konto: batch folder (`pin:true`) + `secret/pin` + `members` | tak; członek czyta `data/state` |
| 5b | Sam folder bez sekretu; folder z `pin:false`; folder z `gen: 1`; sekret bez folderu w batchu | nie |
| 6 | Dotychczasowy członek (wpis `{hash, at}` bez `gen`, folder bez `gen`) czyta i zapisuje `data`, `sessions`, `diet`, tworzy `shares`, zmienia nazwę folderu | tak |
| 7a | Zmiana PIN-u: członek, żeton obecnego PIN-u, batch (folder `gen`+1, `secret/pin` nowy, własny `members` z nowym `gen`) | tak |
| 7b | Po 7a: drugi, stary wpis (`gen` 0) czyta `data/state`, zapisuje `sessions` | **nie**; po próbie z nowym PIN-em i wpisie z `gen` 1 – tak |
| 7c | Zmiana bez żetonu; z żetonem złego obecnego PIN-u; przez nie-członka; `gen` +2; `gen` +1 bez zmiany sekretu; nowy skrót = stary | nie |
| 7d | Członek przepisuje własny wpis z dobrym skrótem bez żetonu i bez zmiany sekretu (wyrocznia PIN-u) | nie |
| 8a | Sekret na cudzym, istniejącym koncie: create przez obcego (konto bez sekretu) | nie |
| 8b | Usunięcie sekretu: obcy – nie; członek bez usuwania folderu – nie | nie |
| 8c | Członek konta bez sekretu ustawia PIN (batch folder `pin:true` + `secret/pin` + `members`) | tak |
| 9a | Usunięcie konta: żeton z poprawnym PIN-em, batch (folder + `secret/pin` + `secret/gate`) | tak |
| 9b | Usunięcie folderu bez żetonu; z żetonem złego PIN-u; bez usunięcia `secret/pin` w batchu; przez obcego | nie |

### 5.2 Bramka i żeton – przypadki uzupełniające
- `secret/gate`: `get` zalogowany – tak; niezalogowany – nie; `list` na `secret` – nie; `secret/pin` `get` – nadal nie (także członek).
- Create bramki z `n15: 2`; z `at` ustawionym przez klienta (nie `serverTimestamp`); na koncie bez `secret/pin` – nie.
- Update bramki: `n15` +2; reset `n15` do 1 w trwającym oknie; przesunięcie `w15` w trwającym oknie; dodatkowe pole – nie.
- Bramka zwiększona bez żetonu – tak (pali tylko limit); żeton bez zwiększenia bramki – nie; żeton na cudzy `uid` – nie;
  odczyt `tries` – nie (także własny); usunięcie własnego żetonu – tak, cudzego – nie.
- Usunięcie bramki: obcy – nie; członek bez usuwania folderu – nie; w batchu z 9a – tak.

### 5.3 Zmiany w istniejących testach
| Test (obecny) | Po A3 |
|---|---|
| `folders`: „utworzenie folderu: zalogowany z poprawnymi polami – tak” | zastąpiony przez 5a/5b |
| `folders`: „usunięcie folderu: członek – tak; obcy – nie” | zastąpiony przez 9a/9b |
| `secret/pin`: „utworzenie: zalogowany, doc „pin”… – tak” | zastąpiony przez 5a (nowe konto) i 8a (istniejące konto – nie) |
| `secret/pin`: „utworzenie: hash innej długości… – nie” | zostaje, w kontekście batcha nowego konta |
| `secret/pin`: „zmiana (update): nikt, także członek – nie” | zastąpiony przez 7a/7c |
| `secret/pin`: „usunięcie: członek – tak; obcy – nie” | zastąpiony przez 8b/9a |
| `members`: „dołączenie z hashem zgodnym – tak; z błędnym – nie” | przez żeton (1, 3, 4a) |
| `members`: cudzy uid, bez logowania, dodatkowe pole, odczyt, lista | zostają (dodatkowe pole: dopuszczalne `gen`, niedopuszczalne inne) |
| `data`, `diet`, `sessions`, `shares`, `foods` | bez zmian (członek z seeda nie ma `gen` – to jednocześnie test 6) |

### 5.4 Blok „znane dziury”
| Test | Po A3 |
|---|---|
| E1-01 „brak limitu prób PIN-u…” | **odwrócony** i przeniesiony do `members`: 5 błędnych prób przez bramkę, 6. próba (nawet z dobrym skrótem) – nie, wpis z dobrym skrótem – nie |
| E1-02 „sekret konta bez PIN-u może utworzyć dowolne urządzenie…” | **odwrócony**: create sekretu przez obcego – nie; wpis `members` – nie; odczyt `data/state` – nie |
| E1-02 „członek usuwa secret/pin, a nowe urządzenie zakłada go znowu…” | **odwrócony**: usunięcie sekretu przez członka – nie; create przez obcego – nie |
| E1-03 „produkt we wspólnej bazie (foods) utworzy każde anonimowe urządzenie” | **zostaje bez zmian** w bloku „znane dziury poza A3” – patrz pytanie 1 na końcu |

Blok „znane dziury, do odwrócenia po zleceniu A3” znika; trzy odwrócone testy dostają nazwy bez „[znany błąd do naprawy]”.

---

## 6. Kolejność wdrożenia

**Najpierw aplikacja, potem reguły.**

Dlaczego:
- Nowa aplikacja działa ze starymi regułami (tryb wykrywany odczytem bramki), więc jej wdrożenie nic nie psuje.
- Stara aplikacja z nowymi regułami nie zaloguje nowego urządzenia (napisze „Zły PIN”, bo nie zna bramki)
  i nie usunie konta (odpadnie na sprawdzeniu PIN-u, **zanim** cokolwiek usunie). Zakładanie konta działa.
  Dlatego reguły idą dopiero, gdy wszystkie urządzenia mają nową wersję strony.

Kroki:
0. **Przed wszystkim (właściciel, konsola):** lista kont bez `pin: true` / bez `secret/pin` (3.3). Decyzja: PIN w konsoli albo usunięcie.
1. **Commit A3a – aplikacja** (Sonnet): `zrodla/src/app.html` + `CLAUDE.md` → `build_web` → test Playwright (jasny/ciemny, 390 px,
   arkusze `pin` we wszystkich trybach, `folders`) → push `main` → „Strona siłownia” wdraża ok. 1 min.
   Reguły bez zmian, więc workflow reguł nie rusza.
2. **Odświeżenie urządzeń:** na każdym telefonie/laptopie otworzyć stronę i przeładować (service worker). Znak nowej wersji:
   w ustawieniach konta jest przycisk „Zmień PIN i wyloguj inne urządzenia” (przed krokiem 3 jego użycie da komunikat
   „Zmiana PIN-u zadziała po aktualizacji bazy”). Odczekać, aż wszyscy użytkownicy otworzą aplikację (najlepiej dobę).
3. **Commit A3b – reguły i testy w jednym commicie** (wymóg `CLAUDE.md`) na gałęzi `a3-reguly` → pull request.
   W PR rusza tylko zadanie „test” (deploy nigdy w PR). Zielony test = reguły sprawdzone na emulatorze, nic nie czeka na zatwierdzenie.
4. **Scalenie PR do `main`** (właściciel, po kroku 2). Push zmienia `firestore.rules` → „test” jeszcze raz → zadanie „deploy”
   czeka w środowisku „produkcja” → **właściciel zatwierdza** (Review deployments). Sprawdzenie:
   `gh run list -R Kiwwi0/dziennik-silowni -w rules.yml -L 1` (najpierw „waiting”, po zatwierdzeniu „completed / success”).
5. Sprawdzenia z pkt 7.

Wycofanie:
- **Reguły:** `git revert` commitu scalającego A3b → push `main` → test (stare testy pasują do starych reguł) → zatwierdzenie.
  Aplikacja sama wraca do trybu starych reguł – nie trzeba jej cofać. W nagłym wypadku właściciel może przywrócić poprzednią
  wersję reguł w konsoli Firebase (Firestore → Reguły → historia), a potem i tak zrobić revert w repozytorium, żeby się zgadzało.
- Skutki wycofania: dokumenty `secret/gate` i `tries/*` zostają (niegroźne). Konta, na których zmieniono PIN, mają `gen` > 0 –
  stare `validFolder` nie zna tego pola, więc zmiana nazwy takiego konta przestanie działać, a urządzenia wylogowane zmianą PIN-u
  **odzyskają dostęp** (stare `isMember` sprawdza tylko istnienie wpisu). **OBOWIĄZKOWE** kroki po wycofaniu, w tej kolejności:
  1. wycofanie reguł (revert + zatwierdzenie wdrożenia);
  2. usunięcie pola `gen` w dokumentach `folders/{id}` tych kont, które je mają (konsola Firebase);
  3. dopiero potem usunięcie wpisów `members` urządzeń, które miały być wylogowane.
  Bez kroku 2 nowa aplikacja po cofnięciu reguł sama próbuje wejść bez pola `gen` (tryb zgodności w `pinCheck`: jedna próba bez `gen`),
  ale konto z `gen` > 0 nadal ma niespójne dane (zmiana nazwy nie przejdzie).
- **Aplikacja:** cofać tylko po wycofaniu reguł (stara aplikacja z nowymi regułami – patrz wyżej). Zwykle niepotrzebne.

---

## 7. Co właściciel sprawdza po wdrożeniu (telefon + drugie urządzenie)

Do testów limitu i zmiany PIN-u **załóż konto testowe** (np. „Test A3”) – limit zablokowałby prawdziwe konto nawet na dobę.

Telefon (już zalogowany przed wdrożeniem):
1. Otwiera się własne konto bez pytania o PIN; plany i historia widoczne; zapis serii/treningu działa; dieta działa.
2. Udostępnianie planu (kod) działa.

Drugie urządzenie (laptop, okno prywatne = nowe urządzenie):
3. Wybór prawdziwego konta → zły PIN → „Zły PIN. Pozostało prób: 4.” → dobry PIN → konto się otwiera.
4. Konto „Test A3”: 5 złych PIN-ów → szósta próba pokazuje „Za dużo prób. Spróbuj za 15 min” (lub mniej). Telefon z otwartym
   kontem testowym działa dalej.
5. Po 15 min: dobry PIN na koncie testowym → otwiera się.

Zmiana PIN-u (konto testowe otwarte na obu urządzeniach):
6. Telefon: „Zmień PIN i wyloguj inne urządzenia” → zły obecny PIN → komunikat; dobry → „PIN zmieniony…”.
7. Laptop: po chwili (albo po przeładowaniu) prosi o PIN z dopiskiem „PIN … został zmieniony na innym urządzeniu”;
   stary PIN – zły; nowy – otwiera.

Zakładanie i usuwanie:
8. Nowe konto na laptopie (nowe imię + PIN) – powstaje i się otwiera.
9. Usunięcie konta testowego z PIN-em (jeśli limit dobowy został zużyty w p. 4 – usuń `secret/gate` w konsoli albo poczekaj).
   W konsoli: brak `folders/{test}`, `secret/pin`, `secret/gate`.
10. Konsola Firebase: przy prawdziwym koncie po p. 3 istnieje `secret/gate` z liczbami prób i czasami; brak pola `gen` u kont,
    na których nie zmieniano PIN-u.
11. Jeśli w kroku 0 było konto bez PIN-u: obce urządzenie widzi „Konto bez PIN-u…”, a nie formularz ustawiania.

---

## 8. Kod zaproszenia przy zakładaniu konta (E1-04) – tylko wycena

Wykonalne w tym samym modelu bez funkcji w chmurze: skrót kodu w `config/invite` (nieczytelny), a batch nowego konta dokłada
`folders/{id}/secret/invite` ze skrótem wpisanym przez osobę zakładającą; reguła `folders` create porównuje go z `config/invite`
(+1–2 odczyty, batch nowego konta nadal < 20). Kod musi być długi (np. 8 losowych znaków), bo próby zakładania nie mają bramki;
zmiana kodu = edycja `config/invite` w konsoli. Koszt: ok. 1 krótka sesja Sonnet (pole w „Nowa osoba”, jeden zapis w batchu,
komunikat „Zły kod zaproszenia”), 4–5 testów i jedno zatwierdzenie reguł; nowe osoby muszą dostać kod od właściciela.
Najtaniej zrobić to razem z A3b (ten sam blok `folders` create), ale tylko po osobnej decyzji – ten plan tego nie zawiera.

---

## 9. Ryzyka, które zostają

1. **Blokada przez obcego (świadomie przyjęta):** każdy zalogowany może wyczerpać limit konta i na dobę zablokować logowanie
   nowych urządzeń, **usunięcie konta i zmianę PIN-u** (obie wymagają próby przez bramkę). Zalogowane urządzenia działają.
   Ratunek: usunięcie `secret/gate` w konsoli.
2. **Zgadywanie nadal możliwe, tylko wolne:** 10 prób na dobę → średnio ok. 500 dni na trafienie losowego PIN-u, ale PIN-y typu
   1234/0000/rok urodzenia padną w pierwszych dniach. Zalecenie dla użytkowników: nie używać takich PIN-ów (bez blokady w aplikacji).
3. **Liczniki widoczne:** bramka ujawnia, ile prób było na koncie i kiedy (bez skrótów).
4. **Okres przejściowy:** stara wersja strony z cache po wdrożeniu reguł nie zaloguje nowego urządzenia („Zły PIN”) – stąd odstęp w kroku 2.
5. **Wycofanie reguł** po zmianie PIN-u przywraca dostęp wylogowanym urządzeniom (pkt 6).
6. **Śmieci:** wpisy `members` i `tries` innych urządzeń zostają po usunięciu konta (tak jak dziś `members`); reguły nie pozwalają
   ich usunąć z cudzego urządzenia. Dane przerwanego usuwania (np. brak internetu w połowie) zostają do sprzątnięcia w konsoli.
7. **Odbieranie dostępu tylko „wszystkim naraz”:** zmiana PIN-u wylogowuje wszystkie inne urządzenia; pojedynczego urządzenia
   wylogować się nie da (zgodnie z P8).
8. **Skradzione, zalogowane urządzenie** ma pełny dostęp do danych do czasu zmiany PIN-u na innym urządzeniu; PIN-u z niego
   nie wyciągnie szybciej niż przez bramkę.
