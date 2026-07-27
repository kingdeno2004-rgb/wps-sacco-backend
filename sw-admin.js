const CACHE_NAME = 'wp-treasury-v2';
const assets = [
  '/ledger.html',
  '/icon-admin.png',
  '/manifest-admin.json',
  'https://cdn-icons-png.flaticon.com/512/1162/1162951.png'
];

self.addEventListener('install', (e) => {
  // Forces the waiting service worker to become the active service worker
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(assets))
  );
});

self.addEventListener('activate', (e) => {
  // Clean up old caches
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});