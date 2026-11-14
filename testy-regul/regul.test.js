// Testy reguł Firestore (firestore.rules) – uruchamiane na emulatorze, przed każdym wdrożeniem reguł.
// Uruchomienie: cd testy-regul && npm ci && npx --yes firebase-tools@13.35.1 emulators:exec --only firestore --project demo-dziennik "npm test"
// Każdy przypadek „wolno” ma swoją parę „nie wolno”. Testy sprawdzają zachowanie reguł, nie ich treść.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, limit, writeBatch,
  serverTimestamp, Timestamp, runTransaction,
} = require('firebase/firestore');

const FID = 'f1';            // folder, w którym UID_CZLONEK jest członkiem
const UID_CZLONEK = 'czlonek';
const UID_OBCY = 'obcy';
const HASH = 'a'.repeat(64);  // skrót PIN-u (64 znaki)
const HASH_ZLY = 'b'.repeat(64);  // skrót błędnego PIN-u
const HASH_NOWY = 'c'.repeat(64); // skrót nowego PIN-u (zmiana PIN-u)
const EAN = '5901234123457';
const GRUPA_W = 'w_' + 'a'.repeat(12);
const MIN = 60 * 1000;
const DOBA = 24 * 60 * MIN;

let testEnv;

const jako = (uid) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const czlonek = () => jako(UID_CZLONEK);
const obcy = () => jako(UID_OBCY);

const produkt = (extra = {}) => ({
  n: 'Jajko', brand: '', u: 'g', k: 150, b: 12, w: 1, t: 10, f: 1,
  pg: 50, po: '1 jajko M', q: '', src: 'user', at: 1, ...extra,
});
const plan = (extra = {}) => ({
  fid: FID, from: 'Kamil', plan: { name: 'Plan A', items: [] }, custom: [], updatedAt: 1, ...extra,
});
const grupaFix = (extra = {}) => ({ u: 'g', k: 160, b: 10, w: 2, t: 8, f: 1, pg: 50, po: '1 jajko M', c: 1, at: 1, ...extra });

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => { await fn(ctx.firestore()); });
}
// Konto z danymi sprzed A3: wpis członka {hash, at} bez pola gen, folder bez gen. Opcje: gen (generacja folderu),
// czlonekGen (generacja wpisu członka), pin (czy istnieje secret/pin; wtedy folder ma też pin: true).
async function seedFolder(db, fid = FID, { czlonekUid = UID_CZLONEK, pin = true, gen = 0, czlonekGen = 0 } = {}) {
  await setDoc(doc(db, 'folders', fid), { name: 'Kamil', createdAt: 1, updatedAt: 1, ...(pin ? { pin: true } : {}), ...(gen ? { gen } : {}) });
  if (pin) await setDoc(doc(db, 'folders', fid, 'secret', 'pin'), { hash: HASH });
  if (czlonekUid) await setDoc(doc(db, 'folders', fid, 'members', czlonekUid), { hash: HASH, at: 1, ...(czlonekGen ? { gen: czlonekGen } : {}) });
}

// --- bramka prób, żeton, wejście ---------------------------------------------------------------
const tsAgo = (min) => Timestamp.fromMillis(Date.now() - min * MIN);
const gateRef = (db, fid = FID) => doc(db, 'folders', fid, 'secret', 'gate');
const triesRef = (db, uid, fid = FID) => doc(db, 'folders', fid, 'tries', uid);
// Dane bramki z czasami „N minut temu” (okno 15 min i okno dobowe).
const gateData = ({ n15, w15Min, nd, wdMin }) => ({ n15, w15: tsAgo(w15Min), nd, wd: tsAgo(wdMin), at: tsAgo(Math.min(w15Min, wdMin)) });
const seedGate = (data, fid = FID) => seed((db) => setDoc(gateRef(db, fid), gateData(data)));
const seedTry = (uid, hash, minAgo, fid = FID) => seed((db) => setDoc(triesRef(db, uid, fid), { hash, at: tsAgo(minAgo) }));
// Ta sama transakcja co pinTry w app.html, ale bez sprawdzania limitu po stronie klienta – limit sprawdzają reguły.
async function proba(db, uid, hash, fid = FID) {
  await runTransaction(db, async (tx) => {
    const g = await tx.get(gateRef(db, fid));
    const now = Date.now();
    if (!g.exists()) {
      tx.set(gateRef(db, fid), { n15: 1, w15: serverTimestamp(), nd: 1, wd: serverTimestamp(), at: serverTimestamp() });
    } else {
      const o = g.data();
      const nowe15 = now > o.w15.toMillis() + 15 * MIN;
      const noweDzien = now > o.wd.toMillis() + DOBA;
      tx.set(gateRef(db, fid), {
        n15: nowe15 ? 1 : o.n15 + 1, w15: nowe15 ? serverTimestamp() : o.w15,
        nd: noweDzien ? 1 : o.nd + 1, wd: noweDzien ? serverTimestamp() : o.wd,
        at: serverTimestamp(),
      });
    }
    tx.set(triesRef(db, uid, fid), { hash, at: serverTimestamp() });
  });
}
// Zapis własnego wpisu members (wejście na konto); gen tylko, gdy > 0 (jak w aplikacji).
const wejdz = (db, uid, hash, gen = 0, fid = FID) =>
  setDoc(doc(db, 'folders', fid, 'members', uid), { hash, at: Date.now(), ...(gen ? { gen } : {}) });
