const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const domain = require("../fuel-guard-domain.js");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function session(overrides = {}) {
  return {
    id: "live-session",
    status: "active",
    startedAt: "2026-08-10T08:00:00.000Z",
    endedAt: null,
    fuelIntervalMinutes: 30,
    hydrationIntervalMinutes: 20,
    estimatedDurationMinutes: 120,
    plan: { carbsG: 60, fluidMl: 600, sodiumMg: 750, caffeineMg: 0 },
    ...overrides
  };
}

function log(type, timestamp, quantities = {}) {
  return { type, timestamp, trainingModeSessionId: "live-session", ...quantities };
}

test("Daily restores only the three streak visuals while retaining Profile progression", () => {
  const html = read("index.html");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="training"'));
  const settings = html.slice(html.indexOf('<section id="checklist"'), html.indexOf("</main>"));
  assert.match(dashboard, /id="athleteActivitySummary"/);
  assert.match(dashboard, /id="athleteMilestones"/);
  assert.doesNotMatch(dashboard, /athleteDailyPoints|FG Points|Next Day Streak|reward/);
  assert.match(settings, /id="athletePointsProfile"/);
  assert.match(read("athlete-milestones.js"), /Fuel Guard Progress/);
});

test("Daily keeps Maximum Fuel Gap immediately under Day type and nowhere in Settings", () => {
  const js = read("fuel-beta.js");
  const status = js.slice(js.indexOf("function renderCurrentFuellingStatus"), js.indexOf("function hydrationSuggestionForDay"));
  assert.ok(status.indexOf("beta-day-type-chips") < status.indexOf("beta-maximum-gap-inline"));
  assert.match(status, /Maximum fuel gap/);
  const settings = read("index.html").slice(read("index.html").indexOf('<section id="checklist"'));
  assert.doesNotMatch(settings, /id="maximumFuelGapPreset"|id="maximumFuelGapCustom"/);
});

test("Athlete loading state uses the complete approved purpose copy", () => {
  const html = read("index.html");
  assert.match(html, /Every fuel and hydration moment builds a better fuelling rhythm\./);
  assert.doesNotMatch(html, />Notice the rhythm\.</);
});

test("short active sessions suppress extrapolated pace and projection", () => {
  const result = domain.activeTrainingSessionInsights({
    session: session(),
    logs: [],
    now: new Date("2026-08-10T08:10:00.000Z")
  });
  assert.equal(result.rateReady, false);
  assert.ok(result.insights.some(item => item.id === "rate_evidence"));
  assert.ok(result.insights.some(item => item.id === "fuel_timing" && /No Fuel recorded/.test(item.value)));
  assert.equal(result.insights.some(item => /_pace$|projection/.test(item.id)), false);
});

test("longer active sessions interpret fuel hydration and planned pace from recorded evidence", () => {
  const result = domain.activeTrainingSessionInsights({
    session: session(),
    logs: [
      log("fuel", "2026-08-10T08:30:00.000Z", { carbsG: 30 }),
      log("hydration", "2026-08-10T08:40:00.000Z", { fluidMl: 200, sodiumMg: 250 })
    ],
    now: new Date("2026-08-10T09:00:00.000Z")
  });
  assert.equal(result.rateReady, true);
  assert.ok(result.insights.some(item => item.id === "next_action"));
  assert.ok(result.insights.some(item => item.id === "carbohydrate_pace" && /30g\/h/.test(item.value)));
  assert.ok(result.insights.some(item => item.id === "hydration_pace" && /200ml\/h/.test(item.value)));
  assert.ok(result.insights.every(item => item.detail && !/definitely|did not drink|did not eat/i.test(item.detail)));
});

