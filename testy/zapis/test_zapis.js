// Testy logiki zapisu planów i treningów (A6): zrodla/src/zapis.js na sztucznych danych, bez przeglądarki i bez Firebase.
// Uruchomienie z katalogu repozytorium:  node testy/zapis/test_zapis.js
// Sztuczny „serwer” odtwarza zachowanie setDoc(…, {mergeFields}) z deleteField(); prawdziwego Firebase ten test NIE sprawdza.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const ZP = require(path.join(__dirname, '..', '..', 'zrodla', 'src', 'zapis.js'));

const cl = v => JSON.parse(JSON.stringify(v));
const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sort(v[k]), o), {}) : v;
const clock = {t:1000};
const tick = n => (clock.t += n || 10);

/* ---------- sztuczny serwer ---------- */
class Serwer {
  constructor(){ this.doc = null; this.zapisy = []; }
  get(){ return this.doc ? sort(cl(this.doc)) : null; }   // jak Firestore: klucze map posortowane
  setPath(obj, parts, val){
    for (let i = 0; i < parts.length - 1; i++){ obj[parts[i]] = obj[parts[i]] && typeof obj[parts[i]] === 'object' ? obj[parts[i]] : {}; obj = obj[parts[i]]; }
    const k = parts[parts.length - 1];
    if (val && val.__del) delete obj[k]; else obj[k] = cl(val);
  }
  merge(data, fields){   // setDoc(ref, data, {mergeFields:fields})
    this.zapisy.push({fields:fields.slice()});
    if (!this.doc) this.doc = {};
    for (const f of fields){
      let v = data; for (const p of f.split('.')) v = v == null ? undefined : v[p];
      assert.notEqual(v, undefined, 'pole ' + f + ' z mergeFields nie ma wartości w data');
      this.setPath(this.doc, f.split('.'), v);
    }
  }
  setFull(doc){ this.zapisy.push({full:true}); this.doc = cl(doc); }
  mirrorTx(p){   // transakcja lustra: p = ZP.mirrorPatch(dokument odczytany w tej samej transakcji)
    if (p.action === 'set'){ this.zapisy.push({mirror:true}); this.doc.plans = cl(p.plans); this.doc.custom = cl(p.custom); }
    else if (p.action === 'drop'){ this.zapisy.push({mirror:'drop'}); delete this.doc.plans; delete this.doc.custom; }
  }
}

/* ---------- sztuczne urządzenie: robi to samo, co będzie robić aplikacja (S jako tablice, kolejka, odczyt, zapis) ---------- */
const blank = () => ({plans:[], custom:[], settings:{restSet:90, sound:true}});
const plan = (id, name, extra) => ({id, name, items:[{id:'i1', exId:'ex1', mode:'reps', sets:[{reps:10, kg:20}]}], ...extra});
class Urz {
  get now(){ return clock.t + this.off; }                                    // zegar urządzenia (off = przesunięcie względem wspólnego zegara testu)
  constructor(nazwa, serwer, S){
    this.nazwa = nazwa; this.off = 0; this.sv = serwer; this.S = S || blank(); this.z = ZP.newZ(); this.last = ZP.snap(this.S);
    this.online = true; this.outbox = []; this.lay = 'empty'; this.tombs = {pt:{}, ct:{}}; this.fail = false; this.notes = []; this.repaired = 0;
  }
  edit(fn){ fn(this.S); this.last = ZP.diff(this.last, this.S, this.z.q, this.now, this.z.kn); }
  odbierz(){
    const doc = this.sv.get(), lay = ZP.layout(doc);
    this.lay = lay; if (lay === 'empty') return [];
    let R;
    if (lay === 'v3'){ R = ZP.remoteV3(doc); this.z.kn.v3 = true; ZP.rememberTombs(this.z.kn, doc, this.now); this.tombs = ZP.tombInfo(doc); }
    else if (ZP.holdDoc(doc)) R = ZP.remoteHold();       // nieznany kształt: jak w aplikacji, dokument nie jest „pusty”
    else R = ZP.remoteOld({plans:doc.plans || [], custom:doc.custom || [], settings:{...blank().settings, ...(doc.settings || {})}}, this.z.kn.v3, {pt:this.z.kn.pt, ct:this.z.kn.ct});
    const mg = ZP.merge(this.S, this.z.q, this.z.kn, R, this.now);
    this.S = mg.S; this.z.q = mg.q; this.z.kn = mg.kn; this.last = ZP.snap(this.S);
    if (lay === 'v3') ZP.checkMirror(doc, this.S, this.z.q, this.now);
    this.notes.push(...mg.notes);
    return mg.notes;
  }
  wyslij(){
    if (ZP.emptyQ(this.z.q) || this.fail) return false;
    if (this.lay === 'v3'){
      const bw = ZP.buildWrite(this.S, this.z.q, this.now, {tombs:this.tombs});
      if (!bw) return this.online && this.lustro();
      if (!this.online){ this.outbox.push(bw); return true; }          // SDK trzyma zapis, aż wróci sieć
      this.sv.merge(bw.data, bw.fields); ZP.afterSend(this.z, bw.sent, undefined, this.now); this.lustro(); return true;
    }
    if (!this.online) return false;                                       // migracja = transakcja, wymaga sieci
    const tx = ZP.migrate(this.S, this.z, this.sv.get(), this.now, doc => ({plans:doc.plans || [], custom:doc.custom || [], settings:{...blank().settings, ...(doc.settings || {})}}));
    if (tx.hold) return false;                                            // dokument nietypowy: migracja wstrzymana, zmiany czekają w kolejce
    if (tx.noop){ this.z.q.f = 0; this.lay = 'v3'; return this.wyslij(); }        // ktoś już naprawił: zwykły zapis
    this.sv.setFull(tx.doc); ZP.afterSend(this.z, tx.sent, tx.written); this.lay = 'v3'; if (tx.repaired) this.repaired++;
    return true;
  }
  /* lustro starego układu: osobna transakcja, która czyta dokument i zapisuje lustro tylko, gdy dokument ma `full` */
  lustro(){
    if (!this.z.q.m) return false;
    const m = this.z.q.m; this.sv.mirrorTx(ZP.mirrorPatch(this.sv.get())); ZP.afterMirror(this.z, m); return true;
  }
  wracaSiec(){ this.online = true; for (const bw of this.outbox.splice(0)){ this.sv.merge(bw.data, bw.fields); ZP.afterSend(this.z, bw.sent, undefined, this.now); } this.lustro(); }
}
const ids = S => S.plans.map(p => p.id);
const byId = (S, id) => S.plans.find(p => p.id === id);
/* ustaw wszystkie urządzenia: odbiór, wysyłka, aż nic się nie zmienia (jak nasłuch + flush w aplikacji) */
function uspokoj(...ds){
  for (let i = 0; i < 12; i++){
    let ruch = false;
    for (const d of ds){ const n0 = JSON.stringify([d.S, d.z.q]); d.odbierz(); const w = d.wyslij(); if (w || JSON.stringify([d.S, d.z.q]) !== n0) ruch = true; }
    if (!ruch) return;
  }
  throw new Error('nie uspokoiło się po 12 rundach');
}
/* konto po migracji: dwa urządzenia z planami P1, P2 i ustawieniami */
function konto(){
  const sv = new Serwer(), S0 = () => ({plans:[plan('P1', 'Plan A'), plan('P2', 'Plan B')], custom:[{id:'C1', name:'Moje', custom:true}], settings:{restSet:90, sound:true}});
  sv.doc = {v:2, ...S0()};                                                  // stary układ w bazie
  const tel = new Urz('telefon', sv, S0()), lap = new Urz('laptop', sv, S0());
  tel.odbierz(); lap.odbierz();                                             // widzą stary układ
  tel.edit(S => { S.settings.sound = false; }); tick();                    // pierwszy zapis = migracja
  uspokoj(tel, lap);
  assert.equal(ZP.layout(sv.doc), 'v3'); assert.equal(tel.lay, 'v3'); assert.equal(lap.lay, 'v3');
  return {sv, tel, lap};
}

let n = 0, bledy = 0;
function test(nazwa, fn){
  try { fn(); n++; console.log('  ok  ' + nazwa); }
  catch (e){ bledy++; console.log('  BŁĄD  ' + nazwa + '\n' + String(e.stack).split('\n').slice(0, 6).join('\n')); }
}

/* ======================= plany ======================= */
test('1. dwa urządzenia zmieniają RÓŻNE plany (telefon bez sieci) – obie zmiany zostają (E1-09)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { byId(S, 'P1').name = 'Plan A – telefon'; }); tel.wyslij(); tick();
  lap.edit(S => { byId(S, 'P2').name = 'Plan B – laptop'; }); lap.wyslij(); tick();
  uspokoj(lap);                                                              // telefon jeszcze offline
  tel.odbierz();                                                             // telefon widzi zmianę laptopa nawet z lokalną, niewysłaną zmianą
  assert.equal(byId(tel.S, 'P2').name, 'Plan B – laptop', 'zmiana planu B z laptopa nie może być pomijana');
  assert.equal(byId(tel.S, 'P1').name, 'Plan A – telefon');
  tel.wracaSiec(); uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.equal(byId(d.S, 'P1').name, 'Plan A – telefon'); assert.equal(byId(d.S, 'P2').name, 'Plan B – laptop'); }
  assert.equal(sv.doc.pm.P1.name, 'Plan A – telefon'); assert.equal(sv.doc.pm.P2.name, 'Plan B – laptop');
  assert.deepEqual(sv.doc.plans.map(p => p.name), ['Plan A – telefon', 'Plan B – laptop'], 'lustro w starym układzie ma obie zmiany');
});

test('2a. ten sam plan: wygrywa późniejsza zmiana (późniejsza dociera do bazy pierwsza)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { byId(S, 'P1').name = 'wcześniejsza (telefon)'; }); tel.wyslij(); tick(50);
  lap.edit(S => { byId(S, 'P1').name = 'późniejsza (laptop)'; }); lap.wyslij(); tick();
  tel.wracaSiec();                                                           // wcześniejszy zapis dochodzi do bazy OSTATNI i ją nadpisuje
  assert.equal(sv.doc.pm.P1.name, 'wcześniejsza (telefon)');
  uspokoj(tel, lap);                                                         // samo-naprawa: laptop zna nowszą wersję i ją odtwarza
  for (const d of [tel, lap]) assert.equal(byId(d.S, 'P1').name, 'późniejsza (laptop)');
  assert.equal(sv.doc.pm.P1.name, 'późniejsza (laptop)');
});

test('2b. ten sam plan: wygrywa późniejsza zmiana (późniejsza zapisana offline, dociera po wcześniejszej)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  lap.edit(S => { byId(S, 'P1').name = 'wcześniejsza (laptop)'; }); lap.wyslij(); tick(50);
  tel.edit(S => { byId(S, 'P1').name = 'późniejsza (telefon)'; }); tel.wyslij(); tick();
  tel.odbierz();                                                             // telefon: lokalna czekająca zmiana późniejsza niż ta z bazy – zostaje
  assert.equal(byId(tel.S, 'P1').name, 'późniejsza (telefon)');
  tel.wracaSiec(); uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.equal(byId(d.S, 'P1').name, 'późniejsza (telefon)');
});

test('2c. czekająca lokalna zmiana WCZEŚNIEJSZA niż ta z bazy przegrywa dla swojego planu (reszta z bazy)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { byId(S, 'P1').name = 'stara lokalna'; }); tick(50);
  lap.edit(S => { byId(S, 'P1').name = 'nowsza z laptopa'; byId(S, 'P2').name = 'B z laptopa'; }); lap.wyslij(); tick();
  const notes = tel.odbierz();
  assert.equal(byId(tel.S, 'P1').name, 'nowsza z laptopa'); assert.equal(byId(tel.S, 'P2').name, 'B z laptopa');
  assert.ok(notes.some(x => x.t === 'remote-later' && x.id === 'P1'));
  assert.equal(tel.z.q.p.P1, undefined, 'przegrana zmiana wychodzi z kolejki');
});

test('3a. edycja WCZEŚNIEJSZA niż usunięcie: plan zostaje usunięty', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { byId(S, 'P2').name = 'edycja offline'; }); tel.wyslij(); tick(50);
  lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick();
  assert.ok(sv.doc.pt.P2 > 0, 'jest nagrobek'); assert.equal(sv.doc.pm.P2, undefined);
  tel.wracaSiec(); uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.deepEqual(ids(d.S), ['P1']);
});

test('3b. edycja PÓŹNIEJSZA niż usunięcie: plan zostaje (nowsza zmiana wygrywa)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick(50);
  tel.edit(S => { byId(S, 'P2').name = 'edycja po usunięciu'; }); tel.wyslij(); tick();
  tel.wracaSiec(); uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.deepEqual(ids(d.S).sort(), ['P1', 'P2']); assert.equal(byId(d.S, 'P2').name, 'edycja po usunięciu'); }
});

