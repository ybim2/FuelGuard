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

test("Coach Beta is a separate route and athlete Log navigation remains simple", () => {
  const athleteHtml = read("index.html");
  const athleteJs = read("fuel-beta.js");
  const coachHtml = read("coach/index.html");
  const coachJs = read("coach/coach-beta.js");

  assert.match(coachHtml, /Fuel Guard Coach Beta/);
  assert.match(coachHtml, /data-coach-tab="dashboard"/);
  assert.match(coachHtml, /data-coach-tab="athletes"/);
  assert.match(coachHtml, /data-coach-tab="settings"/);
  assert.match(coachHtml, /fuel-guard-domain\.js/);
  assert.match(coachHtml, /api\/supabase-config\.js/);
  assert.match(coachJs, /TABLES = \{[\s\S]*profiles:[\s\S]*relationships:[\s\S]*logs:[\s\S]*targets:/);

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
  assert.match(sql, /create table if not exists public\.fuel_coach_athletes/);
  assert.match(sql, /alter table public\.fuel_user_profiles enable row level security/);
  assert.match(sql, /alter table public\.fuel_coach_athletes enable row level security/);
  assert.match(sql, /fuel_coach_athletes_coach_athlete_idx/);
  assert.match(sql, /fuel_logs_select_own_or_assigned_coach/);
  assert.match(sql, /fuel_targets_select_own_or_assigned_coach/);
  assert.match(sql, /relationship\.coach_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /relationship\.status = 'active'/);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /status in \('pending', 'active', 'revoked'\)/);
  assert.doesNotMatch(noComments, /service_role|auth\.role\(\)/);
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