// Nowe konto: folder + secret/pin + własny wpis members w jednym zapisie grupowym (pinGo, tryb „new”).
const nowyFolder = (extra = {}) => ({ name: 'Ala', createdAt: 1, updatedAt: 1, pin: true, ...extra });
function nowyBatch(db, uid, fid, { folder = nowyFolder(), pin = { hash: HASH }, wpis = { hash: HASH, at: 1 }, bezFolderu = false, bezSekretu = false, bezWpisu = false } = {}) {
  const b = writeBatch(db);
  if (!bezFolderu) b.set(doc(db, 'folders', fid), folder);
  if (!bezSekretu) b.set(doc(db, 'folders', fid, 'secret', 'pin'), pin);
  if (!bezWpisu) b.set(doc(db, 'folders', fid, 'members', uid), wpis);
  return b.commit();
}
// Zmiana PIN-u (ACT.pinChange): folder gen+1, secret/pin z nowym skrótem, własny wpis members z nowym gen – jeden zapis grupowy.
function zmianaBatch(db, uid, { gen = 1, hash = HASH_NOWY, folder = true, sekret = true, wpisGen = gen, wpisHash = hash } = {}) {
  const b = writeBatch(db);
  if (folder) b.update(doc(db, 'folders', FID), { gen, updatedAt: 2 });
  if (sekret) b.update(doc(db, 'folders', FID, 'secret', 'pin'), { hash });
  b.set(doc(db, 'folders', FID, 'members', uid), { hash: wpisHash, at: 2, ...(wpisGen ? { gen: wpisGen } : {}) });
  return b.commit();
}
// Usunięcie konta (ACT.folderDeleteGo): folder + secret/pin + secret/gate w jednym zapisie grupowym.
function usunBatch(db, { folder = true, sekret = true, bramka = true } = {}) {
  const b = writeBatch(db);
  if (folder) b.delete(doc(db, 'folders', FID));
  if (sekret) b.delete(doc(db, 'folders', FID, 'secret', 'pin'));
  if (bramka) b.delete(gateRef(db));
  return b.commit();
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-dziennik',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
  });
});
after(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearFirestore(); });

describe('folders/{fid}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('odczyt folderu: wolno każdemu, także bez logowania', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'folders', FID)));
    await assertSucceeds(getDoc(doc(obcy(), 'folders', FID)));
  });
  it('utworzenie folderu (nowe konto): folder z pin: true + secret/pin + własny wpis w jednym zapisie – tak; czlonek nowego konta czyta i zapisuje dane', async () => {
    const db = jako('nowy');
    await assertSucceeds(nowyBatch(db, 'nowy', 'nowe1'));
    await assertSucceeds(setDoc(doc(db, 'folders', 'nowe1', 'data', 'state'), { x: 1 }));
    await assertSucceeds(getDoc(doc(db, 'folders', 'nowe1', 'data', 'state')));
    await assertSucceeds(nowyBatch(jako('nowy2'), 'nowy2', 'nowe2', { folder: nowyFolder({ name: 'A'.repeat(40) }) }));
  });
  it('utworzenie folderu: sam folder bez sekretu; pin: false; bez pola pin; gen: 1; sekret bez folderu w zapisie – nie', async () => {
    const db = obcy();
    await assertFails(setDoc(doc(db, 'folders', 'nowe1'), nowyFolder()));                                  // sam folder (brak secret/pin po zapisie)
    await assertFails(nowyBatch(db, UID_OBCY, 'nowe2', { folder: nowyFolder({ pin: false }) }));            // pin: false
    await assertFails(nowyBatch(db, UID_OBCY, 'nowe3', { folder: { name: 'Ala', createdAt: 1, updatedAt: 1 } })); // bez pola pin
    await assertFails(nowyBatch(db, UID_OBCY, 'nowe4', { folder: nowyFolder({ gen: 1 }) }));                // gen: 1 przy tworzeniu
    await assertFails(nowyBatch(db, UID_OBCY, 'nowe5', { bezFolderu: true, bezWpisu: true }));              // sekret bez folderu
    await assertSucceeds(nowyBatch(db, UID_OBCY, 'nowe6'));                                                // para: poprawne konto
  });
  it('utworzenie folderu: bez logowania, dodatkowe pole, pusta lub za długa nazwa, pin nie-bool – nie', async () => {
    await assertFails(nowyBatch(anon(), 'anon', 'nowe1'));
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe2', { folder: nowyFolder({ extra: 1 }) }));
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe3', { folder: nowyFolder({ name: '' }) }));
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe4', { folder: nowyFolder({ name: 'A'.repeat(41) }) }));
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe5', { folder: nowyFolder({ pin: 'tak' }) }));
  });
  it('zmiana folderu (dotychczasowy członek bez gen): członek – tak; nie-członek i niezalogowany – nie', async () => {
    await assertSucceeds(updateDoc(doc(czlonek(), 'folders', FID), { name: 'Nowa' }));
    await assertFails(updateDoc(doc(obcy(), 'folders', FID), { name: 'Nowa' }));
    await assertFails(updateDoc(doc(anon(), 'folders', FID), { name: 'Nowa' }));
  });
  it('zmiana folderu: pin z true na false, gen bez zmiany sekretu, gen w dół – nie', async () => {
    await assertFails(updateDoc(doc(czlonek(), 'folders', FID), { pin: false }));
    await assertFails(updateDoc(doc(czlonek(), 'folders', FID), { gen: 1 }));
    await seed((db) => seedFolder(db, 'f2', { gen: 1, czlonekGen: 1 }));
    await assertFails(updateDoc(doc(jako(UID_CZLONEK), 'folders', 'f2'), { gen: 0 }));
  });
});

describe('usunięcie konta (folders/{fid} + secret/pin + secret/gate)', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('9a: członek ze świeżym żetonem poprawnego PIN-u usuwa folder, sekret i bramkę w jednym zapisie – tak', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertSucceeds(usunBatch(db));
  });
  it('9b: bez żetonu – nie', async () => {
    await assertFails(usunBatch(czlonek()));
  });
  it('9b: żeton ze złym PIN-em – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH_ZLY);
    await assertFails(usunBatch(db));
  });
  it('9b: żeton starszy niż 15 min – nie', async () => {
    await seedTry(UID_CZLONEK, HASH, 16);
    await assertFails(usunBatch(czlonek()));
  });
  it('9b: bez usunięcia secret/pin w tym samym zapisie – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertFails(usunBatch(db, { sekret: false }));
    await assertFails(deleteDoc(doc(db, 'folders', FID)));
  });
  it('9b: przez obcego (nawet z żetonem poprawnego PIN-u) – nie', async () => {
    const db = obcy();
    await proba(db, UID_OBCY, HASH);
    await assertFails(usunBatch(db));
  });
});