test('4. usunięcie planu na jednym urządzeniu NIE wskrzesza go z drugiego (bez zmian na drugim)', () => {
  const {sv, tel, lap} = konto();
  lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick();
  uspokoj(tel, lap);
  assert.deepEqual(ids(tel.S), ['P1']); assert.deepEqual(ids(lap.S), ['P1']); assert.deepEqual(sv.doc.plans.map(p => p.id), ['P1']);
  // telefon zmienia INNY plan i wysyła – usunięty nie wraca
  tel.edit(S => { byId(S, 'P1').name = 'tylko A'; }); tel.wyslij(); tick(); uspokoj(tel, lap);
  assert.deepEqual(ids(lap.S), ['P1']); assert.equal(sv.doc.pm.P2, undefined);
  // telefon po długiej przerwie (offline) nie przywraca usuniętego planu przy powrocie
  tel.online = false; tel.edit(S => { S.settings.sound = true; }); tel.wyslij(); tel.wracaSiec(); uspokoj(tel, lap);
  assert.deepEqual(ids(tel.S), ['P1']);
});

test('4b. dodanie planu na dwóch urządzeniach naraz: oba plany są (kolejność nie gubi żadnego)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { S.plans.push(plan('PT', 'z telefonu')); }); tel.wyslij(); tick();
  lap.edit(S => { S.plans.push(plan('PL', 'z laptopa')); }); lap.wyslij(); tick();
  tel.wracaSiec(); uspokoj(tel, lap);
  assert.deepEqual(ids(tel.S).sort(), ['P1', 'P2', 'PL', 'PT']); assert.deepEqual(ids(tel.S), ids(lap.S), 'ta sama kolejność na obu');
});

test('5. zmiana kolejności planów i różne ustawienia z dwóch urządzeń', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { S.plans.reverse(); S.settings.restSet = 120; }); tel.wyslij(); tick();
  lap.edit(S => { S.settings.sound = true; S.settings.bar = 15; }); lap.wyslij(); tick();
  tel.wracaSiec(); uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.deepEqual(ids(d.S), ['P2', 'P1']); assert.equal(d.S.settings.restSet, 120); assert.equal(d.S.settings.sound, true); assert.equal(d.S.settings.bar, 15); }
});

test('5b. samo edytowanie planu nie rusza kolejności w bazie (pola po/pos poza zapisem)', () => {
  const {sv, tel} = konto();
  tel.edit(S => { byId(S, 'P1').name = 'x'; }); const bw = ZP.buildWrite(tel.S, tel.z.q, clock.t, {});
  assert.ok(bw.fields.includes('pm.P1')); assert.ok(!bw.fields.includes('po') && !bw.fields.includes('pos'));
  assert.ok(!bw.fields.includes('plans') && !bw.fields.includes('custom'), 'lustro starego układu NIE idzie w zwykłym zapisie (osobna transakcja z kontrolą full, A6b-3)');
  assert.ok(bw.sent.mir, 'po udanym zapisie lustro trafia do kolejki jako odświeżenie');
  assert.deepEqual(bw.fields.filter(f => f.startsWith('pm.')), ['pm.P1'], 'wysyłamy tylko zmienioną pozycję');
  assert.equal(ZP.buildWrite(tel.S, ZP.emptyQueue(), clock.t, {}), null, 'bez zmian nic nie idzie do bazy');
});

test('5c. własne ćwiczenia: dwa urządzenia dodają różne', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { S.custom.push({id:'CT', name:'T', custom:true}); }); tel.wyslij(); tick();
  lap.edit(S => { S.custom.push({id:'CL', name:'L', custom:true}); S.custom[0].name = 'Moje (zm.)'; }); lap.wyslij(); tick();
  tel.wracaSiec(); uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.deepEqual(d.S.custom.map(c => c.id).sort(), ['C1', 'CL', 'CT']); assert.equal(d.S.custom.find(c => c.id === 'C1').name, 'Moje (zm.)'); }
});

/* ======================= migracja i stara karta ======================= */
test('6. migracja ze starego układu: nic nie ginie, S.plans zostaje tablicą, pierwsza zmiana zapisuje v3', () => {
  const sv = new Serwer(), S0 = () => ({plans:[plan('P1', 'A'), plan('P2', 'B')], custom:[{id:'C1', name:'Moje', custom:true}], settings:{restSet:75, sound:false, perWeek:4}});
  sv.doc = {v:2, ...S0()};
  const d = new Urz('tel', sv, S0()); d.odbierz();
  assert.equal(ZP.layout(sv.doc), 'old'); assert.equal(sv.zapisy.length, 0, 'samo czytanie niczego nie zapisuje');
  assert.ok(Array.isArray(d.S.plans));
  d.edit(S => { byId(S, 'P2').name = 'B zmienione'; }); d.wyslij();
  assert.equal(ZP.layout(sv.doc), 'v3'); assert.equal(sv.doc.v, 3); assert.ok(sv.doc.full);
  assert.deepEqual(sv.doc.po, ['P1', 'P2']); assert.deepEqual(Object.keys(sv.doc.pm).sort(), ['P1', 'P2']);
  assert.equal(sv.doc.pm.P1.u, 0, 'nietknięty plan dostaje u=0'); assert.ok(sv.doc.pm.P2.u > 0);
  assert.deepEqual(sv.doc.co, ['C1']); assert.equal(sv.doc.cm.C1.name, 'Moje');
  assert.deepEqual(sv.doc.settings, {restSet:75, sound:false, perWeek:4});
  assert.deepEqual(sv.doc.plans.map(p => p.name), ['A', 'B zmienione']); assert.equal(sv.doc.custom.length, 1);
  assert.ok(ZP.emptyQ(d.z.q) || Object.keys(d.z.q.p).length === 0, 'kolejka opróżniona po zapisie');
});

test('6b. migracja: nietknięty plan nie przebija czekającej, starszej edycji z drugiego urządzenia', () => {
  const sv = new Serwer(), S0 = () => ({plans:[plan('P1', 'A'), plan('P2', 'B')], custom:[], settings:{restSet:90}});
  sv.doc = {v:2, ...S0()};
  const a = new Urz('a', sv, S0()), b = new Urz('b', sv, S0()); a.odbierz(); b.odbierz();
  b.online = false; tick(); b.edit(S => { byId(S, 'P1').name = 'edycja b (offline)'; }); tick(50);
  a.edit(S => { byId(S, 'P2').name = 'edycja a'; }); a.wyslij(); tick();        // a migruje: P1 dostaje u=0
  assert.equal(sv.doc.pm.P1.u, 0);
  b.online = true; uspokoj(a, b);
  for (const d of [a, b]){ assert.equal(byId(d.S, 'P1').name, 'edycja b (offline)'); assert.equal(byId(d.S, 'P2').name, 'edycja a'); }
});

test('6c. nowe konto (brak dokumentu): pierwsza zmiana tworzy dokument v3', () => {
  const sv = new Serwer(), d = new Urz('tel', sv);
  d.odbierz(); d.edit(S => { S.plans.push(plan('P1', 'pierwszy')); }); d.wyslij();
  assert.equal(ZP.layout(sv.doc), 'v3'); assert.deepEqual(sv.doc.po, ['P1']); assert.equal(sv.doc.plans[0].name, 'pierwszy');
});

test('7. stara karta zapisuje cały dokument w starym układzie po migracji: wykrycie i naprawa bez utraty', () => {
  const {sv, tel, lap} = konto();
  // czysty stan: P1, P2 w bazie. Stara karta (nie zna v3) czyta lustro i zapisuje zmianę planu P1 + nowy plan P3 całym dokumentem.
  const lustro = cl(sv.doc.plans), custom = cl(sv.doc.custom);
  lustro.find(p => p.id === 'P1').name = 'zmiana ze starej karty'; lustro.push(plan('P3', 'plan ze starej karty'));
  sv.doc = {v:2, plans:lustro, custom, settings:{...sv.doc.settings}};         // setDoc bez scalania: znika full, pm, po, nagrobki…
  assert.equal(ZP.layout(sv.doc), 'old');
  tel.edit(S => { byId(S, 'P2').name = 'czekająca zmiana telefonu'; }); tick();      // telefon ma niewysłaną zmianę innego planu
  const notes = tel.odbierz();
  assert.ok(notes.some(x => x.t === 'old-card-changed' && x.id === 'P1')); assert.ok(notes.some(x => x.t === 'old-card-new' && x.id === 'P3'));
  uspokoj(tel, lap);
  assert.equal(ZP.layout(sv.doc), 'v3', 'dokument naprawiony do v3'); assert.ok(tel.repaired + lap.repaired >= 1);
  for (const d of [tel, lap]){
    assert.deepEqual(ids(d.S).sort(), ['P1', 'P2', 'P3']);
    assert.equal(byId(d.S, 'P1').name, 'zmiana ze starej karty'); assert.equal(byId(d.S, 'P3').name, 'plan ze starej karty');
    assert.equal(byId(d.S, 'P2').name, 'czekająca zmiana telefonu', 'niewysłana zmiana telefonu nie ginie');
  }
  assert.equal(sv.doc.pm.P2.name, 'czekająca zmiana telefonu');
});

test('7b. stara karta bez planu (np. usunęła go): naprawa NIE usuwa planów z innych urządzeń', () => {
  const {sv, tel, lap} = konto();
  sv.doc = {v:2, plans:cl(sv.doc.plans).filter(p => p.id !== 'P2'), custom:[], settings:{...sv.doc.settings}};   // stara karta „pusta” w części danych
  uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.deepEqual(ids(d.S).sort(), ['P1', 'P2']); assert.equal(d.S.custom.length, 1, 'własne ćwiczenia z innych urządzeń zostają'); }
  assert.deepEqual(Object.keys(sv.doc.pm).sort(), ['P1', 'P2']); assert.equal(ZP.layout(sv.doc), 'v3');
});

test('7c. stara karta czyta lustro poprawnie (dokument v3 jest poprawnym dokumentem v2 dla starego kodu)', () => {
  const {sv, tel} = konto();
  tel.edit(S => { S.plans.push(plan('P9', 'nowy')); byId(S, 'P1').name = 'A2'; S.settings.restSet = 45; S.custom.push({id:'C9', name:'k', custom:true}); }); tel.wyslij();
  const d = sv.get();
  assert.ok(Array.isArray(d.plans) && Array.isArray(d.custom) && d.settings && typeof d.settings === 'object');
  assert.deepEqual(d.plans.map(p => p.id), ['P1', 'P2', 'P9']); assert.equal(d.plans[0].name, 'A2'); assert.equal(d.settings.restSet, 45); assert.deepEqual(d.custom.map(c => c.id), ['C1', 'C9']);
  assert.ok(!d.plans.some(p => 'u' in p), 'znacznik u nie trafia do planów w lustrze');
});

test('7d. naprawa nie wskrzesza tego, co zniknęło przed starą kartą (plan usunięty wcześniej nie wraca z nagrobków)', () => {
  const {sv, tel, lap} = konto();
  lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick(); uspokoj(tel, lap);
  sv.doc = {v:2, plans:cl(sv.doc.plans), custom:cl(sv.doc.custom), settings:{...sv.doc.settings}};        // stara karta zapisała to, co widziała (lustro bez P2)
  uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.deepEqual(ids(d.S), ['P1']);
});

/* ======================= kolejka ======================= */
test('8. kolejka: nieudany zapis zostaje, ponowienie wysyła raz, wpisy zmienione w międzyczasie nie giną', () => {
  const {sv, tel} = konto();
  tel.edit(S => { byId(S, 'P1').name = 'v1'; });
  const bw1 = ZP.buildWrite(tel.S, tel.z.q, clock.t, {});                   // wysyłka v1 zaczęta…
  tick(); tel.edit(S => { byId(S, 'P1').name = 'v2'; });                     // …a w trakcie plan zmieniony jeszcze raz
  // wysyłka v1 przeszła (afterSend z danymi sprzed zmiany) – wpis ma zostać, bo pozycja zmieniła się od wysyłki
  sv.merge(bw1.data, bw1.fields); ZP.afterSend(tel.z, bw1.sent);
  assert.ok(tel.z.q.p.P1 > 0, 'wpis z nowszą zmianą zostaje w kolejce');
  tel.wyslij(); assert.equal(sv.doc.pm.P1.name, 'v2'); assert.equal(tel.z.q.p.P1, undefined);
  // błąd: wpis zostaje i ponowienie go wysyła
  tel.edit(S => { byId(S, 'P2').name = 'po błędzie'; }); tel.fail = true; assert.equal(tel.wyslij(), false);
  assert.ok(tel.z.q.p.P2 > 0); tel.fail = false; assert.equal(tel.wyslij(), true); assert.equal(sv.doc.pm.P2.name, 'po błędzie');
  assert.equal(tel.wyslij(), false, 'nic więcej do wysłania');
  assert.deepEqual([ZP.backoff(0), ZP.backoff(1), ZP.backoff(2), ZP.backoff(3), ZP.backoff(9)], [2000, 5000, 15000, 60000, 60000]);
});

