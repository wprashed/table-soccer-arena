const CACHE_NAME = 'tsa-cache-v1';
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET and websocket requests
  if (req.method !== 'GET' || url.protocol.startsWith('ws')) {
    return;
  }

  // API calls should never be served from SW cache
  if (url.pathname.includes('/api/')) {
    return;
  }

  // Navigation requests: Network-first, fallback to cached index.html if offline or 404
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // If GitHub Pages returns 404 for an SPA sub-route, fallback to index.html
          if (!res || res.status === 404) {
            return caches.match('./index.html').then((cached) => cached || caches.match('./') || res);
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then((res) => res || caches.match('./')))
    );
    return;
  }

  // Static assets (CSS, JS, images, sounds, fonts): Cache-first with background network revalidation
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Fetch in background to update cache
        fetch(req).then((res) => {
          if (res && res.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, res));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.status === 200 && (url.origin === self.location.origin)) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      });
    })
  );
});
