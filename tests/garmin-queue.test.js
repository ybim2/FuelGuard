const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readRepoBuffer(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath));
}

function readPngDimensions(relativePath) {
  const buffer = readRepoBuffer(relativePath);
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function assertSourceOrder(source, first, second) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${first} should be present`);
  assert.notEqual(secondIndex, -1, `${second} should be present`);
  assert.ok(firstIndex < secondIndex, `${first} should appear before ${second}`);
}

function sourceBlock(source, startText, endText) {
  const start = source.indexOf(startText);
  assert.notEqual(start, -1, `${startText} should be present`);
  const end = source.indexOf(endText, start + startText.length);
  assert.notEqual(end, -1, `${endText} should be present after ${startText}`);
  return source.slice(start, end);
}

class GarminQueueHarness {
  constructor() {
    this.queue = [];
    this.counter = 0;
    this.inFlight = false;
    this.sent = [];
    this.outcomes = [];
  }

  nextEvent(type = "fuel", timestamp = 1000) {
    this.counter += 1;
    return {
      external_event_id: `fg-fr255-${timestamp}-${this.counter}`,
      logged_at: new Date(timestamp * 1000).toISOString(),
      type,
      device_id: "fr255"
    };
  }

  record(type = "fuel", timestamp = 1000) {
    const event = this.nextEvent(type, timestamp);
    this.queue.push(event);
    this.syncNext();
    return event;
  }

  syncNext() {
    if (this.inFlight || !this.queue.length) return;
    const event = this.queue[0];
    this.inFlight = true;
    this.sent.push(event);
  }

  finish({ ok = false, duplicate = false } = {}) {
    const event = this.sent[this.sent.length - 1];
    this.inFlight = false;
    if (ok || duplicate) {
      this.queue = this.queue.filter(item => item.external_event_id !== event.external_event_id);
    }
    this.syncNext();
  }
}

function responseAcknowledged(responseCode, data) {
  if (responseCode === 200 || responseCode === 201) return true;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    let result = data[":result"];
    if (typeof result !== "string") result = data.result;
    return typeof result === "string" && ["ok", "duplicate", "already_recorded"].includes(result);
  }
  return false;
}

function isoUtcFromUnixSeconds(seconds) {
  const date = new Date(seconds * 1000);
  const parts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  };
  for (const [name, value] of Object.entries(parts)) {
    assert.equal(typeof value, "number", `${name} must be numeric before formatting`);
  }
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}Z`;
}

function externalEventId(event) {
  if (event && typeof event === "object" && typeof event.external_event_id === "string") {
    return event.external_event_id;
  }
  return null;
}

function sanitizeQueue(items) {
  if (!Array.isArray(items)) return [];
  return items.filter(item => externalEventId(item) !== null);
}

class QuickLogHarness {
  constructor() {
    this.actions = ["fuel", "hydration", "fuel_hydration"];
    this.selection = 0;
    this.confirming = false;
    this.queue = [];
  }

  move(delta) {
    if (this.confirming) return;
    this.selection = (this.selection + delta + this.actions.length) % this.actions.length;
  }

  selectedRows() {
    return this.actions.map((_action, index) => index === this.selection);
  }

  enter() {
    if (this.confirming) return null;
    const event = {
      external_event_id: `fg-fr255-${this.queue.length + 1}`,
      type: this.actions[this.selection]
    };
    this.queue.push(event);
    this.confirming = true;
    return event;
  }

  finishConfirmation() {
    this.confirming = false;
  }
}

test("Garmin queue stores the event before upload starts", () => {
  const harness = new GarminQueueHarness();
  const event = harness.record("fuel", 1000);
  assert.deepEqual(harness.queue[0], event);
  assert.deepEqual(harness.sent[0], event);
});

test("Garmin queue retains failed uploads and reuses the stable event ID", () => {
  const harness = new GarminQueueHarness();
  const event = harness.record("fuel", 1000);
  harness.finish({ ok: false });

  assert.deepEqual(harness.queue[0], event);
  assert.equal(harness.sent[0].external_event_id, event.external_event_id);
  assert.equal(harness.sent[1].external_event_id, event.external_event_id);
});

test("Garmin queue removes only the acknowledged event", () => {
  const harness = new GarminQueueHarness();
  const first = harness.record("fuel", 1000);
  const second = harness.record("hydration", 1001);

  assert.equal(harness.sent.length, 1);
  harness.finish({ ok: true });

  assert.deepEqual(harness.queue, [second]);
  assert.equal(harness.sent[0].external_event_id, first.external_event_id);
  assert.equal(harness.sent[1].external_event_id, second.external_event_id);
});

