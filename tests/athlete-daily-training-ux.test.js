const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function byId(result, id) {
  return result.insights.find(insight => insight.id === id);
}

test("Daily exposes one canonical Daily and Training navigation pair", () => {
  const html = read("index.html");
  assert.equal((html.match(/data-mobile-screen="dashboard"/g) || []).length, 1);
  assert.equal((html.match(/data-mobile-screen="training"/g) || []).length, 1);
  assert.doesNotMatch(html, /<nav class="side-nav beta-nav">/);
});

test("Today’s Insights always reports useful same-day counts", () => {
  const result = domain.todayAthleteInsights({
    logs: [],
    sessions: [],
    now: new Date("2026-08-09T18:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(byId(result, "fuel-moments-today").value, "0");
  assert.equal(byId(result, "hydration-moments-today").value, "0");
  assert.equal(result.insights.length, 2);
});

test("Today’s Insights derives intervals gaps hydration and Sleepy timing from today only", () => {
  const result = domain.todayAthleteInsights({
    logs: [
      { type: "fuel", logged_at: "2026-08-09T08:00:00Z" },
      { type: "fuel", logged_at: "2026-08-09T11:00:00Z" },
      { type: "hydration", logged_at: "2026-08-09T12:00:00Z" },
      { type: "fuel", logged_at: "2026-08-09T15:00:00Z" },
      { type: "checkin", logged_at: "2026-08-09T17:30:00Z", notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}' },
      { type: "fuel", logged_at: "2026-08-08T01:00:00Z" }
    ],
    now: new Date("2026-08-09T18:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(byId(result, "average-fuel-interval-today").value, "3h 30m");
  assert.equal(byId(result, "largest-fuel-gap-today").detail, "4h 00m between recorded Fuel moments.");
  assert.equal(byId(result, "current-hydration-gap-today").value, "6h 00m");
  assert.equal(byId(result, "sleepy-fuel-gap-today").value, "2h 30m after last fuel");
  assert.equal(result.counts.fuel, 3);
});

test("Today’s training context uses Training Mode timestamps and strict surrounding Fuel logs", () => {
  const result = domain.todayAthleteInsights({
    logs: [
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T16:18:00Z" },
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T18:30:00Z", training_mode_session_id: "session-a", carbs_g: 30 },
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T20:47:00Z" }
    ],
    sessions: [{
      id: "session-a",
      user_id: "athlete-a",
      status: "completed",
      title: "Evening ride",
      started_at: "2026-08-09T18:00:00Z",
      ended_at: "2026-08-09T19:05:00Z"
    }],
    now: new Date("2026-08-09T21:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(byId(result, "training-fuel-before-today").value, "1h 42m before session");
  assert.equal(byId(result, "training-fuel-after-today").value, "1h 42m post workout to fuel");
});

test("Training plans persist expected duration and calculate approximate session totals", () => {
  const planned = domain.trainingPlannedSessionTotals({
    carbsG: 60,
    fluidMl: 750,
    sodiumMg: 900,
    caffeineMg: 40
  }, 150);
  assert.deepEqual(planned, {
    estimatedDurationMinutes: 150,
    totals: { carbsG: 150, fluidMl: 1875, sodiumMg: 2250, caffeineMg: 100 }
  });
});

test("Training setup combines Garmin Fuel and Hydrate quantities without changing their data semantics", () => {
  const js = read("training-mode.js");
  assert.match(js, /const fields = type === "fuel" \? \["carbsG"\] : \["fluidMl", "sodiumMg", "caffeineMg"\]/);
  for (const label of ["Carbs (Fuel)", "Fluid (Hydrate)", "Sodium (Hydrate)", "Caffeine (Hydrate)"]) {
    assert.match(js, new RegExp(label.replace(/[()]/g, "\\$&")));
  }
  assert.match(js, /actionInputs\("fuel"[\s\S]*actionInputs\("hydration"/);
  assert.equal((js.match(/<h2>Fuel<\/h2>/g) || []).length, 1);
  assert.doesNotMatch(js, /<h2>Hydrate<\/h2>/);
  assert.match(js, />30m<|>30m<\/option>/);
  assert.match(js, />1h<|>1h<\/option>/);
  assert.match(js, />1h 30m<|>1h 30m<\/option>/);
  assert.match(js, />2h<|>2h<\/option>/);
  assert.match(js, />3h<|>3h<\/option>/);
  assert.match(js, />Custom<|>Custom<\/option>/);
  assert.match(js, /Approx\. session fuel/);
  assert.match(js, /training\.estimatedDurationMinutes = estimatedDurationMinutes\(\{ readForm: true \}\);[\s\S]*persist\(\);/);
  assert.doesNotMatch(js, /Advanced Targets|advancedPlanEnabled|data-training-plan/);
});

test("Active Training shows honest totals while completed sessions calculate actual rates", () => {
  const js = read("training-mode.js");
  const intakeStart = js.indexOf("function intakeCards");
  const activeEnd = js.indexOf("function presetSummary");
  const activeUi = js.slice(intakeStart, activeEnd);
  assert.match(activeUi, /Session stats/);
  assert.match(activeUi, /Recorded intake/);
  assert.match(activeUi, /\/h planned/);
  assert.doesNotMatch(activeUi, /summary\.perHour|\/h actual/);
  assert.match(js.slice(js.indexOf("function completedSessionsMarkup")), /summary\.actualPerHour/);
  assert.match(js, /at least 15 minutes and a logged Training event/);
  assert.match(js, /training-mode-review-time[\s\S]*training-mode-review-actual[\s\S]*training-mode-review-events/);
});

test("Training Insights separates completed-session evidence from today’s observations", () => {
  const result = domain.athleteTrainingInsights({
    logs: [
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T07:00:00Z" },
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T08:30:00Z", training_mode_session_id: "session-a", carbs_g: 30 },
      { user_id: "athlete-a", type: "hydration", logged_at: "2026-08-09T09:00:00Z", training_mode_session_id: "session-a", fluid_ml: 250, sodium_mg: 300 },
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T09:30:00Z", training_mode_session_id: "session-a", carbs_g: 30 },
      { user_id: "athlete-a", type: "fuel", logged_at: "2026-08-09T10:30:00Z" }
    ],
    sessions: [{
      id: "session-a",
      user_id: "athlete-a",
      status: "completed",
      started_at: "2026-08-09T08:00:00Z",
      ended_at: "2026-08-09T10:00:00Z"
    }],
    now: new Date("2026-08-09T12:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(result.sessionInsights.find(item => item.id === "average-pre-session-gap").value, "1h 00m");
  assert.equal(result.sessionInsights.find(item => item.id === "average-post-session-gap").value, "30m");
  assert.equal(result.sessionInsights.some(item => item.id === "average-training-carbs-rate"), false);
  assert.ok(result.dayInsights.some(item => item.id === "fuel-moments-today"));
  assert.ok(result.dayInsights.some(item => item.id === "hydration-moments-today"));
});

test("Daily keeps cumulative behaviour milestones without retaining manual Work periods", () => {
  const js = read("athlete-milestones.js");
  const css = read("fuel-beta.css");
  for (const id of ["fuel", "hydration", "sleepy", "ready", "training"]) assert.match(js, new RegExp(`id: "${id}"`));
  for (const label of ["Fuel moments", "Hydration moments", "Sleepy moments", "Ready for the Day", "Training moments"]) assert.match(js, new RegExp(label));
  assert.doesNotMatch(js, /id: "work"|Work moments|Completed work periods/);
  assert.match(js, /beta-cumulative-milestone/);
  assert.match(css, /\.beta-milestone-carousel \{[\s\S]*overflow-x: auto/);
  assert.match(read("fuel-beta.js"), /day streak/);
});

test("Daily and Training use the same continuous white mobile card rhythm", () => {
  const trainingCss = read("training-mode.css");
  assert.match(trainingCss, /body\.beta-mvp #training \{[\s\S]*background: #ffffff;/);
  assert.match(trainingCss, /\.training-mode-section,[\s\S]*padding: 22px 0;[\s\S]*border-bottom:[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/);
  assert.match(trainingCss, /\.training-mode-surface \{[\s\S]*gap: 0;/);
  assert.match(trainingCss, /\.training-mode-action-inputs\.fuel-plan \{ grid-template-columns: repeat\(2/);
});

test("Training removes only the redundant longer-term Training Patterns renderer", () => {
  const js = read("training-mode.js");
  assert.doesNotMatch(js, /trainingInsightsMarkup|Longer-term context|<h2>Training patterns<\/h2>/);
  assert.match(js, /function completedSessionsMarkup/);
  assert.match(js, /Recent Training Summary/);
  assert.match(js, /Recent Training Mode sessions/);
});

test("Daily Training pattern tab is aligned under Hydration", () => {
  const css = read("fuel-beta.css");
  assert.match(css, /\.beta-log-pattern-tabs \[data-log-pattern-type="training"\] \{ grid-column: 2; \}/);
});

test("expected-duration migration is additive and preserves existing RLS and grants", () => {
  const migration = read("supabase/migrations/20260809131811_training_mode_expected_duration.sql");
  assert.match(migration, /alter table public\.fuel_training_mode_sessions/);
  assert.match(migration, /estimated_duration_minutes integer not null default 60/);
  assert.match(migration, /between 15 and 1440/);
  assert.doesNotMatch(migration, /create policy|drop policy|grant |revoke /i);
});

test("Athlete Daily omits Training Context and Today’s Insights without replacements", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  assert.doesNotMatch(html, /id="athleteTodayInsights"|id="trainingFuelAnalysis"/);
  assert.doesNotMatch(js, /function renderTodayInsights/);
  assert.doesNotMatch(html, /athleteYourPatterns/);
  assert.doesNotMatch(js, /athleteYourPatterns/);
});
