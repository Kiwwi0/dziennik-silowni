#!/usr/bin/env python3
"""Test dymny aplikacji „Dziennik siłowni” (Playwright).

Uruchomienie z katalogu repozytorium:   python3 testy/dymny/dymny.py
Opcje:  --silniki chromium,webkit   --zrzuty KATALOG   --chrome ŚCIEŻKA   --wymagaj-wszystkich

Co robi: buduje wersję testową (`python3 -I zrodla/build.py` → zrodla/dist/index.html), podaje ją stronie przez page.route
(szkielet z regułą [hidden], jak w prawdziwej stronie), a potem w każdej konfiguracji (silnik × urządzenie × motyw)
przechodzi scenariusz: dane z planu fbw2, wszystkie zakładki, dwa treningi od „Start” do zapisu (z odświeżeniem strony
i sprawdzeniem trwałości), wpis i cele w Diecie. Dodatkowa konfiguracja ładuje prawdziwą stronę web/index.html.
Po każdym kroku sprawdza: brak błędów strony (pageerror), brak przewijania w bok (względem szerokości okna z viewport_size),
brak „NaN” i „undefined” na ekranie i w polach input/textarea, brak prób połączenia z Firebase (w konfiguracji web/ tylko
zliczane); na końcu jeszcze raz strażnicy po krótkim odczekaniu (późny pageerror). Zrzuty ekranu idą do katalogu zrzuty/ (artefakt w Actions).

Kroki „zapis: …” (A6) podstawiają sztuczny Firebase (zapis scalający, kolejka, nieudany zapis treningu, stara karta); krok „kopia zapasowa”
porównuje eksport i import z plikiem testy/zapis/kopia_przed.json (eksport wykonany kodem z `main` @ e82b8c6 na stanie z kopia_stan.json).

Nowy błąd = nowy krok w tym teście. Błąd samej aplikacji, którego nie naprawiamy od razu, wpisz do ZNANE_BLEDY
(krok, kod kontroli → numer i opis); taki krok kończy się „ZNANY BŁĄD” zamiast czerwonego wyniku.
"""
import argparse
import json
import mimetypes
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import Error as PWError
from playwright.sync_api import TimeoutError as PWTimeout
from playwright.sync_api import expect, sync_playwright

KATALOG = Path(__file__).resolve().parent
REPO = KATALOG.parents[1]
BASE = 'https://dziennik.test'          # adres udawany przez page.route; nic nie wychodzi do prawdziwej sieci
KROK_TIMEOUT_MS = 10_000                 # czekamy na elementy, nie na czas; po 10 s krok uznajemy za zepsuty

# Szkielet strony: reguła [hidden] jest w prawdziwej stronie (build_web), bez niej ukryta warstwa arkuszy zasłania przyciski.
SZKIELET = ('<!doctype html><html lang="pl"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<style>[hidden]{display:none!important}</style></head><body>')

# Znane błędy aplikacji: (nazwa kroku, kod kontroli) → "numer: opis". Kody: krok, pageerror, przewijanie, napis, firebase.
ZNANE_BLEDY = {}


# Sztuczny Firebase dla kroków „zapis: …”: dokument stanu, treningi, zapis scalający (mergeFields + deleteField), transakcja, nasłuchy.
# Nic nie wychodzi do sieci. Prawdziwej bazy (SDK, pamięć podręczna, tryb samolotowy) ten test NIE sprawdza.
SZTUCZNY_FIREBASE = r"""() => {
  const cl = v => JSON.parse(JSON.stringify(v));
  const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sorted(v[k]), o), {}) : v;
  const DEL = {__fdel:true};
  const sv = window.__sv = {doc:null, sess:{}, st:[], se:[], fail:false, log:[], delay:5, zawies:false, wstrzymane:[]};
  const setPath = (obj, parts, val) => { for (let i = 0; i < parts.length - 1; i++){ if (!obj[parts[i]] || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {}; obj = obj[parts[i]]; } const k = parts[parts.length - 1]; if (val === DEL) delete obj[k]; else obj[k] = cl(val); };
  const snapOf = () => ({exists:() => !!sv.doc, data:() => sorted(cl(sv.doc)), metadata:{fromCache:false, hasPendingWrites:false}});
  Object.assign(FB, {
    db:{fake:true}, uid:'u1',
    doc:(db, ...p) => ({kind:'doc', path:p.join('/')}), collection:(db, ...p) => ({kind:'col', path:p.join('/')}),
    query:c => ({kind:'query', path:c.path}), orderBy:() => 0, limit:() => 0, where:() => 0, startAt:() => 0, endAt:() => 0,
    deleteField:() => DEL, serverTimestamp:() => 0, increment:() => 0,
    setDoc:(ref, data, opts) => new Promise((res, rej) => setTimeout(() => {
      if (sv.fail) return rej(new Error('sztuczny błąd zapisu'));
      try {
        if (/\/data\/state$/.test(ref.path)){
          sv.log.push('SETDOC');   // A6f: aplikacja nie może zapisywać data/state przez setDoc (bez warunku) – kroki „zapis: …” sprawdzają, że tego wpisu nie ma
          if (opts && opts.mergeFields){ if (!sv.doc) sv.doc = {}; for (const f of opts.mergeFields){ let v = data; for (const q of f.split('.')) v = v == null ? undefined : v[q]; if (v === undefined) throw new Error('brak wartości dla ' + f); setPath(sv.doc, f.split('.'), v); } }
          else sv.doc = cl(data);
        } else if (/\/sessions\/[^/]+$/.test(ref.path)) sv.sess[ref.path.split('/').pop()] = cl(data);
        res();
      } catch (e){ rej(e); }
    }, sv.delay)),
    writeBatch:() => ({delete(){}, commit:async () => {}}),
    deleteDoc:ref => Promise.resolve().then(() => { if (/\/sessions\//.test(ref.path)) delete sv.sess[ref.path.split('/').pop()]; }),
    getDocs:async () => ({docs:[], empty:true}), getDoc:async () => ({exists:() => false}),
    // Transakcja jak w SDK: odczyt, funkcja, zatwierdzenie po sv.delay ms; jeśli dokument zmienił się w tym czasie (sv.konflikt – „inny zapis” wstrzyknięty przez test),
    // funkcja jest wywoływana ponownie na świeżym dokumencie (do 5 razy). tx.set z {mergeFields} zapisuje tylko wskazane pola (deleteField usuwa), bez opcji – cały dokument.
    // sv.zawies = true (A6g): transakcja wisi (nie kończy się ani błędem, ani wynikiem), dopóki test nie wywoła jej z sv.wstrzymane.
    runTransaction:(db, fn) => sv.zawies ? new Promise((res, rej) => sv.wstrzymane.push(() => sv.wykonaj(fn).then(res, rej))) : sv.wykonaj(fn),
  });
  sv.wykonaj = fn => new Promise(async (res, rej) => {
      for (let proba = 0; proba < 5; proba++){
        if (sv.fail) return rej(new Error('sztuczny brak sieci'));
        const przed = JSON.stringify(sv.doc), pend = [], tx = {get:async () => snapOf(), set:(ref, data, opts) => pend.push({set:data, opts}), update:(ref, data) => pend.push({upd:data})};
        let r; try { r = await fn(tx); } catch (e){ return rej(e); }
        await new Promise(ok => setTimeout(ok, sv.delay));
        if (sv.konflikt){ const k = sv.konflikt; sv.konflikt = null; k(); }
        if (JSON.stringify(sv.doc) !== przed){ sv.log.push('tx-retry'); continue; }
        try {
          for (const d of pend){
            if (d.set && d.opts && d.opts.mergeFields){ if (!sv.doc) sv.doc = {}; for (const f of d.opts.mergeFields){ let v = d.set; for (const q of f.split('.')) v = v == null ? undefined : v[q]; if (v === undefined) throw new Error('brak wartości dla ' + f); setPath(sv.doc, f.split('.'), v); } sv.log.push('tx:mf'); }
            else if (d.set){ sv.doc = cl(d.set); sv.log.push('tx'); }
            else { for (const [k, v] of Object.entries(d.upd)) setPath(sv.doc, k.split('.'), v); sv.log.push('txu'); }
          }
        } catch (e){ return rej(e); }
        return res(r);
      }
      rej(new Error('sztuczna transakcja: za dużo konfliktów'));
    });
  Object.assign(FB, {
    onSnapshot:(target, ...a) => {
      const cb = a.find(x => typeof x === 'function'), e = {target, cb};
      const list = target.kind === 'doc' && /\/data\/state$/.test(target.path) ? sv.st : target.kind === 'query' && /\/sessions$/.test(target.path) ? sv.se : [];
      list.push(e); return () => { const i = list.indexOf(e); if (i >= 0) list.splice(i, 1); };
    },
  });
  sv.emit = () => {
    for (const e of sv.st.slice()) e.cb(snapOf());
    for (const e of sv.se.slice()) e.cb({empty:!Object.keys(sv.sess).length, docs:Object.entries(sv.sess).map(([id, d]) => ({id, data:() => cl(d), metadata:{hasPendingWrites:false}})), metadata:{fromCache:false, hasPendingWrites:false}});
  };
  return true;
}"""

MOTYWY = {'jasny': 'light', 'ciemny': 'dark'}
FIREBASE = re.compile(r'firebase|firestore|identitytoolkit|securetoken|googleapis\.com/(?!css)', re.I)
NAPIS_ZLY = re.compile(r'NaN|undefined')   # bez granic słów: „5undefined” albo „FBW Aundefined” też jest błędem


def skroc(e):
    """Pierwsza linia błędu Playwrighta plus linia z selektorem (żeby było widać, na czym krok stanął)."""
    linie = [l.strip() for l in str(e).splitlines() if l.strip()] or [repr(e)]
    sel = next((l for l in linie[1:] if 'locator(' in l or 'Locator:' in l or 'waiting for' in l), '')
    return (linie[0] + (' — ' + sel if sel else ''))[:300]


class Porazka(Exception):
    pass


def urzadzenia(p):
    """Dwa urządzenia: iPhone 11 Pro (375 px, dotyk) i 390×844. `default_browser_type` nie jest opcją kontekstu."""
    iphone = {k: v for k, v in p.devices['iPhone 11 Pro'].items() if k != 'default_browser_type'}
    return {
        'iPhone 11 Pro': iphone,
        '390x844': {'viewport': {'width': 390, 'height': 844}, 'device_scale_factor': 3, 'is_mobile': True, 'has_touch': True},
    }


def zbuduj():
    t = time.time()
    r = subprocess.run([sys.executable, '-I', 'zrodla/build.py'], cwd=REPO, capture_output=True, text=True)
    if r.returncode:
        sys.exit('Budowanie wersji testowej nie powiodło się:\n' + r.stdout + r.stderr)
    html = (REPO / 'zrodla' / 'dist' / 'index.html').read_text(encoding='utf-8')
    print(f'Zbudowano wersję testową ({len(html) // 1024} KB, {time.time() - t:.1f} s)')
    return SZKIELET + html + '</body></html>'


class Przebieg:
    """Jedna konfiguracja: silnik · urządzenie · motyw. Każdy krok sprawdza strażników i robi zrzut."""

    def __init__(self, page, nazwa, strona_html, dzien_zrzutow, motyw, web=False):
        self.page, self.nazwa, self.motyw, self.web = page, nazwa, motyw, web   # web: strona z web/ (z Firebase, które w teście jest odcięte)
        self.zrzuty = dzien_zrzutow
        self.zrzuty.mkdir(parents=True, exist_ok=True)
        self.n = 0
        self.bledy_strony = []
        self.firebase = []
        self.znane = []
        self.dotyk = True   # obie konfiguracje mają dotyk (has_touch)
        page.set_default_timeout(KROK_TIMEOUT_MS)
        page.on('pageerror', lambda e: self.bledy_strony.append(str(e)))
        page.route('**/*', lambda route: self._trasa(route, strona_html))

    def _trasa(self, route, html):
        url = route.request.url
        if self.web and url.startswith(BASE + '/'):
            sciezka = url[len(BASE) + 1:].split('?')[0].split('#')[0] or 'index.html'
            plik = (REPO / 'web' / sciezka).resolve()
            if plik.is_file() and REPO / 'web' in plik.parents:
                typ = mimetypes.guess_type(plik.name)[0] or 'application/octet-stream'
                route.fulfill(status=200, content_type=typ, body=plik.read_bytes())
            else:
                route.fulfill(status=404, body='')
        elif url.rstrip('/') == BASE:
            route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)
        elif url.startswith(BASE + '/'):
            route.fulfill(status=404, body='')
        else:
            if FIREBASE.search(url):
                self.firebase.append(url)
            route.abort()   # czcionki Google itp. i tak odpadają, test ma być powtarzalny

    # ---- pomocnicze ----
    def klik(self, selektor, **kw):
        loc = self.page.locator(selektor).first if isinstance(selektor, str) else selektor
        loc.tap(**kw) if self.dotyk else loc.click(**kw)

    def zrzut(self, nazwa):
        self.n += 1
        self.page.screenshot(path=str(self.zrzuty / f'{self.n:02d}-{nazwa}.png'))

    def straznicy(self):
        """Zwraca listę (kod, opis) naruszeń na bieżącym ekranie."""
        out = []
        if self.bledy_strony:
            out.append(('pageerror', 'błąd strony: ' + ' | '.join(self.bledy_strony[:3])))
        if self.firebase and not self.web:   # prawdziwa strona próbuje wczytać Firebase; tu tylko to liczymy (wypisuje uruchom_silnik)
            out.append(('firebase', 'próba połączenia z Firebase: ' + ', '.join(self.firebase[:3])))
        szer = self.page.viewport_size['width']   # przy is_mobile=True innerWidth rozszerza się do treści, więc porównujemy z oknem
        w = self.page.evaluate('''(vw) => {
            const wid = (el) => el && !el.hidden && el.getClientRects().length > 0;
            const over = [];
            if (document.documentElement.scrollWidth > vw) over.push('strona ' + document.documentElement.scrollWidth + ' > ' + vw);
            for (const id of ['workout', 'sheet']) { const el = document.getElementById(id); if (wid(el) && el.scrollWidth > el.clientWidth) over.push('#' + id + ' ' + el.scrollWidth + ' > ' + el.clientWidth); }
            const pola = [...document.querySelectorAll('input, textarea')].map(el => (el.id || el.name || el.tagName) + '=' + el.value).join('\\n');
            return {over, text: document.body.innerText, pola};
        }''', szer)
        if w['over']:
            out.append(('przewijanie', 'przewijanie w bok: ' + '; '.join(w['over'])))
        m = NAPIS_ZLY.search(w['pola'])
        if m:
            i = m.start()
            out.append(('napis', f'w polu formularza jest „{m.group(0)}”: …{w["pola"][max(0, i - 40):i + 40]!r}…'))
        m = NAPIS_ZLY.search(w['text'])
        if m:
            i = m.start()
            out.append(('napis', f'na ekranie jest „{m.group(0)}”: …{w["text"][max(0, i - 40):i + 40]!r}…'))
        return out

    def krok(self, nazwa, fn, zrzut=None):
        """Wykonuje krok, potem strażników. Pierwsze naruszenie niezgłoszone jako znane błąd przerywa konfigurację."""
        t = time.time()
        naruszenia = []
        try:
            fn()
        except (PWTimeout, PWError, AssertionError) as e:
            naruszenia.append(('krok', skroc(e)))
        try:
            naruszenia += self.straznicy()
        except PWError as e:
            naruszenia.append(('krok', 'nie da się sprawdzić ekranu: ' + str(e).splitlines()[0]))
        if zrzut:
            try:
                self.zrzut(zrzut)
            except PWError:
                pass
        niezgloszone = [(k, o) for k, o in naruszenia if not ZNANE_BLEDY.get((nazwa, k))]
        if niezgloszone:   # jedna czytelna wiadomość: krok, konfiguracja i wszystkie wykryte naruszenia (np. błąd strony + brak elementu)
            raise Porazka(f'krok „{nazwa}” w konfiguracji [{self.nazwa}]: ' + ' || '.join(o for _, o in niezgloszone))
        for kod, opis in naruszenia:
            znany = ZNANE_BLEDY.get((nazwa, kod))
            if znany:
                self.znane.append((nazwa, znany))
                print(f'    ZNANY BŁĄD {znany}  (krok „{nazwa}”: {opis})')
                if kod in ('pageerror',):
                    self.bledy_strony.clear()
                if kod == 'firebase':
                    self.firebase.clear()
                continue
        print(f'    ok  {nazwa} ({time.time() - t:.1f} s)')


