const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const domain = require("../fuel-guard-domain.js");
const strava = require("../lib/strava-activity.js");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function fuel(userId, timestamp, extra = {}) {
  return { user_id: userId, logged_at: timestamp, type: "fuel", source: "manual", ...extra };
}

test("Athlete header balances the FG and profile controls and navigation says Daily and Training", () => {
  const html = read("index.html");
  const css = read("fuel-beta.css");
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf('<script src="build-info.js'));
  assert.match(nav, /data-mobile-tab="log"[\s\S]*<span>Daily<\/span>/);
  assert.match(nav, /data-mobile-tab="training"[\s\S]*<span>Training<\/span>/);
  assert.doesNotMatch(nav, /<span>Log<\/span>/);
  assert.match(css, /\.beta-topbar-logo \{[\s\S]*width: 44px;[\s\S]*height: 44px;/);
  assert.match(css, /\.beta-header-settings-button svg \{[\s\S]*width: 27px;[\s\S]*height: 27px;/);
});

test("one Training Mode event remains one ordinary Daily event with session context", () => {
  const session = {
    id: "session-a",
    fuelPresetId: "preset-a",
    fuelCarbsG: 30,
    fuelFluidMl: 0,
    fuelSodiumMg: 0,
    fuelCaffeineMg: 0,
    startedAt: "2026-08-09T08:00:00Z",
    endedAt: "2026-08-09T10:00:00Z"
  };
  const event = domain.applyTrainingEventContext(fuel("athlete-a", "2026-08-09T09:00:00Z"), session, "fuel");
  const history = domain.logsWithDates([event]);
  const summary = domain.trainingSessionIntakeSummary({ session, logs: history });
  const lanes = domain.trainingPatternLanes({ logs: history, sessions: [{ ...session, title: "Long Ride" }], key: "2026-08-09", timeZone: "UTC" });
  assert.equal(history.length, 1);
  assert.equal(summary.eventCount, 1);
  assert.equal(lanes.length, 1);
  assert.equal(lanes[0].events.length, 1);
  assert.equal(lanes[0].events[0].trainingModeSessionId, "session-a");
});

test("Fuel and Hydrate intervals derive combined hourly carbohydrate fluid sodium and caffeine", () => {
  const plan = domain.trainingHourlyPlan({
    fuelPreset: { carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 20 },
    hydrationPreset: { carbsG: 10, fluidMl: 250, sodiumMg: 300, caffeineMg: 0 },
    fuelIntervalMinutes: 30,
    hydrationIntervalMinutes: 20
  });
  assert.deepEqual(plan.derived, { carbsG: 90, fluidMl: 750, sodiumMg: 900, caffeineMg: 40 });
  assert.deepEqual(plan.effective, plan.derived);
  assert.equal(plan.source, "derived");
});

test("advanced hourly targets override derived values only when explicitly enabled", () => {
  const plan = domain.trainingHourlyPlan({
    fuelPreset: { carbsG: 30 },
    hydrationPreset: { fluidMl: 250 },
    fuelIntervalMinutes: 30,
    hydrationIntervalMinutes: 30,
    advancedPlan: { carbsG: 75, fluidMl: 650, sodiumMg: 500, caffeineMg: 25 },
    useAdvancedPlan: true
  });
  assert.deepEqual(plan.effective, { carbsG: 75, fluidMl: 650, sodiumMg: 500, caffeineMg: 25 });
  assert.equal(plan.source, "advanced");
});

test("Training measurement presentation uses normal nearest-whole-number rounding", () => {
  assert.equal(domain.wholeMeasurement(15254.2, "mg/h"), "15,254mg/h");
  assert.equal(domain.wholeMeasurement(15254.7, "mg/h"), "15,255mg/h");
  assert.equal(domain.wholeMeasurement(-1.6, "g"), "-2g");
});

test("Milestones and Your Patterns now occupy the bottom of Daily instead of Settings", () => {
  const html = read("index.html");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="training"'));
  const settings = html.slice(html.indexOf('<section id="checklist"'), html.indexOf('</main>'));
  assert.ok(dashboard.indexOf('id="fuelLogPatterns"') < dashboard.indexOf('id="athleteYourPatterns"'));
  assert.ok(dashboard.indexOf('id="athleteYourPatterns"') < dashboard.indexOf('id="athleteMilestones"'));
  assert.doesNotMatch(settings, /id="athleteMilestones"/);
});

test("Training Today’s Patterns keeps multiple sessions in separate lanes", () => {
  const logs = [
    fuel("athlete-a", "2026-08-09T08:30:00Z", { training_mode_session_id: "morning" }),
    { user_id: "athlete-a", logged_at: "2026-08-09T09:00:00Z", type: "hydration", training_mode_session_id: "morning" },
    fuel("athlete-a", "2026-08-09T18:30:00Z", { training_mode_session_id: "evening" })
  ];
  const lanes = domain.trainingPatternLanes({
    logs,
    key: "2026-08-09",
    timeZone: "UTC",
    sessions: [
      { id: "morning", title: "Morning Run", started_at: "2026-08-09T08:00:00Z", ended_at: "2026-08-09T09:30:00Z" },
      { id: "evening", title: "Evening Ride", started_at: "2026-08-09T18:00:00Z", ended_at: "2026-08-09T20:00:00Z" }
    ]
  });
  assert.deepEqual(lanes.map(lane => lane.session.title), ["Morning Run", "Evening Ride"]);
  assert.deepEqual(lanes.map(lane => lane.events.length), [2, 1]);
});

test("Your Patterns thresholds average interval and recurring gap observations", () => {
  const logs = [
    fuel("athlete-a", "2026-08-01T08:00:00Z"), fuel("athlete-a", "2026-08-01T14:00:00Z"),
    fuel("athlete-a", "2026-08-02T08:00:00Z"), fuel("athlete-a", "2026-08-02T14:00:00Z"),
    fuel("athlete-a", "2026-08-03T08:00:00Z"), fuel("athlete-a", "2026-08-03T12:00:00Z")
  ];
  const result = domain.behaviouralPatternInsights({ logs, timeZone: "UTC" });
  assert.equal(result.insights.find(item => item.id === "average-fuel-interval").value, "5h 20m");
  assert.equal(result.insights.find(item => item.id === "recurring-gap-window").sampleCount, 2);
});

test("Your Patterns training-day, Sleepy and post-training observations require real samples", () => {
  const logs = [
    fuel("athlete-a", "2026-08-01T07:00:00Z"), fuel("athlete-a", "2026-08-01T13:00:00Z"),
    fuel("athlete-a", "2026-08-02T07:00:00Z"), fuel("athlete-a", "2026-08-02T13:00:00Z"),
    fuel("athlete-a", "2026-08-03T08:00:00Z"), fuel("athlete-a", "2026-08-03T10:00:00Z"),
    fuel("athlete-a", "2026-08-04T08:00:00Z"), fuel("athlete-a", "2026-08-04T10:00:00Z"),
    fuel("athlete-a", "2026-08-01T16:00:00Z", { notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}' }),
    fuel("athlete-a", "2026-08-02T16:30:00Z", { notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}' }),
    fuel("athlete-a", "2026-08-03T13:30:00Z", { notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}' }),
    fuel("athlete-a", "2026-08-01T15:00:00Z"), fuel("athlete-a", "2026-08-02T15:00:00Z"), fuel("athlete-a", "2026-08-05T11:00:00Z")
  ];
  const sessions = [
    { id: "s1", user_id: "athlete-a", status: "completed", started_at: "2026-08-01T08:00:00Z", ended_at: "2026-08-01T12:00:00Z" },
    { id: "s2", user_id: "athlete-a", status: "completed", started_at: "2026-08-02T08:00:00Z", ended_at: "2026-08-02T12:00:00Z" },
    { id: "s3", user_id: "athlete-a", status: "completed", started_at: "2026-08-05T08:00:00Z", ended_at: "2026-08-05T10:00:00Z" }
  ];
  const insights = domain.behaviouralPatternInsights({ logs, sessions, timeZone: "UTC" }).insights;
  assert.ok(insights.some(item => item.id === "training-day-comparison"));
  assert.ok(insights.some(item => item.id === "sleepy-after-long-gap"));
  assert.equal(insights.find(item => item.id === "post-training-fuel").value, "100%");
  assert.equal(domain.behaviouralPatternInsights({ logs: logs.slice(0, 2), sessions: [], timeZone: "UTC" }).insights.length, 0);
});

test("canonical activity model accepts Strava and deduplicates equivalent Garmin context", () => {
  const mapped = strava.canonicalActivityFromStrava({
    id: 42,
    name: "Morning Run",
    sport_type: "Run",
    start_date: "2026-08-09T08:00:45Z",
    elapsed_time: 3650
  }, "athlete-a");
  assert.equal(mapped.source, "strava");
  assert.equal(mapped.sourceActivityId, "42");
  const activities = domain.normalizeWorkouts([
    { user_id: "athlete-a", source: "garmin", source_activity_id: "g-42", activity_type: "running", started_at: "2026-08-09T08:00:00Z", duration_seconds: 3600 },
    mapped
  ]);
  assert.equal(activities.length, 1);
});

test("provider-neutral activity dedupe never crosses athlete boundaries", () => {
  const activities = domain.normalizeWorkouts([
    { user_id: "athlete-a", source: "garmin", source_activity_id: "g-42", activity_type: "run", started_at: "2026-08-09T08:00:00Z", duration_seconds: 3600 },
    { user_id: "athlete-b", source: "strava", source_activity_id: "s-42", activity_type: "run", started_at: "2026-08-09T08:00:30Z", duration_seconds: 3610 }
  ]);
  assert.equal(activities.length, 2);
});

test("Coach Training Fuel loads direct athlete sessions and renders all four quantities", () => {
  const coach = read("coach/coach-beta.js");
  const migration = read("supabase/migrations/20260809115615_training_mode_coach_integration.sql");
  assert.match(coach, /trainingModeSessions: "fuel_training_mode_sessions"/);
  assert.match(coach, /<h2>Training Fuel<\/h2>/);
  assert.match(coach, /workoutTitle\(\{ type: session\.sessionType \}\)/);
  for (const label of ["Carbohydrate", "Fluid", "Sodium", "Caffeine"]) assert.match(coach, new RegExp(label));
  assert.match(coach, /Pre-training fuel/);
  assert.match(coach, /Post-training fuel/);
  assert.match(migration, /private\.fuel_has_direct_athlete_access\(user_id\)/);
  assert.match(migration, /for select[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)/i);
});

test("activity documentation preserves the acute endurance measurement boundary", () => {
  const document = read("docs/FUEL_GUARD_ACTIVITY_MODEL.md");
  assert.match(document, /carbohydrate, fluid, sodium and caffeine/);
  assert.match(document, /Protein and fat are not collected/);
  assert.match(document, /OAuth, webhook subscription and token storage are deliberately not activated/);
});
