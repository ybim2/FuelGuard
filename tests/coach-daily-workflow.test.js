const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const domain = require("../fuel-guard-domain.js");
const migrationPath = "supabase/migrations/20260807172300_coach_daily_workflow.sql";

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function normalizedLog(userId, localTimestamp, extra = {}) {
  return domain.normalizeLog({
    id: extra.id || `${userId}-${localTimestamp}`,
    user_id: userId,
    logged_at: new Date(localTimestamp).toISOString(),
    type: "fuel",
    source: "manual",
    ...extra
  });
}

test("daily attention occurrences persist Reviewed/Dismissed state and allow genuinely new occurrences", () => {
  const athlete = { userId: "athlete-a", displayName: "Athlete A" };
  const now = new Date("2026-08-07T14:00:00+01:00");
  const firstLog = normalizedLog(athlete.userId, "2026-08-07T09:30:00+01:00", { id: "fuel-first" });
  const roster = domain.buildCoachRoster({
    athletes: [athlete],
    logs: [firstLog],
    targetsByUser: { [athlete.userId]: { maximumFuelGapMinutes: 180 } },
    now
  });
  const dataHealth = domain.buildTeamDataHealth({
    athletes: [athlete],
    rows: [{ athlete_id: athlete.userId, last_log_at: firstLog.timestamp, garmin_connection_status: "not_connected" }],
    now
  });
  const initial = domain.buildCoachAttentionItems({ roster, dataHealth, now });
  const exceeded = initial.find(item => item.type === "gap_exceeded");

  assert.ok(exceeded);
  assert.match(exceeded.occurrenceKey, /gap_exceeded:2026-08-07:fuel-first:180/);

  const resolved = domain.buildCoachAttentionItems({
    roster,
    dataHealth,
    now,
    actions: [{ occurrence_key: exceeded.occurrenceKey, status: "reviewed" }]
  });
  assert.equal(resolved.some(item => item.occurrenceKey === exceeded.occurrenceKey), false);

  const laterNow = new Date("2026-08-08T14:00:00+01:00");
  const laterLog = normalizedLog(athlete.userId, "2026-08-08T09:00:00+01:00", { id: "fuel-later" });
  const laterRoster = domain.buildCoachRoster({
    athletes: [athlete],
    logs: [laterLog],
    targetsByUser: { [athlete.userId]: { maximumFuelGapMinutes: 180 } },
    now: laterNow
  });
  const laterHealth = domain.buildTeamDataHealth({
    athletes: [athlete],
    rows: [{ athlete_id: athlete.userId, last_log_at: laterLog.timestamp, garmin_connection_status: "not_connected" }],
    now: laterNow
  });
  const laterItems = domain.buildCoachAttentionItems({
    roster: laterRoster,
    dataHealth: laterHealth,
    now: laterNow,
    actions: [{ occurrence_key: exceeded.occurrenceKey, status: "reviewed" }]
  });
  const newOccurrence = laterItems.find(item => item.type === "gap_exceeded");

  assert.ok(newOccurrence);
  assert.notEqual(newOccurrence.occurrenceKey, exceeded.occurrenceKey);
  assert.match(newOccurrence.occurrenceKey, /2026-08-08:fuel-later:180/);
});

