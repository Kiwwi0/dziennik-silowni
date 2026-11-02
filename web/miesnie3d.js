// Obracany manekin 3D z mięśniami. Model: BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 JP.
// mount(host, {url, onReady}) → {set(m), view(name), dispose()}
import * as THREE from './lib/three.module.min.js';
import {GLTFLoader} from './lib/GLTFLoader.js';

const DBG = new URLSearchParams(location.search).get('dbg');
const MODELS = {};
const loadModel = url => MODELS[url] || (MODELS[url] = new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, e => { delete MODELS[url]; rej(e); })));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export function mount(host, opt = {}){
  const W = () => host.clientWidth, H = () => host.clientHeight;
  const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(W(), H());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = opt.touch || 'none';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(24, W() / H(), 0.4, 9);   // wąski zakres głębi = brak migotania
  scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f35, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(1.2, 2.2, 2.4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-1.8, 1.4, -2.2); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(-2, 0.4, 1.5); scene.add(fill);

  const pivot = new THREE.Group(); scene.add(pivot);
  const mats = {};
  const mat = (name, color, rough = 0.55, em = 0) => mats[name] = new THREE.MeshStandardMaterial({color, roughness:rough, metalness:0, emissive:color, emissiveIntensity:em, side:THREE.DoubleSide});
  const pal = () => ({muscle:css('--bm-muscle') || '#3E444B', skin:css('--bm-skin') || '#B9C0C7', p1:css('--hl') || '#E11D2E', p2:css('--hl2') || '#F49AA0', ok:css('--good') || '#15784A', low:css('--wk-low') || '#8FD3AE'});
  let C = pal();
  mat('m', C.muscle, 0.5); mat('p1', C.p1, 0.42, 0.18); mat('p2', C.p2, 0.5, 0.06); mat('skin', C.skin, 0.62); mat('bone', C.muscle, 0.6); mat('core', C.muscle, 0.6); mat('dbg', '#00FF66', 0.5); mat('h-rec', C.p1, 0.42, 0.18); mat('h-ok', C.ok, 0.45, 0.1); mat('h-low', C.low, 0.5, 0.05);
  // kolejność przy stykających się powierzchniach: skóra > mięsień pracujący > pomocniczy > zwykły > kości i wypełnienie (bez „przeskakiwania”)
  const off = (m, f, u) => { m.polygonOffset = true; m.polygonOffsetFactor = f; m.polygonOffsetUnits = u; };
  off(mats.skin, -1, -4); off(mats.p1, -1, -3); off(mats['h-rec'], -1, -3); off(mats['h-ok'], -1, -3); off(mats['h-low'], -0.5, -2); off(mats.p2, -0.5, -2); off(mats.bone, 1, 4); off(mats.core, 2, 8);
  const meshes = [];
  let state = {P:new Set(), S:new Set()};
  const apply = () => {
    for (const o of meshes){
      const k = o.userData.key;
      o.material = (DBG && k === DBG) ? mats.dbg : k === 'skin' ? mats.skin : k === 'bone' ? mats.bone : k === 'core' ? mats.core : state.heat ? (mats[state.heat[k]] || mats.m) : state.P.has(k) ? mats.p1 : state.S.has(k) ? mats.p2 : mats.m;
    }
    render();
  };
  // obrót: przeciąganie (yaw + lekkie pochylenie), przybliżanie: kółko / dwa palce
  let yaw = 0, pitch = 0.08, dist = opt.dist || 4.3, target = new THREE.Vector3(0, 0.86, 0), auto = opt.spin !== false, raf = 0;
  const place = () => {
    camera.position.set(target.x + dist * Math.sin(yaw) * Math.cos(pitch), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(target);
  };
  const render = () => { place(); renderer.render(scene, camera); };
  const ptrs = new Map(); let last = null, pinch0 = 0, dist0 = dist;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY}); auto = false; last = {x:e.clientX, y:e.clientY};
    if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = dist; } });
  el.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if (ptrs.size === 2){ const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0) zoomTo(dist0 * pinch0 / d); return; }
    if (!last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y; last = {x:e.clientX, y:e.clientY};
    yaw -= dx * 0.011; if (e.pointerType !== 'touch' || !opt.touch) pitch = Math.max(-0.6, Math.min(0.9, pitch + dy * 0.006)); render();
  });
  const up = e => { ptrs.delete(e.pointerId); last = ptrs.size === 1 ? {...[...ptrs.values()][0]} : null; if (ptrs.size < 2) pinch0 = 0; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  const zoomTo = d => { dist = Math.max(1.2, Math.min(5.2, d)); const t = (5.2 - dist) / 4; target.y = 0.86 + t * (focusY - 0.86); render(); };
  let focusY = 1.15;
  el.addEventListener('wheel', e => { e.preventDefault(); auto = false; zoomTo(dist * (1 + Math.sign(e.deltaY) * 0.12)); }, {passive:false});
  el.addEventListener('dblclick', () => { auto = false; yaw = 0; pitch = 0.08; zoomTo(4.3); });
  const tick = () => { raf = 0; if (auto){ yaw += 0.006; render(); raf = requestAnimationFrame(tick); } };
  const ro = new ResizeObserver(() => { renderer.setSize(W(), H()); camera.aspect = W() / H(); camera.updateProjectionMatrix(); render(); });
  ro.observe(host);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => { C = pal(); mats.m.color.set(C.muscle); mats.core.color.set(C.muscle); mats.bone.color.set(C.muscle); mats.skin.color.set(C.skin); mats.p1.color.set(C.p1); mats.p1.emissive.set(C.p1); mats.p2.color.set(C.p2); mats.p2.emissive.set(C.p2); for (const [k, c] of [['h-rec', C.p1], ['h-ok', C.ok], ['h-low', C.low]]){ mats[k].color.set(c); mats[k].emissive.set(c); } render(); };
  mq.addEventListener('change', theme);

  let dead = false;
  loadModel(opt.url || 'models/miesnie.glb').then(g => {
    if (dead) return;
    const sc = g.scene.clone(true);
    sc.traverse(o => { if (o.isMesh){ o.userData.key = o.userData.key || (o.name || '').split('#')[0]; meshes.push(o); } });
    pivot.add(sc);
    apply();
    if (opt.spin !== false && !reduce) raf = requestAnimationFrame(tick); else render();
    opt.onReady && opt.onReady();
  }).catch(err => { if (!dead) opt.onError && opt.onError(err); });
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  render();
  return {
    setHeat(heat){ state = {P:new Set(), S:new Set(), heat}; apply(); },
    set(m){
      const G = opt.groups || {}, ex = list => list.flatMap(k => G[k] || [k]);
      const P = new Set(ex(m.p)); state = {P, S:new Set(ex(m.s).filter(k => !P.has(k)))}; apply();
    },
    view(name){ auto = false; yaw = {front:0, back:Math.PI, left:-Math.PI / 2, right:Math.PI / 2}[name] ?? 0; pitch = 0.08; render(); },
    cam(y, p, d, ty){ auto = false; yaw = y; pitch = p; dist = d; target.y = ty; render(); },
    spin(on){ auto = on; if (on && !raf) raf = requestAnimationFrame(tick); },
    dispose(){ dead = true; cancelAnimationFrame(raf); ro.disconnect(); mq.removeEventListener('change', theme); renderer.dispose(); renderer.forceContextLoss(); el.remove(); },
  };
}
