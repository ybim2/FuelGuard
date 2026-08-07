-- Fuel Guard Coach Beta roles and explicit athlete-sharing relationships.
-- Apply after supabase/fuel_logs.sql and supabase/fuel_targets.sql.

create extension if not exists pgcrypto;

create table if not exists public.fuel_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'athlete',
  coach_enabled boolean not null default false,
  display_name text,
  athlete_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_user_profiles
  add column if not exists role text not null default 'athlete',
  add column if not exists coach_enabled boolean not null default false,
  add column if not exists display_name text,
  add column if not exists athlete_code text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.fuel_user_profiles
set coach_enabled = true,
    updated_at = now()
where role = 'coach'
  and coach_enabled is distinct from true;

alter table public.fuel_user_profiles
  drop constraint if exists fuel_user_profiles_role_check,
  drop constraint if exists fuel_user_profiles_athlete_code_format_check,
  add constraint fuel_user_profiles_role_check
    check (role in ('athlete', 'coach')),
  add constraint fuel_user_profiles_athlete_code_format_check
    check (athlete_code is null or athlete_code ~ '^FG-[A-Z0-9]{6}$');

create index if not exists fuel_user_profiles_coach_enabled_idx
  on public.fuel_user_profiles (coach_enabled, user_id)
  where coach_enabled = true;

create unique index if not exists fuel_user_profiles_athlete_code_idx
  on public.fuel_user_profiles (lower(athlete_code))
  where athlete_code is not null;

create or replace function public.fuel_random_athlete_code()
returns text
language sql
volatile
set search_path = public
as $$
  select 'FG-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
$$;

create or replace function public.fuel_user_profiles_set_athlete_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.athlete_code is null or trim(new.athlete_code) = '' then
    new.athlete_code := public.fuel_random_athlete_code();
  else
    new.athlete_code := upper(trim(new.athlete_code));
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_user_profiles_set_athlete_code_trigger on public.fuel_user_profiles;
create trigger fuel_user_profiles_set_athlete_code_trigger
  before insert or update of athlete_code on public.fuel_user_profiles
  for each row
  execute function public.fuel_user_profiles_set_athlete_code();

do $$
declare
  profile_row record;
  candidate text;
begin
  for profile_row in
    select user_id
    from public.fuel_user_profiles
    where athlete_code is null
  loop
    loop
      candidate := public.fuel_random_athlete_code();
      begin
        update public.fuel_user_profiles
        set athlete_code = candidate,
            updated_at = now()
        where user_id = profile_row.user_id;
        exit;
      exception when unique_violation then
        -- Extremely unlikely; retry with a fresh short code.
      end;
    end loop;
  end loop;
end $$;

create table if not exists public.fuel_coach_athletes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  athlete_label text,
  coach_label text,
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
  add column if not exists coach_label text,
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
    check (status in ('pending', 'active', 'declined', 'revoked')),
  add constraint fuel_coach_athletes_distinct_users_check
    check (coach_id <> athlete_id);

create unique index if not exists fuel_coach_athletes_coach_athlete_idx
  on public.fuel_coach_athletes (coach_id, athlete_id);

create index if not exists fuel_coach_athletes_coach_status_idx
  on public.fuel_coach_athletes (coach_id, status, athlete_id);

create index if not exists fuel_coach_athletes_athlete_status_idx
  on public.fuel_coach_athletes (athlete_id, status, coach_id);

