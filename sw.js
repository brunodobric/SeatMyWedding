const CACHE_NAME = 'wedding-seating-v9';
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

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  // Ne cache-aj Firebase / Google API pozive
  if (url.includes('googleapis.com') || url.includes('firebaseio.com') ||
      url.includes('firestore.googleapis.com') || url.includes('identitytoolkit') ||
      url.includes('securetoken.googleapis.com')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        return response;
      }).catch(() => cached);
    })
  );
});
