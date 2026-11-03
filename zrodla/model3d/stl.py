import numpy as np
def read_stl(path):
    with open(path, 'rb') as f:
        f.read(80); n = np.frombuffer(f.read(4), '<u4')[0]
        dt = np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')])
        data = np.frombuffer(f.read(n * 50), dt, count=n)
    return data['v'].astype(np.float64)  # (n,3,3)
def cluster(tris, h):
    v = tris.reshape(-1, 3)
    keys = np.floor(v / h).astype(np.int64)
    uk, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    cnt = np.bincount(inv, minlength=len(uk)).astype(np.float64)
    pos = np.stack([np.bincount(inv, v[:, k], len(uk)) for k in range(3)], 1) / cnt[:, None]
    f = inv.reshape(-1, 3)
    ok = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    f = f[ok]
    s = np.sort(f, 1); _, first = np.unique(s, axis=0, return_index=True); f = f[np.sort(first)]
    used = np.unique(f); remap = -np.ones(len(pos), np.int64); remap[used] = np.arange(len(used))
    return pos[used], remap[f]
def normals(pos, f):
    fn = np.cross(pos[f[:, 1]] - pos[f[:, 0]], pos[f[:, 2]] - pos[f[:, 0]])
    vn = np.zeros_like(pos)
    for k in range(3): np.add.at(vn, f[:, k], fn)
    l = np.linalg.norm(vn, axis=1, keepdims=True); l[l == 0] = 1
    return vn / l
def taubin(pos, f, it=6, lam=0.5, mu=-0.53):
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    e = np.concatenate([e, e[:, ::-1]])
    e = np.unique(e, axis=0)
    deg = np.bincount(e[:, 0], minlength=len(pos)).astype(np.float64)
    deg[deg == 0] = 1
    p = pos.copy()
    for i in range(it):
        for w in (lam, mu):
            s = np.zeros_like(p); np.add.at(s, e[:, 0], p[e[:, 1]])
            p = p + w * (s / deg[:, None] - p)
    return p

def taubin_w(pos, f, w, it=10, lam=0.5, mu=-0.53):
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]); e = np.unique(np.concatenate([e, e[:, ::-1]]), axis=0)
    deg = np.bincount(e[:, 0], minlength=len(pos)).astype(np.float64); deg[deg == 0] = 1
    p = pos.copy(); w = w[:, None]
    for i in range(it):
        for k in (lam, mu):
            s = np.zeros_like(p); np.add.at(s, e[:, 0], p[e[:, 1]]); p = p + w * k * (s / deg[:, None] - p)
    return p
