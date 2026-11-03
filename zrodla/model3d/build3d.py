"""Model mięśni 3D (BodyParts3D, CC BY-SA 2.1 JP) → GLB. Siatki uproszczone meshoptimizerem, skóra i rdzeń z woksli."""
import json, struct, sys, os
import numpy as np
sys.path.insert(0, '/tmp/bp/work')
from stl import normals, taubin, taubin_w
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bp/miesnie.glb'
sel = json.load(open('/tmp/bp/work/sel.json'))
groups = {}
def add(key, pos, f):
    groups.setdefault(key, []).append((np.asarray(pos, np.float64), np.asarray(f, np.int64)))
for s in sel:
    d = np.load(f"/tmp/bp/mo_npz/{s['id']}.npz")
    add(s['key'], d['pos'], d['f'])
sv = np.load('/tmp/bp/mo_npz/skinvox.npz')
hp = taubin(sv['HP'].astype(np.float64), sv['HF'], 4)
wb = np.clip((hp[:, 1] + 110) / 70, 0, 1) * np.clip((hp[:, 2] - 1480) / 40, 0, 1)   # tył i czubek głowy: mocniej wygładzone (włosy w skanie)
hp = taubin_w(hp, sv['HF'], wb, it=30, lam=0.55, mu=0.0)
add('skin', hp, sv['HF'])
add('skin', sv['HaP'], sv['HaF']); add('skin', taubin(sv['FeP'].astype(np.float64), sv['FeF'], 2), sv['FeF'])
add('core', sv['CP'], sv['CF'])
add('core', sv['KP'], sv['KF'])
# BodyParts3D: mm, Z w górę, przód = -Y, prawa strona = -X  →  three.js: Y w górę, przód = +Z
allp = np.concatenate([p for g in groups.values() for p, _ in g])
cx, cy = (allp[:, 0].min() + allp[:, 0].max()) / 2, (allp[:, 1].min() + allp[:, 1].max()) / 2
def conv(p):
    return np.stack([p[:, 0] - cx, p[:, 2], -(p[:, 1] - cy)], 1)

Q = 10.0  # 0,1 mm na jednostkę int16; skala węzła 1e-4 → metry
bin_parts, buffer_views, accessors, meshes, nodes = [], [], [], [], []
off = 0
def push(data, target=None):
    global off
    b = data.tobytes(); pad = (-len(b)) % 4
    buffer_views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(b), **({'target': target} if target else {})})
    bin_parts.append(b + b'\0' * pad); off += len(b) + pad
    return len(buffer_views) - 1

tot_t = 0
for key, items in groups.items():
    # scal części jednego mięśnia; dziel, gdy przekroczy 65 535 wierzchołków
    chunks, cur_p, cur_f, nv = [], [], [], 0
    for p, f in items:
        if nv + len(p) > 65000 and cur_p:
            chunks.append((cur_p, cur_f)); cur_p, cur_f, nv = [], [], 0
        cur_p.append(p); cur_f.append(f + nv); nv += len(p)
    chunks.append((cur_p, cur_f))
    for ci, (ps, fs) in enumerate(chunks):
        p = conv(np.concatenate(ps)); f = np.concatenate(fs)
        n = normals(p, f)
        if key == 'core': n = -n   # rdzeń z woksli ma odwrotną orientację normalnych
        qp = np.round(p * Q).astype(np.int16)
        qn = np.zeros((len(n), 4), np.int8); qn[:, :3] = np.round(n * 127).astype(np.int8)
        idx = f.astype(np.uint16).reshape(-1)
        bvp = push(qp, 34962); bvn = push(qn, 34962); bvi = push(idx, 34963)
        accessors.append({'bufferView': bvp, 'componentType': 5122, 'count': len(qp), 'type': 'VEC3',
                          'min': qp.min(0).tolist(), 'max': qp.max(0).tolist()})
        ap = len(accessors) - 1
        accessors.append({'bufferView': bvn, 'componentType': 5120, 'normalized': True, 'count': len(qn), 'type': 'VEC3', 'byteOffset': 0})
        an = len(accessors) - 1
        buffer_views[bvn]['byteStride'] = 4
        accessors.append({'bufferView': bvi, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'})
        ai = len(accessors) - 1
        meshes.append({'name': key, 'primitives': [{'attributes': {'POSITION': ap, 'NORMAL': an}, 'indices': ai}]})
        nodes.append({'name': key if ci == 0 else f'{key}#{ci}', 'mesh': len(meshes) - 1, 'scale': [1 / (Q * 1000)] * 3, 'extras': {'key': key}})
        tot_t += len(f)

gltf = {'asset': {'version': '2.0', 'generator': 'Dziennik siłowni',
                  'copyright': 'BodyParts3D, (c) The Database Center for Life Science, CC Attribution-Share Alike 2.1 Japan'},
        'extensionsUsed': ['KHR_mesh_quantization'], 'extensionsRequired': ['KHR_mesh_quantization'],
        'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
        'accessors': accessors, 'bufferViews': buffer_views, 'buffers': [{'byteLength': off}]}
js = json.dumps(gltf, separators=(',', ':')).encode()
js += b' ' * ((-len(js)) % 4)
binb = b''.join(bin_parts)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binb), 0x004E4942) + binb
open(OUT, 'wb').write(glb)
print(OUT, len(glb), 'B,', tot_t, 'tris,', len(nodes), 'nodes')
