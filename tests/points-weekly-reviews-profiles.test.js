const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260809143000_points_weekly_reviews_profiles.sql");
const scopeHardening = read("supabase/migrations/20260809144500_points_profile_scope_hardening.sql");
const indexHardening = read("supabase/migrations/20260809150000_points_foreign_key_indexes.sql");
const coachMetrics = read("supabase/migrations/20260809151500_points_profile_coach_metrics.sql");

function log(day, time, type = "fuel") {
  return { id: `${day}-${time}-${type}`, user_id: "athlete-a", logged_at: `${day}T${time}:00Z`, type, source: "manual" };
}

test("athlete points use only the approved thresholds and exact one-time values", () => {
  assert.deepEqual(domain.ATHLETE_POINT_MILESTONES.map(({ eventType, points }) => [eventType, points]), [
    ["athlete_streak_3", 25],
    ["athlete_streak_7", 50],
    ["athlete_streak_30", 150],
    ["athlete_fuel_25", 25],
    ["athlete_fuel_100", 75],
    ["athlete_fuel_250", 150]
  ]);
  const progress = domain.athletePointProgress({ dayStreak: 7, fuelMoments: 100 });
  assert.equal(progress.earnedPoints, 175);
  assert.equal(progress.milestones.filter(item => item.earned).length, 4);
  assert.equal(progress.milestones.find(item => item.eventType === "athlete_streak_30").remaining, 23);
});

test("weekly review derives strongest and weakest days with evidence-aware wording", () => {
  const period = domain.periodFromKeys("2026-08-03", "2026-08-09", "week", "UTC");
  const review = domain.buildWeeklyCoachReview({
    athlete: { userId: "athlete-a", displayName: "Athlete A" },
    coach: { displayName: "Coach A" },
    logs: [
      log("2026-08-03", "08:00"),
      log("2026-08-03", "11:00"),
      log("2026-08-03", "14:00", "hydration"),
      log("2026-08-05", "07:00"),
      log("2026-08-05", "15:30")
    ],
    previousLogs: [],
    targets: { maximumFuelGapMinutes: 180 },
    period,
    workoutSummary: { contexts: [] },
    timeZone: "UTC"
  });
  assert.equal(review.reviewKind, "weekly");
  assert.match(review.weeklyReview.strongestDay, /2026-08-03/);
  assert.match(review.weeklyReview.weakestDay, /No fuel was recorded/);
  assert.doesNotMatch(JSON.stringify(review), /did not eat/i);
  assert.equal(review.weeklyReview.longGaps[0].date, "2026-08-05");
  assert.equal(review.weeklyReview.discussionPrompts.length, 3);
});

test("weekly review reports shared pre and post training evidence without inventing sessions", () => {
  const period = domain.periodFromKeys("2026-08-03", "2026-08-09", "week", "UTC");
  const review = domain.buildWeeklyCoachReview({
    athlete: { userId: "athlete-a" },
    logs: [log("2026-08-04", "07:00"), log("2026-08-04", "11:00")],
    previousLogs: [],
    targets: {},
    period,
    timeZone: "UTC",
    workoutSummary: { contexts: [
      { workout: { startAt: new Date("2026-08-04T08:00:00Z"), endAt: new Date("2026-08-04T10:00:00Z") }, hasPreviousFuel: true, hasPostFuel: true, postFuelGapMinutes: 24 },
      { workout: { startAt: new Date("2026-08-06T08:00:00Z") }, hasPreviousFuel: false, hasPostFuel: false },
      { workout: { startAt: new Date("2026-08-07T08:00:00Z"), endAt: new Date("2026-08-07T10:00:00Z") }, hasPreviousFuel: true, hasPostFuel: true, postFuelGapMinutes: 157 },
      { workout: { startAt: new Date("2026-07-20T08:00:00Z") }, hasPreviousFuel: true, hasPostFuel: true }
    ] }
  });
  assert.deepEqual({ ...review.weeklyReview.training, observations: undefined }, {
    workoutCount: 3,
    preFuelRecorded: 2,
    postFuelRecorded: 2,
    noPreFuelRecorded: 1,
    noPostFuelRecorded: 1,
    observations: undefined
  });
  assert.match(review.weeklyReview.training.observations.join(" "), /Strong recorded example[\s\S]*24m/);
  assert.match(review.weeklyReview.training.observations.join(" "), /Post-training opportunity[\s\S]*2h 37m/);
  assert.match(review.weeklyReview.training.observations.join(" "), /1 shared workout had no post-session Fuel recorded/);
  assert.match(review.executiveSummary.at(-1), /2 of 3 shared workouts/);
});