describe('folders/{fid}/secret/pin', () => {
  it('odczyt: nikt, także członek – nie', async () => {
    await seed((db) => seedFolder(db));
    await assertFails(getDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin')));
    await assertFails(getDoc(doc(obcy(), 'folders', FID, 'secret', 'pin')));
  });
  it('utworzenie przy nowym koncie: hash innej długości, dodatkowe pole, brak logowania – nie', async () => {
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe1', { pin: { hash: 'a'.repeat(63) } }));
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe2', { pin: { hash: 'a'.repeat(65) } }));
    await assertFails(nowyBatch(obcy(), UID_OBCY, 'nowe3', { pin: { hash: HASH, extra: 1 } }));
    await assertFails(nowyBatch(anon(), 'anon', 'nowe4'));
  });
  it('utworzenie: inny dokument w secret/ – nie', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false, czlonekUid: UID_CZLONEK }));
    await assertFails(setDoc(doc(czlonek(), 'folders', FID, 'secret', 'inny'), { hash: HASH }));
  });
  it('8a: obcy zakłada sekret na istniejącym koncie bez PIN-u – nie', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false, czlonekUid: null }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: HASH_NOWY }));
  });
  it('8c: członek konta bez PIN-u ustawia PIN (folder pin: true + secret/pin + własny wpis w jednym zapisie) – tak', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false }));
    const db = czlonek();
    const b = writeBatch(db);
    b.update(doc(db, 'folders', FID), { pin: true, updatedAt: 2 });
    b.set(doc(db, 'folders', FID, 'secret', 'pin'), { hash: HASH_NOWY });
    b.set(doc(db, 'folders', FID, 'members', UID_CZLONEK), { hash: HASH_NOWY, at: 2 });
    await assertSucceeds(b.commit());
    // od teraz obcy nie wejdzie bez PIN-u
    await assertFails(wejdz(obcy(), UID_OBCY, HASH_NOWY));
  });
  it('8c: pin: true bez secret/pin w zapisie – nie; obcy z takim zapisem – nie', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false }));
    await assertFails(updateDoc(doc(czlonek(), 'folders', FID), { pin: true }));
    const db = obcy();
    const b = writeBatch(db);
    b.update(doc(db, 'folders', FID), { pin: true, updatedAt: 2 });
    b.set(doc(db, 'folders', FID, 'secret', 'pin'), { hash: HASH_NOWY });
    b.set(doc(db, 'folders', FID, 'members', UID_OBCY), { hash: HASH_NOWY, at: 2 });
    await assertFails(b.commit());
  });
  it('8b: usunięcie sekretu: obcy – nie; członek bez usuwania folderu – nie', async () => {
    await seed((db) => seedFolder(db));
    await assertFails(deleteDoc(doc(obcy(), 'folders', FID, 'secret', 'pin')));
    await assertFails(deleteDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin')));
  });
});

describe('zmiana PIN-u (generacja dostępu)', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('7a: członek z żetonem OBECNEGO PIN-u zmienia PIN (folder gen+1, secret/pin, własny wpis z gen) – tak', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertSucceeds(zmianaBatch(db, UID_CZLONEK));
    await assertSucceeds(getDoc(doc(db, 'folders', FID, 'data', 'state')));                 // urządzenie, które zmieniło PIN, działa dalej
  });
  it('7b: po zmianie stare urządzenie (wpis bez gen) traci dostęp; po próbie z nowym PIN-em i wpisie z gen 1 – wchodzi', async () => {
    await seed((db) => setDoc(doc(db, 'folders', FID, 'members', 'stary'), { hash: HASH, at: 1 }));
    await seed((db) => setDoc(doc(db, 'folders', FID, 'data', 'state'), { x: 1 }));
    await assertSucceeds(getDoc(doc(jako('stary'), 'folders', FID, 'data', 'state')));   // przed zmianą ma dostęp
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertSucceeds(zmianaBatch(db, UID_CZLONEK));
    const stary = jako('stary');
    await assertFails(getDoc(doc(stary, 'folders', FID, 'data', 'state')));
    await assertFails(setDoc(doc(stary, 'folders', FID, 'sessions', 's1'), { x: 1 }));
    await assertFails(wejdz(stary, 'stary', HASH, 0));                                      // stary PIN: brak żetonu / zły skrót
    await proba(stary, 'stary', HASH_NOWY);
    await assertFails(wejdz(stary, 'stary', HASH_NOWY, 0));                                 // gen 0 ≠ gen konta (1)
    await assertSucceeds(wejdz(stary, 'stary', HASH_NOWY, 1));
    await assertSucceeds(getDoc(doc(stary, 'folders', FID, 'data', 'state')));
    await assertSucceeds(setDoc(doc(stary, 'folders', FID, 'sessions', 's1'), { x: 1 }));
    await assertSucceeds(getDoc(doc(db, 'folders', FID, 'data', 'state')));                 // urządzenie, które zmieniło PIN, działa dalej
  });
  it('7c: zmiana bez żetonu – nie', async () => {
    await assertFails(zmianaBatch(czlonek(), UID_CZLONEK));
  });
  it('7c: żeton ze złym obecnym PIN-em – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH_ZLY);
    await assertFails(zmianaBatch(db, UID_CZLONEK));
  });
  it('7c: żeton starszy niż 15 min – nie', async () => {
    await seedTry(UID_CZLONEK, HASH, 16);
    await assertFails(zmianaBatch(czlonek(), UID_CZLONEK));
  });
  it('7c: przez nie-członka (nawet z żetonem poprawnego PIN-u) – nie', async () => {
    const db = obcy();
    await proba(db, UID_OBCY, HASH);
    await assertFails(zmianaBatch(db, UID_OBCY));
  });
  it('7c: gen +2 – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertFails(zmianaBatch(db, UID_CZLONEK, { gen: 2 }));
  });
  it('7c: gen +1 bez zmiany sekretu – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertFails(zmianaBatch(db, UID_CZLONEK, { sekret: false, wpisHash: HASH }));
  });
  it('7c: nowy skrót równy staremu – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertFails(zmianaBatch(db, UID_CZLONEK, { hash: HASH }));
  });
  it('7c: zmiana sekretu bez podniesienia gen folderu – nie', async () => {
    const db = czlonek();
    await proba(db, UID_CZLONEK, HASH);
    await assertFails(zmianaBatch(db, UID_CZLONEK, { folder: false, wpisGen: 0 }));
  });
  it('7d: członek przepisuje własny wpis z dobrym skrótem bez żetonu i bez zmiany sekretu (wyrocznia PIN-u) – nie', async () => {
    await assertFails(setDoc(doc(czlonek(), 'folders', FID, 'members', UID_CZLONEK), { hash: HASH, at: 2 }));
    await assertFails(setDoc(doc(czlonek(), 'folders', FID, 'members', UID_CZLONEK), { hash: HASH_ZLY, at: 2 }));
  });
});

