// POLYCADE service worker.
// - Navigations (index.html) are NETWORK-FIRST so a fresh deploy is picked up
//   immediately and returning users are never stranded on a stale shell that
//   references hashed chunks that no longer exist.
// - Hashed assets are CACHE-FIRST (immutable filenames => safe forever).
// - Old caches are deleted on activate, and the cache name is versioned.
const VERSION = 'polycade-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== VERSION) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // Navigations + the HTML shell: network-first, fall back to cache offline.
  const isNavigation = req.mode === 'navigate' || req.destination === 'document';
  if (isNavigation) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(VERSION);
        try {
          const fresh = await fetch(req);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(req)) || (await cache.match('./')) || Response.error();
        }
      })(),
    );
    return;
  }

  // Everything else (hashed JS/CSS/assets): cache-first, revalidate in background.
  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