test("points ledger is server-awarded, RLS-protected and idempotent", () => {
  assert.match(migration, /create table public\.fuel_points_ledger/);
  assert.match(migration, /fuel_points_ledger_user_event_unique unique \(user_id, role_context, event_id\)/);
  assert.match(migration, /alter table public\.fuel_points_ledger enable row level security/);
  assert.match(migration, /grant select on table public\.fuel_points_ledger to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*insert[^;]*fuel_points_ledger[^;]*authenticated/i);
  assert.match(migration, /on conflict \(user_id, role_context, event_id\) do nothing/);
  assert.match(migration, /create or replace function public\.fuel_sync_athlete_points/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
});

test("weekly review identity, completion and Coach awards are atomic and permissioned", () => {
  assert.match(migration, /fuel_coach_reports_weekly_identity_idx/);
  assert.match(migration, /review_kind = 'weekly'/);
  assert.match(migration, /create or replace function public\.fuel_save_weekly_review/);
  assert.match(migration, /create or replace function public\.fuel_complete_weekly_review/);
  assert.match(migration, /relationship\.status = 'active'/);
  assert.match(migration, /review_kind = 'standard' and status = 'draft'/);
  assert.match(migration, /coach_all_assigned_week/);
  assert.match(migration, /coach_review_streak_12/);
});

test("profiles are additive and multi-role without replacing organisation capability controls", () => {
  assert.match(migration, /add column if not exists first_name text/);
  assert.match(migration, /add column if not exists avatar_url text/);
  assert.match(migration, /create table public\.fuel_user_role_memberships/);
  assert.match(migration, /role in \('athlete', 'coach', 'performance'\)/);
  assert.match(migration, /fuel_performance_staff_access\(p_organisation_id\)/);
  assert.match(migration, /private\.fuel_performance_can_access_athlete/);
  assert.match(scopeHardening, /fuel_organisation_athlete_shares/);
  assert.match(scopeHardening, /fuel_team_athletes/);
  assert.match(scopeHardening, /fuel_performance_can_access_athlete/);
});

test("new foreign keys retain covering indexes", () => {
  assert.match(indexHardening, /fuel_points_ledger_event_type_idx/);
  assert.match(indexHardening, /fuel_user_role_memberships_granted_by_idx/);
});

test("owner-scoped points profiles expose Coach totals, streak and milestone progress", () => {
  assert.match(coachMetrics, /'completedWeeklyReviews', coach_review_count/);
  assert.match(coachMetrics, /'currentReviewStreak', coach_review_streak/);
  assert.match(coachMetrics, /'coachMilestones'/);
  assert.match(coachMetrics, /ledger\.user_id = caller_id/);
});

test("Athlete and Coach surfaces expose profiles, points and weekly completion", () => {
  const athleteHtml = read("index.html");
  const athleteJs = read("athlete-milestones.js");
  const coachHtml = read("coach/index.html");
  const coachJs = read("coach/coach-beta.js");
  assert.match(athleteHtml, /id="athleteDailyPoints"/);
  assert.match(athleteHtml, /id="athleteProfileCard"/);
  assert.match(athleteJs, /fuel_points_profile/);
  assert.match(athleteJs, /Milestones unlocked/);
  assert.match(athleteJs, /Rewards are coming soon/);
  assert.match(coachHtml, /Weekly review/);
  assert.match(coachHtml, /Generate Weekly Review/);
  assert.match(coachHtml, /id="coachCompleteReviewButton"/);
  assert.match(coachJs, /fuel_save_weekly_review/);
  assert.match(coachJs, /fuel_complete_weekly_review/);
  assert.match(coachJs, /Weekly review history/);
  assert.match(coachJs, /Reviews completed/);
  assert.match(coachJs, /Next milestone/);
});

test("Performance renders staff identity, roles, assignments and review contribution", () => {
  const performance = read("performance/performance.js");
  assert.match(performance, /fuel_performance_people_hierarchy/);
  assert.match(performance, /person\.jobTitle/);
  assert.match(performance, /person\.assignedAthletes/);
  assert.match(performance, /person\.completedWeeklyReviews/);
  assert.match(performance, /person\.coachPoints/);
});

test("pgTAP suite covers points idempotency, history immutability and cross-team attacks", () => {
  const tap = read("supabase/tests/points_weekly_reviews_profiles_rls_test.sql");
  assert.match(tap, /select plan\(44\)/);
  assert.match(tap, /Repeating athlete award sync is idempotent/);
  assert.match(tap, /Completed weekly reviews cannot be deleted directly/);
  assert.match(tap, /Unrelated coach cannot save a review/);
  assert.match(tap, /Athlete cannot forge a ledger award/);
});
