// service-worker.js — cachea el app shell para que la app funcione sin red.
// Al cambiar assets, sube CACHE_VERSION para invalidar la caché antigua.
//
// Durante el desarrollo puede quedar contenido obsoleto: usa la opción
// "Update on reload" de las DevTools o ejecuta `caches.delete(...)` en la
// consola. El SW también se autoactiva al recibir el mensaje 'SKIP_WAITING'.

const CACHE_VERSION = 'fanzine-v22';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/constants.js',
  './js/db.js',
  './js/store.js',
  './js/fonts.js',
  './js/canvas.js',
  './js/panels.js',
  './js/pdf.js',
  './js/io.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // Navegación: responde siempre con el shell (SPA de una sola página).
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(request))
    );
    return;
  }

  // Resto: cache-first con relleno desde la red.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => {
          if (new URL(request.url).origin === self.location.origin) cache.put(request, copy);
        });
        return response;
      });
    })
  );
});
