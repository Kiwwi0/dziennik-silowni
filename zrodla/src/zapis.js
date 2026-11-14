/* ====================== zapis planów i treningów: scalanie i kolejka (A6) ======================
   Czysta logika, bez interfejsu i bez Firebase – wkleja ją build.py / build_web.py (jak anim.js),
   a testy Node (testy/zapis/test_zapis.js) ładują ten sam plik. Plan: zrodla/plany/A6-zapis-planow-i-treningow.md.

   Dokument folders/{id}/data/state w układzie v3 (pkt 2 planu):
     v:3, full:<czas>, pm:{id:{…plan, u}}, po:[id], pos:<czas>, cm/co/cos – to samo dla własnych ćwiczeń,
     pt/ct:{id:czas usunięcia}, settings:{klucz:wartość}, plans:[…] i custom:[…] (LUSTRO w starym układzie dla starych kart).
   Stan w pamięci aplikacji (S) zostaje {plans:[], custom:[], settings:{}} – tablice jak dotąd.

   Stan silnika zapisu Z (osobny dla konta, w localStorage):
     q  – kolejka niewysłanych zmian: p/c {id:u}, pd/cd {id:czas usunięcia}, s {klucz:czas}, po/co czas zmiany kolejności, t ostatni znacznik, mx największy czas widziany w bazie (zegary urządzeń się rozjeżdżają)
     kn – znane czasy zatwierdzonych pozycji: p/c {id:u}, v3 true gdy to urządzenie widziało układ v3, pt/ct nagrobki z ostatniego odczytu układu v3 (młodsze niż 60 dni)
   Wszystkie funkcje poniżej nie dotykają stanu wejściowego (kopiują), poza `afterSend`, `afterFail`. */
