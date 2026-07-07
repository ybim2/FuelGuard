(function registerFuelGuardPwa() {
  const buildInfo = window.FUEL_GUARD_BUILD || {};
  const SERVICE_WORKER_URL = buildInfo.serviceWorkerUrl || "./sw.js?v=mobile-pwa-v37-data-tab-undo-rhythm";
  let registrationPromise = null;
  let refreshing = false;
  let updateCheckInFlight = false;

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
    if (refreshing) return;
    refreshing = true;
    updateStatus("Update status: new app shell active. Reloading...");
    window.location.reload();
  });

  function activateWaitingWorker(registration) {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  }

  function waitForInstallingWorker(registration) {
    return new Promise(resolve => {
      const worker = registration.installing;
      if (!worker) {
        resolve(false);
        return;
      }
      if (worker.state === "installed" || worker.state === "activated") {
        activateWaitingWorker(registration);
        resolve(Boolean(registration.waiting));
        return;
      }
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          activateWaitingWorker(registration);
          resolve(Boolean(registration.waiting));
        }
      });
    });
  }

  function registrationReady() {
    if (registrationPromise) return registrationPromise;
    registrationPromise = navigator.serviceWorker
      .register(SERVICE_WORKER_URL, { scope: "./", updateViaCache: "none" })
      .then(registration => {
        activateWaitingWorker(registration);
        registration.addEventListener("updatefound", () => {
          waitForInstallingWorker(registration);
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
        await waitForInstallingWorker(registration);
        return { status: "installing", buildVersion: buildLabel() };
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
