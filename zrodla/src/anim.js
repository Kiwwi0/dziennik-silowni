/* Animacje ćwiczeń: schematyczna postać w 3D rzutowana na płaszczyznę i rysowana jako SVG.
   Każde ćwiczenie = klatki kluczowe (kąty segmentów albo punkty docelowe dłoni/stóp) + sprzęt.
   API: ANIM.has(id), ANIM.svg(id, u, opt), ANIM.info(id, u), ANIM.dur(id), ANIM.thumb(id). */
const ANIM = (() => {
'use strict';
const RAD = Math.PI / 180;
const cos = d => Math.cos(d * RAD), sin = d => Math.sin(d * RAD);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerpA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const ease = t => 0.5 - 0.5 * Math.cos(Math.PI * t);
function rot(v, k, deg){
  const c = cos(deg), s = sin(deg), kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const WORLD = {F:X, T:Y, S:Z};
// Wymiary ciała (1 jednostka ≈ 1,1 cm).
const B = {lumbar:22, thor:28, neck:6, head:10.5, ua:28, fa:30, thigh:40, shank:38, toe:15, heel:5, sh:15, hp:9};
const SIDES = [['R', 1], ['L', -1]];

/* ---------- kinematyka ---------- */
function ik(base, target, l1, l2, pole){
  const d = sub(target, base); let dist = len(d);
  const dn = dist > 1e-6 ? mul(d, 1 / dist) : [0, -1, 0];
  dist = Math.min(l1 + l2 - 0.001, Math.max(Math.abs(l1 - l2) + 0.001, dist));
  let pp = sub(pole, mul(dn, dot(pole, dn)));
  if (len(pp) < 1e-6) pp = Math.abs(dn[1]) < 0.9 ? sub(Y, mul(dn, dn[1])) : sub(X, mul(dn, dn[0]));
  pp = unit(pp);
  const a = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return {mid:add(add(base, mul(dn, a)), mul(pp, h)), end:add(base, mul(dn, dist))};
}
function dirOf(a, b, s, fr){
  const ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  return add(add(mul(fr.F, cb * ca), mul(fr.T, cb * sa)), mul(fr.S, s * sb));
}
const DIRS = ['F', 'T', 'S', 'Fu', 'Tu', 'Su'];
const frameOf = (P, f) => f === 'u' ? {F:P.Fu, T:P.Tu, S:P.Su} : f === 't' ? {F:P.F, T:P.T, S:P.S} : WORLD;
function relPoint(P, spec, side, s){
  const v = spec.ik;
  if (!spec.rel) return v;
  if (spec.rel === 'sh') return add(P['sh' + side], v);
  if (spec.rel === 'hip') return add(P['hip' + side], v);
  const fr = frameOf(P, spec.rel), o = spec.rel === 'u' ? P.shC : P.hipC;
  return add(o, add(add(mul(fr.F, v[0]), mul(fr.T, v[1])), mul(fr.S, v[2])));
}
function poleOf(P, spec, isArm){
  if (!spec.pole) return isArm ? add(mul(P.Tu, -1), mul(P.Fu, -0.25)) : [1, 0.25, 0];
  if (!spec.prel) return spec.pole;
  const fr = frameOf(P, spec.prel), v = spec.pole;
  return add(add(mul(fr.F, v[0]), mul(fr.T, v[1])), mul(fr.S, v[2]));
}

function solve(p){
  const P = {};
  const hip = p.hip ? [...p.hip] : [0, 0, 0];
  let T = [cos(p.torso ?? 90), sin(p.torso ?? 90), 0], S = [...Z];
  let F = cross(T, S);
  if (p.lean){ T = rot(T, F, p.lean); S = rot(S, F, p.lean); }
  const mid = add(hip, mul(T, B.lumbar));
  const Tu = p.flex ? rot(T, S, -p.flex) : T;
  const Su = p.twist ? rot(S, Tu, -p.twist) : S;
  const Fu = cross(Tu, Su);
  const shC = add(mid, mul(Tu, B.thor));
  const up = mul(Tu, p.shrug || 0);
  Object.assign(P, {F, T, S, Fu, Tu, Su, hipC:hip, mid, shC});
  P.shR = add(add(shC, mul(Su, B.sh)), up); P.shL = add(sub(shC, mul(Su, B.sh)), up);
  P.midR = add(mid, mul(S, B.hp + 2)); P.midL = sub(mid, mul(S, B.hp + 2));
  P.hipR = add(hip, mul(Z, B.hp)); P.hipL = sub(hip, mul(Z, B.hp));
  const Tn = p.neck ? rot(Tu, Su, p.neck) : Tu;
  P.neckT = add(shC, mul(Tn, B.neck));
  P.head = add(P.neckT, mul(Tn, B.head * 0.85));
  P.face = add(P.head, mul(cross(Tn, Su), B.head));
  // Kończyny zadane kątami (przed obrotem całego ciała).
  const limbs = [];
  for (const [side, s] of SIDES){
    for (const kind of ['arm', 'leg']){
      const spec = p[kind + side]; if (!spec) continue;
      const isArm = kind === 'arm';
      const root = P[(isArm ? 'sh' : 'hip') + side];
      const l1 = isArm ? B.ua : B.thigh, l2 = isArm ? B.fa : B.shank;
      const fk = sp => {
        const fr = sp.rel === true || sp.rel === 'u' ? (isArm ? {F:Fu, T:Tu, S:Su} : {F, T, S}) : sp.rel === 't' ? {F, T, S} : WORLD;
        const m = add(root, mul(dirOf(sp.a, sp.b || 0, s, fr), l1));
        return [m, add(m, mul(dirOf(sp.a2 ?? sp.a, sp.b2 ?? sp.b ?? 0, s, fr), l2))];
      };
      if (spec.mix){
        spec.mix.forEach((sp, i) => { if (sp.ik === undefined) P['_e' + i + kind + side] = fk(sp)[1]; });
        limbs.push({side, s, kind, spec, isArm, l1, l2});
      } else if (spec.ik === undefined){
        const [m, e] = fk(spec);
        P[(isArm ? 'elb' : 'knee') + side] = m; P[(isArm ? 'grip' : 'ankle') + side] = e;
        if (!isArm) footOf(P, side, s, spec, null);
      } else limbs.push({side, s, kind, spec, isArm, l1, l2});
    }
  }
  // Obrót całej postaci wokół bioder.
  let R = null;
  if (p.rot){
    const [rx, ry, rz] = p.rot;
    R = v => { let w = v; if (rz) w = rot(w, Z, rz); if (rx) w = rot(w, X, rx); if (ry) w = rot(w, Y, ry); return w; };
    for (const k in P){ if (DIRS.includes(k)) P[k] = R(P[k]); else P[k] = add(hip, R(sub(P[k], hip))); }
  }
  // Zakotwiczenie wybranego punktu (np. stopy na podłodze).
  if (p.anchor){
    const {j, at} = p.anchor;
    let cur;
    if (j === 'ankles') cur = lerpA(P.ankleR, P.ankleL, 0.5);
    else if (j === 'low'){ const m = Math.min(...['toeR', 'toeL', 'heelR', 'heelL'].filter(k => P[k]).map(k => P[k][1])); cur = [0, m, 0]; }
    else cur = P[j];
    const off = j === 'low' ? [0, at[1] - cur[1], 0] : [at[0] - cur[0], at[1] - cur[1], at.length > 2 ? at[2] - cur[2] : 0];
    for (const k in P) if (!DIRS.includes(k)) P[k] = add(P[k], off);
  }
  // Kończyny prowadzone do punktu (IK) albo mieszane między dwiema klatkami.
  for (const L of limbs){
    const {side, s, kind, spec, isArm, l1, l2} = L;
    const root = P[(isArm ? 'sh' : 'hip') + side];
    let target, pole;
    if (spec.mix){
      const ends = spec.mix.map((sp, i) => sp.ik === undefined ? P['_e' + i + kind + side] : relPoint(P, sp, side, s));
      target = lerpA(ends[0], ends[1], spec.t);
      const poles = spec.mix.map(sp => sp.ik === undefined ? null : poleOf(P, sp, isArm));
      pole = poles[0] && poles[1] ? lerpA(poles[0], poles[1], spec.t) : poles[0] || poles[1];
    } else { target = relPoint(P, spec, side, s); pole = poleOf(P, spec, isArm); }
    const r = ik(root, target, l1, l2, pole);
    P[(isArm ? 'elb' : 'knee') + side] = r.mid; P[(isArm ? 'grip' : 'ankle') + side] = r.end;
    if (!isArm) footOf(P, side, s, spec, R);
  }
  for (const k in P) if (k[0] === '_') delete P[k];
  return P;
}
function footOf(P, side, s, spec, R){
  let d = dirOf(spec.f || 0, spec.fb ?? 6, s, WORLD);
  if (R) d = R(d);
  P['toe' + side] = add(P['ankle' + side], mul(d, B.toe));
  P['heel' + side] = sub(P['ankle' + side], mul(d, B.heel));
}

/* ---------- klatki ---------- */
function mirror(sp){
  if (!sp || typeof sp !== 'object') return sp;
  const m = {...sp};
  if (sp.ik) m.ik = [sp.ik[0], sp.ik[1], -sp.ik[2]];
  if (sp.pole) m.pole = [sp.pole[0], sp.pole[1], -sp.pole[2]];
  return m;
}
function expand(f){
  const o = {...f};
  if (f.arms){ o.armR = f.arms; o.armL = mirror(f.arms); delete o.arms; }
  if (f.legs){ o.legR = f.legs; o.legL = mirror(f.legs); delete o.legs; }
  return o;
}
function blendLimb(a, b, t){
  if (!a || !b) return a || b;
  const fl = {f:lerp(a.f || 0, b.f || 0, t), fb:lerp(a.fb ?? 6, b.fb ?? 6, t)};
  if (a.ik === undefined && b.ik === undefined)
    return {...fl, rel:a.rel, a:lerp(a.a, b.a, t), b:lerp(a.b || 0, b.b || 0, t), a2:lerp(a.a2 ?? a.a, b.a2 ?? b.a, t), b2:lerp(a.b2 ?? a.b ?? 0, b.b2 ?? b.b ?? 0, t)};
  if (a.ik !== undefined && b.ik !== undefined && a.rel === b.rel && a.prel === b.prel){
    const o = {...fl, rel:a.rel, prel:a.prel, ik:lerpA(a.ik, b.ik, t)};
    if (a.pole || b.pole) o.pole = lerpA(a.pole || b.pole, b.pole || a.pole, t);
    return o;
  }
  return {...fl, mix:[a, b], t};
}
function blend(a, b, t){
  if (a === b || t <= 0) return a; if (t >= 1) return b;
  const o = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])){
    const va = a[k] ?? b[k], vb = b[k] ?? a[k];
    if (typeof va === 'number') o[k] = lerp(va, vb, t);
    else if (Array.isArray(va) && typeof va[0] === 'number') o[k] = lerpA(va, vb, t);
    else if (k.startsWith('arm') || k.startsWith('leg')) o[k] = blendLimb(va, vb, t);
    else o[k] = t < 0.5 ? va : vb;
  }
  return o;
}

