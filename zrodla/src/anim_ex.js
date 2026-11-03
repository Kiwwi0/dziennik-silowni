/* Definicje animacji ćwiczeń. Układ: X do przodu (postać patrzy w prawo), Y w górę, Z w prawo (bliżej widza).
   Kąty segmentów w stopniach: a = kierunek w płaszczyźnie boku (90 = w górę, 0 = do przodu, -90 = w dół),
   b = odchylenie na zewnątrz od płaszczyzny boku. Ręka/noga: kąty {a, b, a2, b2} albo punkt {ik:[x, y, z]}
   (rel: 'u' = układ górnej części tułowia od barków, 't' = układ tułowia od bioder, 'sh' = przesunięcie od barku).
   Klatka 0 = pozycja startowa, klatka 1 = koniec ruchu. */
(() => {
const def = ANIM._def;
const {add, sub, mul, unit, lerpA, cos, sin} = ANIM._v;
const d2 = (a, l = 1) => [cos(a) * l, sin(a) * l, 0];
const mid = P => lerpA(P.gripR, P.gripL, 0.5);
const STAND = {torso:90, legs:{a:-90, a2:-90, b:4}, anchor:{j:'ankles', at:[0, 4]}};
const HANG = {a:-88, a2:-86, b:5, b2:5};
const HANGW = {a:-90, a2:-90, b:7, b2:7};
const SQ = ['Opuszczanie', 'Wstawanie'];
const PRESS = ['Opuszczanie', 'Wyciskanie'];
const PULL = ['Przyciąganie', 'Opuszczanie'];
const RAISE = ['Unoszenie', 'Opuszczanie'];
const CURL = ['Uginanie', 'Opuszczanie'];
const EXT = ['Prostowanie', 'Uginanie'];
const angOf = v => Math.atan2(v[1], v[0]) * 180 / Math.PI;

/* ---------- wspólne elementy sprzętu ---------- */
const seat = (K, x, top, w = 34, o = {}) => [K.box([x, top - 4, 0], [w, 8, o.z || 30], 0, 'a-pad', {d:-200}), K.post([x, top - 8, 0], [x, 0, 0], {w:6})];
const back = (K, hip, ang, l = 58, o = {}) => [K.pad(hip, ang, l, {d:-195, ...o}), K.post(add(hip, add(d2(ang, l * 0.45), d2(ang + 90, -14))), [hip[0] - 8, 0, 0], {w:5})];
const column = (K, x, z = 0, h = 205) => K.box([x, h / 2, z], [12, h, 12], 0, 'a-mach', {d:-320, fit:false});
const handles = (K, P, len = 7) => ['R', 'L'].map(s => K.line(add(P['grip' + s], [0, -len, 0]), add(P['grip' + s], [0, len, 0]), 3.5, 'a-eq', {d:K.depth(P['grip' + s]) + 0.3}));
const levers = (K, P, piv) => ['R', 'L'].map(s => K.line(P['grip' + s], [piv[0], piv[1], s === 'R' ? piv[2] : -piv[2]], 4, 'a-fr', {d:-240}));
const barLine = (K, P, ext = 8) => K.line(add(P.gripL, [0, 0, -ext]), add(P.gripR, [0, 0, ext]), 3.5, 'a-eq', {d:K.depth(mid(P)) + 0.2});
const rope = (K, P, at) => [K.line(at, P.gripR, 3, 'a-eq', {d:K.depth(P.gripR) - 0.3}), K.line(at, P.gripL, 3, 'a-eq', {d:K.depth(P.gripL) - 0.3})];

/* ================= KLATKA ================= */
const BB = {hip:[20, 53, 0], torso:180, neck:-6, legs:{ik:[64, 4, 16], pole:[0.6, 1, 0.2]}};
const flat = K => K.bench(-78, 42, 44);
def('Barbell_Bench_Press_-_Medium_Grip', {
  hl:['torso', 'ua', 'delt'], view:{yaw:22}, ph:PRESS, trail:'bar', f:[{...BB, arms:{ik:[-29, 109, 26], pole:[0.2, -0.7, 0.9]}}, {arms:{ik:[-17, 69, 26], pole:[0.2, -0.7, 0.9]}}],
  props:(P, t, K) => [flat(K), K.barbell(P)]});
const INC = {hip:[16, 52, 0], torso:145, neck:-4, legs:{ik:[60, 4, 16], pole:[0.6, 1, 0.2]}};
const incline = K => [seat(K, 22, 44, 34), back(K, [16, 52, 0], 145, 66)];
def('Barbell_Incline_Bench_Press_-_Medium_Grip', {
  hl:['torso', 'delt', 'ua'], view:{yaw:22}, ph:PRESS, trail:'bar', f:[{...INC, arms:{ik:[-25, 137, 26], pole:[0.3, -1, 0.6]}}, {arms:{ik:[-13, 89, 26], pole:[0.3, -1, 0.6]}}],
  props:(P, t, K) => [incline(K), K.barbell(P)]});
const DEC = {hip:[22, 62, 0], torso:198, neck:-2, legs:{a:38, a2:-72, b:6, f:30}};
const decline = K => [K.pad([47, 70, 0], 198, 100, {d:-195}), K.post([10, 50, 0], [10, 0, 0], {w:6}), K.post([60, 60, 0], [66, 0, 0], {w:6}),
  K.disc([69, 56, 0], [0, 0, 1], 6, 'a-pad', {d:-150}), K.post([69, 56, 0], [70, 0, 0], {w:4})];
def('Decline_Barbell_Bench_Press', {
  hl:['torso', 'ua'], view:{yaw:22}, ph:PRESS, trail:'bar', f:[{...DEC, arms:{ik:[-20, 102, 26], pole:[0.2, -1, 0.6]}}, {arms:{ik:[-17, 62, 26], pole:[0.2, -1, 0.6]}}],
  props:(P, t, K) => [decline(K), K.barbell(P)]});
def('Dumbbell_Bench_Press', {
  hl:['torso', 'ua', 'delt'], ph:PRESS, trail:'gripR', f:[{...BB, arms:{ik:[-29, 108, 28], pole:[0.1, -1, 0.5]}}, {arms:{ik:[-24, 64, 36], pole:[0.1, -1, 0.5]}}],
  props:(P, t, K) => [flat(K), K.dumbbells(P)]});
def('Incline_Dumbbell_Press', {
  hl:['torso', 'delt', 'ua'], ph:PRESS, trail:'gripR', f:[{...INC, arms:{ik:[-25, 136, 26], pole:[0.2, -1, 0.5]}}, {arms:{ik:[-17, 87, 36], pole:[0.2, -1, 0.5]}}],
  props:(P, t, K) => [incline(K), K.dumbbells(P)]});
def('Dumbbell_Flyes', {
  hl:['torso', 'delt'], ph:['Opuszczanie', 'Unoszenie'], view:{yaw:-90, el:40},
  f:[{...BB, arms:{ik:[-30, 110, 9], pole:[0, -0.3, 1]}}, {arms:{ik:[-30, 64, 70], pole:[0.1, -0.5, 1]}}],
  props:(P, t, K) => [flat(K), K.dumbbells(P, {axis:[1, 0, 0]})]});
def('Incline_Dumbbell_Flyes', {
  hl:['torso', 'delt'], ph:['Opuszczanie', 'Unoszenie'], view:{yaw:-90, el:26},
  f:[{...INC, arms:{ik:[-25, 137, 9], pole:[0, -0.3, 1]}}, {arms:{ik:[-28, 84, 70], pole:[0.1, -0.5, 1]}}],
  props:(P, t, K) => [incline(K), K.dumbbells(P, {axis:[0.8, 0.6, 0]})]});
def('Cable_Crossover', {
  hl:['torso', 'delt'], ph:['Ściąganie', 'Powrót'], view:{yaw:90, el:6},
  f:[{...STAND, torso:80, legs:{a:-90, a2:-90, b:6}, arms:{ik:[6, 140, 72], pole:[-0.4, -0.6, 1]}}, {arms:{ik:[34, 96, 5], pole:[-0.6, -0.4, 1]}}],
  props:(P, t, K) => [column(K, -10, 105), column(K, -10, -105), K.cable([-4, 186, 98], P.gripR), K.cable([-4, 186, -98], P.gripL)]});
const SEAT = {hip:[0, 50, 0], torso:92, legs:{ik:[38, 4, 16], pole:[1, 0.2, 0.1]}};
def('Butterfly', {
  hl:['torso', 'delt'], ph:['Ściąganie', 'Powrót'], view:{yaw:90, el:16},
  f:[{...SEAT, arms:{a:0, b:82, a2:90, b2:0}}, {arms:{a:0, b:14, a2:90, b2:0}}],
  props:(P, t, K) => [seat(K, -4, 44, 32), back(K, [0, 50, 0], 92, 60), ...['R', 'L'].map(s => K.line(P['elb' + s], add(P['grip' + s], [0, 6, 0]), 12, 'a-pad', {d:K.depth(P['elb' + s]) - 0.6})),
    ...['R', 'L'].map(s => K.line(add(P['grip' + s], [0, 6, 0]), [-6, 150, s === 'R' ? 22 : -22], 3.5, 'a-fr', {d:-240}))]});
def('Machine_Bench_Press', {
  hl:['torso', 'ua', 'delt'], ph:['Wypychanie', 'Powrót'],
  f:[{...SEAT, torso:96, arms:{ik:[16, 104, 26], pole:[-0.3, -1, 0.6]}}, {arms:{ik:[60, 106, 24], pole:[-0.3, -1, 0.6]}}],
  props:(P, t, K) => [seat(K, -2, 44, 34), back(K, [0, 50, 0], 96, 62), handles(K, P), levers(K, P, [-8, 150, 30]), column(K, -30)]});
{ // pompki: ciało proste, obrót wokół palców
  const pose = th => ({torso:th, legs:{a:th + 180, a2:th + 180, b:3, f:th - 90}, anchor:{j:'toeR', at:[-62, 1]}});
  const top = ANIM._solve({...pose(26), arms:{a:-90, a2:-90}});
  const hx = top.shR[0];
  def('Pushups', {
    hl:['torso', 'ua', 'delt'], ph:['Opuszczanie', 'Wypychanie'],
    f:[{...pose(26), neck:-4, arms:{ik:[hx, 3, 25], pole:[-0.6, 0.1, 0.6]}}, {...pose(7)}]});
}
const DIPS = {legs:{a:-112, a2:-150, b:3, f:-60}, arms:{ik:[2, 105, 24], pole:[-1, -0.2, 0.3]}};
def('Dips_-_Chest_Version', {
  hl:['torso', 'ua', 'delt'], ph:['Opuszczanie', 'Wypychanie'],
  f:[{...DIPS, hip:[-14, 112, 0], torso:72}, {hip:[-14, 84, 0], torso:56}], props:(P, t, K) => K.pbars(-42, 42, 105)});
def('Straight-Arm_Dumbbell_Pullover', {
  hl:['torso', 'ua'], ph:['Opuszczanie za głowę', 'Powrót'], trail:P => mid(P),
  f:[{...BB, arms:{ik:[-28, 112, 5], pole:[0, -0.2, 1]}}, {arms:{ik:[-88, 52, 5], pole:[0, 0.3, 1]}}],
  props:(P, t, K) => { const m = mid(P), fa = unit(sub(m, lerpA(P.elbR, P.elbL, 0.5))); return [flat(K), K.db(add(m, mul(fa, 7)), fa, {r:8.5})]; }});

/* ================= PLECY ================= */
const PULLBAR = (P, t, K) => K.pullbar(6, 200);
def('Pullups', {
  hl:['torso', 'ua'], ph:['Podciąganie', 'Opuszczanie'],
  f:[{hip:[-2, 96, 0], torso:88, legs:{a:-98, a2:-128, b:4, f:-50}, arms:{ik:[6, 200, 30], pole:[0.4, -1, 0.5]}}, {hip:[-8, 141, 0], torso:80, neck:12}],
  props:PULLBAR});
def('Chin-Up', {
  hl:['ua', 'torso'], ph:['Podciąganie', 'Opuszczanie'],
  f:[{hip:[-2, 96, 0], torso:88, legs:{a:-98, a2:-128, b:4, f:-50}, arms:{ik:[6, 200, 16], pole:[1, -1, 0.25]}}, {hip:[-6, 141, 0], torso:84, neck:12}],
  props:PULLBAR});
def('Band_Assisted_Pull-Up', {
  hl:['torso', 'ua'], ph:['Podciąganie', 'Opuszczanie'],
  f:[{hip:[-2, 96, 0], torso:88, legs:{a:-60, a2:-112, b:4, f:-50}, arms:{ik:[6, 200, 30], pole:[0.4, -1, 0.5]}}, {hip:[-8, 141, 0], torso:80, neck:12}],
  props:(P, t, K) => [K.pullbar(6, 200), K.poly([[6, 200, -5], add(P.kneeL, [2, -6, 0]), add(P.kneeR, [2, -6, 0]), [6, 200, 5]], 3, 'a-band', {closed:false, d:K.depth(P.kneeR) + 0.5})]});
const PDSEAT = {hip:[0, 50, 0], torso:100, legs:{a:-10, a2:-96, b:6}};
const pulldown = (P, K) => [seat(K, -2, 42, 36), K.box([25, 66, 0], [12, 9, 44], 0, 'a-pad', {d:-150}), K.post([25, 62, 0], [25, 0, 0], {w:4}),
  column(K, -40, 0, 218), K.cable([-2, 214, 0], mid(P))];
def('Wide-Grip_Lat_Pulldown', {
  hl:['torso', 'ua'], ph:['Ściąganie', 'Powrót'], view:{yaw:22},
  f:[{...PDSEAT, arms:{ik:[-4, 152, 46], pole:[0.2, -0.3, 1]}}, {torso:104, arms:{ik:[13, 104, 46], pole:[-0.3, -1, 0.8]}}],
  props:(P, t, K) => [pulldown(P, K), barLine(K, P, 12)]});
def('V-Bar_Pulldown', {
  hl:['torso', 'ua'], ph:['Ściąganie', 'Powrót'], view:{yaw:22},
  f:[{...PDSEAT, arms:{ik:[-2, 152, 6], pole:[0.4, -0.4, 0.5]}}, {torso:106, arms:{ik:[17, 104, 6], pole:[-0.4, -1, 0.5]}}],
  props:(P, t, K) => [pulldown(P, K), K.line(P.gripL, P.gripR, 3.5, 'a-eq', {d:K.depth(mid(P)) + 0.3})]});
def('Straight-Arm_Pulldown', {
  hl:['torso'], ph:['Ściąganie', 'Powrót'], view:{yaw:20},
  f:[{...STAND, torso:72, legs:{a:-82, a2:-98, b:5}, arms:{a:48, b:8, a2:50, b2:8}}, {arms:{a:-80, b:6, a2:-78, b2:6}}],
  props:(P, t, K) => [column(K, 74), K.cable([66, 196, 0], mid(P)), barLine(K, P, 6)]});
def('Bent_Over_Barbell_Row', {
  hl:['torso', 'ua'], view:{yaw:22}, ph:PULL, trail:'bar',
  f:[{...STAND, torso:38, legs:{a:-50, a2:-108, b:6}, arms:{ik:[2, -56, 9], rel:'sh', pole:[-0.3, 1, 0.3]}}, {arms:{ik:[13, 20, 24], rel:'t', pole:[-0.3, 1, 0.3]}}],
  props:(P, t, K) => K.barbell(P)});
def('Reverse_Grip_Bent-Over_Rows', {
  hl:['torso', 'ua'], view:{yaw:22}, ph:PULL, trail:'bar',
  f:[{...STAND, torso:48, legs:{a:-56, a2:-104, b:6}, arms:{ik:[2, -56, 8], rel:'sh', pole:[-0.3, 1, 0.2]}}, {arms:{ik:[12, 15, 22], rel:'t', pole:[-0.4, 1, 0.15]}}],
  props:(P, t, K) => K.barbell(P)});
const KNEEL1 = {hip:[-20, 88, 0], torso:8, legR:{ik:[-30, 4, 22], pole:[1, 0, 0.3]}, legL:{a:-90, a2:180, b:0, b2:0, f:185},
  armL:{ik:[32, 48, -16], pole:[-1, 0, 0]}};
def('One-Arm_Dumbbell_Row', {
  hl:['torso', 'uaR'], ph:PULL, trail:'gripR',
  f:[{...KNEEL1, armR:{ik:[2, -56, 5], rel:'sh', pole:[-0.3, 1, 0.2]}}, {armR:{ik:[9, 26, 18], rel:'t', pole:[-0.3, 1, 0.2]}}],
  props:(P, t, K) => [K.bench(-72, 52, 44), K.dumbbell(P, 'R', {axis:'n'})]});
def('Seated_Cable_Rows', {
  hl:['torso', 'ua'], ph:PULL,
  f:[{hip:[0, 30, 0], torso:76, legs:{ik:[70, 22, 12], pole:[0, 1, 0], f:80}, arms:{ik:[66, 76, 6], pole:[0, -1, 0.3]}},
     {torso:98, arms:{ik:[13, 24, 5], rel:'t', pole:[-1, 0, 0.5]}}],
  props:(P, t, K) => [K.box([-6, 22, 0], [52, 8, 28], 0, 'a-pad', {d:-200}), K.post([-6, 18, 0], [-6, 0, 0], {w:6}),
    K.box([79, 24, 0], [6, 30, 40], -12, 'a-pad', {d:-150}), column(K, 104, 0, 120), K.cable([98, 30, 0], mid(P)), K.line(P.gripL, P.gripR, 3.5, 'a-eq', {d:K.depth(mid(P)) + 0.3})]});
def('T-Bar_Row_with_Handle', {
  hl:['torso', 'ua'], ph:PULL,
  f:[{...STAND, torso:40, legs:{a:-52, a2:-108, b:10}, arms:{ik:[3, -56, 6], rel:'sh', pole:[-0.3, 1, 0.3]}}, {arms:{ik:[12, 22, 6], rel:'t', pole:[-0.3, 1, 0.3]}}],
  props:(P, t, K) => { const m = mid(P), piv = [-90, 3, 0], dv = unit(sub(m, piv)); const d = K.depth(m);
    return [K.line(piv, add(m, mul(dv, 22)), 4, 'a-eq', {d:d - 2}), K.disc(add(m, mul(dv, 12)), dv, 18, 'a-pl', {d:d - 1.5}), K.line(P.gripL, P.gripR, 3.5, 'a-eq', {d:d + 0.3})]; }});
def('Leverage_Iso_Row', {
  hl:['torso', 'ua'], ph:PULL,
  f:[{hip:[0, 48, 0], torso:88, legs:{ik:[34, 4, 16], pole:[1, 0.2, 0.1]}, arms:{ik:[54, 104, 20], pole:[-0.2, -1, 0.4]}}, {arms:{ik:[10, 100, 26], pole:[-1, -0.1, 0.6]}}],
  props:(P, t, K) => [seat(K, 0, 42, 32), K.box([14, 98, 0], [8, 32, 26], 0, 'a-pad', {d:-150}), K.post([14, 82, 0], [14, 44, 0], {w:4}), handles(K, P), levers(K, P, [44, 160, 24]), column(K, 60)]});
{ // podciąganie australijskie: ciało proste, pięty na podłodze
  const pose = th => ({torso:th, legs:{a:th + 180, a2:th + 180, b:3, f:th + 90}, anchor:{j:'heelR', at:[-100, 1]}, neck:-4});
  const top = ANIM._solve({...pose(40), arms:{a:-90, a2:-90}});
  const bx = top.shR[0] + 5, by = top.shR[1] + 13;
  def('Inverted_Row', {
    hl:['torso', 'ua'], ph:PULL,
    f:[{...pose(19), arms:{ik:[bx, by, 28], pole:[-0.4, -1, 0.5]}}, {...pose(40)}],
    props:(P, t, K) => [K.line([bx, by, -70], [bx, by, 70], 4, 'a-eq', {d:-5}), K.post([bx, by + 30, -70], [bx, 0, -70], {w:6, fit:false})]});
}
def('Dumbbell_Incline_Row', {
  hl:['torso', 'ua'], ph:PULL, trail:'gripR',
  f:[{hip:[0, 52, 0], torso:45, neck:10, legs:{ik:[-26, 4, 14], pole:[1, -0.2, 0]}, arms:{a:-90, a2:-90, b:6, b2:6}}, {arms:{ik:[10, 38, 22], rel:'t', pole:[-0.4, 1, 0.3]}}],
  props:(P, t, K) => [K.pad([0, 52, 0], 45, 62, {side:-1, d:-150}), K.post([10, 40, 0], [10, 0, 0], {w:6}), K.box([-8, 40, 0], [22, 7, 28], 0, 'a-pad', {d:-160}), K.dumbbells(P, {axis:'n'})]});
def('Barbell_Deadlift', {
  hl:['glute', 'thigh', 'torso'], view:{yaw:22}, ph:['Podnoszenie', 'Opuszczanie'], trail:'bar',
  f:[{...STAND, torso:30, legs:{a:-22, a2:-110, b:6}, arms:{ik:[10, 22, 24], pole:[-0.3, -1, 0]}}, {torso:92, legs:{a:-90, a2:-90, b:4}, arms:{ik:[8, 74, 24], pole:[-0.3, -1, 0]}}],
  props:(P, t, K) => K.barbell(P)});
def('Sumo_Deadlift', {
  hl:['glute', 'thigh', 'torso'], ph:['Podnoszenie', 'Opuszczanie'], view:{yaw:40, el:6},
  f:[{...STAND, torso:48, legs:{a:-38, b:34, a2:-98, b2:22}, arms:{ik:[12, 22, 15], pole:[-0.3, -1, 0]}}, {torso:92, legs:{a:-90, b:22, a2:-90, b2:22}, arms:{ik:[9, 76, 15], pole:[-0.3, -1, 0]}}],
  props:(P, t, K) => K.barbell(P)});
def('Trap_Bar_Deadlift', {
  hl:['thigh', 'glute', 'torso'], view:{yaw:22}, ph:['Podnoszenie', 'Opuszczanie'], trail:'bar',
  f:[{...STAND, torso:42, legs:{a:-30, a2:-108, b:6}, arms:{ik:[-2, 24, 30], pole:[0, -1, 0]}}, {torso:92, legs:{a:-90, a2:-90, b:4}, arms:{ik:[-2, 76, 30], pole:[0, -1, 0]}}],
  props:(P, t, K) => { const m = mid(P); return [K.barbell(P, {pz:72}), K.poly([add(m, [-24, 0, -30]), add(m, [24, 0, -30]), add(m, [24, 0, 30]), add(m, [-24, 0, 30])], 3, 'a-eq', {d:-2})]; }});
def('Hyperextensions_Back_Extensions', {
  hl:['torso', 'glute'], ph:['Prostowanie', 'Opuszczanie'],
  f:[{hip:[0, 75, 0], torso:-72, legs:{a:-135, a2:-135, b:3, f:-45}, arms:{ik:[10, -10, -6], rel:'u', pole:[0.6, -1, 0.2], prel:'u'}}, {torso:45}],
  props:(P, t, K) => [K.box([2.5, 58.3, 0], [30, 10, 30], 45, 'a-pad', {d:-150}), K.disc([-61.5, 26.2, 0], [0, 0, 1], 5.5, 'a-pad', {d:-150}),
    K.box([-58, 12, 0], [18, 4, 30], 45, 'a-env', {d:-210}), K.post([0, 52, 0], [0, 0, 0], {w:6}), K.post([-60, 12, 0], [-60, 0, 0], {w:5}), K.post([-75, 1, 0], [20, 1, 0], {w:5})]});
def('Barbell_Shrug', {
  hl:['trap', 'neck'], ph:['Unoszenie barków', 'Opuszczanie'], view:{yaw:90, el:4},
  f:[{...STAND, arms:{a:-90, a2:-90, b:4, b2:4}}, {shrug:11}], props:(P, t, K) => K.barbell(P)});
def('Dumbbell_Shrug', {
  hl:['trap', 'neck'], ph:['Unoszenie barków', 'Opuszczanie'], view:{yaw:90, el:4},
  f:[{...STAND, arms:HANGW}, {shrug:11}], props:(P, t, K) => K.dumbbells(P, {axis:'n'})});

/* ================= BARKI ================= */
def('Standing_Military_Press', {
  hl:['delt', 'ua'], view:{yaw:22}, ph:['Wyciskanie', 'Opuszczanie'], trail:'bar',
  f:[{...STAND, arms:{ik:[9, 2, 25], rel:'u', pole:[1, -1, 0.4], prel:'u'}}, {arms:{ik:[-1, 60, 24], rel:'u', pole:[0.2, -1, 0.6], prel:'u'}}],
  mod:(p, t) => { p.neck = 15 * Math.sin(Math.PI * Math.min(1, t * 1.6)); }, props:(P, t, K) => K.barbell(P)});
const SEATB = {hip:[0, 50, 0], torso:92, legs:{ik:[38, 4, 18], pole:[1, 0.2, 0.1]}};
const seatBack = K => [seat(K, -2, 43, 34), back(K, [0, 50, 0], 92, 62)];
def('Seated_Dumbbell_Press', {
  hl:['delt', 'ua'], ph:['Wyciskanie', 'Opuszczanie'], view:{yaw:30},
  f:[{...SEATB, arms:{ik:[3, 4, 36], rel:'u', pole:[0, -1, 0.8], prel:'u'}}, {arms:{ik:[0, 57, 20], rel:'u', pole:[0, -1, 0.8], prel:'u'}}],
  props:(P, t, K) => [seatBack(K), K.dumbbells(P)]});
def('Arnold_Dumbbell_Press', {
  hl:['delt', 'ua'], ph:['Obrót i wyciskanie', 'Powrót'], view:{yaw:40, el:4}, timing:[0.44, 0.06, 0.44],
  f:[{...SEATB, arms:{a:-55, b:4, a2:86, b2:0}}, {arms:{a:-20, b:75, a2:88, b2:0}}, {arms:{a:84, b:16, a2:86, b2:10}}],
  props:(P, t, K) => [seatBack(K), K.dumbbells(P)]});
def('Machine_Shoulder_Military_Press', {
  hl:['delt', 'ua'], ph:['Wyciskanie', 'Opuszczanie'],
  f:[{...SEATB, torso:94, arms:{ik:[6, 6, 30], rel:'u', pole:[0.2, -1, 0.6], prel:'u'}}, {arms:{ik:[6, 57, 26], rel:'u', pole:[0.2, -1, 0.6], prel:'u'}}],
  props:(P, t, K) => [seatBack(K), handles(K, P), levers(K, P, [-40, 140, 30]), column(K, -44)]});
def('Side_Lateral_Raise', {
  hl:['delt'], ph:RAISE, view:{yaw:90, el:6},
  f:[{...STAND, legs:{a:-90, a2:-90, b:5}, arms:{a:-90, b:9, a2:-90, b2:11}}, {arms:{a:-90, b:86, a2:-90, b2:90}}],
  props:(P, t, K) => K.dumbbells(P, {axis:[1, 0, 0]})});
def('Standing_Low-Pulley_Deltoid_Raise', {
  hl:['deltR'], ph:RAISE, view:{yaw:90, el:6},
  f:[{...STAND, legs:{a:-90, a2:-90, b:6}, armR:{ik:[12, 72, -10], pole:[0.2, -0.4, 1]}, armL:{ik:[4, 118, -50], pole:[0, -1, -0.5]}}, {armR:{a:-90, b:84, a2:-90, b2:88}}],
  props:(P, t, K) => [column(K, 0, -62), K.cable([4, 12, -56], P.gripR)]});
def('Front_Dumbbell_Raise', {
  hl:['delt'], ph:RAISE, trail:'gripR',
  f:[{...STAND, arms:{a:-86, a2:-84, b:6, b2:6}}, {arms:{a:4, a2:8, b:6, b2:6}}], props:(P, t, K) => K.dumbbells(P)});
def('Reverse_Flyes', {
  hl:['delt', 'torso'], ph:RAISE, view:{yaw:65, el:14},
  f:[{...STAND, torso:18, neck:10, legs:{a:-75, a2:-105, b:5}, arms:{a:-90, b:5, a2:-90, b2:3}}, {arms:{a:-90, b:82, a2:-90, b2:86}}],
  props:(P, t, K) => K.dumbbells(P, {axis:[1, 0, 0]})});
def('Reverse_Machine_Flyes', {
  hl:['delt', 'torso'], ph:['Odwodzenie', 'Powrót'], view:{yaw:90, el:72},
  f:[{...SEAT, arms:{a:0, b:10, a2:0, b2:10}}, {arms:{a:0, b:92, a2:0, b2:96}}],
  props:(P, t, K) => [seat(K, -2, 44, 32), K.box([14, 98, 0], [8, 34, 26], 0, 'a-pad', {d:-150}), K.post([14, 81, 0], [14, 44, 0], {w:4}), handles(K, P, 6)]});
def('Face_Pull', {
  hl:['delt', 'torso'], ph:['Przyciąganie', 'Powrót'], view:{yaw:30, el:6},
  f:[{...STAND, legs:{a:-90, a2:-90, b:6}, arms:{ik:[54, 150, 8], pole:[-0.2, -1, 0.5]}}, {arms:{ik:[6, 20, 24], rel:'u', pole:[-0.4, 0.3, 1]}}],
  props:(P, t, K) => { const at = add(mid(P), [8, 0, 0]); return [column(K, 104), K.cable([96, 152, 0], at), rope(K, P, at)]; }});
def('Upright_Barbell_Row', {
  hl:['delt', 'trap'], ph:['Podciąganie', 'Opuszczanie'], view:{yaw:28}, trail:'bar',
  f:[{...STAND, arms:{a:-88, a2:-86, b:3, b2:-2}}, {arms:{ik:[11, -3, 10], rel:'u', pole:[-0.2, 1, 1]}}], props:(P, t, K) => K.barbell(P)});
def('Band_Pull_Apart', {
  hl:['delt', 'torso'], ph:['Rozciąganie', 'Powrót'], view:{yaw:90, el:75},
  f:[{...STAND, arms:{a:0, b:10, a2:0, b2:6}}, {arms:{a:2, b:86, a2:2, b2:88}}],
  props:(P, t, K) => K.line(P.gripL, P.gripR, 3.5, 'a-band', {d:K.depth(mid(P)) + 0.5})});
def('External_Rotation_with_Cable', {
  hl:['deltR'], ph:['Rotacja na zewnątrz', 'Powrót'], view:{yaw:90, el:78},
  f:[{...STAND, armR:{a:-90, b:2, a2:0, b2:-55}, armL:HANG}, {armR:{a:-90, b:2, a2:0, b2:62}}],
  props:(P, t, K) => [column(K, 14, -88, 150), K.cable([14, 104, -80], P.gripR)]});

/* ================= BICEPS ================= */
const CURLF = [{...STAND, arms:{a:-87, a2:-84, b:5, b2:5}}, {arms:{a:-80, a2:72, b:5, b2:5}}];
def('Barbell_Curl', {hl:['ua'], view:{yaw:22}, ph:CURL, trail:'bar', f:CURLF, props:(P, t, K) => K.barbell(P, {r:12, half:62, pz:46})});
def('EZ-Bar_Curl', {hl:['ua'], view:{yaw:22}, ph:CURL, trail:'bar', f:CURLF, props:(P, t, K) => K.barbell(P, {r:11, half:56, pz:40})});
def('Dumbbell_Alternate_Bicep_Curl', {
  hl:['ua'], ph:['Uginanie naprzemienne'], cyc:true, dur:5.6, thumbT:0.25,
  f:[{...STAND, arms:{a:-87, a2:-84, b:6, b2:6}}, {armR:{a:-80, a2:72, b:6, b2:6}}, {armR:{a:-87, a2:-84, b:6, b2:6}}, {armL:{a:-80, a2:72, b:6, b2:6}}],
  props:(P, t, K) => K.dumbbells(P)});
def('Hammer_Curls', {hl:['ua', 'fa'], ph:CURL, trail:'gripR', f:[{...STAND, arms:{a:-87, a2:-84, b:7, b2:7}}, {arms:{a:-80, a2:72, b:7, b2:7}}], props:(P, t, K) => K.dumbbells(P, {axis:'n'})});
def('Incline_Dumbbell_Curl', {
  hl:['ua'], ph:CURL, trail:'gripR',
  f:[{hip:[6, 50, 0], torso:120, legs:{ik:[44, 4, 16], pole:[1, 0.2, 0.1]}, arms:{a:-94, a2:-94, b:6, b2:6}}, {arms:{a:-94, a2:62, b:6, b2:6}}],
  props:(P, t, K) => [seat(K, 10, 42, 30), back(K, [6, 50, 0], 120, 64), K.dumbbells(P)]});
def('Preacher_Curl', {
  hl:['ua'], view:{yaw:22}, ph:CURL, trail:'bar',
  f:[{hip:[-6, 52, 0], torso:82, legs:{ik:[30, 4, 16], pole:[1, 0.2, 0.1]}, arms:{a:-52, b:6, a2:-42, b2:6}}, {arms:{a:-52, b:6, a2:78, b2:6}}],
  props:(P, t, K) => [seat(K, -6, 44, 30), K.box([9, 77, 0], [34, 7, 36], -52, 'a-pad', {d:4}), K.post([10, 72, 0], [12, 0, 0], {w:5}), K.barbell(P, {r:11, half:56, pz:40})]});
def('Concentration_Curls', {
  hl:['uaR'], ph:CURL, trail:'gripR',
  f:[{hip:[0, 50, 0], torso:58, neck:-10, legR:{ik:[40, 4, 26], pole:[1, 0.2, 0.3]}, legL:{ik:[36, 4, -26], pole:[1, 0.2, -0.3]},
      armR:{a:-92, b:2, a2:-95, b2:0}, armL:{ik:[34, 50, -22], pole:[0, -1, -0.5]}}, {armR:{a:-92, b:2, a2:66, b2:0}}],
  props:(P, t, K) => [seat(K, -6, 42, 34), K.dumbbell(P, 'R')]});
def('Standing_Biceps_Cable_Curl', {
  hl:['ua'], ph:CURL, f:CURLF, view:{yaw:20}, props:(P, t, K) => [column(K, 52), K.cable([46, 12, 0], mid(P)), barLine(K, P, 6)]});

/* ================= TRICEPS ================= */
const PUSHD = [{...STAND, torso:82, legs:{a:-86, a2:-94, b:5}, arms:{a:-97, b:4, a2:22, b2:4}}, {arms:{a:-97, b:4, a2:-92, b2:4}}];
def('Triceps_Pushdown', {
  hl:['ua'], ph:['Prostowanie', 'Powrót'], trail:'bar', f:PUSHD, view:{yaw:20},
  props:(P, t, K) => [column(K, 50), K.cable([42, 198, 0], mid(P)), barLine(K, P, 7)]});
def('Triceps_Pushdown_-_Rope_Attachment', {
  hl:['ua'], ph:['Prostowanie', 'Powrót'], view:{yaw:20}, f:[PUSHD[0], {arms:{a:-97, b:4, a2:-92, b2:12}}],
  props:(P, t, K) => { const at = add(mid(P), [-2, 14, 0]); return [column(K, 50), K.cable([42, 198, 0], at), rope(K, P, at)]; }});
def('Cable_Rope_Overhead_Triceps_Extension', {
  hl:['ua'], ph:['Prostowanie', 'Uginanie'],
  f:[{torso:56, legR:{a:-70, a2:-98, b:5}, legL:{a:-114, a2:-100, b:5, f:-20}, anchor:{j:'ankles', at:[0, 4]}, arms:{a:92, b:10, a2:232, b2:6, rel:'u'}},
     {arms:{a:92, b:10, a2:96, b2:8, rel:'u'}}],
  props:(P, t, K) => { const at = add(mid(P), mul(unit(sub(mid(P), [-76, 120, 0])), -10)); return [column(K, -84), K.cable([-76, 120, 0], at), rope(K, P, at)]; }});
def('EZ-Bar_Skullcrusher', {
  hl:['ua'], view:{yaw:22}, ph:['Uginanie', 'Prostowanie'], trail:'bar',
  f:[{...BB, arms:{a:98, a2:96, b:4, b2:0}}, {arms:{a:102, a2:196, b:4, b2:0}}], props:(P, t, K) => [flat(K), K.barbell(P, {r:11, half:56, pz:40})]});
def('Standing_Dumbbell_Triceps_Extension', {
  hl:['ua'], ph:['Opuszczanie za głowę', 'Prostowanie'],
  f:[{...STAND, arms:{ik:[2, 58, 3], rel:'u', pole:[0.6, 1, 0.5], prel:'u'}}, {arms:{ik:[-14, 12, 3], rel:'u', pole:[0.6, 1, 0.5], prel:'u'}}],
  props:(P, t, K) => { const m = mid(P), ax = unit(sub(m, lerpA(P.elbR, P.elbL, 0.5))); return K.db(add(m, mul(ax, 7)), ax, {r:8.5}); }});
def('Close-Grip_Barbell_Bench_Press', {
  hl:['ua', 'torso'], view:{yaw:22}, ph:PRESS, trail:'bar', f:[{...BB, arms:{ik:[-27, 110, 13], pole:[0.6, -1, 0.2]}}, {arms:{ik:[-14, 66, 13], pole:[0.6, -1, 0.2]}}],
  props:(P, t, K) => [flat(K), K.barbell(P)]});
def('Dips_-_Triceps_Version', {
  hl:['ua'], ph:['Opuszczanie', 'Wypychanie'],
  f:[{legs:{a:-100, a2:-150, b:3, f:-60}, arms:{ik:[0, 105, 24], pole:[-1, -0.3, 0.1]}, hip:[-6, 112, 0], torso:86}, {hip:[-10, 82, 0], torso:82}],
  props:(P, t, K) => K.pbars(-42, 42, 105)});
def('Bench_Dips', {
  hl:['ua'], ph:['Opuszczanie', 'Wypychanie'],
  f:[{hip:[-16, 54, 0], torso:88, legs:{ik:[44, 4, 10], pole:[0, 1, 0], f:75}, arms:{ik:[-24, 47, 16], pole:[-1, 0, 0.2]}}, {hip:[-13, 26, 0], torso:86}],
  props:(P, t, K) => K.bench(-82, -18, 44)});
def('Tricep_Dumbbell_Kickback', {
  hl:['uaR'], ph:['Prostowanie', 'Uginanie'],
  f:[{...KNEEL1, armR:{a:-98, b:4, a2:0, b2:4, rel:'u'}}, {armR:{a:-98, b:4, a2:-96, b2:4, rel:'u'}}],
  props:(P, t, K) => [K.bench(-72, 52, 44), K.dumbbell(P, 'R', {axis:'n'})]});

/* ================= CZWOROGŁOWE ================= */
const BACKBAR = {ik:[-5, 3, 32], rel:'u', pole:[-0.5, -1, 0.4], prel:'u'};
def('Barbell_Squat', {
  hl:['thigh', 'glute'], view:{yaw:22}, ph:SQ, trail:'bar',
  f:[{...STAND, torso:86, legs:{a:-90, a2:-90, b:6, fb:16}, arms:BACKBAR}, {torso:48, legs:{a:4, a2:-122, b:16, fb:16}}], props:(P, t, K) => K.barbell(P)});
def('Front_Barbell_Squat', {
  hl:['thigh', 'glute'], view:{yaw:22}, ph:SQ, trail:'bar',
  f:[{...STAND, torso:88, arms:{ik:[10, 3, 20], rel:'u', pole:[1, 0.1, 0.35], prel:'u'}}, {torso:68, legs:{a:5, a2:-118, b:12}}], props:(P, t, K) => K.barbell(P)});
def('Goblet_Squat', {
  hl:['thigh', 'glute'], ph:SQ,
  f:[{...STAND, torso:86, arms:{ik:[15, -14, 5], rel:'u', pole:[0.3, -1, 0.5], prel:'u'}}, {torso:70, legs:{a:10, a2:-120, b:18}}],
  props:(P, t, K) => K.kettlebell(P, mid(P))});
def('Bodyweight_Squat', {
  hl:['thigh', 'glute'], ph:SQ, f:[{...STAND, arms:{a:-88, a2:-86, b:6}}, {torso:56, legs:{a:4, a2:-120, b:10}, arms:{a:0, a2:2, b:8}}]});
const lpRail = (K, hip) => { const r = d2(45), n = d2(135); return [K.line(add(add(hip, mul(r, 30)), mul(n, -14)), add(add(hip, mul(r, 122)), mul(n, -14)), 5, 'a-fr', {d:-260, fit:false}),
  K.line(add(add(hip, mul(r, 122)), mul(n, -14)), [hip[0] + 86, 0, 0], 5, 'a-fr', {d:-262, fit:false}), K.line([hip[0] - 50, 1, 0], [hip[0] + 100, 1, 0], 5, 'a-fr', {d:-264})]; };
const lpSeat = (K, hip) => [K.pad(hip, 132, 60, {d:-190}), K.box(add(hip, [6, -11, 0]), [30, 8, 30], 20, 'a-pad', {d:-195}), K.post(add(hip, [0, -14, 0]), [hip[0] - 4, 0, 0], {w:6})];
const lpPlat = (K, P) => { const c = add(lerpA(P.ankleR, P.ankleL, 0.5), add(mul(d2(45), 4), mul(d2(135), 6))); return K.box(c, [5, 48, 54], 45, 'a-pad', {d:-140}); };
const LP = {hip:[0, 40, 0], torso:132, arms:{ik:[8, 34, 28], pole:[0, -1, 0.3]}};
def('Leg_Press', {
  hl:['thigh', 'glute'], ph:['Opuszczanie platformy', 'Wypychanie'],
  f:[{...LP, legs:{ik:[52.3, 92.3, 14], pole:[-0.7, 0.7, 0], f:135}}, {legs:{ik:[31.1, 71.1, 14], pole:[-0.7, 0.7, 0], f:135}}],
  props:(P, t, K) => [lpRail(K, [0, 40, 0]), lpSeat(K, [0, 40, 0]), lpPlat(K, P)]});
def('Hack_Squat', {
  hl:['thigh', 'glute'], ph:SQ,
  f:[{hip:[-24, 84, 0], torso:112, legs:{ik:[0, 14, 12], pole:[1, 0.3, 0], f:10}, arms:{ik:[4, 6, 22], rel:'u', pole:[0.5, -1, 0.3], prel:'u'}}, {hip:[-8.8, 51.4, 0]}],
  props:(P, t, K) => [K.line([-36, 8, 0], [-36 + cos(112) * 160, 8 + sin(112) * 160, 0], 5, 'a-fr', {d:-260, fit:false}), K.pad(P.hipC, 112, 60, {d:-190}),
    K.box(add(add(P.shC, mul(P.Tu, 7)), mul(P.Fu, 2)), [14, 6, 44], 22, 'a-pad', {d:-150}), K.box([4, 8, 0], [42, 6, 50], 10, 'a-pad', {d:-150}), K.post([-30, 1, 0], [40, 1, 0], {w:5})]});
{
  const p0 = ANIM._solve({...STAND, torso:88, anchor:{j:'ankles', at:[12, 4]}, arms:BACKBAR});
  const rx = lerpA(p0.gripR, p0.gripL, 0.5)[0];
  def('Smith_Machine_Squat', {
    hl:['thigh', 'glute'], view:{yaw:22}, ph:SQ, trail:'bar',
    f:[{...STAND, torso:88, anchor:{j:'ankles', at:[12, 4]}, arms:BACKBAR}, {torso:58, legs:{a:2, a2:-118, b:10}}],
    props:(P, t, K) => [K.line([rx, 0, -66], [rx, 210, -66], 4, 'a-fr', {d:-270, fit:false}), K.barbell(P)]});
}
def('Split_Squat_with_Dumbbells', {
  hl:['thigh', 'glute'], ph:SQ,
  f:[{torso:84, anchor:{j:'ankleR', at:[0, 4]}, legR:{a:-82, a2:-96, b:4}, legL:{ik:[-72, 50, -10], pole:[0.3, -1, 0], f:-160}, arms:HANGW},
     {torso:74, legR:{a:-8, a2:-108, b:4}}],
  props:(P, t, K) => [K.bench(-104, -54, 46), K.dumbbells(P, {axis:'n'})]});
const lift = (k, a = 12, end = 0.7) => (p, t) => { if (t > 0 && t < end){ p[k] = {...p[k], ik:[p[k].ik[0], p[k].ik[1] + a * Math.sin(Math.PI * t / end), p[k].ik[2]]}; } };
const LUNGE0 = {hip:[0, 81, 0], torso:90, legR:{ik:[4, 4, 11], pole:[1, 0, 0.1]}, legL:{ik:[0, 4, -11], pole:[1, -0.2, 0]}};
const LUNGE1 = {hip:[42, 42, 0], torso:86, legR:{ik:[80, 4, 11], pole:[1, 0, 0.1]}, legL:{ik:[0, 8, -11], pole:[0.4, -1, 0], f:-45}};
def('Dumbbell_Lunges', {hl:['thigh', 'glute'], ph:['Wykrok i opuszczenie', 'Powrót'], f:[{...LUNGE0, arms:HANGW}, LUNGE1], mod:lift('legR'), props:(P, t, K) => K.dumbbells(P, {axis:'n'})});
def('Barbell_Walking_Lunge', {hl:['thigh', 'glute'], view:{yaw:22}, ph:['Wykrok i opuszczenie', 'Wstanie i krok'], f:[{...LUNGE0, arms:BACKBAR}, LUNGE1], mod:lift('legR'), props:(P, t, K) => K.barbell(P)});
def('Dumbbell_Rear_Lunge', {
  hl:['thigh', 'glute'], ph:['Wykrok w tył', 'Powrót'],
  f:[{...LUNGE0, arms:HANGW}, {hip:[-36, 42, 0], torso:84, legL:{ik:[-78, 8, -11], pole:[0.4, -1, 0], f:-45}}], mod:lift('legL'), props:(P, t, K) => K.dumbbells(P, {axis:'n'})});
def('Dumbbell_Step_Ups', {
  hl:['thigh', 'glute'], ph:['Wejście', 'Zejście'],
  f:[{hip:[10, 80, 0], torso:88, legR:{ik:[36, 46, 11], pole:[1, 0.2, 0.1]}, legL:{ik:[-4, 4, -11], pole:[1, 0, 0]}, arms:HANGW}, {hip:[34, 124, 0], legL:{ik:[30, 48, -11], pole:[1, 0, 0]}}],
  mod:lift('legL', 16, 1), props:(P, t, K) => [K.box([45, 21, 0], [56, 42, 44], 0, 'a-pad', {d:-150}), K.dumbbells(P, {axis:'n'})]});
const roller = (K, P, side, front) => { // wałek przy kostce, po stronie przedniej (front=1) albo tylnej (-1) goleni
  const d = unit(sub(P['ankle' + side], P['knee' + side])), n = front > 0 ? [-d[1], d[0], 0] : [d[1], -d[0], 0];
  return add(add(P['ankle' + side], mul(n, 8)), mul(d, -3));
};
def('Leg_Extensions', {
  hl:['thigh'], ph:['Prostowanie', 'Uginanie'],
  f:[{hip:[0, 54, 0], torso:98, legs:{a:0, a2:-102, b:4}, arms:{ik:[6, 50, 24], pole:[0, -1, 0.5]}}, {legs:{a:3, a2:4, b:4}}],
  props:(P, t, K) => { const r = roller(K, P, 'R', 1); return [seat(K, 10, 46, 46), back(K, [0, 54, 0], 98, 58), K.disc(r, [0, 0, 1], 6, 'a-pad', {d:K.depth(P.ankleR) - 0.2}),
    K.line(P.kneeR, r, 4, 'a-fr', {d:-60})]; }});

/* ================= DWUGŁOWE ================= */
def('Romanian_Deadlift', {
  hl:['thigh', 'glute'], view:{yaw:22}, ph:['Skłon', 'Prostowanie'], trail:'bar',
  f:[{...STAND, arms:{ik:[8, 76, 24], pole:[-0.3, -1, 0]}}, {torso:24, legs:{a:-55, a2:-96, b:4}, arms:{ik:[10, 40, 24], pole:[-0.3, -1, 0]}}], props:(P, t, K) => K.barbell(P)});
def('Stiff-Legged_Dumbbell_Deadlift', {
  hl:['thigh', 'glute'], ph:['Skłon', 'Prostowanie'], trail:'gripR',
  f:[{...STAND, arms:{ik:[8, 76, 20], pole:[-0.3, -1, 0]}}, {torso:12, legs:{a:-72, a2:-94, b:4}, arms:{ik:[20, 36, 20], pole:[-0.3, -1, 0]}}], props:(P, t, K) => K.dumbbells(P, {axis:'n'})});
def('Lying_Leg_Curls', {
  hl:['thigh'], ph:['Uginanie', 'Prostowanie'],
  f:[{hip:[0, 58.5, 0], torso:0, neck:18, legs:{a:180, a2:182, b:3, f:190}, arms:{ik:[58, 44, 22], pole:[-0.3, 1, 0.5]}}, {legs:{a:180, a2:72, b:3, f:162}}],
  props:(P, t, K) => { const r = roller(K, P, 'R', -1); return [K.bench(-36, 76, 50), K.disc(r, [0, 0, 1], 6, 'a-pad', {d:K.depth(P.ankleR) - 0.2}), K.line(P.kneeR, r, 4, 'a-fr', {d:-60})]; }});
def('Seated_Leg_Curl', {
  hl:['thigh'], ph:['Uginanie', 'Prostowanie'],
  f:[{hip:[0, 54, 0], torso:100, legs:{a:2, a2:-6, b:4, f:80}, arms:{ik:[8, 50, 24], pole:[0, -1, 0.5]}}, {legs:{a:2, a2:-112, b:4, f:-20}}],
  props:(P, t, K) => { const r = roller(K, P, 'R', -1); return [seat(K, 10, 46, 46), back(K, [0, 54, 0], 100, 58), K.box(add(lerpA(P.kneeR, P.kneeL, 0.5), [-9, 11, 0]), [16, 6, 40], 0, 'a-pad', {d:-140}),
    K.disc(r, [0, 0, 1], 6, 'a-pad', {d:K.depth(P.ankleR) - 0.2}), K.line(P.kneeR, r, 4, 'a-fr', {d:-60})]; }});
def('Good_Morning', {
  hl:['thigh', 'glute', 'torso'], view:{yaw:22}, ph:['Skłon', 'Prostowanie'], trail:'bar',
  f:[{...STAND, torso:88, arms:BACKBAR}, {torso:14, legs:{a:-78, a2:-97, b:4}}], props:(P, t, K) => K.barbell(P)});

/* ================= POŚLADKI ================= */
def('Barbell_Hip_Thrust', {
  hl:['glute', 'thigh'], ph:['Wypychanie bioder', 'Opuszczanie'],
  f:[{hip:[14, 18, 0], torso:147, neck:-18, legs:{ik:[62, 4, 14], pole:[0, 1, 0]}, arms:{ik:[13, 3, 26], rel:'t', pole:[0, 1, 0.5]}}, {hip:[22, 45, 0], torso:180}],
  props:(P, t, K) => [K.bench(-92, -22, 40), K.barbell(P)]});
def('Barbell_Glute_Bridge', {
  hl:['glute', 'thigh'], ph:['Unoszenie bioder', 'Opuszczanie'],
  f:[{hip:[30, 9, 0], torso:180, neck:-10, legs:{ik:[66, 4, 14], pole:[0, 1, 0]}, arms:{ik:[12, 3, 26], rel:'t', pole:[0, 1, 0.5]}}, {hip:[24, 34, 0], torso:210}],
  props:(P, t, K) => K.barbell(P)});
def('Single_Leg_Glute_Bridge', {
  hl:['glute', 'thigh'], ph:['Unoszenie bioder', 'Opuszczanie'],
  f:[{hip:[30, 9, 0], torso:180, neck:-10, legR:{ik:[64, 4, 12], pole:[0, 1, 0]}, legL:{a:28, a2:28, b:4}, arms:{a:-4, a2:-4, b:14, b2:14}}, {hip:[24, 34, 0], torso:210, legL:{a:30, a2:30, b:4}}]});
def('One-Legged_Cable_Kickback', {
  hl:['gluteR', 'thighR'], ph:['Odwodzenie w tył', 'Powrót'],
  f:[{torso:74, anchor:{j:'ankleL', at:[0, 4]}, legL:{a:-92, a2:-90, b:4}, legR:{a:-84, a2:-96, b:2}, arms:{ik:[48, 112, 20], pole:[0, -1, 0.3]}}, {legR:{a:-148, a2:-150, b:2, f:-60}}],
  props:(P, t, K) => [column(K, 72, 0, 150), K.cable([64, 10, 6], P.ankleR), K.box([66, 112, 0], [6, 6, 50], 0, 'a-fr2', {d:-200})]});
const ABD = {hip:[0, 52, 0], torso:98, arms:{ik:[2, 52, 26], pole:[0, -1, 0.5]}};
const abdProps = (inside) => (P, t, K) => [seat(K, 6, 44, 36, {z:44}), back(K, [0, 52, 0], 98, 58, {w:40}),
  ...['R', 'L'].map(s => { const sg = s === 'R' ? 1 : -1; const k = P['knee' + s]; return K.box(add(k, [3, -8, (inside ? -9 : 9) * sg]), [12, 28, 5], 0, 'a-pad', {d:K.depth(k) + (inside ? -3 : 3) * sg * 0}); })];
def('Thigh_Abductor', {
  hl:['glute', 'thigh'], ph:['Odwodzenie', 'Powrót'], view:{yaw:90, el:14},
  f:[{...ABD, legs:{a:0, b:6, a2:-90, b2:5}}, {legs:{a:0, b:36, a2:-90, b2:22}}], props:abdProps(false)});
def('Thigh_Adductor', {
  hl:['thigh'], ph:['Przywodzenie', 'Powrót'], view:{yaw:90, el:14},
  f:[{...ABD, legs:{a:0, b:36, a2:-90, b2:22}}, {legs:{a:0, b:6, a2:-90, b2:5}}], props:abdProps(true)});

/* ================= ŁYDKI ================= */
def('Standing_Calf_Raises', {
  hl:['shank'], ph:['Wspięcie', 'Opuszczanie'],
  f:[{torso:90, anchor:{j:'toeR', at:[18, 13]}, legs:{a:-90, a2:-90, b:4, f:22}, arms:{ik:[9, 10, 20], rel:'u', pole:[0.3, -1, 0.5], prel:'u'}}, {legs:{a:-90, a2:-90, b:4, f:-42}}],
  props:(P, t, K) => [K.box([21, 6, 0], [26, 12, 44], 0, 'a-pad', {d:-150}), K.box(add(P.shC, mul(P.Tu, 9)), [16, 6, 46], 0, 'a-pad', {d:-30}),
    K.line(add(P.shC, add(mul(P.Tu, 9), [0, 0, 24])), [-40, P.shC[1] + 9, 24], 4, 'a-fr', {d:-240}), column(K, -46)]});
def('Seated_Calf_Raise', {
  hl:['shank'], ph:['Wspięcie', 'Opuszczanie'],
  f:[{hip:[0, 54, 0], torso:92, legs:{ik:[28.4, 7.7, 12], pole:[1, 0.5, 0], f:25}, arms:{ik:[30, 68, 24], pole:[0, -1, 0.4]}}, {legs:{ik:[30.5, 23.6, 12], pole:[1, 0.5, 0], f:-40}, arms:{ik:[30, 76, 24], pole:[0, -1, 0.4]}}],
  props:(P, t, K) => [seat(K, 4, 46, 34), K.box([46, 7, 0], [12, 14, 40], 0, 'a-pad', {d:-150}), K.box(add(lerpA(P.kneeR, P.kneeL, 0.5), [-4, 11, 0]), [18, 6, 44], 0, 'a-pad', {d:-30})]});
def('Calf_Press_On_The_Leg_Press_Machine', {
  hl:['shank'], ph:['Wypchnięcie palcami', 'Powrót'],
  f:[{...LP, legs:{ik:[53, 93, 14], pole:[-0.7, 0.7, 0], f:135}}, {legs:{ik:[53, 93, 14], pole:[-0.7, 0.7, 0], f:98}}],
  props:(P, t, K) => { const c = add(lerpA(P.toeR, P.toeL, 0.5), mul(d2(45), 3)); return [lpRail(K, [0, 40, 0]), lpSeat(K, [0, 40, 0]), K.box(c, [5, 48, 54], 45, 'a-pad', {d:-140})]; }});

/* ================= BRZUCH ================= */
def('Plank', {
  hl:['torso'], ph:['Ustawienie', 'Powrót'], phHold:'Utrzymanie', timing:[0.28, 0.48, 0.16], dur:6,
  f:[{torso:17.5, neck:-4, anchor:{j:'elbR', at:[0, 4]}, arms:{a:-90, a2:0, b:6, b2:0}, legs:{a:197.5, a2:180, b:3, f:200}}, {torso:11.7, legs:{a:191.7, a2:191.7, b:3, f:285}}]});
def('Side_Bridge', {
  hl:['torso'], ph:['Unoszenie bioder', 'Opuszczanie'], phHold:'Utrzymanie', timing:[0.3, 0.42, 0.2], dur:6, view:{yaw:90},
  f:[{rot:[77.4, 0, 0], anchor:{j:'elbR', at:[0, 5]}, torso:90, lean:-9, armR:{a:-90, b:77.4, a2:0, b2:0}, armL:{a:-90, b:8, a2:-90, b2:8},
      legR:{a:-90, b:-9, a2:-90, b2:-9, f:0}, legL:{a:-90, b:9, a2:-90, b2:9, f:0}},
     {lean:0, legR:{a:-90, b:0, a2:-90, b2:0}, legL:{a:-90, b:0, a2:-90, b2:0}}]});
def('Crunches', {
  hl:['torso'], ph:['Spięcie', 'Opuszczanie'],
  f:[{hip:[0, 9, 0], torso:180, legs:{a:52, a2:-62, b:6}, neck:-6, arms:{ik:[-2, 15, 9], rel:'u', pole:[0.2, 0.2, 1], prel:'u'}}, {flex:34, neck:-14}]});
def('Cable_Crunch', {
  hl:['torso'], ph:['Spięcie', 'Powrót'],
  f:[{torso:82, anchor:{j:'kneeR', at:[0, 5]}, legs:{a:-88, a2:180, b:6, f:240}, arms:{ik:[5, 14, 8], rel:'u', pole:[1, -0.6, 0.4], prel:'u'}}, {torso:56, flex:56, neck:-20}],
  props:(P, t, K) => { const at = add(mid(P), [0, 10, 0]); return [column(K, 60), K.cable([52, 206, 0], at), rope(K, P, at)]; }});
def('Ab_Crunch_Machine', {
  hl:['torso'], ph:['Spięcie', 'Powrót'],
  f:[{hip:[0, 50, 0], torso:96, legs:{a:-6, a2:-96, b:5}, arms:{ik:[10, 2, 16], rel:'u', pole:[0, -1, 0.6], prel:'u'}}, {torso:82, flex:42, neck:-12}],
  props:(P, t, K) => [seat(K, 2, 42, 34), K.box(add(add(P.shC, mul(P.Fu, 13)), mul(P.Tu, -6)), [8, 26, 34], angOf(P.Tu) - 90, 'a-pad', {d:-30}), K.disc(add(P.ankleR, [5, 6, 0]), [0, 0, 1], 5, 'a-pad', {d:-140}), column(K, -30)]});
def('Hanging_Leg_Raise', {
  hl:['torso', 'thigh'], ph:['Unoszenie nóg', 'Opuszczanie'],
  f:[{hip:[0, 96, 0], torso:88, legs:{a:-92, a2:-92, b:3, f:-60}, arms:{ik:[6, 200, 28], pole:[0.3, -1, 0.5]}}, {hip:[-4, 100, 0], torso:80, flex:10, legs:{a:-2, a2:-2, b:3, f:40}}],
  props:PULLBAR});
def('Knee_Hip_Raise_On_Parallel_Bars', {
  hl:['torso', 'thigh'], ph:['Unoszenie kolan', 'Opuszczanie'],
  f:[{hip:[-4, 112, 0], torso:88, legs:{a:-92, a2:-94, b:3, f:-50}, arms:{ik:[2, 105, 24], pole:[-1, -0.2, 0.2]}}, {hip:[-6, 114, 0], torso:94, flex:16, legs:{a:28, a2:-82, b:3, f:-20}}],
  props:(P, t, K) => K.pbars(-42, 42, 105)});
def('Reverse_Crunch', {
  hl:['torso'], ph:['Podwinięcie bioder', 'Opuszczanie'],
  f:[{torso:180, anchor:{j:'shC', at:[-38, 9]}, legs:{a:90, a2:0, b:4}, arms:{a:-2, a2:-2, b:12, b2:12}}, {torso:198, flex:18, legs:{a:142, a2:52, b:4}}]});
def('Russian_Twist', {
  hl:['torso'], ph:['Skręty tułowia'], cyc:true, dur:3.2, view:{yaw:55, el:22}, thumbT:0.25,
  f:[{hip:[0, 9, 0], torso:128, legs:{a:42, a2:-24, b:6}, arms:{ik:[24, -10, 0], rel:'u', pole:[0, -1, 0.6], prel:'u'}, twist:0}, {twist:42}, {twist:0}, {twist:-42}],
  props:(P, t, K) => K.circle(add(mid(P), mul(P.Fu, 4)), 8, 'a-db', {d:K.depth(mid(P)) + 1})});
def('Ab_Roller', {
  hl:['torso'], ph:['Rozwinięcie', 'Powrót'],
  f:[{torso:33, anchor:{j:'kneeR', at:[0, 5]}, legs:{a:-60, a2:180, b:5, f:240}, arms:{ik:[24, 10, 8], pole:[0, -1, 0.3]}}, {torso:15, legs:{a:-165, a2:180, b:5, f:240}, arms:{ik:[140, 10, 8], pole:[0, -1, 0.3]}}],
  props:(P, t, K) => { const m = mid(P); return [K.disc(m, [0, 0, 1], 9.5, 'a-db', {d:K.depth(m) + 0.2}), K.line(add(m, [0, 0, -12]), add(m, [0, 0, 12]), 3, 'a-eq', {d:K.depth(m) + 0.3})]; }});
{
  const N = {hip:[0, 9, 0], torso:180, arms:{a:90, a2:90, b:6, b2:6}, legs:{a:90, a2:0, b:6}};
  def('Dead_Bug', {
    hl:['torso'], ph:['Naprzemienne prostowanie ręki i nogi'], cyc:true, dur:6, thumbT:0.25,
    f:[N, {armR:{a:172, a2:172, b:6, b2:6}, legL:{a:8, a2:8, b:6}}, {armR:N.arms, legL:N.legs}, {armL:{a:172, a2:172, b:6, b2:6}, legR:{a:8, a2:8, b:6}, armR:N.arms, legL:N.legs}]});
}
def('Pallof_Press', {
  hl:['torso'], ph:['Wypchnięcie', 'Powrót'], view:{yaw:30, el:8},
  f:[{...STAND, legs:{a:-84, a2:-96, b:12}, arms:{ik:[12, -8, 2], rel:'u', pole:[0, -1, 0.4], prel:'u'}}, {arms:{ik:[56, -6, 2], rel:'u', pole:[0, -1, 0.4], prel:'u'}}],
  props:(P, t, K) => [column(K, 12, -100, 150), K.cable([12, 112, -92], mid(P))]});
def('Mountain_Climbers', {
  hl:['torso', 'thigh'], ph:['Naprzemienne przyciąganie kolan'], cyc:true, dur:1.4,
  f:[{torso:22, anchor:{j:'gripR', at:[0, 3]}, arms:{a:-90, a2:-90, b:6, b2:6}, legR:{a:-35, a2:-160, b:3, f:-30}, legL:{a:-158, a2:-158, b:3, f:-68}},
     {legL:{a:-35, a2:-160, b:3, f:-30}, legR:{a:-158, a2:-158, b:3, f:-68}}]});

/* ================= CAŁE CIAŁO ================= */
def('One-Arm_Kettlebell_Swings', {
  hl:['glute', 'thigh', 'torso'], ph:['Wymach w górę', 'Zamach między nogi'], timing:[0.42, 0.06, 0.46], dur:2.4,
  f:[{...STAND, torso:28, legs:{a:-55, a2:-105, b:12}, armR:{a:-118, a2:-120, b:2, b2:0}, armL:{a:-105, a2:-100, b:8, b2:8}},
     {torso:94, legs:{a:-90, a2:-90, b:8}, armR:{a:-2, a2:0, b:2, b2:0}, armL:{a:-80, a2:-78, b:10, b2:10}}],
  props:(P, t, K) => K.kettlebell(P, P.gripR, sub(P.gripR, P.elbR))});
def('Farmers_Walk', {
  hl:['fa', 'trap', 'torso'], ph:['Marsz'], cyc:true, dur:1.3, ticks:t => -t * 104,
  f:[{torso:90, anchor:{j:'low', at:[0, 1]}, arms:HANGW, legR:{a:-68, a2:-84, b:4, f:12}, legL:{a:-112, a2:-126, b:4, f:-28}},
     {legL:{a:-68, a2:-84, b:4, f:12}, legR:{a:-112, a2:-126, b:4, f:-28}}],
  props:(P, t, K) => K.dumbbells(P, {axis:'n', r:9})});
def('Battling_Ropes', {
  hl:['delt', 'ua'], ph:['Naprzemienne fale'], cyc:true, dur:0.9,
  f:[{...STAND, torso:72, legs:{a:-58, a2:-112, b:10}, armR:{a:-20, a2:10, b:10, b2:10}, armL:{a:-62, a2:-40, b:10, b2:10}},
     {armL:{a:-20, a2:10, b:10, b2:10}, armR:{a:-62, a2:-40, b:10, b2:10}}],
  props:(P, t, K) => [K.wave(P.gripR, [200, 10, 12], 9, t * 2, {d:K.depth(P.gripR) - 0.5, cls:'a-eq', w:3.5}), K.wave(P.gripL, [200, 10, -12], 9, t * 2 + 0.5, {d:K.depth(P.gripL) - 0.5, cls:'a-eq', w:3.5})]});

/* ================= CARDIO ================= */
{ // bieg: cztery fazy kroku
  const F1 = {torso:82, neck:4, anchor:{j:'low', at:[0, 11]}, legR:{a:-90, a2:-96, b:3, f:0}, legL:{a:-120, a2:-178, b:3, f:-110},
    armR:{a:-100, a2:-10, b:6, b2:6}, armL:{a:-80, a2:10, b:6, b2:6}};
  const F2 = {legR:{a:-118, a2:-138, b:3, f:-40}, legL:{a:-52, a2:-128, b:3, f:-10}, armR:{a:-60, a2:30, b:6, b2:6}, armL:{a:-125, a2:-40, b:6, b2:6}};
  const sw = f => ({...f, legR:f.legL, legL:f.legR, armR:f.armL, armL:f.armR});
  def('Running_Treadmill', {
    hl:['thigh', 'shank'], ph:['Bieg'], cyc:true, dur:0.8, f:[F1, F2, sw({...F1, ...F2, ...F1}), sw({...F1, ...F2})],
    props:(P, t, K) => [K.box([0, 5, 0], [160, 10, 52], 0, 'a-pad', {d:-150}), K.box([74, 9, 0], [22, 18, 52], 0, 'a-env', {d:-160}),
      K.line([74, 14, -24], [82, 116, -24], 5, 'a-fr', {d:-250}), K.box([82, 120, 0], [12, 14, 52], 0, 'a-mach', {d:-245}), K.line([82, 108, -24], [26, 106, -24], 4, 'a-fr', {d:-250})]});
}
{ // rower: stopy na pedałach (obrót do przodu)
  const C = [26, 30, 0];
  def('Bicycling_Stationary', {
    hl:['thigh', 'shank'], ph:['Pedałowanie'], cyc:true, dur:1.4, thumbT:0.1,
    pose:t => { const th = -360 * t, pR = add(C, d2(th, 17)), pL = add(C, d2(th + 180, 17));
      return {hip:[-10, 86, 0], torso:58, neck:8, arms:{ik:[46, 104, 18], pole:[0, -1, 0.5]},
        legR:{ik:add(pR, [-4, 5, 13]), pole:[1, 0.4, 0.1], f:-18 + 12 * sin(th)}, legL:{ik:add(pL, [-4, 5, -13]), pole:[1, 0.4, -0.1], f:-18 + 12 * sin(th + 180)}}; },
    props:(P, t, K) => { const th = -360 * t, pR = add(C, d2(th, 17)), pL = add(C, d2(th + 180, 17));
      return [K.box([-12, 77, 0], [22, 4, 12], 0, 'a-pad', {d:-150}), K.line([-10, 75, 0], C, 5, 'a-fr', {d:-250}), K.line(C, [44, 70, 0], 5, 'a-fr', {d:-250}), K.line([44, 70, 0], [46, 102, 0], 5, 'a-fr', {d:-250}),
        K.line([46, 104, -20], [46, 104, 20], 4, 'a-eq', {d:-20}), K.disc([58, 36, 0], [0, 0, 1], 20, 'a-mach', {d:-255}), K.line([-34, 2, 0], [74, 2, 0], 6, 'a-fr', {d:-260}),
        K.line([-10, 75, 0], [-22, 2, 0], 5, 'a-fr', {d:-262}), K.line([58, 36, 0], [62, 2, 0], 5, 'a-fr', {d:-262}),
        K.line(add(C, [0, 0, 6]), add(pR, [0, 0, 8]), 3.5, 'a-eq', {d:K.depth(P.ankleR) - 1}), K.line(add(C, [0, 0, -6]), add(pL, [0, 0, -8]), 3.5, 'a-eq', {d:-40})]; }});
}
{ // wioślarz: przyciągnięcie (nogi, tułów, ręce) i powrót w odwrotnej kolejności
  const catchF = {hip:[38, 31, 0], torso:66, neck:6, legs:{ik:[82, 22, 10], pole:[0.2, 1, 0], f:70}, arms:{ik:[104, 48, 12], pole:[0, -1, 0.4]}};
  const driveF = {hip:[8, 31, 0], arms:{ik:[82, 54, 12], pole:[0, -1, 0.4]}};
  const finishF = {hip:[4, 31, 0], torso:112, arms:{ik:[12, 30, 8], rel:'t', pole:[-1, 0, 0.5]}};
  const recF = {hip:[6, 31, 0], torso:70, arms:{ik:[78, 54, 12], pole:[0, -1, 0.4]}};
  def('Rowing_Stationary', {
    hl:['thigh', 'torso', 'ua'], ph:['Wiosłowanie'], cyc:true, dur:2.6, seg:[0.16, 0.16, 0.22, 0.46], thumbT:0.3,
    f:[catchF, driveF, finishF, recF],
    props:(P, t, K) => [K.line([-36, 26, 0], [104, 26, 0], 5, 'a-fr', {d:-250}), K.box([P.hipC[0], 23, 0], [22, 5, 22], 0, 'a-pad', {d:-150}),
      K.box([88, 26, 0], [5, 28, 32], -35, 'a-pad', {d:-140}), K.disc([116, 44, 0], [0, 0, 1], 17, 'a-mach', {d:-255}), K.line([108, 48, 0], mid(P), 1.6, 'a-cab', {d:-20}),
      K.line(P.gripL, P.gripR, 3.5, 'a-eq', {d:K.depth(mid(P)) + 0.3}), K.line([-34, 26, 0], [-36, 0, 0], 5, 'a-fr', {d:-262}), K.line([110, 30, 0], [114, 0, 0], 5, 'a-fr', {d:-262})]});
}
{ // orbitrek: stopy po elipsie, ręce na ruchomych uchwytach
  const E = [6, 44, 0];
  def('Elliptical_Trainer', {
    hl:['thigh', 'glute'], ph:['Ruch po elipsie'], cyc:true, dur:1.6,
    pose:t => { const th = -360 * t, pr = a => add(E, [24 * cos(a), 8 * sin(a), 0]);
      return {hip:[0, 116, 0], torso:86, legR:{ik:add(pr(th), [0, 5, 12]), pole:[1, 0.2, 0.1], f:8 * sin(th)}, legL:{ik:add(pr(th + 180), [0, 5, -12]), pole:[1, 0.2, -0.1], f:8 * sin(th + 180)},
        armR:{ik:[40 + 12 * cos(th + 180), 126, 22], pole:[-0.4, -1, 0.4]}, armL:{ik:[40 + 12 * cos(th), 126, -22], pole:[-0.4, -1, -0.4]}}; },
    props:(P, t, K) => { const out = [K.box([4, 6, 0], [140, 12, 40], 0, 'a-env', {d:-260}), K.line([62, 10, 0], [56, 140, 0], 6, 'a-fr', {d:-250}), K.box([56, 144, 0], [12, 14, 40], 0, 'a-mach', {d:-245})];
      for (const s of ['R', 'L']){ const sg = s === 'R' ? 1 : -1, a = P['ankle' + s], g = P['grip' + s];
        out.push(K.box(add(a, [4, -5, 0]), [24, 3, 12], 0, 'a-pad', {d:K.depth(a) - 0.5}), K.line(add(a, [0, -6, 0]), [-56, 26, sg * 14], 4, 'a-fr', {d:sg > 0 ? -60 : -240}),
          K.line(g, [56, 62, sg * 22], 4, 'a-fr', {d:sg > 0 ? -60 : -240})); }
      return out; }});
}
{ // skakanka
  def('Rope_Jumping', {
    hl:['shank', 'thigh'], ph:['Skoki'], cyc:true, dur:0.7, view:{yaw:40, el:6}, lin:true,
    pose:t => { const h = 7 * Math.max(0, Math.sin(2 * Math.PI * t));
      return {torso:88, anchor:{j:'low', at:[0, 1 + h]}, legs:{a:-86, a2:-96, b:4, f:-20}, arms:{a:-78, b:14, a2:-18, b2:34}}; },
    props:(P, t, K) => { const ps = (-90 - 360 * (t - 0.25)), v = [cos(ps), sin(ps), 0], pts = [];
      for (let i = 0; i <= 20; i++){ const s = i / 20; pts.push(add(lerpA(P.gripL, P.gripR, s), mul(v, 88 * Math.sin(Math.PI * s)))); }
      return K.poly(pts, 2.2, 'a-eq', {closed:false, fit:false, d:v[0] > 0.2 ? 50 : -50}); }});
}
})();
