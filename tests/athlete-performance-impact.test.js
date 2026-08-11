const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function impactTestApi() {
  const window = { FuelGuardDomain: domain, addEventListener() {} };
  const document = { addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };
  const context = { window, document, requestAnimationFrame(callback) { callback(); }, globalThis: {} };
  vm.runInNewContext(read("athlete-impact.js"), context);
  return window.AthleteImpact._test;
}

function result(metricId, observedOn, value) {
  return { metric_id: metricId, observed_on: observedOn, value, source: "athlete_entry" };
}

function datedLog(day, hour, type = "fuel") {
  return { timestamp: `${day}T${String(hour).padStart(2, "0")}:00:00Z`, type, source: "manual" };
}

function feedback(day, energy, completion) {
  return {
    session_ended_at: `${day}T11:00:00Z`,
    energy_rating: energy,
    session_completion: completion,
    source: "athlete_entry"
  };
}

function workout(id, day) {
  return { id, source: "training_mode", type: "run", startAt: `${day}T09:00:00Z`, endAt: `${day}T10:00:00Z` };
}

test("Impact comparison uses exact first-14 and last-14 windows in a 42-day report", () => {
  const period = domain.impactComparisonPeriod({
    range: "six_weeks",
    now: new Date("2026-08-10T12:00:00Z"),
    timeZone: "UTC",
    firstEvidenceAt: "2026-06-30T08:00:00Z"
  });
  assert.equal(period.startKey, "2026-06-30");
  assert.equal(period.endKey, "2026-08-10");
  assert.deepEqual([period.baseline.startKey, period.baseline.endKey], ["2026-06-30", "2026-07-13"]);
  assert.deepEqual([period.current.startKey, period.current.endKey], ["2026-07-28", "2026-08-10"]);
  assert.equal(period.totalDays, 42);
  assert.equal(period.comparable, true);
});

test("Impact remains non-comparable when first evidence does not cover the baseline window", () => {
  const period = domain.impactComparisonPeriod({
    range: "since_first_evidence",
    now: new Date("2026-08-10T12:00:00Z"),
    timeZone: "UTC",
    firstEvidenceAt: "2026-08-01T08:00:00Z"
  });
  assert.equal(period.comparable, false);
  assert.equal(period.baseline.endKey, "2026-08-10");
  assert.equal(period.current.startKey, "2026-08-01");
});

test("completed workouts can establish the first evidence date", () => {
  const first = domain.earliestImpactEvidence({ workouts: [workout("first", "2026-07-03")] });
  assert.equal(first.toISOString(), "2026-07-03T10:00:00.000Z");
});

test("lower-is-better, higher-is-better and target-range outcomes use visible direction rules", () => {
  const lower = domain.performanceOutcomeChange(
    { id: "5k", direction: "lower" },
    [result("5k", "2026-06-01", 1720), result("5k", "2026-07-01", 1671)]
  );
  const higher = domain.performanceOutcomeChange(
    { id: "ftp", direction: "higher" },
    [result("ftp", "2026-06-01", 240), result("ftp", "2026-07-01", 255)]
  );
  const range = domain.performanceOutcomeChange(
    { id: "target", direction: "target_range", target_min: 68, target_max: 72 },
    [result("target", "2026-06-01", 80), result("target", "2026-07-01", 73)]
  );
  assert.equal(lower.direction, "improved");
  assert.equal(higher.direction, "improved");
  assert.equal(range.direction, "improved");
});

test("outcome comparison requires two results separated by at least 14 days", () => {
  const one = domain.performanceOutcomeChange({ id: "one", direction: "higher" }, [result("one", "2026-07-01", 10)]);
  const close = domain.performanceOutcomeChange({ id: "close", direction: "higher" }, [result("close", "2026-07-01", 10), result("close", "2026-07-10", 11)]);
  assert.equal(one.direction, "insufficient");
  assert.equal(close.direction, "insufficient");
  assert.equal(close.separationDays, 9);
});

test("small outcome movement stays stable inside the documented one-percent band", () => {
  const change = domain.performanceOutcomeChange(
    { id: "stable", direction: "higher" },
    [result("stable", "2026-06-01", 100), result("stable", "2026-07-01", 100.5)]
  );
  assert.equal(change.direction, "stable");
});

