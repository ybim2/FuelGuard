const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "garmin-connected-devices.js"), "utf8");

function response(body, ok = true) {
  return { ok, async json() { return body; } };
}

function target(attributes = {}) {
  return {
    attributes,
    closest(selector) {
      const match = selector.match(/^\[([^\]]+)\]$/);
      return match && Object.hasOwn(attributes, match[1]) ? this : null;
    },
    getAttribute(name) { return attributes[name] ?? null; },
    hasAttribute(name) { return Object.hasOwn(attributes, name); },
    focus() { this.focused = true; }
  };
}

function harness(responses = []) {
  const elements = new Map();
  for (const id of ["garminDevicesCard", "garminDevicesList", "garminDevicesStatus", "garminDevicesRefresh", "garminDevicesDialog"]) {
    elements.set(id, {
      id,
      hidden: id === "garminDevicesCard" || id === "garminDevicesDialog",
      disabled: false,
      innerHTML: "",
      textContent: "",
      listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      querySelector() { return null; },
      querySelectorAll() { return []; }
    });
  }
  const documentEvents = {};
  const windowEvents = {};
  const calls = [];
  const timers = new Map();
  let nextTimerId = 1;
  const document = {
    hidden: false,
    getElementById(id) { return elements.get(id) || null; },
    addEventListener(type, callback) { documentEvents[type] = callback; }
  };
  const window = {
    fuelGuardCloud: {
      accountView() { return { signedIn: true }; },
      accessToken() { return "athlete-session"; }
    },
    addEventListener(type, callback) { windowEvents[type] = callback; },
    requestAnimationFrame(callback) { callback(); },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  };
  async function fetch(url, options = {}) {
    calls.push({ url, options });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch: ${url}`);
    return next;
  }
  vm.runInNewContext(source, {
    window,
    document,
    fetch,
    console,
    Date,
    Intl,
    Object,
    Number,
    String,
    Array
  }, { filename: "garmin-connected-devices.js" });
  async function runNextTimer() {
    const next = timers.entries().next();
    if (next.done) return null;
    const [id, timer] = next.value;
    timers.delete(id);
    await timer.callback();
    return timer.delay;
  }
  return { window, document, elements, documentEvents, windowEvents, calls, timers, runNextTimer };
}

test("first-use Garmin Settings shows useful Connect actions for both public apps", async () => {
  const view = harness([response({ devices: [] })]);
  await view.window.fuelGuardGarminDevices.refresh();
  const html = view.elements.get("garminDevicesList").innerHTML;
  assert.match(html, /Quick Log/);
  assert.match(html, /Fuel, Hydration and Sleepy logging from your watch/);
  assert.match(html, /Connect Quick Log/);
  assert.match(html, /Activity Logger/);
  assert.match(html, /Connect Activity Logger/);
  assert.doesNotMatch(html, /No Garmin apps are connected yet/);

  const quickConnect = target({ "data-garmin-guide": "quick_log", "data-garmin-guide-mode": "connect" });
  view.documentEvents.click({ target: quickConnect });
  const guide = view.elements.get("garminDevicesDialog");
  assert.equal(guide.hidden, false);
  assert.match(guide.innerHTML, /Connect Quick Log/);
  assert.match(guide.innerHTML, /Waiting for your Garmin/);
  assert.match(guide.innerHTML, /Select Connect Fuel Guard/);
  assert.match(guide.innerHTML, /Connect IQ Store app/);
  assert.match(guide.innerHTML, /update automatically when your Garmin connects/);
  assert.match(guide.innerHTML, /daa45a0d-e858-4b08-84b1-e9bb9a8196f3/);
  assert.doesNotMatch(guide.innerHTML, /Garmin Connect mobile app/);
});

test("previously used Garmin apps remain visible as disconnected with Reconnect actions", async () => {
  const view = harness([response({ devices: [
    { id: "private-quick-id", app_id: "quick_log", token_prefix: "secret-a", revoked_at: "2026-08-11T12:00:00Z" },
    { id: "private-activity-id", app_id: "activity_logger", token_prefix: "secret-b", revoked_at: "2026-08-11T13:00:00Z" }
  ] })]);
  await view.window.fuelGuardGarminDevices.refresh();
  const html = view.elements.get("garminDevicesList").innerHTML;
  assert.equal((html.match(/Disconnected/g) || []).length, 2);
  assert.equal((html.match(/>Reconnect</g) || []).length, 2);
  assert.match(html, /record Fuel, Hydration and Sleepy moments/);
  assert.match(html, /supported Garmin activities/);
  assert.doesNotMatch(html, /private-quick-id|private-activity-id|secret-a|secret-b/);

  const activityReconnect = target({ "data-garmin-guide": "activity_logger", "data-garmin-guide-mode": "reconnect" });
  view.documentEvents.click({ target: activityReconnect });
  const guide = view.elements.get("garminDevicesDialog").innerHTML;
  assert.match(guide, /Reconnect Activity Logger/);
  assert.match(guide, /Open Fuel Guard Activity Logger settings on your Garmin/);
  assert.match(guide, /Select Connect Fuel Guard/);
  assert.match(guide, /2c53ef82-9139-4c73-ac75-2ed75abceb3b/);
});

test("connected state prioritises connection confidence and keeps Disconnect secondary", async () => {
  const view = harness([response({ devices: [{
    id: "private-device-id",
    app_id: "quick_log",
    token_prefix: "secret-prefix",
    created_at: "2026-08-11T10:00:00Z",
    last_used_at: "2026-08-11T18:42:00Z",
    revoked_at: null
  }] })]);
  await view.window.fuelGuardGarminDevices.refresh();
  const html = view.elements.get("garminDevicesList").innerHTML;
  assert.match(html, /Connected <span aria-hidden="true">✓<\/span>/);
  assert.match(html, /Your Garmin is connected/);
  assert.match(html, /Last used:/);
  assert.match(html, />Disconnect<\/button>/);
  assert.doesNotMatch(html, />Revoke<\/button>|data-garmin-revoke/);
  assert.match(html, /Connect Activity Logger/);
  assert.doesNotMatch(html, /private-device-id|secret-prefix/);
});

test("Disconnect requires confirmation then renders the immediate Reconnect state", async () => {
  const active = {
    id: "device-to-revoke",
    app_id: "quick_log",
    created_at: "2026-08-11T10:00:00Z",
    last_used_at: "2026-08-11T18:42:00Z",
    revoked_at: null
  };
  const view = harness([
    response({ devices: [active] }),
    response({ result: "revoked" }),
    response({ devices: [{ ...active, revoked_at: "2026-08-11T20:00:00Z" }] })
  ]);
  await view.window.fuelGuardGarminDevices.refresh();

  const disconnectButton = target({ "data-garmin-disconnect-app": "quick_log", "data-garmin-disconnect-index": "0" });
  view.documentEvents.click({ target: disconnectButton });
  const dialog = view.elements.get("garminDevicesDialog");
  assert.match(dialog.innerHTML, /Disconnect Quick Log\?/);
  assert.match(dialog.innerHTML, /stop being able to send Fuel Guard events/);
  assert.match(dialog.innerHTML, /You can reconnect it at any time/);
  assert.match(dialog.innerHTML, />Cancel<\/button>/);
  assert.match(dialog.innerHTML, />Disconnect<\/button>/);

  await view.documentEvents.click({ target: target({ "data-garmin-confirm-disconnect": "" }) });
  assert.equal(view.calls[1].url, "/api/garmin/devices/revoke");
  assert.deepEqual(JSON.parse(view.calls[1].options.body), { device_id: "device-to-revoke" });
  const html = view.elements.get("garminDevicesList").innerHTML;
  assert.match(html, /Disconnected/);
  assert.match(html, />Reconnect<\/button>/);
  assert.match(view.elements.get("garminDevicesStatus").textContent, /Quick Log disconnected.*Select Reconnect/);
});

test("returning to the app refreshes a completed Garmin connection automatically", async () => {
  const view = harness([
    response({ devices: [{ id: "old", app_id: "quick_log", revoked_at: "2026-08-11T12:00:00Z" }] }),
    response({ devices: [{ id: "new", app_id: "quick_log", last_used_at: null, revoked_at: null }] })
  ]);
  await view.window.fuelGuardGarminDevices.refresh();
  assert.match(view.elements.get("garminDevicesList").innerHTML, /Disconnected/);
  await view.windowEvents.focus();
  const html = view.elements.get("garminDevicesList").innerHTML;
  assert.match(html, /Connected <span aria-hidden="true">✓<\/span>/);
  assert.match(html, /Last used: Not yet used/);
});

test("Reconnect polls only while the guide is active, confirms success and closes automatically", async () => {
  const revoked = { id: "old", app_id: "quick_log", revoked_at: "2026-08-11T12:00:00Z" };
  const view = harness([
    response({ devices: [revoked] }),
    response({ devices: [revoked] }),
    response({ devices: [revoked, { id: "new", app_id: "quick_log", last_used_at: null, revoked_at: null }] })
  ]);
  await view.window.fuelGuardGarminDevices.refresh();
  view.documentEvents.click({ target: target({ "data-garmin-guide": "quick_log", "data-garmin-guide-mode": "reconnect" }) });
  assert.equal(view.timers.size, 1);
  assert.equal(await view.runNextTimer(), 3000);
  assert.equal(view.timers.size, 1);
  assert.equal(await view.runNextTimer(), 3000);

  const dialog = view.elements.get("garminDevicesDialog");
  assert.match(dialog.innerHTML, /Quick Log connected/);
  assert.match(dialog.innerHTML, /Your Garmin can send Fuel Guard events again/);
  assert.match(view.elements.get("garminDevicesList").innerHTML, /Connected <span aria-hidden="true">✓<\/span>/);
  assert.match(view.elements.get("garminDevicesStatus").textContent, /Quick Log connected/);
  assert.equal(view.timers.size, 1);
  assert.equal(await view.runNextTimer(), 1800);
  assert.equal(dialog.hidden, true);
  assert.equal(view.timers.size, 0);
});

test("closing a reconnect guide cancels its bounded background refresh", async () => {
  const view = harness([response({ devices: [{ id: "old", app_id: "activity_logger", revoked_at: "2026-08-11T12:00:00Z" }] })]);
  await view.window.fuelGuardGarminDevices.refresh();
  view.documentEvents.click({ target: target({ "data-garmin-guide": "activity_logger", "data-garmin-guide-mode": "reconnect" }) });
  assert.equal(view.timers.size, 1);
  view.documentEvents.click({ target: target({ "data-garmin-dialog-close": "" }) });
  assert.equal(view.elements.get("garminDevicesDialog").hidden, true);
  assert.equal(view.timers.size, 0);
});
