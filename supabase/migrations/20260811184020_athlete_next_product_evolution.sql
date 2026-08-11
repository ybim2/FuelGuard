-- Fuel Guard Athlete next product evolution.
-- Adds a safe public username, owner-only Fuel Kit history, an immutable
-- Everyday Reflection baseline/check-in record, and cumulative Training/Work
-- milestone acknowledgement categories. Analytics remains derived from the
-- existing canonical Fuel and Training Mode records.

alter table public.fuel_user_profiles
  add column if not exists username text;

alter table public.fuel_user_profiles
  drop constraint if exists fuel_user_profiles_username_check,
  add constraint fuel_user_profiles_username_check
    check (username is null or username ~ '^[a-z0-9][a-z0-9_-]{2,29}$');

create unique index if not exists fuel_user_profiles_username_unique_idx
  on public.fuel_user_profiles (lower(username))
  where username is not null;

alter table public.fuel_milestone_achievements
  drop constraint if exists fuel_milestone_achievements_category_check,
  add constraint fuel_milestone_achievements_category_check
    check (category in ('streak', 'fuel', 'hydration', 'training', 'work'));

create table public.fuel_kit_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checked_on date not null,
  fuel_options integer not null default 0,
  reserve_ready boolean not null default false,
  hydration_ready boolean not null default false,
  electrolytes_ready boolean not null default false,
  training_today boolean not null default false,
  training_fuel_ready boolean not null default false,
  prepared boolean generated always as (
    fuel_options > 0
    and reserve_ready
    and hydration_ready
    and (not training_today or training_fuel_ready)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_kit_checks_fuel_options_check check (fuel_options between 0 and 20),
  constraint fuel_kit_checks_user_day_unique unique (user_id, checked_on)
);

create index fuel_kit_checks_user_checked_idx
  on public.fuel_kit_checks (user_id, checked_on desc);

create table public.fuel_everyday_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_type text not null,
  observed_on date not null,
  meal_prep_organisation smallint,
  healthy_snacking_ability smallint,
  work_mood_before smallint,
  work_mood_during smallint,
  work_mood_after smallint,
  work_energy_before smallint,
  work_energy_during smallint,
  work_energy_after smallint,
  training_energy_before smallint,
  training_energy_during smallint,
  training_energy_after smallint,
  work_applicable boolean not null default true,
  training_applicable boolean not null default true,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_everyday_reflections_entry_type_check check (entry_type in ('baseline', 'checkin')),
  constraint fuel_everyday_reflections_ratings_check check (
    (meal_prep_organisation is null or meal_prep_organisation between 1 and 5)
    and (healthy_snacking_ability is null or healthy_snacking_ability between 1 and 5)
    and (work_mood_before is null or work_mood_before between 1 and 5)
    and (work_mood_during is null or work_mood_during between 1 and 5)
    and (work_mood_after is null or work_mood_after between 1 and 5)
    and (work_energy_before is null or work_energy_before between 1 and 5)
    and (work_energy_during is null or work_energy_during between 1 and 5)
    and (work_energy_after is null or work_energy_after between 1 and 5)
    and (training_energy_before is null or training_energy_before between 1 and 5)
    and (training_energy_during is null or training_energy_during between 1 and 5)
    and (training_energy_after is null or training_energy_after between 1 and 5)
  ),
  constraint fuel_everyday_reflections_completion_check check (
    completed_at is null or (
      meal_prep_organisation is not null
      and healthy_snacking_ability is not null
      and (
        not work_applicable or (
          work_mood_before is not null and work_mood_during is not null and work_mood_after is not null
          and work_energy_before is not null and work_energy_during is not null and work_energy_after is not null
        )
      )
      and (
        not training_applicable or (
          training_energy_before is not null and training_energy_during is not null and training_energy_after is not null
        )
      )
    )
  ),
  constraint fuel_everyday_reflections_user_type_day_unique unique (user_id, entry_type, observed_on)
);

create unique index fuel_everyday_reflections_one_baseline_idx
  on public.fuel_everyday_reflections (user_id)
  where entry_type = 'baseline';

create index fuel_everyday_reflections_user_observed_idx
  on public.fuel_everyday_reflections (user_id, observed_on desc);

create or replace function private.fuel_everyday_reflection_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.user_id is distinct from new.user_id
     or old.entry_type is distinct from new.entry_type
     or old.observed_on is distinct from new.observed_on then
    raise exception 'Everyday Reflection identity fields are immutable.' using errcode = '23514';
  end if;
  if old.completed_at is not null and new is distinct from old then
    raise exception 'Completed Everyday Reflection records are immutable.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_everyday_reflection_guard() from public, anon, authenticated;

create trigger fuel_kit_checks_touch_updated_at
  before update on public.fuel_kit_checks
  for each row execute function private.fuel_touch_updated_at();

create trigger fuel_everyday_reflections_guard
  before update on public.fuel_everyday_reflections
  for each row execute function private.fuel_everyday_reflection_guard();

alter table public.fuel_kit_checks enable row level security;
alter table public.fuel_everyday_reflections enable row level security;

revoke all on table public.fuel_kit_checks from public, anon, authenticated;
revoke all on table public.fuel_everyday_reflections from public, anon, authenticated;

grant select, insert, update on table public.fuel_kit_checks to authenticated;
grant select, insert, update on table public.fuel_everyday_reflections to authenticated;

create policy fuel_kit_checks_select_own
  on public.fuel_kit_checks for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_kit_checks_insert_own
  on public.fuel_kit_checks for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fuel_kit_checks_update_own
  on public.fuel_kit_checks for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_everyday_reflections_select_own
  on public.fuel_everyday_reflections for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_everyday_reflections_insert_own
  on public.fuel_everyday_reflections for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fuel_everyday_reflections_update_own
  on public.fuel_everyday_reflections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on column public.fuel_user_profiles.username is
  'Optional Athlete-facing identity. Never inferred from or replaced by an email address.';
comment on table public.fuel_kit_checks is
  'Owner-only daily preparation checks. Prepared is derived from practical readiness fields.';
comment on table public.fuel_everyday_reflections is
  'Owner-only universal Everyday baseline and later check-ins. Completed records are immutable.';
