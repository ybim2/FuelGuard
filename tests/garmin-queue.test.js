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
  assert.match(apiSource, /VERCEL_BYPASS_PROPERTY = "vercelBypassSecret"/);
  assert.match(apiSource, /headers\["x-vercel-protection-bypass"\] = bypassSecret/);
  assert.match(queueSource, /function removeAcknowledged\(eventId as String\)/);
  assert.match(queueSource, /items\[i\]\[:external_event_id\] != eventId/);
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
