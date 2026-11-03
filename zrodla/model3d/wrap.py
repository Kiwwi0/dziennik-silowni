"""Gładka głowa manekina (sferyczny „shrink-wrap” skóry) i rdzeń szyi (walcowy), żeby nie było dziur i prześwitów."""
import numpy as np


def _fill_blur(R, mask, wrap_axis=0, it=3, sigma=1.2):
    R = R.copy()
    # uzupełnij puste komórki średnią z sąsiadów
    for _ in range(200):
        if mask.all(): break
        acc = np.zeros_like(R); cnt = np.zeros_like(R)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0: continue
                Rs = np.roll(R, dx, axis=0) if wrap_axis == 0 else R
                ms = np.roll(mask, dx, axis=0)
                Rs = np.roll(Rs, dy, axis=1) if dy else Rs; ms = np.roll(ms, dy, axis=1) if dy else ms
                acc += np.where(ms, Rs, 0); cnt += ms
        new = (~mask) & (cnt > 0)
        R[new] = acc[new] / cnt[new]; mask = mask | new
    # wygładzenie (rozmycie)
    for _ in range(it):
        R = (R + np.roll(R, 1, 0) + np.roll(R, -1, 0)) / 3
        Rp = np.pad(R, ((0, 0), (1, 1)), mode='edge'); R = (Rp[:, :-2] + Rp[:, 1:-1] + Rp[:, 2:]) / 3
    return R

def head_wrap(pts, ctr, nt=144, nphi=72, grow=0.0):
    d = pts - ctr; r = np.linalg.norm(d, axis=1)
    th = (np.arctan2(d[:, 1], d[:, 0]) + np.pi) / (2 * np.pi) * nt
    ph = np.arccos(np.clip(d[:, 2] / np.maximum(r, 1e-9), -1, 1)) / np.pi * nphi
    it, ip = np.clip(th.astype(int), 0, nt - 1), np.clip(ph.astype(int), 0, nphi - 1)
    key = it * nphi + ip; o = np.lexsort((r, key)); ks, rs = key[o], r[o]
    starts = np.r_[0, np.nonzero(ks[1:] != ks[:-1])[0] + 1]; ends = np.r_[starts[1:], len(ks)]
    pick = starts + ((ends - starts - 1) * 0.85).astype(int)   # 85. percentyl promienia – bez odstających punktów
    R = np.zeros(nt * nphi); R[ks[starts]] = rs[pick]; R = R.reshape(nt, nphi); mask = R > 0
    R = _fill_blur(R, mask, it=7) + grow
    T = (np.arange(nt) + 0.5) / nt * 2 * np.pi - np.pi; P = (np.arange(nphi) + 0.5) / nphi * np.pi
    TT, PP = np.meshgrid(T, P, indexing='ij')
    V = np.stack([np.sin(PP) * np.cos(TT), np.sin(PP) * np.sin(TT), np.cos(PP)], -1) * R[..., None] + ctr
    V = V.reshape(-1, 3)
    top = len(V); bot = top + 1
    V = np.vstack([V, ctr + [0, 0, R[:, 0].mean()], ctr - [0, 0, R[:, -1].mean()]])
    F = []
    idx = lambda i, j: (i % nt) * nphi + j
    for i in range(nt):
        for j in range(nphi - 1):
            a, b, c, e = idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)
            F += [[a, e, b], [b, e, c]]
        F += [[top, idx(i, 0), idx(i + 1, 0)], [bot, idx(i + 1, nphi - 1), idx(i, nphi - 1)]]
    return V, np.array(F)

def tube_wrap(pts, axis_xy, z0, z1, na=72, nz=None, shrink=12.0):
    nz = nz or int((z1 - z0) / 5)
    dx, dy = pts[:, 0] - axis_xy[0], pts[:, 1] - axis_xy[1]
    a = (np.arctan2(dy, dx) + np.pi) / (2 * np.pi) * na; r = np.hypot(dx, dy)
    zi = ((pts[:, 2] - z0) / (z1 - z0) * nz).astype(int); ok = (zi >= 0) & (zi < nz)
    R = np.zeros((na, nz)); np.maximum.at(R, (np.clip(a.astype(int), 0, na - 1)[ok], zi[ok]), r[ok]); mask = R > 0
    R = _fill_blur(R, mask, it=3)
    R = np.repeat(np.percentile(R, 35, axis=1)[:, None], nz, axis=1)   # stały przekrój szyi (bez wybrzuszenia pod brodą)
    R = np.maximum(R - shrink, 8.0)
    A = (np.arange(na) + 0.5) / na * 2 * np.pi - np.pi; Z = z0 + (np.arange(nz) + 0.5) / nz * (z1 - z0)
    AA, ZZ = np.meshgrid(A, Z, indexing='ij')
    V = np.stack([axis_xy[0] + R * np.cos(AA), axis_xy[1] + R * np.sin(AA), ZZ], -1).reshape(-1, 3)
    F = []
    idx = lambda i, j: (i % na) * nz + j
    for i in range(na):
        for j in range(nz - 1):
            a0, b0, c0, e0 = idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)
            F += [[a0, b0, e0], [b0, c0, e0]]
    return V, np.array(F)
