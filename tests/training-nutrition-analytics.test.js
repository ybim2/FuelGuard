const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.resolve(__dirname, "..");
const analyticsSource = fs.readFileSync(path.join(root, "athlete-analytics.js"), "utf8");
const analyticsStyles = fs.readFileSync(path.join(root, "athlete-analytics.css"), "utf8");
const NOW = new Date("2026-08-15T12:00:00.000Z");

function session(id, startedAt, endedAt) {
  return { id, status: "completed", startedAt, endedAt };
}

function log(id, type, timestamp, trainingModeSessionId, extra = {}) {
  return { id, type, timestamp, source: "manual", trainingModeSessionId, ...extra };
}

function supplement(id, label, takenAt, trainingModeSessionId, extra = {}) {
  return {
    id,
    supplementPlanId: label.toLowerCase().replaceAll(" ", "-"),
    supplementLabel: label,
    takenAt,
    eventStatus: "taken",
    trainingModeSessionId,
    ...extra
  };
}

function series(result, kind) {
  return result.intake.series.find(item => item.key === kind);
}

function supplementSeries(result, label) {
  return result.supplement.series.find(item => item.label === label);
}

function analyticsHelpers() {
  const window = { FuelGuardDomain: domain, addEventListener() {} };
  const document = {
    hidden: false,
    addEventListener() {},
    getElementById() { return null; }
  };
  const context = {
    window,
    document,
    fuelGapState: () => ({ logs: [], trainingMode: { sessions: [] }, fuelKit: { checks: [] } }),
    Date,
    Intl,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object
  };
  vm.runInNewContext(analyticsSource, context, { filename: "athlete-analytics.js" });
  return window.FuelGuardAthleteAnalytics._test;
}

test("training timing is relative to session start and includes exact session boundaries only", () => {
  const sessions = [
    session("morning", "2026-08-10T07:00:00.000Z", "2026-08-10T08:00:00.000Z"),
    session("evening", "2026-08-11T17:00:00.000Z", "2026-08-11T18:00:00.000Z"),
    session("boundary", "2026-08-12T20:00:00.000Z", "2026-08-12T21:00:00.000Z")
  ];
  const result = domain.athleteTrainingNutritionTiming({
    sessions,
    logs: [
      log("fuel-morning", "fuel", "2026-08-10T07:20:00.000Z", "morning"),
      log("fuel-evening", "fuel", "2026-08-11T17:20:00.000Z", "evening"),
      log("at-start", "hydration", "2026-08-12T20:00:00.000Z", "boundary"),
      log("at-end", "hydration", "2026-08-12T21:00:00.000Z", "boundary"),
      log("before-start", "hydration", "2026-08-12T19:59:59.000Z", "boundary"),
      log("after-end", "hydration", "2026-08-12T21:00:01.000Z", "boundary")
    ],
    supplementEvents: [
      supplement("supp-morning", "Creatine", "2026-08-10T07:30:00.000Z", "morning"),
      supplement("supp-evening", "Creatine", "2026-08-11T17:30:00.000Z", "evening")
    ],
    now: NOW
  });

  assert.deepEqual(series(result, "fuel").points.map(point => point.minutes), [20, 20]);
  assert.deepEqual(series(result, "hydration").points.map(point => point.minutes), [0, 60]);
  assert.deepEqual(supplementSeries(result, "Creatine").points.map(point => point.minutes), [30, 30]);
});

