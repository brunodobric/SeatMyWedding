const CACHE_NAME = 'wedding-seating-v14';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/db.js',
  './js/state.js',
  './js/floor-plan.js',
  './js/seating-algo.js',
  './js/app.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/sync.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  'https://fonts.googleapis.com/css2?family=Great+Vibes&family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=Inter:wght@400;500;600&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(ASSETS.map(url => cache.add(url).catch(() => null)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isFirebaseOrGoogle(url) {
  return url.includes('googleapis.com')
    || url.includes('firebaseio.com')
    || url.includes('firestore.googleapis.com')
    || url.includes('identitytoolkit')
    || url.includes('securetoken.googleapis.com')
    || url.includes('gstatic.com/firebasejs');
}

/** Navigacija / HTML – network first, cache kao offline fallback */
function isHtmlRequest(request) {
  if (request.mode === 'navigate') return true;
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  const path = new URL(request.url).pathname;
  return path === '/' || path.endsWith('/') || path.endsWith('.html');
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = e.request.url;
  if (isFirebaseOrGoogle(url)) return;

  // HTML: network-first → brže vide deploy
  if (isHtmlRequest(e.request)) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // JS / CSS / ostalo: stale-while-revalidate
  // (odmah iz cachea, u pozadini osvježi za sljedeći put)
  e.respondWith(staleWhileRevalidate(e.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
      if (request.mode === 'navigate') {
        try { cache.put('./index.html', response.clone()); } catch (_) {}
      }
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request)
      || await cache.match('./index.html')
      || await cache.match('./');
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(response => {
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) {
    networkPromise.catch(() => {});
    return cached;
  }

  const network = await networkPromise;
  if (network) return network;

  return new Response('', { status: 504, statusText: 'Offline' });
}