test("Garmin queue treats duplicate acknowledgement as success for only that event", () => {
  const harness = new GarminQueueHarness();
  const first = harness.record("fuel", 1000);
  const second = harness.record("fuel_hydration", 1001);

  harness.finish({ duplicate: true });

  assert.deepEqual(harness.queue, [second]);
  assert.notEqual(harness.queue[0].external_event_id, first.external_event_id);
});

test("Garmin response acknowledgement handles dictionary result values safely", () => {
  assert.equal(responseAcknowledged(500, { ":result": "ok" }), true);
  assert.equal(responseAcknowledged(500, { result: "duplicate" }), true);
  assert.equal(responseAcknowledged(500, { result: "already_recorded" }), true);
  assert.equal(responseAcknowledged(500, { result: null }), false);
  assert.equal(responseAcknowledged(500, { ":result": true, result: 12 }), false);
  assert.equal(responseAcknowledged(500, null), false);
  assert.equal(responseAcknowledged(500, "ok"), false);
  assert.equal(responseAcknowledged(200, null), true);
  assert.equal(responseAcknowledged(201, { result: 12 }), true);
});

test("Garmin ISO timestamp formatting is numeric, padded, UTC, and parseable", () => {
  const fixtures = [
    [1704164645, "2024-01-02T03:04:05Z"],
    [1723165323, "2024-08-09T01:02:03Z"],
    [1728555072, "2024-10-10T10:11:12Z"]
  ];

  for (const [seconds, expected] of fixtures) {
    const actual = isoUtcFromUnixSeconds(seconds);
    assert.equal(actual, expected);
    assert.equal(actual.endsWith("Z"), true);
    assert.equal(Date.parse(actual), seconds * 1000);
  }
});

test("Garmin queue sanitizes stale storage entries before indexing", () => {
  const valid = { external_event_id: "fg-fr255-1000-1", type: "fuel" };
  const staleQueue = [null, "bad", {}, { external_event_id: 12 }, valid];

  assert.deepEqual(sanitizeQueue(staleQueue), [valid]);
  assert.deepEqual(sanitizeQueue(null), []);
});

test("Quick Log menu has one selected row and wraps selection", () => {
  const harness = new QuickLogHarness();
  assert.deepEqual(harness.selectedRows(), [true, false, false]);

  harness.move(1);
  assert.deepEqual(harness.selectedRows(), [false, true, false]);
  harness.move(1);
  assert.deepEqual(harness.selectedRows(), [false, false, true]);
  harness.move(1);
  assert.deepEqual(harness.selectedRows(), [true, false, false]);
  harness.move(-1);
  assert.deepEqual(harness.selectedRows(), [false, false, true]);
});

test("Quick Log repeated ENTER during confirmation does not enqueue a duplicate", () => {
  const harness = new QuickLogHarness();

  const first = harness.enter();
  const second = harness.enter();

  assert.equal(first.type, "fuel");
  assert.equal(second, null);
  assert.equal(harness.queue.length, 1);
  harness.finishConfirmation();
  harness.enter();
  assert.equal(harness.queue.length, 2);
});

test("Garmin queue sends multiple pending events serially", () => {
  const harness = new GarminQueueHarness();
  harness.record("fuel", 1000);
  harness.record("hydration", 1001);
  harness.record("fuel_hydration", 1002);

  assert.equal(harness.sent.length, 1);
  assert.equal(harness.inFlight, true);
  harness.finish({ ok: true });
  assert.equal(harness.sent.length, 2);
  harness.finish({ ok: true });
  assert.equal(harness.sent.length, 3);
  harness.finish({ ok: true });
  assert.equal(harness.queue.length, 0);
});

test("Garmin manifests define two separate fr255 apps", () => {
  const activityManifest = readRepoFile("garmin/activity-logger/manifest.xml");
  const quickLogManifest = readRepoFile("garmin/quick-log/manifest.xml");

  assert.match(activityManifest, /type="datafield"/);
  assert.match(activityManifest, /<iq:product id="fr255"\/>/);
  assert.match(quickLogManifest, /type="watch-app"/);
  assert.match(quickLogManifest, /<iq:product id="fr255"\/>/);
  assert.match(activityManifest, /<iq:language>eng<\/iq:language>/);
  assert.match(quickLogManifest, /<iq:language>eng<\/iq:language>/);
  assert.notEqual(
    activityManifest.match(/id="([^"]+)"/)[1],
    quickLogManifest.match(/id="([^"]+)"/)[1]
  );
});

