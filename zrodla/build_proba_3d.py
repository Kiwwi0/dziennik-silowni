"""Próbka obracanego manekina 3D → web/proba-3d-miesnie.html (+ web/miesnie3d.js)."""
import json, os, shutil, sys, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(sys.argv[1] if len(sys.argv) > 1 else '/home/claude/dziennik-silowni', 'web')
src = os.path.join(HERE, 'src')
shutil.copy(os.path.join(src, 'miesnie3d.js'), os.path.join(WEB, 'miesnie3d.js'))
mus = open(os.path.join(src, 'muscles.js'), encoding='utf-8').read()
L = json.load(open(os.path.join(HERE, 'dist', 'exercises.json'), encoding='utf-8'))
NAME = {e['id']: e['name'] for e in L}
IDS = ['Standing_Military_Press', 'Side_Lateral_Raise', 'Reverse_Flyes', 'Barbell_Bench_Press_-_Medium_Grip', 'Barbell_Incline_Bench_Press_-_Medium_Grip',
       'Triceps_Pushdown', 'Cable_Rope_Overhead_Triceps_Extension', 'Barbell_Curl', 'Hammer_Curls', 'Pullups', 'Bent_Over_Barbell_Row', 'Face_Pull',
       'Barbell_Shrug', 'Barbell_Squat', 'Romanian_Deadlift', 'Barbell_Deadlift', 'Barbell_Hip_Thrust', 'Thigh_Abductor', 'Seated_Calf_Raise', 'Russian_Twist']
EXS = [[i, NAME[i]] for i in IDS]
html = open(os.path.join(HERE, 'proba_3d.tpl.html'), encoding='utf-8').read()
h = lambda f: hashlib.sha1(open(f, 'rb').read()).hexdigest()[:10]
vjs, vglb = h(os.path.join(WEB, 'miesnie3d.js')), h(os.path.join(WEB, 'models', 'miesnie.glb'))
# wersja w adresie: telefon (pamięć podręczna aplikacji) zawsze pobierze nowy model i skrypt
html = html.replace("from './miesnie3d.js'", f"from './miesnie3d.js?v={vjs}'").replace("__GLB__", f"models/miesnie.glb?v={vglb}")
html = html.replace('/*__MUSCLES__*/', mus).replace('/*__EXS__*/null', json.dumps(EXS, ensure_ascii=False))
open(os.path.join(WEB, 'proba-3d-miesnie.html'), 'w', encoding='utf-8').write(html)
print('ok', len(html))
