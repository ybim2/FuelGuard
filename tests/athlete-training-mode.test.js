const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadState(saved) {
  const storage = new Map(saved ? [["fuelGuardStateV20", JSON.stringify(saved)]] : []);
  const sandbox = {
    console,
    Date,
    Intl,
    crypto: { randomUUID: () => "10000000-1000-4000-8000-100000000001" },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    }
  };
  vm.runInNewContext(read("app-state.js"), sandbox, { filename: "app-state.js" });
  return { sandbox, storage };
}

test("Day Type survives refresh and Normal remains an explicit clear state", () => {
  const first = loadState();
  const gap = first.sandbox.fuelGapState();
  domain.applyDayTypeOverride(gap.dayTypes, "2026-08-09", "holiday");
  first.sandbox.save();
  const holidayRefresh = loadState(JSON.parse(first.storage.get("fuelGuardStateV20")));
  assert.equal(holidayRefresh.sandbox.fuelGapState().dayTypes["2026-08-09"], "holiday");
  domain.applyDayTypeOverride(holidayRefresh.sandbox.fuelGapState().dayTypes, "2026-08-09", "");
  holidayRefresh.sandbox.save();
  const normalRefresh = loadState(JSON.parse(holidayRefresh.storage.get("fuelGuardStateV20")));
  assert.equal(Object.hasOwn(normalRefresh.sandbox.fuelGapState().dayTypes, "2026-08-09"), false);
});

test("Training presets accept only carbs g fluid ml sodium mg and caffeine mg", () => {
  const valid = domain.validateTrainingPreset({ carbsG: 30, fluidMl: 200, sodiumMg: 250, caffeineMg: 50 });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.preset, { carbsG: 30, fluidMl: 200, sodiumMg: 250, caffeineMg: 50 });
  assert.equal(domain.validateTrainingPreset({ carbsG: -1 }).valid, false);
  assert.equal(domain.validateTrainingPreset({ caffeineMg: 1001 }).valid, false);
  assert.equal(domain.validateTrainingPreset({ carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 }).valid, false);
});

test("Daily Fuel and Hydrate events remain quantity-free without an active session", () => {
  const fuel = domain.applyTrainingEventContext({ type: "fuel", timestamp: "2026-08-09T10:00:00Z" }, null, "fuel");
  const hydration = domain.applyTrainingEventContext({ type: "hydration", timestamp: "2026-08-09T10:00:00Z" }, null, "hydration");
  for (const event of [fuel, hydration]) {
    assert.equal(event.trainingModeSessionId, undefined);
    assert.equal(event.carbsG, undefined);
    assert.equal(event.fluidMl, undefined);
    assert.equal(event.sodiumMg, undefined);
    assert.equal(event.caffeineMg, undefined);
  }
});

test("Training Fuel and Hydrate use their independent configured presets", () => {
  const session = {
    id: "session-a",
    fuelPresetId: "fuel-a",
    hydrationPresetId: "hydrate-a",
    fuelCarbsG: 30,
    fuelFluidMl: 0,
    fuelSodiumMg: 0,
    fuelCaffeineMg: 0,
    hydrationCarbsG: 0,
    hydrationFluidMl: 200,
    hydrationSodiumMg: 250,
    hydrationCaffeineMg: 0
  };
  assert.deepEqual(domain.trainingEventContext(session, "fuel"), {
    trainingModeSessionId: "session-a",
    trainingModePresetId: "fuel-a",
    carbsG: 30,
    fluidMl: 0,
    sodiumMg: 0,
    caffeineMg: 0
  });
  assert.deepEqual(domain.trainingEventContext(session, "hydration"), {
    trainingModeSessionId: "session-a",
    trainingModePresetId: "hydrate-a",
    carbsG: 0,
    fluidMl: 200,
    sodiumMg: 250,
    caffeineMg: 0
  });
});

test("Training session totals and per-hour rates use elapsed duration", () => {
  const session = { id: "session-a", startedAt: "2026-08-09T08:00:00Z", endedAt: "2026-08-09T10:00:00Z" };
  const logs = [
    { type: "fuel", timestamp: "2026-08-09T08:30:00Z", trainingModeSessionId: "session-a", carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 },
    { type: "hydration", timestamp: "2026-08-09T09:00:00Z", trainingModeSessionId: "session-a", carbsG: 0, fluidMl: 200, sodiumMg: 250, caffeineMg: 0 },
    { type: "fuel", timestamp: "2026-08-09T09:30:00Z", trainingModeSessionId: "session-a", carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 100 },
    { type: "fuel", timestamp: "2026-08-09T09:45:00Z", trainingModeSessionId: "other", carbsG: 999, fluidMl: 999, sodiumMg: 999, caffeineMg: 999 }
  ];
  const summary = domain.trainingSessionIntakeSummary({ session, logs });
  assert.equal(summary.durationSeconds, 7200);
  assert.equal(summary.eventCount, 3);
  assert.deepEqual(summary.totals, { carbsG: 60, fluidMl: 200, sodiumMg: 250, caffeineMg: 100 });
  assert.deepEqual(summary.perHour, { carbsG: 30, fluidMl: 100, sodiumMg: 125, caffeineMg: 50 });
});

