self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('kharjban-') || name.startsWith('libra-'))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  ),
);
// Account pages are network-only. No private data or authenticated HTML cache.
