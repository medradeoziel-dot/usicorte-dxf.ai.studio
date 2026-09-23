// CAD Viewer Service Worker for PWA Offline Support, File Handling & Share Target
const CACHE_NAME = 'cad-viewer-pwa-v2';
const SHARE_CACHE = 'shared-cad-files';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install event: cache app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    })
  );
  self.skipWaiting();
});

// Activate event: clean up stale caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== SHARE_CACHE) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event: handle Share Target POST and standard requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle Web Share Target POST /share-target
  if (event.request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith(
      (async () => {
        try {
          const formData = await event.request.formData();
          const file = formData.get('file');
          if (file && file instanceof File) {
            const cache = await caches.open(SHARE_CACHE);
            const headers = new Headers();
            headers.set('content-type', file.type || 'application/octet-stream');
            headers.set('x-file-name', encodeURIComponent(file.name));
            headers.set('x-file-size', String(file.size));
            headers.set('x-last-modified', String(file.lastModified));
            await cache.put('/shared-file', new Response(file, { headers }));
          }
        } catch (err) {
          console.error('[PWA SW] Erro ao processar arquivo compartilhado:', err);
        }
        return Response.redirect('/?shared=true', 303);
      })()
    );
    return;
  }

  // Only handle GET requests and http/https requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Try fetching from network to get latest version
      return fetch(event.request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            networkResponse.type === 'basic'
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline or network error, return cached response
          if (cachedResponse) {
            return cachedResponse;
          }
          // If navigation request fails, return cached index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/') || caches.match('/index.html');
          }
        });
    })
  );
});
