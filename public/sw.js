const CACHE = 'form-__BUILD_VERSION__';
const ASSETS = __PRECACHE_ASSETS__;
self.addEventListener('install', event => {
  // A failed asset download must not replace the last complete offline shell.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try { await cache.addAll(ASSETS.map(path => new Request(path, { cache: 'reload', credentials: 'omit' }))); }
    catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('form-'));
    const keep = new Set([CACHE, ...names.filter(name => name !== CACHE).slice(-1)]);
    await Promise.all(names.filter(name => !keep.has(name)).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url), key = url.pathname + url.search;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  if (event.request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname)) {
    event.respondWith((async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(event.request, { signal: controller.signal });
        if (response.status < 500) return response;
        const cached = await (await caches.open(CACHE)).match('/index.html');
        return cached || response;
      } catch {
        return await (await caches.open(CACHE)).match('/index.html') || new Response('Open FORM online once to prepare offline workouts.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      } finally { clearTimeout(timer); }
    })());
    return;
  }
  if (ASSETS.includes(key)) event.respondWith((async () => await (await caches.open(CACHE)).match(key) || fetch(event.request))());
});
