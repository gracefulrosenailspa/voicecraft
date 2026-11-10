/* VoiceCraft app-shell cache.
 * Deliberately excludes user content, audio, API keys, relay requests and provider APIs.
 * Offline mode only makes the interface shell available; cloud generation needs internet.
 */
'use strict';

const CACHE_NAME = 'voicecraft-shell-v1';
const APP_BASE = new URL('./', self.location.href);
const SHELL_URLS = [
  new URL('./', self.location.href).href,
  new URL('./index.html', self.location.href).href,
  new URL('./manifest.webmanifest', self.location.href).href,
  new URL('./icon.svg', self.location.href).href,
  new URL('./icons/icon-192.png', self.location.href).href,
  new URL('./icons/icon-512.png', self.location.href).href
];
const SHELL_SET = new Set(SHELL_URLS);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('voicecraft-shell-') && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(APP_BASE.href)) return;
  if (!SHELL_SET.has(url.href.split('#')[0].split('?')[0])) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(new URL('./index.html', self.location.href).href, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(new URL('./index.html', self.location.href).href)) || (await caches.match(new URL('./', self.location.href).href)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