describe('folders/{fid}/members/{uid}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db, FID, { czlonekUid: null })); });

  it('1: zły skrót – próba przez bramkę przechodzi, wpis z tym skrótem – nie; po próbie z dobrym skrótem wpis – tak', async () => {
    const db = jako('u1');
    await assertSucceeds(proba(db, 'u1', HASH_ZLY));
    await assertFails(wejdz(db, 'u1', HASH_ZLY));
    await assertFails(wejdz(db, 'u1', HASH));            // żeton ma zły skrót
    await assertSucceeds(proba(db, 'u1', HASH));
    await assertSucceeds(wejdz(db, 'u1', HASH));
  });
  it('3: poprawny PIN po żetonie – wpis tak i odczyt data/state tak; bez wpisu – nie', async () => {
    await seed((db) => setDoc(doc(db, 'folders', FID, 'data', 'state'), { x: 1 }));
    const db = jako('u1');
    await assertFails(getDoc(doc(db, 'folders', FID, 'data', 'state')));
    await assertSucceeds(proba(db, 'u1', HASH));
    await assertSucceeds(wejdz(db, 'u1', HASH));
    await assertSucceeds(getDoc(doc(db, 'folders', FID, 'data', 'state')));
  });
  it('4a: wpis bez żetonu (dobry skrót) – nie', async () => {
    await assertFails(wejdz(jako('u1'), 'u1', HASH));
  });
  it('4b: żeton i wpis w jednym zapisie grupowym (bramka + tries + members) – nie', async () => {
    const db = jako('u1');
    const b = writeBatch(db);
    b.set(gateRef(db), { n15: 1, w15: serverTimestamp(), nd: 1, wd: serverTimestamp(), at: serverTimestamp() });
    b.set(triesRef(db, 'u1'), { hash: HASH, at: serverTimestamp() });
    b.set(doc(db, 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1 });
    await assertFails(b.commit());
  });
  it('4c: żeton starszy niż 15 min – nie; młodszy – tak', async () => {
    await seedTry('u1', HASH, 16);
    await assertFails(wejdz(jako('u1'), 'u1', HASH));
    await seedTry('u1', HASH, 14);
    await assertSucceeds(wejdz(jako('u1'), 'u1', HASH));
  });
  it('4d: żeton z innym skrótem niż wpis – nie', async () => {
    await seedTry('u1', HASH_ZLY, 1);
    await assertFails(wejdz(jako('u1'), 'u1', HASH));
  });
  it('wpis na cudzy uid – nie', async () => {
    const db = jako('u1');
    await proba(db, 'u1', HASH);
    await assertFails(wejdz(db, 'u2', HASH));
  });
  it('wpis bez logowania – nie', async () => {
    await seedTry('u1', HASH, 1);
    await assertFails(wejdz(anon(), 'u1', HASH));
  });
  it('pole spoza hash/at/gen – nie', async () => {
    const db = jako('u1');
    await proba(db, 'u1', HASH);
    await assertFails(setDoc(doc(db, 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1, extra: 1 }));
  });
  it('pole gen: zgodne z generacją konta – tak; niezgodne – nie', async () => {
    await seed((db) => seedFolder(db, 'f2', { czlonekUid: null, gen: 1 }));
    const db = jako('u1');
    await proba(db, 'u1', HASH, 'f2');
    await assertFails(wejdz(db, 'u1', HASH, 0, 'f2'));
    await assertFails(wejdz(db, 'u1', HASH, 2, 'f2'));
    await assertSucceeds(wejdz(db, 'u1', HASH, 1, 'f2'));
  });
  it('odczyt własnego wpisu – tak; cudzego – nie', async () => {
    await seed((db) => setDoc(doc(db, 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1 }));
    await assertSucceeds(getDoc(doc(jako('u1'), 'folders', FID, 'members', 'u1')));
    await assertFails(getDoc(doc(jako('u2'), 'folders', FID, 'members', 'u1')));
  });
  it('lista members – nie', async () => {
    await seed((db) => setDoc(doc(db, 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1 }));
    await assertFails(getDocs(collection(jako('u1'), 'folders', FID, 'members')));
  });
  it('usunięcie własnego wpisu – tak; cudzego – nie', async () => {
    await seed((db) => setDoc(doc(db, 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1 }));
    await assertFails(deleteDoc(doc(jako('u2'), 'folders', FID, 'members', 'u1')));
    await assertSucceeds(deleteDoc(doc(jako('u1'), 'folders', FID, 'members', 'u1')));
  });
  it('E1-01 (naprawione): 5 błędnych prób przez bramkę, szósta próba – nawet z dobrym skrótem – nie, wpis z dobrym skrótem – nie', async () => {
    const db = jako('zgadywacz');
    for (let i = 0; i < 5; i++) {
      const zly = i.toString(16).padStart(64, '0');                 // 5 różnych, błędnych skrótów
      await assertSucceeds(proba(db, 'zgadywacz', zly));
      await assertFails(wejdz(db, 'zgadywacz', zly));
    }
    await assertFails(proba(db, 'zgadywacz', HASH));                // szósta próba w oknie 15 min
    await assertFails(wejdz(db, 'zgadywacz', HASH));                // brak żetonu z dobrym skrótem
  });
});

