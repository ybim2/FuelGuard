const test = require("node:test");
const assert = require("node:assert/strict");

const adherence = require("../fuel-adherence-context.js");

function fuel(id, timestamp, userId = "athlete-a") {
  return { id, user_id: userId, type: "fuel", logged_at: timestamp };
}

function sleepy(timestamp) {
  return { id: `sleepy-${timestamp}`, type: "sleepy", logged_at: timestamp };
}

test("completed gaps calculate target and exceeded-by without counting overnight intervals", () => {
  const gaps = adherence.fuelGapEpisodes({
    logs: [
      fuel("one", "2026-08-07T08:00:00Z"),
      fuel("two", "2026-08-07T11:49:00Z"),
      fuel("three", "2026-08-08T08:00:00Z")
    ],
    targetMinutes: 180,
    includeOngoing: false
  });

  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].actualMinutes, 229);
  assert.equal(gaps[0].targetMinutes, 180);
  assert.equal(gaps[0].exceededMinutes, 49);
  assert.equal(gaps[0].gapKey, "completed:one:two");
});

test("a gap below target has zero exceeded-by and does not become meaningful", () => {
  const [gap] = adherence.fuelGapEpisodes({
    logs: [fuel("one", "2026-08-07T08:00:00Z"), fuel("two", "2026-08-07T10:30:00Z")],
    targetMinutes: 180,
    includeOngoing: false
  });
  assert.equal(gap.actualMinutes, 150);
  assert.equal(gap.exceededMinutes, 0);
  assert.equal(gap.isMeaningful, false);
});

test("every confirmed over-target interval is counted even when it is too small to prompt", () => {
  const gaps = adherence.fuelGapEpisodes({
    logs: [fuel("one", "2026-08-07T08:00:00Z"), fuel("two", "2026-08-07T11:05:00Z")],
    targetMinutes: 180,
    includeOngoing: false
  });
  assert.equal(gaps[0].exceededMinutes, 5);
  assert.equal(gaps[0].isMeaningful, false);
  const summary = adherence.summarizeAdherence({ gaps });
  assert.equal(summary.targetExceedanceCount, 1);
  assert.equal(summary.averageExceededMinutes, 5);
});

test("ongoing gaps use current time but remain distinct from completed gap keys", () => {
  const [gap] = adherence.fuelGapEpisodes({
    logs: [fuel("one", "2026-08-07T08:00:00Z")],
    targetMinutes: 180,
    referenceTime: "2026-08-07T12:15:00Z"
  });
  assert.equal(gap.ongoing, true);
  assert.equal(gap.actualMinutes, 255);
  assert.equal(gap.exceededMinutes, 75);
  assert.equal(gap.gapKey, "ongoing:one:current");
});

test("exact overlap handles sessions beginning inside, before, and ending after a gap", () => {
  const gap = {
    date: "2026-08-07",
    start: new Date("2026-08-07T12:00:00Z"),
    end: new Date("2026-08-07T16:00:00Z"),
    actualMinutes: 240
  };
  const sessions = [
    { id: "inside", starts_at: "2026-08-07T13:00:00Z", ends_at: "2026-08-07T14:00:00Z", source: "garmin" },
    { id: "before", starts_at: "2026-08-07T11:30:00Z", ends_at: "2026-08-07T12:30:00Z", source: "garmin" },
    { id: "after", starts_at: "2026-08-07T15:30:00Z", ends_at: "2026-08-07T17:00:00Z", source: "garmin_health_api" }
  ];
  const training = adherence.trainingContextForGap(gap, { exactSessions: sessions });
  assert.equal(training.precision, "exact");
  assert.equal(training.overlaps, true);
  assert.equal(training.sessions.length, 3);
  assert.equal(training.overlapMinutes, 120);
  assert.equal(training.overlapPct, 50);
});

test("an exact non-overlapping session suppresses imprecise period fallback", () => {
  const gap = {
    date: "2026-08-07",
    start: new Date("2026-08-07T12:00:00Z"),
    end: new Date("2026-08-07T16:00:00Z"),
    actualMinutes: 240
  };
  const training = adherence.trainingContextForGap(gap, {
    exactSessions: [{ starts_at: "2026-08-07T18:00:00Z", ends_at: "2026-08-07T19:00:00Z", source: "garmin" }],
    dailyContexts: [{ context_date: "2026-08-07", training_periods: ["afternoon"] }]
  });
  assert.equal(training.precision, "exact");
  assert.equal(training.overlaps, false);
  assert.deepEqual(training.periods, []);
});

test("reliable Garmin timing takes precedence over other exact session sources", () => {
  const gap = {
    date: "2026-08-07",
    start: new Date("2026-08-07T12:00:00Z"),
    end: new Date("2026-08-07T16:00:00Z"),
    actualMinutes: 240
  };
  const training = adherence.trainingContextForGap(gap, {
    exactSessions: [
      { starts_at: "2026-08-07T18:00:00Z", ends_at: "2026-08-07T19:00:00Z", source: "garmin_health_api" },
      { starts_at: "2026-08-07T13:00:00Z", ends_at: "2026-08-07T14:00:00Z", source: "demand_block" }
    ]
  });
  assert.equal(training.precision, "exact");
  assert.equal(training.overlaps, false);
  assert.equal(training.sessions.length, 0);
});

