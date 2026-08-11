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
  assert.match(js, /<span>Reflection<\/span><h1>Since using Fuel Guard, what has changed for you\?/);
  assert.doesNotMatch(html + js, /Performance Impact|>Impact<|Impact summary/);
  assert.doesNotMatch(daily, /Later Energy Impact|Impact insights|Impact signals over time|Impact will explain/);
});

test("Reflection starts with everyday life and also offers optional sport outcomes", () => {
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
    "Better training energy",
    "Better recovery",
    "Faster running or race times",
    "Improved strength",
    "Improved endurance",
    "Improved fitness test performance"
  ]) assert.match(js, new RegExp(copy));
  assert.match(js, /Create a custom outcome/);
  assert.match(js, /Set your target range/);
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
  assert.deepEqual(JSON.parse(JSON.stringify(energy)), { label: "+3 improvement", tone: "improved" });
  assert.deepEqual(JSON.parse(JSON.stringify(fiveK)), { label: "1:45 faster", tone: "improved" });
});

test("normal Reflection view is progress-first and editing stays on demand", () => {
  const js = read("athlete-impact.js");
  const mainRender = js.slice(js.indexOf("function render()"), js.indexOf("async function load"));
  assert.match(mainRender, /goalsMarkup\(metrics\)/);
  assert.match(mainRender, /progressMarkup\(metrics\)/);
  assert.match(mainRender, /evidenceMarkup\(report\)/);
  assert.match(mainRender, /editorMarkup\(\)/);
  assert.match(js, /Where were you when you started\?/);
  assert.match(js, /Where are you now\?/);
  for (const action of ["Update current result", "Edit baseline", "Change metric", "Change dates", "Delete reflection"]) assert.match(js, new RegExp(action));
  assert.doesNotMatch(js, /function resultEntryMarkup|function presetSetupMarkup/);
});

test("Fuel Guard behavioural evidence is separate and explicitly non-causal", () => {
  const js = read("athlete-impact.js");
  assert.match(js, /Entered by you/);
  assert.match(js, /Fuel Guard evidence/);
  assert.match(js, /Calculated from recorded activity/);
  assert.match(js, /They do not show that Fuel Guard or fuelling caused an external outcome/);
  assert.doesNotMatch(js, /Fuel Guard (made|caused|improved) your/i);
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
  assert.match(css, /\.reflection-hero,[\s\S]*\.reflection-page-section[\s\S]*background: #fff/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(read("build-info.js"), /mobile-pwa-v137-accepted-integration/);
  assert.match(read("sw.js"), /fuel-guard-mobile-pwa-v137-accepted-integration-20260811T120700Z/);
});
