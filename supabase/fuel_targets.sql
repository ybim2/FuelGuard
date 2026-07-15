-- Fuel Guard per-user target preferences for optional log-count goals.
-- Run this in the same Supabase project as supabase/fuel_logs.sql.

create table if not exists public.fuel_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_fuel_logs integer,
  daily_hydration_logs integer,
  weekly_fuel_logs integer,
  weekly_hydration_logs integer,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.fuel_targets
  add column if not exists daily_fuel_logs integer,
  add column if not exists daily_hydration_logs integer,
  add column if not exists weekly_fuel_logs integer,
  add column if not exists weekly_hydration_logs integer,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_at timestamptz not null default now();

alter table public.fuel_targets
  drop constraint if exists fuel_targets_daily_fuel_logs_check,
  drop constraint if exists fuel_targets_daily_hydration_logs_check,
  drop constraint if exists fuel_targets_weekly_fuel_logs_check,
  drop constraint if exists fuel_targets_weekly_hydration_logs_check;

alter table public.fuel_targets
  add constraint fuel_targets_daily_fuel_logs_check check (daily_fuel_logs is null or daily_fuel_logs >= 1),
  add constraint fuel_targets_daily_hydration_logs_check check (daily_hydration_logs is null or daily_hydration_logs >= 1),
  add constraint fuel_targets_weekly_fuel_logs_check check (weekly_fuel_logs is null or weekly_fuel_logs >= 1),
  add constraint fuel_targets_weekly_hydration_logs_check check (weekly_hydration_logs is null or weekly_hydration_logs >= 1);

create index if not exists fuel_targets_updated_at_idx on public.fuel_targets (updated_at desc);

revoke all on table public.fuel_targets from anon, authenticated;
grant select, insert, update, delete on table public.fuel_targets to authenticated;

alter table public.fuel_targets enable row level security;

drop policy if exists fuel_targets_select_own on public.fuel_targets;
create policy fuel_targets_select_own
  on public.fuel_targets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists fuel_targets_insert_own on public.fuel_targets;
create policy fuel_targets_insert_own
  on public.fuel_targets
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_targets_update_own on public.fuel_targets;
create policy fuel_targets_update_own
  on public.fuel_targets
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_targets_delete_own on public.fuel_targets;
create policy fuel_targets_delete_own
  on public.fuel_targets
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
