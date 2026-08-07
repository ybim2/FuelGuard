const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function indexOfRequired(source, token) {
  const index = source.indexOf(token);
  assert.notEqual(index, -1, `${token} should exist`);
  return index;
}

function section(source, id, nextId) {
  const start = indexOfRequired(source, `<section id="${id}"`);
  const end = nextId ? indexOfRequired(source.slice(start), `<section id="${nextId}"`) + start : source.length;
  return source.slice(start, end);
}

test("primary navigation has exactly Log, Insights, and History", () => {
  const html = read("index.html");
  const css = read("fuel-beta.css");
  const desktopNav = html.slice(indexOfRequired(html, '<nav class="side-nav beta-nav">'), indexOfRequired(html, '<button class="beta-header-settings-button"'));
  const mobileNav = html.slice(indexOfRequired(html, '<nav class="mobile-bottom-nav beta-mobile-nav"'), indexOfRequired(html, '<script src="build-info.js'));

  assert.deepEqual([...desktopNav.matchAll(/data-screen="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Log"],
    ["insights", "Insights"],
    ["history", "History"]
  ]);
  assert.deepEqual([...mobileNav.matchAll(/data-mobile-screen="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Log"],
    ["insights", "Insights"],
    ["history", "History"]
  ]);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  assert.match(css, /\.mobile-bottom-nav \{\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\) !important;/);
  assert.doesNotMatch(desktopNav + mobileNav, />Analysis<|>Plan<|>Trends</);
});

test("Log is simplified to status, progress, and an expanded timeline", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const dashboard = section(html, "dashboard", "history");

  const status = indexOfRequired(dashboard, 'id="fuelTodayStatus"');
  const progress = indexOfRequired(dashboard, 'id="fuelTodayProgress"');
  const timeline = indexOfRequired(dashboard, "Today’s timeline");

  assert.ok(status < progress, "today progress should follow current status");
  assert.ok(progress < timeline, "timeline should follow today progress");
  assert.doesNotMatch(dashboard, /Quick logging|\+ Add a missed log|Add today’s context|todayTimelineToggle|missedLogPanel|fuelDataDate/);
  assert.doesNotMatch(dashboard, /id="fuelDailyLog"[^>]*hidden/);
  assert.match(js, /beta-status-log-actions[\s\S]*graphLogFoodButton[\s\S]*graphLogHydrationButton/);
  assert.match(js, /target\.hidden = false/);
});

test("old Analysis and Plan screens are not mounted or routable through normal navigation", () => {
  const html = read("index.html");
  const appUi = read("app-ui.js");
  const beta = read("fuel-beta.js");

  assert.doesNotMatch(html, /<section id="analysis"|<section id="plan"/);
  assert.doesNotMatch(html, /data-screen="analysis"|data-screen="plan"|data-mobile-screen="analysis"|data-mobile-screen="plan"/);
  assert.match(appUi, /\["dashboard", "history", "insights", "checklist"\]/);
  assert.match(beta, /\["dashboard", "history", "insights", "checklist"\]/);
});

test("Insights replaces Trends and keeps Garmin evidence in the focused screen", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const insights = section(html, "insights", "checklist");
  const renderTrendsStart = indexOfRequired(js, "function renderTrends()");
  const renderTrendsEnd = indexOfRequired(js.slice(renderTrendsStart), "\n  function drawBetaGraph") + renderTrendsStart;
  const renderTrends = js.slice(renderTrendsStart, renderTrendsEnd);

  assert.match(insights, />Insights</);
  assert.doesNotMatch(insights, />Trends</);
  assert.match(renderTrends, /renderFuellingPatternGraphs/);
  assert.match(js, /Morning fuelling/);
  assert.match(js, /Afternoon fuelling/);
  assert.match(js, /Evening fuelling/);
  assert.match(js, /Fuel Gap Windows/);
  assert.match(js, /Log Windows/);
  assert.match(renderTrends, /renderInsightsWeeklySummary/);
  assert.match(renderTrends, /renderTrendPriorityInsight/);
  assert.match(renderTrends, /renderPersonalisedInsights/);
  assert.match(renderTrends, /renderGarminSignalsSummary/);
  assert.match(renderTrends, /renderInsightsSupportingDetails/);
  assert.doesNotMatch(renderTrends, /renderTrendSegmentTabs/);
  assert.doesNotMatch(js, /Fuel Guard needs more repeated days|No Garmin signals yet|Sign in and connect Quick Log/);
  assert.match(js, /renderGarminMetricsSection/);
  assert.match(js, /renderGarminPatternsSection/);
  assert.ok(indexOfRequired(insights, 'id="fuelAveragesSummary"') < indexOfRequired(insights, "Share insights"));
});

test("History focuses day detail on Fuel Window and Gap Window", () => {
  const js = read("fuel-beta.js");
  const renderHistoryDetailStart = indexOfRequired(js, "function renderHistoryDetail()");
  const renderHistoryDetailEnd = indexOfRequired(js.slice(renderHistoryDetailStart), "\n  function renderHistoryScreen") + renderHistoryDetailStart;
  const renderHistoryDetail = js.slice(renderHistoryDetailStart, renderHistoryDetailEnd);

  assert.match(js, /function renderHistoryFuelWindowCard/);
  assert.match(js, /function renderHistoryGapWindowCard/);
  assert.match(renderHistoryDetail, /renderHistoryFuelWindowCard/);
  assert.match(renderHistoryDetail, /renderHistoryGapWindowCard/);
  assert.doesNotMatch(renderHistoryDetail, /renderTodayTimeline|renderHistoryLogGroup|renderHistoryDemandDetail|renderDailyTargetProgress/);
});

test("Settings follows the simplified hierarchy and keeps advanced controls available", () => {
  const html = read("index.html");
  const settings = section(html, "checklist");

  const account = indexOfRequired(settings, "Account &amp; Sync");
  const garmin = indexOfRequired(settings, "Connected Garmin Apps");
  const preferences = indexOfRequired(settings, "Preferences");
  const advanced = indexOfRequired(settings, "Advanced settings");
  const importAndClear = indexOfRequired(settings, "Data import and clearing");
  const version = indexOfRequired(settings, "App version and privacy");

  assert.ok(account < garmin);
  assert.ok(garmin < preferences);
  assert.ok(preferences < advanced);
  assert.ok(advanced < importAndClear);
  assert.ok(importAndClear < version);
  assert.match(settings, /<summary>Daily targets<\/summary>/);
  assert.match(settings, /<summary>Support thresholds and fuelling window<\/summary>/);
  assert.match(settings, /<summary>Legacy CSV import<\/summary>/);
  assert.match(settings, /<summary>Destructive actions<\/summary>/);
});

test("PWA cache and asset versions are bumped for the three-screen core", () => {
  const html = read("index.html");
  const buildInfo = read("build-info.js");
  const sw = read("sw.js");
  const version = "mobile-pwa-v88-simplified-three-tabs";

  assert.match(html, new RegExp(version));
  assert.match(buildInfo, new RegExp(version));
  assert.match(sw, new RegExp(version));
  assert.match(sw, /20260807T061420Z/);
});
