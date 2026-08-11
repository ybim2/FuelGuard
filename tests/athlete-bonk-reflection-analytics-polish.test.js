const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function at(day, time) {
  return `2026-08-${String(day).padStart(2, "0")}T${time}:00Z`;
}

function localAt(day, time) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2026, 7, day, hours, minutes).toISOString();
}

function loadTraining(logs = []) {
  const trainingMode = {
    presets: {}, plan: {}, estimatedDurationMinutes: 60,
    bonkRisk: { sessionId: "", anchorAt: "", alertedForAnchor: "", active: false },
    activeSession: null, sessions: [], ownerUserId: "athlete-a", lastSyncedAt: "", lastError: ""
  };
  const gap = { trainingMode, logs };
  const document = { hidden: false, addEventListener() {}, getElementById() { return null; }, querySelector() { return null; } };
  const window = { FuelGuardDomain: domain, fuelGuardCloud: {}, addEventListener() {}, dispatchEvent() {}, confirm() { return true; } };
  const sandbox = {
    window, document, navigator: { onLine: true }, console, Date, Intl, Map, Set, Object, Array, Promise,
    crypto: { randomUUID: () => "a1700000-0000-4000-8000-000000000001" },
    fuelGapState: () => gap, save() {}, requestAnimationFrame() { return 1; }, setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  };
  vm.runInNewContext(read("training-mode.js"), sandbox, { filename: "training-mode.js" });
  return { api: window.FuelGuardTrainingMode._test, gap };
}

test("Bonk Risk crosses only after more than ninety minutes of Training Mode without Fuel", () => {
  const { api } = loadTraining();
  const session = { id: "training-a", startedAt: at(11, "10:00") };
  assert.equal(api.bonkRiskModel({ session, now: new Date(at(11, "11:30")) }).active, false);
  const risk = api.bonkRiskModel({ session, now: new Date("2026-08-11T11:30:01Z") });
  assert.equal(risk.active, true);
  assert.equal(risk.elapsedMinutes, 90);
  assert.equal(risk.hasFuelLog, false);
});

test("Bonk Risk uses only Fuel in the same canonical Training Mode session", () => {
  const logs = [
    { type: "hydration", logged_at: at(11, "11:20"), trainingModeSessionId: "training-a" },
    { type: "fuel", logged_at: at(11, "11:25"), trainingModeSessionId: "training-b" },
    { type: "fuel", logged_at: at(11, "11:35"), trainingModeSessionId: "training-a" }
  ];
  const { api } = loadTraining(logs);
  const session = { id: "training-a", startedAt: at(11, "10:00") };
  assert.equal(api.bonkRiskModel({ session, logRows: logs, now: new Date(at(11, "13:05")) }).active, false);
  assert.equal(api.bonkRiskModel({ session, logRows: logs, now: new Date(at(11, "13:06")) }).active, true);
});

test("Bonk Risk announces once per gap, clears on Fuel and can retrigger for a later gap", () => {
  const logs = [];
  const { api, gap } = loadTraining(logs);
  const session = { id: "training-a", status: "active", startedAt: at(11, "10:00") };
  gap.trainingMode.activeSession = session;
  assert.equal(api.syncBonkRisk(session, new Date(at(11, "11:31"))).newlyTriggered, true);
  assert.equal(api.syncBonkRisk(session, new Date(at(11, "11:32"))).newlyTriggered, false);
  logs.push({ type: "fuel", logged_at: at(11, "11:35"), trainingModeSessionId: "training-a" });
  assert.equal(api.syncBonkRisk(session, new Date(at(11, "11:36"))).active, false);
  assert.equal(api.syncBonkRisk(session, new Date(at(11, "13:06"))).newlyTriggered, true);
  assert.equal(api.syncBonkRisk(null, new Date(at(11, "13:07"))).active, false);
});

test("Sleepy and Ready milestones derive from canonical records without duplication", () => {
  const summary = domain.activityMilestoneSummary({
    logs: [
      { type: "checkin", checkin: { checkinType: "sleepy" }, logged_at: at(9, "14:00"), source: "manual" },
      { type: "checkin", checkin: { checkinType: "sleepy" }, logged_at: at(10, "14:00"), source: "garmin" },
      { type: "checkin", checkin: { checkinType: "sleepy" }, logged_at: at(10, "15:00"), source: "test" },
      { type: "checkin", checkin: { checkinType: "sleepy" }, logged_at: at(10, "16:00"), deleted_at: at(10, "17:00") },
      { type: "checkin", checkin: { checkinType: "sleepy" }, logged_at: at(10, "18:00"), valid: false }
    ],
    readyChecks: [
      { checkedOn: "2026-08-09", prepared: true },
      { checkedOn: "2026-08-09", prepared: true },
      { checked_on: "2026-08-10", prepared: true },
      { checkedOn: "2026-08-11", prepared: false }
    ],
    now: new Date(at(11, "18:00"))
  });
  assert.equal(summary.sleepyMoments, 2);
  assert.equal(summary.readyMoments, 2);
  assert.deepEqual(domain.MILESTONE_THRESHOLDS.sleepy, [10, 25, 50, 100, 250, 500, 1000]);
  assert.deepEqual(domain.MILESTONE_THRESHOLDS.ready, [5, 10, 25, 50, 100, 250]);
  assert.equal(domain.MILESTONE_THRESHOLDS.bonk, undefined);
});

