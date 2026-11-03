"""Próbka szczegółowej mapy mięśni (styl Grafit) → web/proba-miesnie.html."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/dziennik-silowni', 'web', 'proba-miesnie.html')
src = os.path.join(HERE, 'src')
js = open(os.path.join(src, 'muscles.js'), encoding='utf-8').read() + '\n' + open(os.path.join(src, 'anim_body.js'), encoding='utf-8').read()
L = json.load(open(os.path.join(HERE, 'dist', 'exercises.json'), encoding='utf-8'))
NAME = {e['id']: e['name'] for e in L}
IDS = ['Standing_Military_Press', 'Side_Lateral_Raise', 'Reverse_Flyes', 'Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Incline_Bench_Press_-_Medium_Grip',
       'Triceps_Pushdown', 'Cable_Rope_Overhead_Triceps_Extension', 'Barbell_Curl', 'Hammer_Curls', 'Pullups', 'Bent_Over_Barbell_Row', 'Face_Pull',
       'Barbell_Shrug', 'Barbell_Squat', 'Romanian_Deadlift', 'Barbell_Hip_Thrust', 'Thigh_Abductor', 'Seated_Calf_Raise', 'Standing_Calf_Raises', 'Russian_Twist']
EXS = [[i, NAME[i]] for i in IDS]
html = '''<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Mapa mięśni – próbka</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&family=Big+Shoulders+Display:wght@700;800&display=swap">
<style>
:root{--bg:#E8EBEE;--surface:#FFFFFF;--surface-2:#F2F4F6;--ink:#13171B;--ink-2:#434C55;--muted:#646D76;--line:#D2D7DC;--accent:#1D4ED8;
  --hl:#E11D2E;--hl2:#F49AA0;--bm-muscle:#3E444B;--bm-skin:#B9C0C7;
  --f-display:"Big Shoulders Display","Arial Narrow",sans-serif;--f-body:"Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0F1214;--surface:#171B1F;--surface-2:#1F2429;--ink:#ECEFF2;--ink-2:#BCC4CB;--muted:#8C969F;--line:#2B3238;--accent:#7D9DFF;
  --hl:#EF2B3C;--hl2:#F49AA0;--bm-muscle:#5A626B;--bm-skin:#7C858E;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 var(--f-body);padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
.wrap{max-width:760px;margin:0 auto;padding:18px max(16px,env(safe-area-inset-right,0px)) 40px max(16px,env(safe-area-inset-left,0px));display:grid;gap:16px}
.brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font-family:var(--f-display);font-weight:800;font-size:34px;line-height:.95;text-transform:uppercase;margin:2px 0 0}
h2{font-family:var(--f-display);font-weight:800;font-size:24px;line-height:1;text-transform:uppercase;margin:0}
.lead{margin:0;color:var(--ink-2)}
.tabs{display:flex;gap:6px;flex-wrap:wrap}
.tabs button{min-height:38px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink);font:600 13.5px var(--f-body);cursor:pointer}
.tabs button[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.bodymap{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 8px 10px;display:grid;gap:10px;margin:0}
.bm-figs{display:grid;grid-template-columns:1fr 1fr;gap:6px;max-width:440px;margin:0 auto;width:100%}
.bm-fig{display:grid;gap:2px;justify-items:center}
.bm-fig svg{display:block;width:100%;height:auto}
.bm-cap{font:700 10.5px var(--f-body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}
.bodymap .ol{fill:var(--surface);stroke:var(--line);stroke-width:2;vector-effect:non-scaling-stroke}
.bodymap .k{fill:var(--bm-skin)} .bodymap .m{fill:var(--bm-muscle)}
.bodymap .m.p1{fill:var(--hl)} .bodymap .m.p2{fill:var(--hl2)}
.bodymap .sp{stroke:var(--surface);stroke-width:6}
.muscles{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;font-size:14px;margin:0;padding:0 8px}
.muscles dt{color:var(--muted)} .muscles dd{margin:0;font-weight:600}
.legend{display:flex;gap:14px;justify-content:center;font-size:12.5px;color:var(--ink-2)}
.legend i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:6px;vertical-align:-1px}
a{color:var(--accent)}
.note{font-size:12px;color:var(--muted);margin:0}
</style>
</head>
<body>
<div class="wrap">
  <div><span class="brand">Dziennik siłowni · próbka</span><h1>Szczegółowa mapa mięśni</h1></div>
  <p class="lead">Styl Grafit, ale każdy mięsień osobno: 3 aktony barku, 2 części klatki, 3 głowy tricepsa, 3 mięśnie przodu uda, 3 części kapturów, pośladek wielki i średni, brzuchaty i płaszczkowaty. Wybierz ćwiczenie.</p>
  <div class="tabs" id="tabs"></div>
  <h2 id="t"></h2>
  <div id="out"></div>
  <p class="note">Kształty sylwetki: react-native-body-highlighter (licencja MIT).</p>
  <p class="lead">To próbka. Wróć do <a href="./">Dziennika siłowni</a>.</p>
</div>
<script>
'use strict';
/*__JS__*/
const EXS = /*__EXS__*/null;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function show(i){
  const [id, name] = EXS[i], m = MUSCLE_EX[id];
  document.getElementById('t').textContent = name;
  document.getElementById('out').innerHTML = `<figure class="bodymap">${bodyMapFigs(m)}
    <figcaption class="legend"><span><i style="background:var(--hl)"></i>główne</span>${m.s.length ? '<span><i style="background:var(--hl2)"></i>pomocnicze</span>' : ''}</figcaption>
    <dl class="muscles"><dt>Główne</dt><dd>${esc(m.p.map(muscleName).join(', '))}</dd>${m.s.length ? `<dt>Pomocnicze</dt><dd>${esc(m.s.map(muscleName).join(', '))}</dd>` : ''}</dl></figure>`;
  document.querySelectorAll('#tabs button').forEach((b, j) => b.setAttribute('aria-pressed', j === i));
}
EXS.forEach(([id, name], i) => { const b = document.createElement('button'); b.textContent = name; b.onclick = () => show(i); document.getElementById('tabs').appendChild(b); });
show(0);
</script>
</body>
</html>
'''
html = html.replace('/*__JS__*/', js).replace('/*__EXS__*/null', json.dumps(EXS, ensure_ascii=False))
open(OUT, 'w', encoding='utf-8').write(html)
print(OUT, len(html))
