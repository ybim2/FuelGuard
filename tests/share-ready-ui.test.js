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

test("Log tab owns status, quick logging, today progress, timeline, and missed-log order", () => {
  const html = read("index.html");
  const dashboardStart = indexOfRequired(html, '<section id="dashboard"');
  const dashboardEnd = indexOfRequired(html.slice(dashboardStart), '<section id="analysis"') + dashboardStart;
  const dashboard = html.slice(dashboardStart, dashboardEnd);

  const status = indexOfRequired(dashboard, 'id="fuelTodayStatus"');
  const logging = indexOfRequired(dashboard, "Quick logging");
  const progress = indexOfRequired(dashboard, 'id="fuelTodayProgress"');
  const timeline = indexOfRequired(dashboard, "Today’s timeline");
  const missed = indexOfRequired(dashboard, "+ Add a missed log");

  assert.ok(status < logging, "Current status should come before quick logging");
  assert.ok(logging < progress, "Today’s progress should move below quick logging on Log");
  assert.ok(progress < timeline, "Timeline should follow today progress");
  assert.ok(timeline < missed, "Missed-log flow should stay after the timeline");
  assert.match(dashboard, /id="fuelDailyLog"[^>]*hidden/);
});

test("Plan tab no longer mounts duplicate today progress or daily summary", () => {
  const html = read("index.html");
  const planStart = indexOfRequired(html, '<section id="plan"');
  const planEnd = indexOfRequired(html.slice(planStart), '<section id="trends"') + planStart;
  const plan = html.slice(planStart, planEnd);

  assert.match(plan, /id="fuelTodayTimeline"/);
  assert.doesNotMatch(plan, /id="fuelTodayProgress"/);
  assert.doesNotMatch(plan, /id="fuelTodaySummary"/);
});

test("Analysis render is limited to selected-day replay and one takeaway", () => {
  const js = read("fuel-beta.js");
  const renderAnalysisStart = indexOfRequired(js, "function renderAnalysis()");
  const renderAnalysisEnd = indexOfRequired(js.slice(renderAnalysisStart), "\n  function renderTodayProgress") + renderAnalysisStart;
  const renderAnalysis = js.slice(renderAnalysisStart, renderAnalysisEnd);

  assert.match(renderAnalysis, /renderAnalysisTimelineGraph/);
  assert.match(renderAnalysis, /renderAnalysisDailyTakeaway/);
  [
    "renderAnalysisPriorityCard",
    "renderAnalysisKeyResult",
    "renderGarminPatternsSection",
    "renderAnalysisGapGraph",
    "renderAnalysisAdherenceBreakdown",
    "renderAnalysisProgression",
    "renderAnalysisScenario",
    "renderAnalysisWrittenInsights",
    "renderGarminDailyCheckinSection"
  ].forEach(name => assert.doesNotMatch(renderAnalysis, new RegExp(`${name}\\(`), `${name} should not render in Analysis`));
});

test("Trends owns personalised insights and Garmin metric/pattern sections", () => {
  const js = read("fuel-beta.js");
  assert.match(js, /renderGarminMetricsSection/);
  const trendStart = indexOfRequired(js, "function renderTrendSegmentContent");
  const trendEnd = indexOfRequired(js.slice(trendStart), "\n  function renderTrends") + trendStart;
  const trendSegment = js.slice(trendStart, trendEnd);

  assert.match(trendSegment, /renderPersonalisedInsights/);
  assert.match(trendSegment, /renderGarminMetricsSection/);
  assert.match(trendSegment, /renderGarminPatternsSection/);
  assert.doesNotMatch(js, /const enoughSignals = context\.days\.length >= 3/);
});

test("PWA cache and asset versions are bumped for the share-ready refactor", () => {
  const html = read("index.html");
  const buildInfo = read("build-info.js");
  const sw = read("sw.js");
  const version = "mobile-pwa-v86-share-ready-daily-experience";

  assert.match(html, new RegExp(version));
  assert.match(buildInfo, new RegExp(version));
  assert.match(sw, new RegExp(version));
  assert.match(sw, /20260806T194500Z/);
});
