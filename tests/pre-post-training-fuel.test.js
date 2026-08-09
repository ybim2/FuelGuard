const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const domain = require("../fuel-guard-domain.js");
const garminHealth = require("../lib/garmin-health.js");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function workout({ id = "workout-a", athleteId = "athlete-a", startAt, endAt, source = "manual", sourceActivityId = "", type = "run" }) {
  return { id, athleteId, startAt, endAt, source, sourceActivityId, type };
}

function log(timestamp, { athleteId = "athlete-a", type = "fuel", id = timestamp } = {}) {
  return { id, user_id: athleteId, logged_at: timestamp, type, source: "manual" };
}

function renderAthleteTrainingFuel(state) {
  const target = { innerHTML: "" };
  const sandbox = {
    Date,
    Intl,
    console,
    fuelGapState: () => state,
    requestAnimationFrame: () => 0,
    document: {
      hidden: false,
      addEventListener: () => {},
      getElementById: id => id === "trainingFuelAnalysis" ? target : null
    },
    window: {
      FuelGuardDomain: domain,
      fuelGuardCloud: null,
      addEventListener: () => {}
    }
  };
  vm.runInNewContext(read("training-fuel.js"), sandbox, { filename: "training-fuel.js" });
  sandbox.window.FuelGuardTrainingFuel.render();
  return target.innerHTML;
}

test("matches the nearest strict-before and strict-after fuel events", () => {
  const context = domain.getWorkoutFuelContext(workout({
    startAt: "2026-08-08T20:00:00Z",
    endAt: "2026-08-08T20:50:00Z"
  }), [
    log("2026-08-08T12:00:00Z"),
    log("2026-08-08T15:30:00Z"),
    log("2026-08-08T22:05:00Z"),
    log("2026-08-08T23:00:00Z")
  ]);

  assert.equal(context.previousFuelEvent.timestamp, "2026-08-08T15:30:00.000Z");
  assert.equal(context.nextFuelEvent.timestamp, "2026-08-08T22:05:00.000Z");
  assert.equal(context.preFuelGapMinutes, 270);
  assert.equal(context.postFuelGapMinutes, 75);
});

test("ignores hydration-only events while fuel_hydration remains valid fuel", () => {
  const context = domain.getWorkoutFuelContext(workout({
    startAt: "2026-08-08T20:00:00Z",
    endAt: "2026-08-08T21:00:00Z"
  }), [
    log("2026-08-08T18:00:00Z", { type: "fuel_hydration" }),
    log("2026-08-08T19:30:00Z", { type: "hydration" }),
    log("2026-08-08T21:10:00Z", { type: "hydration" }),
    log("2026-08-08T21:30:00Z", { type: "fuel" })
  ]);

  assert.equal(context.preFuelGapMinutes, 120);
  assert.equal(context.postFuelGapMinutes, 30);
  assert.equal(context.previousFuelEvent.type, "fuel_hydration");
});

test("returns explicit null gaps when prior or subsequent fuel is unavailable", () => {
  const noPrior = domain.getWorkoutFuelContext(workout({
    startAt: "2026-08-08T10:00:00Z",
    endAt: "2026-08-08T11:00:00Z"
  }), [log("2026-08-08T12:00:00Z")]);
  const noPost = domain.getWorkoutFuelContext(workout({
    startAt: "2026-08-08T10:00:00Z",
    endAt: "2026-08-08T11:00:00Z"
  }), [log("2026-08-08T09:00:00Z")]);

  assert.equal(noPrior.hasPreviousFuel, false);
  assert.equal(noPrior.preFuelGapMinutes, null);
  assert.equal(noPost.hasPostFuel, false);
  assert.equal(noPost.postFuelGapMinutes, null);
});

test("events exactly at workout boundaries or during training are not matched", () => {
  const context = domain.getWorkoutFuelContext(workout({
    startAt: "2026-08-08T20:00:00Z",
    endAt: "2026-08-08T21:00:00Z"
  }), [
    log("2026-08-08T18:00:00Z", { id: "before" }),
    log("2026-08-08T20:00:00Z", { id: "at-start" }),
    log("2026-08-08T20:30:00Z", { id: "during" }),
    log("2026-08-08T21:00:00Z", { id: "at-end" }),
    log("2026-08-08T21:15:00Z", { id: "after" })
  ]);

  assert.equal(context.previousFuelEvent.id, "before");
  assert.equal(context.nextFuelEvent.id, "after");
});

