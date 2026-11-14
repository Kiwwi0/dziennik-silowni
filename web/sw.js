// Pozwala korzystać z aplikacji bez internetu (np. na siłowni).
const VERSION = 'dziennik-8386f954fd';
const NAV_WAIT_MS = 3000;   // tyle czeka otwarcie strony na sieć, gdy jest zapisana kopia
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];
const IMAGES = [];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(CORE);
    await Promise.allSettled(IMAGES.map((u) => cache.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION && k !== 'fonts' && k !== 'libs').map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      // Wyścig: sieć kontra kopia. Dobra sieć -> od razu nowa wersja. Sieć milczy ponad 3 s albo jej brak -> kopia ./index.html.
      // Spóźniona odpowiedź sieci i tak trafia do pamięci (w tle), więc następne otwarcie ma już nową wersję.
      const isHome = /\/(index\.html)?$/.test(url.pathname);
      const net = fetch(req).then((res) => {
        if (res.ok && isHome) { const copy = res.clone(); caches.open(VERSION).then((cache) => cache.put('./index.html', copy)).catch(() => {}); }
        return res;
      });
      event.waitUntil(net.catch(() => {}));
      event.respondWith((async () => {
        const cached = await caches.match('./index.html');
        if (!cached) {
          try { return await net; } catch (e) { return Response.error(); }
        }
        let timer;
        const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), NAV_WAIT_MS); });
        const res = await Promise.race([net.catch(() => null), slow]);
        clearTimeout(timer);
        return res || cached;
      })());
      return;
    }
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const cache = await caches.open(VERSION); cache.put(req, res.clone()); }
      return res;
    })());
    return;
  }
  if (url.hostname.endsWith('openfoodfacts.org')) return;   // odpowiedzi API nigdy nie trafiają do pamięci podręcznej
  if ((url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) || (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@zxing/library@'))) {
    // Biblioteka bazy danych: wersja w adresie się nie zmienia, więc wystarczy pamięć podręczna.
    event.respondWith((async () => {
      const cache = await caches.open('libs');
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith((async () => {
      const cache = await caches.open('fonts');
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })());
  }
});