/* ---------- rzutowanie i rysowanie ---------- */
function projector(view){
  const yaw = view.yaw || 0, el = view.el || 0;
  const cy = cos(yaw), sy = sin(yaw), ce = cos(el), se = sin(el);
  return p => { const sx = p[0] * cy - p[2] * sy, dep = p[0] * sy + p[2] * cy; return [sx, p[1] * ce - dep * se, p[1] * se + dep * ce]; };
}
const f1 = n => (Math.round(n * 10) / 10).toString();
// Element rysunku: głębokość (większa = bliżej), punkty do kadrowania, funkcja rysująca.
function D(d, pts, draw, fit = true){ return {d, pts, draw, fit}; }
function lineD(pr, a, b, w, cls, d, fit){
  const A = pr(a), Bp = pr(b);
  return D(d ?? (A[2] + Bp[2]) / 2, [A, Bp], M => `<line x1="${f1(M.x(A))}" y1="${f1(M.y(A))}" x2="${f1(M.x(Bp))}" y2="${f1(M.y(Bp))}" stroke-width="${f1(w * M.k)}" class="${cls}"/>`, fit);
}
function polyD(pr, pts3, w, cls, d, fit, closed = true){
  const Q = pts3.map(pr);
  return D(d ?? Q.reduce((s, q) => s + q[2], 0) / Q.length, Q, M => {
    const pts = Q.map(q => f1(M.x(q)) + ',' + f1(M.y(q))).join(' ');
    return closed ? `<polygon points="${pts}" stroke-width="${f1(w * M.k)}" class="${cls}"/>` : `<polyline points="${pts}" stroke-width="${f1(w * M.k)}" class="${cls}" fill="none"/>`;
  }, fit);
}
function circleD(pr, c, r, cls, d, fit){
  const C = pr(c);
  return D(d ?? C[2], [[C[0] - r, C[1] - r, C[2]], [C[0] + r, C[1] + r, C[2]]], M => `<circle cx="${f1(M.x(C))}" cy="${f1(M.y(C))}" r="${f1(r * M.k)}" class="${cls}"/>`, fit);
}
// Krążek o promieniu r i osi n (talerz, koło): w rzucie elipsa.
function discD(pr, c, n, r, cls, d, fit){
  const C = pr(c), N = sub(pr(add(c, n)), C);
  const minor = Math.abs(N[2]) * r, nl = Math.hypot(N[0], N[1]);
  const ang = nl < 1e-6 ? 0 : Math.atan2(-N[1], N[0]) / RAD;
  const rx = nl < 1e-6 ? r : Math.max(minor, 0.6), ry = r;
  return D(d ?? C[2], [[C[0] - r, C[1] - r, C[2]], [C[0] + r, C[1] + r, C[2]]], M => `<ellipse cx="${f1(M.x(C))}" cy="${f1(M.y(C))}" rx="${f1(Math.max(rx * M.k, 0.8))}" ry="${f1(ry * M.k)}" transform="rotate(${f1(ang)} ${f1(M.x(C))} ${f1(M.y(C))})" class="${cls}"/>`, fit);
}
const hullPts = P => hull(P);
function hull(P){
  const pts = P.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const p of pts){ while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()){ while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
// Prostopadłościan: środek c, wymiary s, obrót rz wokół osi Z (pochylenie w płaszczyźnie boku).
function boxD(pr, c, s, rz, cls, d, fit){
  const h = s.map(v => v / 2), out = [];
  for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1]){
    let v = [i * h[0], j * h[1], k * h[2]];
    if (rz) v = rot(v, Z, rz);
    out.push(pr(add(c, v)));
  }
  const H = hull(out), C = pr(c);
  return D(d ?? C[2] - 200, out, M => `<polygon points="${H.map(q => f1(M.x(q)) + ',' + f1(M.y(q))).join(' ')}" class="${cls}"/>`, fit);
}