test("Useful timing observations respect the period and explicit Snack or Brunch taxonomy", () => {
  const logs = [
    { type: "fuel", logged_at: localAt(8, "08:00") }, { type: "fuel", logged_at: localAt(8, "10:00"), mealType: "snack" }, { type: "fuel", logged_at: localAt(8, "20:00") },
    { type: "fuel", logged_at: localAt(9, "08:30") }, { type: "fuel", logged_at: localAt(9, "11:00"), meal_type: "brunch" }, { type: "fuel", logged_at: localAt(9, "20:30") },
    { type: "fuel", logged_at: localAt(10, "09:00") }, { type: "fuel", logged_at: localAt(10, "21:00"), notes: "snack" },
    { type: "fuel", logged_at: "2026-06-01T06:00:00Z", mealType: "snack" }
  ];
  const timing = domain.athleteFuelTimingObservations({ logs, period: "7d", now: new Date(localAt(11, "22:00")) });
  assert.equal(timing.loggedDays, 3);
  assert.equal(timing.firstFuel.label, "8 AM–9 AM");
  assert.equal(timing.firstSnackOrBrunch.label, "10 AM–11 AM");
  assert.equal(timing.firstSnackOrBrunch.sampleCount, 1);
  assert.equal(timing.snackOrBrunchSampleCount, 2);
  assert.equal(timing.lastMeal.label, "8 PM–9 PM");
});

test("Preparation Rhythm is period-scoped and reports evidence-backed weekday differences", () => {
  const checks = [
    { checkedOn: "2026-08-03", prepared: true }, { checkedOn: "2026-08-10", prepared: true },
    { checkedOn: "2026-08-04", prepared: false }, { checkedOn: "2026-08-11", prepared: false },
    { checkedOn: "2026-08-05", prepared: true }, { checkedOn: "2026-05-01", prepared: true }
  ];
  const rhythm = domain.athletePreparationRhythm({ checks, period: "30d", now: new Date(at(11, "20:00")) });
  assert.equal(rhythm.checkedDays, 5);
  assert.equal(rhythm.preparedDays, 3);
  assert.equal(rhythm.preparedPercentage, 60);
  assert.equal(rhythm.strongestWeekday.label, "Monday");
  assert.equal(rhythm.weakestWeekday.label, "Tuesday");
  assert.equal(rhythm.weekdays.length, 7);
  assert.equal(rhythm.weekdays.find(day => day.label === "Monday").percentage, 100);
  assert.equal(rhythm.weekdays.find(day => day.label === "Sunday").percentage, null);
});

test("Performance baseline is subjective 1–5 and preserves legacy metric support", () => {
  const source = read("athlete-impact.js");
  assert.match(source, /What matters to your performance\?/);
  assert.match(source, /How close do you feel to/);
  assert.match(source, /unit: "\/ 5"/);
  assert.match(source, /\["\/ 5", "\/ 10"\]/);
  assert.doesNotMatch(source.slice(source.indexOf("function customMetricMarkup"), source.indexOf("function ratingScaleMarkup")), /Target minimum|Result format|Better means/);
});

test("Analytics story uses readable unclipped time-axis styling", () => {
  const source = read("athlete-share-card.js");
  assert.match(source, /750 24px system-ui/);
  assert.match(source, /hour === 23 \? "right" : "left"/);
  assert.match(source, /chartY \+ 50/);
});

test("Preparation UI shows every weekday and Snack or Brunch copy uses the explicit sample total", () => {
  const source = read("athlete-analytics.js");
  assert.match(source, /preparation\.weekdays\.map/);
  assert.match(source, /timing\.snackOrBrunchSampleCount/);
  assert.match(source, /label: "Longest recurring gap"/);
  assert.match(source, /label: "Training carb intake"/);
});

test("identity hydration renders only the canonical username", () => {
  const source = read("product-shell.js");
  const section = source.slice(source.indexOf("function safeAthleteName"), source.indexOf("function renderProductAccess"));
  assert.match(section, /profile\.username/);
  assert.doesNotMatch(section, /profile\.first_name|value: "Athlete"/);
  assert.match(section, /resolving: true/);
});

test("milestone migration is limited to the two additive acknowledgement categories", () => {
  const sql = read("supabase/migrations/20260811220000_athlete_sleepy_ready_milestones.sql");
  assert.match(sql, /category in \('streak', 'fuel', 'hydration', 'sleepy', 'ready', 'training', 'work'\)/);
  assert.doesNotMatch(sql, /bonk/i);
  assert.doesNotMatch(sql, /create table|drop table|truncate|insert into|update /i);
});

test("milestone rail and five-tab navigation remain narrow-mobile safe", () => {
  const css = read("fuel-beta.css");
  const html = read("index.html");
  assert.match(css, /padding: 5px 18px 12px 2px/);
  assert.match(css, /scroll-padding-inline: 2px 18px/);
  assert.match(css, /#athleteMilestones[\s\S]*?max-width: 100%[\s\S]*?overflow: hidden/);
  assert.match(css, /min-height: 48px/);
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf("</nav>", html.indexOf('<nav class="mobile-bottom-nav')));
  assert.equal((nav.match(/class="mobile-nav-item/g) || []).length, 5);
});