test("manual Morning, Afternoon, and Evening remain classifications rather than fabricated times", () => {
  const gap = {
    date: "2026-08-07",
    start: new Date("2026-08-07T11:30:00"),
    end: new Date("2026-08-07T18:30:00"),
    actualMinutes: 420
  };
  const training = adherence.trainingContextForGap(gap, {
    dailyContexts: [{ context_date: "2026-08-07", training_periods: ["morning", "afternoon", "evening"] }]
  });
  assert.equal(training.precision, "period");
  assert.equal(training.overlaps, true);
  assert.deepEqual(training.periods.map(item => item.id), ["morning", "afternoon", "evening"]);
  assert.equal(training.overlapMinutes, null);
  assert.equal(training.overlapPct, null);
});

test("No Training clears all manual period selections", () => {
  assert.deepEqual(adherence.normalizePeriods(["morning", "none", "evening"]), []);
  assert.deepEqual(adherence.normalizeDailyContext({ training_periods: ["no_training"] }).trainingPeriods, []);
});

test("barrier response uses a stable completed episode and skipped responses remain Unknown", () => {
  const [gap] = adherence.fuelGapEpisodes({
    logs: [fuel("one", "2026-08-07T08:00:00Z"), fuel("two", "2026-08-07T12:30:00Z")],
    targetMinutes: 180,
    includeOngoing: false
  });
  const response = adherence.barrierRecordFromGap(gap, { reason: "unknown", userId: "athlete-a" });
  assert.equal(response.gapKey, "completed:one:two");
  assert.equal(response.responseStatus, "skipped");
  assert.equal(response.barrierReason, "unknown");
});

test("fuelled but not logged is timing uncertainty and never fabricates an event", () => {
  const logs = [fuel("one", "2026-08-07T08:00:00Z"), fuel("two", "2026-08-07T12:30:00Z")];
  const [gap] = adherence.fuelGapEpisodes({ logs, targetMinutes: 180, includeOngoing: false });
  const response = adherence.barrierRecordFromGap(gap, { reason: "fuelled_not_logged" });
  assert.equal(response.dataQualityStatus, "timing_uncertain");
  assert.equal(logs.length, 2);
  assert.equal(response.actualMinutes, 270);
});

test("adherence summary excludes timing-uncertain gaps and preserves denominator detail", () => {
  const logs = [
    fuel("one", "2026-08-07T08:00:00Z"),
    fuel("two", "2026-08-07T12:30:00Z"),
    fuel("three", "2026-08-07T16:30:00Z")
  ];
  const base = adherence.fuelGapEpisodes({ logs, targetMinutes: 180, includeOngoing: false });
  const responses = [
    adherence.barrierRecordFromGap(base[0], { reason: "fuelled_not_logged" }),
    adherence.barrierRecordFromGap(base[1], { reason: "busy" })
  ];
  const gaps = adherence.enrichGaps(base, { barrierResponses: responses });
  const summary = adherence.summarizeAdherence({ gaps });
  assert.equal(summary.loggingUncertainCount, 1);
  assert.equal(summary.behaviouralGapCount, 1);
  assert.equal(summary.targetExceedanceCount, 1);
  assert.equal(summary.averageExceededMinutes, 60);
  assert.equal(summary.medianExceededMinutes, 60);
});

test("summary reports explicit training denominator, barriers, context, and observational Sleepy proximity", () => {
  const logs = [
    fuel("one", "2026-08-07T08:00:00Z"),
    fuel("two", "2026-08-07T12:30:00Z"),
    fuel("three", "2026-08-07T16:30:00Z")
  ];
  const base = adherence.fuelGapEpisodes({ logs, targetMinutes: 180, includeOngoing: false });
  const responses = base.map(gap => adherence.barrierRecordFromGap(gap, { reason: "no_food_available" }));
  const contexts = [{ context_date: "2026-08-07", environment_context: "travel", training_periods: ["afternoon"] }];
  const gaps = adherence.enrichGaps(base, { dailyContexts: contexts, barrierResponses: responses });
  const summary = adherence.summarizeAdherence({
    gaps,
    dailyContexts: contexts,
    sleepyLogs: [sleepy("2026-08-07T12:00:00Z"), sleepy("2026-08-07T17:00:00Z")]
  });
  assert.equal(summary.targetExceedanceCount, 2);
  assert.equal(summary.trainingOverlapCount, 2);
  assert.equal(summary.trainingOverlapDenominator, 2);
  assert.equal(summary.mostCommonBarrier.id, "no_food_available");
  assert.deepEqual(summary.environmentContextCounts, [{ id: "travel", count: 2 }]);
  assert.equal(summary.sleepyAssociationCount, 2);
});

test("team aggregation remains reusable without exposing athlete records", () => {
  const team = adherence.aggregateTeamAdherence([
    {
      measurableGapCount: 3,
      targetExceedanceCount: 2,
      trainingOverlapCount: 1,
      barrierCounts: [{ id: "busy", label: "Busy", count: 2 }]
    },
    {
      measurableGapCount: 0,
      targetExceedanceCount: 1,
      trainingOverlapCount: 1,
      barrierCounts: [{ id: "busy", label: "Busy", count: 1 }]
    }
  ]);
  assert.equal(team.athleteCount, 2);
  assert.equal(team.athletesWithExcessiveGaps, 2);
  assert.equal(team.trainingOverlapPct, 67);
  assert.equal(team.barrierCounts[0].count, 3);
  assert.equal(team.athletesWithInsufficientData, 1);
});
