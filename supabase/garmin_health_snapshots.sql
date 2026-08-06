-- Fuel Guard Garmin physiology/training patterns.
-- Apply after supabase/garmin_zero_secret_auth.sql and supabase/fuel_logs.sql.
-- This migration stores only opt-in Connect IQ-local signals. It does not use
-- Garmin Health API cloud data, sleep stages, HRV Status, Training Readiness,
-- Recovery Time, GPS routes, gender, birth year, height, or weight.
-- Tables reserve garmin_health_api as a future source value, but no Garmin
-- Health API ingestion route or production control is introduced here.

create extension if not exists pgcrypto;

create table if not exists public.garmin_device_capabilities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid references public.garmin_device_tokens(id) on delete set null,
  device_id text not null,
  source text not null default 'garmin_connect_iq_local',
  collected_at timestamptz not null,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garmin_device_capabilities_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api'))
);

create unique index if not exists garmin_device_capabilities_user_device_source_idx
  on public.garmin_device_capabilities (user_id, device_id, source);
create index if not exists garmin_device_capabilities_user_collected_idx
  on public.garmin_device_capabilities (user_id, collected_at desc);

create table if not exists public.garmin_heart_rate_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid references public.garmin_device_tokens(id) on delete set null,
  device_id text not null,
  source text not null default 'garmin_connect_iq_local',
  observed_at timestamptz not null,
  value_bpm integer not null,
  snapshot_external_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint garmin_hr_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_hr_value_check check (value_bpm between 25 and 240)
);

create unique index if not exists garmin_hr_user_device_observed_idx
  on public.garmin_heart_rate_samples (user_id, source, device_id, observed_at);
create index if not exists garmin_hr_user_observed_idx
  on public.garmin_heart_rate_samples (user_id, observed_at desc);

create table if not exists public.garmin_stress_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid references public.garmin_device_tokens(id) on delete set null,
  device_id text not null,
  source text not null default 'garmin_connect_iq_local',
  observed_at timestamptz not null,
  value integer,
  sample_status text not null default 'valid',
  snapshot_external_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint garmin_stress_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_stress_value_check check (value is null or value between 0 and 100),
  constraint garmin_stress_status_check check (sample_status in ('valid', 'rest', 'invalid', 'unavailable'))
);

create unique index if not exists garmin_stress_user_device_observed_idx
  on public.garmin_stress_samples (user_id, source, device_id, observed_at);
create index if not exists garmin_stress_user_observed_idx
  on public.garmin_stress_samples (user_id, observed_at desc);

create table if not exists public.garmin_body_battery_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid references public.garmin_device_tokens(id) on delete set null,
  device_id text not null,
  source text not null default 'garmin_connect_iq_local',
  observed_at timestamptz not null,
  value integer not null,
  snapshot_external_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint garmin_body_battery_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_body_battery_value_check check (value between 0 and 100)
);

create unique index if not exists garmin_body_battery_user_device_observed_idx
  on public.garmin_body_battery_samples (user_id, source, device_id, observed_at);
create index if not exists garmin_body_battery_user_observed_idx
  on public.garmin_body_battery_samples (user_id, observed_at desc);

create table if not exists public.garmin_profile_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid references public.garmin_device_tokens(id) on delete set null,
  device_id text not null,
  source text not null default 'garmin_connect_iq_local',
  observed_at timestamptz not null,
  resting_heart_rate integer,
  average_resting_heart_rate integer,
  snapshot_external_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint garmin_profile_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_profile_resting_hr_check check (resting_heart_rate is null or resting_heart_rate between 25 and 240),
  constraint garmin_profile_average_resting_hr_check check (average_resting_heart_rate is null or average_resting_heart_rate between 25 and 240)
);

create unique index if not exists garmin_profile_user_device_observed_idx
  on public.garmin_profile_snapshots (user_id, source, device_id, observed_at);
create index if not exists garmin_profile_user_observed_idx
  on public.garmin_profile_snapshots (user_id, observed_at desc);

create table if not exists public.garmin_activity_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_token_id uuid references public.garmin_device_tokens(id) on delete set null,
  device_id text not null,
  source text not null default 'garmin_connect_iq_local',
  source_activity_id text,
  activity_type text not null,
  started_at timestamptz not null,
  duration_seconds integer not null,
  distance_metres integer,
  calories integer,
  snapshot_external_id text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint garmin_activity_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_activity_duration_check check (duration_seconds between 1 and 86400),
  constraint garmin_activity_distance_check check (distance_metres is null or distance_metres between 0 and 1000000),
  constraint garmin_activity_calories_check check (calories is null or calories between 0 and 20000)
);

create unique index if not exists garmin_activity_user_source_activity_idx
  on public.garmin_activity_summaries (user_id, source, device_id, source_activity_id)
  where source_activity_id is not null;
create unique index if not exists garmin_activity_user_device_started_type_idx
  on public.garmin_activity_summaries (user_id, source, device_id, started_at, activity_type)
  where source_activity_id is null;
create index if not exists garmin_activity_user_started_idx
  on public.garmin_activity_summaries (user_id, started_at desc);

