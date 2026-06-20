(function registerFuelGuardPwa() {
  if (!("serviceWorker" in navigator)) return;

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then(registration => registration.update())
      .catch(error => {
        console.warn("Fuel Guard service worker registration failed.", error);
      });
  });
})();