describe('bramka prób: folders/{fid}/secret/gate', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db, FID, { czlonekUid: null })); });

  it('2a: 5 prób w 15 min przez bramkę – tak, szósta – nie', async () => {
    const db = jako('u1');
    for (let i = 0; i < 5; i++) await assertSucceeds(proba(db, 'u1', HASH_ZLY));
    await assertFails(proba(db, 'u1', HASH_ZLY));
    await assertFails(proba(jako('u2'), 'u2', HASH_ZLY));          // limit dotyczy konta, nie urządzenia
  });
  it('2b: okno 15 min wygasło, ale doba wyczerpana (nd = 10) – jedenasta próba nie; nd = 9 – tak', async () => {
    await seedGate({ n15: 5, w15Min: 20, nd: 10, wdMin: 60 });
    await assertFails(proba(jako('u1'), 'u1', HASH_ZLY));
    await seedGate({ n15: 5, w15Min: 20, nd: 9, wdMin: 60 });
    await assertSucceeds(proba(jako('u1'), 'u1', HASH_ZLY));
  });
  it('2c: okno 15 min wygasło (nd 5) – próba tak, a n15 po zapisie = 1', async () => {
    await seedGate({ n15: 5, w15Min: 16, nd: 5, wdMin: 60 });
    await assertSucceeds(proba(jako('u1'), 'u1', HASH_ZLY));
    await seed(async (db) => {
      const g = (await getDoc(gateRef(db))).data();
      assert.strictEqual(g.n15, 1);
      assert.strictEqual(g.nd, 6);
    });
  });
  it('2c: doba wygasła (wd 25 h temu, nd 10) – próba tak', async () => {
    await seedGate({ n15: 5, w15Min: 20, nd: 10, wdMin: 25 * 60 });
    await assertSucceeds(proba(jako('u1'), 'u1', HASH_ZLY));
    await seed(async (db) => {
      const g = (await getDoc(gateRef(db))).data();
      assert.strictEqual(g.nd, 1);
      assert.strictEqual(g.n15, 1);
    });
  });
  it('odczyt bramki (get): zalogowany – tak; niezalogowany – nie; lista secret/ – nie; secret/pin – nadal nie, także członek', async () => {
    await seedGate({ n15: 1, w15Min: 1, nd: 1, wdMin: 1 });
    await seed((db) => setDoc(doc(db, 'folders', FID, 'members', UID_CZLONEK), { hash: HASH, at: 1 }));
    await assertSucceeds(getDoc(gateRef(jako('u1'))));
    await assertFails(getDoc(gateRef(anon())));
    await assertFails(getDocs(collection(jako('u1'), 'folders', FID, 'secret')));
    await assertFails(getDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin')));
  });
  it('utworzenie bramki: n15 = 1 i czasy z serwera – tak; n15 = 2, at od klienta, brakujące pole, dodatkowe pole – nie', async () => {
    const db = jako('u1');
    const ok = () => ({ n15: 1, w15: serverTimestamp(), nd: 1, wd: serverTimestamp(), at: serverTimestamp() });
    await assertFails(setDoc(gateRef(db), { ...ok(), n15: 2 }));
    await assertFails(setDoc(gateRef(db), { ...ok(), at: Timestamp.fromMillis(Date.now()) }));
    await assertFails(setDoc(gateRef(db), { ...ok(), w15: tsAgo(1) }));
    await assertFails(setDoc(gateRef(db), { n15: 1, w15: serverTimestamp(), nd: 1, wd: serverTimestamp() }));
    await assertFails(setDoc(gateRef(db), { ...ok(), extra: 1 }));
    await assertFails(setDoc(gateRef(anon()), ok()));
    await assertSucceeds(setDoc(gateRef(db), ok()));              // bramka zwiększona bez żetonu – pali tylko limit
  });
  it('utworzenie bramki na koncie bez secret/pin – nie', async () => {
    await seed((db) => seedFolder(db, 'f2', { pin: false, czlonekUid: null }));
    await assertFails(proba(jako('u1'), 'u1', HASH, 'f2'));
  });
  it('zmiana bramki: +1 – tak; +2, reset n15 do 1 w trwającym oknie, przesunięcie w15, dodatkowe pole – nie', async () => {
    const g = gateData({ n15: 1, w15Min: 1, nd: 1, wdMin: 1 });
    await seed((db) => setDoc(gateRef(db), g));
    const db = jako('u1');
    const plus = (extra = {}) => ({ n15: 2, w15: g.w15, nd: 2, wd: g.wd, at: serverTimestamp(), ...extra });
    await assertFails(setDoc(gateRef(db), plus({ n15: 3 })));
    await assertFails(setDoc(gateRef(db), plus({ n15: 1 })));
    await assertFails(setDoc(gateRef(db), plus({ w15: serverTimestamp() })));
    await assertFails(setDoc(gateRef(db), plus({ nd: 1 })));
    await assertFails(setDoc(gateRef(db), plus({ extra: 1 })));
    await assertFails(setDoc(gateRef(anon()), plus()));
    await assertSucceeds(setDoc(gateRef(db), plus()));
  });
  it('usunięcie bramki: obcy – nie; członek bez usuwania folderu – nie', async () => {
    await seedGate({ n15: 1, w15Min: 1, nd: 1, wdMin: 1 });
    await seed((db) => setDoc(doc(db, 'folders', FID, 'members', UID_CZLONEK), { hash: HASH, at: 1 }));
    await assertFails(deleteDoc(gateRef(obcy())));
    await assertFails(deleteDoc(gateRef(czlonek())));
  });
});

