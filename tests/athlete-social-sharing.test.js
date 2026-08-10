const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const domain = require("../fuel-guard-domain.js");
const shareCard = require("../athlete-share-card.js");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function log(timestamp, type = "fuel", extra = {}) {
  return { id: `${type}-${timestamp}`, timestamp, type, source: "manual", ...extra };
}

function canvasFixture() {
  const text = [];
  const gradient = () => ({ addColorStop() {} });
  const context = {
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    fillRect() {}, arc() {}, lineTo() {}, save() {}, restore() {},
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText(value) { return { width: String(value).length * 16 }; },
    fillText(value) { text.push(String(value)); }
  };
  return {
    canvas: { width: 0, height: 0, getContext: () => context },
    text
  };
}

function controllerFixture({ nativeShare = false, shareImplementation = null } = {}) {
  const button = { disabled: false, attributes: {}, addEventListener(_name, listener) { this.listener = listener; }, setAttribute(name, value) { this.attributes[name] = value; } };
  const status = { textContent: "" };
  const download = { clicks: 0, remove() {}, click() { this.clicks += 1; } };
  const shared = [];
  class FixtureFile {
    constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; }
  }
  const sandbox = {
    Blob,
    File: FixtureFile,
    Uint8Array,
    atob: value => Buffer.from(value, "base64").toString("binary"),
    console,
    fuelGapState: () => ({ logs: [], maximumFuelGapMinutes: 180, trainingMode: { sessions: [] } }),
    navigator: nativeShare ? {
      canShare: ({ files }) => files?.[0]?.name === "fuel-guard-daily-2026-08-10.png",
      share: payload => { shared.push(payload); return shareImplementation ? shareImplementation(payload) : Promise.resolve(); }
    } : {},
    URL: { createObjectURL: () => "blob:daily-story", revokeObjectURL() {} },
    setTimeout,
    document: {
      readyState: "complete",
      body: { appendChild() {} },
      getElementById(id) { return id === "athleteDailyShareButton" ? button : id === "athleteDailyShareStatus" ? status : null; },
      createElement(tag) { return tag === "a" ? download : {}; }
    },
    FuelGuardDomain: {},
    FuelGuardShareCard: {
      DAILY_TEMPLATE: "daily-story",
      buildDailyStoryModel: () => ({ dateKey: "2026-08-10" }),
      renderTemplate: () => ({ toDataURL: () => "data:image/png;base64,AQ==" }),
      dailyStoryFilename: () => "fuel-guard-daily-2026-08-10.png"
    },
    fuelGuardCloud: { user: { id: "athlete-a" } },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("athlete-share.js"), sandbox);
  return { sandbox, button, status, download, shared };
}

test("Daily Story model uses valid real-day activity, streak and completed Training Mode data", () => {
  const now = new Date("2026-08-10T18:00:00Z");
  const logs = [
    log("2026-08-08T08:00:00Z", "fuel_hydration"),
    log("2026-08-09T08:00:00Z", "fuel_hydration"),
    log("2026-08-10T08:00:00Z"),
    log("2026-08-10T10:00:00Z", "hydration"),
    log("2026-08-10T16:45:00Z", "fuel_hydration", { trainingModeSessionId: "session-a" }),
    log("2026-08-10T17:00:00Z", "fuel", { deleted_at: "2026-08-10T17:01:00Z" }),
    log("2026-08-10T17:10:00Z", "hydration", { source: "fixture" })
  ];
  const model = shareCard.buildDailyStoryModel({
    logs,
    sessions: [{ id: "session-a", status: "completed", startedAt: "2026-08-10T16:00:00Z", endedAt: "2026-08-10T17:00:00Z" }],
    maximumGapMinutes: 180,
    now,
    domain
  });
  assert.equal(model.dateKey, "2026-08-10");
  assert.deepEqual([model.fuelCount, model.hydrationCount], [2, 2]);
  assert.equal(model.momentCount, 3);
  assert.deepEqual([model.dayStreak, model.fuelStreak, model.hydrationStreak], [3, 3, 3]);
  assert.equal(model.status.key, "steady");
  assert.equal(model.training, "1 TRAINING SESSION COMPLETE");
  assert.equal(model.events.length, 3);
});

test("Daily Story status stays evidence-based for empty, approaching and exceeded fuel windows", () => {
  const now = new Date("2026-08-10T18:00:00Z");
  const empty = shareCard.buildDailyStoryModel({ now, logs: [], domain });
  const approaching = shareCard.buildDailyStoryModel({ now, logs: [log("2026-08-10T15:20:00Z")], maximumGapMinutes: 180, domain });
  const exceeded = shareCard.buildDailyStoryModel({ now, logs: [log("2026-08-10T14:00:00Z")], maximumGapMinutes: 180, domain });
  assert.deepEqual([empty.status.key, approaching.status.key, exceeded.status.key], ["empty", "approaching", "refuel"]);
  assert.match(empty.status.detail, /first fuel moment/i);
  assert.match(approaching.status.detail, /next moment is close/i);
  assert.match(exceeded.status.detail, /Time for the next moment/i);
});

