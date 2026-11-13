// Testy reguł Firestore (firestore.rules) – uruchamiane na emulatorze, przed każdym wdrożeniem reguł.
// Uruchomienie: cd testy-regul && npm ci && npx --yes firebase-tools@13.35.1 emulators:exec --only firestore --project demo-dziennik "npm test"
// Każdy przypadek „wolno” ma swoją parę „nie wolno”. Testy sprawdzają zachowanie reguł, nie ich treść.
const { describe, it, before, after, beforeEach } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, limit, writeBatch,
} = require('firebase/firestore');

const FID = 'f1';            // folder, w którym UID_CZLONEK jest członkiem
const UID_CZLONEK = 'czlonek';
const UID_OBCY = 'obcy';
const HASH = 'a'.repeat(64);  // skrót PIN-u (64 znaki)
const EAN = '5901234123457';
const GRUPA_W = 'w_' + 'a'.repeat(12);

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
async function seedFolder(db, fid = FID, { czlonekUid = UID_CZLONEK, pin = true } = {}) {
  await setDoc(doc(db, 'folders', fid), { name: 'Kamil', createdAt: 1, updatedAt: 1 });
  if (pin) await setDoc(doc(db, 'folders', fid, 'secret', 'pin'), { hash: HASH });
  if (czlonekUid) await setDoc(doc(db, 'folders', fid, 'members', czlonekUid), { hash: HASH, at: 1 });
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
  it('utworzenie folderu: zalogowany z poprawnymi polami – tak', async () => {
    await assertSucceeds(setDoc(doc(obcy(), 'folders', 'nowy'), { name: 'Ala', createdAt: 1, updatedAt: 1, pin: true }));
    await assertSucceeds(setDoc(doc(obcy(), 'folders', 'nowy2'), { name: 'A'.repeat(40) }));
  });
  it('utworzenie folderu: bez logowania – nie', async () => {
    await assertFails(setDoc(doc(anon(), 'folders', 'nowy'), { name: 'Ala' }));
  });
  it('utworzenie folderu: dodatkowe pole, pusta lub za długa nazwa, pin nie-bool – nie', async () => {
    await assertFails(setDoc(doc(obcy(), 'folders', 'nowy'), { name: 'Ala', extra: 1 }));
    await assertFails(setDoc(doc(obcy(), 'folders', 'nowy'), { name: '' }));
    await assertFails(setDoc(doc(obcy(), 'folders', 'nowy'), { name: 'A'.repeat(41) }));
    await assertFails(setDoc(doc(obcy(), 'folders', 'nowy'), { name: 'Ala', pin: 'tak' }));
  });
  it('zmiana folderu: członek – tak; nie-członek i niezalogowany – nie', async () => {
    await assertSucceeds(updateDoc(doc(czlonek(), 'folders', FID), { name: 'Nowa' }));
    await assertFails(updateDoc(doc(obcy(), 'folders', FID), { name: 'Nowa' }));
    await assertFails(updateDoc(doc(anon(), 'folders', FID), { name: 'Nowa' }));
  });
  it('usunięcie folderu: członek – tak; obcy – nie', async () => {
    await assertFails(deleteDoc(doc(obcy(), 'folders', FID)));
    await assertSucceeds(deleteDoc(doc(czlonek(), 'folders', FID)));
  });
});

describe('folders/{fid}/secret/pin', () => {
  it('odczyt: nikt, także członek – nie', async () => {
    await seed((db) => seedFolder(db));
    await assertFails(getDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin')));
    await assertFails(getDoc(doc(obcy(), 'folders', FID, 'secret', 'pin')));
  });
  it('utworzenie: zalogowany, doc „pin”, tylko pole hash o 64 znakach – tak', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false, czlonekUid: null }));
    await assertSucceeds(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: HASH }));
  });
  it('utworzenie: hash innej długości, dodatkowe pole, inny doc, brak logowania – nie', async () => {
    await seed((db) => seedFolder(db, FID, { pin: false, czlonekUid: null }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: 'a'.repeat(63) }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: 'a'.repeat(65) }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: HASH, extra: 1 }));
    await assertFails(setDoc(doc(obcy(), 'folders', FID, 'secret', 'inny'), { hash: HASH }));
    await assertFails(setDoc(doc(anon(), 'folders', FID, 'secret', 'pin'), { hash: HASH }));
  });
  it('zmiana (update): nikt, także członek – nie', async () => {
    await seed((db) => seedFolder(db));
    await assertFails(updateDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin'), { hash: 'b'.repeat(64) }));
    await assertFails(updateDoc(doc(obcy(), 'folders', FID, 'secret', 'pin'), { hash: 'b'.repeat(64) }));
  });
  it('usunięcie: członek – tak; obcy – nie', async () => {
    await seed((db) => seedFolder(db));
    await assertFails(deleteDoc(doc(obcy(), 'folders', FID, 'secret', 'pin')));
    await assertSucceeds(deleteDoc(doc(czlonek(), 'folders', FID, 'secret', 'pin')));
  });
});

describe('folders/{fid}/members/{uid}', () => {
  beforeEach(async () => { await seed((db) => seedFolder(db, FID, { czlonekUid: null })); });

  it('dołączenie z hashem zgodnym z secret/pin – tak; z błędnym – nie', async () => {
    await assertFails(setDoc(doc(jako('u1'), 'folders', FID, 'members', 'u1'), { hash: 'b'.repeat(64), at: 1 }));
    await assertSucceeds(setDoc(doc(jako('u1'), 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1 }));
  });
  it('wpis na cudzy uid – nie', async () => {
    await assertFails(setDoc(doc(jako('u1'), 'folders', FID, 'members', 'u2'), { hash: HASH, at: 1 }));
  });
  it('wpis bez logowania – nie', async () => {
    await assertFails(setDoc(doc(anon(), 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1 }));
  });
  it('pole spoza hash/at – nie', async () => {
    await assertFails(setDoc(doc(jako('u1'), 'folders', FID, 'members', 'u1'), { hash: HASH, at: 1, extra: 1 }));
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
