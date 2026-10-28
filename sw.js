// Libra service worker: speed only, never data.
//
// GitHub Pages lets browsers keep files for 10 minutes, so a later visit re-checks every script
// one round trip at a time, which is slow on mobile networks in Iran. This worker keeps the app's
// own public files on the device:
//   - /_next/static/*, /fonts/*, icons: content-hashed or fixed → cache first.
//   - pages (HTML, RSC .txt) and /config.json: network first with a short wait, cached copy if
//     the network is slow or down.
// It never touches other origins, so Supabase requests (sign-in, entries, amounts) always go
// straight to the network and nothing personal is ever cached.

const VERSION = 'libra-static-v1';
const PAGE_WAIT_MS = 3000;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (name) =>
              name !== VERSION && (name.startsWith('kharjban-') || name.startsWith('libra-')),
          )
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  ),
);

const isImmutable = (path) =>
  path.startsWith('/_next/static/') ||
  path.startsWith('/fonts/') ||
  /^\/(icon\.svg|icon-\d+\.png|apple-touch-icon\.png|manifest\.webmanifest)$/.test(path);

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, PAGE_WAIT_MS, null));
  try {
    const first = await Promise.race([network, timeout]);
    if (first) return first;
    // Slow network: answer from the cache if we can, otherwise keep waiting for the network.
    return (await cache.match(request, { ignoreSearch: true })) ?? (await network);
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Supabase and everything else: untouched
  if (isImmutable(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (
    request.mode === 'navigate' ||
    url.pathname === '/config.json' ||
    url.pathname.endsWith('.txt')
  ) {
    event.respondWith(networkFirst(request));
  }
});
