/* Postać z Mixamo (szkielet „mixamorig”) sterowana tymi samymi pozami co manekin.
   Tułów i głowa: obrót kości z ramek ciała; ręce i nogi: IK dwóch kości do punktów chwytu i kostek;
   mięśnie: podświetlenie wierzchołków przypisanych do kości. */
import * as THREE from './lib/three.module.min.js';
import {GLTFLoader} from './lib/GLTFLoader.js';

const MUSCLE_KEYS = {
  'klatka piersiowa':['chest'], 'najszerszy grzbietu':['lats'], 'środek pleców':['midback'], 'prostowniki grzbietu':['lowback'],
  'kaptury':['traps'], 'barki':['delts'], 'biceps':['biceps'], 'triceps':['triceps'], 'przedramiona':['forearm'],
  'brzuch':['abs', 'obliques'], 'czworogłowe uda':['quads'], 'dwugłowe uda':['hams'], 'pośladki':['glutes'], 'łydki':['calves'],
  'przywodziciele':['adductors'], 'odwodziciele':['abductors'], 'szyja':['neck'],
};
const V = a => new THREE.Vector3(a[0], a[1], a[2]);
const unit = v => v.clone().normalize();
const perp = (v, ax) => v.clone().sub(ax.clone().multiplyScalar(v.dot(ax)));
function basisQ(a, b){ // ramka: a (główna), b (prostopadła po ortogonalizacji), c = a × b
  const A = unit(a), Bv = unit(perp(b, A)), C = new THREE.Vector3().crossVectors(A, Bv);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(A, Bv, C));
}
const delta = (a0, b0, a1, b1) => basisQ(a1, b1).multiply(basisQ(a0, b0).invert());
function ik2(A, T, l1, l2, poleDir){
  const d = T.clone().sub(A); let dist = d.length(); const dn = dist > 1e-6 ? d.clone().divideScalar(dist) : new THREE.Vector3(0, -1, 0);
  dist = Math.min(l1 + l2 - 0.01, Math.max(Math.abs(l1 - l2) + 0.01, dist));
  let pp = perp(poleDir, dn); if (pp.lengthSq() < 1e-8) pp = perp(new THREE.Vector3(0, 0, 1), dn); pp.normalize();
  const a = (l1 * l1 + dist * dist - l2 * l2) / (2 * dist), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  return {mid:A.clone().addScaledVector(dn, a).addScaledVector(pp, h), end:A.clone().addScaledVector(dn, dist)};
}

// Nazwy kości: Mixamo („mixamorigLeftArm”) albo 3ds Max Biped z biblioteki Rocketbox („Bip01_L_UpperArm”).
const BIPED = {Pelvis:'Hips', Spine:'Spine', Spine1:'Spine1', Spine2:'Spine2', Neck:'Neck', Head:'Head', Clavicle:'Shoulder', UpperArm:'Arm', Forearm:'ForeArm', Hand:'Hand',
  Thigh:'UpLeg', Calf:'Leg', Foot:'Foot', Toe0:'ToeBase'};
