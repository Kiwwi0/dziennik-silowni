"""Buduje samodzielną wersję webową (bez claude.ai) do katalogu web/ w repozytorium.

Zapis danych: localStorage tej przeglądarki. Praca offline: service worker.
Instalacja na ekranie telefonu: manifest + ikony.

Użycie: python3 -I build_web.py <katalog repozytorium>
"""
import hashlib, json, os, shutil, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = sys.argv[1]
OUT = os.path.join(REPO, 'web')
os.makedirs(OUT, exist_ok=True)

tpl = open(os.path.join(HERE, 'src', 'app.html'), encoding='utf-8').read()

def foods_json(here):
    """Wczytuje content/produkty.csv i zwraca JSON (krótkie klucze) do wstawienia w stronę."""
    import csv
    rows = list(csv.DictReader(open(os.path.join(here, 'content', 'produkty.csv'), encoding='utf-8'), delimiter=';'))
    num = lambda s: float(s.replace(',', '.')) if s.strip() else 0.0
    out, seen = [], set()
    for r in rows:
        assert r['id'] not in seen, 'powtórzone id: ' + r['id']
        seen.add(r['id'])
        out.append({'id': r['id'], 'n': r['nazwa'], 'c': r['kategoria'], 'u': r['jednostka'], 'k': num(r['kcal']), 'b': num(r['bialko']),
                    'w': num(r['wegle']), 't': num(r['tluszcz']), 'f': num(r['blonnik']),
                    'pg': num(r['porcja_g']) if r['porcja_g'].strip() else None, 'po': r['porcja_opis'].strip()})
    return json.dumps(out, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')

def inject_anim(tpl):
    """Wkleja silnik animacji ćwiczeń (src/anim.js, src/anim_ex.js) i jego style (src/anim.css)."""
    src = os.path.join(HERE, 'src')
    css = open(os.path.join(src, 'anim.css'), encoding='utf-8').read()
    js = open(os.path.join(src, 'anim.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'anim_ex.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'muscles.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'anim_body.js'), encoding='utf-8').read()
    assert tpl.count('/*__ANIM_CSS__*/') == 1 and tpl.count('/*__ANIM_JS__*/') == 1
    return tpl.replace('/*__ANIM_CSS__*/', css).replace('/*__ANIM_JS__*/', js.replace('</script', '<\\/script'))
tpl = inject_anim(tpl)
# obracany manekin 3D: skrypt i model z numerem wersji w adresie (telefon nie użyje starej kopii)
shutil.copy(os.path.join(HERE, 'src', 'miesnie3d.js'), os.path.join(OUT, 'miesnie3d.js'))
_h = lambda f: hashlib.sha1(open(f, 'rb').read()).hexdigest()[:10]
_glb = os.path.join(OUT, 'models', 'miesnie.glb')
if os.path.exists(_glb):
    m3d = {'js': './miesnie3d.js?v=' + _h(os.path.join(OUT, 'miesnie3d.js')), 'glb': './models/miesnie.glb?v=' + _h(_glb)}
    assert tpl.count('/*__M3D__*/null') == 1
    tpl = tpl.replace('/*__M3D__*/null', json.dumps(m3d))
    print('3D:', m3d)
data = json.load(open(os.path.join(HERE, 'dist', 'exercises.json'), encoding='utf-8'))
js = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
tpl = tpl.replace('__EXERCISES_JSON__', js)
assert tpl.count('__FOODS_JSON__') == 1
tpl = tpl.replace('__FOODS_JSON__', foods_json(HERE))
cfg_path = os.path.join(REPO, 'firebase-config.json')
if os.path.exists(cfg_path):
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    assert tpl.count('/*__FIREBASE_CONFIG__*/null') == 1
    tpl = tpl.replace('/*__FIREBASE_CONFIG__*/null', json.dumps(cfg, separators=(',', ':')))
    print('Firebase:', cfg.get('projectId'))
else:
    print('Firebase: brak konfiguracji, tryb lokalny')

def rep(old, new):
    global tpl
    assert tpl.count(old) == 1, old[:60]
    tpl = tpl.replace(old, new)

# Teksty pasujące do wersji bez konta claude.ai
rep("'Plany i historia zapisują się tylko w tej przeglądarce. Zrób kopię zapasową poniżej.'",
    "'Plany i historia zapisują się w tej przeglądarce, na tym urządzeniu. Nie czyść danych witryny i co jakiś czas zrób kopię zapasową poniżej.'")
rep('<meta name="claude:viewport-fit-sides" content="cover">\n', '')

split = tpl.index('</style>') + len('</style>')
head_part, body_part = tpl[:split], tpl[split:]

# Zdjęcia ćwiczeń zastąpiły animacje SVG wbudowane w stronę, więc katalog img/ nie jest już potrzebny.
images = []
for old in ('img', 'proba-animacji.html'):
    pth = os.path.join(OUT, old)
    if os.path.isdir(pth): shutil.rmtree(pth)
    elif os.path.exists(pth): os.remove(pth)
version = hashlib.sha1((tpl + ''.join(images)).encode('utf-8')).hexdigest()[:10]

html = f'''<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Plan treningowy, baza ćwiczeń z opisem techniki, timer przerw i historia postępów.">
<meta name="theme-color" content="#E8EBEE" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F1214" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="Siłownia">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}}body{{margin:0;font:14px system-ui}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
{head_part}
</head>
<body>
{body_part}
<script>
if ('serviceWorker' in navigator) addEventListener('load', () => {{ navigator.serviceWorker.register('./sw.js').catch(() => {{}}); }});
try {{ navigator.storage && navigator.storage.persist && navigator.storage.persist(); }} catch (e) {{}}
</script>
</body>
</html>
'''
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(html)

manifest = {
    "name": "Dziennik siłowni",
    "short_name": "Siłownia",
    "description": "Plan treningowy, baza ćwiczeń z opisem techniki, timer przerw i historia postępów.",
    "lang": "pl",
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#E8EBEE",
    "theme_color": "#1D4ED8",
    "icons": [
        {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}
json.dump(manifest, open(os.path.join(OUT, 'manifest.webmanifest'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

src_icon = Image.open(os.path.join(REPO, 'DziennikSilowni', 'Assets.xcassets', 'AppIcon.appiconset', 'icon-1024.png')).convert('RGB')
for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
    src_icon.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)

core = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png']
sw = f'''// Pozwala korzystać z aplikacji bez internetu (np. na siłowni).
const VERSION = 'dziennik-{version}';
const CORE = {json.dumps(core)};
const IMAGES = {json.dumps(['./img/' + f for f in images])};

self.addEventListener('install', (event) => {{
  event.waitUntil((async () => {{
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    await Promise.allSettled(IMAGES.map((u) => cache.add(u)));
    await self.skipWaiting();
  }})());
}});

self.addEventListener('activate', (event) => {{
  event.waitUntil((async () => {{
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== 'fonts' && k !== 'libs').map((k) => caches.delete(k)));
    await self.clients.claim();
  }})());
}});

self.addEventListener('fetch', (event) => {{
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {{
    if (req.mode === 'navigate') {{
      // Najpierw sieć (żeby dostać nową wersję), bez sieci zapisana kopia.
      event.respondWith((async () => {{
        try {{
          const res = await fetch(req);
          if (res.ok && /\\/(index\\.html)?$/.test(url.pathname)) {{ const cache = await caches.open(VERSION); cache.put('./index.html', res.clone()); }}
          return res;
        }} catch (e) {{
          return (await caches.match('./index.html')) || Response.error();
        }}
      }})());
      return;
    }}
    event.respondWith((async () => {{
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) {{ const cache = await caches.open(VERSION); cache.put(req, res.clone()); }}
      return res;
    }})());
    return;
  }}
  if (url.hostname.endsWith('openfoodfacts.org')) return;   // odpowiedzi API nigdy nie trafiają do pamięci podręcznej
  if ((url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@zxing/library@'))) {{
    // Biblioteka bazy danych: wersja w adresie się nie zmienia, więc wystarczy pamięć podręczna.
    event.respondWith((async () => {{
      const cache = await caches.open('libs');
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    }})());
    return;
  }}
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {{
    event.respondWith((async () => {{
      const cache = await caches.open('fonts');
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {{ cache.put(req, res.clone()); return res; }}).catch(() => hit);
      return hit || net;
    }})());
  }}
}});
'''
open(os.path.join(OUT, 'sw.js'), 'w', encoding='utf-8').write(sw)
print('web/ ok, wersja', version, '| index.html', os.path.getsize(os.path.join(OUT, 'index.html')), 'B')
