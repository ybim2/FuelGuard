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

test("primary navigation has only Log, with Settings in the header", () => {
  const html = read("index.html");
  const css = read("fuel-beta.css");
  const appUi = read("app-ui.js");
  const beta = read("fuel-beta.js");
  const desktopNav = html.slice(indexOfRequired(html, '<nav class="side-nav beta-nav">'), indexOfRequired(html, '<button class="beta-header-settings-button"'));
  const mobileNav = html.slice(indexOfRequired(html, '<nav class="mobile-bottom-nav beta-mobile-nav"'), indexOfRequired(html, '<script src="build-info.js'));

  assert.deepEqual([...desktopNav.matchAll(/data-screen="([^"]+)"[^>]*>([^<]+)<\/button>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Log"]
  ]);
  assert.deepEqual([...mobileNav.matchAll(/data-mobile-screen="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)].map(match => [match[1], match[2]]), [
    ["dashboard", "Log"]
  ]);
  assert.match(html, /data-open-screen="checklist"/);
  assert.match(html, /grid-template-columns: 1fr !important;/);
  assert.match(css, /body\.beta-mvp \.mobile-bottom-nav \{[\s\S]*?grid-template-columns: 1fr !important;/);
  assert.doesNotMatch(html, /data-screen="history"|data-mobile-screen="history"|<section id="history"|data-screen="insights"|data-mobile-screen="insights"|<section id="insights"/);
  assert.match(appUi, /\["dashboard", "checklist"\]/);
  assert.match(beta, /\["dashboard", "checklist"\]/);
  assert.doesNotMatch(beta, /renderHistoryScreen|data-history-date|fuelHistoryList|fuelHistoryDetail/);
});

