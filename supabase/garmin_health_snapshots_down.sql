-- Roll back supabase/garmin_health_snapshots.sql.
-- This removes only Garmin physiology/check-in tables introduced by that
-- migration. It does not alter fuel_logs or Garmin pairing/device-token data.

drop table if exists public.garmin_daily_checkins cascade;
drop table if exists public.garmin_weekly_features cascade;
drop table if exists public.garmin_daily_features cascade;
drop table if exists public.garmin_activity_summaries cascade;
drop table if exists public.garmin_profile_snapshots cascade;
drop table if exists public.garmin_body_battery_samples cascade;
drop table if exists public.garmin_stress_samples cascade;
drop table if exists public.garmin_heart_rate_samples cascade;
drop table if exists public.garmin_device_capabilities cascade;