test('9. kolejka przeżywa zamknięcie karty (zapis do tekstu i odtworzenie) i wysyła zmiany po ponownym otwarciu', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tel.edit(S => { byId(S, 'P1').name = 'offline'; S.plans.push(plan('PN', 'nowy offline')); S.plans = S.plans.filter(p => p.id !== 'P2'); });
  const tekst = JSON.stringify({z:tel.z, S:tel.S});                         // karta zamknięta: localStorage ma stan i kolejkę
  const nowy = new Urz('tel2', sv, JSON.parse(tekst).S); nowy.z = ZP.fixZ(JSON.parse(tekst).z); nowy.last = ZP.snap(nowy.S);
  uspokoj(nowy, lap);
  for (const d of [nowy, lap]){ assert.deepEqual(ids(d.S).sort(), ['P1', 'PN']); assert.equal(byId(d.S, 'P1').name, 'offline'); }
  assert.equal(ZP.fixZ({q:{p:{x:'zły'}, po:'?'}, kn:5}).q.p.x, undefined, 'uszkodzony zapis kolejki jest czyszczony');
});

test('10. zapis offline po zamknięciu karty nie powtarza się w nieskończoność (kolejka pusta po ack)', () => {
  const {sv, tel} = konto();
  tel.edit(S => { byId(S, 'P1').name = 'raz'; }); tel.wyslij(); const n0 = sv.zapisy.length;
  for (let i = 0; i < 5; i++){ tel.odbierz(); tel.wyslij(); }
  assert.equal(sv.zapisy.length, n0, 'odbiór własnego zapisu nie wywołuje kolejnych zapisów');
});

/* ======================= treningi ======================= */
const tr = (id, date) => ({id, date:date || '2026-11-01T10:00:00.000Z', ex:[]});
test('11. trening niepotwierdzony wraca do historii po odczycie z bazy i jest wysyłany ponownie (E1-10)', () => {
  const na = tr('T-nowy'), stare = [tr('T1'), tr('T2')];
  const local = [na, ...stare];                                             // zapis się nie udał: trening jest lokalnie i na liście niewysłanych
  const m = ZP.mergeSessions(stare.map(s => ({...s, pending:false})), local, ['T-nowy'], false);
  assert.deepEqual(m.list.map(s => s.id).sort(), ['T-nowy', 'T1', 'T2']);
  assert.deepEqual(m.unsent, ['T-nowy']); assert.deepEqual(m.resend, ['T-nowy']);
});
test('11b. migawka z pamięci podręcznej niczego nie potwierdza i nie wymusza wysyłki, ale trening zostaje w historii', () => {
  const m = ZP.mergeSessions([], [tr('T-nowy')], ['T-nowy'], true);
  assert.deepEqual(m.list.map(s => s.id), ['T-nowy']); assert.deepEqual(m.resend, []); assert.deepEqual(m.unsent, ['T-nowy']);
});
test('11c. trening potwierdzony przez serwer znika z listy niewysłanych; oczekujący w kolejce SDK zostaje', () => {
  const potw = ZP.mergeSessions([{...tr('A'), pending:false}], [tr('A')], ['A'], false);
  assert.deepEqual(potw.unsent, []); assert.deepEqual(potw.list.map(s => s.id), ['A']);
  const czeka = ZP.mergeSessions([{...tr('A'), pending:true}], [tr('A')], ['A'], false);
  assert.deepEqual(czeka.unsent, ['A']); assert.deepEqual(czeka.resend, [], 'nie wysyłamy ponownie tego, co czeka w kolejce SDK');
  assert.ok(!('pending' in czeka.list[0]), 'znacznik pending nie trafia do historii');
});
test('12. trening USUNIĘTY nie wraca (usunięcie zdejmuje id z listy niewysłanych przed wysyłką)', () => {
  let unsent = ['T-a', 'T-b'];
  const local = [tr('T-a'), tr('T-b'), tr('T1')];
  unsent = ZP.without(unsent, 'T-a');                                       // deleteSession('T-a')
  const m = ZP.mergeSessions([{...tr('T1'), pending:false}], local.filter(s => s.id !== 'T-a'), unsent, false);
  assert.deepEqual(m.list.map(s => s.id).sort(), ['T-b', 'T1']); assert.ok(!m.unsent.includes('T-a'));
  // trening usunięty na innym urządzeniu, a potwierdzony tutaj: serwer go nie ma i nie jest na liście, więc znika
  const m2 = ZP.mergeSessions([], [tr('T1')], [], false);
  assert.deepEqual(m2.list, []);
});
test('12b. id z listy bez treningu w pamięci nie wraca jako pusty wpis (i zostaje na liście, A6b-6c); lista osobna dla konta', () => {
  const m = ZP.mergeSessions([], [], ['T-zgubiony'], false);
  assert.deepEqual(m.list, []); assert.deepEqual(m.unsent, ['T-zgubiony']);
  const k1 = ZP.mergeSessions([], [tr('X')], ['X'], false), k2 = ZP.mergeSessions([], [tr('Y')], ['Y'], false);
  assert.deepEqual(k1.list.map(s => s.id), ['X']); assert.deepEqual(k2.list.map(s => s.id), ['Y']);
});

/* ======================= A6b: poprawki po przeglądzie A6 ======================= */
test('13. zegar: urządzenie z zegarem +1 dzień nie przebija późniejszej zmiany tego samego planu z drugiego urządzenia', () => {
  const {sv, tel, lap} = konto();
  tel.off = 864e5; tick();                                                   // zegar telefonu idzie o dobę do przodu
  tel.edit(S => { byId(S, 'P1').name = 'telefon (zegar +1 dzień)'; }); tel.wyslij();
  const uTel = sv.doc.pm.P1.u; assert.ok(uTel > clock.t + 864e5 - 1000, 'znacznik telefonu jest „z przyszłości”');
  lap.odbierz(); tick(3600e3);                                               // laptop widzi zmianę telefonu, godzinę później zmienia ten sam plan
  lap.edit(S => { byId(S, 'P1').name = 'laptop (godzinę później)'; }); lap.wyslij();
  assert.ok(sv.doc.pm.P1.u > uTel, 'znacznik późniejszej zmiany musi być większy od największego widzianego w bazie');
  uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.equal(byId(d.S, 'P1').name, 'laptop (godzinę później)');
  assert.equal(sv.doc.pm.P1.name, 'laptop (godzinę później)');
  assert.ok(ZP.fixZ(JSON.parse(JSON.stringify(lap.z))).q.mx >= uTel, 'największe widziane u przeżywa zapis do localStorage');
  const q = ZP.emptyQueue(); q.mx = 5000; assert.equal(ZP.stampQ(q, 1000), 5001, 'stampQ = max(teraz, q.t+1, mx+1)');
});

test('14. nagrobek ukrywa spóźniony zapis pm.<id>: urządzenia dokładają usunięcie, wpis znika z bazy (zapis offline dochodzi po usunięciu)', () => {
  const {sv, tel, lap} = konto();
  tel.online = false; tick();
  tel.edit(S => { byId(S, 'P2').name = 'edycja offline'; }); tel.wyslij(); tick(50);
  lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick();
  const tomb = sv.doc.pt.P2; assert.ok(tomb > 0);
  tel.wracaSiec();                                                           // spóźniony zapis ląduje w bazie POD nagrobkiem
  assert.ok(sv.doc.pm.P2 && sv.doc.pm.P2.u < tomb, 'w bazie został ukryty, starszy wpis');
  uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.deepEqual(ids(d.S), ['P1']);
  assert.equal(sv.doc.pm.P2, undefined, 'wpis pod nagrobkiem został usunięty z bazy'); assert.equal(sv.doc.pt.P2, tomb, 'nagrobek zostaje z oryginalnym czasem');
  assert.deepEqual(sv.doc.plans.map(p => p.id), ['P1']);
});
test('15. czyszczenie nagrobka po 60 dniach usuwa też starszy wpis pm.<id> – po 61 dniach plan nie wraca', () => {
  const {sv, tel, lap} = konto();
  lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick();
  const tomb = sv.doc.pt.P2;
  sv.doc.pm.P2 = {...plan('P2', 'Plan B'), u:tomb - 5};                       // spóźniony zapis pod nagrobkiem (nikt jeszcze go nie widział)
  const pozniej = tomb + 61 * 864e5;
  tel.edit(S => { byId(S, 'P1').name = 'zmiana po 61 dniach'; });
  const bw = ZP.buildWrite(tel.S, tel.z.q, pozniej, {tombs:ZP.tombInfo(sv.get())});
  assert.ok(bw.fields.includes('pt.P2') && bw.fields.includes('pm.P2'), 'czyszczony nagrobek zabiera ze sobą starszy wpis');
  sv.merge(bw.data, bw.fields); ZP.afterSend(tel.z, bw.sent);
  assert.equal(sv.doc.pt.P2, undefined); assert.equal(sv.doc.pm.P2, undefined);
  const nowy = new Urz('nowy', sv, {plans:[plan('P1', 'Plan A'), plan('P2', 'Plan B')], custom:[], settings:{restSet:90, sound:true}}); nowy.off = 61 * 864e5;
  nowy.odbierz(); assert.deepEqual(ids(nowy.S), ['P1'], 'plan z pamięci urządzenia znika zamiast wracać do bazy');
  // wpis nowszy od nagrobka (prawdziwa, późniejsza edycja) nie jest ruszany
  sv.doc.pt.P3 = tomb; sv.doc.pm.P3 = {...plan('P3', 'późniejszy'), u:tomb + 10};
  const bw2 = ZP.buildWrite(tel.S, (tel.edit(S => { byId(S, 'P1').name = 'jeszcze raz'; }), tel.z.q), pozniej, {tombs:ZP.tombInfo(sv.get())});
  assert.ok(bw2.fields.includes('pt.P3') && !bw2.fields.includes('pm.P3'), 'wpis późniejszy od nagrobka zostaje');
});
test('16. naprawa po starej karcie nie wskrzesza planu usuniętego później niż edytowany; nagrobki młodsze niż 60 dni przechodzą do nowego dokumentu', () => {
  const {sv, tel, lap} = konto();
  tel.edit(S => { byId(S, 'P2').name = 'P2 edytowany'; }); tel.wyslij(); tick(50);
  lap.odbierz(); lap.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); lap.wyslij(); tick();
  uspokoj(tel, lap); const tomb = sv.doc.pt.P2; assert.ok(tomb > 0); assert.deepEqual(ids(tel.S), ['P1']);
  // stara karta (otwarta przed usunięciem) zapisuje cały dokument ze starą kopią P2 – znika full, pm i nagrobki
  sv.doc = {v:2, plans:[plan('P1', 'Plan A'), {...plan('P2', 'Plan B'), name:'P2 edytowany'}], custom:cl(sv.doc.custom), settings:{...sv.doc.settings}};
  uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.deepEqual(ids(d.S), ['P1'], 'usunięty plan nie wraca ze starej karty');
  assert.equal(ZP.layout(sv.doc), 'v3'); assert.equal(sv.doc.pm.P2, undefined); assert.deepEqual(sv.doc.po, ['P1']);
  assert.equal(sv.doc.pt.P2, tomb, 'nagrobek przeniesiony do naprawionego dokumentu (zamiast pustego pt)');
});
test('16b. fullDoc przenosi nagrobki młodsze niż 60 dni i czekające usunięcia, starsze pomija', () => {
  const now = 10 * 864e5 * 10, kn = ZP.emptyKnown(); kn.pt = {A:now - 864e5, B:now - 61 * 864e5}; kn.ct = {C:now - 5};
  const q = ZP.emptyQueue(); q.pd = {D:now - 10};
  const fd = ZP.fullDoc({plans:[plan('P1', 'x')], custom:[], settings:{}}, q, kn, now);
  assert.deepEqual(fd.doc.pt, {A:now - 864e5, D:now - 10}); assert.deepEqual(fd.doc.ct, {C:now - 5});
});

