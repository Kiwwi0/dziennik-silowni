#!/usr/bin/env python3
"""Test startu strony bez sieci (zlecenie A7a): prawdziwy service worker, prawdziwy SDK Firebase 10.14.1 (zbudowany z npm pod adresem udającym gstatic),
sztuczne tylko odpowiedzi Google (logowanie anonimowe, token App Check, skrypt reCAPTCHA). Baza Firestore jest nieosiągalna (jak offline).

Przebieg: wejście online (service worker zapisuje stronę i moduły), zasianie konta w localStorage, kolejne wejścia, potem "siec znika" (serwery stają,
trasy Google przerywają) i sprawdzamy: (a) odświeżenie, (b) nowa karta – dane widoczne; (c) Firebase startuje (FB.db) i logowanie się rozwiązuje, bez błędu połączenia;
(d) zmiana planu i trening zapisują się lokalnie (stan, kolejka, lista niewysłanych). Scenariusz "recaptcha-zablokowana" sprawdza to samo przy działającym internecie,
ale bez dostępu do skryptu reCAPTCHA (bloker reklam, filtr). Bez poprawki A7a (skrypt reCAPTCHA sprawdzany przed uruchomieniem App Check) kroki (c) są czerwone.

Uwaga o WebKit: trasy Playwrighta nie obejmują tam żądań, które strona pod service workerem wysyła do sieci przez niego (a runner Actions ma internet), więc w WebKit
prawdziwe usługi Google (reCAPTCHA, logowanie) mogą odpowiadać także "offline", sztuczne logowanie nie zapisuje użytkownika (stąd brak asercji uid) a limity czasu są luźniejsze.
Czerwień na wdrożonej wersji 6c44bba widać mimo to także w WebKit (Firebase nie wstaje wcale); sama bramka na limity czasu tokenu: APPCHK_TOKEN_MS = 4 s.

Użycie: python3 testy/offline/offline.py [--silniki chromium,webkit] [--web web] [--sdk KATALOG] [--scenariusze a,b]"""
import argparse, base64, functools, http.server, json, os, re, shutil, socketserver, subprocess, sys, tempfile, threading, time
from playwright.sync_api import sync_playwright

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
WEBPORT, CDNPORT = 8611, 8612
CDN_URL = f'http://127.0.0.1:{CDNPORT}/firebasejs/10.14.1/'


class Cichy(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*'); self.send_header('Cache-Control', 'no-cache'); super().end_headers()


class Serwer:
    def __init__(self, katalog, port):
        socketserver.ThreadingTCPServer.allow_reuse_address = True
        self.s = socketserver.ThreadingTCPServer(('127.0.0.1', port), functools.partial(Cichy, directory=katalog)); self.s.daemon_threads = True
        self.stop_ = False; threading.Thread(target=self.s.serve_forever, daemon=True).start()
    def stop(self):
        if not self.stop_: self.stop_ = True; self.s.shutdown(); self.s.server_close()


def przygotuj_sdk(katalog):
    if os.path.exists(os.path.join(katalog, 'cdn', 'firebasejs', '10.14.1', 'firebase-app-check.js')): return
    os.makedirs(katalog, exist_ok=True)
    if not os.path.exists(os.path.join(katalog, 'package.json')): open(os.path.join(katalog, 'package.json'), 'w').write('{"name":"dziennik-offline-sdk","private":true}')
    subprocess.run(['npm', 'install', '--no-audit', '--no-fund', '--no-save', 'firebase@10.14.1', 'esbuild@0.24.0'], cwd=katalog, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'bundle_sdk.mjs'), katalog, CDN_URL], check=True)


def kopia_strony(web, cel):
    shutil.rmtree(cel, ignore_errors=True); shutil.copytree(web, cel)
    p = os.path.join(cel, 'index.html'); t = open(p, encoding='utf-8').read()
    assert 'https://www.gstatic.com/firebasejs/' in t, 'index.html bez adresu Firebase (zła strona w teście?)'
    open(p, 'w', encoding='utf-8').write(t.replace('https://www.gstatic.com/firebasejs/', f'http://127.0.0.1:{CDNPORT}/firebasejs/'))
    p = os.path.join(cel, 'sw.js'); t = open(p, encoding='utf-8').read()
    stary = "url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')"
    assert stary in t, 'sw.js bez reguły pamięci bibliotek Firebase'
    open(p, 'w', encoding='utf-8').write(t.replace(stary, "url.hostname === '127.0.0.1' && url.pathname.startsWith('/firebasejs/')"))