test("active pace remains useful without a target and projections require adequate evidence", () => {
  const noTarget = domain.activeTrainingSessionInsights({
    session: session({ plan: { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 } }),
    logs: [log("fuel", "2026-08-10T08:30:00.000Z", { carbsG: 30 })],
    now: new Date("2026-08-10T09:00:00.000Z")
  });
  assert.match(noTarget.insights.find(item => item.id === "carbohydrate_pace").detail, /No carbohydrate target/);

  const projected = domain.activeTrainingSessionInsights({
    session: session({ plan: { carbsG: 60, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 } }),
    logs: [log("fuel", "2026-08-10T08:30:00.000Z", { carbsG: 30 })],
    now: new Date("2026-08-10T09:00:00.000Z")
  });
  const projection = projected.insights.find(item => item.id === "carbohydrate_projection");
  assert.ok(projection);
  assert.match(projection.detail, /below the 120g session plan/);
});

test("Training UI separates live interpretations from clearly labelled counting statistics", () => {
  const js = read("training-mode.js");
  assert.match(js, /Useful now[\s\S]*Live session insights/);
  assert.match(js, /activeTrainingSessionInsights/);
  assert.match(js, /Session stats[\s\S]*Recorded intake/);
  assert.doesNotMatch(js.slice(js.indexOf("function activeInsightsMarkup"), js.indexOf("function prePostMarkup")), /Fuel moments|Hydration moments/);
});

test("Caffeine has one canonical Hydrate input while historical quantities remain readable", () => {
  const js = read("training-mode.js");
  assert.match(js, /type === "fuel" \? \["carbsG"\] : \["fluidMl", "sodiumMg", "caffeineMg"\]/);
  assert.match(js, /normalizeCanonicalCaffeine/);
  assert.match(js, /hydration\.caffeineMg = legacyFuelCaffeine/);
  assert.match(js, /fuel\.caffeineMg = 0/);
  const summary = domain.trainingSessionIntakeSummary({
    session: session({ endedAt: "2026-08-10T09:00:00.000Z" }),
    logs: [log("fuel", "2026-08-10T08:30:00.000Z", { carbsG: 30, caffeineMg: 40 })]
  });
  assert.equal(summary.totals.caffeineMg, 40);
});

test("Garmin Training commands share backend state and retain retry and ownership boundaries", () => {
  const server = read("lib/garmin-auth.js");
  const watch = read("garmin/FuelGuard/shared/source/FuelGuardTraining.mc");
  const api = read("garmin/FuelGuard/shared/source/FuelGuardApi.mc");
  const migration = read("supabase/migrations/20260810091806_garmin_training_mode_commands.sql");
  assert.match(watch, /Start Training|Training Mode started|Training complete/);
  assert.match(watch, /"external_action_id" => commandId/);
  assert.match(api, /trainingEndpoint\(\)/);
  assert.match(server, /garminTrainingHandler/);
  assert.match(read("vercel.json"), /\/api\/garmin\/training[\s\S]*fuel_guard_action=training/);
  assert.match(server, /payload\.external_action_id \|\| payload\.external_event_id/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /unique \(device_token_id, external_action_id\)/);
  assert.match(migration, /token\.user_id = p_user_id[\s\S]*token\.revoked_at is null/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/);
});

function settingsSandbox(saved = "training") {
  const storage = new Map(saved ? [["fuelGuardSettingsCategory", saved]] : []);
  const classes = () => {
    const values = new Set();
    return {
      toggle(name, force) { if (force) values.add(name); else values.delete(name); },
      contains(name) { return values.has(name); }
    };
  };
  const element = (dataset = {}) => ({ hidden: false, dataset, classList: classes(), focus() { this.focused = true; } });
  const menuButton = element();
  const menu = element();
  menu.querySelector = selector => selector === "button" ? menuButton : null;
  const intro = element();
  const header = element();
  const title = element();
  const categoryElements = ["account", "fuelling", "training", "garmin", "notifications", "sharing", "support"]
    .map(category => element({ settingsCategory: category }));
  const domEvents = {};
  const windowEvents = {};
  const document = {
    querySelector(selector) {
      return ({
        "[data-settings-category-menu]": menu,
        "[data-settings-menu-intro]": intro,
        "[data-settings-category-header]": header,
        "[data-settings-category-title]": title
      })[selector] || null;
    },
    querySelectorAll(selector) { return selector === "[data-settings-category]" ? categoryElements : []; },
    addEventListener(type, callback) { domEvents[type] = callback; }
  };
  const window = {
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    addEventListener(type, callback) { windowEvents[type] = callback; }
  };
  vm.runInNewContext(read("settings-navigation.js"), { window, document, console, Object }, { filename: "settings-navigation.js" });
  windowEvents.DOMContentLoaded();
  return { window, storage, menu, intro, header, title, categoryElements, menuButton };
}