create table if not exists public.garmin_daily_features (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  source text not null default 'garmin_connect_iq_local',
  timezone text not null default 'UTC',
  fuel_event_count integer not null default 0,
  first_fuel_at timestamptz,
  final_fuel_at timestamptz,
  longest_fuel_gap_minutes integer not null default 0,
  average_fuel_gap_minutes integer,
  fuel_debt_minutes integer not null default 0,
  excessive_fuel_gap_count integer not null default 0,
  fuel_events_before_training integer not null default 0,
  fuel_events_after_training integer not null default 0,
  workouts_missing_pre_fuel integer not null default 0,
  workouts_missing_post_fuel integer not null default 0,
  long_gap_activity_overlap_count integer not null default 0,
  heart_rate_sample_count integer not null default 0,
  stress_sample_count integer not null default 0,
  body_battery_sample_count integer not null default 0,
  morning_median_heart_rate numeric,
  afternoon_median_stress numeric,
  evening_median_stress numeric,
  morning_body_battery numeric,
  evening_body_battery numeric,
  body_battery_daytime_change numeric,
  activity_count integer not null default 0,
  activity_duration_minutes integer not null default 0,
  data_quality_status text not null default 'limited',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garmin_daily_features_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_daily_features_quality_check check (data_quality_status in ('limited', 'partial', 'good'))
);

create unique index if not exists garmin_daily_features_user_date_source_idx
  on public.garmin_daily_features (user_id, local_date, source);
create index if not exists garmin_daily_features_user_date_idx
  on public.garmin_daily_features (user_id, local_date desc);

create table if not exists public.garmin_weekly_features (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start_date date not null,
  source text not null default 'garmin_connect_iq_local',
  timezone text not null default 'UTC',
  total_fuel_events integer not null default 0,
  average_daily_fuel_events numeric,
  median_longest_gap_minutes numeric,
  days_exceeding_preferred_gap integer not null default 0,
  workout_count integer not null default 0,
  training_minutes integer not null default 0,
  active_days integer not null default 0,
  workouts_missing_pre_fuel integer not null default 0,
  workouts_missing_post_fuel integer not null default 0,
  long_gap_activity_overlap_count integer not null default 0,
  average_afternoon_stress numeric,
  average_body_battery_daytime_change numeric,
  data_quality_status text not null default 'limited',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garmin_weekly_features_source_check check (source in ('garmin_connect_iq_local', 'garmin_health_api')),
  constraint garmin_weekly_features_quality_check check (data_quality_status in ('limited', 'partial', 'good'))
);

create unique index if not exists garmin_weekly_features_user_week_source_idx
  on public.garmin_weekly_features (user_id, week_start_date, source);
create index if not exists garmin_weekly_features_user_week_idx
  on public.garmin_weekly_features (user_id, week_start_date desc);

create table if not exists public.garmin_daily_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  checked_in_at timestamptz not null default now(),
  source text not null default 'manual',
  energy integer not null,
  mood integer not null,
  soreness integer not null,
  hunger_appetite integer not null,
  perceived_recovery integer not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garmin_daily_checkins_source_check check (source = 'manual'),
  constraint garmin_daily_checkins_energy_check check (energy between 1 and 5),
  constraint garmin_daily_checkins_mood_check check (mood between 1 and 5),
  constraint garmin_daily_checkins_soreness_check check (soreness between 1 and 5),
  constraint garmin_daily_checkins_hunger_check check (hunger_appetite between 1 and 5),
  constraint garmin_daily_checkins_recovery_check check (perceived_recovery between 1 and 5)
);

create unique index if not exists garmin_daily_checkins_user_date_idx
  on public.garmin_daily_checkins (user_id, local_date);

alter table public.garmin_device_capabilities enable row level security;
alter table public.garmin_heart_rate_samples enable row level security;
alter table public.garmin_stress_samples enable row level security;
alter table public.garmin_body_battery_samples enable row level security;
alter table public.garmin_profile_snapshots enable row level security;
alter table public.garmin_activity_summaries enable row level security;
alter table public.garmin_daily_features enable row level security;
alter table public.garmin_weekly_features enable row level security;
alter table public.garmin_daily_checkins enable row level security;

grant select on table
  public.garmin_device_capabilities,
  public.garmin_heart_rate_samples,
  public.garmin_stress_samples,
  public.garmin_body_battery_samples,
  public.garmin_profile_snapshots,
  public.garmin_activity_summaries,
  public.garmin_daily_features,
  public.garmin_weekly_features
to authenticated;

grant select, insert, update, delete on table public.garmin_daily_checkins to authenticated;

create policy "Users can read their Garmin device capabilities"
  on public.garmin_device_capabilities
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin heart-rate samples"
  on public.garmin_heart_rate_samples
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin stress samples"
  on public.garmin_stress_samples
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin Body Battery samples"
  on public.garmin_body_battery_samples
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin profile snapshots"
  on public.garmin_profile_snapshots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin activity summaries"
  on public.garmin_activity_summaries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin daily features"
  on public.garmin_daily_features
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin weekly features"
  on public.garmin_weekly_features
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Garmin daily check-ins"
  on public.garmin_daily_checkins
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their Garmin daily check-ins"
  on public.garmin_daily_checkins
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their Garmin daily check-ins"
  on public.garmin_daily_checkins
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their Garmin daily check-ins"
  on public.garmin_daily_checkins
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.garmin_heart_rate_samples is
  'Opt-in Connect IQ-local heart-rate history samples sent by Fuel Guard Quick Log. Not Garmin Health API cloud data.';
comment on table public.garmin_stress_samples is
  'Opt-in Connect IQ-local stress history samples, preserving null/rest/invalid statuses where supplied by Connect IQ.';
comment on table public.garmin_body_battery_samples is
  'Opt-in Connect IQ-local Body Battery history samples.';
comment on table public.garmin_daily_features is
  'Server-derived daily features used by Fuel Guard Analysis so pages do not recompute patterns from raw samples on every render.';
comment on table public.garmin_weekly_features is
  'Server-derived weekly Garmin/fuelling features used for pattern analysis without recomputing from raw samples on every page render.';