test("multiple and overlapping workouts are analysed independently", () => {
  const contexts = domain.getWorkoutFuelContexts([
    workout({ id: "one", startAt: "2026-08-08T09:00:00Z", endAt: "2026-08-08T10:00:00Z" }),
    workout({ id: "two", startAt: "2026-08-08T09:30:00Z", endAt: "2026-08-08T10:30:00Z" }),
    workout({ id: "three", startAt: "2026-08-08T18:00:00Z", endAt: "2026-08-08T19:00:00Z" })
  ], [
    log("2026-08-08T08:00:00Z", { id: "morning" }),
    log("2026-08-08T10:15:00Z", { id: "between-overlaps" }),
    log("2026-08-08T17:00:00Z", { id: "evening" }),
    log("2026-08-08T20:00:00Z", { id: "night" })
  ]);
  const byId = new Map(contexts.map(context => [context.workout.id, context]));

  assert.equal(byId.get("one").nextFuelEvent.id, "between-overlaps");
  assert.equal(byId.get("two").nextFuelEvent.id, "evening");
  assert.equal(byId.get("three").previousFuelEvent.id, "evening");
});

test("workouts crossing midnight use absolute timestamps", () => {
  const context = domain.getWorkoutFuelContext(workout({
    startAt: "2026-08-08T23:40:00Z",
    endAt: "2026-08-09T00:20:00Z"
  }), [
    log("2026-08-08T22:10:00Z"),
    log("2026-08-09T00:50:00Z")
  ]);

  assert.equal(context.preFuelGapMinutes, 90);
  assert.equal(context.postFuelGapMinutes, 30);
});

test("duplicate Garmin activities are collapsed across devices", () => {
  const normalized = domain.normalizeWorkouts([
    { id: "row-a", user_id: "athlete-a", source: "garmin_connect_iq_local", source_activity_id: "activity-42", device_id: "watch-a", activity_type: "run", started_at: "2026-08-08T10:00:00Z", duration_seconds: 3600 },
    { id: "row-b", user_id: "athlete-a", source: "garmin_connect_iq_local", source_activity_id: "activity-42", device_id: "watch-b", activity_type: "run", started_at: "2026-08-08T10:00:00Z", duration_seconds: 3600 }
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].source, "garmin");
});

test("deleted or edited fuel timestamps are reflected on recomputation", () => {
  const session = workout({ startAt: "2026-08-08T20:00:00Z", endAt: "2026-08-08T21:00:00Z" });
  const original = domain.getWorkoutFuelContext(session, [log("2026-08-08T18:00:00Z", { id: "editable" })]);
  const edited = domain.getWorkoutFuelContext(session, [log("2026-08-08T17:00:00Z", { id: "editable" })]);
  const deleted = domain.getWorkoutFuelContext(session, []);

  assert.equal(original.preFuelGapMinutes, 120);
  assert.equal(edited.preFuelGapMinutes, 180);
  assert.equal(deleted.preFuelGapMinutes, null);
});

test("athlete matching never crosses user boundaries", () => {
  const contexts = domain.getWorkoutFuelContexts([
    workout({ id: "a", athleteId: "athlete-a", startAt: "2026-08-08T10:00:00Z", endAt: "2026-08-08T11:00:00Z" }),
    workout({ id: "b", athleteId: "athlete-b", startAt: "2026-08-08T10:00:00Z", endAt: "2026-08-08T11:00:00Z" })
  ], [
    log("2026-08-08T09:00:00Z", { athleteId: "athlete-a", id: "fuel-a" }),
    log("2026-08-08T08:00:00Z", { athleteId: "athlete-b", id: "fuel-b" })
  ]);

  assert.equal(contexts.find(context => context.athleteId === "athlete-a").previousFuelEvent.id, "fuel-a");
  assert.equal(contexts.find(context => context.athleteId === "athlete-b").previousFuelEvent.id, "fuel-b");
});

test("aggregates average gaps, configured-target patterns, and missing same-day fuel", () => {
  const contexts = domain.getWorkoutFuelContexts([
    workout({ id: "one", startAt: "2026-08-08T10:00:00Z", endAt: "2026-08-08T11:00:00Z" }),
    workout({ id: "two", startAt: "2026-08-09T10:00:00Z", endAt: "2026-08-09T11:00:00Z" }),
    workout({ id: "three", startAt: "2026-08-10T10:00:00Z", endAt: "2026-08-10T11:00:00Z" })
  ], [
    log("2026-08-08T06:00:00Z"), log("2026-08-08T12:00:00Z"),
    log("2026-08-09T07:00:00Z"), log("2026-08-09T13:00:00Z"),
    log("2026-08-10T09:00:00Z")
  ]);
  const summary = domain.aggregateWorkoutFuelContexts(contexts, { targetMinutes: 180, timeZone: "UTC" });

  assert.equal(summary.averagePreFuelGapMinutes, 160);
  assert.equal(summary.averagePostFuelGapMinutes, 90);
  assert.equal(summary.extendedPreFuelGapCount, 1);
  assert.equal(summary.noPostFuelSameDayCount, 1);
  assert.equal(summary.enoughForPatterns, true);
});

