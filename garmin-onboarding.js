(function attachGarminQuickLogOnboarding(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardGarminOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGarminQuickLogOnboarding(root) {
  "use strict";

  const QUICK_LOG_STORE_URL = "https://apps.garmin.com/en-US/apps/daa45a0d-e858-4b08-84b1-e9bb9a8196f3";
  const POLL_INTERVAL_MS = 4000;
  const ALLOWED_STATES = new Set([
    "not_started",
    "connection_pending",
    "watch_app_install_pending",
    "watch_app_open_pending",
    "first_watch_log_pending",
    "completed",
    "not_a_garmin_user"
  ]);
  let auth = { signedIn: false, userId: "", metadataState: "not_started" };
  let garmin = {
    status: "unknown",
    userId: "",
    quickLogConnected: false,
    firstWatchLogReceived: false,
    latestWatchLogAt: ""
  };
  let wizardOpen = false;
  let saving = false;
  let pollTimer = null;

  function element(id) {
    return root?.document?.getElementById?.(id) || null;
  }

  function cloud() {
    return root?.fuelGuardCloud || null;
  }

  function safe(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function metadataState(user = cloud()?.user) {
    const value = String(user?.user_metadata?.fuel_guard_garmin_onboarding?.state || "not_started");
    return ALLOWED_STATES.has(value) ? value : "not_started";
  }

  function resolvedState() {
    if (!auth.signedIn || !auth.userId) return "not_started";
    if (auth.metadataState === "not_a_garmin_user") return "not_a_garmin_user";
    if (garmin.status !== "ready" || garmin.userId !== auth.userId) return auth.metadataState;
    if (garmin.quickLogConnected && garmin.firstWatchLogReceived) return "completed";
    if (!garmin.quickLogConnected && auth.metadataState === "completed") return "connection_pending";
    if (garmin.quickLogConnected && new Set(["not_started", "connection_pending"]).has(auth.metadataState)) {
      return "watch_app_install_pending";
    }
    return auth.metadataState;
  }

  function isIncomplete(state = resolvedState()) {
    return auth.signedIn && !new Set(["not_started", "completed", "not_a_garmin_user"]).has(state);
  }

  function progress(state = resolvedState()) {
    const connected = Boolean(garmin.quickLogConnected);
    const installConfirmed = connected && new Set([
      "watch_app_open_pending",
      "first_watch_log_pending",
      "completed"
    ]).has(state);
    return [
      { label: "Garmin connected", done: connected },
      { label: "Quick Log installed", done: installConfirmed || state === "completed" },
      { label: "First watch log received", done: Boolean(garmin.firstWatchLogReceived) }
    ];
  }

  function progressMarkup(state = resolvedState(), compact = false) {
    return `<ul class="garmin-setup-checklist${compact ? " is-compact" : ""}">${progress(state).map(item => `
      <li class="${item.done ? "is-complete" : "is-pending"}">
        <span aria-hidden="true">${item.done ? "✓" : "○"}</span>
        <span>${safe(item.label)}</span>
      </li>
    `).join("")}</ul>`;
  }

  function setStatus(message = "") {
    const target = element("garminOnboardingStatus");
    if (target) target.textContent = message;
  }

  function stopPolling() {
    if (pollTimer !== null) root.clearTimeout?.(pollTimer);
    pollTimer = null;
  }

  function schedulePoll() {
    stopPolling();
    if (!wizardOpen || !isIncomplete() || root?.document?.hidden) return;
    pollTimer = root.setTimeout?.(async () => {
      pollTimer = null;
      await cloudRefresh();
      schedulePoll();
    }, POLL_INTERVAL_MS) ?? null;
  }

  async function cloudRefresh() {
    try { return await root?.fuelGuardGarminDevices?.refresh?.({ quiet: true }); }
    catch (_error) { return false; }
  }

  async function persistState(state) {
    if (!ALLOWED_STATES.has(state) || saving || !auth.signedIn) return false;
    if (auth.metadataState === state) return true;
    const requestedUserId = auth.userId;
    try {
      saving = true;
      const cloudApi = cloud();
      const save = cloudApi?.saveGarminOnboardingState;
      if (typeof save !== "function") throw new Error("Garmin setup sync is unavailable. Try again after refreshing Fuel Guard.");
      const user = await save.call(cloudApi, state);
      if (requestedUserId !== auth.userId) return false;
      auth.metadataState = state;
      render();
      return true;
    } catch (error) {
      setStatus(error?.message || "Garmin setup progress could not be saved. Try again.");
      return false;
    } finally {
      saving = false;
    }
  }

  function renderPrompt() {
    const target = element("garminSetupPrompt");
    if (!target) return;
    const state = resolvedState();
    const visible = auth.signedIn && garmin.status === "ready" && !new Set(["completed", "not_a_garmin_user"]).has(state);
    target.hidden = !visible;
    if (!visible) return;
    const title = element("garminSetupPromptTitle");
    const copy = element("garminSetupPromptCopy");
    const progressTarget = element("garminSetupPromptProgress");
    const actions = element("garminSetupPromptActions");
    if (state === "not_started") {
      if (title) title.textContent = "Have a Garmin?";
      if (copy) copy.textContent = "Do this next — it takes ~2 minutes. Connect your watch for easier fuelling and hydration logging.";
      if (progressTarget) progressTarget.innerHTML = "";
      if (actions) actions.innerHTML = `
        <button class="primary" type="button" data-garmin-onboarding-action="start">Set up Garmin</button>
        <button class="secondary" type="button" data-garmin-onboarding-action="opt-out">I don’t use Garmin</button>
      `;
      return;
    }
    if (title) title.textContent = "Finish Garmin setup";
    if (copy) copy.textContent = "You’re almost there. Finish setup to log directly from your watch.";
    if (progressTarget) progressTarget.innerHTML = progressMarkup(state, true);
    if (actions) actions.innerHTML = '<button class="primary" type="button" data-garmin-onboarding-action="continue">Continue setup</button>';
  }

  function renderSettings() {
    const target = element("garminOnboardingSettingsStatus");
    if (!target || !auth.signedIn) return;
    const state = resolvedState();
    if (state === "completed") {
      target.innerHTML = `
        <span class="garmin-settings-state is-complete">Garmin setup complete <span aria-hidden="true">✓</span></span>
        ${progressMarkup(state, true)}
      `;
      return;
    }
    if (state === "not_a_garmin_user") {
      target.innerHTML = `
        <span class="garmin-settings-state">Garmin setup is optional</span>
        <p>You previously chose not to set up Garmin. You can start whenever you’re ready.</p>
        <button class="secondary" type="button" data-garmin-onboarding-action="restart">Set up Garmin</button>
      `;
      return;
    }
    const untouched = state === "not_started";
    target.innerHTML = `
      <span class="garmin-settings-state${untouched ? "" : " is-incomplete"}">${untouched ? "Garmin not set up" : "Watch setup incomplete"}</span>
      ${untouched ? "<p>Connect Quick Log and confirm your first watch event in a short guided setup.</p>" : progressMarkup(state, true)}
      <button class="${untouched ? "secondary" : "primary"}" type="button" data-garmin-onboarding-action="${untouched ? "start" : "continue"}">${untouched ? "Start Garmin setup" : "Finish Garmin setup"}</button>
    `;
  }

  function wizardMarkup(state) {
    if (state === "completed") return `
      <div class="garmin-onboarding-success-mark" aria-hidden="true">✓</div>
      <h2 id="garminOnboardingTitle">Garmin setup complete</h2>
      <p>You’re connected. Future logs from your Garmin will appear automatically in Fuel Guard.</p>
      ${progressMarkup(state)}
      <div class="garmin-onboarding-actions">
        <button class="primary" type="button" data-garmin-onboarding-action="finish">Start using Fuel Guard</button>
      </div>
    `;
    if (state === "watch_app_install_pending") return `
      <span class="garmin-onboarding-step">Step 2 of 4</span>
      <h2 id="garminOnboardingTitle">Install Fuel Guard Quick Log</h2>
      <p>Your Garmin connection is approved. Make sure Fuel Guard Quick Log is installed on your watch.</p>
      <p class="garmin-onboarding-support">Quick Log records Fuel, Hydration and Sleepy moments directly from your wrist.</p>
      <div class="garmin-onboarding-actions">
        <a class="primary" href="${QUICK_LOG_STORE_URL}" target="_blank" rel="noopener noreferrer">Open Garmin Connect IQ</a>
        <button class="secondary" type="button" data-garmin-onboarding-action="installed">Quick Log is installed</button>
      </div>
    `;
    if (state === "watch_app_open_pending") return `
      <span class="garmin-onboarding-step">Step 3 of 4</span>
      <h2 id="garminOnboardingTitle">Open Quick Log on your Garmin</h2>
      <p>Open <strong>Fuel Guard Quick Log</strong> on your watch. You should see its Fuel, Hydration and Sleepy actions.</p>
      <div class="garmin-onboarding-actions">
        <button class="primary" type="button" data-garmin-onboarding-action="watch-opened">I can see Quick Log</button>
      </div>
    `;
    if (state === "first_watch_log_pending") return `
      <span class="garmin-onboarding-step">Step 4 of 4</span>
      <h2 id="garminOnboardingTitle">Send a test Fuel log</h2>
      <p>Log one Fuel event from Quick Log so Fuel Guard can confirm the whole connection works.</p>
      <div class="garmin-onboarding-waiting"><span aria-hidden="true"></span><strong>Waiting for your first Garmin log…</strong></div>
      ${progressMarkup(state)}
      <div class="garmin-onboarding-actions">
        <button class="secondary" type="button" data-garmin-onboarding-action="check">Check again</button>
      </div>
    `;
    return `
      <span class="garmin-onboarding-step">Step 1 of 4</span>
      <h2 id="garminOnboardingTitle">Connect Garmin</h2>
      <p>Open Fuel Guard Quick Log on your watch, select <strong>Connect Fuel Guard</strong>, then approve the request in the Connect IQ Store app on your phone.</p>
      <p class="garmin-onboarding-support">Don’t have Quick Log yet? Install it first from Connect IQ, then return here.</p>
      <div class="garmin-onboarding-actions">
        <button class="primary" type="button" data-garmin-onboarding-action="check">Connect Garmin</button>
        <a class="secondary" href="${QUICK_LOG_STORE_URL}" target="_blank" rel="noopener noreferrer">Get Quick Log</a>
      </div>
      <div class="garmin-onboarding-waiting"><span aria-hidden="true"></span><strong>Waiting for your Garmin…</strong></div>
    `;
  }

  function renderWizard() {
    const target = element("garminQuickLogOnboarding");
    const content = element("garminOnboardingWizardContent");
    if (!target || !content) return;
    const visible = wizardOpen && auth.signedIn;
    target.hidden = !visible;
    target.setAttribute("aria-hidden", visible ? "false" : "true");
    if (visible) target.removeAttribute("inert");
    else target.setAttribute("inert", "");
    if (!visible) return stopPolling();
    content.innerHTML = wizardMarkup(resolvedState());
    schedulePoll();
  }

  function render() {
    renderPrompt();
    renderSettings();
    renderWizard();
    return resolvedState();
  }

  async function reconcileAuthoritativeState() {
    if (garmin.status !== "ready" || garmin.userId !== auth.userId || auth.metadataState === "not_a_garmin_user") return false;
    const authoritative = garmin.quickLogConnected && garmin.firstWatchLogReceived
      ? "completed"
      : garmin.quickLogConnected && new Set(["not_started", "connection_pending", "completed"]).has(auth.metadataState)
        ? "watch_app_install_pending"
        : null;
    return authoritative && authoritative !== auth.metadataState ? persistState(authoritative) : false;
  }

  function updateAuth(detail = {}) {
    const nextUser = cloud()?.user || detail.user || null;
    const nextUserId = String(nextUser?.id || detail.userId || "");
    const changedUser = auth.userId && auth.userId !== nextUserId;
    auth = {
      signedIn: Boolean(detail.signedIn ?? nextUserId),
      userId: nextUserId,
      metadataState: metadataState(nextUser)
    };
    if (!auth.signedIn || changedUser) {
      wizardOpen = false;
      garmin = { status: "unknown", userId: "", quickLogConnected: false, firstWatchLogReceived: false, latestWatchLogAt: "" };
    }
    render();
  }

  function updateGarmin(detail = {}) {
    garmin = {
      status: String(detail.status || "unknown"),
      userId: String(detail.userId || ""),
      quickLogConnected: Boolean(detail.quickLogConnected),
      firstWatchLogReceived: Boolean(detail.firstWatchLogReceived),
      latestWatchLogAt: String(detail.latestWatchLogAt || "")
    };
    render();
    void reconcileAuthoritativeState();
  }

  async function handleAction(action) {
    if (saving) return;
    if (action === "start" || action === "restart") {
      await persistState("connection_pending");
      wizardOpen = true;
      setStatus("");
      render();
      return;
    }
    if (action === "opt-out") {
      wizardOpen = false;
      await persistState("not_a_garmin_user");
      render();
      return;
    }
    if (action === "continue") {
      wizardOpen = true;
      setStatus("");
      render();
      return;
    }
    if (action === "installed") return persistState("watch_app_open_pending");
    if (action === "watch-opened") return persistState("first_watch_log_pending");
    if (action === "check") {
      setStatus("Checking your Garmin connection…");
      await cloudRefresh();
      setStatus(resolvedState() === "completed" ? "Garmin log received." : "Still waiting — keep this screen open after using Quick Log on your watch.");
      return;
    }
    if (action === "finish") {
      wizardOpen = false;
      setStatus("");
      render();
    }
  }

  function closeWizard() {
    wizardOpen = false;
    setStatus("");
    render();
  }

  function init() {
    root.addEventListener?.("fuelguard:auth-state", event => updateAuth(event.detail));
    root.addEventListener?.("fuelguard:profile-name-ready", () => updateAuth({ signedIn: true, user: cloud()?.user }));
    root.addEventListener?.("fuelguard:garmin-devices", event => updateGarmin(event.detail));
    root.document?.addEventListener?.("click", event => {
      const action = event.target?.closest?.("[data-garmin-onboarding-action]")?.getAttribute?.("data-garmin-onboarding-action");
      if (action) void handleAction(action);
    });
    element("garminOnboardingClose")?.addEventListener("click", closeWizard);
    root.document?.addEventListener?.("keydown", event => {
      if (event.key === "Escape" && wizardOpen) closeWizard();
    });
    root.document?.addEventListener?.("visibilitychange", () => {
      if (root.document.hidden) stopPolling();
      else {
        void cloudRefresh();
        schedulePoll();
      }
    });
    updateAuth({ signedIn: Boolean(cloud()?.user), user: cloud()?.user || null });
  }

  if (root?.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
  else root?.requestAnimationFrame?.(init);

  return Object.freeze({
    init,
    render,
    closeWizard,
    _test: Object.freeze({
      metadataState,
      resolvedState,
      progress,
      isIncomplete,
      updateAuth,
      updateGarmin,
      handleAction,
      persistState,
      QUICK_LOG_STORE_URL,
      POLL_INTERVAL_MS
    })
  });
});
