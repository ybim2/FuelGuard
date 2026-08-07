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

function functionBody(source, name, nextName) {
  const start = indexOfRequired(source, `function ${name}`);
  const end = nextName ? indexOfRequired(source.slice(start), `\n  function ${nextName}`) + start : source.length;
  return source.slice(start, end);
}

function section(source, id, nextId) {
  const start = indexOfRequired(source, `<section id="${id}"`);
  const end = nextId ? indexOfRequired(source.slice(start), `<section id="${nextId}"`) + start : source.length;
  return source.slice(start, end);
}

test("primary navigation has exactly Log and History, with Settings in the header", () => {
  const html = read("index.html");
  const css = read("fuel-beta.css");
  const appUi = read("app-ui.js");
  const beta = read("fuel-beta.js");
  const desktopNav = html.slice(indexOfRequired(html, '<nav class="side-nav beta-nav">'), indexOfRequired(html, '<button class="beta-header-settings-button"'));
  const mobileNav = html.slice(indexOfRequired(html, '<nav class="mobile-bottom-nav beta-mobile-nav"'), indexOfRequired(html, '<script src="build-info.js'));

  assert.deepEqual([...desktopNav.matchAll(/data-screen="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Log"],
    ["history", "History"]
  ]);
  assert.deepEqual([...mobileNav.matchAll(/data-mobile-screen="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Log"],
    ["history", "History"]
  ]);
  assert.match(html, /data-open-screen="checklist"/);
  assert.match(html, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/);
  assert.match(css, /body\.beta-mvp \.mobile-bottom-nav \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\) !important;/);
  assert.doesNotMatch(html, /data-screen="insights"|data-mobile-screen="insights"|<section id="insights"/);
  assert.match(appUi, /\["dashboard", "history", "checklist"\]/);
  assert.match(beta, /\["dashboard", "history", "checklist"\]/);
});

test("Log has three visible primary sections and timeline-owned actions", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const dashboard = section(html, "dashboard", "history");
  const statusRender = functionBody(js, "renderCurrentFuellingStatus", "hydrationSuggestionForDay");
  const progressRender = functionBody(js, "renderTodayProgress", "renderCompactDailySummary");

  const status = indexOfRequired(dashboard, 'id="fuelTodayStatus"');
  const patterns = indexOfRequired(dashboard, 'id="fuelLogPatterns"');
  const timeline = indexOfRequired(dashboard, "Today’s timeline");
  const dailyLog = indexOfRequired(dashboard, 'id="fuelDailyLog"');
  const logFuel = indexOfRequired(dashboard, 'id="graphLogFoodButton"');
  const logHydration = indexOfRequired(dashboard, 'id="graphLogHydrationButton"');
  const undo = indexOfRequired(dashboard, 'id="undoLatestFoodLog"');

  assert.ok(status < patterns, "Status should be the first Log section");
  assert.ok(patterns < timeline, "Fuelling Patterns should sit between Status and Today’s Timeline");
  assert.ok(timeline < dailyLog, "Timeline entries should appear inside the Today’s Timeline card");
  assert.ok(dailyLog < logFuel, "Log Fuel should sit below the timeline entries");
  assert.ok(logFuel < logHydration, "Log Hydration should sit beside Log Fuel");
  assert.ok(logHydration < undo, "Undo should sit at the bottom of the timeline action area");
  assert.doesNotMatch(dashboard, /fuelTodayProgress|Today’s progress|Quick logging|\+ Add a missed log|Today’s context|todayTimelineToggle|missedLogPanel/);
  assert.match(progressRender, /return "";/);
  assert.match(statusRender, /Status:/);
  assert.match(statusRender, /Last fuel/);
  assert.match(statusRender, /Last hydration/);
  assert.match(statusRender, /Fuel logs/);
  assert.match(statusRender, /Hydration logs/);
  assert.match(statusRender, /Maximum fuelling gap/);
  assert.doesNotMatch(statusRender, /graphLogFoodButton|graphLogHydrationButton|foodLogCooldownMessage/);
});

