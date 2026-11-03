import json, subprocess, os, sys, numpy as np
sys.path.insert(0, '/tmp/bp/work')
from stl import read_stl, cluster
sel = json.load(open('/tmp/bp/work/sel.json'))
TORSO = {'abs', 'obliques', 'serratus', 'lats', 'erectors', 'trapsU', 'trapsM', 'trapsL', 'chestU', 'chestL', 'infra', 'teres', 'n_supra'}
FINE = {'flexors': 3, 'extensors': 3, 'brachiorad': 3.5, 'biceps': 3.5, 'brachialis': 3.5, 'triLong': 3.5, 'triLat': 3.5, 'triMed': 3.5,
        'n_leg': 3.5, 'tibialis': 3.5, 'soleus': 4, 'gastro': 4, 'hamLat': 4, 'hamMed': 4, 'adductors': 4.5, 'n_sart': 3.5, 'n_cb': 4}
todo = [s for s in sel if s['key'] in TORSO or s['key'] in FINE]
paths = [f"assets/BodyParts3D_data/stl/{s['id']}.stl" for s in todo]
subprocess.run(['git', '-c', 'gc.auto=0', 'checkout', '-q', 'HEAD', '--'] + paths, cwd='/tmp/bp/bp3d', check=True, timeout=900)
tot = 0
for s, p in zip(todo, paths):
    fp = '/tmp/bp/bp3d/' + p; t = read_stl(fp)
    if s['key'] in TORSO:
        c = t.mean(1); n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        rad = np.stack([c[:, 0], c[:, 1] + 90.0, np.zeros(len(c))], 1)  # oś tułowia: x=0, y=-90
        t = t[(n * rad).sum(1) > 0]
        h = 4.0
    else:
        h = FINE[s['key']]
    pos, f = cluster(t, h)
    np.savez_compressed(f"/tmp/bp/npz/{s['id']}.npz", pos=pos.astype('float32'), f=f.astype('int32'), n0=len(t), h=h)
    s['h'] = h; tot += len(f)
    os.remove(fp)
json.dump(sel, open('/tmp/bp/work/sel.json', 'w'), indent=0)
print('reprocessed', len(todo), 'tris', tot)