describe('żeton próby: folders/{fid}/tries/{uid}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db, FID, { czlonekUid: null })); });

  it('żeton bez zwiększenia bramki – nie (bramka nie istnieje albo jej at jest stary)', async () => {
    const db = jako('u1');
    await assertFails(setDoc(triesRef(db, 'u1'), { hash: HASH, at: serverTimestamp() }));
    await seedGate({ n15: 1, w15Min: 1, nd: 1, wdMin: 1 });
    await assertFails(setDoc(triesRef(db, 'u1'), { hash: HASH, at: serverTimestamp() }));
  });
  it('żeton na cudzy uid razem ze zwiększeniem bramki – nie; własny – tak', async () => {
    const db = jako('u1');
    const dane = () => ({ n15: 1, w15: serverTimestamp(), nd: 1, wd: serverTimestamp(), at: serverTimestamp() });
    const b = writeBatch(db);
    b.set(gateRef(db), dane());
    b.set(triesRef(db, 'u2'), { hash: HASH, at: serverTimestamp() });
    await assertFails(b.commit());
    await assertSucceeds(proba(db, 'u1', HASH));
  });
  it('żeton: zły format (skrót ≠ 64 znaki, at od klienta, dodatkowe pole) – nie', async () => {
    const db = jako('u1');
    const dane = () => ({ n15: 1, w15: serverTimestamp(), nd: 1, wd: serverTimestamp(), at: serverTimestamp() });
    for (const zly of [{ hash: 'a'.repeat(63), at: serverTimestamp() }, { hash: HASH, at: Timestamp.fromMillis(Date.now()) }, { hash: HASH, at: serverTimestamp(), extra: 1 }]) {
      await testEnv.clearFirestore(); await seed((d) => seedFolder(d, FID, { czlonekUid: null }));
      const b = writeBatch(db);
      b.set(gateRef(db), dane());
      b.set(triesRef(db, 'u1'), zly);
      await assertFails(b.commit());
    }
  });
  it('odczyt żetonu – nie (także własnego); usunięcie własnego – tak, cudzego – nie', async () => {
    await seedTry('u1', HASH, 1);
    await assertFails(getDoc(triesRef(jako('u1'), 'u1')));
    await assertFails(getDoc(triesRef(czlonek(), 'u1')));
    await assertFails(deleteDoc(triesRef(jako('u2'), 'u1')));
    await assertSucceeds(deleteDoc(triesRef(jako('u1'), 'u1')));
  });
});

describe('dotychczasowe konta (dane sprzed A3: wpis członka bez gen, folder bez gen)', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('6: dotychczasowy członek nadal czyta i zapisuje data, sessions, diet, tworzy shares i zmienia nazwę folderu', async () => {
    const db = czlonek();
    await assertSucceeds(setDoc(doc(db, 'folders', FID, 'data', 'state'), { x: 1 }));
    await assertSucceeds(getDoc(doc(db, 'folders', FID, 'data', 'state')));
    await assertSucceeds(setDoc(doc(db, 'folders', FID, 'sessions', 's1'), { x: 1 }));
    await assertSucceeds(getDoc(doc(db, 'folders', FID, 'sessions', 's1')));
    await assertSucceeds(setDoc(doc(db, 'folders', FID, 'diet', '2026-11-13'), { x: 1 }));
    await assertSucceeds(setDoc(doc(db, 'shares', 'ABCDEF'), plan()));
    await assertSucceeds(updateDoc(doc(db, 'folders', FID), { name: 'Nowa nazwa' }));
  });
});

describe('folders/{fid}/data/{docId}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('członek czyta i zapisuje „state” i „diet” – tak', async () => {
    for (const id of ['state', 'diet']) {
      await assertSucceeds(setDoc(doc(czlonek(), 'folders', FID, 'data', id), { x: 1 }));
      await assertSucceeds(getDoc(doc(czlonek(), 'folders', FID, 'data', id)));
    }
  });
  it('członek: inny docId (np. „x”) – nie', async () => {
    await assertFails(setDoc(doc(czlonek(), 'folders', FID, 'data', 'x'), { x: 1 }));
    await assertFails(getDoc(doc(czlonek(), 'folders', FID, 'data', 'x')));
  });
  it('nie-członek i niezalogowany – nie', async () => {
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'data', 'state'), { x: 1 }));
    await assertFails(getDoc(doc(obcy(), 'folders', FID, 'data', 'state')));
    await assertFails(setDoc(doc(anon(), 'folders', FID, 'data', 'state'), { x: 1 }));
    await assertFails(getDoc(doc(anon(), 'folders', FID, 'data', 'state')));
  });
});

describe('folders/{fid}/diet/{day}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('członek zapisuje dzień RRRR-MM-DD – tak', async () => {
    await assertSucceeds(setDoc(doc(czlonek(), 'folders', FID, 'diet', '2026-11-13'), { x: 1 }));
  });
  it('członek: dzień w złym formacie („dzis”, „2026-1-3”) – nie', async () => {
    await assertFails(setDoc(doc(czlonek(), 'folders', FID, 'diet', 'dzis'), { x: 1 }));
    await assertFails(setDoc(doc(czlonek(), 'folders', FID, 'diet', '2026-1-3'), { x: 1 }));
  });
  it('zapis dnia przez nie-członka – nie', async () => {
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'diet', '2026-11-13'), { x: 1 }));
  });
  it('lista dni: członek – tak; nie-członek – nie', async () => {
    await seed((db) => setDoc(doc(db, 'folders', FID, 'diet', '2026-11-12'), { x: 1 }));
    await assertSucceeds(getDocs(collection(czlonek(), 'folders', FID, 'diet')));
    await assertFails(getDocs(collection(obcy(), 'folders', FID, 'diet')));
  });
});

describe('folders/{fid}/sessions/{id}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('członek czyta i zapisuje – tak', async () => {
    await assertSucceeds(setDoc(doc(czlonek(), 'folders', FID, 'sessions', 's1'), { x: 1 }));
    await assertSucceeds(getDoc(doc(czlonek(), 'folders', FID, 'sessions', 's1')));
  });
  it('nie-członek i niezalogowany – nie', async () => {
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'sessions', 's1'), { x: 1 }));
    await assertFails(getDoc(doc(obcy(), 'folders', FID, 'sessions', 's1')));
    await assertFails(getDoc(doc(anon(), 'folders', FID, 'sessions', 's1')));
  });
});