create table if not exists public.fuel_coach_reports (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  report_date date not null default current_date,
  period_start date not null default current_date,
  period_end date not null default current_date,
  period_type text not null default '12_weeks',
  title text not null default 'Athlete Review Report',
  summary text not null,
  coach_notes text,
  organisation_name text,
  metrics jsonb not null default '{}'::jsonb,
  previous_metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_coach_reports
  add column if not exists coach_id uuid references auth.users(id) on delete cascade,
  add column if not exists athlete_id uuid references auth.users(id) on delete cascade,
  add column if not exists report_date date not null default current_date,
  add column if not exists period_start date not null default current_date,
  add column if not exists period_end date not null default current_date,
  add column if not exists period_type text not null default '12_weeks',
  add column if not exists title text not null default 'Athlete Review Report',
  add column if not exists summary text,
  add column if not exists coach_notes text,
  add column if not exists organisation_name text,
  add column if not exists metrics jsonb not null default '{}'::jsonb,
  add column if not exists previous_metrics jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.fuel_coach_reports
  alter column coach_id set not null,
  alter column athlete_id set not null,
  alter column report_date set not null,
  alter column period_start set not null,
  alter column period_end set not null,
  alter column period_type set not null,
  alter column period_type set default '12_weeks',
  alter column title set not null,
  alter column summary set not null,
  alter column metrics set not null,
  alter column metrics set default '{}'::jsonb,
  alter column previous_metrics set not null,
  alter column previous_metrics set default '{}'::jsonb,
  drop constraint if exists fuel_coach_reports_period_type_check,
  drop constraint if exists fuel_coach_reports_period_order_check,
  drop constraint if exists fuel_coach_reports_distinct_users_check,
  add constraint fuel_coach_reports_period_type_check
    check (period_type in ('4_weeks', '8_weeks', '12_weeks', 'season', 'custom')),
  add constraint fuel_coach_reports_period_order_check
    check (period_start <= period_end),
  add constraint fuel_coach_reports_distinct_users_check
    check (coach_id <> athlete_id);

create index if not exists fuel_coach_reports_coach_athlete_date_idx
  on public.fuel_coach_reports (coach_id, athlete_id, report_date desc, created_at desc);

create index if not exists fuel_coach_reports_period_idx
  on public.fuel_coach_reports (coach_id, athlete_id, period_start desc, period_end desc);

create index if not exists fuel_coach_reports_athlete_date_idx
  on public.fuel_coach_reports (athlete_id, report_date desc, created_at desc);

create table if not exists public.fuel_coach_interventions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  category text not null default 'fuelling_routine',
  observation text not null default '',
  action_text text not null,
  target_window text,
  intervention_date date not null default current_date,
  review_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_coach_interventions
  add column if not exists coach_id uuid references auth.users(id) on delete cascade,
  add column if not exists athlete_id uuid references auth.users(id) on delete cascade,
  add column if not exists status text not null default 'active',
  add column if not exists category text not null default 'fuelling_routine',
  add column if not exists observation text not null default '',
  add column if not exists action_text text,
  add column if not exists target_window text,
  add column if not exists intervention_date date not null default current_date,
  add column if not exists review_date date,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.fuel_coach_interventions
set status = case
  when status = 'open' then 'active'
  when status = 'completed' then 'closed'
  when status = 'dismissed' then 'closed'
  else status
end
where status in ('open', 'completed', 'dismissed');

alter table public.fuel_coach_interventions
  alter column coach_id set not null,
  alter column athlete_id set not null,
  alter column status set not null,
  alter column status set default 'active',
  alter column category set not null,
  alter column category set default 'fuelling_routine',
  alter column observation set not null,
  alter column observation set default '',
  alter column action_text set not null,
  alter column intervention_date set not null,
  alter column intervention_date set default current_date,
  drop constraint if exists fuel_coach_interventions_status_check,
  drop constraint if exists fuel_coach_interventions_distinct_users_check,
  add constraint fuel_coach_interventions_status_check
    check (status in ('active', 'reviewed', 'closed')),
  add constraint fuel_coach_interventions_distinct_users_check
    check (coach_id <> athlete_id);

create index if not exists fuel_coach_interventions_coach_athlete_status_idx
  on public.fuel_coach_interventions (coach_id, athlete_id, status, created_at desc);

create index if not exists fuel_coach_interventions_review_idx
  on public.fuel_coach_interventions (coach_id, athlete_id, review_date, status);

create index if not exists fuel_coach_interventions_athlete_status_idx
  on public.fuel_coach_interventions (athlete_id, status, created_at desc);

alter table public.fuel_targets
  add column if not exists maximum_fuel_gap_minutes integer;

alter table public.fuel_targets
  drop constraint if exists fuel_targets_maximum_fuel_gap_minutes_check,
  add constraint fuel_targets_maximum_fuel_gap_minutes_check
    check (maximum_fuel_gap_minutes is null or (maximum_fuel_gap_minutes between 120 and 240));

revoke all on table public.fuel_user_profiles from anon, authenticated;
revoke all on table public.fuel_coach_athletes from anon, authenticated;
revoke all on table public.fuel_coach_reports from anon, authenticated;
revoke all on table public.fuel_coach_interventions from anon, authenticated;

grant select, insert, update, delete on table public.fuel_user_profiles to authenticated;
grant select, insert, update, delete on table public.fuel_coach_athletes to authenticated;
grant select, insert, update, delete on table public.fuel_coach_reports to authenticated;
grant select, insert, update, delete on table public.fuel_coach_interventions to authenticated;
grant select on table public.fuel_logs to authenticated;
grant select on table public.fuel_targets to authenticated;

create or replace function public.fuel_coach_find_athlete_by_code(search_code text)
returns table (
  athlete_id uuid,
  display_name text,
  athlete_code text,
  relationship_status text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  normalized_code text;
  caller_id uuid;
begin
  caller_id := auth.uid();
  normalized_code := upper(regexp_replace(trim(coalesce(search_code, '')), '\s+', '', 'g'));

  if caller_id is null or normalized_code !~ '^FG-[A-Z0-9]{6}$' then
    return;
  end if;

  if not exists (
    select 1
    from public.fuel_user_profiles coach_profile
    where coach_profile.user_id = caller_id
      and (coach_profile.coach_enabled is true or coach_profile.role = 'coach')
  ) then
    return;
  end if;

  return query
  select
    athlete_profile.user_id,
    coalesce(nullif(athlete_profile.display_name, ''), 'Fuel Guard Athlete') as display_name,
    athlete_profile.athlete_code,
    coalesce((
      select relationship.status
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = caller_id
        and relationship.athlete_id = athlete_profile.user_id
        and relationship.status in ('pending', 'active', 'declined')
      order by relationship.updated_at desc
      limit 1
    ), 'not_connected') as relationship_status
  from public.fuel_user_profiles athlete_profile
  where lower(athlete_profile.athlete_code) = lower(normalized_code)
    and athlete_profile.user_id <> caller_id
  limit 1;
end;
$$;

revoke all on function public.fuel_coach_find_athlete_by_code(text) from public;
revoke execute on function public.fuel_coach_find_athlete_by_code(text) from anon;
grant execute on function public.fuel_coach_find_athlete_by_code(text) to authenticated;

alter table public.fuel_user_profiles enable row level security;
alter table public.fuel_coach_athletes enable row level security;
alter table public.fuel_coach_reports enable row level security;
alter table public.fuel_coach_interventions enable row level security;

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
    (select auth.uid()) = coach_id
    and status = 'pending'
    and exists (
      select 1
      from public.fuel_user_profiles coach_profile
      where coach_profile.user_id = (select auth.uid())
        and (coach_profile.coach_enabled is true or coach_profile.role = 'coach')
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
      and status in ('active', 'declined', 'revoked')
      and (status <> 'active' or accepted_at is not null)
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

drop policy if exists fuel_coach_reports_select_participant on public.fuel_coach_reports;
create policy fuel_coach_reports_select_participant
  on public.fuel_coach_reports
  for select
  to authenticated
  using (
    (select auth.uid()) = athlete_id
    or (
      (select auth.uid()) = coach_id
      and exists (
        select 1
        from public.fuel_coach_athletes relationship
        where relationship.coach_id = fuel_coach_reports.coach_id
          and relationship.athlete_id = fuel_coach_reports.athlete_id
          and relationship.status = 'active'
      )
    )
  );

drop policy if exists fuel_coach_reports_insert_assigned_coach on public.fuel_coach_reports;
create policy fuel_coach_reports_insert_assigned_coach
  on public.fuel_coach_reports
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_reports_update_assigned_coach on public.fuel_coach_reports;
create policy fuel_coach_reports_update_assigned_coach
  on public.fuel_coach_reports
  for update
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  )
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_reports_delete_assigned_coach on public.fuel_coach_reports;
create policy fuel_coach_reports_delete_assigned_coach
  on public.fuel_coach_reports
  for delete
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_interventions_select_participant on public.fuel_coach_interventions;
create policy fuel_coach_interventions_select_participant
  on public.fuel_coach_interventions
  for select
  to authenticated
  using (
    (select auth.uid()) = athlete_id
    or (
      (select auth.uid()) = coach_id
      and exists (
        select 1
        from public.fuel_coach_athletes relationship
        where relationship.coach_id = fuel_coach_interventions.coach_id
          and relationship.athlete_id = fuel_coach_interventions.athlete_id
          and relationship.status = 'active'
      )
    )
  );

drop policy if exists fuel_coach_interventions_insert_assigned_coach on public.fuel_coach_interventions;
create policy fuel_coach_interventions_insert_assigned_coach
  on public.fuel_coach_interventions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_interventions.coach_id
        and relationship.athlete_id = fuel_coach_interventions.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_interventions_update_assigned_coach on public.fuel_coach_interventions;
create policy fuel_coach_interventions_update_assigned_coach
  on public.fuel_coach_interventions
  for update
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_interventions.coach_id
        and relationship.athlete_id = fuel_coach_interventions.athlete_id
        and relationship.status = 'active'
    )
  )
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_interventions.coach_id
        and relationship.athlete_id = fuel_coach_interventions.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_interventions_delete_assigned_coach on public.fuel_coach_interventions;
create policy fuel_coach_interventions_delete_assigned_coach
  on public.fuel_coach_interventions
  for delete
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_interventions.coach_id
        and relationship.athlete_id = fuel_coach_interventions.athlete_id
        and relationship.status = 'active'
    )
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