test("team data health handles normal, missing, prolonged, insufficient and revoked Garmin states", () => {
  const now = new Date("2026-08-07T14:00:00+01:00");
  const athletes = [
    { userId: "normal", displayName: "Normal" },
    { userId: "today", displayName: "No today" },
    { userId: "long", displayName: "Long absence" },
    { userId: "empty", displayName: "Empty" },
    { userId: "garmin", displayName: "Garmin" }
  ];
  const result = domain.buildTeamDataHealth({
    athletes,
    now,
    rows: [
      { athlete_id: "normal", last_log_at: "2026-08-07T11:00:00+01:00", garmin_connection_status: "connected" },
      { athlete_id: "today", last_log_at: "2026-08-06T11:00:00+01:00", garmin_connection_status: "not_connected" },
      { athlete_id: "long", last_log_at: "2026-08-03T11:00:00+01:00", garmin_connection_status: "not_connected" },
      { athlete_id: "empty", last_log_at: null, garmin_connection_status: "not_connected" },
      { athlete_id: "garmin", last_log_at: "2026-08-07T10:00:00+01:00", garmin_connection_status: "connection_revoked", garmin_revoked_at: "2026-08-07T09:00:00+01:00" }
    ]
  });

  assert.equal(result.items.find(item => item.athleteId === "normal").id, "reporting_normally");
  assert.equal(result.items.find(item => item.athleteId === "today").id, "no_logs_today");
  assert.equal(result.items.find(item => item.athleteId === "long").id, "prolonged_absence");
  assert.equal(result.items.find(item => item.athleteId === "empty").id, "insufficient_data");
  assert.equal(result.items.find(item => item.athleteId === "garmin").label, "Garmin needs reconnecting");
  assert.deepEqual(result.summary, {
    total: 5,
    reportingNormally: 1,
    noLogsToday: 1,
    prolongedAbsence: 1,
    insufficientData: 1,
    garminReconnect: 1
  });

  const emptyRoster = domain.buildCoachRoster({
    athletes: [athletes.find(athlete => athlete.userId === "empty")],
    logs: [],
    now
  });
  const emptyHealth = { items: result.items.filter(item => item.athleteId === "empty") };
  const emptyAttention = domain.buildCoachAttentionItems({ roster: emptyRoster, dataHealth: emptyHealth, now });
  assert.equal(emptyAttention.length, 1);
  assert.equal(emptyAttention[0].type, "insufficient_data");
});

test("attention summary keeps operational categories concise", () => {
  const summary = domain.attentionSummary([
    { category: "need_attention" },
    { category: "need_attention" },
    { category: "approaching_gap" },
    { category: "repeated_sleepy" },
    { category: "not_logging" },
    { category: "not_logging" }
  ]);
  assert.deepEqual(summary, {
    needAttention: 2,
    approachingGap: 1,
    repeatedSleepy: 1,
    notLogging: 2,
    total: 6
  });
});

test("coach workflow migration protects actions, notes and nudges with active-sharing RLS", () => {
  const sql = read(migrationPath);
  const noComments = sql.replace(/^--.*$/gm, "");

  assert.match(sql, /create table if not exists public\.fuel_coach_attention_actions/);
  assert.match(sql, /unique \(coach_id, athlete_id, occurrence_key\)/);
  assert.match(sql, /status in \('reviewed', 'dismissed'\)/);
  assert.match(sql, /create table if not exists public\.fuel_coach_notes/);
  assert.match(sql, /create table if not exists public\.fuel_coach_nudges/);
  assert.match(sql, /alter table public\.fuel_coach_attention_actions enable row level security/);
  assert.match(sql, /alter table public\.fuel_coach_notes enable row level security/);
  assert.match(sql, /alter table public\.fuel_coach_nudges enable row level security/);
  assert.match(sql, /fuel_coach_attention_actions_insert_active_coach[\s\S]*relationship\.status = 'active'/);
  assert.match(sql, /fuel_coach_notes_insert_active_coach[\s\S]*relationship\.status = 'active'/);
  assert.match(sql, /fuel_coach_nudges_insert_active_coach[\s\S]*relationship\.status = 'active'/);
  assert.match(sql, /fuel_coach_nudges_select_participant[\s\S]*auth\.uid\(\)\) = athlete_id/);
  assert.doesNotMatch(sql, /grant update[^;]*fuel_coach_nudges to authenticated/);
  assert.doesNotMatch(noComments, /service_role|auth\.role\(\)/);
});

test("data-health RPC exposes safe statuses without Garmin credentials", () => {
  const sql = read(migrationPath);
  const functionSql = sql.slice(
    sql.indexOf("create or replace function private.fuel_coach_data_health_for_caller"),
    sql.indexOf("comment on table public.fuel_coach_attention_actions")
  );

  assert.match(functionSql, /security definer/);
  assert.match(functionSql, /where relationship\.coach_id = caller_id[\s\S]*relationship\.status = 'active'/);
  assert.match(functionSql, /'connected'[\s\S]*'connection_revoked'[\s\S]*'not_connected'/);
  assert.match(functionSql, /revoke all on function private\.fuel_coach_data_health_for_caller\(\) from public, anon/);
  assert.match(functionSql, /create or replace function public\.fuel_coach_data_health\(\)[\s\S]*security invoker/);
  assert.doesNotMatch(functionSql, /token_hash|token_prefix|access_token|refresh_token/);
});