/* ---------- postać ---------- */
const W = {torso:17, neck:8, thigh:13.5, shank:10.5, foot:6, ua:9.5, fa:8.5};
function figure(P, pr, hl, ghost){
  const out = [];
  const c = k => pr(P[k])[2];
  const farA = c('shR') - c('shL'), farL = c('hipR') - c('hipL');
  const sideCls = (side, isArm, part) => {
    if (ghost) return 'a-g';
    const diff = isArm ? farA : farL;
    const far = (side === 'R' ? diff < -3 : diff > 3);
    if (hl.has(part) || hl.has(part + side)) return far ? 'a-hf' : 'a-h';
    return far ? 'a-f' : 'a-n';
  };
  const torsoCls = ghost ? 'a-g' : hl.has('torso') ? 'a-h' : 'a-n';
  out.push(polyD(pr, [P.shL, P.shR, P.midR, P.hipR, P.hipL, P.midL], W.torso, torsoCls));
  out.push(lineD(pr, P.shC, P.neckT, W.neck, ghost ? 'a-g' : hl.has('neck') ? 'a-h' : 'a-n'));
  const H = pr(P.head);
  out.push(circleD(pr, P.head, B.head, ghost ? 'a-g' : 'a-n', H[2] + 0.5));
  for (const [side] of SIDES){
    out.push(lineD(pr, P['hip' + side], P['knee' + side], W.thigh, sideCls(side, false, 'thigh')));
    out.push(lineD(pr, P['knee' + side], P['ankle' + side], W.shank, sideCls(side, false, 'shank')));
    out.push(lineD(pr, P['heel' + side], P['toe' + side], W.foot, sideCls(side, false, 'foot')));
    out.push(lineD(pr, P['sh' + side], P['elb' + side], W.ua, sideCls(side, true, 'ua')));
    out.push(lineD(pr, P['elb' + side], P['grip' + side], W.fa, sideCls(side, true, 'fa')));
    if (!ghost && (hl.has('delt') || hl.has('delt' + side))) out.push(circleD(pr, P['sh' + side], 7, sideCls(side, true, 'delt'), (c('sh' + side) + c('elb' + side)) / 2 + 0.4));
    if (!ghost && hl.has('trap')) out.push(circleD(pr, add(lerpA(P.shC, P['sh' + side], 0.5), mul(P.Tu, 2)), 6, sideCls(side, true, 'trap'), c('sh' + side) + 0.2));
    if (!ghost && (hl.has('glute') || hl.has('glute' + side))) out.push(circleD(pr, add(P['hip' + side], mul(P.F, -4)), 9.5, sideCls(side, false, 'glute'), pr(add(P['hip' + side], mul(P.F, -6)))[2] + 0.2));
  }
  return out;
}

