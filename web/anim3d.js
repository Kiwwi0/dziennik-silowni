/* Animacje ćwiczeń w 3D: postać-manekin z kształtem ciała, oświetleniem i cieniem.
   Ruch (pozy) liczy ANIM z anim.js/anim_ex.js; tu tylko budujemy i ustawiamy bryły.
   Użycie: const v = ANIM3D.mount(kontener, id, {primary:[...], secondary:[...]}); v.setU(0..1); v.play(); v.destroy(); */
import * as THREE from './lib/three.module.min.js';
import {loadHuman} from './anim3d_human.js';

const RAD = Math.PI / 180;
const V = a => new THREE.Vector3(a[0], a[1], a[2]);
let COL = {base:0xC9D0D8, shirt:0xC9D0D8, shorts:0x2E3946, shoe:0x30363E, p1:0xD7263D, p2:0xF0A0AA, hair:0x3A2A20, eye:0x1E2328};
const COL_MANNEQUIN = COL, COL_HUMAN = {base:0xD8A588, shirt:0x35557F, shorts:0x262F3A, shoe:0x2A2F36, p1:0xD7263D, p2:0xF0A0AA, hair:0x3A2A20, eye:0x1E2328};
const MUSCLE_KEYS = {
  'klatka piersiowa':['chest'], 'najszerszy grzbietu':['lats'], 'środek pleców':['midback'], 'prostowniki grzbietu':['lowback'],
  'kaptury':['traps'], 'barki':['delts'], 'biceps':['biceps'], 'triceps':['triceps'], 'przedramiona':['forearm'],
  'brzuch':['abs', 'obliques'], 'czworogłowe uda':['quads'], 'dwugłowe uda':['hams'], 'pośladki':['glutes'], 'łydki':['calves'],
  'przywodziciele':['adductors'], 'odwodziciele':['abductors'], 'szyja':['neck'],
};
function muscleLevels(primary = [], secondary = []){
  const m = new Map();
  for (const n of secondary) for (const k of MUSCLE_KEYS[n] || []) m.set(k, 2);
  for (const n of primary) for (const k of MUSCLE_KEYS[n] || []) m.set(k, 1);
  return m;
}
const lerp = (a, b, t) => a + (b - a) * t;
function sampleProf(prof, u){
  for (let i = 1; i < prof.length; i++) if (u <= prof[i][0]){
    const a = prof[i - 1], b = prof[i], t = (u - a[0]) / (b[0] - a[0] || 1), e = 0.5 - 0.5 * Math.cos(Math.PI * t);
    return a.slice(1).map((v, k) => lerp(v, b[k + 1], e));
  }
  return prof[prof.length - 1].slice(1);
}