def b64(o): return base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
def fake_jwt():
    n = int(time.time())
    return b64({'alg': 'RS256', 'typ': 'JWT'}) + '.' + b64({'iss': 'https://securetoken.google.com/dziennik-silowni', 'aud': 'dziennik-silowni', 'auth_time': n, 'user_id': 'uid1', 'sub': 'uid1', 'iat': n, 'exp': n + 3600, 'firebase': {'identities': {}, 'sign_in_provider': 'anonymous'}}) + '.sig'


def trasy(ctx, st):
    cors = {'access-control-allow-origin': '*'}
    def h(route):
        u = route.request.url
        if route.request.method == 'OPTIONS' and not st['offline'] and not (st['bez_recaptcha'] and 'recaptcha' in u):   # zapytanie wstępne CORS (WebKit nie odpowiada na nie sam)
            return route.fulfill(status=204, headers={**cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-max-age': '600'})
        if st['offline'] and st['skrypt_z_cache'] and 'recaptcha/enterprise.js' in u: pass   # skrypt jak z pamięci przeglądarki: ładuje się mimo braku sieci
        elif st['offline'] or (st['bez_recaptcha'] and 'recaptcha' in u): return route.abort()
        if 'recaptcha/enterprise.js' in u:
            # execute() jak prawdziwy reCAPTCHA: potrzebuje ramki (anchor); gdy sieci nie ma, nigdy się nie kończy (ani nie zgłasza błędu)
            return route.fulfill(content_type='text/javascript', body="window.grecaptcha=window.grecaptcha||{};grecaptcha.enterprise={render:function(){return 'w1'},ready:function(cb){cb()},execute:function(){return fetch('https://www.google.com/recaptcha/enterprise/anchor').then(function(){return 'fake-recaptcha'},function(){return new Promise(function(){})})}};")
        if 'recaptcha/enterprise/anchor' in u:
            return route.fulfill(content_type='text/html', headers=cors, body='ok')
        if 'firebaseappcheck.googleapis.com' in u:
            return route.fulfill(content_type='application/json', headers=cors, body=json.dumps({'token': 'fake.appcheck.token', 'ttl': '3600s'}))
        if 'accounts:signUp' in u:
            return route.fulfill(content_type='application/json', headers=cors, body=json.dumps({'idToken': fake_jwt(), 'refreshToken': 'rt', 'expiresIn': '3600', 'localId': 'uid1'}))
        if 'accounts:lookup' in u:
            return route.fulfill(content_type='application/json', headers=cors, body=json.dumps({'users': [{'localId': 'uid1', 'providerUserInfo': [], 'lastLoginAt': '1', 'createdAt': '1'}]}))
        route.abort()   # baza Firestore i reszta: nieosiągalne
    # hermetycznie: wszystko spoza localhost/127.0.0.1 (też apis.google.com, iframe logowania z firebaseapp.com, czcionki) jest atrapą albo przerwane,
    # niezależnie od tego, czy runner ma internet (w Actions ma, w piaskownicy nie)
    ctx.route(lambda u: not re.match(r'^https?://(localhost|127\.0\.0\.1)[:/]', u), h)


ZASIEW = """() => {
  const plans = templatePlans(TEMPLATES.find(t => t.id === 'fbw2')); plans[0].name = 'PLAN-TESTOWY-XYZ';
  LS.set('dz.folder', {id:'f1', name:'Olek'}); LS.set('dz.acc.f1', true);
  LS.set('dz.f.f1.state', {plans, custom:[], settings:{}});
  LS.set('dz.f.f1.sessions', [{id:'s1', date:new Date().toISOString(), dur:3000, planId:null, planName:'TRENING-ZAPISANY-XYZ', dayId:null, dayName:'Dzien', ex:[]}]);
  return true; }"""
SONDA = """async () => {
  const r = {fireError: store.fireError, db: !!FB.db, uid: FB.uid || null, folder: !!FOLDER};
  location.hash = '#history'; render(); await new Promise(x => setTimeout(x, 300)); r.historia = document.body.innerText.includes('TRENING-ZAPISANY-XYZ');
  S.plans[0].name = 'ZMIENIONY-OFFLINE'; commit(); await new Promise(x => setTimeout(x, 800));
  const q = localStorage.getItem('dz.f.f1.zq') || ''; let qq = {}; try { qq = JSON.parse(q); } catch {}
  r.kolejka = Object.keys(((qq || {}).q || {}).p || {}).length > 0; r.stan = (localStorage.getItem('dz.f.f1.state') || '').includes('ZMIENIONY-OFFLINE');
  await saveSession({id:'s2', date:new Date().toISOString(), dur:60, planId:null, planName:'TRENING-OFFLINE-2', dayId:null, dayName:'D', ex:[]});
  r.trening = (localStorage.getItem('dz.f.f1.sessions') || '').includes('TRENING-OFFLINE-2'); r.niewyslany = (localStorage.getItem('dz.f.f1.unsent') || '').includes('s2');
  return r; }"""


def widac(page, tekst='PLAN-TESTOWY-XYZ', ms=8000):
    t0 = time.time(); last = ''
    while time.time() - t0 < ms / 1000:
        try: last = page.inner_text('body')
        except Exception: last = ''
        if tekst in last: return True, last
        time.sleep(.3)
    return False, last


def czekaj_db(page, ms):
    t0 = time.time()
    while time.time() - t0 < ms / 1000:
        try:
            if page.evaluate('!!FB.db'): return round(time.time() - t0, 1)
        except Exception: pass
        time.sleep(.25)
    return None


SCENARIUSZE = {
    'normalny': dict(wejsc=3, bez_recaptcha=False, usun_z_libs=None, offline=True),
    'jedno-wejscie': dict(wejsc=1, bez_recaptcha=False, usun_z_libs=None, offline=True),
    'brak-app-check-w-libs': dict(wejsc=3, bez_recaptcha=False, usun_z_libs='firebase-app-check.js', offline=True),
    'tryb-samolotowy (navigator.onLine = false)': dict(wejsc=3, bez_recaptcha=False, usun_z_libs=None, offline=True, samolot=True, skrypt_z_cache=True, tylko_chromium=True),
    'skrypt-reCAPTCHA-z-pamieci, ramka niedostępna (Wi-Fi bez internetu)': dict(wejsc=3, bez_recaptcha=False, usun_z_libs=None, offline=True, skrypt_z_cache=True, limit_db=9),
    'recaptcha-zablokowana': dict(wejsc=2, bez_recaptcha=True, usun_z_libs=None, offline=False),
    'libs-puste (znane ograniczenie: Firebase nie wstaje, dane lokalne działają)': dict(wejsc=3, bez_recaptcha=False, usun_z_libs='*', offline=True, tylko_dane=True),
}


def scenariusz(silnik, nazwa, cfg, web, sdk, bledy):
    stan = {'dbg': None, 'page': None}
    def sprawdz(warunek, opis):
        print(('    ok     ' if warunek else '    BŁĄD   ') + opis, flush=True)
        if not warunek:
            bledy.append(f'{silnik} / {nazwa}: {opis}')
            if stan.get('snap') is None and stan['page']:
                try: stan['snap'] = stan['page']()
                except Exception as e: stan['snap'] = 'niedostępny: ' + str(e)[:60]
    kopia = tempfile.mkdtemp(prefix='dz-offline-'); kopia_strony(web, kopia)
    www, cdn = Serwer(kopia, WEBPORT), Serwer(os.path.join(sdk, 'cdn'), CDNPORT); st = dict(offline=False, bez_recaptcha=cfg['bez_recaptcha'], skrypt_z_cache=cfg.get('skrypt_z_cache', False))
    try:
        with sync_playwright() as p:
            opcje = {}
            if silnik == 'chromium' and os.path.exists('/usr/bin/google-chrome') and not os.environ.get('PLAYWRIGHT_BUNDLED'): opcje['executable_path'] = '/usr/bin/google-chrome'
            b = getattr(p, silnik).launch(**opcje); ctx = b.new_context(); trasy(ctx, st); page = ctx.new_page(); bl = []
            page.on('pageerror', lambda e: bl.append(str(e)[:120]))
            dbg = []; page.on('console', lambda m: dbg.append(f'konsola {m.type}: {m.text[:160]}')); ctx.on('requestfailed', lambda r: dbg.append(f'żądanie nieudane: {r.method} {r.url[:110]} {r.failure}'))
            url = f'http://localhost:{WEBPORT}/'
            stan['dbg'] = dbg; stan['page'] = lambda: page.evaluate("({db: !!FB.db, uid: FB.uid || null, fireError: store.fireError, appCheck: APPCHK.on, ladowanie: APPCHK.loading, grecaptcha: !!(self.grecaptcha && self.grecaptcha.enterprise)})")
            page.goto(url); page.wait_for_timeout(2500); page.evaluate('navigator.serviceWorker.ready.then(() => 1)'); page.wait_for_timeout(1000)
            page.evaluate(ZASIEW)
            for _ in range(cfg['wejsc']): page.goto(url); page.wait_for_timeout(2500)
            if cfg['usun_z_libs'] == '*': page.evaluate("caches.delete('libs')")
            elif cfg['usun_z_libs']: page.evaluate("caches.open('libs').then(c => c.delete(%s))" % json.dumps(CDN_URL + cfg['usun_z_libs']))
            if not cfg['offline']:
                sprawdz(widac(page)[0], 'online, reCAPTCHA niedostępna: dane widoczne')
                lim = 4 if silnik == 'chromium' else 12; t = czekaj_db(page, (lim + 3) * 1000); sprawdz(t is not None and t <= lim, f'online, reCAPTCHA niedostępna: Firebase wstaje w ≤ {lim} s (po {t} s)')
                if silnik == 'chromium':
                    uid = page.evaluate('FB.uid || null'); sprawdz(uid == 'uid1', f'online, reCAPTCHA niedostępna: logowanie anonimowe działa (uid={uid})')
                sprawdz(not page.evaluate('store.fireError'), 'online, reCAPTCHA niedostępna: bez błędu połączenia z bazą')
                b.close(); return
            st['offline'] = True; www.stop(); cdn.stop(); time.sleep(.5); bl.clear()
            if cfg.get('samolot'): ctx.set_offline(True)   # tryb samolotowy: navigator.onLine = false
            page.reload(wait_until='load', timeout=20000)
            sprawdz(widac(page)[0], '(a) odświeżenie bez sieci: dane widoczne')
            p2 = ctx.new_page(); p2.goto(url, wait_until='load', timeout=20000)
            sprawdz(widac(p2)[0], '(b) nowa karta bez sieci: dane widoczne'); p2.close()
            if not cfg.get('tylko_dane'):
                lim = cfg.get('limit_db', 4) + (5 if silnik == 'webkit' else 0); t = czekaj_db(page, (lim + 3) * 1000); sprawdz(t is not None and t <= lim, f'(c) bez sieci Firebase wstaje w ≤ {lim} s (po {t} s)')
                if silnik == 'chromium': sprawdz(page.evaluate('FB.uid || null') == 'uid1', '(c) bez sieci logowanie anonimowe się rozwiązuje (zapamiętany użytkownik)')   # WebKit: patrz uwaga w nagłówku
            r = page.evaluate(SONDA)
            if not cfg.get('tylko_dane'): sprawdz(not r['fireError'], '(c) bez błędu połączenia z bazą')
            sprawdz(r['historia'], '(c) zapisany trening widoczny w historii'); sprawdz(r['stan'] and r['kolejka'], '(d) zmiana planu: stan i kolejka w localStorage')
            sprawdz(r['trening'] and r['niewyslany'], '(d) trening: zapisany lokalnie i na liście niewysłanych')
            if not cfg['usun_z_libs']: sprawdz(not bl, 'brak błędów skryptu strony' + (f' ({bl[:2]})' if bl else ''))   # moduł usunięty celowo: WebKit zgłasza nieudany import() jako błąd strony ("Load failed"), choć aplikacja go łapie
            b.close()
    finally:
        www.stop(); cdn.stop(); shutil.rmtree(kopia, ignore_errors=True)
        if any(x.startswith(f'{silnik} / {nazwa}') for x in bledy) and stan['dbg'] is not None:
            print('    --- diagnostyka (ostatnie zdarzenia) ---')
            for l in stan['dbg'][-14:]: print('      ' + l)
            print('      stan strony przy pierwszym błędzie:', stan.get('snap'))


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--silniki', default='chromium'); ap.add_argument('--web', default=os.path.join(REPO, 'web'))
    ap.add_argument('--sdk', default=os.path.join(tempfile.gettempdir(), 'dziennik-offline-sdk')); ap.add_argument('--scenariusze', default='')
    a = ap.parse_args(); przygotuj_sdk(a.sdk); bledy = []
    wybrane = [s for s in SCENARIUSZE if not a.scenariusze or any(x in s for x in a.scenariusze.split(','))]
    for silnik in a.silniki.split(','):
        for nazwa in wybrane:
            if silnik != 'chromium' and SCENARIUSZE[nazwa].get('tylko_chromium'): print(f'[{silnik}] {nazwa}: pominięty (context.set_offline w WebKit kończy się błędem wewnętrznym przy odświeżeniu strony z service workera)'); continue
            print(f'[{silnik}] {nazwa}', flush=True)
            try: scenariusz(silnik, nazwa, SCENARIUSZE[nazwa], a.web, a.sdk, bledy)
            except Exception as e: bledy.append(f'{silnik} / {nazwa}: wyjątek testu: {str(e)[:200]}'); print('    BŁĄD   wyjątek testu:', str(e)[:200], flush=True)
    print('\nPodsumowanie: ' + ('wszystko zielone' if not bledy else f'{len(bledy)} błędów'))
    for b in bledy: print('  -', b)
    sys.exit(1 if bledy else 0)


if __name__ == '__main__':
    main()
