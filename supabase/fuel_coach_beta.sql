-- Fuel Guard Coach Beta roles and explicit athlete-sharing relationships.
-- Apply after supabase/fuel_logs.sql and supabase/fuel_targets.sql.

create extension if not exists pgcrypto;

create table if not exists public.fuel_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'athlete',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_user_profiles
  add column if not exists role text not null default 'athlete',
  add column if not exists display_name text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.fuel_user_profiles
  drop constraint if exists fuel_user_profiles_role_check,
  add constraint fuel_user_profiles_role_check
    check (role in ('athlete', 'coach'));

create table if not exists public.fuel_coach_athletes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  athlete_label text,
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_coach_athletes
  add column if not exists coach_id uuid references auth.users(id) on delete cascade,
  add column if not exists athlete_id uuid references auth.users(id) on delete cascade,
  add column if not exists status text not null default 'pending',
  add column if not exists athlete_label text,
  add column if not exists invited_at timestamptz not null default now(),
  add column if not exists accepted_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.fuel_coach_athletes
  alter column coach_id set not null,
  alter column athlete_id set not null,
  alter column status set not null,
  alter column invited_at set default now(),
  alter column created_at set default now(),
  alter column updated_at set default now(),
  drop constraint if exists fuel_coach_athletes_status_check,
  drop constraint if exists fuel_coach_athletes_distinct_users_check,
  add constraint fuel_coach_athletes_status_check
    check (status in ('pending', 'active', 'revoked')),
  add constraint fuel_coach_athletes_distinct_users_check
    check (coach_id <> athlete_id);

create unique index if not exists fuel_coach_athletes_coach_athlete_idx
  on public.fuel_coach_athletes (coach_id, athlete_id);

create index if not exists fuel_coach_athletes_coach_status_idx
  on public.fuel_coach_athletes (coach_id, status, athlete_id);

create index if not exists fuel_coach_athletes_athlete_status_idx
  on public.fuel_coach_athletes (athlete_id, status, coach_id);

alter table public.fuel_targets
  add column if not exists maximum_fuel_gap_minutes integer;

alter table public.fuel_targets
  drop constraint if exists fuel_targets_maximum_fuel_gap_minutes_check,
  add constraint fuel_targets_maximum_fuel_gap_minutes_check
    check (maximum_fuel_gap_minutes is null or (maximum_fuel_gap_minutes between 120 and 240));

revoke all on table public.fuel_user_profiles from anon, authenticated;
revoke all on table public.fuel_coach_athletes from anon, authenticated;

grant select, insert, update, delete on table public.fuel_user_profiles to authenticated;
grant select, insert, update, delete on table public.fuel_coach_athletes to authenticated;
grant select on table public.fuel_logs to authenticated;
grant select on table public.fuel_targets to authenticated;

alter table public.fuel_user_profiles enable row level security;
alter table public.fuel_coach_athletes enable row level security;

drop policy if exists fuel_user_profiles_select_own_or_assigned_coach on public.fuel_user_profiles;
create policy fuel_user_profiles_select_own_or_assigned_coach
  on public.fuel_user_profiles
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = fuel_user_profiles.user_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_user_profiles_insert_own on public.fuel_user_profiles;
create policy fuel_user_profiles_insert_own
  on public.fuel_user_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_user_profiles_update_own on public.fuel_user_profiles;
create policy fuel_user_profiles_update_own
  on public.fuel_user_profiles
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_user_profiles_delete_own on public.fuel_user_profiles;
create policy fuel_user_profiles_delete_own
  on public.fuel_user_profiles
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists fuel_coach_athletes_select_participant on public.fuel_coach_athletes;
create policy fuel_coach_athletes_select_participant
  on public.fuel_coach_athletes
  for select
  to authenticated
  using (
    (select auth.uid()) = coach_id
    or (select auth.uid()) = athlete_id
  );

drop policy if exists fuel_coach_athletes_insert_by_participant on public.fuel_coach_athletes;
create policy fuel_coach_athletes_insert_by_participant
  on public.fuel_coach_athletes
  for insert
  to authenticated
  with check (
    (
      (select auth.uid()) = coach_id
      and status = 'pending'
    )
    or (
      (select auth.uid()) = athlete_id
      and status = 'active'
      and accepted_at is not null
    )
  );

drop policy if exists fuel_coach_athletes_update_by_participant on public.fuel_coach_athletes;
create policy fuel_coach_athletes_update_by_participant
  on public.fuel_coach_athletes
  for update
  to authenticated
  using (
    (select auth.uid()) = coach_id
    or (select auth.uid()) = athlete_id
  )
  with check (
    (
      (select auth.uid()) = coach_id
      and coach_id = (select auth.uid())
      and status in ('pending', 'revoked')
    )
    or (
      (select auth.uid()) = athlete_id
      and athlete_id = (select auth.uid())
      and status in ('active', 'revoked')
    )
  );

drop policy if exists fuel_coach_athletes_delete_by_participant on public.fuel_coach_athletes;
create policy fuel_coach_athletes_delete_by_participant
  on public.fuel_coach_athletes
  for delete
  to authenticated
  using (
    (select auth.uid()) = coach_id
    or (select auth.uid()) = athlete_id
  );

drop policy if exists "fuel_logs_select_own" on public.fuel_logs;
drop policy if exists fuel_logs_select_own_or_assigned_coach on public.fuel_logs;
create policy fuel_logs_select_own_or_assigned_coach
  on public.fuel_logs
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = fuel_logs.user_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_targets_select_own on public.fuel_targets;
drop policy if exists fuel_targets_select_own_or_assigned_coach on public.fuel_targets;
create policy fuel_targets_select_own_or_assigned_coach
  on public.fuel_targets
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = fuel_targets.user_id
        and relationship.status = 'active'
    )
  );
