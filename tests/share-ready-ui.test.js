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

test("Log owns status, quick logging, progress, collapsed timeline, missed logs, and optional context", () => {
  const html = read("index.html");
  const dashboard = section(html, "dashboard", "history");

  const status = indexOfRequired(dashboard, 'id="fuelTodayStatus"');
  const logging = indexOfRequired(dashboard, "Quick logging");
  const progress = indexOfRequired(dashboard, 'id="fuelTodayProgress"');
  const timeline = indexOfRequired(dashboard, "Today’s timeline");
  const missed = indexOfRequired(dashboard, "+ Add a missed log");
  const context = indexOfRequired(dashboard, "Add today’s context");

  assert.ok(status < logging, "current status should come before quick logging");
  assert.ok(logging < progress, "today progress should follow quick logging");
  assert.ok(progress < timeline, "timeline should follow today progress");
  assert.ok(timeline < missed, "missed-log flow should stay after the timeline");
  assert.ok(missed < context, "optional context should not compete with the core logging flow");
  assert.match(dashboard, /id="fuelDailyLog"[^>]*hidden/);
  assert.match(dashboard, /id="missedLogPanel"[^>]*hidden/);
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
  assert.match(renderTrends, /renderInsightsWeeklySummary/);
  assert.match(renderTrends, /renderTrendPriorityInsight/);
  assert.match(renderTrends, /renderPersonalisedInsights/);
  assert.match(renderTrends, /renderGarminSignalsSummary/);
  assert.match(renderTrends, /renderInsightsSupportingDetails/);
  assert.doesNotMatch(renderTrends, /renderTrendSegmentTabs/);
  assert.match(js, /renderGarminMetricsSection/);
  assert.match(js, /renderGarminPatternsSection/);
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
  const version = "mobile-pwa-v87-three-screen-core";

  assert.match(html, new RegExp(version));
  assert.match(buildInfo, new RegExp(version));
  assert.match(sw, new RegExp(version));
  assert.match(sw, /20260806T195203Z/);
});