test('17. lustro nie jest nadpisywane zwykłym zapisem: stara karta dodaje plan, urządzenie z układem v3 zapisuje tuż po niej – plan ze starej karty zostaje', () => {
  const {sv, tel, lap} = konto();
  const lustro = cl(sv.doc.plans); lustro.push(plan('P3', 'plan ze starej karty'));
  sv.doc = {v:2, plans:lustro, custom:cl(sv.doc.custom), settings:{...sv.doc.settings}};     // setDoc starej karty: znika full, pm, po…
  tel.edit(S => { byId(S, 'P1').name = 'telefon tuż po starej karcie'; }); tel.wyslij();      // telefon jeszcze nie widział starej karty: zwykły zapis scalający
  assert.ok(!sv.zapisy.some(z => z.fields && z.fields.includes('plans')), 'żaden zwykły zapis nie dotyka lustra');
  assert.ok(sv.doc.plans.some(p => p.id === 'P3'), 'plan ze starej karty zostaje w lustrze');
  uspokoj(tel, lap);
  for (const d of [tel, lap]) assert.ok(ids(d.S).includes('P3'), d.nazwa + ': plan ze starej karty nie zginął');
  assert.equal(ZP.layout(sv.doc), 'v3'); assert.ok(sv.doc.pm.P3);
});
test('18. lustro: transakcja zapisuje je tylko w dokumencie z full, liczy z pm/po i nagrobków; w dokumencie starej karty nie robi nic', () => {
  const {sv, tel} = konto();
  assert.equal(ZP.mirrorPatch({v:2, plans:[plan('P1', 'a')], custom:[], settings:{}}).action, 'skip', 'stary układ: nie ruszamy');
  assert.equal(ZP.mirrorPatch({v:3, pm:{}, cm:{}, plans:[]}).action, 'skip', 'v3 bez full (zapis częściowy po starej karcie): nie ruszamy');
  assert.equal(ZP.mirrorPatch(null).action, 'skip');
  assert.equal(ZP.mirrorPatch(sv.get()).action, 'same', 'po konto() lustro zgadza się z dokumentem');
  const d = sv.get(); d.pm.P2.u = 50; d.po = ['P2', 'P1']; d.pt = {P1:99}; d.pm.P1.u = 10;                // P1 ukryty nagrobkiem, kolejność z po
  const p = ZP.mirrorPatch(d); assert.equal(p.action, 'set'); assert.deepEqual(p.plans.map(x => x.id), ['P2']); assert.ok(!('u' in p.plans[0]), 'bez znacznika u');
  assert.deepEqual(p.custom.map(x => x.id), ['C1']);
  const d2 = sv.get(); delete d2.plans; delete d2.custom; assert.equal(ZP.mirrorPatch(d2).action, 'set', 'brakujące lustro jest odtwarzane');
  tel.edit(S => { byId(S, 'P1').name = 'nowa nazwa'; }); tel.wyslij();
  assert.deepEqual(sv.doc.plans.map(x => x.name), ['nowa nazwa', 'Plan B'], 'po zapisie lustro odświeża osobna transakcja'); assert.equal(tel.z.q.m, 0);
});

test('19. naprawa po starej karcie: nieaktualna kopia innego planu nie cofa nowszej zmiany z laptopa', () => {
  const {sv, tel, lap} = konto();
  const lustro = cl(sv.doc.plans);                                           // stara karta otwarta z P1, P2 w wersjach sprzed zmiany z laptopa
  lap.edit(S => { byId(S, 'P2').name = 'P2 z laptopa'; }); lap.wyslij(); tick();
  tel.odbierz(); assert.equal(byId(tel.S, 'P2').name, 'P2 z laptopa');
  lustro.find(p => p.id === 'P1').name = 'P1 ze starej karty';             // stara karta zmienia P1 i zapisuje CAŁY dokument ze starą kopią P2
  sv.doc = {v:2, plans:lustro, custom:cl(sv.doc.custom), settings:{...sv.doc.settings}};
  tel.odbierz(); assert.ok(tel.notes.some(x => x.t === 'old-card-stale' && x.id === 'P2'), 'stara kopia rozpoznana po skrócie wcześniejszej wersji');
  uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.equal(byId(d.S, 'P1').name, 'P1 ze starej karty', 'prawdziwa zmiana starej karty zostaje'); assert.equal(byId(d.S, 'P2').name, 'P2 z laptopa', 'nowsza zmiana z laptopa nie jest cofnięta'); }
  assert.equal(sv.doc.pm.P2.name, 'P2 z laptopa'); assert.equal(ZP.layout(sv.doc), 'v3');
});
test('19b. to samo po zwykłym zapisie z układu v3 tuż po starej karcie: zmiana telefonu i plan starej karty zostają oba', () => {
  const {sv, tel, lap} = konto();
  const lustro = cl(sv.doc.plans); lustro.push(plan('P3', 'plan ze starej karty'));
  sv.doc = {v:2, plans:lustro, custom:cl(sv.doc.custom), settings:{...sv.doc.settings}};
  tel.edit(S => { byId(S, 'P1').name = 'telefon tuż po starej karcie'; }); tel.wyslij();
  uspokoj(tel, lap);
  for (const d of [tel, lap]){ assert.equal(byId(d.S, 'P1').name, 'telefon tuż po starej karcie', 'kopia P1 ze starej karty (sprzed zmiany) nie cofa zmiany telefonu'); assert.ok(byId(d.S, 'P3')); }
});
test('19c. historia wersji w kn: kilka ostatnich skrótów, przeżywa zapis do localStorage, nie rośnie bez końca', () => {
  const {tel} = konto();
  for (let i = 0; i < 12; i++){ tel.edit(S => { byId(S, 'P1').name = 'wersja ' + i; }); tick(); }
  const h = tel.z.kn.h.p.P1; assert.ok(Array.isArray(h) && h.length >= 3 && h.length <= 8, 'ostatnie wersje, nie wszystkie: ' + h.length);
  assert.deepEqual(ZP.fixZ(JSON.parse(JSON.stringify(tel.z))).kn.h.p.P1, h);
  assert.deepEqual(ZP.fixZ({kn:{h:{p:{x:'zły', y:[1, 'ok']}}}}).kn.h.p, {y:['ok']}, 'uszkodzony zapis historii jest czyszczony');
});

/* sztuczny localStorage współdzielony przez dwie „karty” (ten sam interfejs co LS w aplikacji) */
const wspolnyLS = () => { const mem = {}; return {mem, get:(k, d) => k in mem ? JSON.parse(mem[k]) : d, set:(k, v) => { mem[k] = JSON.stringify(v); }}; };
test('20. dwie karty tej samej przeglądarki: zapis kolejki łączy wpisy z tym, co już jest w localStorage (suma, większy znacznik)', () => {
  const ls = wspolnyLS(), key = 'dz.f.X.zq', stored = () => ZP.fixZ(ls.get(key, null));
  const z1 = ZP.fixZ(ls.get(key, null)), z2 = ZP.fixZ(ls.get(key, null));          // obie karty otwarte na tym samym koncie, obie z pustą kolejką
  z1.q.p.P1 = 100; z1.q.s.restSet = 100; z1.q.po = 100; z1.q.t = 100; ZP.saveZ(ls, key, z1);
  z2.q.p.P2 = 200; z2.q.p.P1 = 150; z2.q.cd.C1 = 210; z2.q.t = 210; ZP.saveZ(ls, key, z2);   // karta 2 nie widziała wpisów karty 1 – nie może ich skasować
  let st = stored();
  assert.deepEqual(st.q.p, {P1:150, P2:200}, 'suma wpisów, przy tym samym id większy znacznik'); assert.equal(st.q.s.restSet, 100); assert.equal(st.q.po, 100);
  assert.deepEqual(st.q.cd, {C1:210}); assert.equal(st.q.t, 210);
  z1.q.p.P2 = 50; ZP.saveZ(ls, key, z1); assert.equal(stored().q.p.P2, 200, 'starszy znacznik z drugiej karty nie obniża zapisanego');
  // usunięcie i edycja tej samej pozycji na dwóch kartach: wygrywa późniejsze
  z1.q.p.X = 300; ZP.saveZ(ls, key, z1); z2.q.pd.X = 400; ZP.saveZ(ls, key, z2); st = stored(); assert.equal(st.q.pd.X, 400); assert.equal(st.q.p.X, undefined);
  z1.q.p.Y = 500; ZP.saveZ(ls, key, z1); z2.q.pd.Y = 450; ZP.saveZ(ls, key, z2); st = stored(); assert.equal(st.q.p.Y, 500); assert.equal(st.q.pd.Y, undefined);
});
test('20b. wysłane wpisy schodzą z zapisanej kolejki, nowszy wpis drugiej karty zostaje; znane czasy i nagrobki też się łączą', () => {
  const ls = wspolnyLS(), key = 'dz.f.X.zq', stored = () => ZP.fixZ(ls.get(key, null));
  const z1 = ZP.fixZ(null), z2 = ZP.fixZ(null);
  z1.q.p = {P1:100, P2:200}; z1.q.s = {sound:100}; z1.q.po = 100; ZP.saveZ(ls, key, z1);
  z2.q.p = {P1:150}; ZP.saveZ(ls, key, z2);
  const sent = {p:{P1:100, P2:200}, pd:{}, c:{}, cd:{}, s:{sound:100}, po:100, co:0, f:0, m:0};
  z1.q.p = {}; z1.q.s = {}; z1.q.po = 0; z1.kn.p = {P1:100, P2:200}; z1.kn.v3 = true; z1.kn.pt = {A:Date.now() - 1000}; const tombA = z1.kn.pt.A; ZP.saveZ(ls, key, z1, sent);      // karta 1: wysłane i potwierdzone
  const st = stored();
  assert.deepEqual(st.q.p, {P1:150}, 'P2 potwierdzone zeszło z kolejki, P1 z nowszym znacznikiem drugiej karty zostaje'); assert.deepEqual(st.q.s, {}); assert.equal(st.q.po, 0);
  assert.deepEqual(st.kn.p, {P1:100, P2:200}); assert.equal(st.kn.v3, true); assert.deepEqual(st.kn.pt, {A:tombA});
  z2.kn.p = {P1:90, P3:7}; ZP.saveZ(ls, key, z2); assert.deepEqual(stored().kn.p, {P1:100, P2:200, P3:7}, 'znane czasy: większy z obu');
});

test('21. limit rozmiaru liczony w bajtach UTF-8 całego dokumentu (pm + lustro + nagrobki) wobec ok. 900 KB; stare lustro znika, gdy jest pomijane', () => {
  const duzy = plan('PB', 'duży'); duzy.note = 'ż'.repeat(260000);         // 260 tys. znaków = ok. 520 KB w UTF-8 (pm); lustro drugie tyle
  const jedenZnak = ZP.join(ZP.split({plans:[duzy], custom:[], settings:{}})); assert.ok(JSON.stringify(jedenZnak.plans).length < 600000, 'wg starego progu znaków samo lustro by się mieściło');
  const fd = ZP.fullDoc({plans:[plan('P1', 'a'), duzy], custom:[], settings:{}}, ZP.emptyQueue(), ZP.emptyKnown(), clock.t);
  assert.equal(fd.doc.plans, undefined); assert.equal(fd.doc.custom, undefined); assert.ok(fd.mirrorSkipped, 'migracja/naprawa pomija lustro i mówi o tym'); assert.ok(fd.doc.pm.PB, 'pm zostaje');
  const maly = ZP.fullDoc({plans:[plan('P1', 'a')], custom:[], settings:{}}, ZP.emptyQueue(), ZP.emptyKnown(), clock.t);
  assert.ok(Array.isArray(maly.doc.plans) && Array.isArray(maly.doc.custom)); assert.ok(!maly.mirrorSkipped);
  // transakcja lustra: dokument urósł (pm + lustro > ok. 900 KB) – stare lustro jest USUWANE, żeby stara karta nie widziała nieaktualnych planów
  const d = {v:3, full:1, pm:{PB:{...duzy, u:1}}, po:['PB'], pos:1, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{}, plans:[{...duzy}], custom:[]};
  const p = ZP.mirrorPatch(d); assert.equal(p.action, 'drop'); assert.ok(p.tooBig);
  const bez = {...d}; delete bez.plans; delete bez.custom; assert.equal(ZP.mirrorPatch(bez).action, 'skip', 'nie ma czego usuwać');
  // nagrobki też liczą się do limitu
  const tomb = {}; for (let i = 0; i < 40000; i++) tomb['t' + String(i).padStart(8, '0') + 'x'.repeat(12)] = 1700000000000;
  const dn = {v:3, full:1, pm:{P1:{...plan('P1', 'a'), u:1}}, po:['P1'], pos:1, cm:{}, co:[], cos:0, pt:tomb, ct:{}, settings:{}, plans:[plan('P1', 'a')], custom:[]};
  assert.ok(Buffer.byteLength(JSON.stringify(dn)) > 900000); assert.equal(ZP.mirrorPatch(dn).action, 'drop', 'duże nagrobki też wyłączają lustro');
  // mały dokument z wielobajtowymi znakami mieści się
  const wiel = plan('PW', 'zażółć gęślą jaźń'); assert.equal(ZP.mirrorPatch({v:3, full:1, pm:{PW:{...wiel, u:1}}, po:['PW'], pos:1, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{}, plans:[wiel], custom:[]}).action, 'same');
});