test("window metrics derive coverage, same-day gaps, training context and feedback from real events", () => {
  const period = domain.periodFromKeys("2026-06-30", "2026-07-13", "impact_baseline", "UTC");
  const logs = [
    datedLog("2026-06-30", 7), datedLog("2026-06-30", 11), datedLog("2026-06-30", 12, "hydration"),
    datedLog("2026-07-01", 8), datedLog("2026-07-01", 10),
    datedLog("2026-07-02", 8), datedLog("2026-07-02", 10),
    datedLog("2026-07-03", 8), datedLog("2026-07-03", 10),
    datedLog("2026-07-04", 8), datedLog("2026-07-04", 10),
    datedLog("2026-07-05", 8), datedLog("2026-07-05", 10),
    datedLog("2026-07-06", 8), datedLog("2026-07-06", 10),
    datedLog("2026-07-07", 8), datedLog("2026-07-07", 10),
    datedLog("2026-07-08", 8), datedLog("2026-07-08", 10),
    datedLog("2026-07-09", 8), datedLog("2026-07-09", 10)
  ];
  const workouts = [workout("a", "2026-07-01"), workout("b", "2026-07-02"), workout("c", "2026-07-03")];
  const responses = [feedback("2026-07-01", "low_energy", "no"), feedback("2026-07-02", "normal", "yes"), feedback("2026-07-03", "strong", "yes")];
  const metrics = domain.impactWindowMetrics({ logs, workouts, feedback: responses, targetMinutes: 180, period, timeZone: "UTC" });
  assert.equal(Math.round(metrics.fuelCoveragePct), 71);
  assert.equal(Math.round(metrics.hydrationCoveragePct), 7);
  assert.equal(metrics.measurableGapDays, 10);
  assert.equal(metrics.sessionCount, 3);
  assert.equal(Math.round(metrics.lowEnergyPct), 33);
  assert.equal(Math.round(metrics.completedAsPlannedPct), 67);
});

