#!/usr/bin/env python3
"""Test dymny aplikacji „Dziennik siłowni” (Playwright).

Uruchomienie z katalogu repozytorium:   python3 testy/dymny/dymny.py
Opcje:  --silniki chromium,webkit   --zrzuty KATALOG   --chrome ŚCIEŻKA   --wymagaj-wszystkich

Co robi: buduje wersję testową (`python3 -I zrodla/build.py` → zrodla/dist/index.html), podaje ją stronie przez page.route
(szkielet z regułą [hidden], jak w prawdziwej stronie), a potem w każdej konfiguracji (silnik × urządzenie × motyw)
przechodzi scenariusz: dane z planu fbw2, wszystkie zakładki, krótki trening od „Start” do zapisu, wpis w Diecie.
Po każdym kroku sprawdza: brak błędów strony (pageerror), brak przewijania w bok, brak „NaN” i „undefined” na ekranie,
brak prób połączenia z Firebase. Zrzuty ekranu idą do katalogu zrzuty/ (artefakt w Actions).

Nowy błąd = nowy krok w tym teście. Błąd samej aplikacji, którego nie naprawiamy od razu, wpisz do ZNANE_BLEDY
(krok, kod kontroli → numer i opis); taki krok kończy się „ZNANY BŁĄD” zamiast czerwonego wyniku.
"""
import argparse
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
