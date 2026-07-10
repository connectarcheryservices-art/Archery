/* Archery.Services service worker — offline support + fast repeat loads.
 * Strategy:
 *   • App shell (pages, CSS, JS, icons) precached on install.
 *   • Navigations: network-first → cache → branded offline page.
 *   • GET /api/*: network-first → cache (last-seen products/tournaments show offline).
 *   • Other static assets: stale-while-revalidate.
 *   • Never caches POST/PUT/DELETE or admin — those require the network.
 * Bump CACHE to ship an update (old caches are purged on activate). */
const CACHE = 'archery-v3';
const SHELL = [
  '/', '/index.html', '/offline.html',
  '/shop', '/tournaments', '/athletes', '/knowledge', '/community',
  '/federation', '/jobs', '/pricing', '/about', '/contact',
  '/style.css', '/shared.js', '/nav.js', '/reco.js',
  '/favicon.svg', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll fails the whole install if any 404s; add resiliently instead.
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isApi = url => url.pathname.startsWith('/api/');

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;                 // writes always hit the network
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;      // don't touch cross-origin (fonts, Razorpay)
  if (url.pathname.startsWith('/admin')) return;        // admin is always live

  // Page navigations → network first, fall back to cache, then offline page.
  if (request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        const c = await caches.open(CACHE); c.put(request, res.clone());
        return res;
      } catch {
        return (await caches.match(request)) || (await caches.match('/offline.html')) || Response.error();
      }
    })());
    return;
  }

  // GET API → network first, cache the good response for offline reads.
  if (isApi(url)) {
    e.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res.ok) { const c = await caches.open(CACHE); c.put(request, res.clone()); }
        return res;
      } catch {
        return (await caches.match(request)) ||
          new Response(JSON.stringify({ offline: true }), { headers: { 'Content-Type': 'application/json' }, status: 503 });
      }
    })());
    return;
  }

  // Static assets → stale-while-revalidate.
  e.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(request, res.clone()));
      return res;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