const FING = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
function canon(name){
  if (/mixamorig/.test(name)) return name.replace(/^.*mixamorig\d*[:_]?/, '');
  const m = name.match(/^Bip01[_ ](?:([LR])[_ ])?(.+)$/); if (!m) return null;
  const side = m[1] === 'L' ? 'Left' : m[1] === 'R' ? 'Right' : '', rest = m[2];
  const f = rest.match(/^Finger(\d)(\d?)$/);
  if (f) return side + 'Hand' + FING[+f[1]] + (f[2] === '' ? 1 : +f[2] + 1);
  const b = BIPED[rest]; if (!b) return null;
  return side ? side + b : b;
}
export async function loadHuman(url, opt = {}){
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene, holder = new THREE.Group(); holder.add(root);
  root.updateMatrixWorld(true);
  const bones = {};
  root.traverse(o => { if (o.isBone){ const n = canon(o.name); if (n && !bones[n]) bones[n] = o; } });
  const need = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
  for (const n of need) if (!bones[n]) throw new Error('Brak kości ' + n);
  const wp = b => b.getWorldPosition(new THREE.Vector3());
  // skala: udo postaci = 40 jednostek animacji
  const s = 40 / wp(bones.LeftLeg).distanceTo(wp(bones.LeftUpLeg));
  holder.scale.setScalar(s); holder.updateMatrixWorld(true);
  const R = {}; // stan spoczynkowy (T-pose) każdej kości
  for (const [n, b] of Object.entries(bones)) R[n] = {lq:b.quaternion.clone(), lp:b.position.clone(), wq:b.getWorldQuaternion(new THREE.Quaternion()), wp:wp(b)};
  for (const b of Object.values(bones)) if (!R[b.name]) {}
  const P0 = n => R[n].wp;
  const mid = (a, b) => P0(a).clone().add(P0(b)).multiplyScalar(0.5);
  const toe = bones.LeftToeBase ? P0('LeftToeBase') : P0('LeftFoot').clone().add(new THREE.Vector3(0, -5, 10));
  let fwd0 = toe.clone().sub(P0('LeftFoot')); fwd0.y = 0; fwd0.normalize();
  let left0 = P0('LeftUpLeg').clone().sub(P0('RightUpLeg')); left0.y = 0; left0.normalize();
  const up0 = new THREE.Vector3().crossVectors(fwd0, left0).normalize();
  left0 = new THREE.Vector3().crossVectors(up0, fwd0).normalize();
  // wymiary ciała dla solvera póz (w jednostkach animacji)
  const handLen = bones.LeftHandMiddle1 ? P0('LeftHandMiddle1').distanceTo(P0('LeftHand')) : 8;
  const hipMid = mid('LeftUpLeg', 'RightUpLeg'), shMid = mid('LeftArm', 'RightArm');
  const torso = shMid.distanceTo(hipMid);
  const dims = {thigh:40, shank:P0('LeftFoot').distanceTo(P0('LeftLeg')), ua:P0('LeftForeArm').distanceTo(P0('LeftArm')),
    fa:P0('LeftHand').distanceTo(P0('LeftForeArm')) + handLen * 0.8, sh:P0('LeftArm').distanceTo(P0('RightArm')) / 2,
    hp:P0('LeftUpLeg').distanceTo(P0('RightUpLeg')) / 2, lumbar:torso * 0.44, thor:torso * 0.56,
    neck:Math.max(3, (P0('Head').clone().sub(shMid)).dot(up0) * 0.55), head:10.5};
  const handOff = handLen * 0.8;
  const ankleH = P0('LeftFoot').clone().sub(new THREE.Vector3()).dot(up0) - Math.min(...root.children.length ? [0] : [0]);
  // wysokość kostki nad podeszwą w pozycji spoczynkowej (najniższy punkt siatki)
  const box = new THREE.Box3().setFromObject(root);
  const soleY = box.min.y, ankleAbove = P0('LeftFoot').y - soleY;
  const hipsOff = P0('Hips').clone().sub(hipMid);

  // ----- podświetlenie mięśni na skórze -----
  const lv = new Map();
  for (const n of opt.secondary || []) for (const k of MUSCLE_KEYS[n] || []) lv.set(k, 2);
  for (const n of opt.primary || []) for (const k of MUSCLE_KEYS[n] || []) lv.set(k, 1);
  const right0 = left0.clone().negate();
  const torsoRegion = (sv, th) => {
    const a = Math.abs(th);
    if (sv > 0.9 && a > 70) return 'traps';
    if (sv >= 0.5 && sv <= 0.98 && a < 62) return 'chest';
    if (sv >= -0.05 && sv < 0.5 && a < 38) return 'abs';
    if (sv >= -0.02 && sv < 0.5 && a < 95) return 'obliques';
    if (sv < 0.05 && a >= 100) return 'glutes';
    if (sv >= 0.3 && sv < 0.85 && a >= 95 && a < 150) return 'lats';
    if (sv >= 0.55 && sv <= 0.95 && a >= 130) return 'midback';
    if (sv >= 0.0 && sv < 0.55 && a >= 150) return 'lowback';
    return '';
  };
  const limbRegion = (bn, v) => {
    const side = bn.startsWith('Left') ? 'Left' : 'Right', sg = side === 'Left' ? 1 : -1, base = bn.slice(side.length);
    const chain = {UpLeg:['UpLeg', 'Leg'], Leg:['Leg', 'Foot'], Arm:['Arm', 'ForeArm'], ForeArm:['ForeArm', 'Hand'], Shoulder:['Shoulder', 'Arm']}[base];
    if (!chain) return '';
    const A = P0(side + chain[0]), Bp = P0(side + chain[1]), ax = unit(Bp.clone().sub(A));
    const u = v.clone().sub(A).dot(ax) / Bp.distanceTo(A);
    const r = perp(v.clone().sub(A), ax); if (r.lengthSq() < 1e-6) return '';
    const fr = unit(perp(fwd0, ax)), lat = unit(perp(left0.clone().multiplyScalar(sg), ax));
    const ph = Math.atan2(r.dot(lat), r.dot(fr)) * 180 / Math.PI; // 0 = przód, +90 = na zewnątrz
    if (base === 'UpLeg'){
      if (u < 0.12 && Math.abs(ph) > 100) return 'glutes';
      if (ph > 60 && ph < 120 && u < 0.28 && lv.has('abductors')) return 'abductors';
      if (ph < -50 && ph > -130 && u < 0.78) return 'adductors';
      return Math.abs(ph) < 108 ? 'quads' : 'hams';
    }
    if (base === 'Leg') return Math.abs(ph) > 95 && u < 0.8 ? 'calves' : '';
    if (base === 'Arm') return u < 0.28 ? 'delts' : (Math.abs(ph) < 85 ? 'biceps' : 'triceps');
    if (base === 'ForeArm') return 'forearm';
    if (base === 'Shoulder') return v.clone().sub(A).dot(up0) > 0 && u < 0.5 ? 'traps' : 'delts';
    return '';
  };
  const boneName = b => canon(b.name) || '';
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const g = o.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const N = pos.count, w1 = new Float32Array(N), w2 = new Float32Array(N), v = new THREE.Vector3();
    if (lv.size) for (let i = 0; i < N; i++){
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++){ const w = sw.getComponent(i, k); if (w > bw){ bw = w; best = si.getComponent(i, k); } }
      const bn = boneName(o.skeleton.bones[best]);
      v.fromBufferAttribute(pos, i); o.applyBoneTransform(i, v); v.applyMatrix4(o.matrixWorld);
      let reg = '';
      if (/^(Hips|Spine\d?)$/.test(bn)){
        const sv = v.clone().sub(hipMid).dot(up0) / torso, c = hipMid.clone().addScaledVector(up0, v.clone().sub(hipMid).dot(up0));
        const r = v.clone().sub(c); const th = Math.atan2(r.dot(right0), r.dot(fwd0)) * 180 / Math.PI;
        reg = torsoRegion(sv, th);
      } else if (bn === 'Neck') reg = lv.has('neck') ? 'neck' : (v.clone().sub(P0('Neck')).dot(fwd0) < 0 ? 'traps' : '');
      else reg = limbRegion(bn, v);
      const L = reg ? lv.get(reg) : 0;
      if (L === 1) w1[i] = 1; else if (L === 2) w2[i] = 1;
    }
    // wygładzenie granic: łączymy wierzchołki o tej samej pozycji i uśredniamy z sąsiadami
    if (lv.size && g.index){
      const key = new Map(), grp = new Int32Array(N);
      for (let i = 0; i < N; i++){ const k = Math.round(pos.getX(i) * 200) + ',' + Math.round(pos.getY(i) * 200) + ',' + Math.round(pos.getZ(i) * 200); if (!key.has(k)) key.set(k, key.size); grp[i] = key.get(k); }
      const G = key.size, nb = Array.from({length:G}, () => new Set()), idx = g.index.array;
      for (let t = 0; t < idx.length; t += 3){ const a = grp[idx[t]], b = grp[idx[t + 1]], c = grp[idx[t + 2]]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); }
      let g1 = new Float32Array(G), g2 = new Float32Array(G), cnt = new Float32Array(G);
      for (let i = 0; i < N; i++){ g1[grp[i]] += w1[i]; g2[grp[i]] += w2[i]; cnt[grp[i]]++; }
      for (let k = 0; k < G; k++){ g1[k] /= cnt[k]; g2[k] /= cnt[k]; }
      for (let it = 0; it < 3; it++){
        const n1 = new Float32Array(G), n2 = new Float32Array(G);
        for (let k = 0; k < G; k++){ let a = 0, b = 0; for (const j of nb[k]){ a += g1[j]; b += g2[j]; } const m = nb[k].size || 1; n1[k] = 0.5 * g1[k] + 0.5 * a / m; n2[k] = 0.5 * g2[k] + 0.5 * b / m; }
        g1 = n1; g2 = n2;
      }
      for (let i = 0; i < N; i++){ w1[i] = g1[grp[i]]; w2[i] = g2[grp[i]]; }
    }
    const hl = new Float32Array(N * 2); for (let i = 0; i < N; i++){ hl[i * 2] = w1[i]; hl[i * 2 + 1] = w2[i]; }
    g.setAttribute('hl', new THREE.BufferAttribute(hl, 2));
    const mats = [].concat(o.material).map(m => {
      const c = m.clone();
      c.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hl;\nvarying vec2 vHl;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHl = hl;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHl;')
          .replace('#include <map_fragment>', '#include <map_fragment>\nfloat h1 = smoothstep(0.15, 0.6, vHl.x), h2 = smoothstep(0.15, 0.6, vHl.y) * (1.0 - h1);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.07, 0.10), h1 * 0.88);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.94, 0.45, 0.42), h2 * 0.66);');
      };
      return c;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });

  // ----- palce: zaciśnięcie pięści -----
  const curl = (side, amount) => {
    const sg = side === 'Left' ? -1 : 1;
    for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) for (const k of [1, 2, 3]){
      const b = bones[side + 'Hand' + f + k]; if (!b) continue;
      const ax = fwd0.clone().applyQuaternion(R[side + 'Hand' + f + k].wq.clone().invert()).normalize();
      b.quaternion.copy(R[side + 'Hand' + f + k].lq).multiply(new THREE.Quaternion().setFromAxisAngle(ax, sg * amount * (k === 1 ? 0.9 : 1.05)));
    }
    for (const k of [1, 2, 3]){
      const b = bones[side + 'HandThumb' + k]; if (!b) continue;
      const ax = up0.clone().applyQuaternion(R[side + 'HandThumb' + k].wq.clone().invert()).normalize();
      b.quaternion.copy(R[side + 'HandThumb' + k].lq).multiply(new THREE.Quaternion().setFromAxisAngle(ax, -sg * amount * 0.35));
    }
  };

  // ----- ustawianie kości -----
  const setWorldQ = (n, q) => { const b = bones[n]; const pq = b.parent.getWorldQuaternion(new THREE.Quaternion()); b.quaternion.copy(pq.invert().multiply(q)); b.updateMatrixWorld(true); };
  const frame0 = basisQ(up0, fwd0); // ramka modelu: (góra, przód)
  const trunkQ = (up, fw) => basisQ(up, fw).multiply(frame0.clone().invert());
  function update(P, ex){
    for (const [n, b] of Object.entries(bones)){ b.quaternion.copy(R[n].lq); b.position.copy(R[n].lp); }
    holder.updateMatrixWorld(true);
    const F = V(P.F), T = V(P.T), Fu = V(P.Fu), Tu = V(P.Tu);
    // miednica
    const Qp = trunkQ(T, F);
    bones.Hips.quaternion.copy(bones.Hips.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(Qp.clone().multiply(R.Hips.wq)));
    const hipW = V(P.hipC).add(hipsOff.clone().applyQuaternion(Qp));
    bones.Hips.position.copy(bones.Hips.parent.worldToLocal(hipW.clone()));
    bones.Hips.updateMatrixWorld(true);
    // kręgosłup: przejście od ramki miednicy do ramki klatki
    [['Spine', 0.3], ['Spine1', 0.65], ['Spine2', 1]].forEach(([n, w]) => {
      const up = T.clone().lerp(Tu, w).normalize(), fw = F.clone().lerp(Fu, w).normalize();
      setWorldQ(n, trunkQ(up, fw).multiply(R[n].wq));
    });
    // barki przy wzruszaniu: niewielkie uniesienie obojczyków
    const shrug = V(P.shR).sub(V(P.shC)).dot(Tu);
    for (const side of ['Left', 'Right']){
      const n = side + 'Shoulder'; if (!bones[n] || Math.abs(shrug) < 0.3) continue;
      const sg = side === 'Left' ? 1 : -1, ax = fwd0.clone().applyQuaternion(R[n].wq.clone().invert()).normalize();
      bones[n].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, sg * Math.atan2(shrug, 15))); bones[n].updateMatrixWorld(true);
    }
    // szyja i głowa
    const hd = V(P.head), Tn = unit(hd.clone().sub(V(P.neckT))), face = unit(V(P.face).sub(hd));
    setWorldQ('Neck', trunkQ(Tu.clone().lerp(Tn, 0.5).normalize(), Fu.clone().lerp(face, 0.5).normalize()).multiply(R.Neck.wq));
    setWorldQ('Head', trunkQ(Tn, face).multiply(R.Head.wq));
    // ręce: IK do punktu chwytu, łokieć w stronę łokcia z animacji
    for (const [side, my] of [['Left', 'L'], ['Right', 'R']]){
      const A = wp(bones[side + 'Arm']), grip = V(P['grip' + my]), el = V(P['elb' + my]);
      const faDir = unit(grip.clone().sub(el)), W = grip.clone().addScaledVector(faDir, -handOff);
      const l1 = R[side + 'ForeArm'].wp.distanceTo(R[side + 'Arm'].wp), l2 = R[side + 'Hand'].wp.distanceTo(R[side + 'ForeArm'].wp);
      const {mid:E, end:Wr} = ik2(A, W, l1, l2, el.clone().sub(A.clone().add(W).multiplyScalar(0.5)));
      const d1 = unit(E.clone().sub(A)), bend = perp(Wr.clone().sub(E), d1);
      const fr1 = bend.lengthSq() > 1 ? unit(bend) : unit(perp(Fu, d1));
      const d0 = unit(R[side + 'ForeArm'].wp.clone().sub(R[side + 'Arm'].wp));
      setWorldQ(side + 'Arm', delta(d0, fwd0, d1, fr1).multiply(R[side + 'Arm'].wq));
      const d0f = unit(R[side + 'Hand'].wp.clone().sub(R[side + 'ForeArm'].wp)), d1f = unit(Wr.clone().sub(wp(bones[side + 'ForeArm'])));
      let qf = delta(d0f, fwd0, d1f, perp(fr1, d1f).lengthSq() > 1e-6 ? perp(fr1, d1f) : fr1);
      const tw = (ex.grip === 'sup' ? -1 : ex.grip === 'neut' ? 0 : 1) * (side === 'Left' ? 1 : -1) * Math.PI / 2;
      if (tw) qf = new THREE.Quaternion().setFromAxisAngle(d1f, tw).multiply(qf);
      setWorldQ(side + 'ForeArm', qf.multiply(R[side + 'ForeArm'].wq));
      curl(side, ex.hands === 'open' ? 0.15 : 1.25);
    }
    // nogi: IK do kostek, kolano w stronę kolana z animacji
    for (const [side, my] of [['Left', 'L'], ['Right', 'R']]){
      const A = wp(bones[side + 'UpLeg']), an = V(P['ankle' + my]), kn = V(P['knee' + my]);
      const l1 = R[side + 'Leg'].wp.distanceTo(R[side + 'UpLeg'].wp), l2 = R[side + 'Foot'].wp.distanceTo(R[side + 'Leg'].wp);
      const {mid:K, end:Ak} = ik2(A, an, l1, l2, kn.clone().sub(A.clone().add(an).multiplyScalar(0.5)));
      const d1 = unit(K.clone().sub(A)), bend = perp(Ak.clone().sub(K), d1);
      const fr1 = bend.lengthSq() > 1 ? unit(bend).negate() : unit(perp(F, d1));
      const d0 = unit(R[side + 'Leg'].wp.clone().sub(R[side + 'UpLeg'].wp));
      setWorldQ(side + 'UpLeg', delta(d0, fwd0, d1, fr1).multiply(R[side + 'UpLeg'].wq));
      const d0s = unit(R[side + 'Foot'].wp.clone().sub(R[side + 'Leg'].wp)), d1s = unit(Ak.clone().sub(wp(bones[side + 'Leg'])));
      setWorldQ(side + 'Leg', delta(d0s, fwd0, d1s, perp(fr1, d1s).lengthSq() > 1e-6 ? perp(fr1, d1s) : fr1).multiply(R[side + 'Leg'].wq));
      // stopa: przód stopy i kierunek „w górę” z animacji
      const fd = unit(V(P['toe' + my]).sub(V(P['heel' + my]))), upf = unit(perp(kn.clone().sub(an), fd));
      setWorldQ(side + 'Foot', basisQ(upf, fd).multiply(basisQ(up0, fwd0).invert()).multiply(R[side + 'Foot'].wq));
    }
  }
  return {group:holder, dims, update, ankleAbove, scale:s};
}
