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
  const images = [];
  const gradient = () => ({ addColorStop() {} });
  const context = {
    beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {},
    fillRect() {}, arc() {}, lineTo() {}, save() {}, restore() {}, drawImage(value) { images.push(value); },
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    measureText(value) { return { width: String(value).length * 16 }; },
    fillText(value) { text.push(String(value)); }
  };
  return {
    canvas: { width: 0, height: 0, getContext: () => context },
    text,
    images
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
      querySelectorAll() { return []; },
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
  assert.ok(fixture.text.includes("@fuelguardapp"));
  assert.ok(fixture.text.includes("DAY STREAK"));
  assert.ok(fixture.text.includes("FUEL STREAK"));
  assert.ok(fixture.text.includes("HYDRATION STREAK"));
  assert.equal(fixture.text.some(value => /user[_ -]?id|organisation/i.test(value)), false);
});

test("Story renderer exposes a reusable template registry for Daily and four Settings cards", () => {
  assert.deepEqual(shareCard.templateNames(), ["daily-story", "daily-summary", "pre-post-workout", "during-workout", "sleepiness", "athlete-analytics"]);
  const fixture = canvasFixture();
  shareCard.registerTemplate("test-template", () => fixture.canvas);
  assert.equal(shareCard.renderTemplate("test-template", {}).getContext("2d"), fixture.canvas.getContext("2d"));
  assert.throws(() => shareCard.renderTemplate("missing", {}), /Unknown Fuel Guard story template/);
});

test("Analytics Story renders the accepted 1080 by 1920 card without account identifiers", () => {
  const fixture = canvasFixture();
  const model = shareCard.buildAnalyticsStoryModel({
    analytics: {
      period: "30d",
      rhythm: {
        sufficient: true,
        typicalEventsPerLoggedDay: 4.2,
        loggedDays: 12,
        peak: { label: "8 AM–9 AM" },
        typicalGap: { averageMinutes: 245 },
        bars: Array.from({ length: 24 }, (_, hour) => ({ hour, relativeHeight: (hour * 17) % 100 }))
      },
      training: {
        sufficient: true,
        workoutCount: 4,
        metrics: {
          carbsG: { perHour: 54 },
          sodiumMg: { perHour: 620 },
          fluidMl: { perHour: 480 }
        }
      }
    },
    athleteName: "Theo",
    now: new Date("2026-08-11T12:00:00Z")
  });
  const canvas = shareCard.renderAnalyticsStory(model, { canvasFactory: () => fixture.canvas });
  assert.deepEqual([canvas.width, canvas.height], [1080, 1920]);
  assert.equal(canvas.width / canvas.height, 9 / 16);
  assert.ok(fixture.text.includes("ATHLETE ANALYTICS"));
  assert.ok(fixture.text.includes("FUELGUARDAPP.COM"));
  assert.ok(fixture.text.includes("@fuelguardapp"));
  assert.equal(fixture.text.some(value => /user[_ -]?id|organisation|organization/i.test(value)), false);
});