test("Daily Story renderer is an exact 9:16 export with concise Fuel Guard content", () => {
  const fixture = canvasFixture();
  const model = shareCard.buildDailyStoryModel({
    now: new Date("2026-08-10T18:00:00Z"),
    logs: [log("2026-08-10T17:00:00Z"), log("2026-08-10T17:30:00Z", "hydration")],
    domain
  });
  const canvas = shareCard.renderDailyStory(model, { canvasFactory: () => fixture.canvas });
  assert.deepEqual([canvas.width, canvas.height], [1080, 1920]);
  assert.equal(canvas.width / canvas.height, 9 / 16);
  assert.ok(fixture.text.includes("FUEL GUARD"));
  assert.ok(fixture.text.includes("DAILY RHYTHM"));
  assert.ok(fixture.text.includes("FUELGUARDAPP.COM"));
  assert.ok(fixture.text.includes("DAY STREAK"));
  assert.ok(fixture.text.includes("FUEL STREAK"));
  assert.ok(fixture.text.includes("HYDRATION STREAK"));
  assert.equal(fixture.text.some(value => /@|user[_ -]?id|organisation/i.test(value)), false);
});

test("Story renderer exposes a reusable template registry while shipping only Daily", () => {
  assert.deepEqual(shareCard.templateNames(), ["daily-story"]);
  const fixture = canvasFixture();
  shareCard.registerTemplate("test-template", () => fixture.canvas);
  assert.equal(shareCard.renderTemplate("test-template", {}).getContext("2d"), fixture.canvas.getContext("2d"));
  assert.throws(() => shareCard.renderTemplate("missing", {}), /Unknown Fuel Guard story template/);
});

test("canonical Daily has one compact share action at the bottom and no legacy summary controls", () => {
  const html = read("index.html");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="training"'));
  assert.equal((dashboard.match(/id="athleteDailyShareButton"/g) || []).length, 1);
  assert.ok(dashboard.indexOf("athleteDailyShareButton") > dashboard.indexOf("athleteMilestones"));
  assert.doesNotMatch(dashboard, /shareDailySummaryButton|downloadDailySummaryButton|Share summary|Download summary/);
  assert.match(read("athlete-share.css"), /width: auto;[\s\S]*min-height: 38px/);
  assert.doesNotMatch(read("fuel-beta.js"), /createDailySummaryCanvas|shareDailySummaryImage/);
});

test("share controller uses native file sharing and an image-download fallback without delaying the share gesture", () => {
  const controller = read("athlete-share.js");
  assert.match(controller, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  assert.match(controller, /navigator\.share\(\{[\s\S]*files: \[file\]/);
  assert.match(controller, /fallbackDownload\(blob, filename/);
  assert.match(controller, /Share cancelled\./);
  assert.match(controller, /Sharing was unavailable, so your story was saved as an image\./);
  assert.match(controller, /function shareDailyStory\(\)/);
  assert.doesNotMatch(controller, /async function shareDailyStory/);
});

test("unsupported browsers receive a real PNG download fallback and a useful status", () => {
  const fixture = controllerFixture();
  fixture.sandbox.FuelGuardAthleteShare.shareDailyStory();
  assert.equal(fixture.download.clicks, 1);
  assert.equal(fixture.status.textContent, "Story saved as an image. Share it from Photos.");
  assert.equal(fixture.button.disabled, false);
});

test("supported browsers receive the generated PNG through native file sharing", async () => {
  const fixture = controllerFixture({ nativeShare: true });
  fixture.sandbox.FuelGuardAthleteShare.shareDailyStory();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.shared.length, 1);
  assert.equal(fixture.shared[0].files[0].name, "fuel-guard-daily-2026-08-10.png");
  assert.equal(fixture.shared[0].files[0].type, "image/png");
  assert.equal(fixture.status.textContent, "Story shared.");
});

test("a pending native share cannot download the previous athlete’s card after an account switch", async () => {
  let rejectShare;
  const pending = new Promise((_resolve, reject) => { rejectShare = reject; });
  const fixture = controllerFixture({ nativeShare: true, shareImplementation: () => pending });
  fixture.sandbox.FuelGuardAthleteShare.shareDailyStory();
  fixture.sandbox.fuelGuardCloud.user = { id: "athlete-b" };
  fixture.sandbox.FuelGuardAthleteShare._test.resetForCurrentIdentity();
  rejectShare(new Error("native share closed"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.download.clicks, 0);
  assert.equal(fixture.status.textContent, "");
});

test("share state resets when authenticated identity changes and never persists an account identifier", () => {
  const controller = read("athlete-share.js");
  assert.match(controller, /window\.addEventListener\("fuelguard:cloud-status", resetForCurrentIdentity\)/);
  assert.match(controller, /const nextIdentity = cloudUserId\(\);[\s\S]*setStatus\(""\)/);
  assert.doesNotMatch(controller, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(read("athlete-share-card.js"), /\.email|displayName|organisationId|organizationId/);
});

test("new Story assets are versioned into the offline app shell", () => {
  const html = read("index.html");
  const worker = read("sw.js");
  ["athlete-share.css", "athlete-share-card.js", "athlete-share.js"].forEach(file => {
    assert.match(html, new RegExp(file.replace(".", "\\.")));
    assert.match(worker, new RegExp(file.replace(".", "\\.")));
  });
});
