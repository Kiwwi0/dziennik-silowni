"""meshoptimizer przez ctypes: zszycie wierzchołków STL i uproszczenie siatki z zachowaniem topologii (bez dziur)."""
import ctypes, numpy as np
_lib = ctypes.CDLL('/tmp/bp/mo/libmeshopt.so')
_u = np.ctypeslib.ndpointer(np.uint32, flags='C_CONTIGUOUS'); _f = np.ctypeslib.ndpointer(np.float32, flags='C_CONTIGUOUS')
_lib.meshopt_simplify.restype = ctypes.c_size_t
_lib.meshopt_simplify.argtypes = [_u, _u, ctypes.c_size_t, _f, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_size_t, ctypes.c_float, ctypes.c_uint, ctypes.POINTER(ctypes.c_float)]
_lib.meshopt_optimizeVertexCache.restype = None
_lib.meshopt_optimizeVertexCache.argtypes = [_u, _u, ctypes.c_size_t, ctypes.c_size_t]
ERR_ABS, REGULARIZE, PRUNE = 1 << 2, 1 << 4, 1 << 3

def weld(tris, q=1e-3):
    v = tris.reshape(-1, 3)
    key = np.round(v / q).astype(np.int64)
    uk, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    pos = v[first].astype(np.float32)
    f = inv.reshape(-1, 3).astype(np.uint32)
    ok = (f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2])
    return pos, f[ok]

def simplify(pos, f, target_tris, err_mm, prune=True):
    idx = np.ascontiguousarray(f.reshape(-1), np.uint32); pos = np.ascontiguousarray(pos, np.float32)
    dst = np.zeros_like(idx); e = ctypes.c_float(0)
    opts = ERR_ABS | REGULARIZE | (PRUNE if prune else 0)
    n = _lib.meshopt_simplify(dst, idx, idx.size, pos, len(pos), 12, int(target_tris) * 3, float(err_mm), opts, ctypes.byref(e))
    out = np.ascontiguousarray(dst[:n])
    opt = np.zeros_like(out); _lib.meshopt_optimizeVertexCache(opt, out, out.size, len(pos))
    used, inv = np.unique(opt, return_inverse=True)
    return pos[used].astype(np.float64), inv.reshape(-1, 3).astype(np.int64), e.value
