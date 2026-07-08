const APP_VERSION = "mobile-pwa-v54-trend-charts";
const BUILD_VERSION = "2026-07-08T21:45:36Z";
const CACHE_PREFIX = "fuel-guard-";
const CACHE_NAME = "fuel-guard-mobile-pwa-v54-trend-charts-20260708T214536Z";
const APP_SHELL = [
  "./",
  "./index.html",
  "./build-info.js",
  "./styles.css",
  "./mobile-pwa.css",
  "./mobile-ux-overrides.css",
  "./fuel-beta.css",
  "./app-state.js",
  "./fuel-supabase.js",
  "./app-ui.js",
  "./app-pwa.js",
  "./fuel-history-render-guard.js",
  "./fuel-beta.js",
  "./fuel-beta-ui-polish.js",
  "./day-type-overrides.js",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

function appShellRequests() {
  return APP_SHELL.map(url => new Request(new URL(url, self.location.href), { cache: "reload" }));
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(cache => cache.addAll(appShellRequests()))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage({
      type: "FUEL_GUARD_VERSION",
      appVersion: APP_VERSION,
      buildVersion: BUILD_VERSION,
      cacheName: CACHE_NAME
    });
  }
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (requestUrl.pathname.endsWith("/sw.js")) return;
  if (requestUrl.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== "basic") return response;
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