def bez_spacji(t):
    return re.sub(r'\s+', '', t)


def scenariusz_web(r):
    """Prawdziwa strona (web/index.html) wymaga Firebase, którego test nie ma (sieć odcięta), więc kończy na wyborze konta:
    sprawdzamy, że się uruchamia (brak pageerror, brak przewijania, brak NaN/undefined), prosi o konto i próbuje wczytać Firebase."""
    page = r.page

    def start():
        page.goto(BASE + '/', wait_until='load')
        expect(page.locator('body')).to_contain_text('Wybierz swoje konto')
        expect(page.locator('body')).to_contain_text('Nie udało się połączyć z bazą')
        assert any('firebase-app.js' in u for u in r.firebase), 'web/index.html nie próbował wczytać Firebase (zła strona w teście?)'
    r.krok('web/: start strony (wybór konta, Firebase odcięty)', start, 'web-start')

    def pozno():
        page.wait_for_timeout(1500)
    r.krok('web/: koniec, odczekanie i ponowna kontrola strażników', pozno, 'web-koniec')


def scenariusz(r):
    if r.web:
        return scenariusz_web(r)
    page = r.page
    ukryte = lambda sel: expect(page.locator(sel)).to_be_hidden()
    widoczne = lambda sel: expect(page.locator(sel).first).to_be_visible()
    zakladka = lambda id_: (r.klik(f'#tabbar a[href="#{id_}"]'), expect(page.locator(f'#tabbar a[href="#{id_}"]')).to_have_attribute('aria-current', 'page'))

    def plan_testowy(widok_start=True):
        # ciężar 20 kg w każdej serii, żeby objętość treningu była niezerowa (szablon ma kg = null)
        n = page.evaluate("() => { S.plans = templatePlans(TEMPLATES.find(t => t.id === 'fbw2')); S.plans.forEach(d => d.items.forEach(i => i.sets.forEach(q => { q.kg = 20; }))); render(); return S.plans.length; }")
        assert n == 2, f'plan fbw2 ma {n} dni zamiast 2'
        if widok_start:   # po odświeżeniu otwarta jest zakładka Historia, więc przycisków „Start” tam nie ma
            expect(page.locator('[data-act="startPlan"]')).to_have_count(2)

    def start():
        page.goto(BASE + '/', wait_until='load')
        expect(page.locator('#tabbar a.tab')).to_have_count(5)
        expect(page.locator('#view')).to_contain_text('Zacznij od planu')
        ciemny = page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
        assert ciemny == (r.motyw == 'dark'), f'motyw nie zastosowany (ciemny={ciemny})'
    r.krok('start strony', start, 'start')
    r.krok('dane testowe (plan fbw2)', plan_testowy, 'trening-plany')

    def plany():
        zakladka('plany')
        expect(page.locator('#view')).to_contain_text('FBW A')
        r.klik('[data-act="editPlan"]')
        expect(page.locator('#appbar h1')).to_have_text('Edycja planu')
    r.krok('zakładka Plany (lista i edytor)', plany, 'plany')

    def cwiczenia():
        zakladka('cwiczenia')
        expect(page.locator('#exlist .exrow').first).to_be_visible()
    r.krok('zakładka Ćwiczenia', cwiczenia, 'cwiczenia')

    def historia_pusta():
        zakladka('historia')
        expect(page.locator('#view')).to_contain_text('Jeszcze pusto')
        for v in ('tydzien', 'postepy', 'treningi'):
            r.klik(f'[data-act="hist"][data-v="{v}"]')
            expect(page.locator(f'[data-act="hist"][data-v="{v}"]')).to_have_attribute('aria-pressed', 'true')
    r.krok('zakładka Historia (pusta, widoki Treningi/Tydzień/Postępy)', historia_pusta, 'historia-pusta')

    def dieta_pusta():
        zakladka('dieta')
        widoczne('.dt-sum')
    r.krok('zakładka Dieta (bez wpisów)', dieta_pusta, 'dieta-pusta')

    # ---- trening (wykonywany dwa razy: dzień A planu) ----
    def trening(nr):
        def start_():
            zakladka('trening')
            r.klik('[data-act="startPlan"]')
            expect(page.locator('#workout')).to_be_visible()
            expect(page.locator('#workout .wex').first).to_be_visible()
        r.krok(f'trening {nr}: Start', start_, f'trening{nr}-start')

        def serie():
            for i in range(4):
                r.klik('#workout .chk[data-act="toggleSet"][aria-pressed="false"]')
                # liczymy w stanie treningu: ukończone ćwiczenie zwija się, więc jego przyciski znikają z widoku
                page.wait_for_function('(n) => ACTIVE.ex.flatMap(x => x.sets).filter(s => s.done).length === n', arg=i + 1)
        r.krok(f'trening {nr}: odhaczenie 4 serii', serie, f'trening{nr}-serie')

        def zakoncz():
            r.klik('#workout [data-act="finishOpen"]')
            expect(page.locator('#sheet [data-act="finishSave"]')).to_be_enabled()
        r.krok(f'trening {nr}: Zakończ', zakoncz, f'trening{nr}-zakonczenie')

        def zapis():
            r.klik('#sheet [data-act="finishSave"]')
            page.wait_for_function(f'SESS.length === {nr} && !ACTIVE')
            ukryte('#workout')
            widoczne('#sheet .tiles')
        r.krok(f'trening {nr}: zapis', zapis, f'trening{nr}-podsumowanie')

        def zamknij_podsumowanie():
            r.klik('#sheet [data-act="closeSheet"]')
            ukryte('#sheet-wrap')
            expect(page.locator('#view')).to_contain_text('Ostatnio')
        r.krok(f'trening {nr}: powrót na ekran główny', zamknij_podsumowanie, f'trening{nr}-po-zapisie')

    def kafelek(nazwa):
        return page.locator('#sheet .tile', has=page.locator('.l', has_text=nazwa)).locator('.v')

    def historia_treningi(n):
        zakladka('historia')
        r.klik('[data-act="hist"][data-v="treningi"]')
        expect(page.locator('.sess')).to_have_count(n)
        expect(page.locator('.sess').first).to_contain_text('FBW A')

    def historia(n):
        def f():
            historia_treningi(n)
        return f

    def sesja():
        r.klik('.sess')
        widoczne('#sheet .tiles')
        expect(page.locator('#sheet')).to_contain_text('FBW A')
        expect(kafelek('Serie')).to_have_text('4')   # 4 odhaczone serie, nie tylko tytuł „FBW A”
        assert page.locator('#sheet .set-list span').count() == 4, 'szczegóły treningu: oczekiwano 4 serii na liście'
        obj = int(re.sub(r'\D', '', kafelek('Objętość').inner_text().split('kg')[0]) or 0)
        assert obj == 640, f'szczegóły treningu: objętość {obj} kg zamiast 640 (4 serie × 8 powt. × 20 kg)'
    def zamknij():
        r.klik('#sheet [data-act="closeSheet"]')
        ukryte('#sheet-wrap')

    trening(1)
    r.krok('Historia: Treningi (trening widoczny)', historia(1), 'historia-treningi')
    r.krok('Historia: szczegóły treningu (4 serie)', sesja, 'historia-trening')
    r.krok('Historia: zamknięcie szczegółów', zamknij)

    for v, nazwa in (('tydzien', 'Tydzień'), ('postepy', 'Postępy')):
        def widok(v=v):
            r.klik(f'[data-act="hist"][data-v="{v}"]')
            expect(page.locator(f'[data-act="hist"][data-v="{v}"]')).to_have_attribute('aria-pressed', 'true')
            if v == 'postepy':   # jeden trening: kafelki i tabela, wykres dopiero po drugim treningu
                widoczne('#progex')
                widoczne('#view .tiles')
                expect(page.locator('#view')).to_contain_text('Wykres pojawi się po drugim treningu')
        r.krok(f'Historia: {nazwa}', widok, 'historia-' + v)

    def odswiez_historia():
        page.reload(wait_until='load')
        expect(page.locator('#tabbar a.tab')).to_have_count(5)
        assert page.evaluate('SESS.length') == 1, 'po odświeżeniu zniknął zapisany trening'
        historia_treningi(1)
        r.klik('.sess')
        expect(kafelek('Serie')).to_have_text('4')
        zamknij()
    r.krok('trwałość: po odświeżeniu Historia ma trening (4 serie)', odswiez_historia, 'historia-po-odswiezeniu')

    r.krok('dane testowe po odświeżeniu (plan fbw2)', lambda: plan_testowy(False))
    trening(2)
    r.krok('Historia: Treningi (dwa treningi)', historia(2), 'historia-treningi-2')

    def wykres():
        r.klik('[data-act="hist"][data-v="postepy"]')
        widoczne('#progex')
        expect(page.locator('#view')).not_to_contain_text('Wykres pojawi się po drugim treningu')
        expect(page.locator('#view .chart svg').first).to_be_visible()
        assert page.locator('#view .chart svg *').count() > 3, 'wykres Postępów jest pusty'
    r.krok('Historia: Postępy (wykres po drugim treningu)', wykres, 'historia-postepy-wykres')

    # ---- dieta ----
    def dieta_wpis():
        zakladka('dieta')
        r.klik('[data-act="dietAdd"]')
        r.klik('#sheet [data-act="dietQuick"]')
        r.klik('#dk-n')
        page.fill('#dk-n', 'Test dymny')
        page.fill('#dk-k', '350')
        page.fill('#dk-b', '20')
        r.zrzut('dieta-szybki-wpis')
        r.klik('#sheet [data-act="dkSave"]')
        ukryte('#sheet-wrap')
        expect(page.locator('.dt-meal').first).to_contain_text('Test dymny')
        expect(page.locator('.dt-sum .big')).to_have_text(re.compile(r'^\s*350\s*$'))
        expect(page.locator('.dt-sum')).to_contain_text(re.compile(r'Białko\s*20\s*g'))
    r.krok('Dieta: szybki wpis', dieta_wpis, 'dieta-po-wpisie')

    def dieta_trwalosc():
        page.reload(wait_until='load')
        expect(page.locator('#tabbar a.tab')).to_have_count(5)
        zakladka('dieta')
        expect(page.locator('.dt-meal').first).to_contain_text('Test dymny')
        expect(page.locator('.dt-sum .big')).to_have_text(re.compile(r'^\s*350\s*$'))
        expect(page.locator('.dt-sum')).to_contain_text(re.compile(r'Białko\s*20\s*g'))
        zakladka('historia')
        r.klik('[data-act="hist"][data-v="treningi"]')
        expect(page.locator('.sess')).to_have_count(2)
    r.krok('trwałość: po odświeżeniu lista Diety i Historia', dieta_trwalosc, 'dieta-po-odswiezeniu')

    def dieta_cele():
        zakladka('dieta')
        r.klik('.dt-sum [data-act="dietGoals"]')
        r.klik('#dg-k')
        page.fill('#dg-k', '2000')
        page.fill('#dg-b', '120')
        page.fill('#dg-w', '200')
        page.fill('#dg-t', '70')
        r.klik('#sheet [data-act="dgSave"]')
        ukryte('#sheet-wrap')
        sum_ = bez_spacji(page.locator('.dt-sum').inner_text())
        assert '350/2000' in sum_, f'cel kcal nie widać w podsumowaniu: {sum_[:80]!r}'
        assert 'zostało1650' in sum_, f'brak „zostało 1650” w podsumowaniu: {sum_[:120]!r}'
        assert page.locator('.dt-sum .dt-meter').count() >= 4, 'brak pasków postępu celów'
        assert page.locator('.dt-sum .dt-meter:not(.sm) i').first.evaluate('e => e.style.width') == '18%', 'pasek kcal: 350/2000 powinno dać 18%'
        expect(page.locator('.dt-sum .dt-left')).to_contain_text(re.compile(r'zostało\s*100\s*g'))
    r.krok('Dieta: ustawienie celu (paski, „zostało”)', dieta_cele, 'dieta-cele')

    # ---- A6: zapis planów i treningów (sztuczny Firebase) ----
    def zapis_scalanie():
        page.goto(BASE + '/', wait_until='load')
        page.evaluate('() => localStorage.clear()')
        page.evaluate(SZTUCZNY_FIREBASE)
        w = page.evaluate(r"""async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms)), sv = window.__sv, out = {};
          const P = (id, name) => ({id, name, items:[{id:'i-' + id, exId:EX[0].id, mode:'reps', rest:90, restAfter:120, note:'', sets:[{reps:8, kg:40}]}]});
          store.mode = 'fire'; FOLDER = {id:'t1', name:'Test'};
          sv.doc = {v:2, plans:[P('P1', 'Plan A'), P('P2', 'Plan B')], custom:[], settings:{...DEF_SETTINGS}};
          LS.set('dz.state', sv.doc); LS.del('dz.f.t1.zq'); LS.del('dz.f.t1.unsent');
          openFolder(FOLDER); sv.emit(); await sleep(60);
          out.start = S.plans.map(p => p.name);
          // 1. pierwsza zmiana na starym układzie = migracja (transakcja), plany tablicą
          S.plans[0].name = 'Telefon A'; persist(); await sleep(1000); sv.emit(); await sleep(60);
          out.mig = {v:sv.doc.v, full:!!sv.doc.full, p1:sv.doc.pm.P1.name, u2:sv.doc.pm.P2.u, po:sv.doc.po, mirror:sv.doc.plans.map(p => p.name), log:sv.log.slice(), tablica:Array.isArray(S.plans), bezU:S.plans.every(p => !('u' in p))};
          // 2. zapis się nie udaje, w tym czasie drugie urządzenie zmienia INNY plan; zmiana z drugiego urządzenia nie może zginąć (E1-09)
          sv.fail = true; S.plans[0].name = 'Telefon A2'; persist(); await sleep(900);
          out.kolejka = Object.keys(Z.q.p);
          sv.doc.pm.P2 = {...sv.doc.pm.P2, name:'Laptop B', u:Date.now() + 5}; sv.doc.plans = sv.doc.plans.map(p => p.id === 'P2' ? {...p, name:'Laptop B'} : p);
          sv.emit(); await sleep(60);
          out.polaczone = S.plans.map(p => p.name);
          sv.fail = false; clearTimeout(zRetryT); flushFire(); await sleep(200); sv.emit(); await sleep(60);
          out.serwer = [sv.doc.pm.P1.name, sv.doc.pm.P2.name]; out.kolejkaPo = Object.keys(Z.q.p).length;
          // 3. stara karta zapisuje cały dokument w starym układzie (zmienia P1, dodaje P3, nie ma nowych pól)
          sv.doc = {v:2, plans:[{...P('P1', 'A ze starej karty')}, P('P2', 'Laptop B'), P('P3', 'Plan ze starej karty')], custom:[], settings:{...DEF_SETTINGS}};
          sv.emit(); await sleep(1200); sv.emit(); await sleep(100);
          out.stara = {v:sv.doc.v, full:!!sv.doc.full, ids:S.plans.map(p => p.id), p1:byId1(), serwerIds:Object.keys(sv.doc.pm || {}).sort()};
          function byId1(){ const p = S.plans.find(x => x.id === 'P1'); return p && p.name; }
          // 4. trening: zapis się nie udaje → zostaje w historii po odczycie z bazy i jest wysyłany ponownie (E1-10)
          const T = (id, d) => ({id, date:d, dur:60, planId:null, planName:'', dayId:null, dayName:'Trening', ex:[{exId:EX[0].id, name:'x', mode:'reps', sets:[{reps:8, kg:40, done:true}]}]});
          sv.fail = true; await saveSession(T('Tnew1', '2026-11-13T10:00:00.000Z')); await sleep(60);
          out.niewyslane1 = sessUnsent('t1').slice();
          sv.emit(); await sleep(60);
          out.historiaPoOdczycie = SESS.map(x => x.id);
          sv.fail = false; clearTimeout(sessRetryT); sessResend('t1'); await sleep(100);
          out.niewyslane2 = sessUnsent('t1').slice(); out.naSerwerze = Object.keys(sv.sess);
          sv.emit(); await sleep(60); out.historia2 = SESS.map(x => x.id);
          // 5. usunięty trening nie wraca
          sv.fail = true; await saveSession(T('Tdel1', '2026-11-13T11:00:00.000Z')); await sleep(60);
          out.przedUsunieciem = sessUnsent('t1').slice();
          await deleteSession('Tdel1'); sv.emit(); await sleep(60);
          out.poUsunieciu = {lista:sessUnsent('t1').slice(), historia:SESS.map(x => x.id)};
          sv.fail = false; clearTimeout(sessRetryT);
          // 6. zamknięcie karty z niewysłaną zmianą: kolejka i stan z pamięci przeglądarki, po ponownym otwarciu zmiana idzie do bazy
          sv.fail = true; S.plans.find(p => p.id === 'P2').name = 'po zamknięciu'; persist(); await sleep(900);
          out.zapisana = Object.keys(LS.get('dz.f.t1.zq', {q:{p:{}}}).q.p);
          sv.fail = false; clearTimeout(zRetryT); zBusy.free('t1');
          openFolder(FOLDER); sv.emit(); await sleep(500); sv.emit(); await sleep(60);
          out.poOtwarciu = {serwer:sv.doc.pm.P2.name, lokalnie:S.plans.find(p => p.id === 'P2').name};
          out.setDoc = sv.log.filter(x => x === 'SETDOC').length;
          return out;
        }""")
        assert w['start'] == ['Plan A', 'Plan B'], f"stan startowy: {w['start']}"
        m = w['mig']
        assert m['v'] == 3 and m['full'] and m['p1'] == 'Telefon A' and m['u2'] == 0 and m['po'] == ['P1', 'P2'], f'migracja do v3: {m}'
        assert m['mirror'] == ['Telefon A', 'Plan B'] and 'tx' in m['log'], f'lustro starego układu / migracja transakcją: {m}'
        assert m['tablica'] and m['bezU'], f'S.plans ma zostać tablicą bez pola u: {m}'
        assert w['kolejka'] == ['P1'], f"nieudany zapis ma zostać w kolejce: {w['kolejka']}"
        assert w['polaczone'] == ['Telefon A2', 'Laptop B'], f"zmiana planu B z drugiego urządzenia zginęła albo nadpisała lokalną: {w['polaczone']}"
        assert w['serwer'] == ['Telefon A2', 'Laptop B'] and w['kolejkaPo'] == 0, f"po ponowieniu baza ma mieć obie zmiany: {w['serwer']}, kolejka {w['kolejkaPo']}"
        st = w['stara']
        assert st['v'] == 3 and st['full'] and st['ids'] == ['P1', 'P2', 'P3'] and st['p1'] == 'A ze starej karty' and st['serwerIds'] == ['P1', 'P2', 'P3'], f'naprawa po starej karcie: {st}'
        assert w['niewyslane1'] == ['Tnew1'], f"trening po nieudanym zapisie ma być na liście niewysłanych: {w['niewyslane1']}"
        assert 'Tnew1' in w['historiaPoOdczycie'], f"trening niewysłany zniknął z historii po odczycie z bazy (E1-10): {w['historiaPoOdczycie']}"
        assert w['niewyslane2'] == [] and 'Tnew1' in w['naSerwerze'] and 'Tnew1' in w['historia2'], f"ponowna wysyłka treningu: {w['niewyslane2']} {w['naSerwerze']} {w['historia2']}"
        assert w['przedUsunieciem'] == ['Tdel1'] and w['poUsunieciu']['lista'] == [] and 'Tdel1' not in w['poUsunieciu']['historia'], f"usunięty trening wrócił: {w['poUsunieciu']}"
        assert w['zapisana'] == ['P2'], f"kolejka nie zapisała się w pamięci przeglądarki: {w['zapisana']}"
        assert w['poOtwarciu'] == {'serwer':'po zamknięciu', 'lokalnie':'po zamknięciu'}, f"zmiana z zamkniętej karty nie trafiła do bazy: {w['poOtwarciu']}"
        assert w['setDoc'] == 0, f"zapis data/state przez setDoc (bez warunku) – ma być tylko transakcja: {w['setDoc']}"
    r.krok('zapis: scalanie planów, kolejka, nieudany zapis treningu, stara karta (sztuczny Firebase)', zapis_scalanie)

    # ---- A6c: dwie karty, konto zamknięte w trakcie wysyłki, usunięcie konta, dokument nieznanego kształtu, rozmiar (sztuczny Firebase) ----
    def zapis_a6c():
        page.goto(BASE + '/', wait_until='load')
        page.evaluate('() => localStorage.clear()')
        page.evaluate(SZTUCZNY_FIREBASE)
        w = page.evaluate(r"""async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms)), sv = window.__sv, out = {};
          // ===== strażnik A6d: zapis klucza .zq / .state konta do localStorage wolno wykonać tylko wewnątrz ZP.store / ZP.settle / ZP.settleTx (jedno miejsce zapisu); zbieramy naruszenia i sprawdzamy na końcu kroku =====
          const g = {w:0, bledy:[], klucze:/^dz\.f\..+\.(zq|state)$/}, lsSet = LS.set.bind(LS);
          LS.set = (k, v) => { if (g.klucze.test(String(k)) && !g.w) g.bledy.push(String(k) + ' ← ' + (new Error().stack || '').split('\n').slice(2, 5).join(' | ')); return lsSet(k, v); };
          for (const nazwa of ['store', 'settle', 'settleTx']){ const o = ZP[nazwa]; ZP[nazwa] = (...a) => { g.w++; try { return o(...a); } finally { g.w--; } }; }
          const zasiej = (k, v) => { g.w++; try { LS.set(k, v); } finally { g.w--; } };   // przygotowanie danych testu (nie kod aplikacji)
          const P = (id, name, note) => ({id, name, items:[{id:'i-' + id, exId:EX[0].id, mode:'reps', rest:90, restAfter:120, note:note || '', sets:[{reps:8, kg:40}]}]});
          const v3 = (plans, extra) => ({v:3, full:1, pm:Object.fromEntries(plans.map(p => [p.id, {...p, u:1}])), po:plans.map(p => p.id), pos:0, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{...DEF_SETTINGS}, plans, custom:[], ...(extra || {})});
          const kq = id => Object.keys((LS.get(ZP.zKey(id), {q:{p:{}}}).q || {p:{}}).p).sort();
          const kst = id => (LS.get(ZP.stateKey(id), {plans:[]}).plans || []).map(p => p.name);
          // ===== dwie karty tej samej przeglądarki (A = ta strona, B = druga karta, ten sam kod ZP.store co w persist) =====
          store.mode = 'fire'; FOLDER = {id:'t2', name:'Dwie'};
          sv.doc = v3([P('P1', 'Plan A'), P('P2', 'Plan B')]);
          zasiej('dz.f.t2.state', {v:2, plans:[P('P1', 'Plan A'), P('P2', 'Plan B')], custom:[], settings:{...DEF_SETTINGS}}); LS.del('dz.f.t2.zq');
          openFolder(FOLDER); sv.emit(); await sleep(80);
          const B = {S:LS.get(ZP.stateKey('t2'), null), z:ZP.fixZ(LS.get(ZP.zKey('t2'), null))}; B.last = ZP.snap(B.S);   // druga karta otwarta na tym samym stanie
          sv.fail = true;                                                                                                  // zapisy do bazy nie idą: wpisy zostają w kolejce
          B.S.plans.find(p => p.id === 'P2').name = 'B: edycja P2'; B.last = ZP.diff(B.last, B.S, B.z.q, Date.now() + 5, B.z.kn); ZP.store(LS, 't2', B.z, B.z, B.S);
          S.plans.find(p => p.id === 'P1').name = 'A: edycja P1'; persist();   // A zapisuje OSTATNIA: nie może nadpisać stanu drugiej karty
          out.poZapisach = {kolejka:kq('t2'), stan:kst('t2')};
          sv.emit(); await sleep(80);                                                                                       // ścieżka odczytu z bazy (handler w openFolder) u karty A
          out.poOdczycie = {kolejka:kq('t2'), stan:kst('t2')};
          sv.fail = false; clearTimeout(zRetryT); zRetryN = 0; zBusy.free('t2'); flushFire(); await sleep(300);   // transakcja karty A (bez migawki po błędzie: czyta dokument sama)
          out.poTx = {kolejka:kq('t2'), stan:kst('t2'), serwer:[sv.doc.pm.P1.name, sv.doc.pm.P2.name]};
          openFolder(FOLDER); sv.emit(); await sleep(700); sv.emit(); await sleep(80);                                     // odświeżenie strony: kolejka i stan z localStorage
          out.poOdswiezeniu = {kolejka:kq('t2'), serwer:[sv.doc.pm.P1.name, sv.doc.pm.P2.name], lokalnie:S.plans.map(p => p.name)};
          // ===== konto zamknięte i otwarte od nowa w trakcie wysyłki: stare Z nie nadpisuje zapisanej kolejki nowego (Z === z) =====
          sv.delay = 250; S.plans.find(p => p.id === 'P1').name = 'A: druga edycja'; persist(); clearTimeout(store.t);
          zBusy.free('t2'); flushFire(); await sleep(40);
          openFolder(FOLDER); sv.emit();                                                                                   // nowe Z, wysyłka starego jeszcze trwa
          await sleep(310);                                                                                                // stara wysyłka skończona, nowa jeszcze w drodze
          out.staleW = kq('t2');
          await sleep(500); out.staleKoniec = kq('t2'); sv.delay = 5;
          // ===== dokument nieznanego kształtu (bez plans i pm): plany lokalne zostają, komunikat, po kolejnym odczycie migracja rusza =====
          FOLDER = {id:'t4', name:'Nieznany'}; sv.doc = {settings:{restSet:45}};
          zasiej('dz.f.t4.state', {v:2, plans:[P('P1', 'lokalny A'), P('P2', 'lokalny B')], custom:[], settings:{...DEF_SETTINGS}}); LS.del('dz.f.t4.zq');
          openFolder(FOLDER); S.plans[0].name = 'zmiana czeka'; persist(); sv.emit(); await sleep(80);
          out.holdPlany = S.plans.map(p => p.name); out.holdToast = document.querySelector('#toast').textContent; out.holdKolejka = kq('t4');
          await sleep(900); out.holdSerwer = JSON.stringify(sv.doc);
          sv.doc = {v:2, plans:[P('P1', 'lokalny A'), P('P2', 'lokalny B')], custom:[], settings:{...DEF_SETTINGS}}; sv.emit(); await sleep(1300); sv.emit(); await sleep(80);
          out.holdPo = {v:sv.doc.v, p1:sv.doc.pm && sv.doc.pm.P1.name, p2:sv.doc.pm && sv.doc.pm.P2.name, plany:S.plans.map(p => p.name)};
          // ===== rozmiar przy zwykłym zapisie: dokument blisko limitu ostrzega =====
          FOLDER = {id:'t5', name:'Duże'}; sv.doc = v3([P('P1', 'duży', 'x'.repeat(951000)), P('P2', 'mały')]);
          zasiej('dz.f.t5.state', {v:2, plans:[P('P1', 'duży', 'x'.repeat(951000)), P('P2', 'mały')], custom:[], settings:{...DEF_SETTINGS}}); LS.del('dz.f.t5.zq');
          openFolder(FOLDER); sv.emit(); await sleep(80);
          const toasty = [], toastOrg = toast; toast = m => { toasty.push(m); toastOrg(m); };                              // toasty zasłaniają się nawzajem: zbieramy wszystkie
          S.plans.find(p => p.id === 'P2').name = 'mały zmieniony'; persist(); await sleep(900);
          toast = toastOrg; out.rozmiarToast = toasty.join(' | ');
          // ===== usunięcie konta czyści jego kolejkę i listę niewysłanych treningów, cudze klucze zostają =====
          for (const id of ['t3', 't6']){ zasiej('dz.f.' + id + '.zq', {q:{p:{P1:5}}}); LS.set('dz.f.' + id + '.unsent', ['T1']); zasiej('dz.f.' + id + '.state', {plans:[]}); }
          FOLDER = {id:'t3', name:'Trzy'}; openFolder(FOLDER);
          await ACT.folderDeleteGo({id:'t3', name:'Trzy'});
          const has = k => localStorage.getItem(k) !== null;
          out.usuniete = {zq:has('dz.f.t3.zq'), unsent:has('dz.f.t3.unsent'), state:has('dz.f.t3.state'), cudzeZq:has('dz.f.t6.zq'), cudzeUnsent:has('dz.f.t6.unsent')};
          // strażnik musi działać: zapis klucza .state wprost, poza ZP.store, zostaje wykryty (probe kasujemy z listy i z pamięci)
          const przed = g.bledy.length; LS.set('dz.f.sonda.state', {}); out.straznikDziala = g.bledy.length === przed + 1; g.bledy.splice(przed); localStorage.removeItem('dz.f.sonda.state');
          out.straznik = g.bledy; out.setDoc = sv.log.filter(x => x === 'SETDOC').length;
          return out;
        }""")
        assert w['straznikDziala'], 'strażnik zapisu (.zq/.state poza ZP.store/ZP.settle) nie wykrył zapisu próbnego'
        assert w['straznik'] == [], f"zapis klucza .zq/.state do localStorage poza ZP.store / ZP.settle: {w['straznik']}"
        assert w['poZapisach'] == {'kolejka':['P1', 'P2'], 'stan':['A: edycja P1', 'B: edycja P2']}, f"zapisy dwóch kart (kolejka i stan): {w['poZapisach']}"
        assert w['poOdczycie'] == {'kolejka':['P1', 'P2'], 'stan':['A: edycja P1', 'B: edycja P2']}, f"odczyt z bazy u karty A nadpisał kolejkę albo stan drugiej karty: {w['poOdczycie']}"
        assert w['poTx']['kolejka'] == ['P2'] and w['poTx']['stan'] == ['A: edycja P1', 'B: edycja P2'] and w['poTx']['serwer'] == ['A: edycja P1', 'Plan B'], f"transakcja karty A (wpis drugiej karty zostaje w kolejce i w stanie): {w['poTx']}"
        assert w['poOdswiezeniu']['serwer'] == ['A: edycja P1', 'B: edycja P2'] and w['poOdswiezeniu']['lokalnie'] == ['A: edycja P1', 'B: edycja P2'] and w['poOdswiezeniu']['kolejka'] == [], f"po odświeżeniu zmiana drugiej karty ma trafić do bazy: {w['poOdswiezeniu']}"
        assert 'P1' in w['staleW'], f"stare Z (konto otwarte od nowa w trakcie wysyłki) zdjęło wpis z zapisanej kolejki nowego Z: {w['staleW']}"
        assert w['staleKoniec'] == [], f"po wysyłce nowego Z kolejka ma być pusta: {w['staleKoniec']}"
        assert w['holdPlany'] == ['zmiana czeka', 'lokalny B'], f"plany lokalne zniknęły z widoku przy nieznanym kształcie dokumentu: {w['holdPlany']}"
        assert 'nieznany układ' in w['holdToast'], f"brak komunikatu o wstrzymanej migracji: {w['holdToast']}"
        assert w['holdKolejka'] == ['P1'] and json.loads(w['holdSerwer']) == {'settings':{'restSet':45}}, f"dokument nieznanego kształtu ma zostać nietknięty, zmiana w kolejce: {w['holdKolejka']} {w['holdSerwer']}"
        assert w['holdPo']['v'] == 3 and w['holdPo']['p1'] == 'zmiana czeka' and w['holdPo']['plany'] == ['zmiana czeka', 'lokalny B'], f"po kolejnym odczycie migracja ma ruszyć: {w['holdPo']}"
        assert 'limitu rozmiaru' in w['rozmiarToast'], f"brak ostrzeżenia o rozmiarze przy zwykłym zapisie: {w['rozmiarToast']}"
        assert w['usuniete'] == {'zq':False, 'unsent':False, 'state':False, 'cudzeZq':True, 'cudzeUnsent':True}, f"usunięcie konta: {w['usuniete']}"
        assert w['setDoc'] == 0, f"zapis data/state przez setDoc (bez warunku) – ma być tylko transakcja: {w['setDoc']}"
    r.krok('zapis: dwie karty, konto zamknięte w trakcie wysyłki, nieznany kształt dokumentu, rozmiar, usunięcie konta (sztuczny Firebase)', zapis_a6c)

    # ---- A6f: zapis kolejki transakcją (tylko nowsze niż w bazie), bez sieci nic nie wysyła, konflikt = ponowienie (sztuczny Firebase) ----
    def zapis_a6f():
        page.goto(BASE + '/', wait_until='load')
        page.evaluate('() => localStorage.clear()')
        page.evaluate(SZTUCZNY_FIREBASE)
        w = page.evaluate(r"""async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms)), sv = window.__sv, out = {};
          const P = (id, name) => ({id, name, items:[{id:'i-' + id, exId:EX[0].id, mode:'reps', rest:90, restAfter:120, note:'', sets:[{reps:8, kg:40}]}]});
          const plans = [P('P1', 'Plan A'), P('P2', 'Plan B')];
          let online = true; Object.defineProperty(navigator, 'onLine', {configurable:true, get:() => online});
          const toasty = [], toastOrg = toast; toast = m => { toasty.push(m); toastOrg(m); };
          const nazwa = id => S.plans.find(p => p.id === id).name, kq = () => Object.keys(LS.get(ZP.zKey('t7'), {q:{p:{}}}).q.p).sort();
          store.mode = 'fire'; FOLDER = {id:'t7', name:'A6f'};
          sv.doc = {v:3, full:1, pm:Object.fromEntries(plans.map(p => [p.id, {...p, u:1}])), po:['P1', 'P2'], pos:0, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{...DEF_SETTINGS}, plans, custom:[]};
          LS.set('dz.f.t7.state', {v:2, plans, custom:[], settings:{...DEF_SETTINGS}}); LS.del('dz.f.t7.zq');
          openFolder(FOLDER); sv.emit(); await sleep(80); sv.log.length = 0;
          // 1. zwykła zmiana: transakcja z mergeFields (+ transakcja lustra), żadnego setDoc
          S.plans[0].name = 'A: edycja'; persist(); await sleep(900); sv.emit(); await sleep(60);
          out.zwykla = {log:sv.log.slice(), p1:sv.doc.pm.P1.name, p2u:sv.doc.pm.P2.u, kolejka:kq(), lustro:sv.doc.plans.map(p => p.name)};
          // 2. bez sieci: nic nie trafia do bazy (ani teraz, ani „później z SDK”), kolejka w localStorage; po powrocie sieci jeden zapis
          sv.log.length = 0; online = false;
          S.plans[1].name = 'B: offline'; persist(); await sleep(900);
          out.offline = {log:sv.log.slice(), p2:sv.doc.pm.P2.name, kolejka:kq()};
          online = true; window.dispatchEvent(new Event('online')); await sleep(300); sv.emit(); await sleep(60);
          out.poPowrocie = {log:sv.log.slice(), p2:sv.doc.pm.P2.name, kolejka:kq(), lokalnie:nazwa('P2')};
          // 3. przebieg 42: karta bez świeżej migawki ma STARSZĄ zmianę niż baza – transakcja jej nie zapisuje, migawka daje wersję z bazy
          sv.log.length = 0; online = false;
          S.plans[0].name = 'A: starsza lokalna'; persist(); await sleep(700);
          sv.doc.pm.P1 = {...sv.doc.pm.P1, name:'inne urządzenie: nowsza', u:Date.now() + 60000};   // inne urządzenie zapisało później (nasłuch tej karty jeszcze o tym nie wie)
          online = true; window.dispatchEvent(new Event('online')); await sleep(300);
          out.starsza = {log:sv.log.slice(), p1:sv.doc.pm.P1.name, kolejka:kq(), toast:toasty.some(t => /była nowsza/.test(t))};
          sv.emit(); await sleep(60); out.starsza.lokalnie = nazwa('P1');
          // 4. konflikt: dokument zmienia się między odczytem a zatwierdzeniem – SDK powtarza funkcję na świeżym dokumencie, nowsza zmiana z bazy wygrywa
          sv.log.length = 0;
          S.plans[1].name = 'B: ta karta'; persist();
          sv.konflikt = () => { sv.doc.pm.P2 = {...sv.doc.pm.P2, name:'B: konflikt (nowszy)', u:Date.now() + 120000}; };
          await sleep(900); sv.emit(); await sleep(60);
          out.konflikt = {log:sv.log.slice(), p2:sv.doc.pm.P2.name, kolejka:kq(), lokalnie:nazwa('P2')};
          // 5. konto przełączone W TRAKCIE transakcji, SDK ją powtarza (konflikt): zapis liczy się ze stanu i kolejki z chwili wysyłki, nie ze stanu nowego konta
          sv.log.length = 0; sv.delay = 150; const rest7 = S.settings.restSet === 45 ? 50 : 45;
          S.settings.restSet = rest7; persist(); clearTimeout(store.t); flushFire(); await sleep(20);
          sv.konflikt = () => { sv.doc.pm.P1 = {...sv.doc.pm.P1, u:sv.doc.pm.P1.u + 1}; };          // wymusza ponowienie funkcji transakcji
          LS.set('dz.f.t8.state', {v:2, plans:[P('X1', 'inne konto')], custom:[], settings:{...DEF_SETTINGS, restSet:15}}); LS.del('dz.f.t8.zq');
          FOLDER = {id:'t8', name:'Inne'}; openFolder(FOLDER);                                          // nowe konto: inne S i Z (bez migawki)
          await sleep(500); sv.delay = 5;
          out.przelaczenie = {log:sv.log.slice(), rest:sv.doc.settings.restSet, oczekiwane:rest7, planyT8wBazie:Object.keys(sv.doc.pm).filter(id => id === 'X1')};
          toast = toastOrg; delete navigator.onLine;
          out.setDoc = sv.log.filter(x => x === 'SETDOC').length;
          return out;
        }""")
        z = w['zwykla']
        assert z['p1'] == 'A: edycja' and z['p2u'] == 1 and z['kolejka'] == [] and z['lustro'] == ['A: edycja', 'Plan B'], f'zwykły zapis transakcją: {z}'
        assert z['log'][:1] == ['tx:mf'] and 'SETDOC' not in z['log'], f'zapis ma iść transakcją z mergeFields, nie setDoc: {z["log"]}'
        o = w['offline']
        assert o['log'] == [] and o['p2'] == 'Plan B' and o['kolejka'] == ['P2'], f'bez sieci nic nie może trafić do bazy, kolejka w localStorage: {o}'
        p = w['poPowrocie']
        assert p['log'].count('tx:mf') == 1 and p['p2'] == 'B: offline' and p['kolejka'] == [] and p['lokalnie'] == 'B: offline', f'po powrocie sieci jeden zapis: {p}'
        s_ = w['starsza']
        assert s_['p1'] == 'inne urządzenie: nowsza' and 'tx:mf' not in s_['log'] and s_['kolejka'] == [], f'starsza zmiana nie może nadpisać nowszej w bazie: {s_}'
        assert s_['toast'] and s_['lokalnie'] == 'inne urządzenie: nowsza', f'komunikat i wersja z bazy po migawce: {s_}'
        k = w['konflikt']
        assert 'tx-retry' in k['log'] and k['p2'] == 'B: konflikt (nowszy)' and k['kolejka'] == [] and k['lokalnie'] == 'B: konflikt (nowszy)', f'konflikt w transakcji: {k}'
        pk = w['przelaczenie']
        assert 'tx-retry' in pk['log'] and pk['rest'] == pk['oczekiwane'] and pk['planyT8wBazie'] == [], f'ponowiona transakcja po przełączeniu konta zapisała stan innego konta: {pk}'
        assert w['setDoc'] == 0, f"zapis data/state przez setDoc: {w['setDoc']}"
    r.krok('zapis: transakcja (tylko nowsze niż w bazie), bez sieci nic, konflikt (sztuczny Firebase, A6f)', zapis_a6f)

    # ---- A6g: zawieszona transakcja nie blokuje synchronizacji (limit czasu ZTX_MS), spóźniony wynik nie zwalnia blokady nowszej transakcji ----
    def zapis_a6g_limit():
        page.goto(BASE + '/', wait_until='load')
        page.evaluate('() => localStorage.clear()')
        page.evaluate(SZTUCZNY_FIREBASE)
        w = page.evaluate(r"""async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms)), sv = window.__sv, out = {};
          const P = (id, name) => ({id, name, items:[{id:'i-' + id, exId:EX[0].id, mode:'reps', rest:90, restAfter:120, note:'', sets:[{reps:8, kg:40}]}]});
          const plans = [P('P1', 'Plan A'), P('P2', 'Plan B')];
          const toasty = [], toastOrg = toast; toast = m => { toasty.push(m); toastOrg(m); };
          const kq = () => Object.keys(LS.get(ZP.zKey('t9'), {q:{p:{}}}).q.p).sort(), wolna = () => { const ok = zBusy.take('t9'); if (ok) zBusy.free('t9'); return ok; };
          store.mode = 'fire'; FOLDER = {id:'t9', name:'A6g'}; ZTX_MS = 300;
          sv.doc = {v:3, full:1, pm:Object.fromEntries(plans.map(p => [p.id, {...p, u:1}])), po:['P1', 'P2'], pos:0, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{...DEF_SETTINGS}, plans, custom:[]};
          LS.set('dz.f.t9.state', {v:2, plans, custom:[], settings:{...DEF_SETTINGS}}); LS.del('dz.f.t9.zq');
          openFolder(FOLDER); sv.emit(); await sleep(80); sv.log.length = 0;
          // 1. transakcja wisi: po limicie czasu blokada wolna, zmiana czeka w kolejce localStorage, w bazie nic, komunikat
          sv.zawies = true; S.plans[0].name = 'A: po zawieszeniu'; persist(); clearTimeout(store.t); flushFire(); await sleep(100);
          out.wTrakcie = {wolna:wolna(), kolejka:kq()};
          await sleep(350); clearTimeout(zRetryT);
          out.poLimicie = {wolna:wolna(), kolejka:kq(), p1:sv.doc.pm.P1.name, toast:toasty.some(t => /Nie udało się zapisać/.test(t)), wiszace:sv.wstrzymane.length};
          // 2. następne wyzwolenie (tu: kolejna zmiana) – nowa transakcja też wisi; spóźniona PIERWSZA kończy się w jej trakcie i nie zwalnia jej blokady
          S.plans[1].name = 'B: druga'; persist(); clearTimeout(store.t); flushFire(); await sleep(30);
          if (sv.wstrzymane.length !== 2){ sv.zawies = false; sv.wstrzymane.splice(0).forEach(f => f()); toast = toastOrg; ZTX_MS = 20000; return out; }   // blokada nie zwolniona: asercje niżej to pokażą
          const [pierwsza, druga] = sv.wstrzymane.splice(0); sv.zawies = false;
          pierwsza(); await sleep(60);
          out.spozniona = {wolna:wolna(), p1:sv.doc.pm.P1.name, kolejka:kq()};
          druga(); await sleep(80); sv.emit(); await sleep(60);
          out.koniec = {wolna:wolna(), p1:sv.doc.pm.P1.name, p2:sv.doc.pm.P2.name, kolejka:kq(), lokalnie:S.plans.map(p => p.name)};
          // 3. bez zawieszenia wszystko jak zwykle
          sv.log.length = 0; S.plans[0].name = 'A: zwykły'; persist(); await sleep(900); sv.emit(); await sleep(60);
          out.zwykly = {p1:sv.doc.pm.P1.name, kolejka:kq(), log:sv.log.slice()};
          toast = toastOrg; ZTX_MS = 20000; clearTimeout(zRetryT);
          return out;
        }""")
        t = w['wTrakcie']
        assert t['wolna'] is False and t['kolejka'] == ['P1'], f'w trakcie transakcji blokada zajęta, zmiana w kolejce: {t}'
        p = w['poLimicie']
        assert p['wolna'] is True and p['kolejka'] == ['P1'] and p['p1'] == 'Plan A' and p['toast'] and p['wiszace'] == 1, f'po limicie czasu blokada ma być wolna, zmiana w kolejce localStorage: {p}'
        s_ = w['spozniona']
        assert s_['wolna'] is False and s_['p1'] == 'A: po zawieszeniu', f'spóźniona transakcja zapisuje, ale nie zwalnia blokady nowszej: {s_}'
        k = w['koniec']
        assert k['wolna'] is True and k['p1'] == 'A: po zawieszeniu' and k['p2'] == 'B: druga' and k['kolejka'] == [] and k['lokalnie'] == ['A: po zawieszeniu', 'B: druga'], f'po obu transakcjach: {k}'
        z = w['zwykly']
        assert z['p1'] == 'A: zwykły' and z['kolejka'] == [] and 'tx:mf' in z['log'], f'zwykły zapis po wszystkim: {z}'
    r.krok('zapis: zawieszona transakcja – limit czasu, spóźniony wynik (sztuczny Firebase, A6g)', zapis_a6g_limit)

    # ---- B1: pola kg / powtórzeń w serii i zapis treningu do planu (E2-01, E2-02, E2-03, E2-09, E3-02) ----
    def nowy_trening(plan, start=True):
        """Czysta strona, jeden plan `plan` = lista ćwiczeń [{'sets': [(powt, kg), ...], 'mode': 'reps'|'time'}], start treningu."""
        page.goto(BASE + '/', wait_until='load')
        page.evaluate('() => localStorage.clear()')
        page.reload(wait_until='load')
        page.evaluate("""(items) => {
          S.plans = [{id:'PT', name:'Plan B1', items:items.map((it, n) => ({id:'it' + n, exId:EX[n].id, mode:it.mode || 'reps', rest:60, restAfter:90, note:'',
            sets:it.sets.map(([r, k]) => it.mode === 'time' ? {sec:r, kg:k} : {reps:r, kg:k})}))}];
          render(); if (%s) startWorkoutFrom(S.plans[0]);
        }""" % ('true' if start else 'false'), plan)
        if start:
            expect(page.locator('#workout .wex').first).to_be_visible()

    def pole(j, f='kg', root='#workout'):
        return page.locator(f'{root} input[data-bind="wset"][data-j="{j}"][data-f="{f}"]')

    def wyjdz(neutralny='#workout .srow .n'):
        """Wyjście z pola: stuknięcie obok, a gdy pole nadal ma fokus (iOS/WebKit nie zdejmuje fokusu przy stuknięciu w tekst), blur jak przycisk „Gotowe”."""
        r.klik(neutralny)
        page.evaluate("() => { const a = document.activeElement; if (a && a.tagName === 'INPUT') a.blur(); }")

    def stuknij_obok():
        wyjdz()

    def serie(f):
        return page.evaluate("(f) => ACTIVE.ex[0].sets.map(s => s[f])", f)

    def wartosci(j_od, f='kg'):
        return [pole(j, f).input_value() for j in range(j_od)]

    def b1_stuknij_i_wyjdz():
        # E2-01: samo stuknięcie w pole i wyjście niczego nie zmienia; wpisana wartość kopiuje się tylko do serii o tej samej wartości
        nowy_trening([{'sets': [(12, 60), (10, 70), (8, 80)]}])
        for f in ('kg', 'reps'):
            r.klik(pole(0, f)); expect(pole(0, f)).to_be_focused()
            stuknij_obok(); expect(pole(0, f)).not_to_be_focused()
        assert serie('kg') == [60, 70, 80] and serie('reps') == [12, 10, 8], f'stuknięcie i wyjście zmieniło serie: {serie("kg")} {serie("reps")}'
        assert wartosci(3, 'kg') == ['60', '70', '80'] and wartosci(3, 'reps') == ['12', '10', '8'], 'pola po wyjściu bez wpisania'
        r.klik(pole(0, 'kg')); page.keyboard.type('65'); stuknij_obok()
        assert serie('kg') == [65, 65, 65], f'plan 60/70/80, wpisane 65 w serii 1: zmienia się wszystko niżej: {serie("kg")}'
        assert wartosci(3, 'kg') == ['65', '65', '65'], 'pola po wpisaniu 65'
        r.klik(pole(1, 'kg')); page.keyboard.type('75'); stuknij_obok()
        assert serie('kg') == [65, 75, 75] and wartosci(3, 'kg') == ['65', '75', '75'], f'zmiana w serii 2 zmienia serię 3, ale nie serię 1: {serie("kg")}'
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        r.klik(pole(0, 'kg')); page.keyboard.type('62,5'); stuknij_obok()
        assert serie('kg') == [62.5] * 3 and wartosci(3, 'kg') == ['62,5'] * 3, f'plan 60/60/60, wpisane 62,5: {serie("kg")} {wartosci(3, "kg")}'
        # odhaczona seria nigdy się nie zmienia
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        r.klik('#workout .chk[data-j="1"][data-act="toggleSet"]'); expect(page.locator('#workout .chk[data-j="1"][aria-pressed="true"]')).to_have_count(1)
        r.klik(pole(0, 'kg')); page.keyboard.type('62,5'); stuknij_obok()
        assert serie('kg') == [62.5, 60, 62.5], f'odhaczona seria 2 ma zostać 60: {serie("kg")}'
    r.krok('pola serii: stuknięcie i wyjście nic nie zmienia, zmiana w serii zmienia wszystkie niżej, nie te wyżej (E2-01)', b1_stuknij_i_wyjdz, 'pola-e2-01')

    def b1_kasowanie():
        # E2-03 (trening): Backspace w opróżnionym polu zostawia puste pole; stuknięcie bez klawisza przywraca starą wartość
        nowy_trening([{'sets': [(10, 10), (10, 10), (10, 10)]}])
        r.klik(pole(0, 'kg')); page.keyboard.press('Backspace'); stuknij_obok()
        assert serie('kg')[0] is None and pole(0, 'kg').input_value() == '', f'skasowany ciężar ma zostać pusty: {serie("kg")} {pole(0, "kg").input_value()!r}'
        assert serie('kg') == [None] * 3, f'puste pole kopiuje się w dół jak wpisana wartość (serie z tą samą wartością): {serie("kg")}'
        r.klik(pole(0, 'kg')); stuknij_obok()
        assert serie('kg')[0] is None and pole(0, 'kg').input_value() == '', 'puste pole po ponownym stuknięciu i wyjściu ma zostać puste'
        nowy_trening([{'sets': [(10, 10), (10, 25), (10, 30)]}])
        r.klik(pole(1, 'kg')); stuknij_obok()
        assert serie('kg') == [10, 25, 30] and wartosci(3, 'kg') == ['10', '25', '30'], 'stuknięcie bez klawisza ma przywrócić wartość'
        r.klik(pole(1, 'kg')); page.keyboard.type('0'); stuknij_obok()
        assert serie('kg') == [10, None, None], f'0 kg = puste pole (masa ciała), idzie w dół jak każda zmiana: {serie("kg")}'
        r.klik(pole(1, 'reps')); page.keyboard.press('Backspace'); stuknij_obok()
        assert serie('reps')[1] is None and pole(1, 'reps').input_value() == '', f'skasowane powtórzenia zostają puste: {serie("reps")}'
        # Backspace w polu z wpisaną cyfrą (zdarzenie input) też daje puste pole
        r.klik(pole(2, 'kg')); page.keyboard.type('7'); page.keyboard.press('Backspace'); stuknij_obok()
        assert serie('kg')[2] is None and pole(2, 'kg').input_value() == '', f'wpisz i skasuj: {serie("kg")}'
    r.krok('pola serii: skasowanie ciężaru i powtórzeń zostawia puste pole, 0 kg = puste, stuknięcie bez klawisza przywraca (trening, E2-03)', b1_kasowanie, 'pola-e2-03-trening')

    def b1_kasowanie_plan_i_edycja():
        # E2-03 w edytorze planu i w edycji zapisanego treningu
        nowy_trening([{'sets': [(8, 10), (8, 10), (8, 10)]}], start=False)
        zakladka('plany'); r.klik('[data-act="editPlan"]'); r.klik('[data-act="toggleItem"]')
        kg = lambda j: page.locator(f'#view input[data-bind="pset"][data-i="{j}"][data-f="kg"]')
        expect(kg(0)).to_have_value('10')
        r.klik(kg(0)); expect(kg(0)).to_be_focused(); wyjdz('#view .prow .sn'); expect(kg(0)).to_have_value('10')
        assert page.evaluate('() => S.plans[0].items[0].sets.map(s => s.kg)') == [10, 10, 10], 'plan: stuknięcie bez klawisza nie zmienia ciężaru'
        r.klik(kg(0)); page.keyboard.press('Backspace'); wyjdz('#view .prow .sn')
        assert page.evaluate('() => S.plans[0].items[0].sets.map(s => s.kg)') == [None, None, None] and kg(0).input_value() == '' and kg(2).input_value() == '', 'plan: skasowany ciężar ma zostać pusty i pójść w dół jak każda zmiana'
        # edycja zapisanego treningu
        page.evaluate("""() => { SESS = [{id:'sB1', date:new Date(Date.now() - 3600e3).toISOString(), dur:1800, planId:'PT', planName:'Plan B1', dayId:'PT', dayName:'Plan B1',
          ex:[{exId:EX[0].id, name:EX[0].name, mode:'reps', sets:[{reps:8, kg:10}, {reps:8, kg:10}]}]}]; render(); }""")
        zakladka('historia'); r.klik('[data-act="hist"][data-v="treningi"]'); r.klik('[data-act="sessOpen"]'); r.klik('[data-act="sedOpen"]')
        sed = lambda j, f: page.locator(f'#sheet input[data-bind="sedSet"][data-i="0"][data-j="{j}"][data-f="{f}"]')
        expect(sed(0, 'kg')).to_have_value('10')
        r.klik(sed(0, 'kg')); wyjdz('#sheet .sed-row.head'); expect(sed(0, 'kg')).to_have_value('10')
        assert page.evaluate('() => topSheet().edit.ex[0].sets.map(s => s.kg)') == [10, 10], 'edycja treningu: stuknięcie bez klawisza nie zmienia ciężaru'
        r.klik(sed(0, 'kg')); page.keyboard.press('Backspace'); wyjdz('#sheet .sed-row.head')
        assert page.evaluate('() => topSheet().edit.ex[0].sets.map(s => s.kg)') == [None, None] and sed(0, 'kg').input_value() == '' and sed(1, 'kg').input_value() == '', 'edycja treningu: skasowany ciężar ma zostać pusty i pójść w dół'
        r.klik(sed(1, 'reps')); page.keyboard.type('8,5'); wyjdz('#sheet .sed-row.head')
        assert page.evaluate('() => topSheet().edit.ex[0].sets.map(s => s.reps)') == [8, 9] and sed(1, 'reps').input_value() == '9', 'edycja treningu: powtórzenia do całości'
        r.klik('[data-act="sedSave"]')
        assert page.evaluate('() => SESS[0].ex[0].sets.map(s => [s.reps, s.kg ?? null])') == [[8, None], [9, None]], 'zapis edycji treningu: pusty ciężar zostaje pusty'
    r.krok('pola serii: skasowanie ciężaru w planie i w edycji zapisanego treningu (E2-03)', b1_kasowanie_plan_i_edycja, 'pola-e2-03-plan-edycja')

    def b1_w_dol_plan_i_edycja():
        # zmiana w serii idzie do wszystkich niżej (nie do wyższych) także w edytorze planu i w edycji zapisanego treningu
        nowy_trening([{'sets': [(10, 60), (10, 70), (10, 80)]}], start=False)
        zakladka('plany'); r.klik('[data-act="editPlan"]'); r.klik('[data-act="toggleItem"]')
        pf = lambda j, f='kg': page.locator(f'#view input[data-bind="pset"][data-i="{j}"][data-f="{f}"]')
        r.klik(pf(0)); page.keyboard.type('65'); wyjdz('#view .prow .sn')
        assert page.evaluate('() => S.plans[0].items[0].sets.map(s => s.kg)') == [65, 65, 65] and [pf(j).input_value() for j in range(3)] == ['65'] * 3, 'plan: zmiana w serii 1 zmienia wszystko niżej'
        r.klik(pf(1)); page.keyboard.type('75'); wyjdz('#view .prow .sn')
        assert page.evaluate('() => S.plans[0].items[0].sets.map(s => s.kg)') == [65, 75, 75] and [pf(j).input_value() for j in range(3)] == ['65', '75', '75'], 'plan: zmiana w serii 2 nie rusza serii 1'
        r.klik(pf(0, 'reps')); page.keyboard.type('12'); wyjdz('#view .prow .sn')
        assert page.evaluate('() => S.plans[0].items[0].sets.map(s => s.reps)') == [12, 12, 12], 'plan: powtórzenia też idą w dół'
        page.evaluate("""() => { SESS = [{id:'sB1', date:new Date(Date.now() - 3600e3).toISOString(), dur:1800, planId:'PT', planName:'Plan B1', dayId:'PT', dayName:'Plan B1',
          ex:[{exId:EX[0].id, name:EX[0].name, mode:'reps', sets:[{reps:8, kg:10}, {reps:8, kg:20}, {reps:8, kg:30}]}]}]; render(); }""")
        zakladka('historia'); r.klik('[data-act="hist"][data-v="treningi"]'); r.klik('[data-act="sessOpen"]'); r.klik('[data-act="sedOpen"]')
        sed = lambda j, f: page.locator(f'#sheet input[data-bind="sedSet"][data-i="0"][data-j="{j}"][data-f="{f}"]')
        r.klik(sed(1, 'kg')); page.keyboard.type('25'); wyjdz('#sheet .sed-row.head')
        assert page.evaluate('() => topSheet().edit.ex[0].sets.map(s => s.kg)') == [10, 25, 25] and [sed(j, 'kg').input_value() for j in range(3)] == ['10', '25', '25'], 'edycja treningu: zmiana w serii 2 zmienia serię 3, nie serię 1'
        r.klik(sed(0, 'reps')); page.keyboard.type('10'); wyjdz('#sheet .sed-row.head')
        assert page.evaluate('() => topSheet().edit.ex[0].sets.map(s => s.reps)') == [10, 10, 10], 'edycja treningu: powtórzenia w serii 1 zmieniają wszystko niżej'
    r.krok('pola serii: zmiana w dół także w edytorze planu i w edycji zapisanego treningu', b1_w_dol_plan_i_edycja, 'pola-w-dol-plan-edycja')

    def b1_timer_po_usunieciu():
        # usunięcie ćwiczenia nie zeruje timera przerwy, gdy dotyczy innego ćwiczenia; przerwa przed usuniętym idzie dalej z następnym
        nowy_trening([{'sets': [(10, 60), (10, 60)]}, {'sets': [(10, 40), (10, 40)]}, {'sets': [(10, 20), (10, 20)]}])
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]')
        page.wait_for_function('() => ACTIVE.timer && ACTIVE.timer.kind === "rest"')
        t0 = page.evaluate('() => ACTIVE.timer.endsAt')
        def usun(i):
            # rozwinięta karta ma „Usuń” w menu „…”, zwinięta – od razu
            if not page.locator(f'#workout [data-act="wDelEx"][data-i="{i}"]').first.is_visible():
                r.klik(f'#workout [data-act="wMenu"][data-i="{i}"]')
            r.klik(f'#workout [data-act="wDelEx"][data-i="{i}"]'); r.klik('[data-act="confirmOk"]')
        usun(2)
        page.wait_for_function('() => ACTIVE.ex.length === 2')
        assert page.evaluate('() => ACTIVE.timer && ACTIVE.timer.endsAt') == t0 and page.evaluate('() => ACTIVE.timer.focus') == 0, 'usunięcie innego ćwiczenia (poniżej) nie rusza timera'
        # usunięcie ćwiczenia powyżej tego, którego dotyczy przerwa: timer idzie dalej, indeks przestawiony po kluczu
        page.evaluate('() => { ACTIVE.timer.focus = 1; saveActive(); renderWorkout(); }')
        usun(0)
        page.wait_for_function('() => ACTIVE.ex.length === 1')
        assert page.evaluate('() => ACTIVE.timer && ACTIVE.timer.endsAt') == t0 and page.evaluate('() => ACTIVE.timer.focus') == 0, 'usunięcie ćwiczenia powyżej: timer dalej, focus przestawiony na 0'
        # przerwa dotyczy usuwanego ćwiczenia, a innego niezrobionego nie ma: timer się kończy
        usun(0)
        page.wait_for_function('() => ACTIVE.ex.length === 0')
        assert page.evaluate('() => ACTIVE.timer') is None, 'brak ćwiczeń: timer zatrzymany'
    r.krok('trening: usunięcie ćwiczenia nie zeruje timera, gdy dotyczy innego ćwiczenia', b1_timer_po_usunieciu, 'timer-po-usunieciu')

    def b1_zapis_do_planu():
        # E2-02: tylko odhaczone serie, na swoich pozycjach; plan nie traci serii
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        r.klik(pole(0, 'kg')); page.keyboard.type('62,5'); stuknij_obok()
        r.klik(pole(1, 'reps')); page.keyboard.type('8'); stuknij_obok()
        for j in (0, 1):
            r.klik(f'#workout .chk[data-j="{j}"][data-act="toggleSet"]'); expect(page.locator(f'#workout .chk[data-j="{j}"][aria-pressed="true"]')).to_have_count(1)
        r.klik('#workout [data-act="finishOpen"]')
        expect(page.locator('#sheet .toggle')).to_contain_text('Zapisz dzisiejsze ciężary i wyższe powtórzenia w planie')
        assert 'jako nowe wartości' not in page.locator('#sheet .toggle').inner_text(), 'napis opcji ma być skrócony'
        assert 'i powtórzenia w planie' not in page.locator('#sheet .toggle').inner_text(), 'napis nie może obiecywać zapisu powtórzeń w obie strony'
        r.klik('#fin-upd'); expect(page.locator('#fin-upd')).to_be_checked()
        r.klik('#sheet [data-act="finishSave"]')
        page.wait_for_function('SESS.length === 1 && !ACTIVE')
        plan = page.evaluate('() => S.plans[0].items[0].sets.map(s => [s.reps, s.kg])')
        assert plan == [[10, 62.5], [10, 62.5], [10, 60]], f'plan 3×10×60, serie 62,5×10 i 62,5×8: ciężary 62,5/62,5/60, powtórzenia 10/10/10 (8 nie obniża celu): {plan}'
        # seria z 12 powtórzeniami podnosi cel do 12
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        r.klik(pole(0, 'reps')); page.keyboard.type('12'); stuknij_obok()
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]'); expect(page.locator('#workout .chk[data-j="0"][aria-pressed="true"]')).to_have_count(1)
        r.klik('#workout [data-act="finishOpen"]'); r.klik('#fin-upd'); r.klik('#sheet [data-act="finishSave"]')
        page.wait_for_function('SESS.length === 1 && !ACTIVE')
        plan = page.evaluate('() => S.plans[0].items[0].sets.map(s => [s.reps, s.kg])')
        assert plan == [[12, 60], [10, 60], [10, 60]], f'12 powtórzeń w serii 1 podnosi cel do 12: {plan}'
    r.krok('zapis do planu: tylko odhaczone serie, na swoich pozycjach, plan ma nadal 3 serie (E2-02)', b1_zapis_do_planu, 'plan-e2-02')

    def b1_zapis_do_planu_zamiennik():
        # E3-02: ćwiczenie zamienione w treningu i dodane w trakcie są pomijane; zwykłe ćwiczenie się aktualizuje, seria czasowa analogicznie (sekundy)
        nowy_trening([{'sets': [(8, 100), (8, 100)]}, {'sets': [(10, 20), (10, 20)]}, {'mode': 'time', 'sets': [(30, None), (30, None)]}])
        przed = page.evaluate('() => JSON.stringify(S.plans[0].items)')
        r.klik('#workout [data-act="wMenu"][data-i="0"]'); r.klik('#workout [data-act="wSwap"][data-i="0"]')
        r.klik('#sheet [data-act="swapDo"]'); expect(page.locator('#sheet-wrap')).to_be_hidden()
        assert page.evaluate('() => ACTIVE.ex[0].exId !== S.plans[0].items[0].exId'), 'zamiennik nie został wybrany'
        page.evaluate("""() => {
          ACTIVE.ex[0].sets.forEach(s => { s.kg = 55; s.reps = 5; s.done = true; });                       // zamiennik
          ACTIVE.ex[1].sets[0].kg = 22.5; ACTIVE.ex[1].sets[0].reps = 9; ACTIVE.ex[1].sets[0].done = true; // zwykłe ćwiczenie, jedna seria zrobiona
          ACTIVE.ex[2].sets[1].sec = 41; ACTIVE.ex[2].sets[1].done = true; ACTIVE.ex[2].sets[0].sec = 20; ACTIVE.ex[2].sets[0].done = true; // seria na czas: 41 s podnosi, 20 s nie obniża
          const d = newWorkoutEx(EX[5].id); d.sets.forEach(s => { s.kg = 15; s.reps = 12; s.done = true; }); ACTIVE.ex.push(d); // dodane w trakcie
          saveActive(); renderWorkout();
        }""")
        r.klik('#workout [data-act="finishOpen"]'); r.klik('#fin-upd'); r.klik('#sheet [data-act="finishSave"]')
        page.wait_for_function('SESS.length === 1 && !ACTIVE')
        po = page.evaluate('() => S.plans[0].items.map(i => i.sets.map(s => i.mode === "time" ? [s.sec, s.kg ?? null] : [s.reps, s.kg ?? null]))')
        assert page.evaluate('() => S.plans[0].items.length') == 3, 'liczba ćwiczeń w planie się zmieniła'
        assert json.loads(przed)[0]['sets'] == page.evaluate('() => S.plans[0].items[0].sets') and page.evaluate('() => S.plans[0].items[0].exId === EX[0].id'), 'przysiad zamieniony w treningu ma zostać w planie bez zmian'
        assert po[1] == [[10, 22.5], [10, 20]] and po[2] == [[30, None], [41, None]], f'zwykłe ćwiczenie (9 < 10 nie obniża celu) i seria na czas (41 s > 30 s podnosi): {po}'
    r.krok('zapis do planu: zamiennik i ćwiczenie dodane w trakcie są pomijane, seria na czas analogicznie (E3-02)', b1_zapis_do_planu_zamiennik, 'plan-e3-02')

    def b1_puste_powtorzenia():
        # E2-09: odhaczenie serii z pustym polem powtórzeń → pole podświetlone, seria nieodhaczona; powtórzenia do całości
        nowy_trening([{'sets': [(None, 40), (None, 40)]}])
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]')
        expect(pole(0, 'reps')).to_have_class(re.compile(r'\bbad\b')); expect(pole(0, 'reps')).to_be_focused()
        assert page.evaluate('() => ACTIVE.ex[0].sets[0].done') is False, 'seria z pustymi powtórzeniami nie może się odhaczyć'
        expect(page.locator('#workout .chk[data-j="0"]')).to_have_attribute('aria-pressed', 'false')
        page.keyboard.type('8,5'); stuknij_obok()
        assert serie('reps')[0] == 9 and pole(0, 'reps').input_value() == '9', f'8,5 powtórzenia → liczba całkowita: {serie("reps")} {pole(0, "reps").input_value()!r}'
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]'); expect(page.locator('#workout .chk[data-j="0"][aria-pressed="true"]')).to_have_count(1)
        assert page.evaluate('() => buildSession().ex[0].sets.map(s => s.reps)') == [9], 'zapisane powtórzenia całkowite'
        # wypełnianie pustego pola powtórzeń celem z planu zostaje (nie ruszamy)
        nowy_trening([{'sets': [(12, 40), (12, 40)]}])
        r.klik(pole(0, 'reps')); page.keyboard.press('Backspace'); stuknij_obok()
        assert serie('reps')[0] is None, 'skasowane powtórzenia'
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]'); expect(page.locator('#workout .chk[data-j="0"][aria-pressed="true"]')).to_have_count(1)
        assert serie('reps')[0] == 12, 'puste pole powtórzeń przy odhaczaniu wypełnia się celem z planu'
    r.krok('odhaczanie serii z pustym polem powtórzeń: podświetlenie bez odhaczenia, powtórzenia do całości (E2-09)', b1_puste_powtorzenia, 'pola-e2-09')

    def b1_poprawka_literowki():
        # poprawka literówki i wartość pośrednia: zmiana w serii zawsze kończy się wartością końcową we wszystkich seriach niżej
        nowy_trening([{'sets': [(12, 60), (10, 60), (8, 60)]}])
        r.klik(pole(0, 'reps')); page.keyboard.type('8'); page.keyboard.press('Backspace'); page.keyboard.type('10'); stuknij_obok()
        assert serie('reps') == [10, 10, 10], f'12/10/8, w serii 1: 8, Backspace, 10 – wszystkie niżej mają 10: {serie("reps")}'
        nowy_trening([{'sets': [(10, 60), (10, 70), (10, 7)]}])
        r.klik(pole(0, 'kg')); page.keyboard.type('75'); stuknij_obok()
        assert serie('kg') == [75, 75, 75], f'60/70/7, wpisane 75 w serii 1 – pośrednie „7” nie zostaje: {serie("kg")}'
        # zmiana w serii niższej nie rusza wyższych
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        r.klik(pole(2, 'kg')); page.keyboard.type('70'); stuknij_obok()
        assert serie('kg') == [60, 60, 70], f'zmiana w ostatniej serii nie rusza poprzednich: {serie("kg")}'
        # kolejne edycje tego samego pola (60/60/60 → 65 → potem 70: wszystkie trzy)
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        r.klik(pole(0, 'kg')); page.keyboard.type('65'); stuknij_obok()
        r.klik(pole(0, 'kg')); page.keyboard.type('70'); stuknij_obok()
        assert serie('kg') == [70, 70, 70], f'dwie kolejne edycje serii 1: {serie("kg")}'
        # keydown bez klawisza (autouzupełnianie Chrome) nie może rzucić błędu strony (pilnuje strażnik pageerror po kroku)
        page.evaluate("() => { document.dispatchEvent(new Event('keydown')); }")
    r.krok('pola serii: poprawka literówki i wartość pośrednia, zmiana niżej nie rusza wyższych; keydown bez klawisza', b1_poprawka_literowki, 'pola-literowka')

    def b1_zwiniecie_po_ostatniej_serii():
        # ćwiczenie z wszystkimi seriami odhaczonymi zwija się od razu, bez odpowiedzi na pytanie o zapas i bez startu następnego ćwiczenia
        nowy_trening([{'sets': [(10, 60), (10, 60)]}, {'sets': [(10, 40), (10, 40)]}])
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]'); expect(page.locator('#workout .wex').first.locator('.rir')).to_have_count(1)
        assert page.locator('#workout .wex.mini').count() == 1, 'po pierwszej z dwóch serii pierwsze ćwiczenie ma zostać rozwinięte (zwinięte jest tylko drugie)'
        r.klik('#workout .wex:not(.mini) .chk[data-j="1"][data-act="toggleSet"]')
        expect(page.locator('#workout .wex.mini.alldone')).to_have_count(1)
        assert page.evaluate('() => ACTIVE.ex[0].sets.every(s => s.done)') is True and page.evaluate('() => ACTIVE.ex[1].sets.some(s => s.done)') is False, 'pierwsze zrobione, drugie nietknięte'
        # „Pokaż” rozwija kartę, a pytanie o zapas przy ostatniej serii nadal czeka
        r.klik('#workout .wex.mini.alldone [data-act="wOpenCard"]')
        expect(page.locator('#workout .rir')).to_have_count(1)
    r.krok('trening: ćwiczenie zwija się od razu po odhaczeniu wszystkich serii (bez odpowiedzi na pytanie o zapas)', b1_zwiniecie_po_ostatniej_serii, 'zwiniecie-po-ostatniej')

    def b1_zmiana_po_odhaczeniu():
        # zmiana w serii już odhaczonej też idzie do kolejnych niezrobionych serii o tej samej wartości; odhaczone serie zostają
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60), (10, 60)]}])
        for j in (0, 1):
            r.klik(f'#workout .chk[data-j="{j}"][data-act="toggleSet"]'); expect(page.locator(f'#workout .chk[data-j="{j}"][aria-pressed="true"]')).to_have_count(1)
        r.klik(pole(0, 'kg')); page.keyboard.type('62,5'); stuknij_obok()
        assert serie('kg') == [62.5, 60, 62.5, 62.5], f'zmiana kg w odhaczonej serii 1: serie 3 i 4 idą za nią, odhaczona 2 zostaje: {serie("kg")}'
        r.klik(pole(1, 'reps')); page.keyboard.type('8'); stuknij_obok()
        assert serie('reps') == [10, 8, 8, 8], f'zmiana powtórzeń w odhaczonej serii 2: serie 3 i 4 idą za nią, seria 1 bez zmian: {serie("reps")}'
        assert wartosci(4, 'kg') == ['62,5', '60', '62,5', '62,5'] and wartosci(4, 'reps') == ['10', '8', '8', '8'], 'pola po zmianach'
    r.krok('pola serii: zmiana w odhaczonej serii idzie do kolejnych niezrobionych', b1_zmiana_po_odhaczeniu, 'pola-po-odhaczeniu')

    def b1_zapis_do_planu_pozycje():
        def zakoncz_z_planem():
            r.klik('#workout [data-act="finishOpen"]'); r.klik('#fin-upd'); expect(page.locator('#fin-upd')).to_be_checked()
            r.klik('#sheet [data-act="finishSave"]'); page.wait_for_function('SESS.length === 1 && !ACTIVE')
            return page.evaluate('() => S.plans[0].items[0].sets.map(s => [s.reps, s.kg])')
        # pi: odhaczone serie 1 i 3, środkowa usunięta w treningu → wartości trafiają na pozycje 1 i 3 w planie (nie 1 i 2)
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        page.evaluate("() => { const x = ACTIVE.ex[0]; x.sets[0].kg = 61; x.sets[0].done = true; x.sets[2].kg = 63; x.sets[2].done = true; saveActive(); renderWorkout(); }")
        r.klik('#workout [data-act="wDelSet"][data-i="0"]')
        assert page.evaluate('() => ACTIVE.ex[0].sets.length') == 2, 'usunięcie serii 2 w treningu'
        plan = zakoncz_z_planem()
        assert plan == [[10, 61], [10, 60], [10, 63]], f'pozycje pi po usunięciu środkowej serii: {plan}'
        # seria dodana w treningu nie trafia do planu (plan nie rośnie)
        nowy_trening([{'sets': [(10, 60), (10, 60)]}])
        r.klik('#workout [data-act="wAddSet"][data-i="0"]')
        page.evaluate("() => { ACTIVE.ex[0].sets.forEach(s => { s.done = true; s.reps = 6; }); saveActive(); renderWorkout(); }")
        plan = zakoncz_z_planem()
        assert plan == [[10, 60], [10, 60]], f'dodana seria w treningu nie rozszerza planu, 6 powtórzeń nie obniża celu: {plan}'
        # plan zmieniony w trakcie treningu (inna liczba serii) → ćwiczenie pominięte przy zapisie do planu
        nowy_trening([{'sets': [(10, 60), (10, 70), (10, 80)]}])
        page.evaluate("() => { const x = ACTIVE.ex[0]; x.sets[2].kg = 85; x.sets[2].done = true; S.plans[0].items[0].sets.splice(0, 1); persist(); saveActive(); renderWorkout(); }")
        plan = zakoncz_z_planem()
        assert plan == [[10, 70], [10, 80]], f'plan po usunięciu serii w trakcie treningu nie może dostać wartości z przesuniętej pozycji: {plan}'
        # trening w toku sprzed zmiany (bez pi i pn) → pozycje według kolejności, jak dawniej
        nowy_trening([{'sets': [(10, 60), (10, 60), (10, 60)]}])
        page.evaluate("() => { const x = ACTIVE.ex[0]; delete x.pn; x.sets.forEach(s => delete s.pi); x.sets[1].kg = 65; x.sets[1].reps = 8; x.sets[1].done = true; saveActive(); renderWorkout(); }")
        plan = zakoncz_z_planem()
        assert plan == [[10, 60], [10, 65], [10, 60]], f'trening sprzed zmiany (bez pi), 8 nie obniża celu: {plan}'
    r.krok('zapis do planu: pozycje pi, dodana seria, plan zmieniony w trakcie, trening bez pi (E2-02)', b1_zapis_do_planu_pozycje, 'plan-pi')

    def b1_czcionka_pol():
        nowy_trening([{'sets': [(10, 20)]}])
        przed = page.evaluate("() => [...document.querySelectorAll('#workout input[data-bind=\"wset\"]')].map(e => parseFloat(getComputedStyle(e).fontSize))")
        assert przed and min(przed) >= 16, f'czcionka pól serii w treningu < 16 px: {przed}'
        page.evaluate("() => { ACTIVE = null; saveActive(); ui.showWorkout = false; render(); renderWorkout(); }")
        zakladka('plany'); r.klik('[data-act="editPlan"]'); r.klik('[data-act="toggleItem"]')
        pl_ = page.evaluate("() => [...document.querySelectorAll('#view input[data-bind=\"pset\"]')].map(e => parseFloat(getComputedStyle(e).fontSize))")
        assert pl_ and min(pl_) >= 16, f'czcionka pól serii w planie < 16 px: {pl_}'
    r.krok('pola serii: czcionka co najmniej 16 px (trening, plan)', b1_czcionka_pol)

    # ---- B2: odporność trybu treningu (E2-06, E6-09b, E2-07, E2-08, E2-11, E2-12) ----
    def klucze():
        return page.evaluate('() => ACTIVE.ex.map(x => x.key)')

    def b2_usuniecie_po_kluczu():
        # E2-06 / E6-09b: potwierdzenie usunięcia pamięta ćwiczenie (klucz), nie numer pozycji
        nowy_trening([{'sets': [(10, 20), (10, 20)]}, {'mode': 'time', 'sets': [(1, None)]}, {'sets': [(10, 30), (10, 30)]}])
        k = klucze()
        r.klik('#workout [data-act="wMenu"][data-i="0"]'); r.klik('#workout [data-act="wDelEx"][data-i="0"]')
        expect(page.locator('#sheet [data-act="confirmOk"]')).to_be_visible()
        # w tle kończy się seria na czas w ćwiczeniu B: zrobione ćwiczenie wędruje na górę, A przesuwa się na pozycję 1
        page.evaluate("() => { ACT.startWork({dataset:{i:'1', j:'0'}}); ACTIVE.timer.endsAt = Date.now() - 1; }")
        page.wait_for_function("() => ACTIVE.ex[0].sets[0].done === true && ACTIVE.ex.length === 3")
        assert klucze()[0] == k[1] and klucze()[1] == k[0], f'lista miała się przestawić: {klucze()} / {k}'
        r.klik('#sheet [data-act="confirmOk"]')
        assert klucze() == [k[1], k[2]], f'ma zniknąć A (nie B): {klucze()} / {k}'
        assert page.evaluate('() => ACTIVE.ex[0].sets[0].done') is True, 'odhaczona seria B ma zostać'
        # to samo, gdy ćwiczenie zniknęło w międzyczasie (np. zmiana z drugiego urządzenia): nic się nie dzieje
        r.klik('#workout [data-act="wMenu"][data-i="1"]'); r.klik('#workout [data-act="wDelEx"][data-i="1"]')
        page.evaluate("(key) => { ACTIVE.ex = ACTIVE.ex.filter(x => x.key !== key); saveActive(); renderWorkout(); }", k[2])
        r.klik('#sheet [data-act="confirmOk"]')
        assert klucze() == [k[1]], f'ćwiczenia już nie było, nic nie miało zniknąć: {klucze()}'
        # przyciski nakładki działają po kluczu, nie po numerze zapisanym w przycisku
        nowy_trening([{'sets': [(10, 20), (10, 20)]}, {'sets': [(10, 30), (10, 30)]}])
        k = klucze()
        page.evaluate("() => { const b = document.querySelector('#workout [data-act=\"wAddSet\"][data-i=\"0\"]'); b.dataset.i = '1'; }")
        r.klik('#workout [data-act="wAddSet"][data-i="1"]')
        assert page.evaluate('() => ACTIVE.ex.map(x => x.sets.length)') == [3, 2], 'przycisk ćwiczenia A ma działać na A, mimo błędnego numeru'
    r.krok('trening: usunięcie ćwiczenia po kluczu, gdy lista się przestawiła (E2-06, E6-09b)', b2_usuniecie_po_kluczu, 'trening-e2-06')

    def b2_seria_na_czas():
        # E2-07: „Usuń serię” i „Zamień” w trakcie odliczania zatrzymują odliczanie tej serii
        nowy_trening([{'mode': 'time', 'sets': [(40, None), (40, None)]}])
        r.klik('#workout .chk[data-act="startWork"][data-j="1"]')
        assert page.evaluate("() => ACTIVE.timer && ACTIVE.timer.kind") == 'work', 'odliczanie serii nie ruszyło'
        r.klik('#workout [data-act="wDelSet"][data-i="0"]')
        assert page.evaluate('() => ACTIVE.timer') is None and page.evaluate('() => ACTIVE.ex[0].sets.length') == 1, 'usunięcie serii ma zatrzymać odliczanie'
        expect(page.locator('#tbar')).to_have_class(re.compile(r'\bidle\b'))
        expect(page.locator('#tbar [data-act="stopWork"]')).to_have_count(0)
        page.evaluate("() => ACT.stopWork()")   # stary przycisk „Zakończ serię” nie może nic zepsuć
        assert page.evaluate('() => ACTIVE.ex[0].sets.every(s => !s.done)'), 'stopWork bez odliczania nie odhacza serii'
        # stopWork sprawdza, czy seria nadal istnieje
        page.evaluate("() => { ACT.startWork({dataset:{i:'0', j:'0'}}); ACTIVE.ex[0].sets.length = 0; ACT.stopWork(); }")
        assert page.evaluate('() => ACTIVE.timer') is None, 'seria zniknęła: pasek ma zniknąć bez błędu'
        # „Zamień” w trakcie odliczania
        nowy_trening([{'mode': 'time', 'sets': [(40, None), (40, None)]}])
        r.klik('#workout .chk[data-act="startWork"][data-j="0"]')
        r.klik('#workout [data-act="wMenu"][data-i="0"]'); r.klik('#workout [data-act="wSwap"][data-i="0"]')
        r.klik('#sheet [data-act="swapDo"]'); expect(page.locator('#sheet-wrap')).to_be_hidden()
        assert page.evaluate('() => ACTIVE.timer') is None, 'zamiana ma zatrzymać odliczanie starego ćwiczenia'
        page.evaluate("() => { ACTIVE.ex[0].sets[0].sec = 1; }")
        page.wait_for_timeout(1500)
        assert page.evaluate('() => ACTIVE.ex[0].sets.every(s => !s.done)'), 'zamiennik nie może mieć odhaczonej serii'
    r.krok('seria na czas: „Usuń serię” i „Zamień” w trakcie odliczania (E2-07)', b2_seria_na_czas, 'trening-e2-07')

    def b2_zapomniany_trening():
        # E2-08: wznowienie po ponad 2 godzinach bez serii: pytanie; przerwa nie wlicza się do czasu
        def zawies():
            nowy_trening([{'sets': [(10, 20), (10, 20), (10, 20)]}])
            r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]')
            page.evaluate("() => { const t = Date.now() - 26 * 3600e3; ACTIVE.startedAt = t - 600e3; ACTIVE.lastSetAt = t; ACTIVE.ex[0].firstAt = t; ACTIVE.timer = null; saveActive(); }")
            page.wait_for_selector('#sheet [data-act="finishSave"]')   # istniejące pytanie o zakończenie po 2 godzinach bez serii
            page.evaluate('() => closeSheet()')
            expect(page.locator('#sheet-wrap')).to_be_hidden()
        zawies()
        r.klik('#workout .chk[data-j="1"][data-act="toggleSet"]')
        expect(page.locator('#sheet [data-act="confirmOk2"]')).to_be_visible()
        assert page.evaluate('() => ACTIVE.ex[0].sets[1].done') is False, 'do odpowiedzi seria nie może się odhaczyć'
        r.klik('#sheet [data-act="confirmOk"]')   # Dokończ tamten
        assert page.evaluate('() => ACTIVE.ex[0].sets[1].done') is True, 'po „Dokończ tamten” seria ma się odhaczyć'
        dur = page.evaluate('() => buildSession().dur')
        assert 590 <= dur <= 720, f'czas ma być bez przerwy 26 godzin (około 10 min): {dur} s'
        zawies()
        r.klik('#workout .chk[data-j="1"][data-act="toggleSet"]')
        r.klik('#sheet [data-act="confirmOk2"]')   # Zapisz tamten i zacznij nowy
        page.wait_for_function('() => SESS.length === 1 && ACTIVE && ACTIVE.planId === "PT" && ACTIVE.ex[0].sets.every(s => !s.done)')
        sd = page.evaluate('() => SESS[0].dur')
        assert 590 <= sd <= 620 and page.evaluate('() => SESS[0].ex[0].sets.length') == 1, f'zapisany tamten trening: {sd} s'
    r.krok('zapomniany trening: pytanie po 2 godzinach bez serii, czas bez przerwy (E2-08)', b2_zapomniany_trening, 'trening-e2-08')

    def b2_pytanie_o_zapas():
        # E2-11: pytanie o zapas znika po cofnięciu odhaczenia i po serii na czas; kolejność w zapisie = kolejność wykonania
        nowy_trening([{'sets': [(10, 20)]}, {'mode': 'time', 'sets': [(30, None)]}, {'sets': [(10, 30), (10, 30)]}])
        e = page.evaluate('() => ACTIVE.ex.map(x => x.exId)')
        r.klik('#workout .chk[data-act="toggleSet"][data-i="0"][data-j="0"]')
        # ostatnia seria ćwiczenia: karta zwija się od razu (B1b), pytanie czeka; „Pokaż” je odsłania
        assert page.evaluate('() => ACTIVE.rirAsk && ACTIVE.rirAsk.j') == 0, 'po odhaczeniu pytanie o zapas czeka'
        r.klik('#workout .wex.mini.alldone [data-act="wOpenCard"]')
        expect(page.locator('#workout .rir')).to_have_count(1)
        r.klik('#workout .chk[data-act="toggleSet"][data-i="0"][data-j="0"]')   # cofnięcie
        expect(page.locator('#workout .rir')).to_have_count(0)
        assert page.evaluate('() => ACTIVE.rirAsk') is None, 'cofnięcie odhaczenia ma zdjąć pytanie o zapas'
        page.evaluate("() => ACT.toggleSet({dataset:{i:'0', j:'0'}})")   # znów odhaczone, bez odpowiedzi (karta A jest zwinięta, bo przerwa wskazuje B)
        page.evaluate("() => { ACT.startWork({dataset:{i:'1', j:'0'}}); ACT.stopWork(); }")   # seria na czas w drugim ćwiczeniu
        assert page.evaluate('() => ACTIVE.rirAsk') is None, 'po serii na czas pytanie ma zniknąć'
        order = page.evaluate('() => buildSession().ex.map(x => x.exId)')
        assert order == [e[0], e[1]], f'kolejność w zapisie ma być wykonana (A, potem B): {order}'
        # kolejność z pierwszej odhaczonej serii także wtedy, gdy lista została przestawiona
        page.evaluate("() => { ACTIVE.ex.reverse(); }")
        assert page.evaluate('() => buildSession().ex.map(x => x.exId)') == [e[0], e[1]], 'zapis ma iść według pierwszej odhaczonej serii'
    r.krok('pytanie o zapas: znika przy cofnięciu i po serii na czas, kolejność w zapisie (E2-11)', b2_pytanie_o_zapas, 'trening-e2-11')

    def b2_start_innego_planu():
        # E2-12: start innego planu przy treningu w toku z odhaczonymi seriami: trzy wyjścia
        nowy_trening([{'sets': [(10, 20), (10, 20)]}])
        page.evaluate("() => { S.plans.push({id:'PT2', name:'Plan drugi', items:[{id:'z0', exId:EX[3].id, mode:'reps', rest:60, restAfter:90, note:'', sets:[{reps:8, kg:10}]}]}); commit(); }")
        page.evaluate("() => ACT.startPlan({dataset:{plan:'PT2'}})")
        assert page.locator('#sheet [data-act="confirmOk2"]').count() == 0, 'bez odhaczonych serii nie ma „Zapisz tamten”'
        page.evaluate('() => closeSheet()')
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]')
        page.evaluate("() => ACT.startPlan({dataset:{plan:'PT2'}})")
        expect(page.locator('#sheet .sheet-f [data-act="closeSheet"]')).to_be_visible()
        expect(page.locator('#sheet [data-act="confirmOk"]')).to_have_text('Odrzuć i zacznij nowy')
        expect(page.locator('#sheet [data-act="confirmOk2"]')).to_have_text('Zapisz tamten i zacznij nowy')
        r.klik('#sheet [data-act="confirmOk2"]')
        page.wait_for_function('() => SESS.length === 1 && ACTIVE && ACTIVE.planId === "PT2"')
        assert page.evaluate('() => SESS[0].planId') == 'PT' and page.evaluate('() => SESS[0].ex[0].sets.length') == 1, 'pierwszy trening ma być w historii z jedną serią'
        assert page.evaluate('() => ACTIVE.ex.length') == 1, 'nowy trening z planu drugiego'
        page.evaluate("() => { ACTIVE = null; saveActive(); ui.showWorkout = false; render(); renderWorkout(); }")   # kolejne kroki zaczynają bez treningu w toku
    r.krok('start innego planu przy treningu w toku: „Zapisz tamten i zacznij nowy” (E2-12)', b2_start_innego_planu, 'trening-e2-12')

    # ---- B6 (E2-05): superserie przy przestawianiu, usuwaniu własnego ćwiczenia i „Ułóż w tej kolejności” ----
    def b6_plan(n=3, ss=((0, 1),)):
        nowy_trening([{'sets': [(10, 20), (10, 20)]} for _ in range(n)], start=False)
        page.evaluate("(ss) => { ss.forEach(([a]) => { S.plans[0].items[a].ssNext = true; }); commit(); }", [list(x) for x in ss])
    def b6_flagi():
        return page.evaluate('() => S.plans[0].items.map(i => [i.id, !!i.ssNext])')
    def b6_idy():
        return page.evaluate('() => S.plans[0].items.map(i => i.id)')
    def b6_klik_plan(akcja, item, kierunek=None):
        page.evaluate("(id) => { ui.openItem = id; render(); }", item)
        sel = f'#view [data-act="{akcja}"][data-item="{item}"]' + (f'[data-dir="{kierunek}"]' if kierunek else '')
        r.klik(sel)

    def b6_plan_przesuwanie():
        # A+B w superserii, C osobno; C w górę: przeskakuje całą parę, A i B zostają parą, C nie łączy się z A
        b6_plan(3, ((0, 1),))
        zakladka('plany'); r.klik('[data-act="editPlan"]')
        b6_klik_plan('itemMove', 'it2', -1)
        assert b6_idy() == ['it2', 'it0', 'it1'] and b6_flagi() == [['it2', False], ['it0', True], ['it1', False]], f'C w górę: para A+B zostaje, C bez połączenia: {b6_flagi()}'
        # C z powrotem w dół: też przeskakuje całą parę
        b6_klik_plan('itemMove', 'it2', 1)
        assert b6_idy() == ['it0', 'it1', 'it2'] and b6_flagi() == [['it0', True], ['it1', False], ['it2', False]], f'C w dół: {b6_flagi()}'
        # członek pary (B) przesuwa się razem z całą superserią; przycisk „Niżej” wyłączony, gdy blok jest na końcu listy
        b6_klik_plan('itemMove', 'it1', 1)
        assert b6_idy() == ['it2', 'it0', 'it1'] and b6_flagi() == [['it2', False], ['it0', True], ['it1', False]], f'B w dół przesuwa całą superserię: {b6_flagi()}'
        page.evaluate("() => { ui.openItem = 'it1'; render(); }")
        assert page.locator('#view [data-act="itemMove"][data-item="it1"][data-dir="1"]').is_disabled(), 'blok na końcu: „Niżej” wyłączone'
        # dwie superserie obok siebie nie zlewają się: druga (przez swojego członka) przeskakuje pierwszą jako całość
        b6_plan(4, ((0, 1), (2, 3)))
        zakladka('plany'); r.klik('[data-act="editPlan"]')
        b6_klik_plan('itemMove', 'it3', -1)
        assert b6_idy() == ['it2', 'it3', 'it0', 'it1'] and [f for _, f in b6_flagi()] == [True, False, True, False], f'dwie pary zamieniły się miejscami: {b6_flagi()}'
    r.krok('plan: przesunięcie ćwiczenia nad połączoną parę nie łączy go z nią, superseria idzie jako całość (E2-05)', b6_plan_przesuwanie, 'plan-e2-05-przesuwanie')

    def b6_wlasne_usuniecie():
        # własne ćwiczenie jako drugie w superserii: po usunięciu z biblioteki następne dodane nie jest superserią
        b6_plan(1, ())
        page.evaluate("""() => { S.custom.push({id:'c_b6', name:'Własne B6', group:'Plecy', equipment:'Hantle', mode:'reps', steps:[], tips:[], primary:[], secondary:[], custom:true, level:''});
          S.plans[0].items[0].ssNext = true; S.plans[0].items.push(newItem('c_b6')); commit(); }""")
        assert b6_flagi()[0][1] is True and len(b6_idy()) == 2, 'przygotowanie: superseria z własnym ćwiczeniem'
        page.evaluate("() => { ACT.customDel({dataset:{id:'c_b6'}}); }")
        r.klik('[data-act="confirmOk"]')
        page.wait_for_function('() => S.plans[0].items.length === 1')
        assert b6_flagi() == [['it0', False]], f'po usunięciu własnego ćwiczenia poprzednik nie ma wiszącego połączenia: {b6_flagi()}'
        page.evaluate("() => { ACT.covAdd({dataset:{plan:'PT', id:EX[5].id}}); }")
        assert b6_flagi()[0][1] is False and len(b6_idy()) == 2 and page.evaluate('() => !S.plans[0].items[1].ssNext'), 'nowe ćwiczenie po usunięciu własnego nie jest superserią'
        # środek trójki: usunięcie środkowego własnego zostawia połączenie poprzednika z następnym (łańcuch bez dziury)
        b6_plan(3, ((0, 1), (1, 2)))
        page.evaluate("""() => { S.custom.push({id:'c_b6', name:'Własne B6', group:'Plecy', equipment:'Hantle', mode:'reps', steps:[], tips:[], primary:[], secondary:[], custom:true, level:''});
          S.plans[0].items[1].exId = 'c_b6'; commit(); ACT.customDel({dataset:{id:'c_b6'}}); }""")
        r.klik('[data-act="confirmOk"]')
        page.wait_for_function('() => S.plans[0].items.length === 2')
        assert b6_flagi() == [['it0', True], ['it2', False]], f'środek superserii usunięty: pozostałe dwa nadal para: {b6_flagi()}'
    r.krok('własne ćwiczenie: usunięcie nie zostawia wiszącej superserii u poprzednika (E2-05)', b6_wlasne_usuniecie, 'plan-e2-05-usuniecie')

    def b6_wiszace_stare():
        # stary plan z wiszącym połączeniem na ostatnim ćwiczeniu: dopisane ćwiczenie nie staje się superserią (trzy drogi dodawania)
        for akcja in ("ACT.covAdd({dataset:{plan:'PT', id:EX[5].id}})", "ACT.addToPlanGo({dataset:{plan:'PT', id:EX[6].id}})"):
            b6_plan(2, ())
            page.evaluate("() => { S.plans[0].items[1].ssNext = true; commit(); }")
            page.evaluate("() => { %s; }" % akcja)
            assert b6_flagi() == [['it0', False], ['it1', False], [b6_idy()[2], False]], f'{akcja}: wiszące połączenie wyczyszczone, nowe nie w superserii: {b6_flagi()}'
        b6_plan(2, ())
        page.evaluate("() => { S.plans[0].items[1].ssNext = true; commit(); openSheet({type:'pick', target:{kind:'plan', plan:'PT'}, q:'', group:'', sel:[EX[7].id, EX[8].id]}); }")
        r.klik('#sheet [data-act="pickAdd"]')
        page.wait_for_function('() => S.plans[0].items.length === 4')
        assert [f for _, f in b6_flagi()] == [False] * 4, f'wybór kilku ćwiczeń: żadne nie jest superserią: {b6_flagi()}'
    r.krok('stary plan z wiszącym połączeniem: dopisane ćwiczenie nie staje się superserią (E2-05)', b6_wiszace_stare, 'plan-e2-05-wiszace')

    def b6_uloz():
        # „Ułóż w tej kolejności”: ostrzeżenie przed rozłączeniem; superseria, której kolejność się nie zmienia, zostaje
        nowy_trening([{'sets': [(10, 20)]} for _ in range(4)], start=False)
        # a) odwrócona kolejność sugerowanej, para na początku: kolejność pary się zmieni → ostrzeżenie, po zatwierdzeniu brak superserii
        page.evaluate("""() => { const p = S.plans[0], s = suggestOrder(p).sorted.map(x => x.it); p.items = s.slice().reverse(); p.items.forEach(x => x.ssNext = false);
          p.items[0].ssNext = true; delete p.orderOk; commit(); }""")
        page.evaluate("() => ACT.orderApply({dataset:{plan:'PT'}})")
        expect(page.locator('#sheet [data-act="confirmOk"]')).to_be_visible()
        assert page.evaluate('() => S.plans[0].items.some(i => i.ssNext)'), 'przed potwierdzeniem nic się nie zmienia'
        page.evaluate('() => closeSheet()')
        assert page.evaluate('() => S.plans[0].items.some(i => i.ssNext)'), 'anulowanie zostawia superserię'
        page.evaluate("() => ACT.orderApply({dataset:{plan:'PT'}})")
        r.klik('[data-act="confirmOk"]')
        assert not page.evaluate('() => S.plans[0].items.some(i => i.ssNext)'), 'po potwierdzeniu superserie rozłączone'
        # b) para, która po ułożeniu nadal stoi obok siebie w tej samej kolejności: zostaje, bez ostrzeżenia
        page.evaluate("""() => { const p = S.plans[0], s = suggestOrder(p).sorted.map(x => x.it); p.items = [s[3], s[0], s[1], s[2]]; p.items.forEach(x => x.ssNext = false);
          p.items[1].ssNext = true; delete p.orderOk; commit(); window.__ids = [p.items[1].id, p.items[2].id]; }""")
        page.evaluate("() => ACT.orderApply({dataset:{plan:'PT'}})")
        assert page.locator('#sheet [data-act="confirmOk"]').count() == 0, 'nic nie rozłączamy, więc bez ostrzeżenia'
        assert page.evaluate("() => { const it = S.plans[0].items; const a = it.findIndex(x => x.id === window.__ids[0]); return !!it[a].ssNext && it[a + 1].id === window.__ids[1]; }"), 'para o niezmienionej kolejności została superserią'
        assert page.evaluate('() => S.plans[0].items.filter(i => i.ssNext).length') == 1, 'jedna superseria'
    r.krok('„Ułóż w tej kolejności”: ostrzeżenie przed rozłączeniem, niezmienione superserie zostają (E2-05)', b6_uloz, 'plan-e2-05-uloz')

    def b6_trening_przesuwanie():
        # trening: to samo przestawianie, z trwającą przerwą timer zostaje przy swoim ćwiczeniu
        nowy_trening([{'sets': [(10, 60), (10, 60)]} for _ in range(3)])
        page.evaluate("() => { ACTIVE.ex[0].ssNext = true; saveActive(); renderWorkout(); }")
        keys = page.evaluate('() => ACTIVE.ex.map(x => x.key)')
        r.klik('#workout .chk[data-j="0"][data-act="toggleSet"]')   # superseria: po pierwszym ćwiczeniu przerwy nie ma, dopiero po rundzie
        r.klik(f'#workout .chk[data-wk="{keys[1]}"][data-j="0"][data-act="toggleSet"]')
        page.wait_for_function('() => ACTIVE.timer')
        key_t = page.evaluate('() => { const T = ACTIVE.timer; return T.kind === "work" ? ACTIVE.ex[T.i].key : T.focus != null ? ACTIVE.ex[T.focus].key : null; }')
        def menu_move(klucz, d):
            # karta może być zwinięta, więc rozwijamy ją i menu przez stan interfejsu (przyciski wMove i tak klikamy naprawdę)
            page.evaluate("(k) => { ui.wOpen = ui.wOpen || {}; ui.wOpen[k] = true; ui.wMenu = k; renderWorkout(); }", klucz)
            r.klik(f'#workout [data-act="wMove"][data-wk="{klucz}"][data-dir="{d}"]')
        menu_move(keys[2], -1)
        assert page.evaluate('() => ACTIVE.ex.map(x => x.key)') == [keys[2], keys[0], keys[1]], 'trening: C przeskakuje całą parę'
        assert page.evaluate('() => ACTIVE.ex.map(x => !!x.ssNext)') == [False, True, False], 'trening: A+B nadal para, C bez połączenia'
        nowy = page.evaluate('() => { const T = ACTIVE.timer; return T.kind === "work" ? ACTIVE.ex[T.i].key : T.focus != null ? ACTIVE.ex[T.focus].key : null; }')
        assert nowy == key_t, 'timer zostaje przy swoim ćwiczeniu po przestawieniu'
        # członek pary w dół: cała superseria przechodzi pod C
        page.evaluate("(k) => { ui.wOpen = ui.wOpen || {}; ui.wOpen[k] = true; ui.wMenu = k; renderWorkout(); }", keys[1])
        assert page.locator(f'#workout [data-act="wMove"][data-wk="{keys[1]}"][data-dir="1"]').first.is_disabled(), 'trening: superseria na końcu listy, „Niżej” wyłączone także dla jej członka'
        menu_move(keys[0], -1)
        assert page.evaluate('() => ACTIVE.ex.map(x => x.key)') == [keys[0], keys[1], keys[2]] and page.evaluate('() => ACTIVE.ex.map(x => !!x.ssNext)') == [True, False, False], 'trening: para w górę jako całość'
        nowy = page.evaluate('() => { const T = ACTIVE.timer; return T.kind === "work" ? ACTIVE.ex[T.i].key : T.focus != null ? ACTIVE.ex[T.focus].key : null; }')
        assert nowy == key_t, 'timer zostaje przy swoim ćwiczeniu także po przesunięciu pary'
        page.evaluate("() => { ACTIVE = null; saveActive(); ui.showWorkout = false; render(); renderWorkout(); }")   # kolejne kroki zaczynają bez treningu w toku
    r.krok('trening: przestawianie nie łączy ćwiczeń, superseria idzie jako całość, timer zostaje przy swoim ćwiczeniu (E2-05)', b6_trening_przesuwanie, 'trening-e2-05')


    def kopia_przed_i_po():
        page.goto(BASE + '/', wait_until='load')
        page.evaluate('() => localStorage.clear()')
        stan = json.loads((REPO / 'testy' / 'zapis' / 'kopia_stan.json').read_text(encoding='utf-8'))
        przed = json.loads((REPO / 'testy' / 'zapis' / 'kopia_przed.json').read_text(encoding='utf-8'))
        page.evaluate('(fx) => { S = normalize(fx.state); SESS = sortSess(fx.sessions); render(); }', stan)
        r.klik('[data-act="openSettings"]')
        r.klik('[data-act="exportPrep"]')
        page.wait_for_function("document.querySelector('#exp') && document.querySelector('#exp').value.length > 10")
        po = json.loads(page.input_value('#exp')); po.pop('exported')
        assert json.dumps(po, sort_keys=True, ensure_ascii=False) == json.dumps(przed, sort_keys=True, ensure_ascii=False), 'eksport kopii różni się od eksportu z main'
        # import kopii z main do pustego stanu: ten sam stan i historia
        page.evaluate('() => { S = blankState(); SESS = []; }')   # arkusz Ustawień zostaje otwarty (ma pole „Przywróć z kopii”)
        page.fill('#imp', json.dumps({**przed, 'exported':'2026-11-14T00:00:00.000Z'}, ensure_ascii=False))
        r.klik('[data-act="importAsk"]')
        r.klik('[data-act="confirmOk"]')
        page.wait_for_function("SESS.length === 2")
        wynik = page.evaluate('() => ({plany:S.plans.map(p => p.id), custom:S.custom.map(c => c.id), ust:S.settings, sesje:SESS.map(s => s.id), tab:Array.isArray(S.plans), bezU:S.plans.every(p => !("u" in p))})')
        assert wynik['plany'] == [p['id'] for p in przed['state']['plans']] and wynik['custom'] == ['cx1'] and sorted(wynik['sesje']) == ['s1', 's2'], f'import kopii: {wynik}'
        assert wynik['ust'] == przed['state']['settings'] and wynik['tab'] and wynik['bezU'], f'import kopii (ustawienia/tablica): {wynik}'
    r.krok('kopia zapasowa: eksport i import jak przed zmianą (porównanie z main)', kopia_przed_i_po, 'kopia-po-imporcie')

    # ---- na koniec: krótkie odczekanie i jeszcze raz strażnicy (późny pageerror) ----
    def pozno():
        page.wait_for_timeout(1500)
    r.krok('koniec: odczekanie i ponowna kontrola strażników', pozno, 'koniec')