test("withholds aggregate averages and pattern claims for insufficient data", () => {
  const contexts = domain.getWorkoutFuelContexts([
    workout({ startAt: "2026-08-08T10:00:00Z", endAt: "2026-08-08T11:00:00Z" })
  ], [log("2026-08-08T09:00:00Z"), log("2026-08-08T12:00:00Z")]);
  const summary = domain.aggregateWorkoutFuelContexts(contexts, { targetMinutes: 180, timeZone: "UTC" });

  assert.equal(summary.averagePreFuelGapMinutes, null);
  assert.equal(summary.averagePostFuelGapMinutes, null);
  assert.equal(summary.enoughForPatterns, false);
});

test("athlete UI derives exact pre/post wording for multiple real session timings", () => {
  const examples = [
    {
      title: "Example A",
      fuelBefore: "2026-08-07T15:18:00Z",
      start: "2026-08-07T18:30:00Z",
      end: "2026-08-07T19:15:00Z",
      fuelAfter: "2026-08-07T19:57:00Z",
      beforeCopy: "3h 12m since last fuel",
      afterCopy: "42m post-training to fuel"
    },
    {
      title: "Example B",
      fuelBefore: "2026-08-07T17:03:00Z",
      start: "2026-08-07T20:00:00Z",
      end: "2026-08-07T20:48:00Z",
      fuelAfter: "2026-08-07T22:15:00Z",
      beforeCopy: "2h 57m since last fuel",
      afterCopy: "1h 27m post-training to fuel"
    },
    {
      title: "Example C",
      fuelBefore: "2026-08-07T17:45:00Z",
      start: "2026-08-07T18:30:00Z",
      end: "2026-08-07T19:30:00Z",
      fuelAfter: "2026-08-07T19:44:00Z",
      beforeCopy: "45m since last fuel",
      afterCopy: "14m post-training to fuel"
    }
  ];

  examples.forEach(example => {
    const html = renderAthleteTrainingFuel({
      maximumFuelGapMinutes: 180,
      demandBlocks: [{
        id: example.title,
        type: "training",
        sessionType: "run",
        title: example.title,
        startTime: example.start,
        endTime: example.end
      }],
      logs: [
        log(example.fuelBefore, { athleteId: "" }),
        log(example.fuelAfter, { athleteId: "" })
      ]
    });

    assert.match(html, new RegExp(example.title));
    assert.match(html, new RegExp(example.beforeCopy));
    assert.match(html, new RegExp(example.afterCopy));
  });
});

test("athlete UI renders missing events explicitly without a fabricated zero", () => {
  const noPrior = renderAthleteTrainingFuel({
    maximumFuelGapMinutes: 180,
    demandBlocks: [{ type: "training", startTime: "2026-08-07T20:00:00Z", endTime: "2026-08-07T20:50:00Z" }],
    logs: [log("2026-08-07T22:05:00Z", { athleteId: "" })]
  });
  const noPost = renderAthleteTrainingFuel({
    maximumFuelGapMinutes: 180,
    demandBlocks: [{ type: "training", startTime: "2026-08-07T20:00:00Z", endTime: "2026-08-07T20:50:00Z" }],
    logs: [log("2026-08-07T15:30:00Z", { athleteId: "" })]
  });

  assert.match(noPrior, /No pre-training fuel logged/);
  assert.match(noPost, /No post-training fuel logged/);
  assert.doesNotMatch(`${noPrior}${noPost}`, />0m</);
});