test("missing or mismatched links cannot bypass containment and overlapping sessions receive each event once", () => {
  const separateSessions = [
    session("actual", "2026-08-10T07:00:00.000Z", "2026-08-10T08:00:00.000Z"),
    session("wrong", "2026-08-10T12:00:00.000Z", "2026-08-10T13:00:00.000Z")
  ];
  const contained = domain.athleteTrainingNutritionTiming({
    sessions: separateSessions,
    logs: [
      log("missing-link", "fuel", "2026-08-10T07:10:00.000Z"),
      log("wrong-link", "fuel", "2026-08-10T07:20:00.000Z", "wrong"),
      log("outside-with-link", "fuel", "2026-08-10T10:00:00.000Z", "actual")
    ],
    supplementEvents: [
      supplement("supp-missing", "Iron", "2026-08-10T07:30:00.000Z"),
      supplement("supp-wrong", "Iron", "2026-08-10T07:40:00.000Z", "wrong"),
      supplement("supp-outside", "Iron", "2026-08-10T10:00:00.000Z", "actual")
    ],
    now: NOW
  });

  assert.deepEqual(series(contained, "fuel").points.map(point => [point.sessionId, point.minutes]), [["actual", 10], ["actual", 20]]);
  assert.deepEqual(supplementSeries(contained, "Iron").points.map(point => [point.sessionId, point.minutes]), [["actual", 30], ["actual", 40]]);

  const overlapping = domain.athleteTrainingNutritionTiming({
    sessions: [
      session("overlap-a", "2026-08-11T07:00:00.000Z", "2026-08-11T09:00:00.000Z"),
      session("overlap-b", "2026-08-11T08:00:00.000Z", "2026-08-11T10:00:00.000Z")
    ],
    logs: [log("one-overlap-log", "fuel", "2026-08-11T08:30:00.000Z")],
    supplementEvents: [supplement("one-overlap-supp", "Creatine", "2026-08-11T08:30:00.000Z", "overlap-a")],
    now: NOW
  });

  assert.equal(overlapping.intake.eventCount, 1);
  assert.equal(series(overlapping, "fuel").points.length, 1);
  assert.equal(series(overlapping, "fuel").points[0].sessionId, "overlap-b");
  assert.equal(overlapping.intake.ambiguousEventCount, 1);
  assert.equal(overlapping.supplement.eventCount, 1);
  assert.equal(supplementSeries(overlapping, "Creatine").points.length, 1);
  assert.equal(supplementSeries(overlapping, "Creatine").points[0].sessionId, "overlap-a");
  assert.equal(overlapping.supplement.ambiguousEventCount, 1);
});

test("combined intake contributes to both series while skipped supplements and test logs are excluded", () => {
  const sessions = [
    session("session-a", "2026-08-10T07:00:00.000Z", "2026-08-10T08:00:00.000Z"),
    session("session-b", "2026-08-11T07:00:00.000Z", "2026-08-11T08:00:00.000Z")
  ];
  const result = domain.athleteTrainingNutritionTiming({
    sessions,
    logs: [
      log("combined", "fuel_hydration", "2026-08-10T07:20:00.000Z", "session-a"),
      log("invalid-test", "fuel", "2026-08-11T07:25:00.000Z", "session-b", { source: "test" })
    ],
    supplementEvents: [
      supplement("taken", "Creatine", "2026-08-10T07:10:00.000Z", "session-a"),
      supplement("skipped", "Creatine", "2026-08-11T07:10:00.000Z", "session-b", { eventStatus: "skipped" })
    ],
    now: NOW
  });

  assert.equal(result.intake.eventCount, 1, "one combined event remains one piece of overall evidence");
  assert.deepEqual(series(result, "fuel").points.map(point => point.eventId), ["combined"]);
  assert.deepEqual(series(result, "hydration").points.map(point => point.eventId), ["combined"]);
  assert.equal(result.supplement.eventCount, 1);
  assert.deepEqual(supplementSeries(result, "Creatine").points.map(point => point.eventId), ["taken"]);
});