test("Log is a status-first beta instrument panel", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const dashboard = section(html, "dashboard", "checklist");
  const goalCopySource = functionBody(js, "fuelGapGoalCopy", "currentStatusSupportCopy");
  const statusRender = functionBody(js, "renderCurrentFuellingStatus", "hydrationSuggestionForDay");
  const progressRender = functionBody(js, "renderTodayProgress", "renderCompactDailySummary");

  const status = indexOfRequired(dashboard, 'id="fuelTodayStatus"');
  const actions = indexOfRequired(dashboard, "Quick actions");
  const patterns = indexOfRequired(dashboard, 'id="fuelLogPatterns"');
  const timeline = indexOfRequired(dashboard, "Today’s timeline");
  const dailyLog = indexOfRequired(dashboard, 'id="fuelDailyLog"');
  const logFuel = indexOfRequired(dashboard, 'id="graphLogFoodButton"');
  const logHydration = indexOfRequired(dashboard, 'id="graphLogHydrationButton"');
  const logSleepy = indexOfRequired(dashboard, 'id="graphLogSleepyButton"');
  const undo = indexOfRequired(dashboard, 'id="undoLatestFoodLog"');
  const dayContext = indexOfRequired(dashboard, "Day context");
  const sleepyRecorder = functionBody(js, "recordSleepy", "logById");
  const checkinRecorder = functionBody(js, "recordCheckinEvent", "undoLatestRhythmLog");
  const undoStart = indexOfRequired(js, "function undoLatestRhythmLog");
  const undoEnd = indexOfRequired(js.slice(undoStart), "\n  endFuelDayAndStartFasting =") + undoStart;
  const undoSource = js.slice(undoStart, undoEnd);
  const timelineSource = functionBody(js, "renderEventTimeline", "renderDailyLog");
  const dailyLogSource = functionBody(js, "renderDailyLog", "gapZoneReached");
  const lowEnergySource = functionBody(js, "isLowEnergyCheckinLog", "isSleepyLog");
  const dayTypeControls = functionBody(js, "renderDayTypeControls", "setCsvImportStatus");

  assert.ok(status < actions, "Status should be the first Log section");
  assert.ok(actions < timeline, "Quick actions should sit directly after status");
  assert.ok(timeline < dailyLog, "Timeline entries should appear inside the Today’s Timeline card");
  assert.ok(logFuel < logHydration, "Hydrate should sit beside Fuel");
  assert.ok(logHydration < logSleepy, "Sleepy should replace the old combined quick action as the third option");
  assert.ok(dailyLog < undo, "Undo should sit inside the Today’s Timeline card");
  assert.ok(timeline < patterns, "Today’s Patterns should sit below Today’s Timeline");
  assert.ok(patterns < dayContext, "Day context should be the optional final Log section");
  assert.match(dashboard, />Fuel<\/span>/);
  assert.match(dashboard, />Hydrate<\/span>/);
  assert.match(dashboard, />Sleepy<\/span>/);
  assert.doesNotMatch(dashboard, /Zz|ZZ|Zzz|beta-log-button-icon/);
  assert.match(dashboard, /aria-label="Log fuel, hydration, or sleepy"/);
  assert.match(dashboard, /id="fuelDayType"/);
  assert.match(dashboard, /id="fuelDayTypeSaved"/);
  assert.match(dayTypeControls, /Saved:/);
  assert.doesNotMatch(dashboard, /Fuel \+ Hydration|Fuel \+ hydration/);
  assert.match(sleepyRecorder, /checkinType:\s*SLEEPY_CHECKIN_TYPE/);
  assert.match(sleepyRecorder, /arousalLevel:\s*SLEEPY_CHECKIN_TYPE/);
  assert.match(checkinRecorder, /betaState\(\)\.logs\.push\(log\)/);
  assert.match(checkinRecorder, /window\.fuelGuardCloud\?\.saveLog\(log\)/);
  assert.match(undoSource, /betaState\(\)\.logs\.forEach/);
  assert.doesNotMatch(undoSource, /\.filter\(isFuelLog|\.filter\(isHydrationLog/);
  assert.match(timelineSource, /isSleepyLog\(log\)/);
  assert.match(dailyLogSource, /isSleepyLog\(log\)/);
  assert.match(lowEnergySource, /SLEEPY_CHECKIN_TYPE\) return false/);
  assert.doesNotMatch(dashboard, /fuelTodayProgress|Today’s progress|Quick logging|\+ Add a missed log|Today’s context|todayTimelineToggle|missedLogPanel/);
  assert.match(progressRender, /return "";/);
  assert.match(statusRender, /beta-status-kicker/);
  assert.match(statusRender, /beta-status-title-large/);
  assert.match(statusRender, /beta-gap-countdown/);
  assert.match(goalCopySource, /fuel-gap target/);
  assert.match(goalCopySource, /goal - elapsed/);
  assert.match(statusRender, /beta-gap-progress/);
  assert.match(statusRender, /Last fuel/);
  assert.match(statusRender, /Last hydration/);
  assert.match(statusRender, /Fuel logs/);
  assert.match(statusRender, /Hydration logs/);
  assert.doesNotMatch(statusRender, /graphLogFoodButton|graphLogHydrationButton|foodLogCooldownMessage/);
  assert.ok(js.includes('quickLogConfirmation = `${label} - ${formatClock(date)}`;'));
});

test("Today’s Patterns switches between fuel, hydration and sleepy event counts", () => {
  const js = read("fuel-beta.js");
  const selectedDayRender = functionBody(js, "renderSelectedDayCard", "renderLogEvent");
  const logsSource = functionBody(js, "fuellingPatternLogs", "fuellingPatternBucketCounts");
  const matchSource = functionBody(js, "logMatchesPattern", "fuellingPatternLogs");
  const chartSource = functionBody(js, "renderFuellingPatternBarChart", "renderFuellingPatternGraphs");
  const patternsSource = functionBody(js, "renderFuellingPatternGraphs", "renderInsightsWeeklySummary");
  const patternTypes = js.slice(indexOfRequired(js, "const LOG_PATTERN_TYPES"), indexOfRequired(js, "function normalizeLogPatternType"));

  assert.match(selectedDayRender, /renderFuellingPatternGraphs\(todayKey\)/);
  assert.match(logsSource, /logsForDay\(key\)/);
  assert.match(logsSource, /\.filter\(log => logMatchesPattern\(log, patternType\)\)/);
  assert.match(matchSource, /isFuelLog\(log\)/);
  assert.match(matchSource, /isHydrationLog\(log\)/);
  assert.match(matchSource, /isSleepyLog\(log\)/);
  assert.doesNotMatch(logsSource, /trendComparisonData|archiveEntries|currentEntries|previousEntries/);
  assert.match(js, /FUELLING_PATTERN_BUCKETS/);
  assert.match(chartSource, /Y: event count/);
  assert.match(chartSource, /X: time of day/);
  assert.match(chartSource, /pattern\.empty/);
  assert.match(patternsSource, /Today’s patterns/);
  assert.match(patternsSource, /data-log-pattern-type/);
  assert.match(patternTypes, /label:\s*"Fuel"/);
  assert.match(patternTypes, /label:\s*"Hydration"/);
  assert.match(patternTypes, /label:\s*"Sleepy"/);
  assert.match(js, /No fuel logged today/);
  assert.match(js, /No hydration logged today/);
  assert.match(js, /No sleepy events logged today/);
});