/* ---------- sprzęt ---------- */
function makeKit(pr){
  const K = {
    line:(a, b, w, cls = 'a-fr', o = {}) => lineD(pr, a, b, w, cls, o.d, o.fit),
    poly:(pts, w, cls, o = {}) => polyD(pr, pts, w, cls, o.d, o.fit, o.closed !== false),
    circle:(c, r, cls, o = {}) => circleD(pr, c, r, cls, o.d, o.fit),
    disc:(c, n, r, cls, o = {}) => discD(pr, c, n, r, cls, o.d, o.fit),
    box:(c, s, rz = 0, cls = 'a-env', o = {}) => boxD(pr, c, s, rz, cls, o.d, o.fit),
    depth:p => pr(p)[2],
  };
  // Sztanga: gryf wzdłuż osi Z przez środek chwytu, talerze po bokach.
  K.barbell = (P, o = {}) => {
    const c = o.at || lerpA(P.gripR, P.gripL, 0.5);
    const half = o.half ?? 98, pz = o.pz ?? 74, r = o.r ?? 21;
    const side = Math.abs(dot(pr([0, 0, 1]), [0, 0, 1])) > 0.5;
    const out = [K.line(add(c, [0, 0, -half]), add(c, [0, 0, half]), 3, 'a-eq', {d:side ? -1 : undefined})];
    for (const s of [1, -1]){
      const pc = add(c, [0, 0, s * pz]);
      const real = pr(pc)[2];
      const d = side ? (real > 0 ? 8 : -60) : real;
      out.push(K.disc(pc, Z, r, 'a-pl', {d}));
      if (r > 8) out.push(K.disc(add(pc, [0, 0, s * 3]), Z, 4.5, 'a-hub', {d:d + 0.1}));
    }
    return out;
  };
  // Hantla w dłoni; oś: 'z' (nachwyt/podchwyt), 'n' (chwyt młotkowy), albo wektor.
  K.dumbbell = (P, side, o = {}) => {
    const g = P['grip' + side], fa = unit(sub(g, P['elb' + side]));
    let ax = o.axis === 'n' ? unit(cross(fa, Z)) : Array.isArray(o.axis) ? unit(o.axis) : Z;
    if (len(ax) < 0.1) ax = X;
    const r = o.r ?? 7.5, hl = o.hl ?? 9;
    const d0 = pr(g)[2] + 0.4;
    return [K.line(add(g, mul(ax, -hl)), add(g, mul(ax, hl)), 3, 'a-eq', {d:d0}),
      K.disc(add(g, mul(ax, hl)), ax, r, 'a-db', {d:pr(add(g, mul(ax, hl)))[2] + 0.4}),
      K.disc(add(g, mul(ax, -hl)), ax, r, 'a-db', {d:pr(add(g, mul(ax, -hl)))[2] + 0.4})];
  };
  K.dumbbells = (P, o = {}) => [...K.dumbbell(P, 'R', o), ...K.dumbbell(P, 'L', o)];
  // Kettlebell zwisający z dłoni (albo w przedłużeniu ręki przy wymachu).
  K.kettlebell = (P, at, dirv, o = {}) => {
    const dn = unit(dirv || [0, -1, 0]);
    const c = add(at, mul(dn, 11));
    return [K.line(at, add(at, mul(dn, 4)), 3, 'a-eq', {d:pr(at)[2] + 0.3}), K.circle(c, 9.5, 'a-db', {d:pr(at)[2] + 0.35})];
  };
  // Linka wyciągu od bloczka do punktu; bloczek jako kółko.
  K.cable = (from, to, o = {}) => [K.line(from, to, 1.6, 'a-cab', {d:o.d ?? pr(to)[2] - 0.5, fit:false}), K.disc(from, o.axis || Z, 4.5, 'a-fr2', {d:-150, fit:false})];
  K.column = (x, z, top = 190, o = {}) => [K.box([x, top / 2, z], [12, top, 12], 0, 'a-mach', {d:-300})];
  K.floor = () => null;
  // Ławka płaska: blat i dwie nogi.
  K.bench = (x0, x1, top = 42, o = {}) => {
    const w = o.w ?? 26, z = o.z ?? 0;
    return [K.box([(x0 + x1) / 2, top - 4, z], [x1 - x0, 8, w], 0, 'a-pad', {d:-200}),
      K.box([x0 + 12, (top - 8) / 2, z], [6, top - 8, w - 6], 0, 'a-env', {d:-210}),
      K.box([x1 - 12, (top - 8) / 2, z], [6, top - 8, w - 6], 0, 'a-env', {d:-210})];
  };
  // Pochylone oparcie od punktu p (dół) pod kątem ang, długość l.
  // Płaska poduszka wzdłuż kierunku ang od punktu p; przesunięta w bok o (off + grubość/2), side = ±1.
  K.pad = (p, ang, l, o = {}) => {
    const w = o.w ?? 26, th = o.th ?? 8;
    const dvec = [cos(ang), sin(ang), 0], nrm = [-sin(ang), cos(ang), 0];
    const c = add(add(add(p, mul(dvec, l / 2)), mul(nrm, (o.side ?? 1) * ((o.off ?? 8.5) + th / 2))), [0, 0, o.z || 0]);
    return K.box(c, [l, th, w], ang, o.cls || 'a-pad', {d:o.d ?? -190});
  };
  // Hantla w dowolnym miejscu (np. jedna trzymana oburącz).
  K.db = (at, axis, o = {}) => {
    const ax = unit(axis), r = o.r ?? 8, hl = o.hl ?? 9, d0 = o.d ?? pr(at)[2] + 0.4;
    return [K.line(add(at, mul(ax, -hl)), add(at, mul(ax, hl)), 3, 'a-eq', {d:d0}),
      K.disc(add(at, mul(ax, hl)), ax, r, 'a-db', {d:d0 + 0.01}), K.disc(add(at, mul(ax, -hl)), ax, r, 'a-db', {d:d0 + 0.01})];
  };
  // Lina/guma jako łamana (fala) od a do b; amp = amplituda, ph = faza, n = liczba fal.
  K.wave = (a, b, amp, ph, o = {}) => {
    const pts = [], N = 28, up = o.up || [0, 1, 0];
    for (let i = 0; i <= N; i++){ const s = i / N; pts.push(add(lerpA(a, b, s), mul(up, amp * (1 - 0.7 * s) * Math.sin(2 * Math.PI * ((o.n || 2.2) * s - ph))))); }
    return K.poly(pts, o.w ?? 3, o.cls || 'a-band', {closed:false, d:o.d, fit:false});
  };
  K.post = (a, b, o = {}) => K.line(a, b, o.w ?? 5, 'a-fr', {d:o.d ?? -250, fit:o.fit});
  // Drążek do podciągania mocowany do ściany za plecami.
  K.pullbar = (x, y, o = {}) => {
    const wx = o.wall ?? x - 45;
    return [K.line([x, y, -60], [x, y, 60], 4, 'a-eq', {d:-5}), K.line([x, y, -60], [wx, y + 14, -60], 4, 'a-fr', {d:-260}), K.line([wx, y + 30, -60], [wx, 0, -60], 6, 'a-fr', {d:-270, fit:false})];
  };
  // Poręcze do pompek: dwa drążki wzdłuż osi X na wysokości y.
  K.pbars = (x0, x1, y, o = {}) => {
    const z = o.z ?? 24, out = [];
    for (const s of [-1, 1]){
      out.push(K.line([x0, y, s * z], [x1, y, s * z], 4.5, 'a-eq', {d:-50 + s}));
      out.push(K.line([x0 + 6, y, s * z], [x0 + 6, 0, s * z], 4, 'a-fr', {d:-260 + s}));
      out.push(K.line([x1 - 6, y, s * z], [x1 - 6, 0, s * z], 4, 'a-fr', {d:-260 + s}));
    }
    return out;
  };
  return K;
}

