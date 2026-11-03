"""Model mięśni 3D (BodyParts3D, CC BY-SA 2.1 JP) → GLB z kwantyzacją (KHR_mesh_quantization)."""
import json, struct, sys, os
import numpy as np
sys.path.insert(0, '/tmp/bp/work')
from stl import read_stl, cluster, normals, taubin

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/bp/miesnie.glb'
SCALE = {'bone': 8, 'n_neck': 7, 'skin': 6, 'flexors': 4.5, 'extensors': 4.5, 'n_itb': 6, 'n_sart': 5.5, 'n_leg': 5.5, 'adductors': 5.5, 'hamLat': 5, 'hamMed': 5, 'gastro': 5, 'soleus': 5, 'quadRF': 5, 'quadVM': 5, 'biceps': 4.2, 'brachiorad': 4.5, 'brachialis': 4.5, 'triLong': 4.2, 'triLat': 4.2, 'triMed': 4.5, 'obliques': 4.6, 'lats': 4.6, 'erectors': 5, 'serratus': 4.6, 'tibialis': 4.5, 'n_cb': 5, 'gluteMax': 5.5, 'gluteMed': 5.5, 'quadVL': 5.5}
DEFAULT_H = 5.5
sel = json.load(open('/tmp/bp/work/sel.json'))

groups = {}
def add(key, pos, f):
    groups.setdefault(key, []).append((pos, f))
for s in sel:
    d = np.load(f"/tmp/bp/npz/{s['id']}.npz")
    pos, f = d['pos'].astype(np.float64), d['f']
    h = SCALE.get(s['key'], s['h'])
    if h > s['h']:
        pos, f = cluster(pos[f], h)
    pos = taubin(pos, f, 4)
    add(s['key'], pos, f)

# skóra: głowa, dłonie, stopy (gładkie, jasne części manekina)
skin_npz = '/tmp/bp/npz/skin_parts.npz'
if not os.path.exists(skin_npz):
    t = read_stl('/tmp/bp/bp3d/assets/BodyParts3D_data/stl/FMA7163.stl')
    c = t.mean(1)
    head = c[:, 2] > float(os.environ.get('HEAD_Z', 1490))
    # głowa: tylko zewnętrzna powłoka (skóra ma miejscami podwójną warstwę) – w każdym kierunku od środka najdalszy trójkąt
    hc = c[head]; ctr = np.array([np.median(hc[:, 0]), np.median(hc[:, 1]), 1560.0])
    dv = hc - ctr; r = np.linalg.norm(dv, axis=1)
    th = np.arctan2(dv[:, 1], dv[:, 0]); ph = np.arccos(np.clip(dv[:, 2] / np.maximum(r, 1e-9), -1, 1))
    bins = (np.floor((th + np.pi) / np.radians(2.5)).astype(int) * 1000 + np.floor(ph / np.radians(2.5)).astype(int))
    order = np.lexsort((-r, bins)); bs = bins[order]; first = np.r_[True, bs[1:] != bs[:-1]]
    rmax = np.empty_like(r); grp = np.cumsum(first) - 1; mx = r[order][first]; rmax[order] = mx[grp]
    keep = r >= rmax - 4.0
    idx = np.where(head)[0][keep]; head = np.zeros(len(c), bool); head[idx] = True
    hands = (c[:, 2] < 812) & (np.abs(c[:, 0]) > 188)
    feet = c[:, 2] < 92
    parts = {}
    for name, m in [('head', head), ('hands', hands), ('feet', feet)]:
        p, f = cluster(t[m], 6.0 if name == 'head' else 4.5)
        parts[name + '_p'] = p.astype('float32'); parts[name + '_f'] = f.astype('int32')
    np.savez_compressed(skin_npz, **parts)
core_npz = '/tmp/bp/npz/core.npz'
if not os.path.exists(core_npz):
    t = read_stl('/tmp/bp/bp3d/assets/BodyParts3D_data/stl/FMA7163.stl'); c = t.mean(1)
    m = (c[:, 2] > 900) & (c[:, 2] < 1420) & (np.abs(c[:, 0]) < 165)
    p, f = cluster(t[m], 10.0); p = taubin(p, f, 6)
    ay = np.where(p[:, 2] > 1440, -75.0, -90.0)
    dx, dy = p[:, 0], p[:, 1] - ay; r = np.hypot(dx, dy) + 1e-9
    depth = np.where(p[:, 2] > 1440, 20.0, 28.0)
    k = np.maximum(0.15, (r - depth) / r)
    p = np.stack([dx * k, ay + dy * k, p[:, 2]], 1)
    np.savez_compressed(core_npz, p=p.astype('float32'), f=f.astype('int32'))
cz = np.load(core_npz); add('core', cz['p'].astype(np.float64), cz['f'])

sk = np.load(skin_npz)
wrap_npz = '/tmp/bp/npz/wrap.npz'
if not os.path.exists(wrap_npz):
    from wrap import head_wrap, tube_wrap
    t = read_stl('/tmp/bp/bp3d/assets/BodyParts3D_data/stl/FMA7163.stl'); v = t.reshape(-1, 3)
    hp = v[v[:, 2] > 1478]
    ctr = np.array([np.median(hp[:, 0]), np.median(hp[:, 1]) - 8, 1572.0])
    HV, HF = head_wrap(hp, ctr)
    npnt = v[(v[:, 2] > 1390) & (v[:, 2] < 1455) & (np.abs(v[:, 0]) < 72)]
    ax = (0.0, float(np.median(npnt[:, 1])))
    NV, NF = tube_wrap(npnt, ax, 1385, 1500, shrink=12.0)
    np.savez_compressed(wrap_npz, HV=HV, HF=HF, NV=NV, NF=NF)
wz = np.load(wrap_npz)
add('skin', wz['HV'], wz['HF']); add('core', wz['NV'], wz['NF'])
for name in ['hands', 'feet']:
    pp, ff = sk[name + '_p'].astype(np.float64), sk[name + '_f']
    add('skin', taubin(pp, ff, 8 if name == 'head' else 4), ff)

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
