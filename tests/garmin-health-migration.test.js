const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const sql = fs.readFileSync(path.join(ROOT, "supabase", "garmin_health_snapshots.sql"), "utf8");
const sqlWithoutComments = sql.replace(/^--.*$/gm, "");
const activityDedupeSql = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260808130000_garmin_activity_deduplication.sql"),
  "utf8"
);

test("Garmin health migration creates separate tables with idempotency indexes", () => {
  for (const table of [
    "garmin_device_capabilities",
    "garmin_heart_rate_samples",
    "garmin_stress_samples",
    "garmin_body_battery_samples",
    "garmin_profile_snapshots",
    "garmin_activity_summaries",
    "garmin_daily_features",
    "garmin_weekly_features",
    "garmin_daily_checkins"
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(sql, /garmin_hr_user_device_observed_idx/);
  assert.match(sql, /garmin_stress_user_device_observed_idx/);
  assert.match(sql, /garmin_body_battery_user_device_observed_idx/);
  assert.match(sql, /garmin_profile_user_device_observed_idx/);
  assert.match(sql, /garmin_activity_user_source_activity_idx/);
  assert.match(sql, /garmin_activity_user_started_type_duration_idx/);
  assert.match(sql, /garmin_daily_features_user_date_source_idx/);
  assert.match(sql, /garmin_weekly_features_user_week_source_idx/);
  assert.match(sql, /fuel_events_before_training integer not null default 0/);
  assert.match(sql, /workouts_missing_pre_fuel integer not null default 0/);
  assert.match(sql, /long_gap_activity_overlap_count integer not null default 0/);
});

test("Garmin health migration keeps strict ownership and explicit authenticated grants", () => {
  assert.match(sql, /grant select on table[\s\S]*public\.garmin_daily_features[\s\S]*to authenticated;/);
  assert.match(sql, /grant select on table[\s\S]*public\.garmin_weekly_features[\s\S]*to authenticated;/);
  assert.match(sql, /grant select, insert, update, delete on table public\.garmin_daily_checkins to authenticated;/);
  assert.match(sql, /using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(sql, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(sql, /auth\.role\(\)/);
  assert.doesNotMatch(sql, /service_role/);
});

test("Garmin health migration constrains supported sources and excludes restricted metrics", () => {
  assert.match(sql, /source in \('garmin_connect_iq_local', 'garmin_health_api'\)/);
  assert.match(sql, /source = 'manual'/);
  assert.doesNotMatch(sqlWithoutComments, /sleep_stage|training_readiness|recovery_time|hrv_status|gps_route|polyline|gender|birth_year|height|weight/i);
});

test("Garmin activity migration removes existing duplicates and enforces race-safe cross-device identities", () => {
  assert.match(activityDedupeSql, /partition by user_id, source, source_activity_id/);
  assert.match(activityDedupeSql, /partition by[\s\S]*user_id,[\s\S]*source,[\s\S]*started_at,[\s\S]*lower\(btrim\(activity_type\)\),[\s\S]*duration_seconds/);
  assert.match(activityDedupeSql, /delete from public\.garmin_activity_summaries[\s\S]*duplicate_position > 1/g);
  assert.match(activityDedupeSql, /create unique index if not exists garmin_activity_user_source_identity_idx/);
  assert.match(activityDedupeSql, /create unique index if not exists garmin_activity_user_summary_identity_idx/);

  const identityIndexes = activityDedupeSql.slice(activityDedupeSql.indexOf("create unique index"));
  assert.doesNotMatch(identityIndexes, /device_id/);
});