test("Settings category navigation restores on refresh and has a clear back state", () => {
  const view = settingsSandbox("training");
  assert.equal(view.menu.hidden, true);
  assert.equal(view.intro.hidden, true);
  assert.equal(view.header.hidden, false);
  assert.equal(view.title.textContent, "Training");
  assert.equal(view.categoryElements.find(item => item.dataset.settingsCategory === "training").classList.contains("settings-category-filtered"), false);
  assert.equal(view.categoryElements.find(item => item.dataset.settingsCategory === "account").classList.contains("settings-category-filtered"), true);
  view.window.FuelGuardSettingsNavigation.showCategory("");
  assert.equal(view.menu.hidden, false);
  assert.equal(view.storage.has("fuelGuardSettingsCategory"), false);
  view.window.FuelGuardSettingsNavigation.showCategory("garmin");
  assert.equal(view.storage.get("fuelGuardSettingsCategory"), "garmin");
  assert.equal(view.title.textContent, "Garmin & Devices");
});

test("all requested Settings categories and existing controls remain reachable", () => {
  const html = read("index.html");
  for (const label of ["Account &amp; Profile", "Fuelling", "Training", "Garmin &amp; Devices", "Notifications", "Coach &amp; Sharing", "App &amp; Support"]) {
    assert.match(html, new RegExp(label));
  }
  for (const category of ["account", "fuelling", "training", "garmin", "notifications", "sharing", "support"]) {
    assert.match(html, new RegExp(`data-settings-category="${category}"`));
  }
  for (const id of ["accountSignInButton", "athleteProfileSaveButton", "coachSharingCard", "athleteNudgePreferences", "garminDevicesList", "fuelCsvImportButton", "checkAppUpdateButton"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /data-settings-category-back/);
});

test("Coach dashboard constrains and wraps generated content at required review widths", () => {
  const css = read("coach/coach-beta.css");
  assert.match(css, /body\.coach-beta[\s\S]*overflow-x: clip/);
  assert.match(css, /body\.coach-beta h1,[\s\S]*overflow-wrap: anywhere/);
  assert.match(css, /@media \(max-width: 820px\)[\s\S]*coach-report-row[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*coach-tabbar/);
  assert.match(css, /@media \(min-width: 860px\)[\s\S]*coach-dashboard-grid/);
});

test("Performance mobile navigation respects top and bottom safe-area insets", () => {
  const css = read("performance/performance.css");
  const html = read("performance/index.html");
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /performance-topbar[\s\S]*env\(safe-area-inset-top, 0px\)/);
  assert.match(css, /performance-sidebar[\s\S]*env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /performance-content[\s\S]*env\(safe-area-inset-left, 0px\)/);
  assert.match(css, /\.icon-button \{ width: 40px; height: 40px/);
});

test("the dedicated pgTAP suite covers 26 Garmin command, hardening and RLS assertions", () => {
  const tap = read("supabase/tests/garmin_training_mode_commands_rls_test.sql");
  const hardening = read("supabase/migrations/20260810100500_garmin_training_mode_command_hardening.sql");
  assert.match(tap, /select plan\(26\)/);
  assert.match(hardening, /as restrictive[\s\S]*to anon, authenticated[\s\S]*using \(false\)/);
  assert.match(hardening, /fuel_garmin_training_commands_session_user_idx/);
  assert.match(tap, /cannot mutate a different Athlete by direct ID/);
  assert.match(tap, /Revocation immediately blocks/);
  assert.match(tap, /repeated Garmin start identity/);
  assert.match(tap, /cannot inspect private Garmin Training command identities/);
});