test('22. zajętość zapisu osobno dla konta; po wysyłce kolejka idzie do localStorage tylko, gdy to nadal bieżące Z', () => {
  const b = ZP.newBusy();
  assert.equal(b.take('A'), true); assert.equal(b.take('A'), false, 'to samo konto: drugi zapis czeka'); assert.equal(b.take('B'), true, 'inne konto nie jest zablokowane przez zapis konta A');
  b.free('A'); assert.equal(b.has('A'), false); assert.equal(b.has('B'), true); b.free('B'); assert.equal(b.take('A'), true);
  // konto zamknięte i otwarte ponownie w trakcie wysyłki: stare Z kończy wysyłkę, ale nie nadpisuje zapisanej kolejki nowego Z
  const ls = wspolnyLS(), key = 'dz.f.A.zq', stored = () => ZP.fixZ(ls.get(key, null));
  const stare = ZP.fixZ(null); stare.q.p.P1 = 100; ZP.saveZ(ls, key, stare);
  const nowe = ZP.fixZ(ls.get(key, null)); nowe.q.p.P9 = 300; ZP.saveZ(ls, key, nowe);
  const sent = {p:{P1:100}, pd:{}, c:{}, cd:{}, s:{}, po:0, co:0, f:0, m:0};
  const przed = ls.mem[key];
  ZP.settle(ls, 'A', nowe, stare, sent, undefined, 400);                        // stare Z (nie bieżące) kończy wysyłkę
  assert.equal(ls.mem[key], przed, 'localStorage nietknięty przez nieaktualne Z'); assert.deepEqual(stare.q.p, {}, 'ale stare Z zdjęło wysłany wpis z własnej kolejki');
  ZP.settle(ls, 'A', nowe, nowe, {...sent, p:{P9:300}}, undefined, 500);       // bieżące Z kończy wysyłkę
  assert.deepEqual(stored().q.p, {P1:100}, 'bieżące Z zapisuje: wysłane P9 zeszło, P1 (wysłane przez stare Z) zostaje do bezpiecznego ponowienia');
});

test('23. mergeSessions nie zdejmuje z listy id bez treningu w pamięci (pamięć mogła się jeszcze nie wczytać); potwierdzony przez serwer schodzi', () => {
  const m = ZP.mergeSessions([], [], ['T-a', 'T-b'], false);
  assert.deepEqual(m.unsent, ['T-a', 'T-b']); assert.deepEqual(m.list, [], 'bez treningu w pamięci nie ma czego pokazać'); assert.deepEqual(m.resend, [], 'ani czego wysłać');
  const m2 = ZP.mergeSessions([], [tr('T-a')], m.unsent, false);                   // trening wrócił do pamięci: wraca do historii i jest wysyłany
  assert.deepEqual(m2.list.map(s => s.id), ['T-a']); assert.deepEqual(m2.resend, ['T-a']); assert.deepEqual(m2.unsent, ['T-a', 'T-b']);
  const m3 = ZP.mergeSessions([{...tr('T-b'), pending:false}], [], ['T-a', 'T-b'], false);   // serwer potwierdził T-b, mimo że nie ma go w pamięci
  assert.deepEqual(m3.unsent, ['T-a']); assert.deepEqual(m3.list.map(s => s.id), ['T-b']);
  const m4 = ZP.mergeSessions([], [], ['T-a'], true); assert.deepEqual(m4.unsent, ['T-a'], 'migawka z pamięci podręcznej też niczego nie zdejmuje');
});

test('24. usunięcie konta kasuje też kolejkę zapisu (.zq) i listę niewysłanych treningów (.unsent) tego konta, nie cudze', () => {
  const ls = wspolnyLS(); ls.del = k => { delete ls.mem[k]; };                 // jak LS.del w aplikacji
  assert.equal(ZP.zKey('A'), 'dz.f.A.zq'); assert.equal(ZP.sessKey('A'), 'dz.f.A.unsent');
  for (const f of ['A', 'B']){ ls.set(ZP.zKey(f), {q:{p:{P1:5}}}); ls.set(ZP.sessKey(f), ['T1']); ls.set('dz.f.' + f + '.state', {}); }
  assert.deepEqual(ZP.accountKeys('A').sort(), ['dz.f.A.state', 'dz.f.A.unsent', 'dz.f.A.zq'], 'accountKeys zawiera też stateKey (A6d)');
  ZP.accountKeys('A').forEach(k => ls.del(k));
  assert.ok(!('dz.f.A.zq' in ls.mem) && !('dz.f.A.unsent' in ls.mem) && !('dz.f.A.state' in ls.mem), 'klucze usuniętego konta zniknęły (razem ze stanem)');
  assert.ok('dz.f.B.zq' in ls.mem && 'dz.f.B.unsent' in ls.mem && 'dz.f.B.state' in ls.mem, 'klucze cudzego konta nietknięte');
});

test('25. migracja wstrzymana, gdy dokument nie ma ani tablicy plans, ani pm (nie nadpisujemy dokumentu nieznanego kształtu)', () => {
  const sv = new Serwer(), ust = {restSet:60};
  sv.doc = {settings:ust};                                                      // dokument istnieje, ale bez planów i bez układu v3 (np. zapis częściowy)
  const d = new Urz('tel', sv, {plans:[plan('P1', 'lokalny')], custom:[], settings:{restSet:90, sound:true}});
  d.edit(S => { byId(S, 'P1').name = 'zmiana czeka'; }); d.odbierz();
  const tx = ZP.migrate(d.S, d.z, sv.get(), clock.t); assert.equal(tx.hold, true); assert.equal(tx.doc, undefined);
  assert.equal(d.wyslij(), false); assert.equal(sv.zapisy.length, 0, 'nic nie zapisano'); assert.deepEqual(sv.get(), {settings:ust});
  assert.ok(d.z.q.p.P1 > 0, 'zmiana czeka w kolejce');
  for (const dok of [{}, {v:2}, {plans:'nie tablica'}, {pm:[]}]) assert.equal(ZP.migrate(d.S, d.z, dok, clock.t).hold, true, JSON.stringify(dok));
  // dokument ze starym układem (nawet pustą tablicą plans) albo z pm – migracja idzie; brak dokumentu = nowe konto, też idzie
  for (const dok of [{v:2, plans:[], custom:[], settings:{}}, {pm:{}, settings:{}}]) assert.ok(!ZP.migrate(d.S, d.z, dok, clock.t).hold, JSON.stringify(dok));
  assert.ok(!ZP.migrate(d.S, d.z, null, clock.t).hold);
  sv.doc = {settings:ust, plans:[plan('P1', 'lokalny')], custom:[]};              // dokument dostał tablicę plans: migracja rusza
  assert.equal(d.wyslij(), true); assert.equal(ZP.layout(sv.doc), 'v3'); assert.equal(sv.doc.pm.P1.name, 'zmiana czeka');
});


/* ======================= A6c ======================= */
/* „Karta” = to, co robi aplikacja w jednej karcie przeglądarki: własne S i Z w pamięci, wspólny localStorage (ls). Wszystkie zapisy do localStorage idą przez ZP.store. */
function karta(nazwa, ls, fid){
  const k = {nazwa, ls, fid, S:null, z:null, last:null};
  k.otworz = () => { k.S = ls.get(ZP.stateKey(fid), null) || {plans:[plan('P1', 'Plan A'), plan('P2', 'Plan B')], custom:[], settings:{restSet:90, sound:true}}; k.z = ZP.fixZ(ls.get(ZP.zKey(fid), null)); k.last = ZP.snap(k.S); return k; };
  k.edit = fn => { fn(k.S); k.last = ZP.diff(k.last, k.S, k.z.q, tick(), k.z.kn); ZP.store(ls, fid, k.z, k.z, k.S); };            // persist()
  k.snapshot = doc => {                                                                                                          // handler nasłuchu w openFolder
    const before = cl(k.z.q), R = ZP.remoteOld({plans:doc.plans, custom:doc.custom || [], settings:{...blank().settings, ...(doc.settings || {})}}, k.z.kn.v3, {pt:k.z.kn.pt, ct:k.z.kn.ct});
    const mg = ZP.merge(k.S, k.z.q, k.z.kn, R, tick()); k.z.q = mg.q; k.z.kn = mg.kn; k.S = mg.S; k.last = ZP.snap(k.S);
    ZP.store(ls, fid, k.z, k.z, k.S, ZP.dropped(before, k.z.q)); return mg.notes;
  };
  k.noop = () => { const f0 = k.z.q.f; k.z.q.f = 0; ZP.store(ls, fid, k.z, k.z, k.S, {f:f0}); };                                  // ścieżka noop w flushFire
  k.mirror = () => { const m = k.z.q.m; ZP.afterMirror(k.z, m); ZP.store(ls, fid, k.z, k.z, k.S, {m}); };                         // koniec flushMirror
  k.otworz();
  return k;
}
const serwerV2 = () => ({v:2, plans:[plan('P1', 'Plan A'), plan('P2', 'Plan B')], custom:[], settings:{restSet:90, sound:true}});
const nazwy = S => S.plans.map(p => p.name);

test('26. dwie karty tej samej przeglądarki: zmiany różnych planów, zapis w różnej kolejności i różnymi ścieżkami (zwykły zapis, odczyt z bazy, noop, lustro) – w kolejce i w stanie są wpisy obu kart', () => {
  const sekwencje = {
    'A, B, odczyt A, noop B, noop A':        k => { k.A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; }); k.B.edit(S => { byId(S, 'P2').name = 'B zmienia P2'; }); k.A.snapshot(k.doc); k.B.noop(); k.A.noop(); },
    'B, A, odczyt B, odczyt A':              k => { k.B.edit(S => { byId(S, 'P2').name = 'B zmienia P2'; }); k.A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; }); k.B.snapshot(k.doc); k.A.snapshot(k.doc); },
    'A, odczyt A, B, noop A, lustro A':      k => { k.A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; }); k.A.snapshot(k.doc); k.B.edit(S => { byId(S, 'P2').name = 'B zmienia P2'; }); k.A.noop(); k.A.mirror(); },
    'B, noop B, A, lustro A, odczyt A':      k => { k.B.edit(S => { byId(S, 'P2').name = 'B zmienia P2'; }); k.B.noop(); k.A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; }); k.A.mirror(); k.A.snapshot(k.doc); },
  };
  for (const [opis, run] of Object.entries(sekwencje)){
    const ls = wspolnyLS(), k = {A:karta('A', ls, 'X'), B:karta('B', ls, 'X'), doc:serwerV2()};   // obie karty otwarte na tym samym koncie, obie z tym samym stanem
    run(k);
    const q = ZP.fixZ(ls.get(ZP.zKey('X'), null)).q, st = ls.get(ZP.stateKey('X'), null);
    assert.deepEqual(Object.keys(q.p).sort(), ['P1', 'P2'], opis + ': w zapisanej kolejce są wpisy obu kart');
    assert.deepEqual(nazwy(st), ['A zmienia P1', 'B zmienia P2'], opis + ': w zapisanym stanie są zmiany obu kart (nie tylko ostatniej)');
    const C = karta('C', ls, 'X');                                                                 // nowa karta po „zamknięciu” obu: tak, jak po odświeżeniu strony
    assert.deepEqual(nazwy(C.S), ['A zmienia P1', 'B zmienia P2'], opis + ': nowa karta widzi obie zmiany'); assert.deepEqual(Object.keys(C.z.q.p).sort(), ['P1', 'P2']);
    // nowa karta scala to z bazą i nie traci żadnej zmiany (wpis kolejki bez zmiany w stanie wysłałby starą treść)
    C.snapshot(k.doc); assert.deepEqual(nazwy(C.S), ['A zmienia P1', 'B zmienia P2'], opis + ': po odczycie z bazy obie zmiany zostają');
  }
});
test('26b. usunięcie planu na jednej karcie, edycja innego na drugiej; wpis zdjęty przez scalenie z bazą nie wraca z zapisanej kolejki', () => {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X'), doc = serwerV2();
  B.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });
  A.noop(); A.snapshot(doc);
  const q = ZP.fixZ(ls.get(ZP.zKey('X'), null)).q, st = ls.get(ZP.stateKey('X'), null);
  assert.deepEqual(Object.keys(q.pd), ['P2'], 'usunięcie drugiej karty zostaje w kolejce'); assert.deepEqual(Object.keys(q.p), ['P1']);
  assert.deepEqual(ids(st), ['P1'], 'plan usunięty na drugiej karcie nie wraca do zapisanego stanu'); assert.equal(byId(st, 'P1').name, 'A zmienia P1');
  // scalenie z bazą uznaje późniejszą zmianę z drugiego urządzenia za nowszą: wpis P1 schodzi z kolejki ZAPISANEJ, a stan ma wersję z bazy
  const nowszy = serwerV2(); nowszy.plans[0] = plan('P1', 'z laptopa'); nowszy.plans[0].u = 0;
  const sv = new Serwer(); sv.doc = {v:3, full:1, pm:{P1:{...plan('P1', 'z laptopa'), u:clock.t + 5000}, P2:{...plan('P2', 'Plan B'), u:0}}, po:['P1', 'P2'], pos:0, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{restSet:90, sound:true}};
  const before = cl(A.z.q), mg = ZP.merge(A.S, A.z.q, A.z.kn, ZP.remoteV3(sv.get()), clock.t); A.z.q = mg.q; A.z.kn = mg.kn; A.S = mg.S;
  assert.ok(mg.notes.some(n => n.t === 'remote-later'), 'baza ma nowszą wersję P1');
  ZP.store(ls, 'X', A.z, A.z, A.S, ZP.dropped(before, A.z.q));
  const q2 = ZP.fixZ(ls.get(ZP.zKey('X'), null)).q, st2 = ls.get(ZP.stateKey('X'), null);
  assert.equal(q2.p.P1, undefined, 'wpis zdjęty przez scalenie schodzi też z zapisanej kolejki'); assert.equal(byId(st2, 'P1').name, 'z laptopa', 'stan ma wersję z bazy, nie własną starą z zapisanego stanu');
  assert.deepEqual(Object.keys(q2.pd), ['P2'], 'wpis drugiej karty zostaje');
});
test('26c. stare Z (konto zamknięte i otwarte od nowa) nie dotyka localStorage: ani kolejki, ani stanu', () => {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'); A.edit(S => { byId(S, 'P1').name = 'zmiana'; });
  const przed = JSON.stringify(ls.mem), nowe = ZP.fixZ(ls.get(ZP.zKey('X'), null));
  assert.equal(ZP.store(ls, 'X', nowe, A.z, {...A.S, plans:[]}, {p:{P1:A.z.q.p.P1}}), null); assert.equal(JSON.stringify(ls.mem), przed);
  assert.equal(ZP.store(ls, 'X', null, A.z, A.S), null, 'konto zamknięte (brak bieżącego Z)'); assert.equal(JSON.stringify(ls.mem), przed);
  const o = ZP.settle(ls, 'X', nowe, A.z, {p:{P1:A.z.q.p.P1}, pd:{}, c:{}, cd:{}, s:{}, po:0, co:0, f:0, m:0}, undefined, clock.t, A.S);
  assert.equal(o, null); assert.equal(JSON.stringify(ls.mem), przed, 'settle starego Z zdejmuje wpis tylko z jego własnej kolejki'); assert.deepEqual(A.z.q.p, {});
});