describe('shares/{code}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db)); });

  it('odczyt kodu w poprawnym formacie – tak, także bez logowania', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'shares', 'ABC234')));
  });
  it('odczyt kodu w złym formacie – nie', async () => {
    await assertFails(getDoc(doc(anon(), 'shares', 'abc234')));
    await assertFails(getDoc(doc(anon(), 'shares', 'ABC23')));
    await assertFails(getDoc(doc(anon(), 'shares', 'ABCO23')));
  });
  it('lista shares – nie', async () => {
    await assertFails(getDocs(collection(anon(), 'shares')));
    await assertFails(getDocs(collection(czlonek(), 'shares')));
  });
  it('utworzenie przez członka folderu z poprawnymi danymi – tak; przez nie-członka – nie', async () => {
    await assertSucceeds(setDoc(doc(czlonek(), 'shares', 'ABC234'), plan()));
    await assertFails(setDoc(doc(obcy(), 'shares', 'ABC235'), plan()));
    await assertFails(setDoc(doc(anon(), 'shares', 'ABC236'), plan()));
  });
  it('utworzenie: kod ze znakami O, I, L, 0 lub 1 – nie', async () => {
    for (const kod of ['ABCO23', 'ABCI23', 'ABCL23', 'ABC023', 'ABC123']) {
      await assertFails(setDoc(doc(czlonek(), 'shares', kod), plan()));
    }
  });
  it('utworzenie: plan.items – 60 elementów tak, 61 nie; dodatkowe pole – nie', async () => {
    await assertSucceeds(setDoc(doc(czlonek(), 'shares', 'ABC234'),
      plan({ plan: { name: 'P', items: Array.from({ length: 60 }, (_, i) => i) } })));
    await assertFails(setDoc(doc(czlonek(), 'shares', 'ABC235'),
      plan({ plan: { name: 'P', items: Array.from({ length: 61 }, (_, i) => i) } })));
    await assertFails(setDoc(doc(czlonek(), 'shares', 'ABC236'), plan({ extra: 1 })));
  });
  it('zmiana: ten sam fid – tak; zmiana fid – nie', async () => {
    await seed((db) => setDoc(doc(db, 'shares', 'ABC234'), plan()));
    await assertSucceeds(setDoc(doc(czlonek(), 'shares', 'ABC234'), plan({ from: 'Ola' })));
    await assertFails(setDoc(doc(czlonek(), 'shares', 'ABC234'), plan({ fid: 'inny' })));
  });
  it('usunięcie: członek – tak; obcy – nie', async () => {
    await seed((db) => setDoc(doc(db, 'shares', 'ABC234'), plan()));
    await assertFails(deleteDoc(doc(obcy(), 'shares', 'ABC234')));
    await assertSucceeds(deleteDoc(doc(czlonek(), 'shares', 'ABC234')));
  });
});

describe('foods/{ean}', () => {
  it('get dla ean 8–14 cyfr – tak, bez logowania; zły ean – nie', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'foods', EAN)));
    await assertSucceeds(getDoc(doc(anon(), 'foods', '12345678')));
    await assertFails(getDoc(doc(anon(), 'foods', '1234567')));
    await assertFails(getDoc(doc(anon(), 'foods', 'abc12345678')));
  });
  it('list: limit 30 – tak, limit 31 – nie', async () => {
    await assertSucceeds(getDocs(query(collection(anon(), 'foods'), limit(30))));
    await assertFails(getDocs(query(collection(anon(), 'foods'), limit(31))));
  });
  it('utworzenie poprawnego produktu (src „off” lub „user”) – tak', async () => {
    await assertSucceeds(setDoc(doc(obcy(), 'foods', EAN), produkt({ src: 'user' })));
    await assertSucceeds(setDoc(doc(obcy(), 'foods', '12345678'), produkt({ src: 'off' })));
  });
  it('utworzenie: bez logowania – nie', async () => {
    await assertFails(setDoc(doc(anon(), 'foods', EAN), produkt()));
  });
  it('utworzenie: b+w+t+f > 105 oraz k > 900 – nie (granice 105 i 900 – tak)', async () => {
    await assertFails(setDoc(doc(obcy(), 'foods', EAN), produkt({ b: 50, w: 50, t: 5, f: 5 })));
    await assertSucceeds(setDoc(doc(obcy(), 'foods', EAN), produkt({ b: 50, w: 50, t: 5, f: 0 })));
    await assertFails(setDoc(doc(obcy(), 'foods', '12345678'), produkt({ k: 901 })));
    await assertSucceeds(setDoc(doc(obcy(), 'foods', '12345679'), produkt({ k: 900 })));
  });
  it('utworzenie: z polem fw/cw przy tworzeniu – nie', async () => {
    await assertFails(setDoc(doc(obcy(), 'foods', EAN), produkt({ fw: GRUPA_W, cw: 3 })));
  });
  it('utworzenie: src spoza „off”/„user” – nie', async () => {
    await assertFails(setDoc(doc(obcy(), 'foods', EAN), produkt({ src: 'x' })));
  });
  it('usunięcie – nikt', async () => {
    await seed((db) => setDoc(doc(db, 'foods', EAN), produkt()));
    await assertFails(deleteDoc(doc(obcy(), 'foods', EAN)));
    await assertFails(deleteDoc(doc(anon(), 'foods', EAN)));
  });
});

describe('foods/{ean}/v/{vid} (głosy)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'foods', EAN), produkt());
      await setDoc(doc(db, 'foods', EAN, 'v', 'w_u1'), { g: GRUPA_W });
    });
  });

  it('własny głos „w_”+uid odczytać – tak; cudzy – nie', async () => {
    await assertSucceeds(getDoc(doc(jako('u1'), 'foods', EAN, 'v', 'w_u1')));
    await assertFails(getDoc(doc(jako('u2'), 'foods', EAN, 'v', 'w_u1')));
    await assertFails(getDoc(doc(anon(), 'foods', EAN, 'v', 'w_u1')));
  });
  it('zmiana i usunięcie głosu – nie (także własnego)', async () => {
    await assertFails(updateDoc(doc(jako('u1'), 'foods', EAN, 'v', 'w_u1'), { g: 'w_' + 'b'.repeat(12) }));
    await assertFails(deleteDoc(doc(jako('u1'), 'foods', EAN, 'v', 'w_u1')));
  });
});

