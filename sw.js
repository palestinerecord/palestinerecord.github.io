/* ============================================================
   sw.js — the record, offline.

   Two reasons this exists. The first is connectivity: a reader on a
   bad connection, or none, should still be able to open a record they
   have already loaded, and the people most likely to need it are not
   the people with the best networks. The second is weight — the boot
   payload is about 1.3 MB of JSON, and paying it again on every visit
   is a cost with nothing to show for it.

   Three strategies, chosen by what the file is:

     navigations   network first, falling back to whatever is cached,
                   then to the app shell. The live page always wins
                   when there is a network, so an update is never held
                   back by this file.
     data/*.json   stale while revalidate. The cached copy is served
                   at once and replaced in the background, so a reader
                   sees last night's figures instantly and this
                   morning's on the next view.
     everything    cache first. Local assets are versioned with ?v=N
     else          and the CDN libraries are pinned by integrity hash,
                   so a hit is a hit on exactly the right bytes.

   The shell cache is versioned and the old ones are deleted on
   activation. The data cache is not versioned: a new build of the app
   is no reason to throw away the record it reads.

   Escape hatch: load the site with ?nosw=1 and index.html unregisters
   this worker and empties every cache it made.
   ============================================================ */

const VERSION = 'v117';
const SHELL = 'record-shell-' + VERSION;
const DATA = 'record-data';
const MINE = /^record-(shell|data)/;

/* The app shell. Everything here is either versioned or immutable, so a
   cached copy cannot be the wrong one. The data files are deliberately
   absent: they are large, they change nightly, and the first visit
   should not pay for a second copy of them. */
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css?v=117',
  './js/charts.js?v=117',
  './js/share.js?v=117',
  './js/views.js?v=117',
  './js/app.js?v=117',
  './js/scene.js?v=117',
  './manifest.webmanifest',
  './assets/flag-palestine.svg?v=117',
  './assets/favicon.svg?v=117',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Added one at a time rather than with addAll: addAll is atomic, so a
    // single 404 would fail the whole install and leave the site with no
    // worker at all. A shell missing one file is worth more than that.
    await Promise.all(SHELL_FILES.map((url) => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => MINE.test(name) && name !== SHELL && name !== DATA)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

/* index.html asks for this when it is loaded with ?nosw=1. */
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'clear') return;
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => MINE.test(name)).map((name) => caches.delete(name)));
    await self.registration.unregister();
  })());
});

const isData = (url) => url.origin === self.location.origin && /\/data\/[^/]+\.json$/.test(url.pathname);

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(SHELL);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const shell = await caches.match('./index.html', { ignoreSearch: true });
    if (shell) return shell;
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Offline</title>'
      + '<body style="background:#05070c;color:#e9edf6;font:16px/1.6 system-ui;padding:40px">'
      + '<h1 style="font-weight:600">The record is not cached yet</h1>'
      + '<p>This page has not been loaded on this device while online, so there is nothing '
      + 'stored to show. Reconnect and open it once, and it will be available offline after that.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

/* Serve the cached copy immediately, then replace it for next time. A figure
   that is a few hours old and on screen is worth more than the current one
   after a four-second wait, and the revalidation closes the gap anyway. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  if (cached) {
    // Do not let the page's fetch promise wait on the background update.
    network.catch(() => {});
    return cached;
  }
  const response = await network;
  if (response) return response;
  throw new Error('offline and uncached: ' + request.url);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(SHELL);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // prerender.py renders the site through a throwaway local server with
  // ?prerender=1. A worker caching those responses would be caching a
  // deliberately incomplete page.
  if (url.searchParams.has('prerender') || url.searchParams.has('nosw')) return;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Anything on another origin is left entirely alone. The constituency
  // ledger turns a postcode into a seat by asking postcodes.io, and a worker
  // that answers for that request caches nothing useful and breaks the one
  // call on this site that has to reach a service other than this one.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isData(url)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  event.respondWith(cacheFirst(request).catch(() => caches.match(request, { ignoreSearch: true })));
});