/* Koniec udanej wysyłki drugiej karty, tak jak w `done` w flushFire: ZP.settle zdejmuje wpis z jej kolejki i zapisuje kolejkę oraz stan. */
function wyslano(k, ...idy){
  const sent = {p:{}, pd:{}, c:{}, cd:{}, s:{}, po:0, co:0, f:0, m:0};
  for (const id of idy){ if (k.z.q.p[id] !== undefined) sent.p[id] = k.z.q.p[id]; if (k.z.q.pd[id] !== undefined) sent.pd[id] = k.z.q.pd[id]; }
  return ZP.settle(k.ls, k.fid, k.z, k.z, sent, undefined, clock.t, k.S);
}
test('26d. druga karta WYSŁAŁA zmianę (wpis zszedł z kolejki), pierwsza zapisuje inny plan zanim dostanie migawkę: w stanie zostaje nowa wersja, nowa karta nie wyśle starej treści (A6d-1)', () => {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  B.edit(S => { byId(S, 'P2').name = 'B zmienia P2'; });
  wyslano(B, 'P2');                                                                              // B wysłała P2 i zdjęła wpis; znany czas P2 zostaje
  assert.deepEqual(Object.keys(ZP.fixZ(ls.get(ZP.zKey('X'), null)).q.p), [], 'wpis P2 zszedł z zapisanej kolejki');
  A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });                                          // A nie zna jeszcze zmiany B (brak migawki)
  const st = ls.get(ZP.stateKey('X'), null), q = ZP.fixZ(ls.get(ZP.zKey('X'), null)).q;
  assert.deepEqual(nazwy(st), ['A zmienia P1', 'B zmienia P2'], 'zapisany stan ma nową wersję P2 (B), nie starą z pamięci karty A');
  assert.deepEqual(Object.keys(q.p), ['P1'], 'w kolejce tylko wpis karty A');
  assert.equal(nazwy(A.S)[1], 'Plan B', 'pamięć karty A zostaje bez zmian (cudzych wpisów karta nie wysyła)');
  const C = karta('C', ls, 'X');                                                                  // otwarta później (offline), z localStorage
  assert.deepEqual(nazwy(C.S), ['A zmienia P1', 'B zmienia P2']);
  C.edit(S => { byId(S, 'P2').items[0].sets[0].kg = 25; });
  assert.equal(byId(C.S, 'P2').name, 'B zmienia P2', 'edycja P2 na nowej karcie wychodzi z wersji B, nie ze starej treści');
  assert.deepEqual(nazwy(ls.get(ZP.stateKey('X'), null)), ['A zmienia P1', 'B zmienia P2']);
  // bez poprawki: stan miał „Plan B”, a wpis P2 z nowszym znacznikiem wysłałby starą treść – tu pilnuje tego pierwsza asercja
  const bez = ZP.mergeState({plans:[plan('P1', 'Plan A'), plan('P2', 'B zmienia P2')], custom:[], settings:{}}, {plans:[plan('P1', 'A'), plan('P2', 'Plan B')], custom:[], settings:{}}, ZP.emptyQueue(), ZP.emptyQueue());
  assert.equal(bez.plans[1].name, 'Plan B', 'bez znanych czasów (stary sposób wywołania) funkcja działa jak wcześniej');
});
test('26d-2. własna zmiana tej karty ma pierwszeństwo: wpis w jej kolejce nie jest zastępowany starszą wersją z zapisanego stanu', () => {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  B.edit(S => { byId(S, 'P2').name = 'B zmienia P2'; }); wyslano(B, 'P2');
  A.edit(S => { byId(S, 'P2').name = 'A zmienia P2'; });                                         // A ma własny, późniejszy wpis P2
  assert.deepEqual(nazwy(ls.get(ZP.stateKey('X'), null)), ['Plan A', 'A zmienia P2'], 'stan trzyma własny wpis karty A (scalenie z bazą rozstrzygnie, kto jest późniejszy)');
  assert.ok(ZP.fixZ(ls.get(ZP.zKey('X'), null)).q.p.P2 > 0, 'wpis P2 karty A wraca do zapisanej kolejki (ponowna wysyłka jest idempotentna)');
});
test('26d-3. usunięcie wysłane przez drugą kartę: plan nie wraca do zapisanego stanu po zapisie pierwszej karty; własna edycja tego planu zostaje', () => {
  const t0 = clock.t; clock.t = Date.now();                                                       // nagrobki wygasają po 60 dniach liczonych od Date.now() w saveZ: zegar testu musi być prawdziwy
  try {
  for (const wariant of ['nagrobek z afterSend', 'nagrobek po odczycie z bazy']){
    const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
    B.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); wyslano(B, 'P2');
    if (wariant !== 'nagrobek z afterSend'){                                                     // B dostaje własny zapis z bazy: nagrobek jest już w znanych czasach także z odczytu
      B.z.kn.pt = {}; const doc = {v:3, full:1, pm:{P1:{...plan('P1', 'Plan A'), u:1}}, po:['P1'], pos:0, cm:{}, co:[], cos:0, pt:{P2:B.z.q.pd.P2 || clock.t}, ct:{}, settings:{}};
      ZP.rememberTombs(B.z.kn, doc, clock.t); ZP.store(ls, 'X', B.z, B.z, B.S);
    }
    assert.ok(ZP.fixZ(ls.get(ZP.zKey('X'), null)).kn.pt.P2 > 0, wariant + ': nagrobek w zapisanych znanych czasach');
    A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });
    assert.deepEqual(ids(ls.get(ZP.stateKey('X'), null)), ['P1'], wariant + ': usunięty plan nie wraca do stanu');
    const C = karta('C', ls, 'X'); assert.deepEqual(ids(C.S), ['P1'], wariant + ': nowa karta nie ma usuniętego planu');
  }
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  B.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); wyslano(B, 'P2');
  A.edit(S => { byId(S, 'P2').name = 'A edytuje usunięty'; });                                    // A edytuje plan, który B usunęła: własny wpis, rozstrzyga scalenie z bazą
  assert.deepEqual(nazwy(ls.get(ZP.stateKey('X'), null)), ['Plan A', 'A edytuje usunięty']);
  } finally { clock.t = t0; }
});
test('26d-4. zmiana kolejności planów i ustawienia na drugiej karcie (jeszcze nie wysłane) zostają w zapisanym stanie po zapisie pierwszej', () => {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  B.edit(S => { S.plans.reverse(); S.settings.sound = false; });
  A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });                                          // A zapisuje ostatnia: nie cofa ani kolejności, ani ustawienia
  const st = ls.get(ZP.stateKey('X'), null);
  assert.deepEqual(ids(st), ['P2', 'P1'], 'kolejność planów z drugiej karty zostaje (mq[po] > q[po])');
  assert.equal(st.settings.sound, false, 'ustawienie z drugiej karty zostaje (mq.s ≠ q.s)');
  assert.equal(byId(st, 'P1').name, 'A zmienia P1', 'zmiana karty A też');
  const C = karta('C', ls, 'X'); assert.deepEqual(ids(C.S), ['P2', 'P1']); assert.equal(C.S.settings.sound, false);
});

