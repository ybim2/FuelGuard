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

test("Log is simplified and logging actions live in the expanded timeline", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const dashboard = section(html, "dashboard", "history");

  const status = indexOfRequired(dashboard, 'id="fuelTodayStatus"');
  const progress = indexOfRequired(dashboard, 'id="fuelTodayProgress"');
  const patterns = indexOfRequired(dashboard, 'id="fuelLogPatterns"');
  const timeline = indexOfRequired(dashboard, "Today’s timeline");
  const logFuel = indexOfRequired(dashboard, 'id="graphLogFoodButton"');
  const logHydration = indexOfRequired(dashboard, 'id="graphLogHydrationButton"');
  const statusRenderStart = indexOfRequired(js, "function renderCurrentFuellingStatus");
  const statusRenderEnd = indexOfRequired(js.slice(statusRenderStart), "\n  function hydrationSuggestionForDay") + statusRenderStart;
  const statusRender = js.slice(statusRenderStart, statusRenderEnd);
  const progressRenderStart = indexOfRequired(js, "function renderTodayProgress");
  const progressRenderEnd = indexOfRequired(js.slice(progressRenderStart), "\n  function renderCompactDailySummary") + progressRenderStart;
  const progressRender = js.slice(progressRenderStart, progressRenderEnd);
  const selectedDayRenderStart = indexOfRequired(js, "function renderSelectedDayCard");
  const selectedDayRenderEnd = indexOfRequired(js.slice(selectedDayRenderStart), "\n  function renderLogEvent") + selectedDayRenderStart;
  const selectedDayRender = js.slice(selectedDayRenderStart, selectedDayRenderEnd);

  assert.ok(status < progress, "today progress should follow current status");
  assert.ok(progress < patterns, "Fuelling Patterns should sit directly below Today’s Progress");
  assert.ok(patterns < timeline, "timeline should follow Fuelling Patterns");
  assert.ok(timeline < logFuel, "Log Fuel should sit inside Today’s Timeline");
  assert.ok(logFuel < logHydration, "Log Hydration should sit next to Log Fuel");
  assert.ok(logHydration < indexOfRequired(dashboard, 'id="undoLatestFoodLog"'), "Undo should stay in the same compact timeline action area");
  assert.doesNotMatch(dashboard, /Quick logging|\+ Add a missed log|Add today’s context|todayTimelineToggle|missedLogPanel|fuelDataDate/);
  assert.doesNotMatch(dashboard, /id="fuelDailyLog"[^>]*hidden/);
  assert.match(dashboard, /beta-timeline-log-actions[\s\S]*graphLogFoodButton[\s\S]*graphLogHydrationButton/);
  assert.match(statusRender, /Fuel logs/);
  assert.match(statusRender, /Hydration logs/);
  assert.doesNotMatch(progressRender, /Fuel logs|Hydration logs|Longest fuel gap|Longest hydration gap|longestGapTextFromLogs/);
  assert.match(selectedDayRender, /fuelLogPatterns/);
  assert.match(selectedDayRender, /renderFuellingPatternGraphs/);
  assert.match(js, /FUELLING_PATTERN_BUCKETS/);
  assert.match(js, /renderFuellingPatternBarChart/);
  assert.match(js, /Y: fuelling count/);
  assert.match(js, /X: time of day/);
  assert.doesNotMatch(statusRender, /graphLogFoodButton|graphLogHydrationButton|foodLogCooldownMessage/);
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
  const history = section(html, "history", "insights");
  const renderTrendsStart = indexOfRequired(js, "function renderTrends()");
  const renderTrendsEnd = indexOfRequired(js.slice(renderTrendsStart), "\n  function drawBetaGraph") + renderTrendsStart;
  const renderTrends = js.slice(renderTrendsStart, renderTrendsEnd);
  const weekly = indexOfRequired(renderTrends, "renderInsightsWeeklySummary");
  const personalised = indexOfRequired(renderTrends, "renderPersonalisedInsights");
  const weeklySummaryStart = indexOfRequired(js, "function renderInsightsWeeklySummary");
  const weeklySummaryEnd = indexOfRequired(js.slice(weeklySummaryStart), "\n  function renderGarminSignalsSummary") + weeklySummaryStart;
  const weeklySummary = js.slice(weeklySummaryStart, weeklySummaryEnd);

  assert.doesNotMatch(insights, /beta-trends-filter-title|<h2[^>]*>Insights<\/h2>/);
  assert.doesNotMatch(insights, />Trends</);
  assert.doesNotMatch(insights, /trendPeriodWeekButton|trendPeriodMonthButton|trendPreviousWeekButton|trendNextWeekButton|trendWeekLabel/);
  assert.match(history, /trendPeriodWeekButton[\s\S]*trendPeriodMonthButton[\s\S]*trendPreviousWeekButton[\s\S]*trendNextWeekButton/);
  assert.doesNotMatch(renderTrends, /renderFuellingPatternGraphs/);
  assert.doesNotMatch(renderTrends, /renderTrendHabitInsights/);
  assert.ok(weekly < personalised, "Weekly Summary should be first in Insights");
  assert.match(weeklySummary, /Most common fuel-gap window/);
  assert.match(weeklySummary, /Most common fuelling window/);
  assert.doesNotMatch(weeklySummary, /renderWeeklyMetricCard\("Logged days"|renderWeeklyMetricCard\("Longest fuel gap"/);
  assert.match(renderTrends, /renderPersonalisedInsights/);
  assert.match(renderTrends, /renderGarminSignalsSummary/);
  assert.match(js, /averageBoundaryFuelLogInsight/);
  assert.match(js, /Average first log/);
  assert.match(js, /Most common fuelling gap/);
  assert.match(js, /Average final log/);
  assert.doesNotMatch(renderTrends, /renderTrendPriorityInsight|renderInsightsSupportingDetails/);
  assert.doesNotMatch(renderTrends, /renderTrendSegmentTabs/);
  assert.doesNotMatch(js, /Fuel Guard needs more repeated days|No Garmin signals yet|Sign in and connect Quick Log/);
  assert.ok(indexOfRequired(insights, 'id="fuelAveragesSummary"') < indexOfRequired(insights, "Share insights"));
});

test("History owns period navigation and focuses day detail on Fuel Window and Gap Window", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const history = section(html, "history", "insights");
  const insights = section(html, "insights", "checklist");
  const renderHistoryListStart = indexOfRequired(js, "function renderHistoryList()");
  const renderHistoryListEnd = indexOfRequired(js.slice(renderHistoryListStart), "\n  function renderHistoryLogGroup") + renderHistoryListStart;
  const renderHistoryList = js.slice(renderHistoryListStart, renderHistoryListEnd);
  const renderHistoryDetailStart = indexOfRequired(js, "function renderHistoryDetail()");
  const renderHistoryDetailEnd = indexOfRequired(js.slice(renderHistoryDetailStart), "\n  function renderHistoryScreen") + renderHistoryDetailStart;
  const renderHistoryDetail = js.slice(renderHistoryDetailStart, renderHistoryDetailEnd);

  assert.match(history, /trendPeriodWeekButton[\s\S]*trendPeriodMonthButton[\s\S]*trendPreviousWeekButton[\s\S]*trendNextWeekButton/);
  assert.doesNotMatch(insights, /trendPeriodWeekButton|trendPreviousWeekButton/);
  assert.match(renderHistoryList, /selectedTrendRange/);
  assert.match(renderHistoryList, /updateTrendControls/);
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
  const version = "mobile-pwa-v91-fuelling-pattern-chart";

  assert.match(html, new RegExp(version));
  assert.match(buildInfo, new RegExp(version));
  assert.match(sw, new RegExp(version));
  assert.match(sw, /20260807T073409Z/);
});
