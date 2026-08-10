const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const domain = require(path.join(root, "fuel-guard-domain.js"));
const migration = [
  read("supabase/migrations/20260810101351_team_sport_sessions.sql"),
  read("supabase/migrations/20260810102947_team_sport_sessions_advisor_hardening.sql"),
  read("supabase/migrations/20260810104612_team_sport_session_history_safety.sql"),
  read("supabase/migrations/20260810105241_team_sport_session_fk_indexes.sql")
].join("\n");
const coach = read("coach/coach-beta.js");
const athlete = read("fuel-beta.js");
const training = read("training-mode.js");
const pgtap = read("supabase/tests/team_sport_sessions_rls_test.sql");

function context({
  sessionId,
  athleteId,
  athleteName,
  start,
  pre = "green",
  post = "prompt"
}) {
  return {
    session_id: sessionId,
    athlete_id: athleteId,
    athlete_name: athleteName,
    starts_at: `${start}T19:00:00Z`,
    ends_at: `${start}T21:00:00Z`,
    timezone_name: "UTC",
    session_status: "scheduled",
    pre_session_status: pre,
    post_session_status: post
  };
}

test("team session migration extends the canonical schedule without per-athlete session duplication", () => {
  assert.match(migration, /alter table public\.fuel_training_sessions[\s\S]*audience_scope text not null default 'assigned'/);
  assert.match(migration, /audience_scope in \('assigned', 'team'\)/);
  assert.match(migration, /lower\(trim\(session_type\)\) in \('training', 'game', 'other'\)/);
  assert.match(migration, /create table public\.fuel_team_athlete_membership_periods/);
  assert.match(migration, /where left_at is null/);
  assert.match(migration, /create table public\.fuel_training_session_coach_notes/);
  assert.match(migration, /create or replace function public\.fuel_save_team_session/);
  assert.match(migration, /create or replace function public\.fuel_athlete_team_sessions/);
  assert.match(migration, /create or replace function public\.fuel_team_session_context/);
  assert.match(migration, /training_session\.audience_scope = 'team'/);
  assert.doesNotMatch(migration, /insert into public\.fuel_training_session_athletes[\s\S]{0,500}audience_scope/);
});

test("membership history and private note boundaries are explicit", () => {
  assert.match(migration, /old\.status = 'active' and new\.status = 'revoked'[\s\S]*set left_at/);
  assert.match(migration, /old\.status = 'revoked' and new\.status = 'active'[\s\S]*insert into public\.fuel_team_athlete_membership_periods/);
  assert.match(migration, /revoke all on table public\.fuel_team_athlete_membership_periods from public, anon, authenticated/);
  assert.match(migration, /fuel_training_session_coach_notes_select_staff[\s\S]*fuel_has_team_access/);
  assert.match(migration, /fuel_athlete_team_sessions[\s\S]*team_name[\s\S]*location[\s\S]*status text/);
  assert.doesNotMatch(migration.match(/create or replace function public\.fuel_athlete_team_sessions[\s\S]*?\$\$;/)?.[0] || "", /note_text|coach_note/);
});