test("Settings hides preference controls while preserving internal defaults", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");
  const state = read("app-state.js");
  const settings = section(html, "checklist");

  assert.match(settings, /Maximum Fuel Gap/);
  assert.match(settings, /id="maximumFuelGapPreset"/);
  assert.match(settings, /id="maximumFuelGapCustom"/);
  assert.doesNotMatch(settings, /Preferences|Advanced settings|Support thresholds and fuelling window|Garmin health patterns/);
  assert.doesNotMatch(settings, /id="dailyFuelTarget"|id="fuelWindowPreset"|id="fuelGreenHours"/);
  assert.match(js, /function maximumFuelGapMinutes/);
  assert.match(js, /function applyMaximumFuelGapGoal/);
  assert.match(js, /function fuelStatusLimits/);
  assert.match(state, /maximumFuelGapMinutes: 180/);
  assert.match(state, /const goalMinutes = Math\.min\(240, Math\.max\(120, Number\(fuelGapState\(\)\.maximumFuelGapMinutes/);
  assert.match(state, /const greenMinutes = Math\.max\(30, goalMinutes - 30\)/);
});

test("History page and navigation are removed", () => {
  const html = read("index.html");
  const js = read("fuel-beta.js");

  assert.doesNotMatch(html, /<section id="history"|fuelHistoryList|fuelHistoryDetail|History period selector/);
  assert.doesNotMatch(js, /function renderHistoryScreen|function renderHistoryList|function renderHistoryGraphs|data-history-date/);
});

test("Settings keeps only essential production sections", () => {
  const html = read("index.html");
  const settings = section(html, "checklist");

  const intro = indexOfRequired(settings, "Settings");
  const account = indexOfRequired(settings, "Account &amp; Sync");
  const coachSharing = indexOfRequired(settings, "Coach Access");
  const garmin = indexOfRequired(settings, "Connected Garmin Apps");
  const maximum = indexOfRequired(settings, "Maximum Fuel Gap");
  const importAndClear = indexOfRequired(settings, "Data import and clearing");
  const version = indexOfRequired(settings, "App version and privacy");

  assert.ok(intro < account);
  assert.ok(account < coachSharing);
  assert.ok(coachSharing < garmin);
  assert.ok(garmin < maximum);
  assert.ok(maximum < importAndClear);
  assert.ok(importAndClear < version);
  assert.match(settings, /id="coachAthleteCode"/);
  assert.match(settings, /id="coachCopyAthleteCodeButton"/);
  assert.match(settings, /id="coachShareAthleteCodeButton"/);
  assert.match(settings, /id="coachConnectionRequests"/);
  assert.match(settings, /Give this code to your coach so they can send you a connection request\./);
  assert.match(settings, /<summary>Legacy CSV import<\/summary>/);
  assert.match(settings, /<summary>Destructive actions<\/summary>/);
  assert.doesNotMatch(settings, /Garmin health patterns|Preferences|Advanced settings|Daily targets|Support thresholds/);
});

test("PWA cache and asset versions are bumped for the integrated Coach daily workflow", () => {
  const html = read("index.html");
  const buildInfo = read("build-info.js");
  const sw = read("sw.js");
  const version = "mobile-pwa-v108-coach-daily-integrated";

  assert.match(html, new RegExp(version));
  assert.match(buildInfo, new RegExp(version));
  assert.match(sw, new RegExp(version));
  assert.match(sw, /20260807T174847Z/);
  assert.match(sw, /coach\/index\.html/);
  assert.match(sw, /coach\/coach-platform\.js/);
  assert.match(sw, /coach\/coach-attention\.js/);
  assert.match(sw, /fuel-guard-domain\.js/);
});
