const CACHE_NAME = "fuel-guard-pwa-v27-rhythm-history";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./mobile-pwa.css",
  "./mobile-ux-overrides.css",
  "./fuel-beta.css",
  "./app-state.js",
  "./app-dashboard.js",
  "./app-forecast.js",
  "./app-barriers.js",
  "./app-ui.js",
  "./app-pwa.js",
  "./fuel-history-render-guard.js",
  "./fuel-risk-visuals.js",
  "./fuel-beta.js",
  "./fuel-beta-ui-polish.js",
  "./day-type-overrides.js",
  "./fg-button-ble.js",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then(response => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }))
  );
});
