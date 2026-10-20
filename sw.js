const CACHE_NAME = 'wedding-seating-v26';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './fonts/fonts.css',
  './fonts/cormorant-normal-latin.woff2',
  './fonts/cormorant-normal-latin-ext.woff2',
  './fonts/cormorant-italic-latin.woff2',
  './fonts/cormorant-italic-latin-ext.woff2',
  './fonts/jost-normal-latin.woff2',
  './fonts/jost-normal-latin-ext.woff2',
  './fonts/pinyon-latin.woff2',
  './fonts/pinyon-latin-ext.woff2',
  './js/icons.js',
  './js/db.js',
  './js/state.js',
  './js/floor-plan.js',
  './js/hall.js',
  './js/guest-import.js',
  './js/guest-drag.js',
  './js/seating-algo.js',
  './js/splash.js',
  './js/app.js',
  './js/firebase-config.js',
  './js/auth.js',
  './js/sync.js',
  './icons/icon.svg',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png'
];

// Every deploy must bump CACHE_NAME: the whole app is cached as one version,
// so the HTML, JS and CSS a user sees always belong together.

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(ASSETS.map(url => cache.add(new Request(url, { cache: 'reload' }))))
    )
  );
  // No skipWaiting here: an open page keeps its version until the user taps
  // "Osvježi" (see SKIP_WAITING below). A first install has nothing to wait for.
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (isFirebaseOrGoogle(e.request.url)) return;
  if (url.origin !== self.location.origin) return;
  e.respondWith(fromVersion(e.request));
});

// Cache-first from this version's cache; the network only fills gaps.
async function fromVersion(request) {
  const cache = await caches.open(CACHE_NAME);
  const isPage = request.mode === 'navigate';
  const cached = isPage
    ? await cache.match('./index.html')
    : await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
