/* PXAX · Nova — сервис-воркер: кэшируем только статику, API идёт в сеть */
const CACHE = 'pxax-ai-v4';
const STATIC_ASSETS = [
  './',
  './index.html',
  './scene3d.js',
  './js/api.js',
  './js/agent-actions.js',
  './js/perf.js',
  './js/quests.js',
  './js/games.js',
  './js/life.js',
  './assets/avatar-nova.jpg',
  './assets/icon-192.png',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' — иначе GitHub Pages (max-age=600) отдаёт из HTTP-кэша старую
      // версию авы/иконок, и новый кэш наполняется устаревшими файлами
      .then((cache) => Promise.all(
        STATIC_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
      ))
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
  // остальная статика — сначала сеть, fallback в кэш.
  // Для кода и разметки просим ревалидацию: GitHub Pages отдаёт статику с max-age=600,
  // и без этого после обновления приложения пользователь до 10 минут видел бы старую версию.
  const revalidate = /\.(?:html|js|mjs|css|json|webmanifest)$/i.test(url.pathname) || url.pathname.endsWith('/');
  event.respondWith(
    fetch(event.request, revalidate ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