/* ======================= A6e ======================= */
/* Migawka v3 w karcie – jak handler nasłuchu w openFolder: remoteV3, kn.v3, rememberTombs, merge, zapis przez ZP.store z wpisami zdjętymi przez scalenie. */
function migawkaV3(k, doc, now){
  const before = cl(k.z.q), t = now == null ? clock.t : now;
  k.z.kn.v3 = true; ZP.rememberTombs(k.z.kn, doc, t);
  const mg = ZP.merge(k.S, k.z.q, k.z.kn, ZP.remoteV3(cl(doc)), t); k.z.q = mg.q; k.z.kn = mg.kn; k.S = mg.S; k.last = ZP.snap(k.S);
  ZP.store(k.ls, k.fid, k.z, k.z, k.S, ZP.dropped(before, k.z.q), t); return mg.notes;
}
const DZIEN = 864e5;
/* Karta połączona ze sztucznym serwerem (A6e): odbiór = migawka v3 jak w openFolder, wysyłka = buildWrite + mergeFields + ZP.settle jak `done` w flushFire. */
const serwerV3 = () => { const sv = new Serwer(); sv.doc = {v:3, full:1, pm:{P1:{...plan('P1', 'Plan A'), u:1}, P2:{...plan('P2', 'Plan B'), u:1}}, po:['P1', 'P2'], pos:1, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{restSet:90, sound:true}}; return sv; };
function kartaSv(nazwa, ls, sv){
  const k = karta(nazwa, ls, 'X'); k.sv = sv;
  k.odbierz = () => migawkaV3(k, sv.get(), tick(1));
  k.wyslij = () => {
    if (ZP.emptyQ(k.z.q)) return false;
    const now = tick(1), bw = ZP.buildWrite(k.S, k.z.q, now, {tombs:ZP.tombInfo(sv.get())}); if (!bw) return false;
    sv.merge(bw.data, bw.fields); ZP.settle(ls, 'X', k.z, k.z, bw.sent, undefined, now, k.S); return true;
  };
  return k;
}
test('26e. plan usunięty na INNYM urządzeniu (migawka v3), jedna karta: zapisany stan go nie przywraca, nowa karta go nie ma – także po 61 dniach bez nagrobka (A6e-1)', () => {
  const t0 = clock.t; clock.t = Date.now();                                                       // zapis bez `now` liczy wygasanie nagrobków od Date.now()
  try {
  for (const wariant of ['z nagrobkiem', 'po 61 dniach, nagrobek już wyczyszczony']){
    const ls = wspolnyLS(), A = karta('A', ls, 'X');
    A.edit(S => { byId(S, 'P2').name = 'A zmienia P2'; }); wyslano(A, 'P2');                      // znany czas P2 trafia do zapisanych znanych czasów
    assert.ok(ZP.fixZ(ls.get(ZP.zKey('X'), null)).kn.p.P2 > 0, wariant + ': znany czas P2 zapisany');
    const tDel = tick(), tSnap = wariant === 'z nagrobkiem' ? tick() : (clock.t += 61 * DZIEN);
    const doc = {v:3, full:1, pm:{P1:{...plan('P1', 'Plan A'), u:1}}, po:['P1'], pos:0, cm:{}, co:[], cos:0, pt:wariant === 'z nagrobkiem' ? {P2:tDel} : {}, ct:{}, settings:{restSet:90, sound:true}};
    const notes = migawkaV3(A, doc, tSnap);
    assert.ok(notes.some(n => n.t === 'deleted-remote' && n.id === 'P2'), wariant + ': scalenie widzi usunięcie z innego urządzenia');
    assert.deepEqual(ids(A.S), ['P1'], wariant + ': pamięć karty bez P2');
    assert.deepEqual(ids(ls.get(ZP.stateKey('X'), null)), ['P1'], wariant + ': zapisany stan nie przywraca usuniętego planu (stary znany czas w zapisanej kopii kn)');
    A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });                                       // kolejny zapis tej samej karty też nie przywraca
    assert.deepEqual(ids(ls.get(ZP.stateKey('X'), null)), ['P1'], wariant + ': po kolejnym zapisie dalej bez P2');
    const C = karta('C', ls, 'X');                                                                // nowa karta (np. offline) z localStorage
    assert.deepEqual(ids(C.S), ['P1'], wariant + ': nowa karta nie ma usuniętego planu');
    assert.equal(C.z.q.p.P2, undefined, wariant + ': i nie ma wpisu, który wysłałby go z powrotem do bazy');
  }
  } finally { clock.t = t0; }
});
test('26e-2. plan dodany ponownie (to samo id, np. „Przywróć z kopii”) na karcie A czeka w kolejce; zapis karty B, która nie zna nagrobka, nie wyrzuca go ze stanu; nowa karta ma plan i wpis (A6e-2)', () => {
  const t0 = clock.t; clock.t = Date.now();
  try {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  A.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); wyslano(A, 'P2');              // usunięcie wysłane: nagrobek w znanych czasach A
  assert.ok(ZP.fixZ(ls.get(ZP.zKey('X'), null)).kn.pt.P2 > 0, 'nagrobek P2 w zapisanych znanych czasach');
  A.edit(S => { S.plans.push(plan('P2', 'Przywrócony z kopii')); });                              // ponowne dodanie tego samego id, czeka w kolejce
  assert.ok(A.z.q.p.P2 > A.z.kn.pt.P2, 'wpis P2 nowszy od nagrobka');
  B.edit(S => { byId(S, 'P1').name = 'B zmienia P1'; });                                          // B nie zna nagrobka, nie ma wpisu P2
  const st = ls.get(ZP.stateKey('X'), null), q = ZP.fixZ(ls.get(ZP.zKey('X'), null)).q;
  assert.deepEqual(nazwy(st), ['B zmienia P1', 'Przywrócony z kopii'], 'plan czekający w scalonej kolejce zostaje w zapisanym stanie');
  assert.ok(q.p.P2 > 0, 'wpis P2 karty A w zapisanej kolejce');
  const C = karta('C', ls, 'X');
  assert.deepEqual(nazwy(C.S), ['B zmienia P1', 'Przywrócony z kopii'], 'nowa karta ma przywrócony plan');
  assert.ok(C.z.q.p.P2 > 0, 'nowa karta ma wpis P2');
  const doc = {v:3, full:1, pm:{P1:{...plan('P1', 'Plan A'), u:1}}, po:['P1'], pos:0, cm:{}, co:[], cos:0, pt:{P2:A.z.kn.pt.P2}, ct:{}, settings:{restSet:90, sound:true}};
  migawkaV3(C, doc);                                                                              // scalenie z bazą: wpis nowszy od nagrobka zostaje i czeka na wysyłkę
  assert.ok(ids(C.S).includes('P2'), 'po odczycie z bazy plan zostaje'); assert.ok(C.z.q.p.P2 > 0, 'wpis zostaje do wysłania');
  } finally { clock.t = t0; }
});
test('26e-3. nagrobek nieznany tej karcie, ale znany czas planu nowszy od niego (druga karta usunęła, potem przywróciła i wysłała): plan zostaje w stanie', () => {
  const t0 = clock.t; clock.t = Date.now();
  try {
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  B.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); wyslano(B, 'P2');              // nagrobek P2
  B.edit(S => { S.plans.push(plan('P2', 'Przywrócony przez B')); }); wyslano(B, 'P2');           // przywrócony i wysłany: znany czas P2 > nagrobek, wpisu w kolejce już nie ma
  const zap = ZP.fixZ(ls.get(ZP.zKey('X'), null));
  assert.ok(zap.kn.p.P2 > zap.kn.pt.P2, 'znany czas P2 nowszy od nagrobka'); assert.equal(zap.q.p.P2, undefined, 'wpis P2 zszedł z kolejki');
  A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });                                          // A nie zna ani nagrobka, ani przywrócenia
  assert.deepEqual(nazwy(ls.get(ZP.stateKey('X'), null)), ['A zmienia P1', 'Przywrócony przez B'], 'plan przywrócony po nagrobku zostaje w zapisanym stanie (w wersji B)');
  const C = karta('C', ls, 'X'); assert.deepEqual(nazwy(C.S), ['A zmienia P1', 'Przywrócony przez B'], 'nowa karta ma plan');
  } finally { clock.t = t0; }
});
test('26e-4. nowy plan drugiej karty: w kolejce zostaje w stanie; wysłany, a niewidziany przez tę kartę – nie jest usuwany i wraca z migawką (koszt poprawki A6e-1)', () => {
  const t0 = clock.t; clock.t = Date.now();
  try {
  const v3 = pm => ({v:3, full:1, pm, po:Object.keys(pm), pos:0, cm:{}, co:[], cos:0, pt:{}, ct:{}, settings:{restSet:90, sound:true}});
  { const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');                    // jeszcze w kolejce B: przenosi go pętla po scalonej kolejce
    B.edit(S => { S.plans.push(plan('P3', 'Nowy B')); }); A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });
    assert.deepEqual(ids(ls.get(ZP.stateKey('X'), null)), ['P1', 'P2', 'P3'], 'niewysłany plan drugiej karty zostaje w stanie');
    assert.ok(ZP.fixZ(ls.get(ZP.zKey('X'), null)).q.p.P3 > 0, 'i w kolejce'); }
  const ls = wspolnyLS(), A = karta('A', ls, 'X'), B = karta('B', ls, 'X');
  B.edit(S => { S.plans.push(plan('P3', 'Nowy B')); }); wyslano(B, 'P3');                          // wysłany: jest w bazie, wpis zszedł z kolejki
  A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });                                          // A go nie widziała: w stanie chwilowo go nie ma (wraca z migawką)
  const C = karta('C', ls, 'X'); C.edit(S => { byId(S, 'P2').name = 'C zmienia P2'; });           // nowa karta otwarta w tej przerwie zapisuje coś innego
  assert.equal(ZP.fixZ(ls.get(ZP.zKey('X'), null)).q.pd.P3, undefined, 'brak P3 w stanie NIE staje się usunięciem w kolejce');
  const doc = v3({P1:{...plan('P1', 'A zmienia P1'), u:1}, P2:{...plan('P2', 'Plan B'), u:1}, P3:{...plan('P3', 'Nowy B'), u:clock.t}});
  migawkaV3(C, doc); assert.ok(ids(C.S).includes('P3'), 'nowa karta ma P3 po migawce'); assert.equal(byId(C.S, 'P2').name, 'C zmienia P2', 'jej zmiana zostaje');
  migawkaV3(A, doc); assert.deepEqual(ids(ls.get(ZP.stateKey('X'), null)).sort(), ['P1', 'P2', 'P3'], 'po migawce P3 wraca do zapisanego stanu');
  } finally { clock.t = t0; }
});
test('26e-5. własne ćwiczenie usunięte na INNYM urządzeniu (migawka v3), jedna karta: zapisany stan go nie przywraca, nowa karta go nie ma (A6e-1 dla custom)', () => {
  const t0 = clock.t; clock.t = Date.now();
  try {
  const ls = wspolnyLS(), A = karta('A', ls, 'X');
  A.edit(S => { S.custom.push({id:'C1', name:'Moje', custom:true}); });
  ZP.settle(ls, 'X', A.z, A.z, {p:{}, pd:{}, c:{C1:A.z.q.c.C1}, cd:{}, s:{}, po:0, co:0, f:0, m:0}, undefined, clock.t, A.S);   // wysłane: znany czas C1 zapisany
  assert.ok(ZP.fixZ(ls.get(ZP.zKey('X'), null)).kn.c.C1 > 0, 'znany czas C1 zapisany');
  const doc = {v:3, full:1, pm:{P1:{...plan('P1', 'Plan A'), u:1}, P2:{...plan('P2', 'Plan B'), u:1}}, po:['P1', 'P2'], pos:0, cm:{}, co:[], cos:0, pt:{}, ct:{C1:tick()}, settings:{restSet:90, sound:true}};
  const notes = migawkaV3(A, doc);
  assert.ok(notes.some(x => x.t === 'deleted-remote' && x.kind === 'c' && x.id === 'C1'), 'scalenie widzi usunięcie ćwiczenia');
  A.edit(S => { byId(S, 'P1').name = 'A zmienia P1'; });
  assert.deepEqual(ls.get(ZP.stateKey('X'), null).custom, [], 'zapisany stan nie przywraca usuniętego ćwiczenia');
  const C = karta('C', ls, 'X'); assert.deepEqual(C.S.custom, [], 'nowa karta go nie ma'); assert.equal(C.z.q.c.C1, undefined);
  } finally { clock.t = t0; }
});

test('26e-6. wpis w kolejce z ZAMKNIĘTEJ karty, starszy niż nagrobek z innego urządzenia: plan trzyma się w stanie razem z wpisem, znika przy pierwszej nowej karcie i nie trafia do bazy', () => {
  const t0 = clock.t; clock.t = Date.now();
  try {
  const sv = serwerV3(), ls = wspolnyLS(), A = kartaSv('A', ls, sv), B = kartaSv('B', ls, sv), C = kartaSv('C', ls, sv); A.odbierz(); B.odbierz(); C.odbierz();
  A.edit(S => { byId(S, 'P2').name = 'A edytuje (wcześniej)'; });                                // wpis A czeka; potem karta A zostaje zamknięta, zanim wyśle
  const pend = A.z.q.p.P2;
  const D = kartaSv('D', wspolnyLS(), sv); D.odbierz(); D.edit(S => { S.plans = S.plans.filter(p => p.id !== 'P2'); }); D.wyslij();   // usunięcie z innego urządzenia, później
  const tomb = sv.doc.pt.P2; assert.ok(tomb > pend, 'nagrobek późniejszy niż wpis z zamkniętej karty'); assert.equal(sv.doc.pm.P2, undefined);
  B.odbierz();                                                                                   // B zna nagrobek
  C.edit(S => { byId(S, 'P1').name = 'C zmienia P1'; });                                          // C nie zna nagrobka; w scalonej kolejce jest wpis zamkniętej karty
  for (let i = 0; i < 3; i++) for (const k of [B, C]){ k.odbierz(); k.wyslij(); }                // otwarte karty dostają migawki i wysyłają swoje zmiany
  assert.deepEqual(ids(ls.get(ZP.stateKey('X'), null)).sort(), ['P1', 'P2'], 'plan zostaje w stanie, bo jego wpis wciąż czeka (stan i kolejka spójne)');
  assert.equal(ZP.fixZ(ls.get(ZP.zKey('X'), null)).q.p.P2, pend, 'wpis zamkniętej karty czeka w zapisanej kolejce');
  assert.equal(sv.doc.pm.P2, undefined, 'otwarte karty nie wysłały cudzego wpisu');
  const N = kartaSv('N', ls, sv);                                                                 // pierwsza nowa karta: wczytuje wpis i plan z localStorage
  assert.ok(N.z.q.p.P2 > 0 && ids(N.S).includes('P2'));
  const notes = N.odbierz(); N.wyslij();
  assert.ok(notes.some(x => x.t === 'deleted-later' && x.id === 'P2'), 'scalenie z bazą: nagrobek późniejszy niż wpis');
  assert.ok(!ids(N.S).includes('P2'), 'nowa karta nie ma planu'); assert.equal(N.z.q.p.P2, undefined);
  assert.equal(sv.doc.pm.P2, undefined, 'plan nie trafia do bazy'); assert.equal(sv.doc.pt.P2, tomb, 'nagrobek bez zmian');
  assert.ok(!ids(ls.get(ZP.stateKey('X'), null)).includes('P2'), 'zapisany stan bez planu'); assert.equal(ZP.fixZ(ls.get(ZP.zKey('X'), null)).q.p.P2, undefined, 'zapisana kolejka bez wpisu');
  assert.ok(!ids(kartaSv('N2', ls, sv).S).includes('P2'), 'kolejna nowa karta też nie ma planu');
  } finally { clock.t = t0; }
});
test('27. nagrobek w remoteOld: urządzenie, które NIGDY nie widziało planu, nie wskrzesza go po zapisie starej karty (chroni nagrobek, nie historia wersji)', () => {
  const sv = new Serwer();
  sv.doc = {v:3, full:1, pm:{P1:{...plan('P1', 'Plan A'), u:0}, P2:{...plan('P2', 'Plan B'), u:0}}, po:['P1', 'P2'], pos:0, cm:{}, co:[], cos:0, pt:{P3:clock.t}, ct:{}, settings:{restSet:90, sound:true}};
  sv.doc.plans = [plan('P1', 'Plan A'), plan('P2', 'Plan B')]; sv.doc.custom = [];
  const nowy = new Urz('nowy', sv, {plans:[], custom:[], settings:{restSet:90, sound:true}}); nowy.off = 0;   // P3 nigdy nie było na tym urządzeniu
  nowy.odbierz(); assert.deepEqual(ids(nowy.S), ['P1', 'P2']); assert.deepEqual(nowy.z.kn.pt, {P3:clock.t}, 'nagrobek zapamiętany z układu v3');
  assert.equal(nowy.z.kn.h.p.P3, undefined, 'urządzenie nie ma żadnej historii wersji P3 – wskrzeszenia nie może zatrzymać historia');
  // stara karta zapisuje cały dokument w starym układzie i dokłada plan P3, który ktoś już usunął (nagrobek)
  sv.doc = {v:2, plans:[plan('P1', 'Plan A'), plan('P2', 'Plan B'), plan('P3', 'usunięty gdzie indziej')], custom:[], settings:{restSet:90, sound:true}};
  const notes = nowy.odbierz();
  assert.deepEqual(ids(nowy.S), ['P1', 'P2'], 'plan z nagrobkiem nie wraca'); assert.equal(nowy.z.q.p.P3, undefined, 'i nie trafia do kolejki (nie zostanie odtworzony w bazie)');
  assert.ok(notes.some(n => n.t === 'old-card-ignored' && n.id === 'P3'), 'ścieżka „ignoruj” po nagrobku');
  // ta sama sytuacja BEZ nagrobka: plan ze starej karty to nowy plan i zostaje (żeby test nie przechodził z innego powodu)
  const inny = new Urz('inny', sv, {plans:[], custom:[], settings:{restSet:90, sound:true}}); inny.z.kn.v3 = true;
  inny.odbierz(); assert.deepEqual(ids(inny.S), ['P1', 'P2', 'P3'], 'bez nagrobka plan ze starej karty jest nowy');
});