test("coach attention requires repeated evidence and uses athlete targets", () => {
  const athlete = { userId: "athlete-a", displayName: "Alex Morgan" };
  const contexts = domain.getWorkoutFuelContexts([
    workout({ id: "one", startAt: "2026-08-06T10:00:00Z", endAt: "2026-08-06T11:00:00Z" }),
    workout({ id: "two", startAt: "2026-08-07T10:00:00Z", endAt: "2026-08-07T11:00:00Z" }),
    workout({ id: "three", startAt: "2026-08-08T10:00:00Z", endAt: "2026-08-08T11:00:00Z" })
  ], [
    log("2026-08-06T06:00:00Z"), log("2026-08-07T06:00:00Z"), log("2026-08-08T09:00:00Z")
  ]);
  const summaries = domain.workoutFuelSummariesByAthlete({
    contexts,
    targetsByUser: { "athlete-a": { maximumFuelGapMinutes: 180 } },
    timeZone: "UTC"
  });
  const items = domain.buildCoachAttentionItems({
    roster: [{ athlete, flags: [], lastFuel: null, sleepyLogs: [] }],
    workoutFuelSummaries: summaries,
    now: new Date("2026-08-08T12:00:00Z")
  });

  assert.equal(items.some(item => item.type === "training_repeated_long_pre_gap"), true);
  assert.equal(items.some(item => item.type === "training_missing_post_fuel"), true);
  assert.doesNotMatch(items.map(item => item.detail).join(" "), /under-fuelled|dangerous|bad recovery|low energy availability/i);
});

test("Garmin feature generation uses nearest-event semantics instead of a fixed three-hour window", () => {
  const summary = garminHealth._test.trainingFuelSummary([
    log("2026-08-08T05:00:00Z"),
    log("2026-08-08T13:00:00Z")
  ], [{
    id: "garmin-a",
    started_at: "2026-08-08T10:00:00Z",
    duration_seconds: 3600,
    activity_type: "run"
  }]);

  assert.equal(summary.fuel_events_before_training, 1);
  assert.equal(summary.fuel_events_after_training, 1);
  assert.equal(summary.workouts_missing_pre_fuel, 0);
  assert.equal(summary.workouts_missing_post_fuel, 0);
});

test("migration enforces active-share read access without granting coach writes", () => {
  const sql = read("supabase/migrations/20260808114819_pre_post_training_fuel.sql");
  const noComments = sql.replace(/^--.*$/gm, "");

  assert.match(sql, /garmin_activity_summaries_select_own_or_active_coach[\s\S]*auth\.uid\(\)\) = user_id[\s\S]*private\.fuel_has_direct_athlete_access\(user_id\)/);
  assert.match(sql, /fuel_demand_blocks_select_own_or_active_coach[\s\S]*auth\.uid\(\)\) = user_id[\s\S]*private\.fuel_has_direct_athlete_access\(user_id\)/);
  assert.match(sql, /for select\s+to authenticated/g);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*(garmin_activity_summaries|fuel_demand_blocks)/i);
  assert.doesNotMatch(noComments, /service_role|auth\.role\(\)|raw_user_meta_data|user_metadata/);
  assert.match(sql, /training_repeated_long_pre_gap/);
  assert.match(sql, /training_missing_post_fuel/);
});

test("coach access helper is tied to an active direct athlete relationship", () => {
  const sql = read("supabase/migrations/20260807172400_coach_organisation_foundations.sql");
  const helper = sql.slice(
    sql.indexOf("create or replace function private.fuel_has_direct_athlete_access"),
    sql.indexOf("create or replace function private.fuel_can_access_team_athlete")
  );

  assert.match(helper, /relationship\.coach_id = \(select auth\.uid\(\)\)/);
  assert.match(helper, /relationship\.athlete_id = p_athlete_id/);
  assert.match(helper, /relationship\.status = 'active'/);
});

test("athlete and coach UIs include loading, empty, full-context, and mobile states", () => {
  const html = read("index.html");
  const athleteJs = read("training-fuel.js");
  const athleteCss = read("training-fuel.css");
  const coachJs = read("coach/coach-beta.js");

  assert.match(html, /id="trainingFuelAnalysis"/);
  assert.match(athleteJs, /Loading recent training sessions/);
  assert.match(athleteJs, /Log fuel around your training to start seeing patterns/);
  assert.match(athleteJs, /Connect your training data to see how your fuelling lines up with your sessions/);
  assert.match(athleteJs, /No pre-training fuel logged/);
  assert.match(athleteJs, /No post-training fuel logged/);
  assert.match(athleteJs, /averagePreFuelGapMinutes/);
  assert.match(athleteCss, /@media \(max-width: 560px\)/);
  assert.match(coachJs, /function renderCoachWorkoutFuel/);
  assert.match(coachJs, /workoutFuelSummaries:/);
  assert.match(coachJs, /\.in\("user_id", athleteIds\)/);
});
