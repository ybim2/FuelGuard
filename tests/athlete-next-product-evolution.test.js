const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");
const shareCard = require("../athlete-share-card.js");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function localTime(day, hour, minute = 0) {
  return new Date(2026, 7, day, hour, minute).toISOString();
}

function loadTools() {
  const gap = { logs: [], trainingMode: { sessions: [] }, fuelKit: { ownerUserId: "", current: null, checks: [] } };
  const window = { FuelGuardDomain: domain, addEventListener() {}, fuelGuardCloud: {} };
  const document = { hidden: false, addEventListener() {}, getElementById() { return null; } };
  const context = { window, document, fuelGapState: () => gap, save() {}, crypto: { randomUUID: () => "a1400000-0000-4000-8000-000000000001" }, globalThis: {}, Date, Math, Number, String, Boolean, Array, Object };
  context.globalThis.crypto = context.crypto;
  vm.runInNewContext(read("athlete-tools.js"), context);
  return window.FuelGuardAthleteTools._test;
}

function loadEveryday() {
  const window = { FuelGuardDomain: domain, addEventListener() {}, fuelGuardCloud: {} };
  const document = { hidden: false, addEventListener() {}, getElementById() { return null; } };
  const context = { window, document, globalThis: { crypto: { randomUUID: () => "a1500000-0000-4000-8000-000000000001" } }, Date, Intl, Number, String, Boolean, Array, Object };
  vm.runInNewContext(read("athlete-everyday-reflection.js"), context);
  return window.FuelGuardEverydayReflection._test;
}

test("canonical Athlete shell exposes exactly five ordered mobile destinations", () => {
  const html = read("index.html");
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf("</nav>", html.indexOf('<nav class="mobile-bottom-nav')));
  assert.deepEqual([...nav.matchAll(/data-mobile-screen="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Daily"],
    ["training", "Training"],
    ["impact", "Reflection"],
    ["analytics", "Analytics"],
    ["tools", "Tools"]
  ]);
  assert.match(read("app-ui.js"), /"dashboard", "training", "impact", "analytics", "tools", "checklist"/);
});

test("Athlete shell identity cannot fall back to email", () => {
  const source = read("product-shell.js");
  const identity = source.slice(source.indexOf("function identityModel"), source.indexOf("function renderMainAccountIdentity"));
  assert.match(identity, /profile\.username/);
  assert.doesNotMatch(identity, /profile\.first_name|value: "Athlete"/);
  assert.match(identity, /value: ""/);
  assert.doesNotMatch(identity, /account\.email|\bemail\b/);
});

test("Fuel Rhythm is normalized across logged days and always returns 24 hours", () => {
  const logs = [
    { logged_at: localTime(8, 8), type: "fuel", source: "manual" },
    { logged_at: localTime(8, 14), type: "fuel", source: "manual" },
    { logged_at: localTime(9, 8, 30), type: "fuel", source: "garmin" },
    { logged_at: localTime(9, 14, 15), type: "fuel", source: "manual" },
    { logged_at: localTime(9, 16), type: "hydration", source: "manual" },
    { logged_at: localTime(9, 9), type: "fuel", source: "test" }
  ];
  const rhythm = domain.athleteFuelRhythm({ logs, period: "7d", now: new Date(2026, 7, 11, 12) });
  assert.equal(rhythm.bars.length, 24);
  assert.equal(rhythm.eventCount, 4);
  assert.equal(rhythm.loggedDays, 2);
  assert.equal(rhythm.typicalEventsPerLoggedDay, 2);
  assert.equal(rhythm.peak.label, "8 AM–9 AM");
  assert.equal(rhythm.typicalGap.dayCount, 2);
});

test("Fuel Rhythm with sparse evidence returns a truthful empty state", () => {
  const rhythm = domain.athleteFuelRhythm({ logs: [{ logged_at: localTime(10, 8), type: "fuel" }], period: "30d", now: new Date(2026, 7, 11, 12) });
  assert.equal(rhythm.sufficient, false);
  assert.equal(rhythm.peak, null);
  assert.equal(rhythm.typicalGap, null);
});

test("Training analytics derives rates and per-workout totals from canonical completed sessions", () => {
  const sessions = [
    { id: "session-a", status: "completed", startedAt: localTime(9, 8), endedAt: localTime(9, 9) },
    { id: "session-b", status: "completed", startedAt: localTime(10, 8), endedAt: localTime(10, 10) },
    { id: "too-short", status: "completed", startedAt: localTime(10, 12), endedAt: localTime(10, 12, 10) }
  ];
  const logs = [
    { logged_at: localTime(9, 8, 30), type: "fuel", trainingModeSessionId: "session-a", carbsG: 30, fluidMl: 250, sodiumMg: 300 },
    { logged_at: localTime(10, 9), type: "fuel_hydration", trainingModeSessionId: "session-b", carbsG: 60, fluidMl: 500, sodiumMg: 600 }
  ];
  const analytics = domain.athleteTrainingFuelAnalytics({ sessions, logs, period: "30d", now: new Date(2026, 7, 11, 12) });
  assert.equal(analytics.workoutCount, 2);
  assert.equal(analytics.durationHours, 3);
  assert.deepEqual(analytics.metrics.carbsG, { total: 90, perHour: 30, averagePerWorkout: 45, observedMaxPerHour: 30 });
  assert.equal(analytics.metrics.fluidMl.perHour, 250);
  assert.equal(analytics.metrics.sodiumMg.averagePerWorkout, 450);
});