test("evidence thresholds gate medians and require a unique supported 15-minute cluster for summaries", () => {
  const sessions = [
    session("s1", "2026-08-10T07:00:00.000Z", "2026-08-10T09:00:00.000Z"),
    session("s2", "2026-08-11T07:00:00.000Z", "2026-08-11T09:00:00.000Z"),
    session("s3", "2026-08-12T07:00:00.000Z", "2026-08-12T09:00:00.000Z")
  ];
  const firstTwo = [
    log("two-1", "fuel", "2026-08-10T07:10:00.000Z", "s1"),
    log("two-2", "fuel", "2026-08-11T07:20:00.000Z", "s2")
  ];
  const sparse = domain.athleteTrainingNutritionTiming({ sessions, logs: firstTwo, now: NOW });
  assert.equal(series(sparse, "fuel").eventCount, 2);
  assert.equal(series(sparse, "fuel").sessionCount, 2);
  assert.equal(series(sparse, "fuel").sufficient, false);
  assert.equal(series(sparse, "fuel").medianMinutes, null);

  const medianReady = domain.athleteTrainingNutritionTiming({
    sessions,
    logs: [...firstTwo, log("three-3", "fuel", "2026-08-10T07:30:00.000Z", "s1")],
    now: NOW
  });
  assert.equal(series(medianReady, "fuel").eventCount, 3);
  assert.equal(series(medianReady, "fuel").sessionCount, 2);
  assert.equal(series(medianReady, "fuel").sufficient, true);
  assert.equal(series(medianReady, "fuel").medianMinutes, 20);
  assert.equal(series(medianReady, "fuel").summarySupported, false);

  const clustered = domain.athleteTrainingNutritionTiming({
    sessions,
    logs: [
      log("cluster-1", "fuel", "2026-08-10T07:16:00.000Z", "s1"),
      log("cluster-2", "fuel", "2026-08-11T07:18:00.000Z", "s2"),
      log("cluster-3", "fuel", "2026-08-12T07:20:00.000Z", "s3"),
      log("spread-1", "fuel", "2026-08-10T07:40:00.000Z", "s1"),
      log("spread-2", "fuel", "2026-08-11T08:05:00.000Z", "s2"),
      log("spread-3", "fuel", "2026-08-12T08:35:00.000Z", "s3")
    ],
    now: NOW
  });
  const clusteredFuel = series(clustered, "fuel");
  assert.equal(clusteredFuel.eventCount, 6);
  assert.equal(clusteredFuel.sessionCount, 3);
  assert.equal(clusteredFuel.summarySupported, true);
  assert.deepEqual(clusteredFuel.typicalWindow, {
    startMinute: 15,
    endMinute: 30,
    eventCount: 3,
    sessionCount: 3,
    share: 50
  });
});

test("Analytics markup keeps exact empty states and distinct Fuel and Hydration visual identities", () => {
  const helpers = analyticsHelpers();
  const empty = domain.athleteTrainingNutritionTiming({ now: NOW });
  const markup = helpers.trainingNutritionTimingMarkup(empty);
  const supplementEmpty = "Not enough Training Mode supplement data yet. Log supplements during more training sessions to build your pattern.";
  const intakeEmpty = "Not enough Training Mode fuel and hydration data yet. Log fuel or hydration during more training sessions to build your pattern.";

  assert.equal(markup.split(supplementEmpty).length - 1, 1);
  assert.equal(markup.split(intakeEmpty).length - 1, 1);
  assert.match(markup, /class="athlete-training-timing-card supplement"/);
  assert.match(markup, /class="athlete-training-timing-card intake"/);
  assert.match(markup, /class="athlete-training-timing-legend"[^>]*>[\s\S]*<span class="fuel"><i><\/i>Fuel<\/span>[\s\S]*<span class="hydration"><i><\/i>Hydration<\/span>/);
  assert.match(analyticsSource, /class="athlete-training-timing-series \$\{kindClass\}/);
  assert.match(analyticsStyles, /\.athlete-training-timing-series\.fuel\s*\{\s*--timing-color:\s*#c2852f;/);
  assert.match(analyticsStyles, /\.athlete-training-timing-series\.hydration\s*\{\s*--timing-color:\s*#238cb7;/);
  assert.match(analyticsStyles, /\.athlete-training-timing-legend \.hydration i\s*\{[^}]*border-radius:\s*2px;[^}]*background:\s*#238cb7;/);
});
