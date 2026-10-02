const CACHE_NAME = 'kyu-radio-shell-v3';
const APP_SHELL = [
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './kyu-logo.png',
  './app-icon-180.png?v=2',
  './app-icon-192.png?v=2',
  './app-icon-512.png?v=2',
  './offline.html'
];
const START_URL = new URL('./', self.registration.scope).href;
const OFFLINE_URL = new URL('./offline.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);

    try {
      const response = await fetch(START_URL);
      if (response.ok) await cache.put(START_URL, response);
    } catch (error) {}

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('kyu-radio-shell-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin || request.destination === 'audio') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match(START_URL)) || caches.match(OFFLINE_URL))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
