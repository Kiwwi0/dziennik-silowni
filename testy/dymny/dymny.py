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

Nowy błąd = nowy krok w tym teście. Błąd samej aplikacji, którego nie naprawiamy od razu, wpisz do ZNANE_BLEDY
(krok, kod kontroli → numer i opis); taki krok kończy się „ZNANY BŁĄD” zamiast czerwonego wyniku.
"""
import argparse
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
                expect(page.locator('#workout .chk[data-act="toggleSet"][aria-pressed="true"]')).to_have_count(i + 1)
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
