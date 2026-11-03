import json, subprocess, os, sys, numpy as np, time
sys.path.insert(0, '/tmp/bp/work')
from stl import read_stl, taubin
from mo import weld, simplify
sel = json.load(open('/tmp/bp/work/sel.json'))
ERR = {'bone': 1.8, 'obliques': 1.5, 'lats': 1.4, 'erectors': 1.5, 'serratus': 1.4, 'adductors': 1.5}
def err_for(k): return ERR.get(k, 1.6 if k.startswith('n_') else 1.15)
todo = [s for s in sel if not os.path.exists(f"/tmp/bp/mo_npz/{s['id']}.npz")]
t0 = time.time(); tot = 0
for b in range(0, len(todo), 30):
    batch = todo[b:b + 30]
    paths = [f"assets/BodyParts3D_data/stl/{s['id']}.stl" for s in batch]
    subprocess.run(['git', '-c', 'gc.auto=0', 'checkout', '-q', 'HEAD', '--'] + paths, cwd='/tmp/bp/bp3d', check=True, timeout=900)
    for s, p in zip(batch, paths):
        fp = '/tmp/bp/bp3d/' + p
        t = read_stl(fp); pos, f = weld(t)
        P, F, e = simplify(pos, f, 1, err_for(s['key']))
        P = taubin(P, F, 3)
        np.savez_compressed(f"/tmp/bp/mo_npz/{s['id']}.npz", pos=P.astype('float32'), f=F.astype('int32'))
        tot += len(F); os.remove(fp)
    print(b + len(batch), '/', len(todo), round(time.time() - t0), 's', flush=True)
print('tris', tot)
