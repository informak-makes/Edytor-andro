// Pisak działa offline: pliki aplikacji są trzymane w pamięci podręcznej.
// Przy każdej zmianie apki podbij VERSION (i APP_VERSION w app.js) – telefon wtedy pobierze nową wersję.
const VERSION = 4;
const CACHE = 'pisak-v' + VERSION;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'export.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' – z pominięciem pamięci przeglądarki, żeby nie wziąć starych plików.
  const requests = FILES.map(f => new Request(f, { cache: 'reload' }));
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  const navigate = request.mode === 'navigate';
  const key = navigate ? 'index.html' : request;

  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: true });
    const fresh = fetch(navigate ? 'index.html' : request.url, { cache: 'no-cache' }).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    if (cached) {
      e.waitUntil(fresh);
      return cached;
    }
    return fresh;
  }));
});
