// The build prepends ASSETS and REVISION using the generated application shell.
const prefix = `scribeforge-offline:${self.registration.scope}:`;
const cacheName = prefix + REVISION;
const scope = new URL(self.registration.scope);
const urls = ASSETS.map(asset => new URL(asset, scope).href);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(urls)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const shell = url.pathname === scope.pathname ? new URL('index.html', scope).href : url.origin + url.pathname;
  if (!urls.includes(shell)) return;
  event.respondWith(fetch(event.request).catch(async () => (await caches.open(cacheName)).match(shell)));
});
