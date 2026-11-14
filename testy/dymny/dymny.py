#!/usr/bin/env python3
"""Test dymny aplikacji „Dziennik siłowni” (Playwright).

Uruchomienie z katalogu repozytorium:   python3 testy/dymny/dymny.py
Opcje:  --silniki chromium,webkit   --zrzuty KATALOG   --chrome ŚCIEŻKA   --wymagaj-wszystkich

Co robi: buduje wersję testową (`python3 -I zrodla/build.py` → zrodla/dist/index.html), podaje ją stronie przez page.route
(szkielet z regułą [hidden], jak w prawdziwej stronie), a potem w każdej konfiguracji (silnik × urządzenie × motyw)
przechodzi scenariusz: dane z planu fbw2, wszystkie zakładki, krótki trening od „Start” do zapisu, wpis w Diecie.
Po każdym kroku sprawdza: brak błędów strony (pageerror), brak przewijania w bok, brak „NaN” i „undefined” na ekranie,
brak prób połączenia z Firebase. Zrzuty ekranu idą do katalogu zrzuty/ (artefakt w Actions).

Kroki „zapis: …” (A6) podstawiają sztuczny Firebase (zapis scalający, kolejka, nieudany zapis treningu, stara karta); krok „kopia zapasowa”
porównuje eksport i import z plikiem testy/zapis/kopia_przed.json (eksport wykonany kodem z `main` @ e82b8c6 na stanie z kopia_stan.json).

Nowy błąd = nowy krok w tym teście. Błąd samej aplikacji, którego nie naprawiamy od razu, wpisz do ZNANE_BLEDY
(krok, kod kontroli → numer i opis); taki krok kończy się „ZNANY BŁĄD” zamiast czerwonego wyniku.
"""
import argparse
import json
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
  const sv = window.__sv = {doc:null, sess:{}, st:[], se:[], fail:false, log:[]};
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
          if (opts && opts.mergeFields){ if (!sv.doc) sv.doc = {}; for (const f of opts.mergeFields){ let v = data; for (const q of f.split('.')) v = v == null ? undefined : v[q]; if (v === undefined) throw new Error('brak wartości dla ' + f); setPath(sv.doc, f.split('.'), v); } sv.log.push('merge:' + opts.mergeFields.length); }
          else { sv.doc = cl(data); sv.log.push('set'); }
        } else if (/\/sessions\/[^/]+$/.test(ref.path)) sv.sess[ref.path.split('/').pop()] = cl(data);
        res();
      } catch (e){ rej(e); }
    }, 5)),
    deleteDoc:ref => Promise.resolve().then(() => { if (/\/sessions\//.test(ref.path)) delete sv.sess[ref.path.split('/').pop()]; }),
    getDocs:async () => ({docs:[], empty:true}), getDoc:async () => ({exists:() => false}),
    runTransaction:(db, fn) => new Promise(async (res, rej) => {
      if (sv.fail) return rej(new Error('sztuczny brak sieci'));
      const pend = [], tx = {get:async () => snapOf(), set:(ref, data) => pend.push(data)};
      try { const r = await fn(tx); for (const d of pend) sv.doc = cl(d); if (pend.length) sv.log.push('tx'); res(r); } catch (e){ rej(e); }
    }),
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

    def __init__(self, page, nazwa, strona_html, dzien_zrzutow, motyw):
        self.page, self.nazwa, self.motyw = page, nazwa, motyw
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
        if url.rstrip('/') == BASE:
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
        if self.firebase:
            out.append(('firebase', 'próba połączenia z Firebase: ' + ', '.join(self.firebase[:3])))
        w = self.page.evaluate('''() => {
            const wid = (el) => el && !el.hidden && el.getClientRects().length > 0;
            const over = [];
            if (document.documentElement.scrollWidth > innerWidth) over.push('strona ' + document.documentElement.scrollWidth + ' > ' + innerWidth);
            for (const id of ['workout', 'sheet']) { const el = document.getElementById(id); if (wid(el) && el.scrollWidth > el.clientWidth) over.push('#' + id + ' ' + el.scrollWidth + ' > ' + el.clientWidth); }
            return {over, text: document.body.innerText};
        }''')
        if w['over']:
            out.append(('przewijanie', 'przewijanie w bok: ' + '; '.join(w['over'])))
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


def scenariusz(r):
    page = r.page
    ukryte = lambda sel: expect(page.locator(sel)).to_be_hidden()
    widoczne = lambda sel: expect(page.locator(sel).first).to_be_visible()
    zakladka = lambda id_: (r.klik(f'#tabbar a[href="#{id_}"]'), expect(page.locator(f'#tabbar a[href="#{id_}"]')).to_have_attribute('aria-current', 'page'))

    def start():
        page.goto(BASE + '/', wait_until='load')
        expect(page.locator('#tabbar a.tab')).to_have_count(5)
        expect(page.locator('#view')).to_contain_text('Zacznij od planu')
        ciemny = page.evaluate("matchMedia('(prefers-color-scheme: dark)').matches")
        assert ciemny == (r.motyw == 'dark'), f'motyw nie zastosowany (ciemny={ciemny})'
    r.krok('start strony', start, 'start')

    def dane():
        n = page.evaluate("() => { S.plans = templatePlans(TEMPLATES.find(t => t.id === 'fbw2')); render(); return S.plans.length; }")
        assert n == 2, f'plan fbw2 ma {n} dni zamiast 2'
        expect(page.locator('[data-act="startPlan"]')).to_have_count(2)
    r.krok('dane testowe (plan fbw2)', dane, 'trening-plany')

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

    def trening_start():
        zakladka('trening')
        r.klik('[data-act="startPlan"]')
        expect(page.locator('#workout')).to_be_visible()
        expect(page.locator('#workout .wex').first).to_be_visible()
    r.krok('trening: Start', trening_start, 'trening-start')

    def serie():
        for i in range(4):
            r.klik('#workout .chk[data-act="toggleSet"][aria-pressed="false"]')
            expect(page.locator('#workout .chk[data-act="toggleSet"][aria-pressed="true"]')).to_have_count(i + 1)
    r.krok('trening: odhaczenie 4 serii', serie, 'trening-serie')

    def zakoncz():
        r.klik('#workout [data-act="finishOpen"]')
        expect(page.locator('#sheet [data-act="finishSave"]')).to_be_enabled()
    r.krok('trening: Zakończ', zakoncz, 'trening-zakonczenie')

    def zapis():
        r.klik('#sheet [data-act="finishSave"]')
        page.wait_for_function('SESS.length === 1 && !ACTIVE')
        ukryte('#workout')
        widoczne('#sheet .tiles')
    r.krok('trening: zapis', zapis, 'trening-podsumowanie')

    def zamknij_podsumowanie():
        r.klik('#sheet [data-act="closeSheet"]')
        ukryte('#sheet-wrap')
        expect(page.locator('#view')).to_contain_text('Ostatnio')
    r.krok('trening: powrót na ekran główny', zamknij_podsumowanie, 'trening-po-zapisie')

    def historia():
        zakladka('historia')
        expect(page.locator('.sess')).to_have_count(1)
        expect(page.locator('.sess').first).to_contain_text('FBW A')
    r.krok('Historia: Treningi (trening widoczny)', historia, 'historia-treningi')

    def sesja():
        r.klik('.sess')
        widoczne('#sheet .tiles')
        expect(page.locator('#sheet')).to_contain_text('FBW A')
    r.krok('Historia: szczegóły treningu', sesja, 'historia-trening')

    def zamknij():
        r.klik('#sheet [data-act="closeSheet"]')
        ukryte('#sheet-wrap')
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
        expect(page.locator('.dt-sum')).to_contain_text('350')
    r.krok('Dieta: szybki wpis', dieta_wpis, 'dieta-po-wpisie')

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
          out.mig = {v:sv.doc.v, full:!!sv.doc.full, p1:sv.doc.pm.P1.name, u2:sv.doc.pm.P2.u, po:sv.doc.po, mirror:sv.doc.plans.map(p => p.name), lay:zLay, tablica:Array.isArray(S.plans), bezU:S.plans.every(p => !('u' in p))};
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
          sv.fail = false; clearTimeout(zRetryT); zBusy = false;
          openFolder(FOLDER); sv.emit(); await sleep(500); sv.emit(); await sleep(60);
          out.poOtwarciu = {serwer:sv.doc.pm.P2.name, lokalnie:S.plans.find(p => p.id === 'P2').name};
          return out;
        }""")
        assert w['start'] == ['Plan A', 'Plan B'], f"stan startowy: {w['start']}"
        m = w['mig']
        assert m['v'] == 3 and m['full'] and m['p1'] == 'Telefon A' and m['u2'] == 0 and m['po'] == ['P1', 'P2'], f'migracja do v3: {m}'
        assert m['mirror'] == ['Telefon A', 'Plan B'] and m['lay'] == 'v3', f'lustro starego układu / układ: {m}'
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
    r.krok('zapis: scalanie planów, kolejka, nieudany zapis treningu, stara karta (sztuczny Firebase)', zapis_scalanie)

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
        for urz, ctx_opcje in urzadzenia(pw).items():
            for motyw, schemat in MOTYWY.items():
                nazwa = f'{silnik} · {urz} · {motyw}'
                print(f'  [{nazwa}]')
                ctx = browser.new_context(color_scheme=schemat, locale='pl-PL', **ctx_opcje)
                page = ctx.new_page()
                katalog = Path(args.zrzuty) / f'{silnik}-{urz.replace(" ", "-")}-{motyw}'
                r = Przebieg(page, nazwa, strona_html, katalog, schemat)
                t = time.time()
                try:
                    scenariusz(r)
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
