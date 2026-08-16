(() => {
  const APP_ORDER = Object.freeze(["quick_log", "activity_logger"]);
  const RECONNECT_POLL_INTERVAL_MS = 3000;
  const RECONNECT_POLL_ATTEMPTS = 20;
  const RECONNECT_SUCCESS_MS = 1800;
  const APP_DETAILS = Object.freeze({
    quick_log: Object.freeze({
      label: "Quick Log",
      description: "Use Quick Log to record Fuel, Hydration and Sleepy moments from your watch.",
      firstUseDescription: "Fuel, Hydration and Sleepy logging from your watch.",
      storeLabel: "Get Quick Log",
      storeUrl: "https://apps.garmin.com/en-US/apps/daa45a0d-e858-4b08-84b1-e9bb9a8196f3",
      steps: Object.freeze([
        "Open Fuel Guard Quick Log on your Garmin.",
        "Select Connect Fuel Guard.",
        "Approve the Fuel Guard request in the Connect IQ Store app on your phone."
      ])
    }),
    activity_logger: Object.freeze({
      label: "Activity Logger",
      description: "Connect Activity Logger to use Fuel Guard with supported Garmin activities.",
      firstUseDescription: "Fuel Guard logging during supported Garmin activities.",
      storeLabel: "Get Activity Logger",
      storeUrl: "https://apps.garmin.com/en-US/apps/2c53ef82-9139-4c73-ac75-2ed75abceb3b",
      steps: Object.freeze([
        "Open Fuel Guard Activity Logger settings on your Garmin.",
        "Select Connect Fuel Guard.",
        "Approve the Fuel Guard request in the Connect IQ Store app on your phone."
      ])
    })
  });

  let devices = [];
  let loading = false;
  let actionInFlight = false;
  let dialogState = null;
  let dialogTrigger = null;
  let reconnectPollTimer = null;
  let reconnectPollAttempts = 0;
  let reconnectPollAppId = null;
  let reconnectSuccessTimer = null;
  let onboarding = {
    quickLogConnected: false,
    firstWatchLogReceived: false,
    latestWatchLogAt: "",
    completed: false
  };

  function els() {
    return {
      card: document.getElementById("garminDevicesCard"),
      list: document.getElementById("garminDevicesList"),
      status: document.getElementById("garminDevicesStatus"),
      refresh: document.getElementById("garminDevicesRefresh"),
      dialog: document.getElementById("garminDevicesDialog")
    };
  }

  function cloud() {
    return window.fuelGuardCloud || null;
  }

  function token() {
    return cloud()?.accessToken?.() || "";
  }

  function safe(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function calendarDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function formatLastUsed(value, now = new Date()) {
    if (!value) return "Not yet used";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Not yet used";
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
    const dayDifference = Math.round((calendarDay(now) - calendarDay(date)) / 86400000);
    if (dayDifference === 0) return `Today, ${time}`;
    if (dayDifference === 1) return `Yesterday, ${time}`;
    const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
    return `${day}, ${time}`;
  }

  function setStatus(message) {
    const { status } = els();
    if (status) status.textContent = message || "";
  }

  function appDevices(appId) {
    return devices.filter(device => device?.app_id === appId);
  }

  function activeDevices(appId) {
    return appDevices(appId).filter(device => !device.revoked_at);
  }

  function publishConnectionState(status) {
    if (typeof window.dispatchEvent !== "function") return;
    const currentUser = cloud()?.user;
    const detail = {
      status,
      userId: String(currentUser?.id || ""),
      quickLogConnected: status === "ready" && activeDevices("quick_log").length > 0,
      firstWatchLogReceived: status === "ready" && Boolean(onboarding.firstWatchLogReceived),
      latestWatchLogAt: status === "ready" ? String(onboarding.latestWatchLogAt || "") : "",
      completed: status === "ready" && activeDevices("quick_log").length > 0 && Boolean(onboarding.firstWatchLogReceived)
    };
    const EventConstructor = window.CustomEvent || globalThis.CustomEvent;
    window.dispatchEvent(typeof EventConstructor === "function"
      ? new EventConstructor("fuelguard:garmin-devices", { detail })
      : { type: "fuelguard:garmin-devices", detail });
  }

  function connectedMarkup(appId, details, active) {
    const connectionRows = active.map((device, index) => `
      <div class="beta-garmin-connection-row">
        <div>
          ${active.length > 1 ? `<span class="beta-garmin-connection-label">Connection ${index + 1}</span>` : ""}
          <span>Last used: ${safe(formatLastUsed(device.last_used_at))}</span>
        </div>
        <button class="beta-garmin-disconnect-button" type="button" data-garmin-disconnect-app="${safe(appId)}" data-garmin-disconnect-index="${index}">Disconnect</button>
      </div>
    `).join("");
    return `
      <section class="beta-garmin-app-card is-connected" data-garmin-app="${safe(appId)}">
        <div class="beta-garmin-app-heading">
          <h3>${safe(details.label)}</h3>
          <span class="beta-garmin-state is-connected">Connected <span aria-hidden="true">✓</span></span>
        </div>
        <p class="beta-garmin-connected-copy">Your Garmin is connected.</p>
        <div class="beta-garmin-connections">${connectionRows}</div>
        <p class="beta-garmin-security-note">Disconnecting revokes this app’s access. You can reconnect it at any time.</p>
      </section>
    `;
  }

  function disconnectedMarkup(appId, details, previouslyConnected) {
    const action = previouslyConnected ? "Reconnect" : `Connect ${details.label}`;
    const description = previouslyConnected ? details.description : details.firstUseDescription;
    return `
      <section class="beta-garmin-app-card is-disconnected" data-garmin-app="${safe(appId)}">
        <div class="beta-garmin-app-heading">
          <h3>${safe(details.label)}</h3>
          ${previouslyConnected ? '<span class="beta-garmin-state is-disconnected">Disconnected</span>' : ""}
        </div>
        <p>${safe(description)}</p>
        ${previouslyConnected ? '<p class="beta-garmin-disconnected-note">The Garmin app may still be installed on your watch.</p>' : ""}
        <button class="beta-garmin-connect-button" type="button" data-garmin-guide="${safe(appId)}" data-garmin-guide-mode="${previouslyConnected ? "reconnect" : "connect"}">${safe(action)}</button>
      </section>
    `;
  }

  function renderRows(nextDevices = devices) {
    const { list } = els();
    if (!list) return;
    devices = Array.isArray(nextDevices) ? nextDevices : [];
    list.innerHTML = APP_ORDER.map(appId => {
      const details = APP_DETAILS[appId];
      const active = activeDevices(appId);
      if (active.length) return connectedMarkup(appId, details, active);
      return disconnectedMarkup(appId, details, appDevices(appId).length > 0);
    }).join("");
  }

  function stopReconnectPolling() {
    if (reconnectPollTimer !== null) window.clearTimeout(reconnectPollTimer);
    reconnectPollTimer = null;
    reconnectPollAttempts = 0;
    reconnectPollAppId = null;
  }

  function stopReconnectSuccessTimer() {
    if (reconnectSuccessTimer !== null) window.clearTimeout(reconnectSuccessTimer);
    reconnectSuccessTimer = null;
  }

  function closeDialog({ restoreFocus = true } = {}) {
    stopReconnectPolling();
    stopReconnectSuccessTimer();
    const { dialog } = els();
    if (dialog) {
      dialog.hidden = true;
      dialog.innerHTML = "";
    }
    dialogState = null;
    if (restoreFocus) dialogTrigger?.focus?.();
    dialogTrigger = null;
  }

  function showDialog(markup, state, trigger) {
    const { dialog } = els();
    if (!dialog) return;
    dialogState = state;
    dialogTrigger = trigger || null;
    dialog.innerHTML = markup;
    dialog.hidden = false;
    window.requestAnimationFrame?.(() => dialog.querySelector?.("[data-garmin-dialog-focus]")?.focus?.());
  }

  function openConnectionGuide(appId, mode, trigger) {
    const details = APP_DETAILS[appId];
    if (!details) return;
    const reconnecting = mode === "reconnect";
    const title = `${reconnecting ? "Reconnect" : "Connect"} ${details.label}`;
    showDialog(`
      <div class="beta-garmin-dialog-backdrop" data-garmin-dialog-backdrop>
        <section class="beta-garmin-dialog" role="dialog" aria-modal="true" aria-labelledby="garminConnectionGuideTitle">
          <button class="beta-garmin-dialog-close" type="button" data-garmin-dialog-close aria-label="Close connection guide">×</button>
          <span class="beta-garmin-dialog-eyebrow">Garmin &amp; Devices</span>
          <h3 id="garminConnectionGuideTitle" tabindex="-1" data-garmin-dialog-focus>${safe(title)}</h3>
          <p class="beta-garmin-waiting-state"><strong>Waiting for your Garmin…</strong></p>
          <ol class="beta-garmin-guide-steps">
            ${details.steps.map(step => `<li>${safe(step)}</li>`).join("")}
          </ol>
          <p class="beta-garmin-guide-support">Fuel Guard will update automatically when your Garmin ${reconnecting ? "reconnects" : "connects"}.</p>
          <div class="beta-garmin-dialog-actions">
            <button class="secondary" type="button" data-garmin-dialog-close>Done</button>
            <a class="beta-garmin-store-link" href="${safe(details.storeUrl)}" target="_blank" rel="noopener noreferrer">${safe(details.storeLabel)}</a>
          </div>
        </section>
      </div>
    `, { type: "guide", appId }, trigger);
    startReconnectPolling(appId);
  }

  function showReconnectSuccess(appId) {
    const details = APP_DETAILS[appId];
    if (!details || dialogState?.type !== "guide" || dialogState.appId !== appId) return false;
    const trigger = dialogTrigger;
    stopReconnectPolling();
    showDialog(`
      <div class="beta-garmin-dialog-backdrop">
        <section class="beta-garmin-dialog beta-garmin-success-dialog" role="dialog" aria-modal="true" aria-labelledby="garminConnectionSuccessTitle">
          <span class="beta-garmin-dialog-eyebrow">Garmin &amp; Devices</span>
          <div class="beta-garmin-success-mark" aria-hidden="true">✓</div>
          <h3 id="garminConnectionSuccessTitle" tabindex="-1" data-garmin-dialog-focus>${safe(details.label)} connected</h3>
          <p>Your Garmin can send Fuel Guard events again.</p>
        </section>
      </div>
    `, { type: "success", appId }, trigger);
    setStatus(`${details.label} connected. Your Garmin can send Fuel Guard events again.`);
    reconnectSuccessTimer = window.setTimeout(() => {
      if (dialogState?.type === "success" && dialogState.appId === appId) {
        closeDialog({ restoreFocus: false });
      }
    }, RECONNECT_SUCCESS_MS);
    return true;
  }

  function scheduleReconnectPoll() {
    if (reconnectPollTimer !== null
        || reconnectPollAttempts >= RECONNECT_POLL_ATTEMPTS
        || dialogState?.type !== "guide"
        || dialogState.appId !== reconnectPollAppId) return;
    reconnectPollTimer = window.setTimeout(async () => {
      reconnectPollTimer = null;
      if (dialogState?.type !== "guide" || dialogState.appId !== reconnectPollAppId) return;
      reconnectPollAttempts += 1;
      await loadDevices({ quiet: true });
      scheduleReconnectPoll();
    }, RECONNECT_POLL_INTERVAL_MS);
  }

  function startReconnectPolling(appId) {
    stopReconnectPolling();
    reconnectPollAppId = appId;
    scheduleReconnectPoll();
  }

  function openDisconnectConfirmation(appId, deviceIndex, trigger) {
    const details = APP_DETAILS[appId];
    const device = activeDevices(appId)[deviceIndex];
    if (!details || !device?.id) return;
    showDialog(`
      <div class="beta-garmin-dialog-backdrop" data-garmin-dialog-backdrop>
        <section class="beta-garmin-dialog beta-garmin-disconnect-dialog" role="dialog" aria-modal="true" aria-labelledby="garminDisconnectTitle">
          <h3 id="garminDisconnectTitle" tabindex="-1" data-garmin-dialog-focus>Disconnect ${safe(details.label)}?</h3>
          <p>${safe(details.label)} will stop being able to send Fuel Guard events to this account.</p>
          <p class="beta-garmin-guide-support">You can reconnect it at any time.</p>
          <div class="beta-garmin-dialog-actions">
            <button class="secondary" type="button" data-garmin-dialog-close>Cancel</button>
            <button class="danger-secondary" type="button" data-garmin-confirm-disconnect>Disconnect</button>
          </div>
        </section>
      </div>
    `, { type: "disconnect", appId, deviceId: device.id }, trigger);
  }

  function updateControls() {
    const { refresh, dialog } = els();
    if (refresh) refresh.disabled = loading || actionInFlight;
    dialog?.querySelectorAll?.("button").forEach(button => { button.disabled = actionInFlight; });
  }

  async function loadDevices({ quiet = false } = {}) {
    const { card, list } = els();
    if (!card || loading || actionInFlight) return false;
    const account = cloud()?.accountView?.() || {};
    card.hidden = !account.signedIn;
    if (!account.signedIn) {
      publishConnectionState("signed_out");
      return false;
    }
    if (!token()) {
      if (list) list.innerHTML = '<p class="row-note">Sign in again to manage Garmin connections.</p>';
      publishConnectionState("error");
      return false;
    }
    try {
      loading = true;
      updateControls();
      if (!quiet) setStatus("Checking Garmin connection status...");
      const response = await fetch("/api/garmin/devices", { headers: { Authorization: `Bearer ${token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load Garmin apps.");
      onboarding = {
        quickLogConnected: Boolean(data.onboarding?.quick_log_connected),
        firstWatchLogReceived: Boolean(data.onboarding?.first_watch_log_received),
        latestWatchLogAt: String(data.onboarding?.latest_watch_log_at || ""),
        completed: Boolean(data.onboarding?.completed)
      };
      renderRows(data.devices || []);
      publishConnectionState("ready");
      const reconnected = dialogState?.type === "guide"
        && activeDevices(dialogState.appId).length > 0
        && showReconnectSuccess(dialogState.appId);
      if (!quiet && !reconnected) setStatus("Garmin connection status is up to date.");
      return true;
    } catch (error) {
      setStatus(error?.message || "Could not load Garmin apps.");
      publishConnectionState("error");
      return false;
    } finally {
      loading = false;
      updateControls();
    }
  }

  async function disconnect() {
    if (actionInFlight || dialogState?.type !== "disconnect" || !token()) return;
    const { appId, deviceId } = dialogState;
    const details = APP_DETAILS[appId];
    try {
      actionInFlight = true;
      updateControls();
      setStatus(`Disconnecting ${details.label}...`);
      const response = await fetch("/api/garmin/devices/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ device_id: deviceId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Could not disconnect ${details.label}.`);
      closeDialog({ restoreFocus: false });
      devices = devices.map(device => device.id === deviceId
        ? { ...device, revoked_at: new Date().toISOString() }
        : device);
      renderRows(devices);
      actionInFlight = false;
      await loadDevices({ quiet: true });
      const stillConnected = activeDevices(appId).length > 0;
      setStatus(stillConnected
        ? `${details.label} connection disconnected.`
        : `${details.label} disconnected. Want to connect it again? Select Reconnect.`);
    } catch (error) {
      setStatus(error?.message || `Could not disconnect ${details?.label || "Garmin app"}.`);
    } finally {
      actionInFlight = false;
      updateControls();
    }
  }

  function handleClick(event) {
    const guide = event.target.closest?.("[data-garmin-guide]");
    if (guide) {
      openConnectionGuide(guide.getAttribute("data-garmin-guide"), guide.getAttribute("data-garmin-guide-mode"), guide);
      return;
    }
    const disconnectButton = event.target.closest?.("[data-garmin-disconnect-app]");
    if (disconnectButton) {
      openDisconnectConfirmation(
        disconnectButton.getAttribute("data-garmin-disconnect-app"),
        Number(disconnectButton.getAttribute("data-garmin-disconnect-index")),
        disconnectButton
      );
      return;
    }
    if (event.target.closest?.("[data-garmin-confirm-disconnect]")) return disconnect();
    const close = event.target.closest?.("[data-garmin-dialog-close]");
    if (close || event.target.hasAttribute?.("data-garmin-dialog-backdrop")) closeDialog();
  }

  document.addEventListener("click", handleClick);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && dialogState) closeDialog();
  });
  document.addEventListener("DOMContentLoaded", () => {
    els().refresh?.addEventListener("click", loadDevices);
    loadDevices();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadDevices();
  });
  window.addEventListener("pageshow", loadDevices);
  window.addEventListener("focus", loadDevices);
  window.addEventListener("fuelguard:cloud-status", loadDevices);
  window.addEventListener("fuelguard:auth-state", loadDevices);
  window.fuelGuardGarminDevices = Object.freeze({ refresh: loadDevices });
})();
