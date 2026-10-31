// KupCAD's service worker: the IDE offline. The build puts what it caches (FILES, every file a
// page may load: the page, its scripts and styles, the core's WebAssembly module and its worker,
// the fonts and icons) and their version (VERSION) before this code
// (integrations/service-worker.js). Installed, it caches them all; a request for one is answered from the
// cache, a page's (a navigation) by the IDE's page, and anything else goes to the network. A new
// build is a new worker, which waits while the old one has pages open, until a page asks it to
// take over (the header's Update); then the old version's cache is dropped.

const worker = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));
const CACHE = `kupcad-${VERSION}`;
/** The IDE's page, which answers any navigation. */
const PAGE = '/';

worker.addEventListener('install', (event) => {
  // From the server, past the browser's HTTP cache: an older page there isn't this version's
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('kupcad-') && name !== CACHE) await caches.delete(name);
      }
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('message', (event) => {
  if (event.data === 'update') void worker.skipWaiting();
});

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin) return;
  const cached = request.mode === 'navigate' ? PAGE : url.pathname;
  if (request.mode !== 'navigate' && !FILES.includes(cached)) return;
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(cached))
      .then((response) => response ?? fetch(request)),
  );
});
