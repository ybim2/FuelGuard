const APP_VERSION = "mobile-pwa-v117-training-mode";
const BUILD_VERSION = "2026-08-09T10:17:18Z";
const CACHE_PREFIX = "fuel-guard-";
const CACHE_NAME = "fuel-guard-mobile-pwa-v117-training-mode-20260809T101718Z";
const APP_SHELL = [
  "./",
  "./index.html",
  "./coach/index.html",
  "./coach/coach-beta.css",
  "./coach/coach-beta.js",
  "./coach/coach-platform.css",
  "./coach/coach-platform.js",
  "./coach/coach-attention.css",
  "./coach/coach-attention.js",
  "./coach/coach-intervention-workflow.css",
  "./coach/coach-intervention-workflow.js",
  "./coach/coach-team-intelligence.css",
  "./coach/coach-team-intelligence.js",
  "./coach/coach-review-scheduling.css",
  "./coach/coach-review-scheduling.js",
  "./coach/coach-team-structure.css",
  "./coach/coach-team-structure.js",
  "./coach/coach-training-schedule.css",
  "./coach/coach-training-schedule.js",
  "./performance/index.html",
  "./performance/performance.css",
  "./performance/performance.js",
  "./build-info.js",
  "./styles.css",
  "./mobile-pwa.css",
  "./mobile-ux-overrides.css",
  "./fuel-beta.css",
  "./training-fuel.css",
  "./training-mode.css",
  "./fuel-guard-domain.js",
  "./app-state.js",
  "./fuel-supabase.js",
  "./product-shell.js",
  "./organisation-sharing.js",
  "./garmin-connected-devices.js",
  "./app-ui.js",
  "./app-pwa.js",
  "./fuel-beta.js",
  "./training-fuel.js",
  "./training-mode.js",
  "./athlete-milestones.js",
  "./fuel-beta-ui-polish.js",
  "./day-type-overrides.js",
  "./manifest.webmanifest",
  "./icons/icon.svg"
];

function appShellRequests() {
  const urls = APP_SHELL.flatMap(url => {
    if (/\.(?:css|js)$/.test(url)) return [url, `${url}?v=${APP_VERSION}`];
    return [url];
  });
  return urls.map(url => new Request(new URL(url, self.location.href), { cache: "reload" }));
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
    const shell = requestUrl.pathname.startsWith("/coach")
      ? "./coach/index.html"
      : requestUrl.pathname.startsWith("/performance")
        ? "./performance/index.html"
        : "./index.html";
    event.respondWith(
      fetch(request)
        .then(response => {
          if (!response || response.status !== 200 || response.type !== "basic") return response;
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(shell, copy));
          return response;
        })
        .catch(() => caches.match(shell).then(response => response || caches.match("./index.html")))
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
      .catch(() => caches.match(request))
  );
});
