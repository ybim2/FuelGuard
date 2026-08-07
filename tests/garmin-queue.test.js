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
    this.batchActive = false;
    this.batchStartCount = 0;
    this.batchSyncedCount = 0;
    this.finishedSyncedCount = 0;
    this.finishedRemainingCount = 0;
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

  enqueueOnly(type = "fuel", timestamp = 1000) {
    const event = this.nextEvent(type, timestamp);
    this.queue.push(event);
    return event;
  }

  syncNext() {
    if (this.inFlight || !this.queue.length) return;
    if (!this.batchActive) {
      this.batchActive = true;
      this.batchStartCount = this.queue.length;
      this.batchSyncedCount = 0;
      this.finishedSyncedCount = 0;
      this.finishedRemainingCount = 0;
    }
    const event = this.queue[0];
    this.inFlight = true;
    this.sent.push(event);
  }

  finish({ ok = false, duplicate = false } = {}) {
    const event = this.sent[this.sent.length - 1];
    this.inFlight = false;
    if (ok || duplicate) {
      this.queue = this.queue.filter(item => item.external_event_id !== event.external_event_id);
      this.batchSyncedCount += 1;
    }
    if ((ok || duplicate) && this.queue.length > 0) {
      this.syncNext();
    } else {
      this.finishedSyncedCount = this.batchSyncedCount;
      this.finishedRemainingCount = this.queue.length;
      this.batchActive = false;
    }
  }

  statusText() {
    if (this.batchActive) return `Syncing ${this.batchStartCount} logs...`;
    if (this.finishedRemainingCount > 0) return `${this.finishedRemainingCount} logs still pending`;
    if (this.finishedSyncedCount > 1) return `${this.finishedSyncedCount} logs synced`;
    if (this.finishedSyncedCount === 1) return "All synced";
    if (this.queue.length > 0) return `${this.queue.length} pending`;
    return null;
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
  harness.syncNext();

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

test("Garmin batch sync presentation keeps one stable visible count", () => {
  const harness = new GarminQueueHarness();
  harness.enqueueOnly("fuel", 1000);
  harness.enqueueOnly("hydration", 1001);
  harness.enqueueOnly("fuel_hydration", 1002);
  harness.enqueueOnly("fuel", 1003);
  harness.enqueueOnly("hydration", 1004);
  harness.syncNext();

  assert.equal(harness.statusText(), "Syncing 5 logs...");
  harness.finish({ ok: true });
  assert.equal(harness.queue.length, 4);
  assert.equal(harness.statusText(), "Syncing 5 logs...");
  assert.notEqual(harness.statusText(), "4 pending");
});

test("Garmin batch sync presentation shows final success summary", () => {
  const harness = new GarminQueueHarness();
  harness.enqueueOnly("fuel", 1000);
  harness.enqueueOnly("hydration", 1001);
  harness.enqueueOnly("fuel_hydration", 1002);
  harness.syncNext();

  harness.finish({ ok: true });
  harness.finish({ ok: true });
  harness.finish({ duplicate: true });

  assert.equal(harness.queue.length, 0);
  assert.equal(harness.statusText(), "3 logs synced");
});

test("Garmin batch sync presentation shows partial failure summary and keeps events", () => {
  const harness = new GarminQueueHarness();
  harness.enqueueOnly("fuel", 1000);
  harness.enqueueOnly("hydration", 1001);
  harness.enqueueOnly("fuel_hydration", 1002);
  harness.syncNext();

  harness.finish({ ok: true });
  harness.finish({ ok: false });

  assert.equal(harness.queue.length, 2);
  assert.equal(harness.statusText(), "2 logs still pending");
});

test("Garmin batch sync presentation handles longest expected pending values", () => {
  const harness = new GarminQueueHarness();
  for (let i = 0; i < 99; i += 1) {
    harness.enqueueOnly("fuel", 2000 + i);
  }
  harness.syncNext();

  assert.equal(harness.statusText(), "Syncing 99 logs...");
  harness.finish({ ok: false });
  assert.equal(harness.queue.length, 99);
  assert.equal(harness.statusText(), "99 logs still pending");
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
  const connectionSource = readRepoFile("garmin/shared/source/FuelGuardConnection.mc");

  assert.doesNotMatch(apiSource + connectionSource, /\.trim\(/);
  assert.match(connectionSource, /function trimString\(value as String\) as String/);
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
  assert.match(apiSource, /catch \(e\) \{\s*_inFlight = false;\s*finishBatch\(\);/s);
  assert.match(apiSource, /\(:release\)\s*function dispatchRequest/);
  assert.match(apiSource, /\(:debug\)\s*function dispatchRequest/);
  assert.match(apiSource, /\(:debug\)\s*function useTestTransport/);
  assert.match(apiSource, /if \(context instanceof String\)/);
  assert.doesNotMatch(apiSource, /\|\|\s*data\["result"\]/);
  assert.match(apiSource, /FuelGuardConnection\.connected\(\)/);
  assert.match(apiSource, /FuelGuardConnection\.logEndpoint\(\)/);
  assert.match(apiSource, /"Authorization" => "Bearer " \+ deviceToken/);
  assert.match(apiSource, /beginBatch\(FuelGuardQueue\.pendingCount\(\)\)/);
  assert.match(apiSource, /Syncing \$1\$ \$2\$\.\.\./);
  assert.match(apiSource, /trySync\(true\);/);
  assert.doesNotMatch(apiSource, /VERCEL_BYPASS_PROPERTY/);
  assert.doesNotMatch(apiSource, /x-vercel-protection-bypass/);
  assert.match(queueSource, /function externalEventId\(event as Object\) as String\?/);
  assert.match(queueSource, /function removeAcknowledged\(eventId as String\)/);
  assert.match(queueSource, /if \(items\.size\(\) == 0\)/);
  assert.doesNotMatch(queueSource, /items\.size\(\) > 0 \? items\[0\]/);
  assert.match(queueSource, /!\(itemId as String\)\.equals\(eventId\)/);
});

test("Quick Log glance shows local fuel status without lifecycle network sync", () => {
  const appSource = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogApp.mc");
  const glanceSource = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogGlance.mc");
  const glanceStateSource = readRepoFile("garmin/quick-log/source/FuelGuardGlanceState.mc");
  const onStart = sourceBlock(appSource, "function onStart", "public function onStop");
  const onShowSource = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogView.mc");

  assert.doesNotMatch(onStart, /FuelGuardConnection\.configure/);
  assert.doesNotMatch(onStart, /registerForOAuthMessages/);
  assert.doesNotMatch(onStart, /FuelGuardApi\.trySync/);
  assert.doesNotMatch(glanceSource, /FuelGuardApi\.trySync/);
  assert.match(onShowSource, /FuelGuardConnection\.configure\(FuelGuardConnection\.APP_QUICK_LOG\)/);
  assert.match(onShowSource, /FuelGuardConnection\.registerForOAuthMessages\(\)/);
  assert.match(glanceSource, /FuelGuardGlanceState\.metric\(\)/);
  assert.match(glanceSource, /FuelGuardGlanceState\.label\(\)/);
  assert.match(glanceSource, /FuelGuardGlanceState\.countLabel\(\)/);
  assert.doesNotMatch(glanceSource, /FuelGuardFeedback/);
  assert.doesNotMatch(glanceSource, /FuelGuardQueue/);
  assert.doesNotMatch(glanceSource, /FuelGuardConnection|FuelGuardHealth|Communications|Authentication/);
  assert.doesNotMatch(glanceSource, /getTextWidthInPixels/);
  assert.doesNotMatch(glanceSource, /Open to log/);
  assert.match(glanceStateSource, /\(:glance\)\s*module FuelGuardGlanceState/);
  assert.match(glanceStateSource, /LAST_FUEL_KEY = "fg_last_fuel_at"/);
  assert.match(glanceStateSource, /TODAY_FUEL_COUNT_KEY = "fg_today_fuel_count"/);
  assert.match(glanceStateSource, /TODAY_FUEL_DATE_KEY = "fg_today_fuel_date"/);
  assert.match(glanceStateSource, /Ready to log/);
  assert.match(glanceStateSource, /since fuel/);
  assert.match(glanceStateSource, /\$1\$ today/);
  assert.doesNotMatch(glanceStateSource, /FuelGuardQueue|FuelGuardConnection|FuelGuardApi|FuelGuardHealth|Communications|Authentication/);
});

test("Garmin fuel events update local glance state without counting hydration-only events", () => {
  const eventsSource = readRepoFile("garmin/shared/source/FuelGuardEvents.mc");
  const apiSource = readRepoFile("garmin/shared/source/FuelGuardApi.mc");

  assert.match(eventsSource, /FuelGuardGlanceState\.recordFuel\(timestamp\)/);
  assert.match(eventsSource, /WatchUi\.requestUpdate\(\)/);
  assertSourceOrder(eventsSource, "var normalizedType = normalizeType(type);", "FuelGuardGlanceState.recordFuel(timestamp);");
  assert.match(eventsSource, /normalizedType\.equals\(TYPE_FUEL\) \|\| normalizedType\.equals\(TYPE_FUEL_HYDRATION\)/);
  assert.doesNotMatch(eventsSource, /normalizedType\.equals\(TYPE_HYDRATION\)[\s\S]{0,120}FuelGuardGlanceState\.recordFuel/);
  assert.doesNotMatch(apiSource, /TODAY_FUEL_COUNT_KEY|TODAY_FUEL_DATE_KEY|fg_today_fuel_count|fg_today_fuel_date/);
});

test("Quick Log wearable copy uses short safe labels", () => {
  const source = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogView.mc");

  assert.match(source, /Press START/);
  assert.match(source, /Log fuel/);
  assert.match(source, /Hydrate/);
  assert.match(source, /Fuel \+ water/);
  assert.match(source, /getTextWidthInPixels/);
  assert.doesNotMatch(source, /ENTER logs/);
  assert.doesNotMatch(source, /Pending \$1\$  ENTER logs/);
});

test("Garmin settings remove all manual endpoint, token and bypass fields", () => {
  const activityProperties = readRepoFile("garmin/activity-logger/resources/properties.xml");
  const quickLogProperties = readRepoFile("garmin/quick-log/resources/properties.xml");
  const activityStrings = readRepoFile("garmin/activity-logger/resources/strings.xml");
  const quickLogStrings = readRepoFile("garmin/quick-log/resources/strings.xml");

  for (const source of [activityProperties, quickLogProperties, activityStrings, quickLogStrings]) {
    assert.doesNotMatch(source, /apiEndpoint/);
    assert.doesNotMatch(source, /betaToken/);
    assert.doesNotMatch(source, /vercelBypassSecret/);
    assert.doesNotMatch(source, /Vercel bypass secret/);
    assert.doesNotMatch(source, /Garmin beta bearer token/);
    assert.doesNotMatch(source, /Fuel Guard API endpoint/);
  }
});

test("Garmin zero-secret connection uses Authentication OAuth and production endpoints", () => {
  const source = readRepoFile("garmin/shared/source/FuelGuardConnection.mc");

  assert.match(source, /import Toybox\.Authentication;/);
  assert.match(source, /Authentication\.registerForOAuthMessages/);
  assert.match(source, /Authentication\.makeOAuthRequest/);
  assert.match(source, /connectiq:\/\/oauth/);
  assert.match(source, /Cryptography\.randomBytes\(24\)/);
  assert.match(source, /PRODUCTION_BASE_URL = "https:\/\/fuel-guard-iota\.vercel\.app"/);
  assert.match(source, /TOKEN_KEY = "fg_device_token"/);
  assert.doesNotMatch(source, /GARMIN_BETA_TOKEN/);
  assert.doesNotMatch(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(source, /SUPABASE_SECRET/);
});

test("Garmin scripts no longer depend on alpha token or Vercel bypass helpers", () => {
  const endpointScript = readRepoFile("scripts/test-garmin-endpoint.sh");
  const helperScript = readRepoFile("scripts/configure-garmin-alpha-local.sh");

  assert.doesNotMatch(endpointScript, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.doesNotMatch(endpointScript, /GARMIN_BETA_TOKEN/);
  assert.doesNotMatch(endpointScript, /x-vercel-protection-bypass/);
  assert.doesNotMatch(helperScript, /GARMIN_BETA_TOKEN/);
  assert.doesNotMatch(helperScript, /VERCEL_AUTOMATION_BYPASS_SECRET/);
});

test("Garmin docs prominently warn that Auto Lap must be disabled", () => {
  const readme = readRepoFile("garmin/README.md");
  const activityReadme = readRepoFile("garmin/activity-logger/README.md");

  assert.match(readme, /Disable Auto Lap/i);
  assert.match(activityReadme, /Auto Lap must be disabled/i);
});

test("Quick Log health sharing is opt-in and Activity Logger stays fuel-only", () => {
  const quickManifest = readRepoFile("garmin/quick-log/manifest.xml");
  const quickBetaManifest = readRepoFile("garmin/quick-log/manifest.beta.xml");
  const activityManifest = readRepoFile("garmin/activity-logger/manifest.xml");
  const quickProperties = readRepoFile("garmin/quick-log/resources/properties.xml");
  const quickStrings = readRepoFile("garmin/quick-log/resources/strings.xml");

  assert.match(quickManifest, /id="SensorHistory"/);
  assert.match(quickManifest, /id="UserProfile"/);
  assert.match(quickBetaManifest, /id="SensorHistory"/);
  assert.match(quickBetaManifest, /id="UserProfile"/);
  assert.doesNotMatch(activityManifest, /id="SensorHistory"/);
  assert.doesNotMatch(activityManifest, /id="UserProfile"/);
  assert.match(quickProperties, /property id="shareHealthPatterns" type="boolean">false<\/property>/);
  assert.match(quickProperties, /property id="clearHealthPatterns" type="boolean">false<\/property>/);
  assert.match(quickStrings, /Share Garmin health patterns with Fuel Guard/);
});

test("Quick Log health collector uses runtime detection and avoids sensitive profile fields", () => {
  const collector = readRepoFile("garmin/quick-log/source/FuelGuardHealthCollector.mc");

  assert.match(collector, /Toybox has :SensorHistory/);
  assert.match(collector, /SensorHistory has :getHeartRateHistory/);
  assert.match(collector, /SensorHistory has :getStressHistory/);
  assert.match(collector, /SensorHistory has :getBodyBatteryHistory/);
  assert.match(collector, /Toybox has :UserProfile/);
  assert.match(collector, /UserProfile has :getProfile/);
  assert.match(collector, /UserProfile has :getUserActivityHistory/);
  assert.match(collector, /restingHeartRate/);
  assert.match(collector, /averageRestingHeartRate/);
  assert.doesNotMatch(collector, /\.gender\b/);
  assert.doesNotMatch(collector, /\.birthYear\b/);
  assert.doesNotMatch(collector, /\.height\b/);
  assert.doesNotMatch(collector, /\.weight\b/);
  assert.doesNotMatch(collector, /sleepTime|upcomingSleepTime|upcomingWakeTime/);
  assert.doesNotMatch(collector, /TrainingReadiness|RecoveryTime|HRV|hrv/i);
});

test("Quick Log health queue is separate, bounded, and lower priority than fuel logs", () => {
  const queue = readRepoFile("garmin/quick-log/source/FuelGuardHealthQueue.mc");
  const api = readRepoFile("garmin/quick-log/source/FuelGuardHealthApi.mc");
  const connection = readRepoFile("garmin/shared/source/FuelGuardConnection.mc");
  const view = readRepoFile("garmin/quick-log/source/FuelGuardQuickLogView.mc");

  assert.match(queue, /QUEUE_KEY = "fg_pending_health_snapshots"/);
  assert.match(queue, /MAX_QUEUE_SIZE = 3/);
  assert.match(queue, /function removeAcknowledged\(id as String\)/);
  assert.match(api, /if \(FuelGuardQueue\.pendingCount\(\) > 0\)/);
  assert.match(api, /FuelGuardHealthQueue\.peek\(\)/);
  assert.match(api, /FuelGuardHealthQueue\.removeAcknowledged\(context as String\)/);
  assert.match(connection, /HEALTH_PATH = "\/api\/garmin\/health"/);
  assert.match(connection, /function healthEndpoint\(\) as String/);
  assert.match(view, /FuelGuardHealth\.maybeCollectAndSync\("open"\)/);
  assert.match(view, /FuelGuardHealth\.maybeCollectAndSync\("fuel_log"\)/);
  assert.match(view, /FuelGuardHealth\.maybeCollectAndSync\("refresh"\)/);
});
