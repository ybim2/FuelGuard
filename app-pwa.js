(function registerFuelGuardPwa() {
  if (!("serviceWorker" in navigator)) return;

  const SERVICE_WORKER_URL = "./sw.js?v=mobile-pwa-v3-habits";

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  function activateWaitingWorker(registration) {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "./", updateViaCache: "none" })
      .then(registration => {
        activateWaitingWorker(registration);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              activateWaitingWorker(registration);
            }
          });
        });
        return registration.update();
      })
      .catch(error => {
        console.warn("Fuel Guard service worker registration failed.", error);
      });
  });
})();