describe('foods/{ean}/fix/{key} (grupy poprawek)', () => {
  const GRUPA_B = 'w_' + 'b'.repeat(12);

  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'foods', EAN), produkt()));
  });

  it('nowa grupa z c == 1 razem z własnym głosem w jednym batchu – tak', async () => {
    const db = jako('u1');
    const b = writeBatch(db);
    b.set(doc(db, 'foods', EAN, 'fix', GRUPA_W), grupaFix());
    b.set(doc(db, 'foods', EAN, 'v', 'w_u1'), { g: GRUPA_W });
    await assertSucceeds(b.commit());
  });
  it('nowa grupa bez głosu – nie', async () => {
    await assertFails(setDoc(doc(jako('u1'), 'foods', EAN, 'fix', GRUPA_W), grupaFix()));
  });
  it('nowa grupa z c != 1 – nie', async () => {
    const db = jako('u1');
    const b = writeBatch(db);
    b.set(doc(db, 'foods', EAN, 'fix', GRUPA_W), grupaFix({ c: 2 }));
    b.set(doc(db, 'foods', EAN, 'v', 'w_u1'), { g: GRUPA_W });
    await assertFails(b.commit());
  });
  it('drugi głos tego samego urządzenia – nie', async () => {
    await seed((db) => setDoc(doc(db, 'foods', EAN, 'v', 'w_u1'), { g: GRUPA_W }));
    const db = jako('u1');
    const b = writeBatch(db);
    b.set(doc(db, 'foods', EAN, 'fix', GRUPA_B), grupaFix());
    b.set(doc(db, 'foods', EAN, 'v', 'w_u1'), { g: GRUPA_B });
    await assertFails(b.commit());
  });
  it('zwiększenie licznika c o 1 z nowym głosem – tak; o 2 – nie', async () => {
    await seed((db) => setDoc(doc(db, 'foods', EAN, 'fix', GRUPA_W), grupaFix({ c: 1 })));
    const db = jako('u2');
    const zle = writeBatch(db);
    zle.update(doc(db, 'foods', EAN, 'fix', GRUPA_W), { c: 3, at: 2 });
    zle.set(doc(db, 'foods', EAN, 'v', 'w_u2'), { g: GRUPA_W });
    await assertFails(zle.commit());
    const dobrze = writeBatch(db);
    dobrze.update(doc(db, 'foods', EAN, 'fix', GRUPA_W), { c: 2, at: 2 });
    dobrze.set(doc(db, 'foods', EAN, 'v', 'w_u2'), { g: GRUPA_W });
    await assertSucceeds(dobrze.commit());
  });
  it('zwiększenie licznika bez nowego głosu – nie', async () => {
    await seed((db) => setDoc(doc(db, 'foods', EAN, 'fix', GRUPA_W), grupaFix({ c: 1 })));
    await assertFails(updateDoc(doc(jako('u2'), 'foods', EAN, 'fix', GRUPA_W), { c: 2, at: 2 }));
  });

  describe('awans poprawki (update foods/{ean} z fw/cw)', () => {
    const awans = (g) => ({ k: g.k, b: g.b, w: g.w, t: g.t, f: g.f, u: g.u, pg: g.pg, po: g.po, fw: GRUPA_W, cw: g.c, at: 2 });

    it('grupa z c >= 3 i wartości identyczne z grupą – tak', async () => {
      const g = grupaFix({ c: 3 });
      await seed((db) => setDoc(doc(db, 'foods', EAN, 'fix', GRUPA_W), g));
      await assertSucceeds(updateDoc(doc(jako('u1'), 'foods', EAN), awans(g)));
    });
    it('grupa z c = 2 – nie', async () => {
      const g = grupaFix({ c: 2 });
      await seed((db) => setDoc(doc(db, 'foods', EAN, 'fix', GRUPA_W), g));
      await assertFails(updateDoc(doc(jako('u1'), 'foods', EAN), awans(g)));
    });
    it('wartości różne od grupy – nie', async () => {
      const g = grupaFix({ c: 3 });
      await seed((db) => setDoc(doc(db, 'foods', EAN, 'fix', GRUPA_W), g));
      await assertFails(updateDoc(doc(jako('u1'), 'foods', EAN), { ...awans(g), k: g.k + 10 }));
    });
    it('awans bez logowania – nie', async () => {
      const g = grupaFix({ c: 3 });
      await seed((db) => setDoc(doc(db, 'foods', EAN, 'fix', GRUPA_W), g));
      await assertFails(updateDoc(doc(anon(), 'foods', EAN), awans(g)));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// E1-01 i E1-02 zostały naprawione w zleceniu A3 – odwrócone testy są w blokach „members”, „secret/pin” i „E1-02” powyżej.
// Poniżej zostaje to, czego A3 nie obejmuje: opisuje OBECNE zachowanie reguł i dziś jest zielone, choć to błąd.
// ---------------------------------------------------------------------------------------------
const anonimowe = (uid) => testEnv.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();

describe('E1-02 (naprawione): przejęcie konta przez obce urządzenie', () => {
  it('sekret konta bez PIN-u: utworzenie przez obcego – nie; wpis members – nie; odczyt data/state – nie', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false, czlonekUid: null }));
    const wlasny = 'c'.repeat(64);
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: wlasny }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'members', UID_OBCY), { hash: wlasny, at: 1 }));
    await seed((db) => setDoc(doc(db, 'folders', FID, 'data', 'state'), { x: 1 }));
    await assertFails(getDoc(doc(obcy(), 'folders', FID, 'data', 'state')));
  });
  it('członek nie usunie secret/pin, a obcy nie założy go znowu własnym skrótem', async () => {
    await seed((db) => seedFolder(db));
    await assertFails(deleteDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin')));
    const wlasny = 'd'.repeat(64);
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: wlasny }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'members', UID_OBCY), { hash: wlasny, at: 1 }));
    // także po usunięciu całego konta przez prawowitego członka sekret nie przeżywa (usuwa się razem z kontem – 9a)
  });
});

describe('znane dziury poza A3', () => {
  it('E1-03 [znany błąd do naprawy]: produkt we wspólnej bazie (foods) utworzy każde anonimowe zalogowane urządzenie', async () => {
    await assertSucceeds(setDoc(doc(anonimowe('anon1'), 'foods', EAN), produkt({ src: 'user' })));
    await assertSucceeds(setDoc(doc(anonimowe('anon2'), 'foods', '12345678'), produkt({ n: 'Cokolwiek', src: 'user' })));
  });
});