test("Cumulative milestone summary counts valid completed Training and Work only", () => {
  const summary = domain.activityMilestoneSummary({
    logs: [{ logged_at: localTime(10, 8), type: "fuel" }, { logged_at: localTime(10, 9), type: "hydration" }],
    trainingSessions: [
      { status: "completed", startedAt: localTime(10, 8), endedAt: localTime(10, 9) },
      { status: "completed", startedAt: localTime(10, 10), endedAt: localTime(10, 10, 5) }
    ],
    workSessions: [{ status: "completed", startedAt: localTime(10, 8), endedAt: localTime(10, 16) }, { status: "active", startedAt: localTime(11, 8) }],
    now: new Date(2026, 7, 11, 12)
  });
  assert.equal(summary.fuelMoments, 1);
  assert.equal(summary.hydrationMoments, 1);
  assert.equal(summary.trainingMoments, 1);
  assert.equal(summary.workMoments, 1);
});

test("Fuel Kit readiness requires practical coverage and respects training context", () => {
  const tools = loadTools();
  assert.equal(tools.prepared({ fuelOptions: 2, reserveReady: true, hydrationReady: true, trainingToday: false }), true);
  assert.equal(tools.prepared({ fuelOptions: 2, reserveReady: false, hydrationReady: true, trainingToday: false }), false);
  assert.equal(tools.prepared({ fuelOptions: 2, reserveReady: true, hydrationReady: true, trainingToday: true, trainingFuelReady: false }), false);
  assert.equal(tools.prepared({ fuelOptions: 2, reserveReady: true, hydrationReady: true, trainingToday: true, trainingFuelReady: true }), true);
});

test("Fuel Kit prepared-day summaries remain based on checked days only", () => {
  const tools = loadTools();
  const checks = Array.from({ length: 24 }, (_, index) => ({ checkedOn: `2026-08-${String(index + 1).padStart(2, "0")}`, prepared: index % 2 === 0 }));
  const stats = tools.checkedDayStats(checks, new Date(2026, 7, 25));
  assert.equal(stats.recentTotal, 20);
  assert.equal(stats.recentReady, 10);
  assert.equal(stats.monthTotal, 24);
  assert.equal(stats.monthReady, 12);
});

test("Everyday Reflection requires only applicable 1–5 ratings", () => {
  const everyday = loadEveryday();
  const entry = everyday.blankEntry("baseline", new Date(2026, 7, 11));
  everyday.FIELDS.forEach(field => { entry[field.key] = 3; });
  assert.equal(everyday.entryComplete(entry), true);
  entry.workApplicable = false;
  everyday.FIELDS.filter(field => field.group === "work").forEach(field => { entry[field.key] = null; });
  assert.equal(everyday.entryComplete(entry), true);
  entry.mealPrepOrganisation = null;
  assert.equal(everyday.entryComplete(entry), false);
});

test("Everyday comparisons are non-causal and capped to three strongest changes", () => {
  const everyday = loadEveryday();
  const base = everyday.blankEntry("baseline", new Date(2026, 7, 1));
  const current = everyday.blankEntry("checkin", new Date(2026, 7, 15));
  everyday.FIELDS.forEach((field, index) => {
    base[field.key] = 2;
    current[field.key] = index < 4 ? 5 : 2;
  });
  assert.equal(everyday.comparisons(base, current).length, everyday.FIELDS.length);
  assert.equal(everyday.strongestChanges(everyday.comparisons(base, current)).length, 3);
  assert.match(read("athlete-everyday-reflection.js"), /They do not show what caused a change/);
});

test("Analytics sharing uses a private 1080 by 1920 reusable story template", () => {
  const model = shareCard.buildAnalyticsStoryModel({ analytics: {
    period: "30d",
    rhythm: { sufficient: true, typicalEventsPerLoggedDay: 4.2, loggedDays: 12, peak: { label: "8 AM–9 AM" }, typicalGap: { averageMinutes: 245 } },
    training: { sufficient: true, workoutCount: 4, metrics: { carbsG: { perHour: 54 }, fluidMl: { perHour: 480 } } }
  }, now: new Date("2026-08-11T12:00:00Z") });
  assert.equal(model.template, shareCard.ANALYTICS_TEMPLATE);
  assert.equal(shareCard.STORY_WIDTH, 1080);
  assert.equal(shareCard.STORY_HEIGHT, 1920);
  assert.equal(model.metrics.length, 4);
  assert.equal(JSON.stringify(model).includes("@"), false);
});

test("additive migration keeps Athlete-owned data private and completed baselines immutable", () => {
  const sql = read("supabase/migrations/20260811184020_athlete_next_product_evolution.sql");
  for (const table of ["fuel_kit_checks", "fuel_everyday_reflections"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.match(sql, /Completed Everyday Reflection records are immutable/);
  assert.match(sql, /fuel_everyday_reflections_one_baseline_idx/);
  assert.match(sql, /category in \('streak', 'fuel', 'hydration', 'training', 'work'\)/);
  assert.doesNotMatch(sql, /drop table|truncate/i);
});

test("new Athlete assets are included in the versioned offline app shell", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  for (const asset of ["athlete-everyday-reflection", "athlete-analytics", "athlete-tools"]) {
    assert.match(html, new RegExp(`${asset}\\.css\\?v=mobile-pwa-v155-training-nutrition-analytics`));
    assert.match(html, new RegExp(`${asset}\\.js\\?v=mobile-pwa-v155-training-nutrition-analytics`));
    assert.match(sw, new RegExp(`${asset}\\.css`));
    assert.match(sw, new RegExp(`${asset}\\.js`));
  }
});
