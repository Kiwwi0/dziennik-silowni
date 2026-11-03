"""Strona z próbką animacji 3D (jedno ćwiczenie): web/proba-3d.html.
Użycie: python3 -I build_demo3d.py <katalog repozytorium> [id ćwiczenia]"""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = sys.argv[1]; EX_ID = sys.argv[2] if len(sys.argv) > 2 else 'Barbell_Squat'
src = lambda f: open(os.path.join(HERE, 'src', f), encoding='utf-8').read()
ex = {e['id']: e for e in json.load(open(os.path.join(HERE, 'dist', 'exercises.json'), encoding='utf-8'))}[EX_ID]
import shutil
for f in ('anim3d.js', 'anim3d_human.js'): shutil.copy(os.path.join(HERE, 'src', f), os.path.join(REPO, 'web', f))
info = json.dumps({'id': ex['id'], 'name': ex['name'], 'primary': ex['primary'], 'secondary': ex['secondary'], 'steps': ex['steps'], 'tips': ex['tips']}, ensure_ascii=False)
html = f'''<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Próbka 3D</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=Big+Shoulders+Display:wght@700;800&display=swap">
<style>
:root{{--bg:#E8EBEE;--surface:#FFFFFF;--surface-2:#F2F4F6;--ink:#13171B;--ink-2:#434C55;--muted:#646D76;--line:#D2D7DC;--accent:#1D4ED8;--hl:#D7263D;--hl2:#F0A0AA;
  --f-display:"Big Shoulders Display","Arial Narrow",sans-serif;--f-body:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light}}
@media (prefers-color-scheme: dark){{:root{{--bg:#0F1214;--surface:#171B1F;--surface-2:#1F2429;--ink:#ECEFF2;--ink-2:#BCC4CB;--muted:#8C969F;--line:#2B3238;--accent:#7D9DFF;--hl:#FF4D62;--hl2:#F0A0AA;color-scheme:dark}}}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 var(--f-body);padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}}
.wrap{{max-width:720px;margin:0 auto;padding:18px max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px));display:grid;gap:14px}}
.brand{{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}}
h1{{font-family:var(--f-display);font-weight:800;font-size:34px;line-height:.95;text-transform:uppercase;margin:2px 0 0}}
.card{{background:var(--surface);border:1px solid var(--line);border-radius:14px;overflow:hidden}}
.stage{{position:relative;aspect-ratio:4/3;background:var(--surface-2)}}
.stage .hint{{position:absolute;left:12px;top:10px;max-width:60%;font-size:12px;line-height:1.35;color:var(--muted);pointer-events:none}}
.stage .reset{{position:absolute;right:8px;top:8px}}
.stage .load{{position:absolute;inset:0;display:grid;place-items:center;color:var(--muted);font-size:14px;pointer-events:none}}
.ctl{{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 12px 4px}}
button{{min-height:40px;min-width:40px;padding:0 14px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 14px var(--f-body)}}
button[aria-pressed="true"]{{background:var(--ink);color:var(--bg);border-color:var(--ink)}}
input[type=range]{{width:100%;accent-color:var(--accent)}}
.ph{{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:var(--muted);padding:0 14px 8px;font-variant-numeric:tabular-nums}}
.ph b{{color:var(--ink);font-weight:600}}
.legend{{display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink-2);padding:0 14px 14px}}
.legend i{{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}}
.lead{{margin:0;color:var(--ink-2)}}
ol{{margin:0;padding-left:20px;display:grid;gap:6px;color:var(--ink-2)}}
h2{{font-family:var(--f-display);font-weight:800;font-size:22px;text-transform:uppercase;margin:6px 0 0}}
a{{color:var(--accent)}}
.err{{padding:24px;color:var(--muted)}}
</style>
</head>
<body>
<div class="wrap">
  <div><span class="brand">Dziennik siłowni · próbka 3D</span><h1 id="name"></h1></div>
  <div class="card">
    <div class="stage" id="stage"><span class="load" id="load">Wczytuję postać…</span><span class="hint">Przeciągnij palcem, aby obrócić.<br>Dwa palce: przybliżenie.</span><button class="reset" id="reset" aria-label="Widok startowy">Widok</button></div>
    <div class="ctl"><button id="play" aria-label="Zatrzymaj">❚❚</button><input id="seek" type="range" min="0" max="1000" value="0" aria-label="Moment ruchu"><button id="slow" aria-pressed="false">Wolniej</button></div>
    <div class="ph"><span>Faza: <b id="lbl"></b></span><span id="pct"></span></div>
    <div class="legend"><span><i style="background:var(--hl)"></i>mięśnie główne</span><span><i style="background:var(--hl2)"></i>mięśnie pomocnicze</span><span style="color:var(--muted)">przerywana linia: tor sztangi</span></div>
  </div>
  <h2>Technika</h2><ol id="steps"></ol>
  <p class="lead" style="font-size:13px;color:var(--muted)">Postać 3D: Microsoft Rocketbox (licencja MIT).</p>
  <p class="lead">To próbka jednego ćwiczenia. Napisz, czy taki wygląd Ci odpowiada, a przerobię w ten sposób wszystkie. Wróć do <a href="./">Dziennika siłowni</a>.</p>
</div>
<script>{src('anim.js')}</script>
<script>{src('anim_ex.js')}</script>
<script type="module">
import {{mount}} from './anim3d.js';
const EX = {info};
document.getElementById('name').textContent = EX.name;
document.getElementById('steps').innerHTML = EX.steps.map(s => '<li>' + s.replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;') + '</li>').join('');
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const $ = id => document.getElementById(id);
let v;
try {{
  v = mount($('stage'), EX.id, {{primary:EX.primary, secondary:EX.secondary, floor:dark ? 0x2A3037 : 0xE6E9EC, trail:dark ? 0x7D9DFF : 0x1D4ED8, model:'models/postac-szara.glb',
    onReady:() => $('load').remove(), onError:() => {{ $('load').textContent = 'Nie udało się wczytać postaci.'; }},
    paused:matchMedia('(prefers-reduced-motion: reduce)').matches,
    onFrame:(inf, u) => {{ $('lbl').textContent = inf.label; $('pct').textContent = inf.pct + '% zakresu ruchu'; if (document.activeElement !== $('seek')) $('seek').value = Math.round(u * 1000); }}}});
}} catch (e) {{ $('stage').innerHTML = '<p class="err">Ta przeglądarka nie obsługuje grafiki 3D (WebGL).</p>'; console.error(e); }}
const setPlay = on => {{ on ? v.play() : v.pause(); $('play').textContent = on ? '❚❚' : '▶'; $('play').setAttribute('aria-label', on ? 'Zatrzymaj' : 'Odtwórz'); }};
if (v){{
  if (!v.playing) setPlay(false);
  $('play').onclick = () => setPlay(!v.playing);
  $('seek').oninput = e => {{ setPlay(false); v.setU(e.target.value / 1000); }};
  $('slow').onclick = e => {{ const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', on); v.setSlow(on); }};
  $('reset').onclick = () => v.resetView();
}}
</script>
</body>
</html>
'''
out = os.path.join(REPO, 'web', 'proba-3d.html')
open(out, 'w', encoding='utf-8').write(html)
print('ok', out, os.path.getsize(out), 'B')
