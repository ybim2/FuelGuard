const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function reflectionApi() {
  const window = { FuelGuardDomain: domain, addEventListener() {}, localStorage: { getItem() { return null; } }, sessionStorage: { getItem() { return null; }, setItem() {} } };
  const document = { hidden: false, addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };
  const context = { window, document, requestAnimationFrame(callback) { callback(); }, globalThis: {}, Intl, Date, setTimeout, clearTimeout };
  vm.runInNewContext(read("athlete-impact.js"), context);
  return window.AthleteImpact._test;
}

test("all Athlete-facing navigation and page terminology is Reflection", () => {
  const html = read("index.html");
  const js = read("athlete-impact.js");
  const daily = read("fuel-beta.js");
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf("</nav>", html.indexOf('<nav class="mobile-bottom-nav')));
  assert.match(nav, /data-mobile-screen="impact"[\s\S]*<span>Reflection<\/span>/);
  assert.match(html, /aria-label="Fuel Guard Reflection"/);
  assert.match(js, /<span>Reflection<\/span><h1>Life first\. Sport second\.<\/h1>/);
  assert.doesNotMatch(html + js, /Performance Impact|>Impact<|Impact summary/);
  assert.doesNotMatch(daily, /Later Energy Impact|Impact insights|Impact signals over time|Impact will explain/);
});

test("Reflection starts with everyday life and offers optional 1–5 performance areas", () => {
  const js = read("athlete-impact.js");
  const life = js.indexOf('life: {');
  const sport = js.indexOf('sport: {');
  assert.ok(life >= 0 && sport > life);
  for (const copy of [
    "Better control of my nutrition",
    "More consistent eating",
    "Fewer long gaps without fuel",
    "Better energy through the day",
    "Fewer crashes",
    "Better hydration",
    "Better mood or concentration",
    "Maintaining or changing body weight",
    "5 km performance",
    "Endurance",
    "Strength",
    "Speed",
    "Recovery",
    "Training consistency",
    "Match fitness",
    "Cycling",
    "Swimming"
  ]) assert.match(js, new RegExp(copy));
  assert.match(js, /Custom area/);
  assert.match(js, /What matters to your performance\?/);
  assert.match(js, /No PB, pace or performance number is needed/);
  assert.doesNotMatch(js.slice(sport, js.indexOf("};", sport)), /requiresTarget|duration_seconds|target_range/);
});

test("baseline and current comparisons render clear numeric and timed changes", () => {
  const api = reflectionApi();
  const energy = api.comparisonChange(
    { direction: "higher", measurement_type: "number", unit: "/ 10" },
    { value: 4 },
    { value: 7 }
  );
  const fiveK = api.comparisonChange(
    { direction: "lower", measurement_type: "duration_seconds", unit: "time" },
    { value: 1720 },
    { value: 1615 }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(energy)), { label: "+3 since baseline", tone: "improved" });
  assert.deepEqual(JSON.parse(JSON.stringify(fiveK)), { label: "1:45 faster since baseline", tone: "improved" });
  assert.deepEqual(JSON.parse(JSON.stringify(api.comparisonChange(
    { direction: "higher", measurement_type: "number", unit: "/ 5" },
    { value: 2 },
    { value: 4 }
  ))), { label: "+2 since your baseline", tone: "improved" });
  assert.deepEqual(JSON.parse(JSON.stringify(api.comparisonChange(
    { direction: "higher", measurement_type: "number", unit: "/ 5" },
    { value: 3 },
    { value: 3 }
  ))), { label: "Holding steady", tone: "stable" });
  assert.deepEqual(JSON.parse(JSON.stringify(api.comparisonChange(
    { direction: "higher", measurement_type: "number", unit: "/ 5" },
    { value: 4 },
    { value: 2 }
  ))), { label: "Below your baseline", tone: "changed" });
});

test("Performance comparison and Journey are direct with no dashboard drill-down", () => {
  const js = read("athlete-impact.js");
  const mainRender = js.slice(js.indexOf("function render()"), js.indexOf("async function load"));
  assert.match(mainRender, /populatedStateMarkup\(metrics\)/);
  assert.match(mainRender, /editorMarkup\(\)/);
  for (const copy of ["How is your performance feeling?", "Your Performance", "Baseline", "Now", "Your Journey", "Check in"]) assert.match(js, new RegExp(copy));
  assert.doesNotMatch(js, /reflection-dashboard-rail|data-reflection-view|Tracked outcomes|Your Baseline Tracked Outcomes/);
  for (const action of ["Edit latest check-in", "Edit baseline", "Change area", "Stop tracking"]) assert.match(js, new RegExp(action));
  assert.doesNotMatch(js, />Change dates<|>Delete reflection</);
});