test("six-week report classifies visible improvements without a black-box score", () => {
  const logs = [];
  const workouts = [];
  const responses = [];
  const baselineDays = ["2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06"];
  const currentDays = ["2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09", "2026-08-10"];
  baselineDays.forEach((day, index) => {
    logs.push(datedLog(day, 6), datedLog(day, index < 5 ? 11 : 8));
    if (index < 3) {
      workouts.push(workout(`base-${index}`, day));
      responses.push(feedback(day, "low_energy", "no"));
    }
  });
  currentDays.forEach((day, index) => {
    logs.push(datedLog(day, 7), datedLog(day, 9), datedLog(day, 10, "hydration"), datedLog(day, 11));
    if (index < 3) {
      workouts.push(workout(`current-${index}`, day));
      responses.push(feedback(day, index ? "strong" : "normal", "yes"));
    }
  });
  const metrics = [
    { id: "5k", name: "5K time", unit: "time", measurement_type: "duration_seconds", direction: "lower", display_order: 1 }
  ];
  const report = domain.buildAthleteImpactReport({
    metrics,
    results: [result("5k", "2026-06-30", 1720), result("5k", "2026-08-05", 1671)],
    logs,
    workouts,
    feedback: responses,
    targets: { maximumFuelGapMinutes: 180 },
    now: new Date("2026-08-10T12:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(report.components.behavior.id, "strong_improvement");
  assert.equal(report.components.trainingExperience.id, "strong_improvement");
  assert.equal(report.components.performanceOutcomes.id, "improving");
  assert.equal(report.overall.id, "strong_positive");
  assert.equal(Object.hasOwn(report.overall, "score"), false);
  assert.match(report.summary, /during the same period/i);
  assert.match(report.summary, /not evidence.*caused/i);
});

test("report is honestly insufficient when evidence and samples are sparse", () => {
  const report = domain.buildAthleteImpactReport({
    metrics: [{ id: "metric", name: "Test", unit: "level", direction: "higher", display_order: 1 }],
    results: [result("metric", "2026-08-08", 1)],
    logs: [datedLog("2026-08-08", 9)],
    now: new Date("2026-08-10T12:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(report.overall.id, "insufficient");
  assert.match(report.summary, /building your baseline/i);
});

test("old outcome results do not imply change inside a newer report period", () => {
  const report = domain.buildAthleteImpactReport({
    metrics: [{ id: "metric", name: "Test", unit: "level", direction: "higher", display_order: 1 }],
    results: [result("metric", "2025-01-01", 1), result("metric", "2025-02-01", 2)],
    logs: [datedLog("2026-07-01", 9), datedLog("2026-08-10", 9)],
    now: new Date("2026-08-10T12:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(report.outcomes[0].direction, "insufficient");
});

test("component and overall rules remain transparent count-based classifications", () => {
  const component = domain.impactComponentStatus([
    { direction: "improved" }, { direction: "improved" }, { direction: "stable" }
  ]);
  const overall = domain.overallImpactStatus([
    component,
    { id: "improving" },
    { id: "stable" }
  ]);
  assert.equal(component.id, "strong_improvement");
  assert.equal(component.improved, 2);
  assert.equal(overall.id, "strong_positive");
});

test("canonical Athlete UI adds one mobile Reflection surface without overloading Daily", () => {
  const html = read("index.html");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="training"'));
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf('<script src="build-info.js'));
  assert.match(html, /id="impact" class="screen"/);
  assert.match(html, /id="athleteImpactSurface"/);
  assert.match(nav, /<span>Reflection<\/span>/);
  assert.match(nav, /data-mobile-screen="dashboard"[\s\S]*data-mobile-screen="training"[\s\S]*data-mobile-screen="impact"/);
  assert.doesNotMatch(dashboard, /performance result|six-week impact|post-training feedback/i);
});

test("completed Training Mode sessions, not session starts, open the feedback flow", () => {
  const training = read("training-mode.js");
  const startBody = training.slice(training.indexOf("async function startSession"), training.indexOf("async function endSession"));
  const endBody = training.slice(training.indexOf("async function endSession"), training.indexOf("function presetRow"));
  assert.doesNotMatch(startBody, /fuelguard:training-session-ended/);
  assert.match(endBody, /fuelguard:training-session-ended/);
  assert.match(endBody, /session: \{ \.\.\.active \}/);
});

test("Reflection separates the universal Everyday baseline from optional performance outcomes", () => {
  const js = read("athlete-impact.js");
  const everyday = read("athlete-everyday-reflection.js");
  assert.match(js, /Start your Performance Reflection/);
  assert.match(js, /Set performance baseline/);
  assert.match(js, /FuelGuardEverydayReflection/);
  assert.match(everyday, /Meal prep organisation/);
  assert.match(everyday, /Healthy snacking ability/);
  assert.match(everyday, /Work mood & energy/);
  assert.match(everyday, /Training energy/);
  assert.match(js, /Sport & training/);
  assert.match(js, /5K time/);
  assert.match(js, /Yo-Yo test/);
  assert.match(js, /Create a custom outcome/);
  assert.match(js, /metrics\.length >= 3/);
});

test("Reflection separates athlete-entered outcomes from Fuel Guard evidence and avoids causal claims", () => {
  const js = read("athlete-impact.js");
  assert.match(js, /Entered by you/);
  assert.match(js, /Fuel Guard evidence/);
  assert.match(js, /They do not show that Fuel Guard or fuelling caused an external outcome/);
  assert.doesNotMatch(js, /Fuel Guard (made|caused|improved) your/i);
});

test("Impact reports a missing PostgREST schema release truthfully and preserves genuine errors", () => {
  const api = impactTestApi();
  const missing = api.impactLoadErrorMessage({ code: "PGRST205", message: "Could not find the table public.fuel_performance_metrics in the schema cache" });
  assert.match(missing, /needs the current database release/);
  assert.match(missing, /required private outcome tables are not available/);
  assert.match(missing, /existing Fuel Guard data is unaffected/);
  assert.equal(api.impactLoadErrorMessage({ code: "42501", message: "row-level security denied access" }), "row-level security denied access");
});

test("Impact client table names exactly match the reproducible accepted migration", () => {
  const js = read("athlete-impact.js");
  const sql = read("supabase/migrations/20260810130122_athlete_performance_impact.sql");
  for (const table of ["fuel_performance_metrics", "fuel_performance_results", "fuel_training_feedback"]) {
    assert.match(js, new RegExp(`"${table}"`));
    assert.match(sql, new RegExp(`create table public\\.${table}`));
  }
  assert.doesNotMatch(js, /catch[\s\S]{0,300}metrics:\s*\[\][\s\S]{0,300}error:\s*""/);
});

test("migration is additive, explicitly granted, owner-RLS protected and capped at three active slots", () => {
  const sql = read("supabase/migrations/20260810130122_athlete_performance_impact.sql");
  const guardFix = read("supabase/migrations/20260810131931_athlete_performance_impact_trigger_fix.sql");
  const advisorFix = read("supabase/migrations/20260810132149_athlete_performance_impact_advisor_hardening.sql");
  for (const table of ["fuel_performance_metrics", "fuel_performance_results", "fuel_training_feedback"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.match(sql, /display_order between 1 and 3/);
  assert.match(sql, /unique index fuel_performance_metrics_active_slot_idx[\s\S]*where archived_at is null/);
  assert.match(sql, /Performance result identity is immutable/);
  assert.match(sql, /if tg_table_name = 'fuel_performance_metrics' then/);
  assert.match(guardFix, /if tg_table_name = 'fuel_performance_results' then/);
  assert.match(guardFix, /if new\.training_mode_session_id is not null then/);
  assert.match(advisorFix, /fuel_performance_results \(metric_id, user_id\)/);
  assert.match(advisorFix, /fuel_training_feedback \(training_mode_session_id, user_id\)/);
  assert.doesNotMatch(sql, /drop table|truncate/i);
  assert.doesNotMatch(guardFix, /drop table|truncate/i);
  assert.doesNotMatch(advisorFix, /drop table|truncate/i);
});

test("Phase 1 does not widen Coach or organisation access to private impact records", () => {
  const sql = read("supabase/migrations/20260810130122_athlete_performance_impact.sql");
  assert.doesNotMatch(sql, /fuel_has_direct_athlete_access|fuel_performance_can_access_athlete|fuel_organisation/);
  assert.match(sql, /Coach\/organisation visibility is deliberately deferred to Phase 2/);
});

test("Impact clears athlete-owned client state on identity changes and ignores stale responses", () => {
  const js = read("athlete-impact.js");
  const reset = js.slice(js.indexOf("function resetImpactIdentity"), js.indexOf("function domain"));
  const load = js.slice(js.indexOf("async function load"), js.indexOf("async function saveMetric"));
  for (const field of ["metrics", "results", "feedback", "trainingSessions", "garminActivities"]) {
    assert.match(reset, new RegExp(`${field}: \\[\\]`));
  }
  assert.match(load, /impactState\.userId !== userId[\s\S]*resetImpactIdentity\(userId\)[\s\S]*render\(\)/);
  assert.ok((load.match(/if \(impactState\.userId !== userId\) return;/g) || []).length >= 2);
});

test("PWA shell versions and caches the new Impact assets", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  const build = read("build-info.js");
  for (const source of [html, sw, build]) assert.match(source, /mobile-pwa-v139-athlete-system/);
  assert.match(sw, /athlete-impact\.css/);
  assert.match(sw, /athlete-impact\.js/);
  assert.match(html, /athlete-impact\.js\?v=mobile-pwa-v139-athlete-system/);
});

test("methodology records baseline, sample thresholds and Garmin Phase 2 boundary", () => {
  const docs = read("docs/ATHLETE_PERFORMANCE_IMPACT_PHASE1.md");
  assert.match(docs, /earliest dated result.*Baseline/i);
  assert.match(docs, /days 1–14.*days 29–42/i);
  assert.match(docs, /at least five measurable days/i);
  assert.match(docs, /at least three completed sessions/i);
  assert.match(docs, /Phase 2 Garmin-derived/i);
});
