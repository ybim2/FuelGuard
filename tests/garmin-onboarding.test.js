const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "garmin-onboarding.js"), "utf8");

function createElement(id, hidden = false) {
  return {
    id,
    hidden,
    innerHTML: "",
    textContent: "",
    attributes: {},
    listeners: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, callback) { this.listeners[type] = callback; }
  };
}

function harness({ userId = "athlete-a", state = "not_started" } = {}) {
  const ids = [
    "garminSetupPrompt",
    "garminSetupPromptTitle",
    "garminSetupPromptCopy",
    "garminSetupPromptProgress",
    "garminSetupPromptActions",
    "garminOnboardingSettingsStatus",
    "garminQuickLogOnboarding",
    "garminOnboardingWizardContent",
    "garminOnboardingStatus",
    "garminOnboardingClose"
  ];
  const elements = new Map(ids.map(id => [id, createElement(id, new Set([
    "garminSetupPrompt",
    "garminQuickLogOnboarding"
  ]).has(id))]));
  const documentEvents = {};
  const windowEvents = {};
  const timers = new Map();
  const saved = [];
  let nextTimer = 1;
  const user = {
    id: userId,
    user_metadata: {
      fuel_guard_garmin_onboarding: { version: 1, state }
    }
  };
  const document = {
    readyState: "complete",
    hidden: false,
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, callback) { documentEvents[type] = callback; }
  };
  const window = {
    document,
    fuelGuardCloud: {
      user,
      async saveGarminOnboardingState(nextState) {
        saved.push({ userId: this.user.id, state: nextState });
        this.user.user_metadata.fuel_guard_garmin_onboarding = { version: 1, state: nextState };
        return this.user;
      }
    },
    fuelGuardGarminDevices: {
      refreshCalls: 0,
      async refresh() { this.refreshCalls += 1; return true; }
    },
    addEventListener(type, callback) { windowEvents[type] = callback; },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  vm.runInNewContext(source, {
    globalThis: window,
    window,
    document,
    console,
    Object,
    Set,
    String,
    Boolean,
    Promise
  }, { filename: "garmin-onboarding.js" });
  return {
    window,
    api: window.FuelGuardGarminOnboarding,
    elements,
    saved,
    timers,
    documentEvents,
    windowEvents,
    async settle() {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
  };
}

function connectedDetail(overrides = {}) {
  return {
    status: "ready",
    userId: "athlete-a",
    quickLogConnected: false,
    firstWatchLogReceived: false,
    latestWatchLogAt: "",
    ...overrides
  };
}

test("new athletes see the optional Garmin decision directly in Daily and Settings", () => {
  const view = harness();
  view.api._test.updateGarmin(connectedDetail());
  assert.equal(view.api._test.resolvedState(), "not_started");
  assert.equal(view.elements.get("garminSetupPrompt").hidden, false);
  assert.equal(view.elements.get("garminSetupPromptTitle").textContent, "Have a Garmin?");
  assert.match(view.elements.get("garminSetupPromptActions").innerHTML, /Set up Garmin/);
  assert.match(view.elements.get("garminSetupPromptActions").innerHTML, /I don’t use Garmin/);
  assert.match(view.elements.get("garminOnboardingSettingsStatus").innerHTML, /Start Garmin setup/);
});

test("the four-step setup persists progress and completes only after a server-confirmed watch log", async () => {
  const view = harness();
  view.api._test.updateGarmin(connectedDetail());

  await view.api._test.handleAction("start");
  assert.equal(view.saved.at(-1).state, "connection_pending");
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Step 1 of 4/);
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Connect IQ Store app/);
  assert.equal(view.api._test.resolvedState(), "connection_pending");

  view.api._test.updateGarmin(connectedDetail({ quickLogConnected: true }));
  await view.settle();
  assert.equal(view.saved.at(-1).state, "watch_app_install_pending");
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Step 2 of 4/);
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Open Garmin Connect IQ/);

  await view.api._test.handleAction("installed");
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Step 3 of 4/);
  await view.api._test.handleAction("watch-opened");
  assert.equal(view.api._test.resolvedState(), "first_watch_log_pending");
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Waiting for your first Garmin log/);
  assert.equal(view.elements.get("garminSetupPrompt").hidden, false);

  view.api._test.updateGarmin(connectedDetail({
    quickLogConnected: true,
    firstWatchLogReceived: true,
    latestWatchLogAt: "2026-08-16T06:30:00.000Z"
  }));
  await view.settle();
  assert.equal(view.saved.at(-1).state, "completed");
  assert.equal(view.api._test.resolvedState(), "completed");
  assert.equal(view.elements.get("garminSetupPrompt").hidden, true);
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Garmin setup complete/);
  assert.match(view.elements.get("garminOnboardingSettingsStatus").innerHTML, /Garmin setup complete/);
});

test("OAuth connection without a successful watch event remains incomplete", async () => {
  const view = harness({ state: "connection_pending" });
  view.api._test.updateGarmin(connectedDetail({ quickLogConnected: true }));
  await view.settle();
  assert.equal(view.api._test.resolvedState(), "watch_app_install_pending");
  assert.equal(view.elements.get("garminSetupPrompt").hidden, false);
  assert.doesNotMatch(view.elements.get("garminOnboardingSettingsStatus").innerHTML, /Garmin setup complete/);
});

test("returning athletes with Quick Log and a historical Garmin log are inferred complete", async () => {
  const view = harness();
  view.api._test.updateGarmin(connectedDetail({
    quickLogConnected: true,
    firstWatchLogReceived: true,
    latestWatchLogAt: "2026-07-01T10:00:00.000Z"
  }));
  await view.settle();
  assert.equal(view.api._test.resolvedState(), "completed");
  assert.equal(view.saved.at(-1).state, "completed");
  assert.equal(view.elements.get("garminSetupPrompt").hidden, true);
});

test("non-Garmin choice persists, suppresses Daily prompts and remains reversible in Settings", async () => {
  const view = harness();
  view.api._test.updateGarmin(connectedDetail());
  await view.api._test.handleAction("opt-out");
  assert.equal(view.saved.at(-1).state, "not_a_garmin_user");
  assert.equal(view.elements.get("garminSetupPrompt").hidden, true);
  assert.match(view.elements.get("garminOnboardingSettingsStatus").innerHTML, /Set up Garmin/);

  await view.api._test.handleAction("restart");
  assert.equal(view.saved.at(-1).state, "connection_pending");
  assert.match(view.elements.get("garminOnboardingWizardContent").innerHTML, /Step 1 of 4/);
});

test("account switching clears stale Garmin completion evidence", async () => {
  const view = harness();
  view.api._test.updateGarmin(connectedDetail({ quickLogConnected: true, firstWatchLogReceived: true }));
  await view.settle();
  assert.equal(view.api._test.resolvedState(), "completed");

  view.window.fuelGuardCloud.user = {
    id: "athlete-b",
    user_metadata: { fuel_guard_garmin_onboarding: { version: 1, state: "not_started" } }
  };
  view.api._test.updateAuth({ signedIn: true, userId: "athlete-b" });
  assert.equal(view.api._test.resolvedState(), "not_started");
  assert.equal(view.elements.get("garminSetupPrompt").hidden, true, "prompt waits for athlete-b device status");
  view.api._test.updateGarmin(connectedDetail({ userId: "athlete-b" }));
  assert.equal(view.elements.get("garminSetupPrompt").hidden, false);
  assert.doesNotMatch(view.elements.get("garminOnboardingSettingsStatus").innerHTML, /Garmin setup complete/);
});