test("Reflection lifecycle starts with a baseline and makes a review available after fourteen days", () => {
  const api = reflectionApi();
  const metrics = [{ id: "energy" }, { id: "recovery" }];
  const baselineOnly = api.reflectionLifecycle(metrics, new Date("2026-08-14T12:00:00Z"), [
    { metric_id: "energy", observed_on: "2026-08-01", created_at: "2026-08-01T09:00:00Z", value: 5 },
    { metric_id: "recovery", observed_on: "2026-08-01", created_at: "2026-08-01T09:01:00Z", value: 4 }
  ]);
  assert.equal(baselineOnly.baselineReady, true);
  assert.equal(baselineOnly.reviewDue, false);
  assert.equal(baselineOnly.dueOn, "2026-08-15");
  assert.equal(baselineOnly.comparisonCount, 0);

  const due = api.reflectionLifecycle(metrics, new Date("2026-08-15T12:00:00Z"), [
    { metric_id: "energy", observed_on: "2026-08-01", created_at: "2026-08-01T09:00:00Z", value: 5 },
    { metric_id: "recovery", observed_on: "2026-08-01", created_at: "2026-08-01T09:01:00Z", value: 4 }
  ]);
  assert.equal(due.reviewDue, true);

  const reviewed = api.reflectionLifecycle(metrics, new Date("2026-08-16T12:00:00Z"), [
    { metric_id: "energy", observed_on: "2026-08-01", created_at: "2026-08-01T09:00:00Z", value: 5 },
    { metric_id: "recovery", observed_on: "2026-08-01", created_at: "2026-08-01T09:01:00Z", value: 4 },
    { metric_id: "energy", observed_on: "2026-08-15", created_at: "2026-08-15T09:00:00Z", value: 8 },
    { metric_id: "recovery", observed_on: "2026-08-15", created_at: "2026-08-15T09:01:00Z", value: 7 }
  ]);
  assert.equal(reviewed.comparisonCount, 2);
  assert.equal(reviewed.latestReviewOn, "2026-08-15");
  assert.equal(reviewed.dueOn, "2026-08-29");
});

test("subjective Reflection values use ten accessible tap targets and normal entry has no date field", () => {
  const api = reflectionApi();
  const markup = api.ratingScaleMarkup({ name: "Energy", unit: "/ 10", measurement_type: "number" }, 7);
  assert.equal((markup.match(/data-reflection-rating=/g) || []).length, 10);
  assert.match(markup, /aria-label="7 out of 10" aria-pressed="true"/);
  assert.match(markup, /id="reflectionEditorValue" type="hidden" value="7"/);
  const js = read("athlete-impact.js");
  const entry = js.slice(js.indexOf("function editorValueMarkup"), js.indexOf("function editorMarkup"));
  assert.doesNotMatch(entry, /type="date"|reflectionEditorDate/);
  const save = js.slice(js.indexOf("async function saveReflectionValue"), js.indexOf("function customOutcomeFromEditor"));
  assert.match(save, /domain\(\)\.dateKey\(new Date\(\)\)/);
});

test("new Performance Reflection presets use an accessible satisfaction scale", () => {
  const api = reflectionApi();
  const markup = api.ratingScaleMarkup({ name: "Endurance", unit: "/ 5", measurement_type: "number" }, 3);
  assert.equal((markup.match(/data-reflection-rating=/g) || []).length, 5);
  assert.match(markup, /How satisfied are you currently with your endurance\?/);
  assert.match(markup, /1 out of 5 — Not satisfied/);
  assert.match(markup, /3 out of 5 — Okay/);
  assert.match(markup, /5 out of 5 — Very satisfied/);
  assert.equal(api.performanceAreaPhrase("Race confidence"), "race confidence");
  assert.equal(api.performanceAreaPhrase("5 km performance"), "5 km performance");
  assert.ok(api.OUTCOME_GROUPS.sport.outcomes.every(outcome => outcome.unit === "/ 5" && outcome.valueMin === 1 && outcome.valueMax === 5));
});

test("Performance stays a subjective reflection instead of an analytics dashboard", () => {
  const js = read("athlete-impact.js");
  const renderedExperience = js.slice(js.indexOf("function emptyStateMarkup"), js.indexOf("function render"));
  assert.doesNotMatch(renderedExperience, /Fuel Guard evidence|Calculated from recorded activity|fuelling behaviour|PB tracker|watts|VO2/);
  assert.match(renderedExperience, /How satisfied are you currently with your/);
  assert.match(js, /A future check-in will build your comparison/);
  assert.match(js, /Existing history is retained/);
});

test("legacy Training Experience and summary cards are removed without deleting their stored data", () => {
  const js = read("athlete-impact.js");
  assert.doesNotMatch(js, /Training experience|Impact summary|function feedbackMarkup|function componentCard/);
  assert.match(js, /client\.from\(FEEDBACK_TABLE\)\.select/);
  assert.match(js, /client\.from\(METRICS_TABLE\)\.update\(\{ archived_at: archivedAt \}\)/);
  assert.doesNotMatch(js, /from\(METRICS_TABLE\)\.delete|from\(RESULTS_TABLE\)\.delete/);
  const trainingListener = js.slice(js.indexOf('window.addEventListener("fuelguard:training-session-ended"'), js.indexOf('document.addEventListener("visibilitychange"'));
  assert.doesNotMatch(trainingListener, /switchScreen\("impact"\)/);
});

test("Reflection retains the accepted owner-only schema and introduces no migration", () => {
  const js = read("athlete-impact.js");
  for (const table of ["fuel_performance_metrics", "fuel_performance_results", "fuel_training_feedback"]) assert.match(js, new RegExp(`"${table}"`));
  const sql = read("supabase/migrations/20260810130122_athlete_performance_impact.sql");
  assert.match(sql, /fuel_performance_metrics_select_own/);
  assert.match(sql, /fuel_performance_results_update_own/);
  assert.doesNotMatch(sql, /fuel_has_direct_athlete_access|fuel_organisation/);
});

test("Reflection uses the continuous white Athlete surface and a versioned PWA shell", () => {
  const css = read("athlete-impact.css");
  assert.match(css, /body\.beta-mvp #impact[\s\S]*background: #fff/);
  assert.match(css, /\.reflection-performance-shell[\s\S]*border-radius: 26px[\s\S]*background: #fff/);
  assert.match(css, /\.reflection-rating-scale > div[\s\S]*repeat\(5/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(read("build-info.js"), /mobile-pwa-v155-training-nutrition-analytics/);
  assert.match(read("sw.js"), /fuel-guard-mobile-pwa-v155-training-nutrition-analytics-/);
});