/* ---------- definicje ćwiczeń ---------- */
const DEFS = new Map();
function def(ids, spec){ for (const id of [].concat(ids)) DEFS.set(id, spec); }

/* ---------- silnik odtwarzania ---------- */
function phaseOf(ex, u){
  u = ((u % 1) + 1) % 1;
  if (ex.cyc) return {t:u, k:0};
  const [g, h1, b] = ex.timing || [0.42, 0.08, 0.42];
  if (u < g) return {t:u / g, k:0};
  if (u < g + h1) return {t:1, k:0, hold:true};
  if (u < g + h1 + b) return {t:1 - (u - g - h1) / b, k:1};
  return {t:0, k:1, hold:true};
}
function compile(ex){
  if (ex._c) return ex._c;
  let cur = {};
  const frames = (ex.f || []).map(f => (cur = {...cur, ...expand(f)}));
  const base = ex.base ? expand(ex.base) : null;
  const pose = t => {
    let p;
    if (ex.pose) p = expand(ex.pose(t));
    else if (ex.cyc){
      const n = frames.length, seg = ex.seg || frames.map(() => 1), tot = seg.reduce((a, b) => a + b, 0);
      let x = (((t % 1) + 1) % 1) * tot, i = 0;
      while (i < n - 1 && x >= seg[i]){ x -= seg[i]; i++; }
      const ft = Math.min(1, x / seg[i]);
      p = blend(frames[i], frames[(i + 1) % n], ex.lin ? ft : ease(ft));
    } else if (frames.length > 2){
      const n = frames.length, x = (ex.lin ? t : ease(t)) * (n - 1), i = Math.min(n - 2, Math.floor(x));
      p = blend(frames[i], frames[i + 1], x - i);
    } else p = blend(frames[0], frames[1], ex.lin ? t : ease(t));
    if (base) p = {...base, ...p};
    if (ex.mod) p = ex.mod({...p}, t) || p;
    return p;
  };
  const view = ex.view || {};
  const pr = projector(view);
  const K = makeKit(pr);
  const hl = new Set(ex.hl || []);
  const samples = ex.cyc ? [0, .0625, .125, .1875, .25, .3125, .375, .4375, .5, .5625, .625, .6875, .75, .8125, .875, .9375] : [0, .125, .25, .375, .5, .625, .75, .875, 1];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const grow = q => { minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]); };
  for (const t of samples){
    const P = solve(pose(t));
    for (const d of figure(P, pr, hl, false)) d.pts.forEach(grow);
    if (ex.props) for (const d of [].concat(...[ex.props(P, t, K)].flat(3)).filter(Boolean)) if (d.fit !== false) d.pts.forEach(grow);
  }
  const fl = pr([0, 0, 0])[1];
  if (!ex.noFloor) minY = Math.min(minY, fl - 2);
  const VW = 320, VH = 214, pad = 12;
  const bw = maxX - minX + 18, bh = maxY - minY + 18;
  const k = Math.min((VW - 2 * pad) / bw, (VH - 2 * pad) / bh, ex.maxK || 1.25);
  const cx = (minX + maxX) / 2;
  const ox = VW / 2 - cx * k;
  const oy = ex.noFloor ? VH / 2 + ((minY + maxY) / 2) * k : VH - pad - 4 + minY * k;
  const M = {k, x:q => ox + q[0] * k, y:q => oy - q[1] * k};
  let trail = null;
  if (ex.trail && !ex.cyc){
    trail = [];
    for (let i = 0; i <= 24; i++){
      const P = solve(pose(ease(i / 24)));
      const q = typeof ex.trail === 'function' ? ex.trail(P) : ex.trail === 'bar' ? lerpA(P.gripR, P.gripL, 0.5) : P[ex.trail];
      trail.push(pr(q));
    }
  }
  ex._c = {pose, pr, K, hl, M, trail, floorY:oy - fl * k, VW, VH, frames};
  return ex._c;
}
function svg(id, u = 0, opt = {}){
  const ex = DEFS.get(id); if (!ex) return '';
  const C = compile(ex);
  const {t} = opt.t != null ? {t:opt.t} : phaseOf(ex, u);
  const P = solve(C.pose(t));
  const items = [];
  if (ex.props) items.push(...[ex.props(P, t, C.K)].flat(3).filter(Boolean));
  items.push(...figure(P, C.pr, C.hl, false));
  items.sort((a, b) => a.d - b.d);
  let o = `<svg viewBox="0 0 ${C.VW} ${C.VH}" class="anim-svg" aria-hidden="true">`;
  if (!ex.noFloor){
    if ((ex.view || {}).el){ // podłoga widziana z góry: miękki cień pod postacią
      const c = [P.hipC[0], 0, P.hipC[2]];
      o += discD(C.pr, c, [0, 1, 0], ex.shadow || 70, 'a-flrf').draw(C.M);
    } else o += `<line x1="0" y1="${f1(C.floorY)}" x2="${C.VW}" y2="${f1(C.floorY)}" class="a-flr" stroke-width="2"/>`;
  }
  if (ex.ticks){ // przesuwające się znaczniki podłoża (chód w miejscu)
    const step = 40 * C.M.k, off = ((ex.ticks(t) * C.M.k) % step + step) % step;
    for (let x = -off; x < C.VW + step; x += step) o += `<line x1="${f1(x)}" y1="${f1(C.floorY + 4)}" x2="${f1(x + 10)}" y2="${f1(C.floorY + 4)}" class="a-flr" stroke-width="2"/>`;
  }
  if (opt.ghost !== false && !ex.cyc && !ex.noGhost){
    for (const gt of [0, 1]){
      const G = solve(C.pose(gt));
      o += '<g class="a-gh">' + figure(G, C.pr, C.hl, true).sort((a, b) => a.d - b.d).map(d => d.draw(C.M)).join('') + '</g>';
    }
  }
  if (C.trail && opt.trail !== false) o += `<polyline points="${C.trail.map(q => f1(C.M.x(q)) + ',' + f1(C.M.y(q))).join(' ')}" class="a-tr" fill="none" stroke-width="2"/>`;
  o += items.map(d => d.draw(C.M)).join('');
  return o + '</svg>';
}
const thumbs = new Map();
return {
  has:id => DEFS.has(id),
  ids:() => [...DEFS.keys()],
  svg,
  thumb:id => { if (!thumbs.has(id)){ const ex = DEFS.get(id); thumbs.set(id, ex ? svg(id, 0, {t:ex.thumbT ?? (ex.cyc ? 0.3 : 0.6), ghost:false, trail:false}) : ''); } return thumbs.get(id); },
  info:(id, u) => { const ex = DEFS.get(id); if (!ex) return null; const ph = phaseOf(ex, u);
    const label = ph.hold && ph.k === 0 && ex.phHold ? ex.phHold : (ex.ph || [])[ex.cyc ? 0 : ph.k] || '';
    return {label, pct:Math.round(ph.t * 100), cyc:!!ex.cyc}; },
  dur:id => (DEFS.get(id) || {}).dur || 4.8,
  _def:def, _solve:p => solve(expand(p)), _B:B,
  _withBody:(dims, fn) => { if (!dims) return fn(); const old = {...B}; Object.assign(B, dims); try { return fn(); } finally { Object.assign(B, old); } },
  _ex:id => DEFS.get(id), _kit:makeKit, _ease:ease, _phase:(id, u) => phaseOf(DEFS.get(id), u),
  _P:(id, t) => { const ex = DEFS.get(id); return solve(compile(ex).pose(t)); }, _v:{add, sub, mul, unit, lerpA, cos, sin, len, cross, dot},
};
})();
