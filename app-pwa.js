(function registerFuelGuardPwa() {
  const buildInfo = window.FUEL_GUARD_BUILD || {};
  const SERVICE_WORKER_URL = buildInfo.serviceWorkerUrl || "./sw.js?v=mobile-pwa-v134-overnight-integration";
  const SERVICE_WORKER_SCOPE = buildInfo.serviceWorkerScope || "./";
  let registrationPromise = null;
  let refreshing = false;
  let updateCheckInFlight = false;
  let reloadOnControllerChange = false;

  function updateStatus(message) {
    window.dispatchEvent(new CustomEvent("fuelguard:pwa-update-status", {
      detail: { message }
    }));
  }

  function buildLabel() {
    return buildInfo.buildVersion || "unknown build";
  }

  window.fuelGuardPwaUpdates = {
    buildInfo,
    async checkForUpdate() {
      updateStatus("Update status: service workers are not supported in this browser.");
      return { status: "unsupported", buildVersion: buildLabel() };
    }
  };

  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // A first install can acquire a controller after the page is already
    // visible. That is not an app update and must not flash the global loader
    // a second time. Reload only after the athlete explicitly accepts an
    // already-downloaded update from Settings.
    if (!reloadOnControllerChange || refreshing) return;
    refreshing = true;
    updateStatus("Update status: new app shell active. Reloading...");
    window.location.reload();
  });

  function activateWaitingWorker(registration) {
    if (registration.waiting) {
      reloadOnControllerChange = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return true;
    }
    return false;
  }

  function waitForInstallingWorker(registration, { activate = false } = {}) {
    return new Promise(resolve => {
      const worker = registration.installing;
      if (!worker) {
        resolve(false);
        return;
      }
      if (worker.state === "installed" || worker.state === "activated") {
        if (activate) activateWaitingWorker(registration);
        resolve(Boolean(registration.waiting));
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          if (activate) activateWaitingWorker(registration);
          resolve(Boolean(registration.waiting));
        }
      });
    });
  }

  function registrationReady() {
    if (registrationPromise) return registrationPromise;
    registrationPromise = navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE, updateViaCache: "none" })
      .then(registration => {
        registration.addEventListener("updatefound", () => {
          waitForInstallingWorker(registration).then(waiting => {
            if (waiting) updateStatus("Update status: a new app shell is ready in Settings.");
          });
        });
        return registration;
      });
    return registrationPromise;
  }

  async function checkForUpdate() {
    if (updateCheckInFlight) {
      updateStatus("Update status: update check already running.");
      return { status: "checking", buildVersion: buildLabel() };
    }

    updateCheckInFlight = true;
    updateStatus("Update status: checking for a newer app shell...");
    try {
      const registration = await registrationReady();
      await registration.update();
      if (registration.waiting) {
        updateStatus("Update status: update found. Activating and refreshing...");
        activateWaitingWorker(registration);
        return { status: "activating", buildVersion: buildLabel() };
      }
      if (registration.installing) {
        updateStatus("Update status: downloading update...");
        const waiting = await waitForInstallingWorker(registration, { activate: true });
        return { status: waiting ? "activating" : "installing", buildVersion: buildLabel() };
      }
      updateStatus(`Update status: latest available build loaded (${buildLabel()}).`);
      return { status: "current", buildVersion: buildLabel() };
    } catch (error) {
      updateStatus(`Update status: update check failed. ${error?.message || "Try again when online."}`);
      return { status: "error", error, buildVersion: buildLabel() };
    } finally {
      updateCheckInFlight = false;
    }
  }

  window.fuelGuardPwaUpdates = {
    buildInfo,
    checkForUpdate,
    get registration() {
      return registrationPromise;
    }
  };

  window.addEventListener("load", () => {
    registrationReady()
      .then(registration => {
        return registration.update();
      })
      .catch(error => {
        console.warn("Fuel Guard service worker registration failed.", error);
      });
  });
})();
