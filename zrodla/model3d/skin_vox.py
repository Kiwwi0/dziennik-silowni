"""Czysta skóra z woksli: zamknięta głowa z żuchwą, dłonie, stopy i ciemny rdzeń pod mięśniami (bez dziur i prześwitów)."""
import sys, numpy as np, time
from scipy import ndimage
from skimage.measure import marching_cubes
sys.path.insert(0, '/tmp/bp/work')
from stl import read_stl, taubin
from mo import simplify

t0 = time.time()
T = read_stl('/tmp/bp/bp3d/assets/BodyParts3D_data/stl/FMA7163.stl')
pts = np.concatenate([T.reshape(-1, 3), T.mean(1), (T[:, 0] + T[:, 1]) / 2, (T[:, 1] + T[:, 2]) / 2, (T[:, 0] + T[:, 2]) / 2])

def solid(pts, vs, lo, hi, dil):
    shape = np.ceil((hi - lo) / vs).astype(int) + 1
    ijk = np.floor((pts - lo) / vs).astype(int)
    ok = np.all((ijk >= 0) & (ijk < shape), 1); ijk = ijk[ok]
    g = np.zeros(shape, bool); g[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    g = ndimage.binary_dilation(g, iterations=dil)
    f3 = ndimage.binary_fill_holes(g)
    for k in range(g.shape[2]):            # przekroje poziome ciała są zamknięte nawet przy małych otworach w skórze
        g[:, :, k] = ndimage.binary_fill_holes(g[:, :, k])
    g = ndimage.binary_erosion(g | f3, iterations=dil)
    return g

def mc(field, level, vs, lo, err, target=1, sm=4):
    v, f, vn, _ = marching_cubes(field, level=level, spacing=(vs, vs, vs))
    # spójne nawinięcie trójkątów na zewnątrz (inaczej normalne się znoszą i powierzchnia wychodzi czarna)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    flip = (fn * vn[f].sum(1)).sum(1) < 0
    f[flip] = f[flip][:, ::-1]
    v = v + lo
    v = taubin(v.astype(np.float64), f.astype(np.int64), sm)
    P, F, e = simplify(v.astype(np.float32), f.astype(np.uint32), target, err, prune=True)
    return P, F

VS = 3.0
lo = pts.min(0) - 3 * VS; hi = pts.max(0) + 3 * VS
G = solid(pts, VS, lo, hi, 1)
print('solid', G.shape, round(time.time() - t0, 1), 's', flush=True)
X, Y, Z = np.meshgrid(*[lo[i] + np.arange(G.shape[i]) * VS for i in range(3)], indexing='ij')
smooth = ndimage.gaussian_filter(G.astype(np.float32), 0.9)

# głowa: nad płaszczyzną biegnącą pod żuchwą (z przodu niżej, z tyłu przy potylicy wyżej)
zcut = 1466 + (Y + 205) * 0.13
nk = pts[(pts[:, 2] > 1440) & (pts[:, 2] < 1460) & (np.abs(pts[:, 0]) < 60)]
ycn = float(np.median(nk[:, 1]))
neck = (Z > 1338 + 0.016 * X ** 2) & (np.abs(X) < 74) & (Y < ycn + 6)
head = smooth * ((Z > zcut) | neck)
# krocze i spojenie łonowe pod skórą (w modelu nie ma tam mięśni) – jak u manekina
pel = pts[(pts[:, 2] > 820) & (pts[:, 2] < 860) & (np.abs(pts[:, 0]) < 40)]
ypel = float(np.median(pel[:, 1]))
groin = (Z > 795) & (Z < 878 - 0.03 * X ** 2) & (np.abs(X) < 46) & (Y < ypel + 25)
GP, GF = mc(ndimage.gaussian_filter(smooth * groin, 1.5), 0.5, VS, lo, 1.0)
print('groin', len(GF), flush=True)
head[:, :, :2] = 0
HP, HF = mc(head, 0.5, VS, lo, 0.55)
# usuń płaską ściankę cięcia z tyłu szyi (pod nią jest rdzeń w kolorze mięśni)
fn = np.cross(HP[HF[:, 1]] - HP[HF[:, 0]], HP[HF[:, 2]] - HP[HF[:, 0]]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
fc = HP[HF].mean(1)
cut = (np.abs(fn[:, 1]) > 0.8) & (fc[:, 1] > ycn - 12) & (fc[:, 2] < 1500) & (np.abs(fc[:, 0]) < 80)
HF = HF[~cut]
print('head', len(HF), flush=True)

# rdzeń: ciało cofnięte o 11 mm (zasłania prześwity między mięśniami), bez głowy, dłoni i stóp
# krocze: wygładzona bryła (otwarcie morfologiczne usuwa wypukłości) i rdzeń tuż pod skórą
yfr = float(np.percentile(pts[(pts[:, 2] > 830) & (pts[:, 2] < 870) & (np.abs(pts[:, 0]) < 25), 1], 2))   # przód miednicy
gbox = (Z > 800) & (Z < 905) & (np.abs(X) < 70) & (Y < yfr + 75)
gw = np.clip(ndimage.gaussian_filter(gbox.astype(np.float32), 4) * 1.5, 0, 1)
dist = ndimage.distance_transform_edt(G) * VS
# (bez specjalnego traktowania krocza w rdzeniu)
torso = ((np.abs(X) < 150) & (Z > 860) & (Z < 1450)).astype(np.float32)
neckr = ((Z > 1430) & (np.abs(X) < 90)).astype(np.float32)
base = 15.0 + 9.0 * ndimage.gaussian_filter(torso, 6)                     # kończyny 15 mm, tułów ~24 mm
neckw = np.clip(ndimage.gaussian_filter(neckr, 2) * 1.8, 0, 1)
lowleg = np.clip((470 - Z) / 80, 0, 1)
depth = base - (base - 9.0) * neckw + 4.0 * lowleg
ankle = np.clip((205 - Z) / 60, 0, 1)                                     # kostka: rdzeń prawie na skórze
wrist = np.clip((850 - Z) / 55, 0, 1) * (Z > 690) * np.clip((np.abs(X) - 160) / 20, 0, 1)
depth = depth * (1 - ankle) + 1.2 * ankle
depth = depth * (1 - wrist) + 1.2 * wrist
grw = np.clip(ndimage.gaussian_filter(gbox.astype(np.float32), 3) * 1.6, 0, 1)
                                        # szyja ~4 mm pod skórą
core = ndimage.gaussian_filter(dist, 0.8) - depth
core[(Z > zcut + 4)] = -50
core[(Z < 127)] = -50
core[(Z < 787) & (np.abs(X) > 182)] = -50     # dłonie mają własną skórę
core[(Z < 806) & (np.abs(X) < 45)] = -50                     # bez zwisających fragmentów pod kroczem
CP, CF = mc(core, 0.0, VS, lo, 2.5)
# krocze: gładka elipsoida wypełniająca przestrzeń między udami (przycięta do wnętrza ciała) – bez szczelin i zwisów
ec = np.array([0.0, ypel, 818.0]); er = np.array([46.0, 62.0, 42.0])
ell = 1.0 - np.sqrt(((X - ec[0]) / er[0]) ** 2 + ((Y - ec[1]) / er[1]) ** 2 + ((Z - ec[2]) / er[2]) ** 2)
inside = ndimage.gaussian_filter(dist, 1.0) - 3.0
crotch = np.minimum(ell * 40.0, inside)
KP, KF = mc(crotch, 0.0, VS, lo, 0.8, sm=6)
print('crotch', len(KF), flush=True)
print('core', len(CF), flush=True)

# dłonie i stopy w drobniejszej siatce (palce osobno)
def part(mask_fn, vs, dil, err, cap_fn=lambda c, n: np.zeros(len(c), bool), sm=8, sig=1.0, axes=(2,)):
    sel = mask_fn(pts)
    p = pts[sel]; l = p.min(0) - 3 * vs; h = p.max(0) + 3 * vs
    shape = np.ceil((h - l) / vs).astype(int) + 1
    ijk = np.floor((p - l) / vs).astype(int); ok = np.all((ijk >= 0) & (ijk < shape), 1); ijk = ijk[ok]
    g = np.zeros(shape, bool); g[ijk[:, 0], ijk[:, 1], ijk[:, 2]] = True
    Xg, Yg, Zg = np.meshgrid(*[l[i] + np.arange(shape[i]) * vs for i in range(3)], indexing='ij')
    C = np.stack([Xg, Yg, Zg], -1).reshape(-1, 3)
    region = mask_fn(C).reshape(shape)
    # zamknij przekrój na granicy cięcia wnętrzem z pełnej bryły ciała G
    gi = np.clip(np.round((C - lo) / VS).astype(int), 0, np.array(G.shape) - 1)
    Gnn = G[gi[:, 0], gi[:, 1], gi[:, 2]].reshape(shape)
    band = region & ~ndimage.binary_erosion(region, iterations=2)
    g = g | (band & Gnn)
    g = ndimage.binary_dilation(g, iterations=dil)
    acc = g.copy()
    for ax in axes:                        # wypełnianie warstwami w kilku kierunkach – suma usuwa „schodki”
        f_ = g.copy()
        for k in range(g.shape[ax]):
            sl = [slice(None)] * 3; sl[ax] = k; f_[tuple(sl)] = ndimage.binary_fill_holes(g[tuple(sl)])
        acc |= f_
    g = ndimage.binary_erosion(acc, iterations=dil)
    g &= region
    s_ = ndimage.gaussian_filter(g.astype(np.float32), sig)
    P, F = mc(s_, 0.5, vs, l, err, sm=sm)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]]); fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    fc = P[F].mean(1)
    drop = cap_fn(fc, fn)
    return P, F[~drop]
WR = 790.0
hands = lambda p: (p[:, 2] < WR) & (np.abs(p[:, 0]) > 186)
feet = lambda p: p[:, 2] < 129
HaP, HaF = part(hands, 2.0, 1, 0.7, axes=(2, 0))
FeP, FeF = part(feet, 2.5, 1, 1.0, sm=12, sig=1.2, axes=(2, 0, 1))
print('hands', len(HaF), 'feet', len(FeF), round(time.time() - t0, 1), 's')
np.savez_compressed('/tmp/bp/mo_npz/skinvox.npz', KP=KP, KF=KF, GP=GP, GF=GF, HP=HP, HF=HF, CP=CP, CF=CF, HaP=HaP, HaF=HaF, FeP=FeP, FeF=FeF)