test("Fuelling Patterns uses today's fuel logs in a simple time-of-day count chart", () => {
  const js = read("fuel-beta.js");
  const selectedDayRender = functionBody(js, "renderSelectedDayCard", "renderLogEvent");
  const logsSource = functionBody(js, "fuellingPatternLogs", "fuellingPatternBucketCounts");
  const chartSource = functionBody(js, "renderFuellingPatternBarChart", "renderFuellingPatternGraphs");
  const patternsSource = functionBody(js, "renderFuellingPatternGraphs", "renderInsightsWeeklySummary");

  assert.match(selectedDayRender, /renderFuellingPatternGraphs\(todayKey\)/);
  assert.match(logsSource, /logsForDay\(key\)/);
  assert.match(logsSource, /\.filter\(isFuelLog\)/);
  assert.doesNotMatch(logsSource, /trendComparisonData|archiveEntries|currentEntries|previousEntries/);
  assert.match(js, /FUELLING_PATTERN_BUCKETS/);
  assert.match(chartSource, /Y: fuelling count/);
  assert.match(chartSource, /X: time of day/);
  assert.match(chartSource, /No fuel logs today yet/);
  assert.match(patternsSource, /Where today’s fuel logs have landed across the day/);
});

test("Settings exposes the maximum fuelling gap goal and status logic reads it", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const state = read("app-state.js");
  const settings = section(html, "checklist");

  assert.match(settings, /Fuel gap goal/);
  assert.match(settings, /id="maximumFuelGapPreset"/);
  assert.match(settings, /id="saveFuelGapGoal"/);
  assert.match(settings, /id="fuelGoalStatus"/);
  assert.match(settings, /2 hours[\s\S]*2\.5 hours[\s\S]*3 hours[\s\S]*3\.5 hours[\s\S]*4 hours/);
  assert.match(js, /function maximumFuelGapMinutes/);
  assert.match(js, /function fuelStatusLimits/);
  assert.match(js, /function saveFuelGapGoalSetting/);
  assert.match(js, /saveFuelGapGoal"\)\?\.addEventListener\("click", saveFuelGapGoalSetting\)/);
  assert.match(state, /maximumFuelGapMinutes: 180/);
  assert.match(state, /const goalMinutes = Math\.min\(240, Math\.max\(120, Number\(fuelGapState\(\)\.maximumFuelGapMinutes/);
});

test("History owns the compact period selector and four primary graph cards", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const history = section(html, "history", "checklist");
  const renderHistoryList = functionBody(js, "renderHistoryList", "renderHistoryLogGroup");
  const renderHistoryGraphs = functionBody(js, "renderHistoryGraphs", "renderHistoryList");
  const renderHistoryDetail = functionBody(js, "renderHistoryDetail", "renderHistoryScreen");

  assert.match(history, /trendPeriodWeekButton[\s\S]*trendPeriodMonthButton[\s\S]*trendPreviousWeekButton[\s\S]*trendNextWeekButton/);
  assert.match(renderHistoryList, /selectedTrendRange/);
  assert.match(renderHistoryList, /updateTrendControls/);
  assert.match(renderHistoryList, /renderHistoryGraphs\(range\)/);
  assert.match(renderHistoryGraphs, /Fuel Log Frequency/);
  assert.match(renderHistoryGraphs, /First Fuel Time/);
  assert.match(renderHistoryGraphs, /Final Fuel Time/);
  assert.match(renderHistoryGraphs, /Most Common Fuel-Gap Window/);
  assert.match(renderHistoryGraphs, /historyLogFrequencyPoints/);
  assert.match(renderHistoryGraphs, /historyBoundaryFuelPoints/);
  assert.match(renderHistoryGraphs, /historyGapWindowPoints/);
  assert.match(renderHistoryDetail, /target\.innerHTML = ""/);
  assert.doesNotMatch(renderHistoryDetail, /renderTodayTimeline|renderHistoryFuelWindowCard|renderHistoryGapWindowCard|renderDailyTargetProgress/);
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
  assert.match(settings, /<summary>Fuel gap goal<\/summary>/);
  assert.match(settings, /<summary>Support thresholds and fuelling window<\/summary>/);
  assert.match(settings, /<summary>Legacy CSV import<\/summary>/);
  assert.match(settings, /<summary>Destructive actions<\/summary>/);
});

test("PWA cache and asset versions are bumped for the simplified history and goals core", () => {
  const html = read("index.html");
  const buildInfo = read("build-info.js");
  const sw = read("sw.js");
  const version = "mobile-pwa-v92-history-goals";

  assert.match(html, new RegExp(version));
  assert.match(buildInfo, new RegExp(version));
  assert.match(sw, new RegExp(version));
  assert.match(sw, /20260807T080943Z/);
});