test("completed Training rates require a valid duration and logged session data", () => {
  const accidental = domain.completedTrainingSessionMetrics({
    session: { id: "short", status: "completed", startedAt: "2026-08-09T08:00:00Z", endedAt: "2026-08-09T08:00:12Z" },
    logs: [{ type: "fuel", timestamp: "2026-08-09T08:00:06Z", trainingModeSessionId: "short", carbsG: 30 }]
  });
  assert.equal(accidental.totals.carbsG, 30);
  assert.equal(accidental.perHour.carbsG, 9000);
  assert.equal(accidental.validDuration, false);
  assert.equal(accidental.validLoggedIntake, false);
  assert.equal(accidental.actualPerHour.carbsG, null);

  const empty = domain.completedTrainingSessionMetrics({
    session: { id: "empty", status: "completed", startedAt: "2026-08-09T08:00:00Z", endedAt: "2026-08-09T09:00:00Z" },
    logs: []
  });
  assert.equal(empty.validDuration, true);
  assert.equal(empty.validLoggedIntake, false);
  assert.equal(empty.actualPerHour.fluidMl, null);
});

test("recent Training summary uses simple per-session averages without incomplete extrapolation", () => {
  const sessions = [
    { id: "one", status: "completed", startedAt: "2026-08-09T08:00:00Z", endedAt: "2026-08-09T09:00:00Z" },
    { id: "two", status: "completed", startedAt: "2026-08-08T08:00:00Z", endedAt: "2026-08-08T10:00:00Z" },
    { id: "short", status: "completed", startedAt: "2026-08-07T08:00:00Z", endedAt: "2026-08-07T08:05:00Z" }
  ];
  const logs = [
    { trainingModeSessionId: "one", type: "fuel", timestamp: "2026-08-09T08:30:00Z", carbsG: 60, fluidMl: 1000 },
    { trainingModeSessionId: "two", type: "fuel", timestamp: "2026-08-08T09:00:00Z", carbsG: 60, fluidMl: 2000 },
    { trainingModeSessionId: "short", type: "fuel", timestamp: "2026-08-07T08:02:00Z", carbsG: 900, fluidMl: 9000 }
  ];
  const result = domain.completedTrainingSessionAverages({ sessions, logs });
  assert.equal(result.sessionCount, 3);
  assert.equal(result.validDurationCount, 2);
  assert.equal(result.validIntakeCount, 2);
  assert.deepEqual(result.averages, {
    carbsGPerSession: 60,
    carbsGPerHour: 45,
    fluidMlPerSession: 1500,
    durationSeconds: 5400
  });
});

test("recent Training UI shows local start/end times, separate rates, and compact fluid units", () => {
  const js = read("training-mode.js");
  assert.match(js, /formatClock\(startedAt\).*formatClock\(endedAt\).*local/s);
  assert.match(js, /Number\.isFinite\(actualRate\).*Actual rate<strong>/s);
  assert.match(js, /Planned rate<strong>/);
  assert.match(js, /amount >= 1000[\s\S]*amount \/ 1000[\s\S]*L/);
  assert.match(js, /Recent Training Summary/);
  assert.match(js, /Average carbs per session/);
  assert.match(js, /Average carbs\/hour per session/);
  assert.match(js, /Average fluid per session/);
  assert.match(js, /Average session duration/);
  assert.doesNotMatch(js.slice(js.indexOf("function completedSessionsMarkup")), /on plan|behind|ahead/);
});

test("plan progress reports the athlete's execution as behind on or ahead", () => {
  const summary = {
    durationSeconds: 7200,
    totals: { carbsG: 100, fluidMl: 1000, sodiumMg: 1250, caffeineMg: 0 }
  };
  const progress = domain.trainingPlanProgress(summary, { carbsG: 60, fluidMl: 500, sodiumMg: 600, caffeineMg: 0 });
  assert.equal(progress.carbsG.state, "behind");
  assert.equal(progress.fluidMl.state, "on_plan");
  assert.equal(progress.sodiumMg.state, "on_plan");
  assert.equal(progress.caffeineMg.state, "unplanned");
});

test("completed sessions use their ended timestamp and remain reviewable", () => {
  const session = { id: "ended", status: "completed", startedAt: "2026-08-09T08:00:00Z", endedAt: "2026-08-09T09:42:18Z" };
  const summary = domain.trainingSessionIntakeSummary({ session, logs: [], now: new Date("2026-08-10T00:00:00Z") });
  assert.equal(summary.durationSeconds, 6138);
});

