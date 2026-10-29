importScripts('./version.js');
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js'); // push handling lives in this same worker (one worker per scope) // defines APP_VERSION — bumping it on deploy auto-invalidates the old cache below
// Emergency bridge: the instant ANY push arrives, tell every open SIAGA window if it is an emergency, so the alert + siren
// appear at once — even when the page is in the background (OneSignal's own worker still shows the notification).
self.addEventListener('push', (event) => {
  try {
    let raw = ''; try { raw = event.data ? event.data.text() : ''; } catch (e) {}
    if (!raw || raw.indexOf('emergency') < 0) return;
    let id = '', at = Date.now();
    const m = raw.match(/"id"\s*:\s*"(SOS\d+)"/) || raw.match(/id=(SOS\d+)/); if (m) id = m[1];
    const a = raw.match(/"at"\s*:\s*"?(\d{12,})"?/); if (a) at = Number(a[1]);
    if (!id) return;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      list.forEach((c) => { try { c.postMessage({ type: 'siaga-emergency', id: id, at: at }); } catch (e) {} });
    }));
  } catch (e) {}
});
const CACHE_NAME = 'kkah-hr-shell-' + APP_VERSION;
const SHELL_FILES = [
  './login.html',
  './dashboard.html',
  './emergency.html',
  './emergency-alert.js',
  './jsQR.min.js',
  './device.js',
  './siren.mp3',
  './manifest.json',
  './siaga-192.png',
  './siaga-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})))).catch(() => {})
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