test("server-side mutation and context APIs enforce the accepted permission model", () => {
  assert.match(migration, /security invoker[\s\S]*fuel_save_team_session/);
  assert.match(migration, /private\.fuel_has_team_access\(team\.id, 'contributor'\)/);
  assert.match(migration, /Training session identity cannot be changed/);
  assert.match(migration, /A cancelled session cannot be reopened/);
  assert.match(migration, /starts_at > now\(\)/);
  assert.match(migration, /private\.fuel_can_access_team_athlete\([\s\S]*roster\.athlete_id[\s\S]*'viewer'/);
  assert.match(migration, /fuel_team_athlete_membership_periods_select_authorised/);
  assert.match(migration, /alter function public\.fuel_athlete_team_sessions[\s\S]*security invoker/);
  assert.match(migration, /alter function public\.fuel_team_session_context[\s\S]*security invoker/);
  assert.match(migration, /audience_scope <> 'team' or starts_at > now\(\)/);
  assert.match(migration, /fuel_training_sessions_team_fk_idx/);
  assert.match(migration, /fuel_training_sessions_group_fk_idx/);
  assert.match(migration, /when pre_gap\.minutes >= target\.maximum_fuel_gap_minutes then 'red'/);
  assert.match(migration, /when post_gap\.minutes <= 60 then 'prompt'/);
  assert.match(migration, /when post_gap\.minutes <= 240 then 'late'/);
});

test("weekly team session brief reports coverage, pre/post consistency, trends and positive streaks", () => {
  const period = { startKey: "2026-08-03", endKey: "2026-08-09", timeZone: "UTC" };
  const comparisonPeriod = { startKey: "2026-07-27", endKey: "2026-08-02", timeZone: "UTC" };
  const rows = [
    context({ sessionId: "s1", athleteId: "a1", athleteName: "Alex", start: "2026-08-07" }),
    context({ sessionId: "s1", athleteId: "a2", athleteName: "Blair", start: "2026-08-07", pre: "red", post: "no_fuel" }),
    context({ sessionId: "s2", athleteId: "a1", athleteName: "Alex", start: "2026-08-08" }),
    context({ sessionId: "s2", athleteId: "a2", athleteName: "Blair", start: "2026-08-08", pre: "no_logging", post: "late" }),
    context({ sessionId: "p1", athleteId: "a1", athleteName: "Alex", start: "2026-08-01", pre: "red", post: "no_fuel" }),
    context({ sessionId: "p2", athleteId: "a1", athleteName: "Alex", start: "2026-08-02", pre: "red", post: "late" }),
    context({ sessionId: "p1", athleteId: "a2", athleteName: "Blair", start: "2026-08-01" }),
    context({ sessionId: "p2", athleteId: "a2", athleteName: "Blair", start: "2026-08-02" })
  ];
  const brief = domain.buildTeamSessionCoachBrief({ contexts: rows, period, comparisonPeriod, timeZone: "UTC" });
  assert.equal(brief.sessionCount, 2);
  assert.equal(brief.athleteSessions, 4);
  assert.equal(brief.loggingCoveragePct, 75);
  assert.equal(brief.preConsistencyPct, 67);
  assert.equal(brief.postPromptPct, 50);
  assert.deepEqual(brief.improving.map(item => item.athleteId), ["a1"]);
  assert.deepEqual(brief.deteriorating.map(item => item.athleteId), ["a2"]);
  assert.deepEqual(brief.missingPatterns.map(item => item.athleteId), ["a2"]);
});

test("three strong completed team sessions create a positive team milestone without a leaderboard", () => {
  const period = { startKey: "2026-08-03", endKey: "2026-08-09", timeZone: "UTC" };
  const rows = ["2026-08-05", "2026-08-06", "2026-08-07"].flatMap((day, index) => [
    context({ sessionId: `s${index}`, athleteId: "a1", athleteName: "Alex", start: day }),
    context({ sessionId: `s${index}`, athleteId: "a2", athleteName: "Blair", start: day, pre: "yellow" })
  ]);
  const brief = domain.buildTeamSessionCoachBrief({ contexts: rows, period, timeZone: "UTC" });
  assert.equal(brief.teamSessionStreak, 3);
  assert.equal(brief.milestone, "3-session team consistency streak");
  assert.equal(Object.hasOwn(brief, "leaderboard"), false);
});

test("Coach and Athlete UI use shared team context while leaving logging and endurance Training Mode intact", () => {
  assert.match(coach, /<h2>Sessions<\/h2>/);
  assert.match(coach, /fuel_save_team_session/);
  assert.match(coach, /data-edit-team-session/);
  assert.match(coach, /data-cancel-team-session/);
  assert.match(coach, /data-delete-team-session/);
  assert.match(coach, /const deletable = canContributeToTeam\(session\.team_id\) && new Date\(session\.starts_at\) > now/);
  assert.match(coach, /Pre-session triage/);
  assert.match(coach, /Post-session summary/);
  assert.match(athlete, /function renderAthleteTeamSessionContext/);
  assert.match(athlete, /Tonight/);
  assert.match(training, /Shared team context/);
  assert.match(training, /logging stays unchanged/);
  assert.match(training, /function startSession/);
  assert.match(training, /domain\(\)\.trainingEventContext/);
});

test("pgTAP covers team creation, history, classifications, isolation and direct-ID attacks", () => {
  assert.match(pgtap, /select plan\(34\)/);
  assert.match(pgtap, /Team session creation does not create per-athlete assignment rows/);
  assert.match(pgtap, /Athlete retains historical team session context after leaving/);
  assert.match(pgtap, /Cross-organisation coach cannot read Team A session context/);
  assert.match(pgtap, /Coach relationship revocation removes athlete timing context/);
  assert.match(pgtap, /Athlete cannot read the private coach note/);
  assert.match(pgtap, /Pre-session status is yellow/);
  assert.match(pgtap, /Post-session status is prompt/);
  assert.match(pgtap, /Past team session schedule fields cannot be rewritten/);
  assert.match(pgtap, /Past team session cannot be cancelled after it starts/);
});
