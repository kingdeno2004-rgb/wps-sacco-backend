const cacheName = 'wps-v3'; // Incremented to v3 to force cache clearing
const assets = [
  './',
  'index.html',
  'manifest.json',
  'icon.png'
];

// 1. Install Service Worker and Cache Files
self.addEventListener('install', (e) => {
  // force the waiting service worker to become the active service worker immediately
  self.skipWaiting();
  e.waitUntil(
    caches.open(cacheName).then((cache) => {
      console.log('WPowerSacco: Caching App Shell');
      return cache.addAll(assets);
    })
  );
});

// 2. Activate and Remove Old Caches Instantly
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys
        .filter(key => key !== cacheName)
        .map(key => caches.delete(key))
      );
    }).then(() => {
      // Allows the service worker to claim the page immediately without a reload
      return self.clients.claim();
    })
  );
});

// 3. Network First Strategy (Fixes the development freeze)
// Always checks the local server first. If found, serves it. Falls back to cache if offline.
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request)
      .then((networkRes) => {
        // If the network call is successful, return the fresh file
        return networkRes;
      })
      .catch(() => {
        // If offline or network fails, fall back to the saved cache
        return caches.match(e.request);
      })
  );
});