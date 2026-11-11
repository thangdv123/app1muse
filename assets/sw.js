// Service worker cho app Dịch Nói Việt – Trung (nằm ở assets/, scope mặc định
// là /app1muse/assets/). Chỉ cache các file shell cùng origin, không cache
// các request API dịch cross-origin (Google Translate / MyMemory).
// Danh sách cache khớp với app một file hiện tại; không cache styles.css /
// app.js cũ. (Không gồm icon-192.png / icon-512.png vì chưa có file PNG.)
var CACHE = 'vtzh-v1';
var ASSETS = [
  '../index.html',
  './manifest.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // API dịch đi thẳng, không cache
  e.respondWith(
    caches.match(e.request).then(function (r) { return r || fetch(e.request); })
  );
});
