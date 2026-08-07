const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260807172224_coach_organisation_foundations.sql"
);
const rlsTestPath = path.join(
  root,
  "supabase",
  "tests",
  "coach_organisation_foundations_rls_test.sql"
);
const sql = fs.readFileSync(migrationPath, "utf8");
const rlsTests = fs.readFileSync(rlsTestPath, "utf8");
const sqlWithoutComments = sql.replace(/^--.*$/gm, "");

const tables = [
  "fuel_organisations",
  "fuel_organisation_members",
  "fuel_teams",
  "fuel_team_staff",
  "fuel_team_athletes",
  "fuel_staff_notes",
  "fuel_saved_groups",
  "fuel_saved_group_members",
  "fuel_training_sessions",
  "fuel_training_session_athletes"
];

test("organisation foundation migration creates constrained, indexed RLS tables", () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }

  assert.match(sql, /fuel_team_staff_organisation_member_fk/);
  assert.match(sql, /fuel_team_athletes_team_fk/);
  assert.match(sql, /fuel_staff_notes_team_fk/);
  assert.match(sql, /fuel_training_sessions_group_fk/);
  assert.match(sql, /on delete set null \(saved_group_id\)/);
  assert.match(sql, /fuel_team_staff_user_status_idx/);
  assert.match(sql, /fuel_team_athletes_athlete_status_idx/);
  assert.match(sql, /fuel_staff_notes_team_athlete_created_idx/);
  assert.match(sql, /fuel_saved_group_members_athlete_idx/);
  assert.match(sql, /fuel_training_sessions_team_start_idx/);
  assert.match(sql, /fuel_training_session_athletes_athlete_idx/);
});

test("staff note access requires team staff, team athlete, and direct active sharing", () => {
  assert.match(sql, /create or replace function private\.fuel_can_access_team_athlete/);
  assert.match(sql, /private\.fuel_has_team_access\(p_team_id, p_required_access\)/);
  assert.match(sql, /private\.fuel_has_direct_athlete_access\(p_athlete_id\)/);
  assert.match(sql, /from public\.fuel_team_athletes athlete[\s\S]*athlete\.status = 'active'/);
  assert.match(sql, /from public\.fuel_coach_athletes relationship[\s\S]*relationship\.status = 'active'/);
  assert.match(sql, /fuel_staff_notes_select_authorised_staff[\s\S]*fuel_can_access_team_athlete\(team_id, athlete_id, 'viewer'\)/);
  assert.match(sql, /fuel_staff_notes_insert_authorised_staff[\s\S]*author_id = \(select auth\.uid\(\)\)[\s\S]*fuel_can_access_team_athlete\(team_id, athlete_id, 'contributor'\)/);
  assert.doesNotMatch(sql, /fuel_staff_notes_(update|delete)_/);
  assert.doesNotMatch(sql, /grant (update|delete)[^;]*fuel_staff_notes/);
  assert.match(sql, /new\.author_display_name := coalesce/);
  assert.match(sql, /new\.created_at := now\(\)/);
});

test("saved groups remain metadata and are filtered by current sharing access", () => {
  assert.match(sql, /scope = 'personal'/);
  assert.match(sql, /scope = 'team'/);
  assert.match(sql, /fuel_saved_groups_personal_name_idx/);
  assert.match(sql, /fuel_saved_groups_team_name_idx/);
  assert.match(sql, /create or replace function private\.fuel_can_access_saved_group_athlete/);
  assert.match(sql, /private\.fuel_has_direct_athlete_access\(p_athlete_id\)/);
  assert.match(sql, /fuel_saved_group_members_select_authorised[\s\S]*fuel_can_access_saved_group_athlete\(group_id, athlete_id, false\)/);
  assert.match(sql, /fuel_saved_group_members_insert_authorised[\s\S]*fuel_can_access_saved_group_athlete\(group_id, athlete_id, true\)/);
  assert.match(sql, /create view public\.fuel_authorised_group_roster[\s\S]*security_invoker = true/);
  assert.doesNotMatch(sql, /fuel_saved_group_members[\s\S]{0,300}(grant|policy)[\s\S]{0,200}fuel_logs/);
});

