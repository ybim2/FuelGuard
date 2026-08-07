const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migrationPath = path.join(root, "supabase", "migrations", "20260807184331_fuelling_adherence_context.sql");
const rlsTestPath = path.join(root, "supabase", "tests", "fuelling_adherence_context_rls_test.sql");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("adherence migration creates constrained indexed models without duplicating fuel events", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /create table public\.fuel_daily_contexts/i);
  assert.match(sql, /create table public\.fuel_gap_barriers/i);
  assert.match(sql, /references public\.fuel_logs\(id\) on delete set null/gi);
  assert.match(sql, /unique \(user_id, gap_key\)/i);
  assert.match(sql, /exceeded_minutes = greatest\(0, actual_minutes - target_minutes\)/i);
  assert.match(sql, /training_periods <@ array\['morning', 'afternoon', 'evening'\]/i);
  assert.match(sql, /fuel_gap_barriers_user_start_idx/i);
  assert.match(sql, /fuel_gap_barriers_user_quality_start_idx/i);
  assert.doesNotMatch(sql, /insert into public\.fuel_logs/i);
});

test("athletes own writes while coaches receive active-relationship read access only", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  for (const table of ["fuel_daily_contexts", "fuel_gap_barriers"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(sql, new RegExp(`alter table public\\.${table} force row level security`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_select_own_or_active_coach[\\s\\S]*relationship\\.status = 'active'`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_insert_own[\\s\\S]*with check \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_update_own`, "i"));
    assert.match(sql, new RegExp(`create policy ${table}_delete_own`, "i"));
  }
  assert.doesNotMatch(sql, /create policy fuel_daily_contexts_(?:insert|update|delete)_[^\n]*coach/i);
  assert.doesNotMatch(sql, /create policy fuel_gap_barriers_(?:insert|update|delete)_[^\n]*coach/i);
  assert.match(sql, /revoke all on table public\.fuel_daily_contexts from public, anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.fuel_gap_barriers from public, anon, authenticated/i);
});

test("pending, declined, revoked, anonymous, and arbitrary athlete IDs cannot satisfy coach policies", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  const activeChecks = sql.match(/relationship\.status = 'active'/g) || [];
  assert.ok(activeChecks.length >= 3);
  assert.doesNotMatch(sql, /relationship\.status\s+in\s*\([^)]*pending/i);
  assert.doesNotMatch(sql, /relationship\.status\s+<>\s*'revoked'/i);
  assert.doesNotMatch(sql, /to anon/i);
  assert.match(sql, /relationship\.coach_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql, /relationship\.athlete_id = fuel_daily_contexts\.user_id/i);
  assert.match(sql, /relationship\.athlete_id = fuel_gap_barriers\.user_id/i);
});

test("Garmin timing RPC is a minimal locked-down projection with BOLA checks", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /create or replace function public\.fuel_coach_training_activity_timing/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /if auth\.uid\(\) is null/i);
  assert.match(sql, /cardinality\(p_athlete_ids\).*100/is);
  assert.match(sql, /p_end > p_start \+ interval '400 days'/i);
  assert.match(sql, /activity\.user_id = any\(p_athlete_ids\)/i);
  assert.match(sql, /relationship\.athlete_id = activity\.user_id[\s\S]*relationship\.status = 'active'/i);
  assert.match(sql, /revoke all on function public\.fuel_coach_training_activity_timing.*from public, anon/i);
  const returnBlock = sql.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/i)?.[1] || "";
  assert.doesNotMatch(returnBlock, /device_id|distance|calories|heart|stress|battery/i);
});

test("athlete and coach clients use the shared model without exposing privileged credentials", () => {
  const html = read("index.html");
  const athlete = read("fuel-beta.js");
  const cloud = read("fuel-supabase.js");
  const coach = read("coach/coach-beta.js");
  const coachHtml = read("coach/index.html");
  const shared = read("fuel-adherence-context.js");
  assert.match(html, /Training Today/);
  assert.match(html, /data-training-period="morning"/);
  assert.match(html, /data-training-period="afternoon"/);
  assert.match(html, /data-training-period="evening"/);
  assert.match(html, /data-training-period="none"/);
  assert.match(shared, /Fuelled but forgot to log/);
  assert.match(athlete, /saveGapBarrierResponse/);
  assert.match(cloud, /fuel_daily_contexts/);
  assert.match(cloud, /fuel_gap_barriers/);
  assert.match(coach, /Fuel-gap adherence/);
  assert.match(coach, /fuel_coach_training_activity_timing/);
  assert.match(coachHtml, /fuel-adherence-context\.js/);
  assert.doesNotMatch(`${html}\n${athlete}\n${cloud}\n${coach}\n${shared}`, /service_role|SUPABASE_SECRET_KEY|sb_secret_/i);
});

test("copy stays observational and does not turn Sleepy into a causal or medical claim", () => {
  const sources = [read("index.html"), read("fuel-beta.js"), read("coach/coach-beta.js"), read("fuel-adherence-context.js")].join("\n");
  assert.match(sources, /observed timing association, not a causal conclusion/i);
  assert.doesNotMatch(sources, /sleepy (?:was|is) caused by|proves under-fuell|hypoglycaemia/i);
});

test("database security suite covers ownership, relationship states, BOLA, revocation, and anonymous denial", () => {
  const sql = fs.readFileSync(rlsTestPath, "utf8");
  assert.match(sql, /select plan\(28\)/i);
  assert.match(sql, /Athlete A cannot write Athlete B context/i);
  assert.match(sql, /Active Coach can read Athlete A barrier/i);
  assert.match(sql, /Pending Coach cannot read Athlete A context/i);
  assert.match(sql, /Declined Coach cannot read Athlete A context/i);
  assert.match(sql, /Revoked Coach cannot read Athlete A barrier/i);
  assert.match(sql, /Knowing Athlete B UUID does not expose activity timing/i);
  assert.match(sql, /Revocation immediately removes context access/i);
  assert.match(sql, /Anonymous caller cannot read context/i);
  assert.match(sql, /Anonymous caller cannot execute timing RPC/i);
  assert.match(sql, /rollback;/i);
});

test("Coach report UI, stored metrics, CSV, and print export include adherence and data-quality evidence", () => {
  const coach = read("coach/coach-beta.js");
  assert.match(coach, /adherence: report\.adherence \|\| null/);
  assert.match(coach, /\["target_adherence", "target_exceedances"/);
  assert.match(coach, /\["data_quality", "timing_uncertain_gaps_excluded"/);
  assert.ok((coach.match(/renderAdherenceReportSection\(report\)/g) || []).length >= 2);
});
