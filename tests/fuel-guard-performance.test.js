const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260808122312_fuel_guard_performance.sql");
const accessMigration = read("supabase/migrations/20260808201101_performance_access_ux.sql");
const platformMigration = read("supabase/migrations/20260809083545_platform_admin_access.sql");
const accessMigrationWithoutComments = accessMigration.replace(/--[^\n]*/g, "");
const migrationWithoutComments = migration.replace(/--[^\n]*/g, "");
const html = read("performance/index.html");
const css = read("performance/performance.css");
const js = read("performance/performance.js");
const athleteHtml = read("index.html");
const athleteSharing = read("organisation-sharing.js");
const sw = read("sw.js");
const vercel = read("vercel.json");
const pgtap = read("supabase/tests/fuel_guard_performance_rls_test.sql");

test("Performance is a distinct Fuel Guard surface with the required navigation", () => {
  assert.match(html, /<title>Fuel Guard Performance<\/title>/);
  for (const label of ["Overview", "Pathway", "Staff &amp; Access", "Reports", "Settings"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /data-performance-tab="overview"/);
  assert.match(html, /id="appShell"/);
  assert.doesNotMatch(html, /old web PWA|deprecated_old_frontends/);
});

test("Performance requests secure RPC payloads instead of raw athlete histories", () => {
  for (const rpc of [
    "fuel_performance_context",
    "fuel_performance_overview",
    "fuel_performance_pathway",
    "fuel_performance_staff_access",
    "fuel_performance_reports",
    "fuel_performance_athlete_detail"
  ]) assert.match(js, new RegExp(`rpc\\(\\"${rpc}\\"`));
  assert.doesNotMatch(js, /\.from\(["']fuel_logs["']\)/);
  assert.doesNotMatch(js, /\.from\(["']garmin_activity_summaries["']\)/);
  assert.doesNotMatch(js, /\.from\(["']fuel_coach_interventions["']\)/);
});

test("existing team storage is additively extended as generic nested units", () => {
  assert.match(migration, /alter table public\.fuel_teams[\s\S]*parent_team_id uuid/);
  assert.match(migration, /unit_type text/);
  assert.match(migration, /foreign key \(parent_team_id, organisation_id\)[\s\S]*references public\.fuel_teams/);
  assert.match(migration, /fuel_performance_validate_unit_parent/);
  assert.match(migration, /hierarchy cannot contain a cycle/);
  assert.doesNotMatch(migration, /create table public\.fuel_organisation_units/);
});

test("scope and capability remain independent, auditable relationships", () => {
  assert.match(migration, /create table public\.fuel_staff_capabilities/);
  assert.match(migration, /create table public\.fuel_staff_scopes/);
  assert.match(migration, /scope_type = 'organisation'/);
  assert.match(migration, /scope_type = 'unit'/);
  assert.match(migration, /scope_type = 'athlete'/);
  assert.match(migration, /include_descendants boolean/);
  assert.doesNotMatch(migration, /role text[^;]*view_org_aggregates/);
  assert.match(html, /Scope<\/strong> controls who a person can see/);
  assert.match(html, /Capability<\/strong> controls what they can do/);
});

test("organisation admin bootstrap excludes sensitive athlete detail", () => {
  const bootstrap = migration.match(/create or replace function private\.fuel_performance_bootstrap_owner\(\)[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(bootstrap, /manage_structure/);
  assert.match(bootstrap, /manage_staff_access/);
  assert.match(bootstrap, /view_org_aggregates/);
  assert.doesNotMatch(bootstrap, /view_athlete_detail/);
  assert.doesNotMatch(bootstrap, /manage_interventions/);
});

test("Performance account UX keeps shared identity separate from Performance permission", () => {
  assert.match(html, /existing Fuel Guard account/);
  assert.match(html, /id="createAccountButton"/);
  assert.match(html, /id="forgotPasswordButton"/);
  assert.match(html, /does not grant access to any organisation or athlete data/);
  assert.match(html, /Performance access isn’t enabled yet/);
  assert.match(html, /id="accessIdentity"/);
  assert.match(html, /Sign out \/ Switch account/);
  assert.match(js, /auth\.signUp/);
  assert.match(js, /auth\.resetPasswordForEmail/);
  assert.match(js, /auth\.updateUser/);
  assert.match(js, /\$\("accessIdentity"\)\.textContent = state\.session\?\.user\?\.email/);
  assert.match(js, /state\.tab = "overview";\s*showTab\("overview"\)/);
  assert.doesNotMatch(js, /signUp[\s\S]{0,400}fuel_performance_set_(?:capability|scope|staff_membership)/);
  assert.match(css, /html \{[^}]*overflow-x: hidden;/);
  assert.match(css, /body \{[^}]*overflow-x: hidden;/);
  assert.match(css, /\.access-identity strong \{[\s\S]*?overflow-wrap: anywhere;/);
});

test("safe organisation bootstrap grants management without athlete-detail capability", () => {
  assert.match(html, /without automatic athlete-detail access/);
  assert.match(js, /fuel_performance_create_organisation/);
  assert.match(accessMigration, /insert into public\.fuel_organisations \(name, created_by\)/);
  assert.doesNotMatch(accessMigration, /view_athlete_detail|manage_interventions/);
});

test("athlete organisation sharing is explicit, athlete-activated, revocable and immutable", () => {
  assert.match(migration, /create table public\.fuel_organisation_athlete_shares/);
  assert.match(migration, /check \(status in \('invited', 'active', 'revoked'\)\)/);
  assert.match(migration, /Only the athlete can activate organisation sharing/);
  assert.match(migration, /Organisation sharing identity cannot be changed/);
  assert.match(migration, /fuel_athlete_set_organisation_sharing/);
  assert.match(athleteHtml, /id="organisationSharingCard"/);
  assert.match(athleteSharing, /Stop sharing/);
  assert.match(athleteSharing, /without deleting your account|personal Fuel Guard data remains private/);
});

test("shared identity trigger branches before reading table-specific fields", () => {
  const guard = migration.match(/create or replace function private\.fuel_performance_prevent_identity_repoint\(\)[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(guard, /if tg_table_name = 'fuel_staff_capabilities' then\s+if \(new\.organisation_id, new\.user_id, new\.capability\)/);
  assert.match(guard, /elsif tg_table_name = 'fuel_staff_scopes' then\s+if \(new\.organisation_id, new\.user_id, new\.scope_type/);
  assert.match(guard, /elsif tg_table_name = 'fuel_organisation_athlete_shares' then\s+if \(new\.organisation_id, new\.athlete_id\)/);
});

test("aggregate permission resolution intersects capability, active share, assignment and scope", () => {
  const access = migration.match(/create or replace function private\.fuel_performance_can_access_athlete[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(access, /fuel_performance_has_capability/);
  assert.match(access, /fuel_organisation_athlete_shares/);
  assert.match(access, /share\.status = 'active'/);
  assert.match(access, /fuel_team_athletes/);
  assert.match(access, /assignment\.status = 'active'/);
  assert.match(access, /fuel_performance_unit_in_scope/);
  assert.match(access, /scope\.scope_type = 'athlete'/);
});

test("security-definer APIs validate auth and use a safe search path", () => {
  const publicFunctions = [...migration.matchAll(/create or replace function public\.(fuel_(?:performance|athlete)_[\w]+)[\s\S]*?\$\$;/g)];
  assert.ok(publicFunctions.length >= 11);
  publicFunctions.forEach(match => {
    assert.match(match[0], /security definer/);
    assert.match(match[0], /set search_path = ''/);
    assert.match(migration, new RegExp(`revoke all on function public\\.${match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
  assert.doesNotMatch(migrationWithoutComments, /auth\.role\(\)|raw_user_meta_data|user_metadata|service_role/);
});

test("new public relationship tables use explicit grants and RLS", () => {
  for (const table of ["fuel_staff_capabilities", "fuel_staff_scopes", "fuel_organisation_athlete_shares"]) {
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /grant update \(status, revoked_at, updated_at\)[\s\S]*fuel_staff_capabilities/);
  assert.match(migration, /grant update \(include_descendants, status, revoked_at, updated_at\)[\s\S]*fuel_staff_scopes/);
  assert.match(migration, /grant update \(status, shared_at, revoked_at, updated_at\)[\s\S]*fuel_organisation_athlete_shares/);
  assert.doesNotMatch(migration, /grant (?:select, )?update, delete on table public\.fuel_(?:staff_capabilities|staff_scopes|organisation_athlete_shares)/);
  for (const index of [
    "fuel_teams_parent_fk_idx",
    "fuel_staff_capabilities_granted_by_idx",
    "fuel_staff_scopes_unit_fk_idx",
    "fuel_staff_scopes_athlete_idx",
    "fuel_staff_scopes_assigned_by_idx",
    "fuel_organisation_athlete_shares_invited_by_idx"
  ]) assert.match(migration, new RegExp(`create index(?: if not exists)? ${index}`));
  assert.doesNotMatch(migration, /create policy fuel_teams_(?:select|insert|update)_performance/);
  assert.match(migration, /Performance unit metadata and management stay behind the capability-checked/);
});

test("overview reuses Coach actions and interventions without exposing narratives", () => {
  const overview = migration.match(/create or replace function public\.fuel_performance_overview[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(overview, /fuel_coach_attention_actions/);
  assert.match(overview, /fuel_coach_interventions/);
  assert.match(overview, /maximum_fuel_gap_minutes/);
  assert.match(overview, /garmin_daily_features/);
  assert.match(overview, /workouts_missing_pre_fuel/);
  assert.match(overview, /Garmin connection requires attention/);
  assert.match(overview, /'reviewed'/);
  assert.match(overview, /'intervention_created'/);
  assert.doesNotMatch(overview, /action_text|observation|review_notes|note_text/);
  assert.doesNotMatch(`${html}\n${js}\n${migrationWithoutComments}`, /RED-S|low energy availability|nutritional deficiency/i);
  assert.match(js, /Operational visibility without staff ranking/);
});

test("reports aggregate server-side and suppress small cohorts before metrics are returned", () => {
  const reports = migration.match(/create or replace function public\.fuel_performance_reports[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(reports, /cohort_count < minimum_cohort/);
  assert.match(reports, /'status', 'suppressed'/);
  assert.match(reports, /'reason', 'Insufficient cohort size'/);
  assert.match(reports, /'fuelling', null/);
  assert.match(reports, /'trainingContext', null/);
  assert.match(reports, /garmin_daily_features/);
  assert.match(reports, /workouts_missing_pre_fuel/);
  assert.match(reports, /workouts_missing_post_fuel/);
});

test("missing and suppressed data are never presented as zero", () => {
  assert.match(js, /value == null \? "Suppressed"/);
  assert.match(js, /Insufficient cohort size/);
  assert.match(js, /Missing data is not treated as a healthy pattern/);
  assert.match(js, /No normalized workouts are available/);
  assert.match(js, /No actively shared athletes|No organisation units/);
});

test("Staff & Access provides narrow management RPCs for scope and capability", () => {
  assert.match(js, /fuel_performance_set_capability/);
  assert.match(js, /fuel_performance_set_scope/);
  assert.match(js, /fuel_performance_set_staff_membership_by_email/);
  assert.match(js, /fuel_performance_staff_accounts/);
  assert.match(js, /fuel_performance_set_athlete_unit/);
  assert.match(js, /fuel_performance_invite_athlete/);
  assert.match(js, /fuel_performance_save_unit/);
  assert.match(migration, /Staff member is not active in this organisation/);
  assert.match(migration, /Athlete is not actively sharing with this organisation/);
  assert.match(migration, /Parent unit is outside your scope/);
  assert.match(html, /id="membershipEmailInput"/);
  assert.doesNotMatch(html, /id="membershipUserInput"/);
  assert.match(accessMigration, /Authorise before looking up the account/);
  assert.match(accessMigration, /private\.fuel_performance_has_capability\(p_organisation_id, 'manage_staff_access'\)/);
  assert.doesNotMatch(accessMigrationWithoutComments, /auth\.role\(\)|raw_user_meta_data|user_metadata|service_role/);
});

test("Performance UI is desktop-first, responsive and accessibility-labelled", () => {
  assert.match(css, /grid-template-columns: 240px minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /grid-template-columns: repeat\(5, 1fr\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(html, /aria-label="Performance navigation"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-labelledby="overviewTitle"/);
});

test("platform administration is explicit, revocable, auditable and visibly contextual", () => {
  assert.match(platformMigration, /create table private\.fuel_platform_admins/);
  assert.match(platformMigration, /create table private\.fuel_platform_admin_organisation_access/);
  assert.match(platformMigration, /create table private\.fuel_platform_admin_audit_events/);
  assert.match(platformMigration, /fuel_platform_admin_has_organisation_access/);
  assert.match(platformMigration, /Platform administrator identity is immutable/);
  assert.match(platformMigration, /Platform administrator organisation access identity is immutable/);
  assert.match(platformMigration, /revoke all on table private\.fuel_platform_admins\s+from public, anon, authenticated/);
  assert.doesNotMatch(platformMigration.replace(/--[^\n]*/g, ""), /raw_user_meta_data|user_metadata|service_role/);
  assert.match(html, /id="platformAdminBanner"/);
  assert.match(html, /Fuel Guard Admin/);
  assert.match(js, /fuel_platform_admin_context/);
  assert.match(html, /Viewing/);
});

test("organisation switching clears prior data before the new RPC requests", () => {
  const handler = js.match(/\$\("organisationPicker"\)\.addEventListener\("change"[\s\S]*?\n\s*\}\);/)?.[0] || "";
  assert.match(handler, /resetOrganisationData\(\)/);
  assert.ok(handler.indexOf("resetOrganisationData()") < handler.indexOf("state.organisationId = event.target.value"));
  assert.match(handler, /Switching organisation/);
});

test("Performance athlete detail uses shared training-fuel semantics and a permissioned intervention workflow", () => {
  assert.match(html, /id="athleteDetailPanel"/);
  assert.match(html, /fuel-guard-domain\.js/);
  assert.match(js, /domain\.getWorkoutFuelContexts/);
  assert.match(js, /Pre-training fuel/);
  assert.match(js, /Post-training fuel/);
  assert.match(js, /No pre-training fuel recorded/);
  assert.match(js, /Insufficient training data/);
  assert.match(js, /fuel_performance_create_intervention/);
  assert.match(js, /fuel_performance_update_intervention/);
  assert.match(platformMigration, /private\.fuel_performance_can_access_athlete/);
  assert.match(platformMigration, /'manage_interventions'/);
  assert.match(platformMigration, /alter table public\.fuel_performance_interventions enable row level security/);
  assert.match(platformMigration, /revoke all on table public\.fuel_performance_interventions\s+from public, anon, authenticated/);
});

test("demo hierarchy initialization is explicit and atomic", () => {
  assert.match(html, /Create demo gym structure/);
  assert.match(html, /not fake dashboard values/);
  assert.match(js, /fuel_performance_create_demo_structure/);
  const initializer = platformMigration.match(/create or replace function public\.fuel_performance_create_demo_structure[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(initializer, /Demo structure requires an empty organisation/);
  for (const location of ["Bedford", "Cambridge", "Oxford"]) assert.match(initializer, new RegExp(location));
  assert.match(initializer, /Personal Training/);
});

test("service worker versions and routes Athlete, Coach and Performance independently", () => {
  assert.match(sw, /mobile-pwa-v116-performance-demo-readiness/);
  assert.match(sw, /\.\/performance\/index\.html/);
  assert.match(sw, /\.\/performance\/performance\.css/);
  assert.match(sw, /\.\/performance\/performance\.js/);
  assert.match(sw, /pathname\.startsWith\("\/performance"\)/);
  assert.match(sw, /pathname\.startsWith\("\/coach"\)/);
  assert.match(sw, /\.\/organisation-sharing\.js/);
  assert.match(vercel, /"source": "\/performance\/index\.html"/);
  assert.match(vercel, /"source": "\/performance\/"/);
});

test("pgTAP covers the gym case, nested isolation, consent, suppression and direct attacks", () => {
  assert.match(pgtap, /select plan\(94\)/);
  assert.match(pgtap, /PT A cannot access PT B client/);
  assert.match(pgtap, /pathway excludes the sibling Northampton location/);
  assert.match(pgtap, /Bedford manager aggregate includes both Bedford PT programmes/);
  assert.match(pgtap, /Organisation owner is not automatically granted athlete detail/);
  assert.match(pgtap, /Cross-organisation overview RPC is denied/);
  assert.match(pgtap, /Direct sibling unit ID returns no PT B clients/);
  assert.match(pgtap, /Revocation immediately removes the athlete/);
  assert.match(pgtap, /Scope relationship cannot be repointed/);
  assert.match(pgtap, /Inactive staff immediately lose Performance context/);
  assert.match(pgtap, /cannot reassign an athlete by direct RPC/);
  assert.match(pgtap, /Anonymous caller cannot execute Performance context/);
  assert.match(pgtap, /New account can create a secure organisation workspace/);
  assert.match(pgtap, /Owner bootstrap does not grant athlete detail to the new account/);
  assert.match(pgtap, /Access manager can add a Fuel Guard account by exact email/);
  assert.match(pgtap, /Unauthorised staff cannot enumerate organisation account emails/);
  assert.match(pgtap, /Staff cannot grant themselves an additional capability/);
  assert.match(pgtap, /Platform administrator receives no implicit customer organisation access/);
  assert.match(pgtap, /Organisation-context revocation removes Performance access immediately/);
  assert.match(pgtap, /Revoked platform administrator cannot attack athlete detail by direct ID/);
});
