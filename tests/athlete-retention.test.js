const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function log(timestamp, type = "fuel", extra = {}) {
  return { id: `${timestamp}-${type}`, user_id: "athlete-a", logged_at: timestamp, type, source: "manual", ...extra };
}

test("Weekly Recap uses the previous complete Monday-Sunday in the Athlete timezone", () => {
  const utc = domain.athleteWeeklyRecap({ now: new Date("2026-08-10T09:00:00Z"), timeZone: "UTC" });
  const losAngeles = domain.athleteWeeklyRecap({ now: new Date("2026-08-10T00:30:00Z"), timeZone: "America/Los_Angeles" });
  assert.deepEqual([utc.period.startKey, utc.period.endKey], ["2026-08-03", "2026-08-09"]);
  assert.deepEqual([losAngeles.period.startKey, losAngeles.period.endKey], ["2026-07-27", "2026-08-02"]);
});

test("Weekly Recap handles an empty week without manufacturing missed-fuelling claims", () => {
  const recap = domain.athleteWeeklyRecap({ now: new Date("2026-08-10T09:00:00Z"), timeZone: "UTC" });
  assert.equal(recap.coverage.loggedDays, 0);
  assert.equal(recap.longestObservedGapMinutes, null);
  assert.equal(recap.averageObservedGapMinutes, null);
  assert.equal(recap.comparison.daysRemaining, 6);
  assert.match(recap.areas[0], /No Fuel Guard records were available/);
  assert.doesNotMatch(JSON.stringify(recap), /failed to fuel|skipped food|didn't eat|missed food/i);
});

test("Weekly Recap reports partial Fuel and Hydration coverage, streaks and observed gaps", () => {
  const recap = domain.athleteWeeklyRecap({
    logs: [
      log("2026-08-03T08:00:00Z"), log("2026-08-03T12:00:00Z"), log("2026-08-03T13:00:00Z", "hydration"),
      log("2026-08-04T08:00:00Z"), log("2026-08-04T12:00:00Z"),
      log("2026-08-05T09:00:00Z", "hydration")
    ],
    targets: { maximumFuelGapMinutes: 180 },
    now: new Date("2026-08-10T09:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(recap.coverage.loggedDays, 3);
  assert.equal(recap.loggingStreak, 3);
  assert.equal(recap.fuelMoments, 4);
  assert.equal(recap.hydrationMoments, 2);
  assert.equal(recap.longestObservedGapMinutes, 240);
  assert.equal(recap.averageObservedGapMinutes, 240);
  assert.equal(recap.commonLongGapWindow, "08:00-13:00");
});

test("Weekly Recap includes completed Training Mode sessions and recorded session activity", () => {
  const recap = domain.athleteWeeklyRecap({
    logs: [
      log("2026-08-04T09:00:00Z", "fuel", { training_mode_session_id: "session-a", source: "garmin" }),
      log("2026-08-04T09:30:00Z", "hydration", { training_mode_session_id: "session-a" })
    ],
    sessions: [
      { id: "session-a", status: "completed", started_at: "2026-08-04T08:00:00Z", ended_at: "2026-08-04T10:00:00Z" },
      { id: "session-b", status: "completed", started_at: "2026-08-06T08:00:00Z", ended_at: "2026-08-06T09:00:00Z" },
      { id: "session-outside", status: "completed", started_at: "2026-08-10T08:00:00Z", ended_at: "2026-08-10T09:00:00Z" }
    ],
    now: new Date("2026-08-10T09:00:00Z"),
    timeZone: "UTC"
  });
  assert.equal(recap.trainingSessions, 2);
  assert.equal(recap.trainingSessionsWithRecordedActivity, 1);
  assert.match(recap.areas.join(" "), /1 completed training session had no Fuel or Hydration activity recorded/);
});

test("Weekly Recap compares weeks only with sufficient underlying coverage", () => {
  const logs = [];
  for (const day of ["2026-07-27", "2026-07-28", "2026-07-29"]) {
    logs.push(log(`${day}T08:00:00Z`), log(`${day}T13:00:00Z`));
  }
  for (const day of ["2026-08-03", "2026-08-04", "2026-08-05"]) {
    logs.push(log(`${day}T08:00:00Z`), log(`${day}T12:00:00Z`));
  }
  const recap = domain.athleteWeeklyRecap({ logs, targets: { maximumFuelGapMinutes: 180 }, now: new Date("2026-08-10T09:00:00Z"), timeZone: "UTC" });
  assert.equal(recap.comparison.available, true);
  assert.equal(recap.comparison.daysRemaining, 0);
  assert.equal(recap.comparison.direction, "improved");
  assert.match(recap.comparison.label, /Average fuel gaps were 1h 00m shorter/);
});

test("Weekly Recap countdown uses the comparison thresholds with correct singular copy", () => {
  const logs = [];
  for (const day of ["2026-07-27", "2026-07-28", "2026-07-29"]) {
    logs.push(log(`${day}T08:00:00Z`), log(`${day}T12:00:00Z`));
  }
  for (const day of ["2026-08-03", "2026-08-04"]) {
    logs.push(log(`${day}T08:00:00Z`), log(`${day}T12:00:00Z`));
  }
  const recap = domain.athleteWeeklyRecap({ logs, now: new Date("2026-08-10T09:00:00Z"), timeZone: "UTC" });
  assert.equal(recap.comparison.available, false);
  assert.equal(recap.comparison.daysRemaining, 1);
  const renderer = read("athlete-retention.js");
  assert.match(renderer, /daysRemaining === 1 \? "" : "s"/);
  assert.match(renderer, /more day.*of data needed/);
});

test("Weekly Recap is deterministic across refreshes for the same data and clock", () => {
  const input = {
    logs: [log("2026-08-03T08:00:00Z"), log("2026-08-03T11:00:00Z")],
    now: new Date("2026-08-10T09:00:00Z"),
    timeZone: "UTC"
  };
  assert.deepEqual(domain.athleteWeeklyRecap(input), domain.athleteWeeklyRecap(input));
});

test("Points level progression always identifies the current and next credible milestone", () => {
  const progress = domain.athletePointLevelProgress(430);
  assert.equal(progress.current.title, "Building consistency");
  assert.equal(progress.next.title, "Established routine");
  assert.equal(progress.remaining, 70);
  assert.equal(progress.progressPct, 72);
  assert.deepEqual(progress.levels.filter(level => level.achieved).map(level => level.threshold), [0, 250]);
  const complete = domain.athletePointLevelProgress(2500);
  assert.equal(complete.next, null);
  assert.equal(complete.remaining, 0);
  assert.equal(complete.progressPct, 100);
});

test("Training completion summary separates actual, planned, event counts and post-training timing", () => {
  const session = {
    id: "session-a", user_id: "athlete-a", title: "Long ride", status: "completed",
    started_at: "2026-08-09T08:00:00Z", ended_at: "2026-08-09T10:00:00Z", estimated_duration_minutes: 120,
    plan: { carbsG: 60, fluidMl: 600, sodiumMg: 500, caffeineMg: 20 }
  };
  const summary = domain.trainingCompletionSummary({
    session,
    logs: [
      log("2026-08-09T09:00:00Z", "fuel", { source: "garmin", training_mode_session_id: "session-a", carbs_g: 30, caffeine_mg: 10 }),
      log("2026-08-09T09:30:00Z", "hydration", { training_mode_session_id: "session-a", fluid_ml: 500, sodium_mg: 300 }),
      log("2026-08-09T10:24:00Z")
    ],
    now: new Date("2026-08-09T11:00:00Z")
  });
  assert.equal(summary.fuelEventCount, 1);
  assert.equal(summary.hydrationEventCount, 1);
  assert.deepEqual(summary.totals, { carbsG: 30, fluidMl: 500, sodiumMg: 300, caffeineMg: 10 });
  assert.deepEqual(summary.planned.totals, { carbsG: 120, fluidMl: 1200, sodiumMg: 1000, caffeineMg: 40 });
  assert.equal(summary.postFuelGapMinutes, 24);
  assert.equal(summary.actualPerHour.carbsG, 15);
});

test("Training completion summary hides rates for incomplete and very short sessions", () => {
  const incomplete = domain.trainingCompletionSummary({
    session: { id: "active", status: "active", started_at: "2026-08-09T08:00:00Z" },
    logs: [log("2026-08-09T08:05:00Z", "fuel", { training_mode_session_id: "active", carbs_g: 20 })],
    now: new Date("2026-08-09T09:00:00Z")
  });
  const short = domain.trainingCompletionSummary({
    session: { id: "short", status: "completed", started_at: "2026-08-09T08:00:00Z", ended_at: "2026-08-09T08:10:00Z" },
    logs: [log("2026-08-09T08:05:00Z", "fuel", { training_mode_session_id: "short", carbs_g: 20 })]
  });
  assert.equal(incomplete.actualPerHour.carbsG, null);
  assert.match(incomplete.coverageMessage, /not complete/);
  assert.equal(short.actualPerHour.carbsG, null);
  assert.match(short.coverageMessage, /under 15 minutes/);
});

test("Training completion summary is honest when Fuel or Hydration is not recorded", () => {
  const summary = domain.trainingCompletionSummary({
    session: { id: "empty", title: "Run", status: "completed", started_at: "2026-08-09T08:00:00Z", ended_at: "2026-08-09T09:00:00Z" },
    logs: []
  });
  assert.equal(summary.fuelEventCount, 0);
  assert.equal(summary.hydrationEventCount, 0);
  assert.equal(summary.postFuelGapMinutes, null);
  assert.match(summary.coverageMessage, /No Fuel or Hydration event was recorded/);
  assert.doesNotMatch(summary.coverageMessage, /failed|skipped|didn't/i);
});

test("Contextual nudge eligibility uses recorded evidence and category controls", () => {
  const maximumGap = domain.athleteNudgeEligibility({
    logs: [log("2026-08-10T08:00:00Z")],
    targets: { maximumFuelGapMinutes: 180 },
    now: new Date("2026-08-10T10:45:00Z"),
    timeZone: "UTC"
  });
  assert.equal(maximumGap[0].id, "maximum_fuel_gap");
  assert.match(maximumGap[0].title, /2h 45m since your last recorded Fuel/);
  assert.equal(domain.athleteNudgeEligibility({
    logs: [log("2026-08-10T08:00:00Z")],
    targets: { maximumFuelGapMinutes: 180 },
    preferences: { maximumGap: false },
    now: new Date("2026-08-10T10:45:00Z")
  }).some(item => item.id === "maximum_fuel_gap"), false);
});

test("Post-training and Training Mode nudges are contextual and deduplicatable", () => {
  const completed = domain.athleteNudgeEligibility({
    logs: [],
    sessions: [{ id: "done", status: "completed", started_at: "2026-08-10T08:00:00Z", ended_at: "2026-08-10T09:00:00Z" }],
    now: new Date("2026-08-10T09:30:00Z"),
    timeZone: "UTC"
  });
  assert.equal(completed[0].id, "post_training_fuel");
  assert.match(completed[0].detail, /No post-training Fuel has been recorded yet/);
  const active = domain.athleteNudgeEligibility({
    logs: [],
    sessions: [{ id: "active", status: "active", started_at: "2026-08-10T10:00:00Z", fuel_interval_minutes: 30 }],
    preferences: { maximumGap: false, postTraining: false, trainingMode: true },
    now: new Date("2026-08-10T10:25:00Z"),
    timeZone: "UTC"
  });
  assert.equal(active[0].id, "training_fuel_window");
  assert.match(active[0].occurrenceKey, /^training_mode:active:/);
  assert.equal(active[0].minimumIntervalMinutes, 30);
});

test("Athlete UI exposes Weekly Recap, progression, preferences and safe Coach feedback beside Reflection", () => {
  const html = read("index.html");
  const retention = read("athlete-retention.js");
  const milestones = read("athlete-milestones.js");
  const training = read("training-mode.js");
  assert.match(html, /id="athleteWeeklyRecapCard"/);
  assert.match(html, /id="athleteNudgePreferences"/);
  assert.match(html, /id="athleteCoachReviewFeed"/);
  assert.match(retention, /recap\.evidenceNote/);
  assert.match(read("fuel-guard-domain.js"), /This recap describes recorded Fuel Guard activity/);
  assert.match(milestones, /Fuel Guard Progress/);
  assert.match(training, /Recent Training Mode sessions/);
  const navigation = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf("</nav>", html.indexOf('<nav class="mobile-bottom-nav')));
  assert.equal((navigation.match(/data-mobile-screen=/g) || []).length, 5);
  assert.match(navigation, /data-mobile-screen="dashboard"[\s\S]*data-mobile-screen="training"[\s\S]*data-mobile-screen="impact"[\s\S]*data-mobile-screen="analytics"[\s\S]*data-mobile-screen="tools"/);
});

test("Retention migration narrows raw report visibility and grants only safe RPCs", () => {
  const migration = read("supabase/migrations/20260810084645_athlete_retention_loop.sql");
  assert.match(migration, /alter table public\.fuel_athlete_nudge_preferences enable row level security/);
  assert.doesNotMatch(migration, /grant delete on table public\.fuel_athlete_nudge_preferences/i);
  assert.match(migration, /create table private\.fuel_athlete_review_feedback/);
  assert.match(migration, /fuel_prevent_review_feedback_repoint/);
  assert.match(migration, /create policy fuel_coach_reports_select_assigned_coach/);
  assert.match(migration, /create or replace function public\.fuel_athlete_coach_review_feed/);
  assert.match(migration, /create or replace function public\.fuel_complete_weekly_review_with_feedback/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.fuel_athlete_coach_review_feed\(integer\)[\s\S]*from public, anon/);
  assert.doesNotMatch(migration.slice(migration.indexOf("fuel_athlete_coach_review_feed")), /coach_notes|organisation_name|'summary'/);
});

test("Coach UI marks the only Athlete-visible field explicitly and completes atomically", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");
  assert.match(html, /Athlete-visible feedback \(optional\)/);
  assert.match(html, /Internal Coach notes and report evidence stay private/);
  assert.match(js, /fuel_complete_weekly_review_with_feedback/);
  assert.match(js, /p_athlete_feedback: athleteFeedback/);
});

test("pgTAP adds denial coverage for preferences, feedback, revocation and direct-ID attacks", () => {
  const tap = read("supabase/tests/athlete_retention_rls_test.sql");
  assert.match(tap, /select plan\(34\)/);
  assert.match(tap, /Athlete cannot repoint preference ownership/);
  assert.match(tap, /Internal summary, note and completion fields do not cross the feed/);
  assert.match(tap, /Removed Coach relationship immediately removes/);
  assert.match(tap, /Unrelated Coach cannot publish feedback by direct ID/);
});
