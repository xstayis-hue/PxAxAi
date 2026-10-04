/* PXAX · Ai — сервис-воркер: кэшируем только статику, API идёт в сеть */
const CACHE = 'pxax-ai-v1';
const STATIC_ASSETS = [
  './',
  './index.html',
  './scene3d.js',
  './js/api.js',
  './js/agent-actions.js',
  './js/perf.js',
  './js/quests.js',
  './assets/avatar-ai.svg',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // API и внешние запросы — только сеть
  if (url.origin !== self.location.origin || url.pathname.includes('workers.dev')) {
    return;
  }
  // модели — большие, кэшируем отдельной стратегией "сначала кэш, потом сеть"
  if (url.pathname.includes('/assets/scene3d/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request).then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      }))
    );
    return;
  }
  // остальная статика — сначала сеть, fallback в кэш
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