/* ---------- kończyna: rura o zmiennym przekroju, oś Y od stawu bliższego, Z = przód, X = Y×Z ---------- */
function limbGeometry(len, prof, rings = 16, segs = 22){
  const pos = [], meta = [], idx = [];
  for (let i = 0; i <= rings; i++){
    const u = i / rings, [rF, rB, rS] = sampleProf(prof, u);
    for (let j = 0; j < segs; j++){
      const ph = j / segs * Math.PI * 2, s = Math.sin(ph), c = Math.cos(ph);
      pos.push(rS * s, u * len, (c >= 0 ? rF : rB) * c); meta.push([u, ph / RAD]);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++){
    const a = i * segs + j, b = i * segs + (j + 1) % segs, c = (i + 1) * segs + j, d = (i + 1) * segs + (j + 1) % segs;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  g.userData.meta = meta;
  return g;
}
function colorize(g, fn){
  const col = new Float32Array(g.userData.meta.length * 3), c = new THREE.Color();
  g.userData.meta.forEach((m, i) => { c.setHex(fn(...m)); col.set([c.r, c.g, c.b], i * 3); });
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
const PROF = {
  ua:[[0, 5.4, 5.6, 5.5], [0.18, 5.0, 5.5, 5.2], [0.45, 5.5, 5.1, 4.7], [0.78, 4.5, 4.4, 4.1], [1, 3.9, 3.9, 4.2]],
  fa:[[0, 4.0, 4.0, 4.4], [0.22, 4.5, 4.2, 4.7], [0.55, 3.5, 3.3, 3.8], [1, 2.3, 2.3, 3.0]],
  thigh:[[0, 8.4, 8.8, 8.6], [0.16, 8.6, 8.5, 8.3], [0.5, 7.6, 7.3, 7.0], [0.82, 6.1, 5.8, 5.7], [1, 5.0, 5.0, 5.3]],
  shank:[[0, 4.7, 4.8, 5.0], [0.22, 4.5, 6.1, 5.2], [0.45, 4.1, 5.3, 4.6], [0.75, 3.3, 3.4, 3.4], [1, 2.8, 2.8, 3.0]],
};
const FA_LEN = 22; // przedramię do nadgarstka (reszta do punktu chwytu to dłoń)

/* ---------- tułów: pierścienie od krocza do podstawy szyi, odkształcane z kręgosłupem ---------- */
const TORSO = [[-0.33, 6.5, 4.5, 5.5], [-0.25, 12.5, 7.5, 8.5], [-0.12, 16.5, 9.5, 11.8], [0.04, 15.6, 9.0, 10.2], [0.22, 13.6, 8.6, 8.0],
  [0.42, 14.6, 9.6, 8.6], [0.62, 16.6, 11.0, 9.2], [0.8, 18.0, 10.6, 9.2], [0.93, 18.8, 8.4, 8.4], [1.03, 15.0, 6.6, 7.8], [1.1, 8.0, 5.0, 5.6], [1.15, 5.0, 4.0, 4.4]];
const T_R = 34, T_S = 36;
function torsoRegion(s, th){
  const a = Math.abs(th);
  if (s > 0.9 && a > 70) return 'traps';
  if (s >= 0.52 && s <= 0.95 && a < 62) return 'chest';
  if (s >= -0.05 && s < 0.52 && a < 38) return 'abs';
  if (s >= -0.02 && s < 0.5 && a < 95) return 'obliques';
  if (s >= -0.33 && s < 0.03 && a >= 100) return 'glutes';
  if (s >= 0.3 && s < 0.85 && a >= 95 && a < 150) return 'lats';
  if (s >= 0.55 && s <= 0.92 && a >= 130) return 'midback';
  if (s >= 0.0 && s < 0.55 && a >= 150) return 'lowback';
  return '';
}

/* ---------- pula brył sprzętu (te same wywołania co w wersji 2D) ---------- */
function makeMaterials(){
  const M = (color, o = {}) => new THREE.MeshStandardMaterial({color, roughness:o.r ?? 0.6, metalness:o.m ?? 0});
  return {
    skin:new THREE.MeshStandardMaterial({vertexColors:true, roughness:0.58, metalness:0}),
    base:M(COL.base, {r:0.58}), shirt:M(COL.shirt, {r:0.75}), hair:M(COL.hair, {r:0.9}), eye:M(COL.eye, {r:0.3}), shorts:M(COL.shorts, {r:0.8}), shoe:M(COL.shoe, {r:0.7}), p1:M(COL.p1, {r:0.55}), p2:M(COL.p2, {r:0.55}),
    'a-eq':M(0x6B737B, {r:0.32, m:0.75}), 'a-pl':M(0x2A2F35, {r:0.75}), 'a-hub':M(0xC9CED3, {r:0.3, m:0.8}), 'a-db':M(0x353B42, {r:0.45, m:0.5}),
    'a-pad':M(0x37404B, {r:0.85}), 'a-env':M(0xA7AFB7, {r:0.4, m:0.5}), 'a-mach':M(0xD3D8DD, {r:0.6}), 'a-fr':M(0x99A1A9, {r:0.4, m:0.55}),
    'a-fr2':M(0x7C858E, {r:0.4, m:0.5}), 'a-cab':M(0x4A5158, {r:0.5}), 'a-band':M(0xE07B00, {r:0.6}), 'a-bandf':M(0xE07B00, {r:0.6}),
  };
}
const DISC_TH = {'a-pl':4.5, 'a-db':4, 'a-hub':1.2, 'a-pad':24, 'a-mach':7, 'a-fr2':3};

export function mount(host, id, opt = {}){
  const ex = ANIM._ex(id); if (!ex) return null;
  COL = opt.style === 'human' ? COL_HUMAN : COL_MANNEQUIN;
  let human = null, dims = null, ready = !opt.model, floorY = 0;
  const poseAt = t => ANIM._withBody(dims, () => ANIM._P(id, t));
  const W0 = host.clientWidth || 320;
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement; canvas.style.display = 'block'; canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.touchAction = 'none';
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1.5, 5, 5000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x737a83, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xdfe7ff, 0.55); scene.add(fill, fill.target);
  const MAT = makeMaterials();
  const floorMat = new THREE.MeshStandardMaterial({color:opt.floor || 0xE3E7EB, roughness:0.95});
  const floor = new THREE.Mesh(new THREE.CircleGeometry(260, 64), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

  /* ----- ciało ----- */
  const lv = muscleLevels(opt.primary, opt.secondary);
  const tone = k => lv.get(k) === 1 ? COL.p1 : lv.get(k) === 2 ? COL.p2 : COL.base;
  const body = new THREE.Group(); scene.add(body);
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; body.add(m); return m; };
  const sph = new THREE.SphereGeometry(1, 24, 16);
  const toneMat = k => lv.get(k) === 1 ? MAT.p1 : lv.get(k) === 2 ? MAT.p2 : MAT.base;
  // tułów (geometria odkształcana co klatkę)
  const tpos = new Float32Array((T_R * T_S + 2) * 3), tcol = new Float32Array((T_R * T_S + 2) * 3), tidx = [], tmeta = [];
  const ringS = []; for (let i = 0; i < T_R; i++) ringS.push(lerp(-0.33, 1.15, i / (T_R - 1)));
  { const c = new THREE.Color();
    for (let i = 0; i < T_R; i++) for (let j = 0; j < T_S; j++){
      const th = j / T_S * 360 - 180, s = ringS[i], k = i * T_S + j;
      const reg = torsoRegion(s, th);
      let hex = reg && lv.has(reg) ? tone(reg) : (s < 0.06 ? COL.shorts : s < 1.06 || Math.abs(th) > 90 ? COL.shirt : COL.base);
      c.setHex(hex); tcol.set([c.r, c.g, c.b], k * 3); tmeta.push([s, th]);
    }
    const cb = new THREE.Color(COL.shorts), ct = new THREE.Color(COL.base);
    tcol.set([cb.r, cb.g, cb.b], T_R * T_S * 3); tcol.set([ct.r, ct.g, ct.b], (T_R * T_S + 1) * 3);
    for (let i = 0; i < T_R - 1; i++) for (let j = 0; j < T_S; j++){
      const a = i * T_S + j, b = i * T_S + (j + 1) % T_S, c2 = (i + 1) * T_S + j, d = (i + 1) * T_S + (j + 1) % T_S;
      tidx.push(a, c2, b, b, c2, d);
    }
    const bot = T_R * T_S, top = bot + 1, L = (T_R - 1) * T_S;
    for (let j = 0; j < T_S; j++){ tidx.push(bot, j, (j + 1) % T_S); tidx.push(top, L + (j + 1) % T_S, L + j); }
  }
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3)); tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3)); tgeo.setIndex(tidx);
  const torso = new THREE.Mesh(tgeo, MAT.skin); torso.castShadow = true; torso.receiveShadow = true; body.add(torso);
  // kończyny
  const limbs = {};
  for (const side of ['R', 'L']){
    const sg = side === 'R' ? 1 : -1, ph = p => { let x = sg * p; x = ((x + 180) % 360 + 360) % 360 - 180; return x; };
    const mk = (name, len, prof, fn) => { const g = limbGeometry(len, prof); colorize(g, (u, p) => fn(u, ph(p))); return add(g, MAT.skin); };
    limbs['ua' + side] = mk('ua', 28, PROF.ua, (u, p) => { const k = Math.abs(p) < 85 ? 'biceps' : 'triceps'; return lv.has(k) ? tone(k) : u < 0.38 ? COL.shirt : COL.base; });
    limbs['fa' + side] = mk('fa', FA_LEN, PROF.fa, () => tone('forearm'));
    limbs['th' + side] = mk('th', 40, PROF.thigh, (u, p) => {
      let k;
      if (p > 55 && p < 125 && u < 0.32) k = 'abductors';
      else if (p < -55 && p > -125 && u < 0.75) k = 'adductors';
      else if (Math.abs(p) <= 80 || (p > 0 && p < 120)) k = 'quads';
      else k = 'hams';
      if (lv.has(k)) return tone(k);
      if (k === 'abductors' && lv.has('glutes')) return tone('glutes');
      return u < 0.17 ? COL.shorts : COL.base;
    });
    limbs['sh' + side] = mk('sh', 38, PROF.shank, (u, p) => Math.abs(p) > 95 && u < 0.8 ? tone('calves') : COL.base);
    limbs['delt' + side] = add(sph, lv.has('delts') ? toneMat('delts') : MAT.shirt);
    limbs['hip' + side] = add(sph, MAT.shorts);
    limbs['knee' + side] = add(sph, MAT.base);
    limbs['elb' + side] = add(sph, MAT.base);
    limbs['wr' + side] = add(sph, MAT.base);
    limbs['ank' + side] = add(sph, MAT.base);
    limbs['hand' + side] = add(sph, MAT.base);
    limbs['shoe' + side] = add(new THREE.CapsuleGeometry(1, 3, 6, 16), MAT.shoe);
  }
  const neck = add(new THREE.CylinderGeometry(1, 1.08, 1, 18, 1, true), toneMat(lv.has('neck') ? 'neck' : lv.has('traps') ? 'traps' : 'x'));
  const head = add(sph, MAT.base), nose = add(sph, MAT.base), earR = add(sph, MAT.base), earL = add(sph, MAT.base);
  const human2 = opt.style === 'human';
  const hair = human2 ? add(sph, MAT.hair) : null, eyeR = human2 ? add(sph, MAT.eye) : null, eyeL = human2 ? add(sph, MAT.eye) : null;
  const browR = human2 ? add(new THREE.BoxGeometry(1, 1, 1), MAT.hair) : null, browL = human2 ? add(new THREE.BoxGeometry(1, 1, 1), MAT.hair) : null;

  const m4 = new THREE.Matrix4(), vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3(), vt = new THREE.Vector3();
  const perp = (v, axis) => v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));
  function place(mesh, origin, y, z, sx = 1, sy = 1, sz = 1){
    vy.copy(y).normalize(); vz.copy(z).sub(vt.copy(vy).multiplyScalar(z.dot(vy))).normalize();
    if (!isFinite(vz.x) || vz.lengthSq() < 1e-6){ vz.set(0, 0, 1).sub(vt.copy(vy).multiplyScalar(vy.z)).normalize(); }
    vx.crossVectors(vy, vz);
    m4.makeBasis(vx.multiplyScalar(sx), vy.multiplyScalar(sy), vz.multiplyScalar(sz)).setPosition(origin);
    mesh.matrix.copy(m4); mesh.matrixWorldNeedsUpdate = true;
  }
  const ball = (mesh, c, r) => { mesh.matrix.makeScale(r, r, r).setPosition(c); mesh.matrixWorldNeedsUpdate = true; };
  function frontRef(axis, bendVec, fallback, sign){
    const pb = perp(bendVec, axis), w = Math.min(1, pb.length() / 8);
    const pf = perp(fallback, axis).normalize();
    return pf.multiplyScalar(1 - w).add(pb.normalize().multiplyScalar(sign * w)).normalize();
  }
  function updateBody(P){
    const F = V(P.F), T = V(P.T), S = V(P.S), Fu = V(P.Fu), Tu = V(P.Tu), Su = V(P.Su);
    const hip = V(P.hipC), mid = V(P.mid), shC = V(P.shC);
    const shrug = V(P.shR).sub(shC).dot(Tu);
    // tułów
    const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    let k = 0;
    for (let i = 0; i < T_R; i++){
      const s = ringS[i], f = sm(0.3, 0.58, s);
      const c = s <= 0.44 ? hip.clone().addScaledVector(T, s * 50) : mid.clone().addScaledVector(Tu, (s - 0.44) * 50);
      if (s > 0.75) c.addScaledVector(Tu, shrug * sm(0.75, 1.0, s) * (s > 1.06 ? 0.4 : 1));
      const Tb = T.clone().lerp(Tu, f).normalize();
      const Sb = S.clone().lerp(Su, f); Sb.sub(Tb.clone().multiplyScalar(Sb.dot(Tb))).normalize();
      const Fb = new THREE.Vector3().crossVectors(Tb, Sb);
      const [w, dF, dB] = sampleProf(TORSO, s);
      for (let j = 0; j < T_S; j++){
        const th = (j / T_S * 360 - 180) * RAD, sn = Math.sin(th), cs = Math.cos(th);
        const d = cs >= 0 ? dF * (1 + (s > 0.5 && s < 0.9 ? 0.05 * Math.cos(2 * th) : 0)) : dB;
        tpos[k++] = c.x + Sb.x * w * sn + Fb.x * d * cs; tpos[k++] = c.y + Sb.y * w * sn + Fb.y * d * cs; tpos[k++] = c.z + Sb.z * w * sn + Fb.z * d * cs;
      }
    }
    const cb = hip.clone().addScaledVector(T, -0.34 * 50), ct = mid.clone().addScaledVector(Tu, (1.16 - 0.44) * 50);
    tpos.set([cb.x, cb.y, cb.z], T_R * T_S * 3); tpos.set([ct.x, ct.y, ct.z], (T_R * T_S + 1) * 3);
    tgeo.attributes.position.needsUpdate = true; tgeo.computeVertexNormals(); tgeo.computeBoundingSphere();
    // szyja i głowa
    const neckT = V(P.neckT), hd = V(P.head), Tn = hd.clone().sub(neckT).normalize(), face = V(P.face).sub(hd).normalize();
    const nb = shC.clone().addScaledVector(Tu, -2);
    place(neck, nb.clone().lerp(neckT, 0.5).addScaledVector(Tn, 1.5), neckT.clone().sub(nb).add(Tn.clone().multiplyScalar(3)), face, 4.6, neckT.distanceTo(nb) + 3, 4.6);
    place(head, hd, Tn, face, 8.3, 10.6, 9.4);
    ball(nose, hd.clone().addScaledVector(face, 9.1).addScaledVector(Tn, -1.2), 1.7);
    ball(earR, hd.clone().addScaledVector(Su, 8.1).addScaledVector(face, -0.5), 2.1);
    ball(earL, hd.clone().addScaledVector(Su, -8.1).addScaledVector(face, -0.5), 2.1);
    if (hair){
      place(hair, hd.clone().addScaledVector(Tn, 2.4).addScaledVector(face, -1.6), Tn, face, 8.9, 9.2, 9.6);
      for (const [e, b, sg] of [[eyeR, browR, 1], [eyeL, browL, -1]]){
        ball(e, hd.clone().addScaledVector(face, 8.3).addScaledVector(Su, sg * 3.2).addScaledVector(Tn, 1.6), 1.15);
        place(b, hd.clone().addScaledVector(face, 8.5).addScaledVector(Su, sg * 3.3).addScaledVector(Tn, 4.0), Su, face, 0.9, 3.4, 0.9);
      }
    }
    for (const side of ['R', 'L']){
      const sg = side === 'R' ? 1 : -1;
      const sh = V(P['sh' + side]), el = V(P['elb' + side]), gp = V(P['grip' + side]);
      const hp = V(P['hip' + side]), kn = V(P['knee' + side]), an = V(P['ankle' + side]), toe = V(P['toe' + side]), heel = V(P['heel' + side]);
      // ręka
      const ua = el.clone().sub(sh).normalize(), fa = gp.clone().sub(el).normalize();
      const fUA = frontRef(ua, gp.clone().sub(el), Fu, 1);
      place(limbs['ua' + side], sh, ua, fUA);
      const wr = el.clone().addScaledVector(fa, FA_LEN);
      place(limbs['fa' + side], el, fa, perp(fUA, fa).lengthSq() > 1e-4 ? perp(fUA, fa) : Fu);
      ball(limbs['delt' + side], sh.clone().addScaledVector(ua, 1.6).addScaledVector(Tu, 0.6), 7.0);
      ball(limbs['elb' + side], el, 4.1); ball(limbs['wr' + side], wr, 2.9);
      place(limbs['hand' + side], gp.clone().addScaledVector(fa, -1.6), fa, perp(fUA, fa).lengthSq() > 1e-4 ? perp(fUA, fa) : Fu, 3.4, 4.6, 3.7);
      // noga
      const th = kn.clone().sub(hp).normalize(), shk = an.clone().sub(kn).normalize();
      const fTH = frontRef(th, an.clone().sub(kn), F, -1);
      place(limbs['th' + side], hp, th, fTH);
      place(limbs['sh' + side], kn, shk, perp(fTH, shk).lengthSq() > 1e-4 ? perp(fTH, shk) : F);
      ball(limbs['hip' + side], hp, 8.7); ball(limbs['knee' + side], kn, 5.1); ball(limbs['ank' + side], an, 3.1);
      const fd = toe.clone().sub(heel).normalize(), up = perp(kn.clone().sub(an), fd).normalize();
      // but: kapsuła wzdłuż stopy (oś Y), spłaszczona w pionie (oś Z = w górę od podeszwy)
      place(limbs['shoe' + side], an.clone().addScaledVector(fd, 4.5).addScaledVector(up, -2.3), fd, up, 4.1, 4.3, 3.0);
    }
  }

  /* ----- sprzęt: pula prostych brył sterowana tymi samymi definicjami co rysunek 2D ----- */
  const props = new THREE.Group(); scene.add(props);
  const GEO = {cyl:new THREE.CylinderGeometry(1, 1, 1, 14), disc:new THREE.CylinderGeometry(1, 1, 1, 36), box:new THREE.BoxGeometry(1, 1, 1), sph:new THREE.SphereGeometry(1, 18, 12)};
  const pool = {cyl:[], disc:[], box:[], sph:[]}, used = {cyl:0, disc:0, box:0, sph:0};
  const Y = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  function take(type, cls, fit){
    let m = pool[type][used[type]];
    if (!m){ m = new THREE.Mesh(GEO[type], MAT['a-fr']); m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; props.add(m); pool[type].push(m); }
    used[type]++; m.visible = true; m.material = MAT[cls] || MAT['a-fr']; m.userData.fit = fit !== false; return m;
  }
  function seg(a, b, r, cls, fit){
    const A = V(a), Bv = V(b), d = Bv.clone().sub(A), L = d.length(); if (L < 1e-6) return;
    const m = take('cyl', cls, fit); q.setFromUnitVectors(Y, d.normalize());
    m.matrix.compose(A.add(Bv).multiplyScalar(0.5), q, sc.set(r, L, r)); m.matrixWorldNeedsUpdate = true;
  }
  const K = ANIM._kit(p => [p[0], p[1], p[2]]);
  const rr = (w, cls) => cls === 'a-cab' ? 0.45 : Math.max(0.6, w / 2);
  K.line = (a, b, w, cls = 'a-fr', o = {}) => { if (floorY < -0.5 && cls !== 'a-cab'){ if (Math.abs(a[1]) < 1.5) a = [a[0], floorY, a[2]]; if (Math.abs(b[1]) < 1.5) b = [b[0], floorY, b[2]]; } seg(a, b, rr(w, cls), cls, o.fit); };
  K.poly = (pts, w, cls, o = {}) => { const n = pts.length; for (let i = 0; i < n - 1; i++) seg(pts[i], pts[i + 1], rr(w, cls), cls, o.fit); if (o.closed !== false && n > 2) seg(pts[n - 1], pts[0], rr(w, cls), cls, o.fit); };
  K.circle = (c, r, cls, o = {}) => { const m = take('sph', cls, o.fit); m.matrix.makeScale(r, r, r).setPosition(V(c)); m.matrixWorldNeedsUpdate = true; };
  K.disc = (c, n, r, cls, o = {}) => { const m = take('disc', cls, o.fit); q.setFromUnitVectors(Y, V(n).normalize()); m.matrix.compose(V(c), q, sc.set(r, DISC_TH[cls] || 3, r)); m.matrixWorldNeedsUpdate = true; };
  K.box = (c, s, rz = 0, cls = 'a-env', o = {}) => { if (floorY < -0.5 && !rz && Math.abs(c[1] - s[1] / 2) < 1.5){ s = [s[0], s[1] - floorY, s[2]]; c = [c[0], c[1] + floorY / 2, c[2]]; } const m = take('box', cls, o.fit); q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rz * RAD); m.matrix.compose(V(c), q, sc.set(s[0], s[1], s[2])); m.matrixWorldNeedsUpdate = true; };
  K.depth = () => 0;
  function updateProps(P, t){
    for (const k in used) used[k] = 0;
    if (ex.props) ex.props(P, t, K);
    for (const k in pool) for (let i = used[k]; i < pool[k].length; i++) pool[k][i].visible = false;
  }

  /* ----- tor ciężaru ----- */
  let trail = null;
  function buildTrail(){
  if (trail){ scene.remove(trail); trail = null; }
  if (ex.trail && !ex.cyc){
    const pts = [];
    for (let i = 0; i <= 30; i++){
      const P = poseAt(ANIM._ease(i / 30));
      const p = typeof ex.trail === 'function' ? ex.trail(P) : ex.trail === 'bar' ? [(P.gripR[0] + P.gripL[0]) / 2, (P.gripR[1] + P.gripL[1]) / 2, (P.gripR[2] + P.gripL[2]) / 2] : P[ex.trail];
      pts.push(V(p));
    }
    trail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({color:opt.trail || 0x1D4ED8, dashSize:2.5, gapSize:2.5}));
    trail.computeLineDistances(); scene.add(trail);
  }
  }
  buildTrail();

  /* ----- kadr: środek i promień ruchu (ze stawów postaci) ----- */
  const box = new THREE.Box3();
  const JOINTS = ['head', 'shR', 'shL', 'elbR', 'elbL', 'gripR', 'gripL', 'hipR', 'hipL', 'kneeR', 'kneeL', 'ankleR', 'ankleL', 'toeR', 'toeL', 'heelR', 'heelL'];
  function fitBox(){
    box.makeEmpty();
    for (const t of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]){
      const P = poseAt(t);
      for (const j of JOINTS){ const r = j === 'head' ? 20 : 9; box.expandByPoint(V(P[j]).addScalar(r)); box.expandByPoint(V(P[j]).addScalar(-r)); }
    }
  }
  fitBox();
  box.min.y = Math.min(box.min.y, 0);
  let center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
  let radius = Math.max(40, Math.max(size.x, size.y, size.z) * 0.62);
  const v0 = ex.view || {};
  const home = {yaw:(v0.yaw || 0) + (Math.abs(v0.yaw || 0) < 1 ? 35 : 0), el:Math.max(v0.el || 0, 10), zoom:1};
  if (opt.camera) Object.assign(home, opt.camera);
  const camState = {...home};
  sun.shadow.camera.left = -radius * 1.3; sun.shadow.camera.right = radius * 1.3; sun.shadow.camera.top = radius * 1.3; sun.shadow.camera.bottom = -radius * 1.3;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = radius * 6; sun.shadow.camera.updateProjectionMatrix();
  function placeCam(){
    const yaw = camState.yaw * RAD, el = camState.el * RAD, aspect = cam.aspect;
    const fitR = radius * (aspect < 1.3 ? 1.3 / aspect : 1);
    const dist = fitR / Math.sin(cam.fov * RAD / 2) * 0.98 * camState.zoom;
    cam.position.set(center.x + dist * Math.cos(el) * Math.sin(yaw), center.y + dist * Math.sin(el), center.z + dist * Math.cos(el) * Math.cos(yaw));
    cam.lookAt(center);
    const sy = yaw + 0.55, se = 1.12;
    sun.position.set(center.x + Math.cos(se) * Math.sin(sy) * radius * 3, center.y + Math.sin(se) * radius * 3, center.z + Math.cos(se) * Math.cos(sy) * radius * 3);
    sun.target.position.copy(center); sun.target.updateMatrixWorld();
    fill.position.set(center.x - Math.sin(yaw - 0.9) * radius * 3, center.y + radius, center.z - Math.cos(yaw - 0.9) * radius * 3); fill.target.position.copy(center); fill.target.updateMatrixWorld();
  }

  /* ----- sterowanie: przeciąganie = obrót, uszczypnięcie/kółko = przybliżenie, dwuklik = widok startowy ----- */
  const pts = new Map(); let pinch0 = 0, zoom0 = 1;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); if (pts.size === 2){ const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a[0] - b[0], a[1] - b[1]); zoom0 = camState.zoom; } });
  canvas.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1){ camState.yaw -= (e.clientX - prev[0]) * 0.45; camState.el = Math.max(-5, Math.min(85, camState.el + (e.clientY - prev[1]) * 0.35)); }
    else if (pts.size === 2 && pinch0){ const [a, b] = [...pts.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); camState.zoom = Math.max(0.35, Math.min(1.8, zoom0 * pinch0 / d)); }
    dirty = true;
  });
  const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); camState.zoom = Math.max(0.35, Math.min(1.8, camState.zoom * Math.exp(e.deltaY * 0.0012))); dirty = true; }, {passive:false});
  canvas.addEventListener('dblclick', () => { Object.assign(camState, home); dirty = true; });

  /* ----- pętla ----- */
  let u = 0, playing = !opt.paused, slow = false, raf = 0, last = performance.now(), dirty = true, alive = true;
  function resize(){
    const w = host.clientWidth || W0, h = host.clientHeight || Math.round(w * 0.72);
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); dirty = true;
  }
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  function frame(){
    const ph = ANIM._phase(id, u), P = poseAt(ph.t);
    if (human) human.update(P, ex); else updateBody(P);
    updateProps(P, ph.t); placeCam();
    renderer.render(scene, cam);
    if (opt.onFrame) opt.onFrame(ANIM.info(id, u), u);
  }
  function tick(now){
    if (!alive) return;
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (playing && !document.hidden){ u = (u + dt / (ANIM.dur(id) * (slow ? 2.4 : 1))) % 1; dirty = true; }
    if (dirty && ready){ dirty = false; frame(); }
  }
  raf = requestAnimationFrame(tick);
  if (opt.model){
    body.visible = false;
    loadHuman(opt.model, {primary:opt.primary, secondary:opt.secondary}).then(H => {
      if (!alive) return;
      human = H; dims = H.dims; scene.add(H.group);
      floorY = 4 - H.ankleAbove; floor.position.y = floorY;
      fitBox(); box.min.y = Math.min(box.min.y, floorY);
      center = box.getCenter(new THREE.Vector3()); size = box.getSize(new THREE.Vector3()); radius = Math.max(40, Math.max(size.x, size.y, size.z) * 0.62);
      buildTrail();
      ready = true; dirty = true; if (opt.onReady) opt.onReady();
    }).catch(e => { console.error(e); body.visible = true; ready = true; dirty = true; if (opt.onError) opt.onError(e); });
  }
  return {
    setU(x){ u = ((x % 1) + 1) % 1; dirty = true; },
    get u(){ return u; },
    play(){ playing = true; last = performance.now(); }, pause(){ playing = false; }, get playing(){ return playing; },
    setSlow(v){ slow = !!v; }, resetView(){ Object.assign(camState, home); dirty = true; },
    setFloor(c){ floorMat.color.setHex(c); dirty = true; },
    destroy(){ alive = false; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); canvas.remove(); },
  };
}
