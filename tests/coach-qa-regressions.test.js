const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const domain = require("../fuel-guard-domain.js");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

test("persistent data-health occurrences stay dismissed until the underlying event changes", () => {
  const athlete = { userId: "athlete-a", displayName: "Athlete A" };
  const lastLogAt = "2026-08-01T09:00:00.000Z";
  const build = now => {
    const roster = domain.buildCoachRoster({ athletes: [athlete], logs: [], now });
    const dataHealth = domain.buildTeamDataHealth({
      athletes: [athlete],
      rows: [{ athlete_id: athlete.userId, last_log_at: lastLogAt, garmin_connection_status: "not_connected" }],
      now
    });
    return domain.buildCoachAttentionItems({ roster, dataHealth, now }).find(item => item.type === "prolonged_absence");
  };

  const first = build(new Date("2026-08-07T12:00:00.000Z"));
  const nextDay = build(new Date("2026-08-08T12:00:00.000Z"));
  assert.ok(first);
  assert.equal(nextDay.occurrenceKey, first.occurrenceKey);

  const roster = domain.buildCoachRoster({ athletes: [athlete], logs: [], now: new Date("2026-08-08T12:00:00.000Z") });
  const dataHealth = domain.buildTeamDataHealth({
    athletes: [athlete],
    rows: [{ athlete_id: athlete.userId, last_log_at: lastLogAt, garmin_connection_status: "not_connected" }],
    now: new Date("2026-08-08T12:00:00.000Z")
  });
  const dismissed = domain.buildCoachAttentionItems({
    roster,
    dataHealth,
    now: new Date("2026-08-08T12:00:00.000Z"),
    actions: [{ occurrence_key: first.occurrenceKey, status: "dismissed" }]
  });
  assert.equal(dismissed.some(item => item.type === "prolonged_absence"), false);
});

test("upcoming training context is athlete-scoped, time-bounded, and threshold preserving", () => {
  const now = new Date("2026-08-07T12:00:00.000Z");
  const athlete = { userId: "athlete-a", displayName: "Athlete A" };
  const items = domain.buildCoachAttentionItems({
    roster: [{ athlete, flags: [], sleepyLogs: [], lastFuel: null }],
    dataHealth: { items: [] },
    trainingContext: [
      {
        session_id: "session-a",
        athlete_id: athlete.userId,
        starts_at: "2026-08-07T16:00:00.000Z",
        timezone_name: "Europe/London",
        session_name: "Evening training",
        gap_status: "close",
        gap_minutes_at_start: 165,
        maximum_fuel_gap_minutes: 180,
        last_fuel_at: "2026-08-07T13:15:00.000Z"
      },
      {
        session_id: "leaked-session",
        athlete_id: "other-athlete",
        starts_at: "2026-08-07T15:00:00.000Z",
        gap_status: "exceeded"
      }
    ],
    now
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].athleteId, athlete.userId);
  assert.equal(items[0].type, "training_close");
  assert.match(items[0].detail, /target is unchanged/);
  assert.match(items[0].detail, /Europe\/London/);
});

test("training schedule timezone conversion preserves the local date and exposes DST gaps", () => {
  const summerMidnight = domain.zonedDateTimeToUtc("2026-08-09", "Europe/London", 0, 30);
  assert.equal(summerMidnight.toISOString(), "2026-08-08T23:30:00.000Z");
  assert.equal(domain.dateKeyInTimeZone(summerMidnight, "Europe/London"), "2026-08-09");
  assert.equal(domain.formatClockInTimeZone(summerMidnight, "Europe/London"), "0:30 AM");

  const missingSpringTime = domain.zonedDateTimeToUtc("2026-03-29", "Europe/London", 1, 30);
  const represented = domain.zonedDateParts(missingSpringTime, "Europe/London");
  assert.notEqual(`${represented.hour}:${represented.minute}`, "1:30");
});

test("coach UI wires saved groups, shared staff notes, schedules, and real intervention metrics", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");

  assert.match(html, /id="coachGroupFilter"/);
  assert.match(html, /id="coachTeamSetup"/);
  assert.match(html, /id="coachSavedGroups"/);
  assert.match(html, /id="coachTrainingSchedule"/);
  assert.match(js, /function createSavedGroup/);
  assert.match(js, /function renameSavedGroup/);
  assert.match(js, /function deleteSavedGroup/);
  assert.match(js, /function toggleSavedGroupMember/);
  assert.match(js, /function renderSharedStaffContext/);
  assert.match(js, /author_id: user\.id/);
  assert.match(js, /function createTrainingSession/);
  assert.match(js, /fuel_save_team_session/);
  assert.match(js, /p_starts_at: startsAt\.toISOString\(\)/);
  assert.match(js, /without duplicate athlete assignments/);
  assert.doesNotMatch(js, /function trainingAssignmentOptions/);
  assert.match(js, /interventionMetricSnapshot\(comparison\.before\)/);
  assert.match(js, /metrics\.fuelling\?\.averageGapMinutes/);
  assert.match(js, /item\.difference < 0 \? "-"/);
  assert.match(js, /enter an email and password\|enter your email before/);
  assert.match(js, /select\("id,status"\)[\s\S]*update\(mutableRelationship\)/);
  assert.doesNotMatch(js, /\.upsert\(row, \{ onConflict: "coach_id,athlete_id" \}\)/);
  assert.doesNotMatch(js, /update\([^)]*maximum_fuel_gap_minutes/);
});

test("relationship identities are immutable and revoked team roster rows can be reactivated safely", () => {
  const sql = read("supabase/migrations/20260807181022_coach_relationship_identity_hardening.sql");

  assert.match(sql, /revoke update, delete on table public\.fuel_coach_athletes from authenticated/);
  const relationshipGrant = sql.match(/grant update \([\s\S]*?\) on table public\.fuel_coach_athletes to authenticated;/)?.[0] || "";
  assert.doesNotMatch(relationshipGrant, /coach_id|athlete_id/);
  assert.match(sql, /drop policy if exists fuel_coach_athletes_delete_by_participant/);
  assert.match(sql, /fuel_team_athletes_select_authorised[\s\S]*fuel_has_direct_athlete_access\(athlete_id\)/);
  assert.match(sql, /fuel_team_athletes_update_authorised[\s\S]*status in \('active', 'revoked'\)/);
  assert.doesNotMatch(sql, /service_role|auth\.role\(\)|user_metadata/i);
});

test("Coach migrations remain deployable after the existing production ledger checkpoint", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).sort();
  const ledgerIndex = migrations.indexOf("20260807172230_remove_coach_relationship_rls_recursion.sql");
  const dailyIndex = migrations.indexOf("20260807172300_coach_daily_workflow.sql");
  const organisationIndex = migrations.indexOf("20260807172400_coach_organisation_foundations.sql");
  const reviewsIndex = migrations.indexOf("20260807172714_coach_review_schedules.sql");
  const hardeningIndex = migrations.indexOf("20260807181022_coach_relationship_identity_hardening.sql");

  assert.ok(ledgerIndex >= 0);
  assert.ok(ledgerIndex < dailyIndex && dailyIndex < organisationIndex && organisationIndex < reviewsIndex && reviewsIndex < hardeningIndex);
  const ledger = read("supabase/migrations/20260807172230_remove_coach_relationship_rls_recursion.sql");
  assert.match(ledger, /create or replace function private\.fuel_user_is_coach/);
  assert.match(ledger, /fuel_coach_athletes_insert_by_participant/);
});