test("Garmin beta manifests use separate beta UUIDs and preserve production IDs", () => {
  const activityManifest = readRepoFile("garmin/activity-logger/manifest.xml");
  const quickLogManifest = readRepoFile("garmin/quick-log/manifest.xml");
  const activityBetaManifest = readRepoFile("garmin/activity-logger/manifest.beta.xml");
  const quickLogBetaManifest = readRepoFile("garmin/quick-log/manifest.beta.xml");
  const uuidLedger = readRepoFile("garmin/private-beta/UUIDS.md");

  const productionIds = [
    activityManifest.match(/id="([^"]+)"/)[1],
    quickLogManifest.match(/id="([^"]+)"/)[1]
  ];
  const betaIds = [
    activityBetaManifest.match(/id="([^"]+)"/)[1],
    quickLogBetaManifest.match(/id="([^"]+)"/)[1]
  ];

  assert.equal(new Set(productionIds).size, 2);
  assert.equal(new Set(betaIds).size, 2);
  for (const betaId of betaIds) {
    assert.match(betaId, /^[A-F0-9]{32}$/);
    assert.ok(!productionIds.includes(betaId), `${betaId} should not match a production ID`);
    assert.match(uuidLedger, new RegExp(betaId));
  }
  for (const productionId of productionIds) {
    assert.match(uuidLedger, new RegExp(productionId));
  }

  assert.match(activityBetaManifest, /type="datafield"/);
  assert.match(quickLogBetaManifest, /type="watch-app"/);
  assert.match(activityBetaManifest, /<iq:product id="fr255"\/>/);
  assert.match(quickLogBetaManifest, /<iq:product id="fr255"\/>/);
  assert.match(activityBetaManifest, /<iq:language>eng<\/iq:language>/);
  assert.match(quickLogBetaManifest, /<iq:language>eng<\/iq:language>/);
});

