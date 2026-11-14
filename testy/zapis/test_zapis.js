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
  edit(fn){ fn(this.S); this.last = ZP.diff(this.last, this.S, this.z.q, this.now); }
  odbierz(){
    const doc = this.sv.get(), lay = ZP.layout(doc);
    this.lay = lay; if (lay === 'empty') return [];
    let R;
    if (lay === 'v3'){ R = ZP.remoteV3(doc); this.z.kn.v3 = true; this.tombs = {pt:doc.pt || {}, ct:doc.ct || {}}; }
    else R = ZP.remoteOld({plans:doc.plans || [], custom:doc.custom || [], settings:{...blank().settings, ...(doc.settings || {})}}, this.z.kn.v3);
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
      if (!bw) return false;
      if (!this.online){ this.outbox.push(bw); return true; }          // SDK trzyma zapis, aż wróci sieć
      this.sv.merge(bw.data, bw.fields); ZP.afterSend(this.z, bw.sent); return true;
    }
    if (!this.online) return false;                                       // migracja = transakcja, wymaga sieci
    const tx = ZP.migrate(this.S, this.z, this.sv.get(), this.now, doc => ({plans:doc.plans || [], custom:doc.custom || [], settings:{...blank().settings, ...(doc.settings || {})}}));
    if (tx.noop){ this.z.q.f = 0; this.lay = 'v3'; return this.wyslij(); }        // ktoś już naprawił: zwykły zapis
    this.sv.setFull(tx.doc); ZP.afterSend(this.z, tx.sent, tx.written); this.lay = 'v3'; if (tx.repaired) this.repaired++;
    return true;
  }
  wracaSiec(){ this.online = true; for (const bw of this.outbox.splice(0)){ this.sv.merge(bw.data, bw.fields); ZP.afterSend(this.z, bw.sent); } }
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
  assert.ok(bw.fields.includes('plans') && bw.fields.includes('custom'), 'lustro starego układu idzie przy zmianie planów');
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
test('12b. id z listy bez treningu w pamięci nie wraca jako pusty wpis; lista osobna dla konta', () => {
  const m = ZP.mergeSessions([], [], ['T-zgubiony'], false);
  assert.deepEqual(m.list, []); assert.deepEqual(m.unsent, []);
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

console.log(`\n${n} testów zaliczonych, ${bledy} błędów`);
process.exit(bledy ? 1 : 0);