test("nudges have a default, auditable coach record and appear in the canonical athlete PWA", () => {
  const sql = read(migrationPath);
  const athleteHtml = read("index.html");
  const athleteJs = read("fuel-beta.js");
  const coachJs = read("coach/coach-beta.js");

  assert.match(sql, /message text not null default 'Quick Fuel Guard check-in — remember to log when you next fuel\.'/);
  assert.match(sql, /coach_id uuid not null/);
  assert.match(sql, /athlete_id uuid not null/);
  assert.match(sql, /sent_at timestamptz not null default now\(\)/);
  assert.match(athleteHtml, /id="coachNudgeInbox"/);
  assert.match(athleteHtml, /id="coachNudgeList"/);
  assert.match(athleteJs, /COACH_NUDGES_TABLE = "fuel_coach_nudges"/);
  assert.match(athleteJs, /function renderCoachNudges/);
  assert.match(athleteJs, /\.eq\("athlete_id", user\.id\)/);
  assert.match(coachJs, /domain\.DEFAULT_NUDGE_MESSAGE/);
  assert.match(coachJs, /attention_occurrence_key: item\.occurrenceKey/);
  assert.doesNotMatch(athleteJs, /read receipt|seen_at|typing indicator/i);
});

test("interventions schedule four-week reviews and surface due follow-up in the inbox", () => {
  const sql = read(migrationPath);
  const coachJs = read("coach/coach-beta.js");
  const athlete = { userId: "athlete-review", displayName: "Review Athlete" };
  const items = domain.buildCoachAttentionItems({
    roster: [{ athlete, flags: [], lastFuel: null, sleepyLogs: [] }],
    dataHealth: { items: [] },
    interventions: [{
      id: "intervention-a",
      athlete_id: athlete.userId,
      status: "active",
      action_text: "Afternoon fuelling intervention",
      review_date: "2026-08-07"
    }],
    now: new Date("2026-08-07T14:00:00+01:00")
  });

  assert.equal(items[0].type, "intervention_review_due");
  assert.match(items[0].detail, /Afternoon fuelling intervention/);
  assert.match(sql, /review_window_days integer not null default 28/);
  assert.match(sql, /status in \('active', 'review_due', 'reviewed', 'closed'\)/);
  assert.match(sql, /review_date <= current_date/);
  assert.match(coachJs, /function renderInterventionReview/);
  assert.match(coachJs, /Equivalent[\s\S]*-day periods before and after/);
  assert.match(coachJs, /does not claim the intervention caused an outcome/);
});

test("intervention comparison uses equivalent periods and reports insufficient data honestly", () => {
  const comparison = domain.interventionComparison({
    intervention: { intervention_date: "2026-08-01", review_window_days: 28 },
    logs: [],
    targets: { maximumFuelGapMinutes: 180 }
  });

  assert.equal(comparison.windowDays, 28);
  assert.equal(comparison.beforePeriod.days, comparison.afterPeriod.days);
  assert.equal(comparison.beforePeriod.endKey, "2026-07-31");
  assert.equal(comparison.afterPeriod.startKey, "2026-08-01");
  assert.equal(comparison.enoughData, false);
  assert.equal(comparison.direction, "insufficient");
  assert.match(comparison.label, /Not enough comparable/);
});

test("coach inbox exposes the complete operational action set and empty state", () => {
  const coachJs = read("coach/coach-beta.js");
  const coachHtml = read("coach/index.html");

  assert.match(coachHtml, /id="coachNeedsAttention"/);
  assert.match(coachHtml, /id="coachDataHealth"/);
  assert.match(coachJs, />Reviewed</);
  assert.match(coachJs, />Add note</);
  assert.match(coachJs, />Create intervention</);
  assert.match(coachJs, />Nudge athlete</);
  assert.match(coachJs, />Open athlete</);
  assert.match(coachJs, />Dismiss</);
  assert.match(coachJs, /Inbox clear/);
});