test("Settings share models use actual Daily, pre/post, during-workout and Sleepy records", () => {
  const now = new Date("2026-08-10T10:00:00Z");
  const session = {
    id: "session-share",
    userId: "athlete-a",
    title: "Morning ride",
    status: "completed",
    startedAt: "2026-08-10T08:00:00Z",
    endedAt: "2026-08-10T09:00:00Z",
    estimatedDurationMinutes: 60,
    plan: { carbsG: 60, fluidMl: 500, sodiumMg: 600, caffeineMg: 0 }
  };
  const logs = [
    log("2026-08-10T07:30:00Z", "fuel", { user_id: "athlete-a" }),
    log("2026-08-10T08:30:00Z", "fuel", { user_id: "athlete-a", trainingModeSessionId: "session-share", carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 }),
    log("2026-08-10T08:45:00Z", "hydration", { user_id: "athlete-a", trainingModeSessionId: "session-share", carbsG: 0, fluidMl: 250, sodiumMg: 300, caffeineMg: 40 }),
    log("2026-08-10T09:30:00Z", "fuel", { user_id: "athlete-a" }),
    log("2026-08-10T09:40:00Z", "hydration", { user_id: "athlete-a" }),
    log("2026-08-09T14:00:00Z", "fuel", { notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}' }),
    log("2026-08-10T15:00:00Z", "fuel", { notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}' }),
    log("2026-08-10T09:55:00Z", "fuel", { deleted_at: "2026-08-10T09:56:00Z" }),
    log("2026-08-10T06:00:00Z", "fuel", { user_id: "athlete-a" })
  ];

  const daily = shareCard.buildDailySummaryModel({ logs, now, domain });
  assert.equal(daily.metrics.find(metric => metric.label === "First Fuel").value, domain.formatClock(new Date("2026-08-10T06:00:00Z")));
  assert.equal(daily.metrics.find(metric => metric.label === "Last Fuel").value, domain.formatClock(new Date("2026-08-10T09:30:00Z")));
  assert.equal(daily.metrics.find(metric => metric.label === "Fuel logs").value, "4");
  assert.equal(daily.metrics.find(metric => metric.label === "Avg. fuel gap").value, "1h 10m");
  assert.equal(daily.metrics.find(metric => metric.label === "Hydration logs").value, "2");
  assert.equal(daily.metrics.find(metric => metric.label === "Last Hydration").value, domain.formatClock(new Date("2026-08-10T09:40:00Z")));

  const prePost = shareCard.buildPrePostWorkoutModel({ logs, sessions: [session], domain });
  assert.equal(prePost.headline, "MORNING RIDE");
  assert.deepEqual(prePost.metrics.map(metric => metric.value), ["30m before", "30m after"]);

  const during = shareCard.buildDuringWorkoutModel({ logs, sessions: [session], domain });
  assert.deepEqual(during.metrics.map(metric => metric.value), ["30g", "300mg", "250ml", "40mg"]);
  assert.ok(during.metrics.every(metric => metric.visualization === "relative-bar"));
  assert.ok(during.metrics.every(metric => metric.barRatio > 0 && metric.barRatio < 1));
  assert.match(during.note, /Recorded 30g carbohydrate · Planned 60g/);
  assert.match(during.note, /not targets/);

  const sleepy = shareCard.buildSleepinessModel({ logs, now: new Date("2026-08-10T18:00:00Z"), domain });
  assert.equal(sleepy.headline, "2 SLEEPY EVENTS");
  assert.equal(sleepy.metrics.find(metric => metric.label === "Common period").value, "Afternoon");
  assert.match(sleepy.note, /not a causal or medical conclusion/);
});

test("all Settings share cards export at 9:16 with canonical brand and handle, without private identifiers", () => {
  for (const template of [
    shareCard.DAILY_SUMMARY_TEMPLATE,
    shareCard.PRE_POST_TEMPLATE,
    shareCard.DURING_WORKOUT_TEMPLATE,
    shareCard.SLEEPINESS_TEMPLATE
  ]) {
    const fixture = canvasFixture();
    const model = shareCard.buildSummaryModel(template, { logs: [], sessions: [], now: new Date("2026-08-10T18:00:00Z"), domain });
    const brandImage = { canonical: true };
    const canvas = shareCard.renderTemplate(template, model, { canvasFactory: () => fixture.canvas, brandImage });
    assert.deepEqual([canvas.width, canvas.height], [1080, 1920]);
    assert.ok(fixture.text.includes("@fuelguardapp"));
    assert.equal(fixture.images[0], brandImage);
    assert.equal(fixture.text.some(value => /user[_ -]?id|organisation|organization/i.test(value)), false);
  }
});

test("Daily summary handles zero, one and multiple Fuel-event gap states without fabrication", () => {
  const now = new Date("2026-08-10T18:00:00Z");
  const empty = shareCard.buildDailySummaryModel({ logs: [], now, domain });
  assert.deepEqual(empty.metrics.slice(0, 4).map(metric => metric.value), ["—", "—", "0", "—"]);

  const one = shareCard.buildDailySummaryModel({ logs: [log("2026-08-10T07:42:00Z")], now, domain });
  assert.equal(one.metrics.find(metric => metric.label === "First Fuel").value, domain.formatClock(new Date("2026-08-10T07:42:00Z")));
  assert.equal(one.metrics.find(metric => metric.label === "Last Fuel").value, domain.formatClock(new Date("2026-08-10T07:42:00Z")));
  assert.equal(one.metrics.find(metric => metric.label === "Avg. fuel gap").value, "—");

  const multiple = shareCard.buildDailySummaryModel({ logs: [
    log("2026-08-10T07:00:00Z"),
    log("2026-08-10T09:00:00Z"),
    log("2026-08-10T12:00:00Z")
  ], now, domain });
  assert.equal(multiple.metrics.find(metric => metric.label === "Avg. fuel gap").value, "2h 30m");
});

test("Settings exposes four intentional cards with native share and explicit save fallback", () => {
  const html = read("index.html");
  const controller = read("athlete-share.js");
  assert.equal((html.match(/data-athlete-share-template=/g) || []).length, 4);
  assert.match(html, /athlete-share-option-grid" role="group" aria-label="Fuel Guard share cards"/);
  assert.doesNotMatch(html, /data-athlete-share-template="[^"]+" role="listitem"/);
  assert.match(html, /Daily Fuel \+ Hydration/);
  assert.match(html, /Pre\/Post Workout Fuelling/);
  assert.match(html, /During-Workout Fuelling/);
  assert.match(html, /Sleepiness/);
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Share your Fuel Guard day and tag <strong>@fuelguardapp<\/strong>/);
  assert.match(html, /This preview is the exact 1080 × 1920 image/);
  assert.match(controller, /shareSelectedStory/);
  assert.match(controller, /openSettingsPreview\(model\.title\)/);
  assert.match(controller, /event\.key === "Escape"/);
  assert.match(controller, /Native image sharing is unavailable, so the card was saved instead/);
  assert.match(controller, /Your account changed\. Choose a share card again/);
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
