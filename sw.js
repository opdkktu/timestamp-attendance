importScripts('./version.js');
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); // push handling lives in this same worker (one worker per scope) // defines APP_VERSION — bumping it on deploy auto-invalidates the old cache below
const CACHE_NAME = 'kkah-hr-shell-' + APP_VERSION;
const SHELL_FILES = [
  './login.html',
  './dashboard.html',
  './manifest.json',
  './siaga-192.png',
  './siaga-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first for everything (this is a live data app) — falls back to the
// cached shell only when fully offline, so staff at least see the app frame.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