test("training model preserves timezone, assignment, and future adapter boundaries", () => {
  assert.match(sql, /session_date date not null/);
  assert.match(sql, /starts_at timestamptz not null/);
  assert.match(sql, /ends_at timestamptz not null/);
  assert.match(sql, /timezone_name text not null/);
  assert.match(sql, /session_date = timezone\(timezone_name, starts_at\)::date/);
  assert.match(sql, /ends_at > starts_at and ends_at <= starts_at \+ interval '24 hours'/);
  assert.match(sql, /source in \('manual', 'csv_import'\)/);
  assert.match(sql, /source = 'external_provider'/);
  assert.match(sql, /source_provider text/);
  assert.match(sql, /external_session_id text/);
  assert.match(sql, /fuel_training_sessions_external_idx/);
  assert.match(sql, /fuel_training_session_athletes_insert_contributor[\s\S]*fuel_can_access_training_session_athlete/);
  assert.match(sql, /public\.fuel_assign_training_session_group/);
  assert.match(sql, /public\.fuel_upcoming_training_sessions/);
});

test("operational context reuses RLS data without prescriptions or threshold mutation", () => {
  assert.match(sql, /create view public\.fuel_training_operational_context/);
  assert.match(sql, /with \(security_invoker = true\)/);
  assert.match(sql, /left join public\.fuel_targets target/);
  assert.match(sql, /left join lateral \([\s\S]*from public\.fuel_logs fuel_log/);
  assert.match(sql, /'threshold_not_configured'/);
  assert.match(sql, /'no_prior_fuel'/);
  assert.match(sql, /'exceeded'/);
  assert.match(sql, /'close'/);
  assert.match(sql, /'within'/);
  assert.doesNotMatch(sql, /update public\.fuel_targets/);
  assert.doesNotMatch(sqlWithoutComments, /calorie|meal|required nutrition|prescription/i);
  assert.doesNotMatch(sqlWithoutComments, /garmin_(auth|device|heart|stress|body|profile|activity|daily|weekly)/i);
});

test("private authorization helpers are hardened and public APIs are explicit", () => {
  assert.match(sql, /create schema if not exists private/);
  assert.match(sql, /revoke all on schema private from public, anon/);
  assert.match(sql, /security definer[\s\S]*set search_path = ''/);
  assert.match(sql, /revoke all on function private\.fuel_has_team_access\(uuid, text\) from public, anon/);
  assert.match(sql, /grant execute on function private\.fuel_has_team_access\(uuid, text\) to authenticated/);
  assert.match(sql, /language plpgsql[\s\S]*security invoker[\s\S]*fuel_assign_training_session_group/);
  assert.match(sql, /revoke all on function public\.fuel_upcoming_training_sessions/);
  assert.match(sql, /grant execute on function public\.fuel_upcoming_training_sessions/);
  assert.doesNotMatch(sqlWithoutComments, /auth\.role\(\)|user_metadata|raw_user_meta_data|service_role/);
});

test("pgTAP suite covers isolation, revocation, groups, schedules, and timezone boundaries", () => {
  assert.match(rlsTests, /select plan\(47\)/);
  assert.match(rlsTests, /Coach in another organisation cannot read Organisation A notes/);
  assert.match(rlsTests, /Unauthorised staff cannot write notes for another athlete/);
  assert.match(rlsTests, /Saved-group metadata never grants athlete log access/);
  assert.match(rlsTests, /Revoked relationship hides saved-group membership/);
  assert.match(rlsTests, /Revoked relationship hides shared staff notes/);
  assert.match(rlsTests, /Revoked relationship hides athlete-specific training context/);
  assert.match(rlsTests, /UTC date cannot be stored when it disagrees with the session timezone/);
  assert.match(rlsTests, /Authorised staff can query upcoming sessions by saved group/);
  assert.match(rlsTests, /Authorised contributor can update a manual training session/);
});