const ZP = (() => {
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  // Firestore zwraca klucze map posortowane, a lokalne obiekty mają kolejność wstawiania: porównujemy tekst z posortowanymi kluczami
  const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v;
  const J = v => JSON.stringify(canon(v));
  const cl = v => JSON.parse(JSON.stringify(v));
  const DEL = {__del:true};                 // znacznik „usuń pole” – aplikacja zamienia go na deleteField()
  const TOMB_TTL = 60 * 864e5;              // nagrobki starsze niż 60 dni są czyszczone przy zapisie
  const MIRROR_MAX = 600000;                // powyżej tylu znaków JSON lustro starego układu jest pomijane
  const KINDS = [
    {k:'p', d:'pd', o:'po', os:'pos', t:'pt', m:'pm', mirror:'plans'},
    {k:'c', d:'cd', o:'co', os:'cos', t:'ct', m:'cm', mirror:'custom'},
  ];

  const emptyQueue = () => ({p:{}, pd:{}, c:{}, cd:{}, s:{}, po:0, co:0, f:0, m:0, t:0, mx:0});
  const emptyKnown = () => ({p:{}, c:{}, v3:false, pt:{}, ct:{}});
  const newZ = () => ({q:emptyQueue(), kn:emptyKnown()});
  /* Znacznik zmiany: nigdy mniejszy od niczego, co to urządzenie widziało w bazie (q.mx) – urządzenie z zegarem „do tyłu” nie przegra z cudzą zmianą, którą już widziało. */
  const stampQ = (q, now) => (q.t = Math.max(now == null ? Date.now() : now, (q.t || 0) + 1, (q.mx || 0) + 1));
  const MX_AHEAD = 30 * 864e5;              // czasy z bazy dalej niż 30 dni w przyszłość (zepsuty zegar) nie podnoszą q.mx
  const emptyQ = q => !Object.keys(q.p).length && !Object.keys(q.pd).length && !Object.keys(q.c).length && !Object.keys(q.cd).length
    && !Object.keys(q.s).length && !q.po && !q.co && !q.f && !q.m;
  /* Odczyt zapisanego stanu (z localStorage): brakujące albo uszkodzone pola dostają wartości puste. */
  function fixZ(z){
    const o = newZ();
    if (!isObj(z)) return o;
    const rec = v => { const r = {}; if (isObj(v)) for (const k of Object.keys(v)) if (Number.isFinite(+v[k])) r[k] = +v[k]; return r; };
    if (isObj(z.q)){ for (const f of ['p', 'pd', 'c', 'cd', 's']) o.q[f] = rec(z.q[f]); o.q.po = +z.q.po || 0; o.q.co = +z.q.co || 0; o.q.f = +z.q.f || 0; o.q.m = +z.q.m || 0; o.q.t = +z.q.t || 0; o.q.mx = +z.q.mx || 0; }
    if (isObj(z.kn)){ o.kn.p = rec(z.kn.p); o.kn.c = rec(z.kn.c); o.kn.v3 = !!z.kn.v3; o.kn.pt = rec(z.kn.pt); o.kn.ct = rec(z.kn.ct); }
    return o;
  }

  /* S (tablice) → {p:{id:plan}, po:[id], c:{id:ćw}, co:[id], s:{…}} (odwołania, bez kopiowania). Powtórzony id: liczy się pierwszy. */
  function split(S){
    const out = {p:{}, po:[], c:{}, co:[], s:{}};
    for (const [k, o, arr] of [['p', 'po', S && S.plans], ['c', 'co', S && S.custom]])
      for (const x of Array.isArray(arr) ? arr : []) if (x && typeof x.id === 'string' && !(x.id in out[k])){ out[k][x.id] = x; out[o].push(x.id); }
    out.s = {...((S && S.settings) || {})};
    return out;
  }
  const join = st => ({plans:st.po.map(id => st.p[id]), custom:st.co.map(id => st.c[id]), settings:{...st.s}});
  /* Odcisk stanu do porównań: każda pozycja jako tekst JSON. */
  function snap(S){
    const st = split(S), o = {p:{}, po:J(st.po), c:{}, co:J(st.co), s:{}};
    for (const id of st.po) o.p[id] = J(st.p[id]);
    for (const id of st.co) o.c[id] = J(st.c[id]);
    for (const k of Object.keys(st.s)) o.s[k] = J(st.s[k]);
    return o;
  }
  /* Co lokalnie zmieniono od poprzedniego odcisku → wpisy w kolejce. Zwraca nowy odcisk. */
  function diff(prev, S, q, now){
    const cur = snap(S);
    for (const K of KINDS){
      for (const id of Object.keys(cur[K.k])) if (prev[K.k][id] !== cur[K.k][id]){ q[K.k][id] = stampQ(q, now); delete q[K.d][id]; }
      for (const id of Object.keys(prev[K.k])) if (!(id in cur[K.k])){ q[K.d][id] = stampQ(q, now); delete q[K.k][id]; }
      if (prev[K.o] !== cur[K.o]) q[K.o] = stampQ(q, now);
    }
    for (const k of Object.keys(cur.s)) if (prev.s[k] !== cur.s[k]) q.s[k] = stampQ(q, now);
    return cur;
  }

  /* ---------- odczyt dokumentu z bazy ---------- */
  /* 'v3' = układ kompletny (jest znacznik `full` i mapy), 'old' = stary układ albo zapis starej karty. Brak dokumentu: 'empty'. */
  function layout(doc){
    if (!isObj(doc)) return 'empty';
    return doc.v === 3 && doc.full && isObj(doc.pm) && isObj(doc.cm) ? 'v3' : 'old';
  }
  const num = v => Number.isFinite(+v) ? +v : 0;
  /* Dokument v3 → widok „zdalny”. normPlan (opcjonalnie) normalizuje plan tak samo, jak `normalize` w aplikacji. */
  function remoteV3(doc, normPlan){
    const R = {mode:'v3', s:isObj(doc.settings) ? doc.settings : {}};
    for (const K of KINDS){
      R[K.k] = {};
      for (const [id, x] of Object.entries(doc[K.m] || {})){
        if (!isObj(x)) continue;
        const {u, ...item} = x; item.id = id;
        R[K.k][id] = {u:num(u), item:K.k === 'p' && normPlan ? normPlan(item) : item};
      }
      R[K.o] = (Array.isArray(doc[K.o]) ? doc[K.o] : []).filter(id => typeof id === 'string');
      R[K.os] = num(doc[K.os]);
      R[K.t] = {}; if (isObj(doc[K.t])) for (const id of Object.keys(doc[K.t])) R[K.t][id] = num(doc[K.t][id]);
    }
    return R;
  }
  /* Stary układ (tablice, już po `normalize`) → widok „zdalny”. seenV3 = to urządzenie widziało już układ v3 (wtedy to zapis starej karty). */
  function remoteOld(S, seenV3, tombs){
    const st = split(S), R = {mode:seenV3 ? 'repair' : 'v2', s:st.s};
    for (const K of KINDS){
      R[K.k] = {}; for (const id of st[K.o]) R[K.k][id] = {u:0, item:st[K.k][id]};
      R[K.o] = st[K.o].slice(); R[K.os] = 0; R[K.t] = {...((tombs && tombs[K.t]) || {})};   // stara karta nie zostawia nagrobków: używamy tych zapamiętanych z układu v3
    }
    return R;
  }
  /* Nagrobki z dokumentu v3: zapamiętane w kn (do naprawy po starej karcie i do nowego dokumentu) i informacja dla czyszczenia przy zapisie. */
  function rememberTombs(kn, doc, now){
    for (const K of KINDS){
      const t = {}; if (isObj(doc && doc[K.t])) for (const [id, ts] of Object.entries(doc[K.t])) if (num(ts) && now - num(ts) <= TOMB_TTL) t[id] = num(ts);
      kn[K.t] = t;
    }
    return kn;
  }
  function tombInfo(doc){
    const o = {pt:{}, ct:{}, pm:{}, cm:{}};
    if (!isObj(doc)) return o;
    for (const K of KINDS){
      if (isObj(doc[K.t])) for (const id of Object.keys(doc[K.t])) o[K.t][id] = num(doc[K.t][id]);
      if (isObj(doc[K.m])) for (const [id, x] of Object.entries(doc[K.m])) if (isObj(x)) o[K.m][id] = num(x.u);
    }
    return o;
  }

  /* ---------- scalanie: stan lokalny + kolejka + dokument z bazy (pkt 4 planu) ---------- */
  const later = (ua, ja, ub, jb) => ua > ub || (ua === ub && ja > jb);
  function merge(S, q0, kn0, R, now){
    const q = cl(q0), kn = cl(kn0), notes = [], L = split(S), res = {p:{}, po:[], c:{}, co:[], s:{}};
    // największy czas widziany w bazie: kolejne zmiany tego urządzenia dostaną większy znacznik (stampQ)
    const lim = (now == null ? Date.now() : now) + MX_AHEAD, seen = u => { if (u > (q.mx || 0) && u <= lim) q.mx = u; };
    for (const K of KINDS){ for (const r of Object.values(R[K.k])) seen(r.u); for (const ts of Object.values(R[K.t])) seen(ts); seen(R[K.os]); }
    for (const K of KINDS){
      const Li = L[K.k], Ri = R[K.k], Rt = R[K.t], E = q[K.k], D = q[K.d], KN = kn[K.k], out = res[K.k];
      const ids = new Set([...Object.keys(Li), ...Object.keys(Ri), ...Object.keys(D), ...Object.keys(E)]);
      for (const id of ids){
        const l = Li[id], pend = E[id], pdel = D[id], tomb = Rt[id];
        let r = Ri[id], hid = false;
        if (r && R.mode === 'v3' && tomb !== undefined && tomb > r.u){ r = undefined; hid = true; }   // starsza wersja pod nagrobkiem = usunięte
        if (pdel !== undefined){                                   // lokalnie usunięte, czeka wysyłka
          if (r && r.u > pdel){ out[id] = r.item; KN[id] = r.u; delete D[id]; notes.push({t:'restored', kind:K.k, id}); }
          else delete KN[id];
          continue;
        }
        if (pend !== undefined && !l) delete E[id];                // wpis bez pozycji – porządkujemy
        else if (pend !== undefined){                              // lokalna zmiana czeka wysyłka
          if (r && later(r.u, J(r.item), pend, J(l))){ out[id] = r.item; KN[id] = r.u; delete E[id]; notes.push({t:'remote-later', kind:K.k, id}); }
          else if (!r && R.mode === 'v3' && tomb !== undefined && tomb > pend){ delete E[id]; delete KN[id]; if (hid) D[id] = tomb; notes.push({t:'deleted-later', kind:K.k, id}); }
          else out[id] = l;
          continue;
        }
        // bez lokalnej zmiany w kolejce
        if (R.mode !== 'v3'){
          if (r){
            if (l && J(l) === J(r.item)) out[id] = l;
            else if (R.mode === 'repair' && !l && tomb !== undefined) notes.push({t:'old-card-ignored', kind:K.k, id});   // usunięte (znamy nagrobek z układu v3): stara karta go nie wskrzesza
            else if (R.mode === 'repair'){ out[id] = r.item; E[id] = stampQ(q, now); KN[id] = E[id]; notes.push({t:l ? 'old-card-changed' : 'old-card-new', kind:K.k, id}); }
            else out[id] = r.item;
          } else if (l && R.mode === 'repair') out[id] = l;        // stara karta nie zostawia nagrobków: nie usuwamy na jej podstawie
          continue;
        }
        if (r){
          if (l && KN[id] !== undefined && r.u < KN[id] && J(r.item) !== J(l)){ out[id] = l; E[id] = KN[id]; notes.push({t:'reassert', kind:K.k, id}); }   // spóźniony, starszy zapis w bazie
          else if (!l && tomb !== undefined && tomb > r.u){ /* usunięte później niż zmieniane */ }
          else { out[id] = r.item; KN[id] = r.u; }
        } else {
          if (l){ delete KN[id]; notes.push({t:'deleted-remote', kind:K.k, id}); }
          if (hid) D[id] = tomb;                                   // starszy wpis pod nagrobkiem (spóźniony zapis) – sprzątamy go w bazie z oryginalnym czasem usunięcia
        }
      }
      // kolejność: czekająca lokalna zmiana wygrywa tylko, gdy nie jest starsza od zmiany z bazy
      const have = Object.keys(out), uOf = id => E[id] ?? (Ri[id] && Ri[id].u) ?? KN[id] ?? 0;
      let base;
      if (q[K.o] > 0 && (q[K.o] > R[K.os] || R.mode !== 'v3')) base = L[K.o]; else { if (q[K.o] > 0) q[K.o] = 0; base = R[K.o]; }
      const seen = new Set(), ord = [];
      for (const id of base) if (id in out && !seen.has(id)){ seen.add(id); ord.push(id); }
      for (const id of have.filter(id => !seen.has(id)).sort((a, b) => uOf(a) - uOf(b) || (a < b ? -1 : 1))) ord.push(id);
      res[K.o] = ord;
    }
    if (R.mode === 'repair' && !q.f) q.f = stampQ(q, now);          // dokument zapisała stara karta: trzeba go odtworzyć w układzie v3 (nawet gdy nic się nie zmieniło)
    res.s = {...L.s};
    for (const k of Object.keys(R.s)) if (!(k in q.s)) res.s[k] = R.s[k];
    return {S:join(res), q, kn, notes};
  }

  /* ---------- zapis ---------- */
  /* Zwykły zapis scalający (tylko gdy to urządzenie widziało układ v3): {data, fields, sent} do setDoc(ref, data, {mergeFields:fields}).
     Wartości DEL aplikacja zamienia na deleteField(). Pole `u` ma tylko dokument, nie S. opts.tombs = {pt:{}, ct:{}} z ostatniego odczytu (do czyszczenia). */
  function buildWrite(S, q, now, opts){
    opts = opts || {};
    const st = split(S), data = {v:3}, fields = ['v'];
    const sent = {p:{}, pd:{}, c:{}, cd:{}, s:{}, po:0, co:0, m:0};
    let touched = false;
    for (const K of KINDS){
      const m = {}, t = {}; let ch = false;
      for (const [id, u] of Object.entries(q[K.k])) if (st[K.k][id]){ m[id] = {...cl(st[K.k][id]), u}; sent[K.k][id] = u; fields.push(K.m + '.' + id); ch = true; }
      for (const [id, ts] of Object.entries(q[K.d])){ m[id] = DEL; t[id] = ts; sent[K.d][id] = ts; fields.push(K.m + '.' + id, K.t + '.' + id); ch = true; }
      if (Object.keys(m).length){ data[K.m] = m; if (Object.keys(t).length) data[K.t] = t; }
      if (q[K.o]){   // kolejność idzie do bazy tylko po zmianie kolejności albo dodaniu/usunięciu pozycji (samo edytowanie jej nie rusza)
        data[K.o] = st[K.o].slice(); data[K.os] = q[K.o]; fields.push(K.o, K.os); sent[K.o] = q[K.o]; ch = true;
      }
      if (ch) touched = true;
      for (const [id, ts] of Object.entries((opts.tombs && opts.tombs[K.t]) || {}))
        if (now - ts > TOMB_TTL && !(id in t)){
          (data[K.t] ||= {})[id] = DEL; fields.push(K.t + '.' + id);
          const pu = opts.tombs[K.m] && opts.tombs[K.m][id];     // starszy wpis pod czyszczonym nagrobkiem też znika (inaczej plan wróciłby); wpis nowszy od nagrobka zostaje
          if (pu !== undefined && pu <= ts && !(id in m)){ (data[K.m] ||= {})[id] = DEL; fields.push(K.m + '.' + id); }
        }
    }
    if (q.m){ touched = true; sent.m = q.m; }   // samo odświeżenie lustra
    for (const [k, u] of Object.entries(q.s)){ if (k in st.s){ (data.settings ||= {})[k] = cl(st.s[k]); fields.push('settings.' + k); sent.s[k] = u; touched = true; } }
    if (!touched) return null;
    const plansTouched = Object.keys(sent.p).length || Object.keys(sent.pd).length || sent.po, custTouched = Object.keys(sent.c).length || Object.keys(sent.cd).length || sent.co;
    if (plansTouched || custTouched || q.m){
      const j = join(st);
      if (J(j).length > MIRROR_MAX) opts.mirrorSkipped = true;
      else { data.plans = cl(j.plans); data.custom = cl(j.custom); fields.push('plans', 'custom'); }
    }
    return {data, fields, sent, mirrorSkipped:!!opts.mirrorSkipped};
  }
  /* Pełny dokument v3 (migracja albo naprawa po starej karcie) – zapisywany w transakcji bez scalania.
     S = wynik `merge`, q = kolejka z `merge`, kn = znane czasy. */
  function fullDoc(S, q, kn, now){
    const st = split(S), doc = {v:3, full:now, pm:{}, po:st.po.slice(), pos:q.po || 0, cm:{}, co:st.co.slice(), cos:q.co || 0, pt:{}, ct:{}, settings:{...cl(st.s)}};
    const written = {p:{}, c:{}};
    for (const K of KINDS) for (const id of st[K.o]){ const u = q[K.k][id] ?? kn[K.k][id] ?? 0; doc[K.m][id] = {...cl(st[K.k][id]), u}; written[K.k][id] = u; }
    for (const K of KINDS)        // nagrobki młodsze niż 60 dni (zapamiętane z układu v3 + czekające usunięcia); wpis nowszy od nagrobka go unieważnia
      for (const [id, ts] of Object.entries({...(kn[K.t] || {}), ...q[K.d]}))
        if (now - ts <= TOMB_TTL && !(doc[K.m][id] && doc[K.m][id].u > ts)) doc[K.t][id] = ts;
    const j = join(st);
    if (J(j).length <= MIRROR_MAX){ doc.plans = cl(j.plans); doc.custom = cl(j.custom); }
    return {doc, written, sent:{p:{...q.p}, pd:{...q.pd}, c:{...q.c}, cd:{...q.cd}, s:{...q.s}, po:q.po, co:q.co, f:q.f, m:q.m}};
  }
  /* Treść transakcji migracji/naprawy: świeży dokument z bazy (albo null) + stan lokalny → dokument do zapisania. Nie zmienia Z ani S. */
  function migrate(S, z, doc, now, normOld){
    const lay = layout(doc);
    if (lay === 'v3') return {layout:'v3', noop:true};              // ktoś już naprawił dokument: dalej zwykły zapis scalający
    let R;
    if (lay === 'old') R = remoteOld(normOld ? normOld(doc) : S, z.kn.v3, {pt:z.kn.pt, ct:z.kn.ct});
    else R = {mode:'v2', s:{}, p:{}, po:[], pos:0, pt:{}, c:{}, co:[], cos:0, ct:{}};
    const mg = merge(S, z.q, z.kn, R, now);
    if (lay === 'empty') mg.S = join(split(S));                    // brak dokumentu: zapisujemy stan lokalny w całości
    const fd = fullDoc(mg.S, mg.q, mg.kn, now);
    return {...fd, notes:mg.notes, repaired:lay === 'old' && z.kn.v3, layout:lay};
  }
  /* Po udanym zapisie: usuń z kolejki wpisy, które się od wysyłki nie zmieniły; zapamiętaj czasy zatwierdzonych pozycji. */
  function afterSend(z, sent, written){
    const q = z.q;
    for (const K of KINDS){
      for (const [id, u] of Object.entries(sent[K.k] || {})){ if (q[K.k][id] === u) delete q[K.k][id]; z.kn[K.k][id] = u; }
      for (const [id, ts] of Object.entries(sent[K.d] || {})){ if (q[K.d][id] === ts) delete q[K.d][id]; delete z.kn[K.k][id]; }
      if (sent[K.o] && q[K.o] === sent[K.o]) q[K.o] = 0;
      for (const [id, u] of Object.entries((written && written[K.k]) || {})) z.kn[K.k][id] = u;
    }
    for (const [k, u] of Object.entries(sent.s || {})) if (q.s[k] === u) delete q.s[k];
    if (sent.f && q.f === sent.f) q.f = 0;
    if (sent.m && q.m === sent.m) q.m = 0;
    z.kn.v3 = true;
  }
  /* Lustro w dokumencie (dla starych kart i wycofania) bywa nieaktualne, gdy zapis z urządzenia bez sieci dotarł po zmianach z innych.
     Gdy nic nie czeka w kolejce, a lustro różni się od S, dokładamy jego odświeżenie. Wywołuj po `merge` na dokumencie v3. */
  function checkMirror(doc, S, q, now){
    if (layout(doc) !== 'v3' || !emptyQ(q)) return false;
    if (J({plans:S.plans || [], custom:S.custom || []}).length > MIRROR_MAX) return false;   // lustro i tak byłoby pomijane
    if (J(doc.plans || []) === J(S.plans || []) && J(doc.custom || []) === J(S.custom || [])) return false;
    q.m = stampQ(q, now); return true;
  }
  const BACKOFF = [2000, 5000, 15000, 60000];
  const backoff = n => BACKOFF[Math.min(Math.max(0, n | 0), BACKOFF.length - 1)];

  /* ---------- treningi (pkt 7 planu) ---------- */
  /* remote: [{id, pending, …dokument}] z migawki; fromCache: migawka z pamięci podręcznej (nie potwierdza i nie wymaga ponownej wysyłki);
     local: bieżąca lista treningów; unsent: id niewysłanych. Wynik: lista do historii (nieposortowana), nowa lista `unsent`, id do ponownej wysyłki. */
  function mergeSessions(remote, local, unsent, fromCache){
    const rm = new Map(); for (const d of remote || []) rm.set(d.id, d);
    const loc = new Map(); for (const s of local || []) if (s && s.id) loc.set(s.id, s);
    const keep = [], resend = [], list = (remote || []).map(d => { const {pending, ...s} = d; return s; });
    for (const id of unsent || []){
      const r = rm.get(id);
      if (r && !r.pending && !fromCache) continue;                // baza potwierdziła – lista się zwalnia
      if (r){ keep.push(id); continue; }                          // jest (albo czeka w kolejce SDK) – zostaje na liście
      const s = loc.get(id); if (!s) continue;                    // nie ma czego odtworzyć
      keep.push(id); list.push(s); if (!fromCache) resend.push(id);
    }
    return {list, unsent:keep, resend};
  }
  const without = (arr, id) => (arr || []).filter(x => x !== id);

  return {DEL, KINDS, TOMB_TTL, MIRROR_MAX, emptyQueue, emptyKnown, newZ, fixZ, emptyQ, stampQ, split, join, snap, diff, layout,
    same:(a, b) => J(a) === J(b), remoteV3, remoteOld, rememberTombs, tombInfo, merge, buildWrite, fullDoc, migrate, afterSend, checkMirror, backoff, mergeSessions, without};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ZP;
