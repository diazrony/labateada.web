const CACHE_NAME = 'la-bateada-v2';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/teams.html',
  '/style.css',
  '/common.js',
  '/app.js',
  '/teams.js',
  '/manifest.json',
  '/LaBateada.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Only same-origin app-shell requests are handled here; MLB API calls (cross-origin)
// pass straight through so scores are never served stale from cache.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Stale-while-revalidate: sirve la copia cacheada al toque si existe, pero
  // siempre relanza el fetch para refrescar la cache en segundo plano. Así
  // un cambio en app.js/style.css llega en el siguiente reload sin depender
  // de que alguien se acuerde de subir CACHE_NAME para que el SW reinstale.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const actualizado = fetch(request)
        .then((response) => {
          cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || actualizado;
    })
  );
});
