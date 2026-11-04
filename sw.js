// Libra service worker: speed only, never data (the Android Share hand-off below is memory only).
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

// Android «اشتراک‌گذاری» → لیبرا (manifest share_target, POST). The shared text (a bank SMS) stays
// on the device: it is held in this worker's memory, handed once to /share/ and forgotten; it is
// never put in a URL, cached, stored or sent. A copy not picked up within a minute is dropped.
const SHARE_PATH = '/share/';
const SHARE_TTL_MS = 60_000;
let shared = null;

async function receiveShare(request) {
  try {
    const form = await request.formData();
    const pick = (name) => (typeof form.get(name) === 'string' ? form.get(name).trim() : '');
    const text = pick('text') || pick('title');
    shared = text ? { text: text.slice(0, 4000), at: Date.now() } : null;
  } catch {
    shared = null;
  }
  return Response.redirect(SHARE_PATH, 303);
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'libra-share-take' || !event.ports[0]) return;
  const fresh = shared && Date.now() - shared.at < SHARE_TTL_MS ? shared.text : null;
  shared = null;
  event.ports[0].postMessage({ text: fresh });
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method === 'POST' &&
    url.origin === self.location.origin &&
    url.pathname === SHARE_PATH
  ) {
    event.respondWith(receiveShare(request));
    return;
  }
  if (request.method !== 'GET') return;
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

// A task alarm's notification (WP-12): tapping it brings Libra forward on «کارهای من».
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate?.('/tasks/');
      }
      return self.clients.openWindow('/tasks/');
    })(),
  );
});