test("Garmin private beta packaging assets are dashboard-ready", () => {
  const buildScript = readRepoFile("scripts/build-garmin-beta.sh");
  const uploadChecklist = readRepoFile("garmin/private-beta/UPLOAD_CHECKLIST.md");
  const activityReadme = readRepoFile("garmin/private-beta/activity-logger/README.md");
  const quickLogReadme = readRepoFile("garmin/private-beta/quick-log/README.md");

  assert.match(buildScript, /set -euo pipefail/);
  assert.match(buildScript, /-e \\/);
  assert.match(buildScript, /monkey\.beta\.jungle/);
  assert.match(buildScript, /output="\$OUT_DIR\/\$output_name\.iq"/);
  assert.match(buildScript, /fuel-guard-activity-logger-beta/);
  assert.match(buildScript, /fuel-guard-quick-log-beta/);
  assert.match(buildScript, /GARMIN_DEVELOPER_KEY is required/);
  assert.match(buildScript, /developer_key|.*\\.der|.*\\.pem/);
  assert.doesNotMatch(buildScript, /GARMIN_BETA_TOKEN=["'][A-Za-z0-9+/_=-]{16,}/);
  assert.doesNotMatch(buildScript, /VERCEL_AUTOMATION_BYPASS_SECRET=["'][A-Za-z0-9+/_=-]{16,}/);

  for (const doc of [uploadChecklist, activityReadme, quickLogReadme]) {
    assert.match(doc, /Garmin Connect IQ Developer Dashboard/);
    assert.match(doc, /Beta App/);
    assert.match(doc, /Forerunner 255/);
    assert.doesNotMatch(doc, /USB/i);
    assert.doesNotMatch(doc, /sideload/i);
  }

  assert.match(activityReadme, /Auto Lap must be disabled/);
  assert.match(activityReadme, /Pressing LAP logs fuel and also creates a normal Garmin lap/);
  assert.match(activityReadme, /Structured workout laps/i);
  assert.match(quickLogReadme, /Fuel, Hydration, or Fuel \+ Hydration/);
  assert.match(quickLogReadme, /Use UP and DOWN/);
  assert.match(quickLogReadme, /Press ENTER/);
  assert.match(quickLogReadme, /queue offline/);

  assert.deepEqual(readPngDimensions("garmin/private-beta/activity-logger/store-icon-500.png"), {
    width: 500,
    height: 500
  });
  assert.deepEqual(readPngDimensions("garmin/private-beta/quick-log/store-icon-500.png"), {
    width: 500,
    height: 500
  });
});

test("Activity Logger uses onTimerLap and persists before upload", () => {
  const source = readRepoFile("garmin/activity-logger/source/FuelGuardActivityLoggerField.mc");

  assert.match(source, /function onTimerLap\(\)/);
  assert.doesNotMatch(source, /onTimerLap2/);
  assert.match(source, /import Toybox\.Activity;/);
  assert.match(source, /function compute\(info as Activity\.Info\) as Void/);
  assert.match(source, /function onUpdate\(dc as Graphics\.Dc\) as Void/);
  assertSourceOrder(source, "FuelGuardQueue.enqueue(event);", "FuelGuardApi.trySync(true);");
  assert.match(source, /FuelGuardEvents\.TYPE_FUEL/);
});

test("Quick Log supports all event types and persists before upload", () => {
  const source = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogView.mc");
  const logSelection = sourceBlock(source, "function logSelection()", "public function onUpdate");

  assert.match(source, /FuelGuardEvents\.TYPE_FUEL/);
  assert.match(source, /FuelGuardEvents\.TYPE_HYDRATION/);
  assert.match(source, /FuelGuardEvents\.TYPE_FUEL_HYDRATION/);
  assert.match(source, /function onUpdate\(dc as Graphics\.Dc\) as Void/);
  assertSourceOrder(logSelection, "FuelGuardQueue.enqueue(event);", "FuelGuardApi.trySync(true);");
});

test("Garmin sources avoid unsupported String.trim", () => {
  const apiSource = readRepoFile("garmin/shared/source/FuelGuardApi.mc");

  assert.doesNotMatch(apiSource, /\.trim\(/);
  assert.match(apiSource, /function trimString\(value as String\) as String/);
});

test("Garmin event timestamps use numeric-safe UTC components", () => {
  const source = readRepoFile("garmin/shared/source/FuelGuardEvents.mc");

  assert.match(source, /Gregorian\.utcInfo\(new Time\.Moment\(seconds\), Time\.FORMAT_SHORT\)/);
  assert.doesNotMatch(source, /FORMAT_MEDIUM/);
  assert.match(source, /var year = info\.year instanceof Number \? info\.year as Number : 1970;/);
  assert.match(source, /var month = info\.month instanceof Number \? info\.month as Number : 1;/);
  assert.match(source, /var day = info\.day instanceof Number \? info\.day as Number : 1;/);
  assert.match(source, /var hour = info\.hour instanceof Number \? info\.hour as Number : 0;/);
  assert.match(source, /var minute = info\.min instanceof Number \? info\.min as Number : 0;/);
  assert.match(source, /var second = info\.sec instanceof Number \? info\.sec as Number : 0;/);
  assertSourceOrder(source, "var year = info.year instanceof Number", "year.format(\"%04d\")");
  assertSourceOrder(source, "var month = info.month instanceof Number", "month.format(\"%02d\")");
});

test("Garmin launcher icons match the fr255 40x40 requirement", () => {
  assert.deepEqual(readPngDimensions("garmin/activity-logger/resources/icon.png"), {
    width: 40,
    height: 40
  });
  assert.deepEqual(readPngDimensions("garmin/quick-log/resources/icon.png"), {
    width: 40,
    height: 40
  });
});

test("Garmin API sends serially and removes only the acknowledged event", () => {
  const apiSource = readRepoFile("garmin/shared/source/FuelGuardApi.mc");
  const queueSource = readRepoFile("garmin/shared/source/FuelGuardQueue.mc");

  assert.match(apiSource, /var _inFlight = false;/);
  assert.match(apiSource, /if \(_inFlight \|\| !configured\(\)\)/);
  assert.match(apiSource, /FuelGuardQueue\.peek\(\)/);
  assert.match(apiSource, /FuelGuardQueue\.removeAcknowledged\(context as String\)/);
  assert.match(apiSource, /function sendWebRequest\(event as Dictionary, eventId as String\) as Void \{[\s\S]*Communications\.makeWebRequest/);
  assert.match(apiSource, /try \{\s*dispatchRequest\(event, eventId as String\);/s);
  assert.match(apiSource, /catch \(e\) \{\s*_inFlight = false;/s);
  assert.match(apiSource, /\(:release\)\s*function dispatchRequest/);
  assert.match(apiSource, /\(:debug\)\s*function dispatchRequest/);
  assert.match(apiSource, /\(:debug\)\s*function useTestTransport/);
  assert.match(apiSource, /if \(context instanceof String\)/);
  assert.doesNotMatch(apiSource, /\|\|\s*data\["result"\]/);
  assert.match(apiSource, /VERCEL_BYPASS_PROPERTY = "vercelBypassSecret"/);
  assert.match(apiSource, /headers\["x-vercel-protection-bypass"\] = bypassSecret/);
  assert.match(queueSource, /function externalEventId\(event as Object\) as String\?/);
  assert.match(queueSource, /function removeAcknowledged\(eventId as String\)/);
  assert.match(queueSource, /if \(items\.size\(\) == 0\)/);
  assert.doesNotMatch(queueSource, /items\.size\(\) > 0 \? items\[0\]/);
  assert.match(queueSource, /!\(itemId as String\)\.equals\(eventId\)/);
});

test("Quick Log glance and app startup avoid lifecycle network sync", () => {
  const appSource = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogApp.mc");
  const glanceSource = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogGlance.mc");
  const onStart = sourceBlock(appSource, "function onStart", "public function onStop");

  assert.doesNotMatch(onStart, /FuelGuardApi\.trySync/);
  assert.doesNotMatch(glanceSource, /FuelGuardApi\.trySync/);
  assert.doesNotMatch(glanceSource, /FuelGuardQueue\.pendingCount/);
  assert.doesNotMatch(glanceSource, /FuelGuardFeedback\.elapsedFuelText/);
});

test("Garmin settings keep secrets blank and expose private alpha configuration", () => {
  const activityProperties = readRepoFile("garmin/activity-logger/resources/properties.xml");
  const quickLogProperties = readRepoFile("garmin/quick-log/resources/properties.xml");
  const activityStrings = readRepoFile("garmin/activity-logger/resources/strings.xml");
  const quickLogStrings = readRepoFile("garmin/quick-log/resources/strings.xml");
  const previewEndpoint = "https://fuel-guard-git-feat-garmin-activ-66c653-theos-projects-9c89a4a9.vercel.app/api/garmin-log";

  for (const source of [activityProperties, quickLogProperties]) {
    assert.match(source, new RegExp(`<property id="apiEndpoint" type="string">${previewEndpoint}</property>`));
    assert.match(source, /<property id="betaToken" type="string"><\/property>/);
    assert.match(source, /<property id="vercelBypassSecret" type="string"><\/property>/);
    assert.match(source, /propertyKey="@Properties\.vercelBypassSecret"/);
  }

  assert.match(activityStrings, /<string id="VercelBypassTitle">Vercel bypass secret<\/string>/);
  assert.match(quickLogStrings, /<string id="VercelBypassTitle">Vercel bypass secret<\/string>/);
});

test("Garmin endpoint smoke-test script supports Keychain and Vercel bypass", () => {
  const source = readRepoFile("scripts/test-garmin-endpoint.sh");

  assert.match(source, /security find-generic-password/);
  assert.match(source, /GARMIN_BETA_TOKEN/);
  assert.match(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(source, /x-vercel-protection-bypass/);
  assert.doesNotMatch(source, /GARMIN_BETA_TOKEN=["'][A-Za-z0-9+/_=-]{16,}/);
  assert.doesNotMatch(source, /VERCEL_AUTOMATION_BYPASS_SECRET=["'][A-Za-z0-9+/_=-]{16,}/);
});

test("Local Garmin configuration helper never contains secret values", () => {
  const source = readRepoFile("scripts/configure-garmin-alpha-local.sh");

  assert.match(source, /pbcopy/);
  assert.match(source, /security find-generic-password/);
  assert.match(source, /GARMIN_BETA_TOKEN/);
  assert.match(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(source, /GARMIN_BETA_TOKEN=["'][A-Za-z0-9+/_=-]{16,}/);
  assert.doesNotMatch(source, /VERCEL_AUTOMATION_BYPASS_SECRET=["'][A-Za-z0-9+/_=-]{16,}/);
});

test("Garmin docs prominently warn that Auto Lap must be disabled", () => {
  const readme = readRepoFile("garmin/README.md");
  const activityReadme = readRepoFile("garmin/activity-logger/README.md");

  assert.match(readme, /Disable Auto Lap/i);
  assert.match(activityReadme, /Auto Lap must be disabled/i);
});