test('28. migracja wstrzymana (dokument bez plans i pm): lokalne plany NIE znikają z widoku, zmiana czeka; po kolejnym odczycie z poprawnym dokumentem migracja rusza', () => {
  const sv = new Serwer(), ust = {restSet:60};
  sv.doc = {settings:ust};
  const d = new Urz('tel', sv, {plans:[plan('P1', 'lokalny A'), plan('P2', 'lokalny B')], custom:[], settings:{restSet:90, sound:true}});
  d.edit(S => { byId(S, 'P1').name = 'zmiana czeka'; });                                    // P1 ma wpis w kolejce, P2 nie ma
  // dlaczego trzeba osobnego trybu: scalenie jak z pustym dokumentem w starym układzie odrzuca plan bez wpisu w kolejce (P2) – baza zostaje nietknięta, ale widok traci plan
  const jakPusty = ZP.merge(d.S, d.z.q, d.z.kn, ZP.remoteOld({plans:[], custom:[], settings:{}}, false, {}), clock.t);
  assert.deepEqual(ids(jakPusty.S), ['P1'], 'tak by się stało bez poprawki (plan P2 bez wpisu w kolejce znika z widoku)');
  const przed = cl(d.S), qPrzed = cl(d.z.q);
  const notes = d.odbierz();
  assert.deepEqual(notes.map(n => n.t), ['hold']); assert.deepEqual(d.S, przed, 'plany i ustawienia lokalne bez zmian'); assert.deepEqual(d.z.q, qPrzed, 'kolejka bez zmian');
  assert.equal(d.wyslij(), false); assert.equal(sv.zapisy.length, 0); assert.deepEqual(sv.get(), {settings:ust}, 'baza nietknięta');
  sv.doc = {settings:ust, plans:[plan('P1', 'lokalny A'), plan('P2', 'lokalny B')], custom:[]};   // dokument dostał tablicę plans (kolejny odczyt z bazy)
  uspokoj(d);
  assert.equal(ZP.layout(sv.doc), 'v3'); assert.equal(sv.doc.pm.P1.name, 'zmiana czeka'); assert.deepEqual(ids(d.S), ['P1', 'P2']);
  for (const dok of [{}, {v:2}, {plans:'nie tablica'}, {pm:[]}, {settings:ust}]) assert.equal(ZP.holdDoc(dok), true, JSON.stringify(dok));
  for (const dok of [{v:2, plans:[]}, {pm:{}}, null, {v:3, full:1, pm:{}, cm:{}}]) assert.equal(ZP.holdDoc(dok), false, JSON.stringify(dok));
});

test('29. znane nagrobki (kn.pt, kn.ct) wygasają po 60 dniach także w zapisanej kopii; młodsze zostają', () => {
  const ls = wspolnyLS(), key = 'dz.f.X.zq', teraz = 1800000000000, dzien = 864e5;
  ls.set(key, {q:ZP.emptyQueue(), kn:{...ZP.emptyKnown(), pt:{STARY:teraz - 61 * dzien, MLODY:teraz - 5 * dzien}, ct:{STARYC:teraz - 90 * dzien}}});   // zapisane wcześniej, w tym wygasłe
  const z = ZP.fixZ(null); z.kn.pt = {NOWY:teraz - dzien, TEZSTARY:teraz - 100 * dzien}; z.kn.ct = {C2:teraz - 2 * dzien};
  const out = ZP.saveZ(ls, key, z, undefined, teraz);
  assert.deepEqual(Object.keys(out.kn.pt).sort(), ['MLODY', 'NOWY'], 'starsze niż 60 dni znikają, i zapisane wcześniej, i z tej karty'); assert.deepEqual(Object.keys(out.kn.ct), ['C2']);
  assert.deepEqual(ZP.fixZ(ls.get(key, null)).kn.pt, out.kn.pt);
});

test('30. rozmiar: ostrzeżenie przy zwykłym zapisie liczy bajty UTF-8 i mieści się między progiem lustra a limitem bazy', () => {
  assert.ok(ZP.DOC_MAX < ZP.DOC_WARN && ZP.DOC_WARN < 1048576, 'próg lustra < próg ostrzeżenia < limit 1 MiB');
  assert.equal(ZP.docBytes({a:'ż'}), Buffer.byteLength(JSON.stringify({a:'ż'})), 'bajty UTF-8, nie znaki'); assert.ok(ZP.docBytes({a:'ż'}) > JSON.stringify({a:'ż'}).length);
});

/* Test statyczny kodu strony: te miejsca w app.html nie są osiągalne z Node, a test 22 i 24 sprawdzają tylko funkcje z zapis.js. Wywołania sprawdza też krok „zapis: dwie karty…” w teście dymnym. */
const fs = require('node:fs'), APP = fs.readFileSync(path.join(__dirname, '..', '..', 'zrodla', 'src', 'app.html'), 'utf8');
function ciało(src, start){   // treść od podanego początku do zamykającego nawiasu klamrowego
  const i = src.indexOf(start); assert.ok(i >= 0, 'w app.html nie ma: ' + start);
  let d = 0, j = src.indexOf('{', i); for (let k = j; k < src.length; k++){ if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); }
  throw new Error('niezamknięty blok: ' + start);
}
test('31. app.html: usunięcie konta (folderDeleteGo) kasuje klucze z ZP.accountKeys PO usunięciu danych w bazie; zapis kolejki i stanu tylko przez ZP.store / ZP.settle', () => {
  const del = ciało(APP, 'async folderDeleteGo(f){');
  assert.ok(del.includes('ZP.accountKeys(f.id).forEach(k => LS.del(k))'), 'folderDeleteGo czyści klucze konta (.zq, .unsent) przez ZP.accountKeys');
  assert.ok(del.indexOf('ZP.accountKeys(f.id)') > del.indexOf("FB.deleteDoc(FB.doc(FB.db, 'folders', f.id, 'data', 'state'))"), 'czyszczenie po usunięciu dokumentu w bazie (przy błędzie sieci nic nie jest skasowane lokalnie)');
  assert.ok(del.indexOf('ZP.accountKeys(f.id)') < del.indexOf("toast('Usunięto konto.')"));
  const fire = ciało(APP, 'function flushFire(){');
  const done = fire.slice(fire.indexOf('const done = '), fire.indexOf('\n', fire.indexOf('const done = ')));
  assert.ok(done.includes('ZP.settle(LS, fid, zCur(fid), z, sent, written'), 'done zapisuje przez ZP.settle z bieżącym Z konta (stare Z nie nadpisuje kolejki nowego)');
  assert.ok(/const zCur = fid => \(FOLDER && FOLDER\.id === fid \? Z : null\)/.test(APP), 'zCur: bieżące Z tylko dla otwartego konta');
  assert.ok(fire.includes('ZP.store(LS, fid, zCur(fid), z, S, {f:f0})'), 'ścieżka noop zapisuje przez ZP.store z bieżącym Z');
  assert.ok(ciało(APP, 'function flushMirror(').includes('ZP.store(LS, fid, zCur(fid), z, S, {m})'), 'koniec transakcji lustra zapisuje przez ZP.store z bieżącym Z');
  const open = ciało(APP, 'function openFolder(f){'), persist = ciało(APP, 'function persist(){');
  assert.ok(open.includes("S = normalize(LS.get(ZP.stateKey(f.id), null))"), 'konto otwiera się ze stanu z tego samego klucza, do którego pisze ZP.store');
  assert.ok(open.includes('ZP.store(LS, fid, Z, Z, S, ZP.dropped(qBefore, Z.q))'), 'handler odczytu z bazy zapisuje przez ZP.store i zdejmuje z zapisanej kolejki to, co sam usunął');
  assert.ok(persist.slice(0, persist.indexOf('LS.set(k, S)')).includes('ZP.store(LS, FOLDER.id, Z, Z, S)'), 'persist w trybie fire zapisuje przez ZP.store, a bezpośredni LS.set stanu jest dopiero po nim (tryby local i cloud)');
  assert.ok(persist.indexOf('LS.set(k, S)') > persist.indexOf('return;'), 'bezpośredni zapis stanu nie dotyczy trybu fire');
  // Wyrażenie jest statyczne, więc nie widzi wszystkiego (np. klucza zbudowanego z kawałków tekstu) – drugą połową jest strażnik w kroku dymnym A6c (wykonanie: LS.set na kluczu .zq/.state poza ZP.store/ZP.settle).
  // Jedyny dozwolony bezpośredni zapis stanu: persist w trybach local i cloud (tryb fire wychodzi wcześniej przez ZP.store).
  const dozwolony = "const k = lsKey('state'); if (k) LS.set(k, S);";
  assert.equal(APP.split(dozwolony).length - 1, 1, 'dokładnie jeden bezpośredni zapis stanu: w persist (tryby local i cloud)');
  const bez = APP.replace(dozwolony, ''), klucz = String.raw`(?:lsKey\('state'\)|(?:ZP\.)?(?:stateKey|zKey)\([^)]*\))`, zapis = String.raw`(?:LS\.set|localStorage\.setItem)\(\s*`;
  assert.ok(!/zSaveFor|ZP\.saveZ\(|ZP\.saveAll\(/.test(bez), 'żadnych osobnych ścieżek zapisu kolejki i stanu w app.html (saveZ/saveAll tylko przez ZP.store / ZP.settle)');
  assert.ok(!new RegExp(zapis + klucz).test(bez), 'żadnego LS.set na kluczu stanu (.state) ani kolejki (.zq) wprost (lsKey(\'state\'), ZP.stateKey, ZP.zKey, zKey)');
  for (const m of bez.matchAll(new RegExp(String.raw`(?:const|let|var)\s+(\w+)\s*=\s*` + klucz, 'g')))   // klucz zapisany w zmiennej, a zapis przez zmienną
    assert.ok(!new RegExp(zapis + m[1] + String.raw`\s*,`).test(bez), 'zapis przez zmienną ' + m[1] + ' z kluczem stanu/kolejki poza ZP.store / ZP.settle');
  assert.ok(open.includes('ZP.holdDoc(doc)') && open.includes('ZP.remoteHold()') && open.includes('zHoldToast()'), 'odczyt nieznanego kształtu: bez scalania z pustym dokumentem, z komunikatem');
  assert.ok(ciało(APP, 'function flushFire(){').includes('zHoldToast()'), 'wstrzymana migracja w transakcji też pokazuje komunikat');
});

console.log(`\n${n} testów zaliczonych, ${bledy} błędów`);
process.exit(bledy ? 1 : 0);