test("active Training Mode session and presets survive app-state refresh", () => {
  const first = loadState();
  const training = first.sandbox.fuelGapState().trainingMode;
  training.activeSession = { id: "active-a", status: "active", startedAt: "2026-08-09T08:00:00Z", endedAt: null };
  training.sessions = [training.activeSession];
  training.presets.fuel = { id: "preset-a", carbsG: 35, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 };
  training.estimatedDurationMinutes = 150;
  first.sandbox.save();
  const refreshed = loadState(JSON.parse(first.storage.get("fuelGuardStateV20")));
  assert.equal(refreshed.sandbox.fuelGapState().trainingMode.activeSession.id, "active-a");
  assert.equal(refreshed.sandbox.fuelGapState().trainingMode.presets.fuel.carbsG, 35);
  assert.equal(refreshed.sandbox.fuelGapState().trainingMode.estimatedDurationMinutes, 150);
});

test("historical quantity-free events remain compatible", () => {
  const historical = domain.normalizeLog({ id: "old", logged_at: "2026-08-01T09:00:00Z", type: "fuel", source: "manual" });
  assert.equal(historical.type, "fuel");
  assert.equal(historical.trainingModeSessionId, "");
  assert.equal(historical.carbsG, null);
});

test("Training sessions remain associated with strict pre and post context", () => {
  const workout = { id: "training-mode-a", athleteId: "athlete-a", startAt: "2026-08-09T08:00:00Z", endAt: "2026-08-09T10:00:00Z" };
  const context = domain.getWorkoutFuelContext(workout, [
    { user_id: "athlete-a", logged_at: "2026-08-09T07:00:00Z", type: "fuel" },
    { user_id: "athlete-a", logged_at: "2026-08-09T08:30:00Z", type: "fuel", training_mode_session_id: "training-mode-a", carbs_g: 30 },
    { user_id: "athlete-a", logged_at: "2026-08-09T10:30:00Z", type: "fuel" }
  ]);
  assert.equal(context.preFuelGapMinutes, 60);
  assert.equal(context.postFuelGapMinutes, 30);
});

test("Training remains directly beside Daily and Impact opens a dedicated surface", () => {
  const html = read("index.html");
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf('<script src="build-info.js'));
  assert.ok(nav.indexOf('data-mobile-tab="log"') < nav.indexOf('data-mobile-tab="training"'));
  assert.match(nav, /data-mobile-screen="training"/);
  assert.match(nav, /data-mobile-screen="impact"/);
  assert.match(html, /id="training" class="screen"/);
  assert.match(html, /id="trainingModeSurface"/);
  assert.match(read("app-ui.js"), /"dashboard", "training", "impact", "checklist"/);
  assert.doesNotMatch(html, /<nav class="side-nav beta-nav">/);
});

test("Training UI is one-tap while active and keeps quantity entry in setup", () => {
  const js = read("training-mode.js");
  assert.match(js, /data-training-log="fuel"/);
  assert.match(js, /data-training-log="hydration"/);
  assert.match(js, /data-training-preset/);
  assert.match(js, /End Training Mode/);
  assert.match(js, /Actual totals so far/);
  assert.match(js, /trainingEstimatedDuration/);
  assert.doesNotMatch(js, /Advanced Targets|advancedPlanEnabled|data-training-plan/);
});

test("schema links Training Mode to fuel_logs with user-owned RLS and canonical units", () => {
  const migration = read("supabase/migrations/20260809100532_athlete_training_mode.sql");
  const durationMigration = read("supabase/migrations/20260809131811_training_mode_expected_duration.sql");
  const rls = read("supabase/tests/athlete_training_mode_rls_test.sql");
  for (const column of ["training_mode_session_id", "training_mode_preset_id", "carbs_g", "fluid_ml", "sodium_mg", "caffeine_mg"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /alter table public\.fuel_training_mode_sessions enable row level security/);
  assert.match(migration, /foreign key \(training_mode_session_id, user_id\)/);
  assert.match(rls, /Cross-user Training session direct-ID access is blocked/);
  assert.match(durationMigration, /estimated_duration_minutes integer not null default 60/);
  assert.match(durationMigration, /between 15 and 1440/);
  assert.doesNotMatch(durationMigration, /create policy|grant /i);
  assert.doesNotMatch(migration, /calories|protein|fibre|body_weight|meal_plan/i);
});

test("Athlete header Settings and Coach use the cleaned continuous visual language", () => {
  const athleteCss = read("fuel-beta.css");
  const coachCss = read("coach/coach-beta.css");
  assert.match(athleteCss, /\.beta-topbar-logo \{[\s\S]*position: absolute;[\s\S]*left:/);
  assert.match(athleteCss, /#checklist > \.card \{[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/);
  assert.match(coachCss, /#coachAppShell \.coach-card \{[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/);
});

test("Athlete navigation keeps three usable equal touch targets at 375px", () => {
  const css = read("fuel-beta.css");
  assert.match(css, /body\.beta-mvp \.mobile-bottom-nav \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /mobile-bottom-nav \.mobile-nav-item \{[\s\S]*min-height: calc\(58px/);
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*mobile-bottom-nav \.mobile-nav-item \{ min-width: 0; \}/);
});
