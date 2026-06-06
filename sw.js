const CACHE = 'fithouse-v1';
const ASSETS = ['/', '/index.html', '/assets/css/styles.css', '/assets/js/app.js', '/fithause logo.png', '/member/', '/trainer/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.hostname.includes('firestore') || url.hostname.includes('firebase') || url.hostname.includes('googleapis')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok) { const c = r.clone(); caches.open(CACHE).then(cache => cache.put(e.request, c)); }
      return r;
    }).catch(() => caches.match(e.request))
  );
});
