const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const domain = require("../fuel-guard-domain.js");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function checkinNote(type = "sleepy") {
  return `fuel_guard_checkin:${JSON.stringify({ version: 1, checkinType: type, context: "general_day", arousalLevel: type })}`;
}

function localLog(userId, key, hour, minute, type = "fuel", extra = {}) {
  const date = new Date(`${key}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
  return domain.normalizeLog({
    user_id: userId,
    logged_at: date.toISOString(),
    type,
    source: "manual",
    ...extra
  });
}

test("Coach Beta is a separate route and athlete Log navigation remains simple", () => {
  const athleteHtml = read("index.html");
  const athleteJs = read("fuel-beta.js");
  const coachHtml = read("coach/index.html");
  const coachJs = read("coach/coach-beta.js");
  const coachCss = read("coach/coach-beta.css");

  assert.match(coachHtml, /Fuel Guard Coach Beta/);
  assert.match(coachHtml, /Fuel Guard Coach/);
  assert.match(coachHtml, /data-coach-tab="dashboard"/);
  assert.match(coachHtml, /data-coach-tab="athletes"/);
  assert.match(coachHtml, /data-coach-tab="reports"/);
  assert.match(coachHtml, /data-coach-tab="settings"/);
  assert.match(coachHtml, /id="coachLoadingPanel"/);
  assert.match(coachHtml, /id="coachAuthPanel" class="coach-card coach-auth-card" hidden/);
  assert.match(coachHtml, /id="coachAccessPanel"/);
  assert.match(coachHtml, /Create coach account/);
  assert.match(coachHtml, /Forgot password\?/);
  assert.doesNotMatch(coachHtml, /Enable Coach Beta|Open athlete app/);
  assert.match(coachHtml, /id="coachReportsPanel"/);
  assert.match(coachHtml, /fuel-guard-domain\.js/);
  assert.match(coachHtml, /api\/supabase-config\.js/);
  assert.match(coachJs, /TABLES = \{[\s\S]*profiles:[\s\S]*relationships:[\s\S]*logs:[\s\S]*targets:[\s\S]*reports:[\s\S]*interventions:/);
  assert.match(coachJs, /function isCoachEnabled/);
  assert.match(coachJs, /coach_enabled/);
  assert.match(coachJs, /signInWithPassword/);
  assert.match(coachJs, /resetPasswordForEmail/);
  assert.match(coachJs, /emailRedirectTo:\s*`\$\{window\.location\.origin\}\/coach\/`/);
  assert.match(coachJs, /fuel_guard_coach_signup:\s*true/);
  assert.match(coachJs, /Coach invitation sent/);
  assert.match(coachJs, /function coachSignupIntent/);
  assert.match(coachJs, /authResolved/);
  assert.match(coachJs, /coachLoading/);
  assert.match(coachJs, /appShell\.hidden = loading \|\| !coachReady/);
  assert.match(coachCss, /\.coach-beta \[hidden\] \{[\s\S]*display: none !important;/);
  assert.doesNotMatch(coachJs, /function enableCoachAccess|coachEnableAccessButton/);
  assert.doesNotMatch(coachJs, /update\(\{\s*role:\s*"coach"/);
  assert.match(coachJs, /data-open-report-builder/);
  assert.match(coachJs, /data-open-intervention-builder/);
  assert.match(coachJs, /data-export-report-pdf/);
  assert.match(coachJs, /data-export-report-csv/);

  assert.doesNotMatch(athleteHtml, /data-coach-tab|Coach Beta|coachDashboardPanel/);
  assert.match(athleteHtml, /data-mobile-screen="dashboard"[\s\S]*<span>Log<\/span>/);
  assert.match(athleteHtml, /id="coachSharingCard"/);
  assert.match(athleteJs, /function shareWithCoach/);
  assert.match(athleteJs, /status:\s*"active"/);
  assert.match(athleteJs, /accepted_at:\s*now/);
});

test("Coach attention rules flag exceeded, approaching, Sleepy cluster and steady athletes", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const key = domain.dateKey(now);
  const athletes = [
    { userId: "athlete-exceeded", displayName: "Exceeded" },
    { userId: "athlete-approaching", displayName: "Approaching" },
    { userId: "athlete-sleepy", displayName: "Sleepy" },
    { userId: "athlete-steady", displayName: "Steady" }
  ];
  const logs = [
    { user_id: "athlete-exceeded", logged_at: "2026-08-07T08:24:00.000Z", type: "fuel", source: "manual" },
    { user_id: "athlete-approaching", logged_at: "2026-08-07T09:20:00.000Z", type: "fuel", source: "manual" },
    { user_id: "athlete-sleepy", logged_at: "2026-08-07T10:00:00.000Z", type: "fuel", source: "manual", notes: checkinNote("sleepy") },
    { user_id: "athlete-sleepy", logged_at: "2026-08-07T11:00:00.000Z", type: "fuel", source: "garmin", notes: checkinNote("sleepy"), external_event_id: "fr255-sleepy-1" },
    { user_id: "athlete-steady", logged_at: "2026-08-07T11:00:00.000Z", type: "fuel", source: "garmin", external_event_id: "fr255-fuel-1" }
  ].map(domain.normalizeLog);
  const roster = domain.buildCoachRoster({
    athletes,
    logs,
    targetsByUser: {
      "athlete-exceeded": { maximumFuelGapMinutes: 180 },
      "athlete-approaching": { maximumFuelGapMinutes: 180 },
      "athlete-sleepy": { maximumFuelGapMinutes: 180 },
      "athlete-steady": { maximumFuelGapMinutes: 180 }
    },
    now,
    key
  });

  assert.equal(roster[0].athlete.displayName, "Exceeded");
  assert.equal(roster[0].flags[0].id, "gap_exceeded");
  assert.match(roster[0].flags[0].detail, /Fuel gap exceeded by 36m/);
  assert.equal(roster[1].athlete.displayName, "Approaching");
  assert.equal(roster[1].flags[0].id, "gap_approaching");
  assert.equal(roster.find(item => item.athlete.displayName === "Sleepy").flags[0].id, "sleepy_cluster");
  assert.equal(roster.find(item => item.athlete.displayName === "Steady").flags.length, 0);
  assert.equal(domain.isSleepyLog(logs.find(log => log.source === "garmin")), true);
});

test("Coach detail helpers expose read-only daily counts and status labels", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const status = domain.coachDailyStatus({
    athlete: { userId: "athlete-a", displayName: "Athlete A" },
    logs: [
      { user_id: "athlete-a", logged_at: "2026-08-07T10:00:00.000Z", type: "fuel", source: "manual" },
      { user_id: "athlete-a", logged_at: "2026-08-07T10:30:00.000Z", type: "hydration", source: "manual" },
      { user_id: "athlete-a", logged_at: "2026-08-07T11:00:00.000Z", type: "fuel", source: "garmin", notes: checkinNote("sleepy") }
    ],
    targets: { maximumFuelGapMinutes: 180 },
    now,
    key: domain.dateKey(now)
  });

  assert.equal(status.statusLabel, "Steady");
  assert.equal(status.fuelLogs.length, 1);
  assert.equal(status.hydrationLogs.length, 1);
  assert.equal(status.sleepyLogs.length, 1);
  assert.equal(status.logs.some(log => log.source === "garmin"), true);
});

test("Coach migration uses database-level active relationship access controls", () => {
  const sql = read("supabase/fuel_coach_beta.sql");
  const noComments = sql.replace(/^--.*$/gm, "");

  assert.match(sql, /create table if not exists public\.fuel_user_profiles/);
  assert.match(sql, /coach_enabled boolean not null default false/);
  assert.match(sql, /set coach_enabled = true/);
  assert.match(sql, /create table if not exists public\.fuel_coach_athletes/);
  assert.match(sql, /create table if not exists public\.fuel_coach_reports/);
  assert.match(sql, /create table if not exists public\.fuel_coach_interventions/);
  assert.match(sql, /alter table public\.fuel_user_profiles enable row level security/);
  assert.match(sql, /alter table public\.fuel_coach_athletes enable row level security/);
  assert.match(sql, /alter table public\.fuel_coach_reports enable row level security/);
  assert.match(sql, /alter table public\.fuel_coach_interventions enable row level security/);
  assert.match(sql, /fuel_coach_athletes_coach_athlete_idx/);
  assert.match(sql, /fuel_coach_reports_coach_athlete_date_idx/);
  assert.match(sql, /fuel_coach_reports_period_idx/);
  assert.match(sql, /fuel_coach_interventions_coach_athlete_status_idx/);
  assert.match(sql, /fuel_coach_interventions_review_idx/);
  assert.match(sql, /fuel_user_profiles_coach_enabled_idx/);
  assert.match(sql, /fuel_logs_select_own_or_assigned_coach/);
  assert.match(sql, /fuel_targets_select_own_or_assigned_coach/);
  assert.match(sql, /fuel_coach_reports_insert_assigned_coach/);
  assert.match(sql, /fuel_coach_interventions_insert_assigned_coach/);
  assert.match(sql, /period_start date/);
  assert.match(sql, /period_end date/);
  assert.match(sql, /coach_notes text/);
  assert.match(sql, /organisation_name text/);
  assert.match(sql, /previous_metrics jsonb/);
  assert.match(sql, /category text/);
  assert.match(sql, /observation text/);
  assert.match(sql, /intervention_date date/);
  assert.match(sql, /review_date date/);
  assert.match(sql, /relationship\.coach_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /relationship\.status = 'active'/);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /status in \('pending', 'active', 'revoked'\)/);
  assert.match(sql, /status in \('active', 'reviewed', 'closed'\)/);
  assert.doesNotMatch(noComments, /service_role|auth\.role\(\)/);
});

test("Coach athlete search uses existing relationships and exact user ID requests without exposing an email directory", () => {
  const coachHtml = read("coach/index.html");
  const coachJs = read("coach/coach-beta.js");
  const apiFiles = fs.readdirSync(path.join(root, "api")).join("\n");

  assert.match(coachHtml, /Name, label, or user ID/);
  assert.doesNotMatch(coachHtml, /Name or email/);
  assert.match(coachJs, /function relationshipRows/);
  assert.match(coachJs, /function exactAthleteRequestRow/);
  assert.match(coachJs, /data-request-athlete/);
  assert.match(coachJs, /No athletes found/);
  assert.match(coachJs, /ATHLETE_ID_PATTERN/);
  assert.doesNotMatch(coachJs, /auth\.users|fuel_coach_search_athletes|coach-athlete-search|inviteUserByEmail/);
  assert.doesNotMatch(apiFiles, /coach-athlete-search/);
});

test("Athlete review report calculates coverage, gap metrics, Sleepy associations and comparison", () => {
  const athleteId = "athlete-review-a";
  const period = domain.reviewPeriodRange({
    preset: "custom",
    customStart: "2026-07-01",
    customEnd: "2026-07-07",
    now: new Date("2026-07-07T12:00:00")
  });
  const previous = domain.previousPeriodRange(period);
  const currentLogs = [
    localLog(athleteId, "2026-07-01", 8, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-01", 10, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-01", 13, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-01", 16, 45, "fuel", { day_type: "Working", notes: checkinNote("sleepy") }),
    localLog(athleteId, "2026-07-01", 17, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-02", 8, 10, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-02", 10, 5, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-02", 13, 5, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-02", 16, 50, "fuel", { day_type: "Working", notes: checkinNote("sleepy") }),
    localLog(athleteId, "2026-07-02", 17, 20, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-03", 9, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-03", 12, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, "2026-07-03", 10, 0, "hydration", { day_type: "Working" }),
    localLog(athleteId, "2026-07-03", 14, 0, "hydration", { day_type: "Working" })
  ];
  const previousLogs = [
    localLog(athleteId, previous.startKey, 8, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, previous.startKey, 13, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, previous.startKey, 17, 30, "fuel", { day_type: "Working" }),
    localLog(athleteId, domain.dateKey(domain.endOfLocalDay(previous.endKey)), 8, 0, "fuel", { day_type: "Working" }),
    localLog(athleteId, domain.dateKey(domain.endOfLocalDay(previous.endKey)), 17, 0, "fuel", { day_type: "Working" })
  ];

  const report = domain.buildAthleteReviewReport({
    athlete: { userId: athleteId, displayName: "Review Athlete" },
    coach: { displayName: "Coach A" },
    organisationName: "Fuel Guard Test Team",
    logs: currentLogs,
    previousLogs,
    targets: { maximumFuelGapMinutes: 180 },
    period,
    interventions: [{ intervention_date: "2026-07-04", category: "fuelling_routine", action_text: "Carry snack", status: "active" }],
    coachNotes: "Travel days need calmer routines.",
    generatedAt: new Date("2026-07-07T12:00:00")
  });

  assert.equal(report.coverage.totalDays, 7);
  assert.equal(report.coverage.loggedDays, 3);
  assert.equal(report.coverage.metricDays, 3);
  assert.equal(report.consistency.daysExceedingTarget, 2);
  assert.equal(report.consistency.targetAdherencePct, 33);
  assert.equal(report.fuelling.commonGapWindow.label, "13:00-18:00");
  assert.equal(report.fuelling.commonFuellingWindow.label, "08:00-10:00");
  assert.equal(report.sleepy.total, 2);
  assert.equal(report.sleepy.commonWindow.label, "16:00-18:00");
  assert.equal(report.sleepy.afterLongGapCount, 2);
  assert.equal(report.sleepy.afterLongGapPct, 100);
  assert.equal(report.contexts[0].label, "Shift");
  assert.equal(report.contexts[0].adherencePct, 33);
  assert.equal(report.coachNotes, "Travel days need calmer routines.");
  assert.equal(report.comparison.find(item => item.id === "target_adherence").trendLabel, "Improved");
  assert.match(report.executiveSummary.join(" "), /Fuel-gap target was met on 33%/);
});

test("Intervention comparison reports before and after changes without causal claims", () => {
  const athleteId = "athlete-intervention-a";
  const logs = [
    localLog(athleteId, "2026-06-02", 8, 0),
    localLog(athleteId, "2026-06-02", 17, 0),
    localLog(athleteId, "2026-06-09", 8, 0),
    localLog(athleteId, "2026-06-09", 16, 0),
    localLog(athleteId, "2026-07-02", 8, 0),
    localLog(athleteId, "2026-07-02", 11, 0),
    localLog(athleteId, "2026-07-09", 8, 0),
    localLog(athleteId, "2026-07-09", 11, 0)
  ];
  const comparison = domain.interventionComparison({
    intervention: { intervention_date: "2026-07-01" },
    logs,
    targets: { maximumFuelGapMinutes: 180 },
    weeks: 4
  });

  assert.equal(comparison.direction, "improved");
  assert.match(comparison.label, /lower after this intervention/);
  assert.doesNotMatch(comparison.label, /caused|proved|under-fuel/i);
});

test("Coach Beta avoids medical or body-composition framing", () => {
  const coachHtml = read("coach/index.html");
  const coachJs = read("coach/coach-beta.js");
  const coachCss = read("coach/coach-beta.css");
  const visibleCopy = `${coachHtml}\n${coachJs}\n${coachCss}`;

  assert.doesNotMatch(visibleCopy, /hypogly|low energy availability|under-fuel|this caused|\bproves\b/i);
  assert.match(coachJs, /No calories, weight, or medical interpretation/);
});

test("Fuel target schema supports cloud-backed maximum fuel-gap targets", () => {
  const targets = read("supabase/fuel_targets.sql");
  const coach = read("supabase/fuel_coach_beta.sql");
  const sync = read("fuel-supabase.js");

  assert.match(targets, /maximum_fuel_gap_minutes integer/);
  assert.match(targets, /fuel_targets_maximum_fuel_gap_minutes_check/);
  assert.match(coach, /add column if not exists maximum_fuel_gap_minutes integer/);
  assert.match(sync, /maximum_fuel_gap_minutes/);
  assert.match(sync, /targetMaximumGapColumnMissing/);
});