def uruchom_silnik(pw, silnik, args, strona_html):
    wyniki = []
    typ = getattr(pw, silnik)
    opcje = {}
    if silnik == 'chromium':
        chrome = args.chrome or os.environ.get('DZIENNIK_CHROME') or ('/usr/bin/google-chrome' if not os.environ.get('CI') and Path('/usr/bin/google-chrome').exists() else None)
        if chrome:
            opcje['executable_path'] = chrome
        opcje['args'] = ['--no-sandbox']
    try:
        browser = typ.launch(**opcje)
    except PWError as e:
        powod = str(e).splitlines()[0]
        if args.wymagaj_wszystkich or os.environ.get('CI'):
            return [(f'{silnik}', False, f'silnik nie uruchomiony: {powod}')]
        print(f'  {silnik}: POMINIĘTO (silnik niedostępny lokalnie: {powod})')
        return [(f'{silnik}', None, 'pominięto')]
    try:
        konfiguracje = [(urz, motyw, ctx_opcje, False) for urz, ctx_opcje in urzadzenia(pw).items() for motyw in MOTYWY]
        if silnik == 'chromium':   # jedna konfiguracja na prawdziwej stronie z web/ (a nie z wersji testowej)
            konfiguracje.append(('390x844 · web/', 'jasny', urzadzenia(pw)['390x844'], True))
        for urz, motyw, ctx_opcje, web in konfiguracje:
            schemat = MOTYWY[motyw]
            nazwa = f'{silnik} · {urz} · {motyw}'
            print(f'  [{nazwa}]')
            ctx = browser.new_context(color_scheme=schemat, locale='pl-PL', **ctx_opcje)
            page = ctx.new_page()
            katalog = Path(args.zrzuty) / f'{silnik}-{re.sub(r"[^0-9A-Za-z]+", "-", urz)}-{motyw}'
            r = Przebieg(page, nazwa, strona_html, katalog, schemat, web)
            t = time.time()
            try:
                scenariusz(r)
                if web:
                    print(f'    (web/: próby połączenia z Firebase odcięte: {len(r.firebase)})')
                wyniki.append((nazwa, True, f'{time.time() - t:.1f} s' + (f', znane błędy: {len(r.znane)}' if r.znane else '')))
            except Porazka as e:
                print('    BŁĄD ' + str(e))
                wyniki.append((nazwa, False, str(e)))
            finally:
                ctx.close()
    finally:
        browser.close()
    return wyniki


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--silniki', default='chromium,webkit')
    ap.add_argument('--zrzuty', default=str(KATALOG / 'zrzuty'))
    ap.add_argument('--chrome', default=None, help='ścieżka do Chrome (lokalnie /usr/bin/google-chrome)')
    ap.add_argument('--wymagaj-wszystkich', action='store_true', help='niedostępny silnik = błąd (w Actions, CI=true, jest to domyślne)')
    args = ap.parse_args()
    t0 = time.time()
    strona = zbuduj()
    wyniki = []
    with sync_playwright() as pw:
        for silnik in args.silniki.split(','):
            print(f'Silnik: {silnik}')
            wyniki += uruchom_silnik(pw, silnik.strip(), args, strona)
    print('\nPodsumowanie:')
    for nazwa, ok, opis in wyniki:
        print(f'  {"OK     " if ok else "POMINIĘTO" if ok is None else "BŁĄD   "} {nazwa}  {opis if ok is not True else opis}')
    zle = [w for w in wyniki if w[1] is False]
    if not any(w[1] for w in wyniki) and not zle:
        print('Żadna konfiguracja nie została uruchomiona (brak dostępnych silników).')
        sys.exit(1)
    print(f'Czas: {time.time() - t0:.0f} s, konfiguracji: {sum(1 for w in wyniki if w[1] is not None)}, błędnych: {len(zle)}')
    sys.exit(1 if zle else 0)


if __name__ == '__main__':
    main()
