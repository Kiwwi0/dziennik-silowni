// Pozwala korzystać z aplikacji bez internetu (np. na siłowni).
const VERSION = 'dziennik-8701f6c644';
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
      // Najpierw sieć (żeby dostać nową wersję), bez sieci zapisana kopia.
      event.respondWith((async () => {
        try {
          const res = await fetch(req);
          if (res.ok && /\/(index\.html)?$/.test(url.pathname)) { const cache = await caches.open(VERSION); cache.put('./index.html', res.clone()); }
          return res;
        } catch (e) {
          return (await caches.match('./index.html')) || Response.error();
        }
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
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
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
