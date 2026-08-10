-- Fuel Guard points, weekly coach reviews, and additive multi-role profiles.
--
-- Existing profile, Coach and Performance access remains authoritative. This
-- migration adds identity metadata and role labels without replacing any
-- organisation capability, staff scope, athlete-sharing, or RLS boundary.

alter table public.fuel_user_profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists avatar_url text,
  add column if not exists job_title text;

alter table public.fuel_user_profiles
  drop constraint if exists fuel_user_profiles_first_name_length_check,
  drop constraint if exists fuel_user_profiles_last_name_length_check,
  drop constraint if exists fuel_user_profiles_avatar_url_length_check,
  drop constraint if exists fuel_user_profiles_job_title_length_check,
  add constraint fuel_user_profiles_first_name_length_check
    check (first_name is null or char_length(first_name) between 1 and 80),
  add constraint fuel_user_profiles_last_name_length_check
    check (last_name is null or char_length(last_name) between 1 and 80),
  add constraint fuel_user_profiles_avatar_url_length_check
    check (avatar_url is null or char_length(avatar_url) <= 500),
  add constraint fuel_user_profiles_job_title_length_check
    check (job_title is null or char_length(job_title) between 1 and 120);

create table public.fuel_user_role_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  source text not null default 'profile',
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint fuel_user_role_memberships_role_check
    check (role in ('athlete', 'coach', 'performance')),
  constraint fuel_user_role_memberships_source_check
    check (source in ('profile', 'coach_access', 'organisation'))
);

create unique index fuel_user_role_memberships_active_unique_idx
  on public.fuel_user_role_memberships (user_id, role)
  where revoked_at is null;
create index fuel_user_role_memberships_user_idx
  on public.fuel_user_role_memberships (user_id, created_at);

insert into public.fuel_user_role_memberships (user_id, role, source)
select profile.user_id, 'athlete', 'profile'
from public.fuel_user_profiles profile
on conflict (user_id, role) where revoked_at is null do nothing;

insert into public.fuel_user_role_memberships (user_id, role, source)
select profile.user_id, 'coach', 'coach_access'
from public.fuel_user_profiles profile
where profile.coach_enabled is true or profile.role = 'coach'
on conflict (user_id, role) where revoked_at is null do nothing;

insert into public.fuel_user_role_memberships (user_id, role, source)
select distinct member.user_id, 'performance', 'organisation'
from public.fuel_organisation_members member
where member.status = 'active'
on conflict (user_id, role) where revoked_at is null do nothing;

create or replace function private.fuel_sync_profile_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.fuel_user_role_memberships (user_id, role, source)
  values (new.user_id, 'athlete', 'profile')
  on conflict (user_id, role) where revoked_at is null do nothing;

  if new.coach_enabled is true or new.role = 'coach' then
    insert into public.fuel_user_role_memberships (user_id, role, source)
    values (new.user_id, 'coach', 'coach_access')
    on conflict (user_id, role) where revoked_at is null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_sync_profile_roles() from public, anon, authenticated;
drop trigger if exists fuel_user_profiles_sync_roles_trigger on public.fuel_user_profiles;
create trigger fuel_user_profiles_sync_roles_trigger
  after insert or update of role, coach_enabled on public.fuel_user_profiles
  for each row execute function private.fuel_sync_profile_roles();

create or replace function private.fuel_sync_organisation_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    insert into public.fuel_user_role_memberships (user_id, role, source, granted_by)
    values (new.user_id, 'performance', 'organisation', new.invited_by)
    on conflict (user_id, role) where revoked_at is null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_sync_organisation_role() from public, anon, authenticated;
drop trigger if exists fuel_organisation_members_sync_role_trigger on public.fuel_organisation_members;
create trigger fuel_organisation_members_sync_role_trigger
  after insert or update of status on public.fuel_organisation_members
  for each row execute function private.fuel_sync_organisation_role();

create table public.fuel_point_milestone_definitions (
  event_type text primary key,
  role_context text not null,
  threshold integer,
  points integer not null,
  title text not null,
  description text not null,
  sort_order integer not null,
  constraint fuel_point_milestone_definitions_role_check
    check (role_context in ('athlete', 'coach')),
  constraint fuel_point_milestone_definitions_threshold_check
    check (threshold is null or threshold > 0),
  constraint fuel_point_milestone_definitions_points_check
    check (points > 0)
);

insert into public.fuel_point_milestone_definitions
  (event_type, role_context, threshold, points, title, description, sort_order)
values
  ('athlete_streak_3', 'athlete', 3, 25, '3-day streak', 'Record Fuel or Hydration on three consecutive days.', 10),
  ('athlete_streak_7', 'athlete', 7, 50, '7-day streak', 'Record Fuel or Hydration on seven consecutive days.', 20),
  ('athlete_streak_30', 'athlete', 30, 150, '30-day streak', 'Record Fuel or Hydration on thirty consecutive days.', 30),
  ('athlete_fuel_25', 'athlete', 25, 25, '25 fuel moments', 'Record twenty-five Fuel moments.', 40),
  ('athlete_fuel_100', 'athlete', 100, 75, '100 fuel moments', 'Record one hundred Fuel moments.', 50),
  ('athlete_fuel_250', 'athlete', 250, 150, '250 fuel moments', 'Record two hundred and fifty Fuel moments.', 60),
  ('coach_first_review', 'coach', 1, 25, 'First weekly review', 'Complete a first athlete weekly review.', 110),
  ('coach_review_streak_4', 'coach', 4, 50, '4-week review streak', 'Complete weekly reviews in four consecutive weeks.', 120),
  ('coach_reviews_10', 'coach', 10, 50, '10 weekly reviews', 'Complete ten athlete weekly reviews.', 130),
  ('coach_reviews_25', 'coach', 25, 100, '25 weekly reviews', 'Complete twenty-five athlete weekly reviews.', 140),
  ('coach_review_streak_12', 'coach', 12, 200, '12-week review streak', 'Complete weekly reviews in twelve consecutive weeks.', 150),
  ('coach_all_assigned_week', 'coach', null, 25, 'Weekly roster complete', 'Complete a weekly review for every currently assigned athlete.', 160)
on conflict (event_type) do update set
  role_context = excluded.role_context,
  threshold = excluded.threshold,
  points = excluded.points,
  title = excluded.title,
  description = excluded.description,
  sort_order = excluded.sort_order;

create table public.fuel_points_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role_context text not null,
  event_type text not null references public.fuel_point_milestone_definitions(event_type),
  event_id text not null,
  points integer not null,
  reason text not null,
  source_table text,
  source_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fuel_points_ledger_role_check check (role_context in ('athlete', 'coach')),
  constraint fuel_points_ledger_points_check check (points > 0),
  constraint fuel_points_ledger_event_id_check check (char_length(event_id) between 3 and 180),
  constraint fuel_points_ledger_user_event_unique unique (user_id, role_context, event_id)
);

create index fuel_points_ledger_user_created_idx
  on public.fuel_points_ledger (user_id, created_at desc);

alter table public.fuel_user_role_memberships enable row level security;
alter table public.fuel_point_milestone_definitions enable row level security;
alter table public.fuel_points_ledger enable row level security;

revoke all on table public.fuel_user_role_memberships from public, anon, authenticated;
revoke all on table public.fuel_point_milestone_definitions from public, anon, authenticated;
revoke all on table public.fuel_points_ledger from public, anon, authenticated;
grant select on table public.fuel_user_role_memberships to authenticated;
grant select on table public.fuel_point_milestone_definitions to authenticated;
grant select on table public.fuel_points_ledger to authenticated;

create policy fuel_user_role_memberships_select_own
  on public.fuel_user_role_memberships for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_point_milestone_definitions_select_authenticated
  on public.fuel_point_milestone_definitions for select to authenticated
  using (true);
create policy fuel_points_ledger_select_own
  on public.fuel_points_ledger for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.fuel_sync_athlete_points(p_time_zone text default 'UTC')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  resolved_zone text := coalesce(nullif(trim(p_time_zone), ''), 'UTC');
  today_key date;
  cursor_key date;
  current_streak integer := 0;
  fuel_count integer := 0;
  definition record;
  current_value integer;
  awarded integer := 0;
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = resolved_zone) then
    resolved_zone := 'UTC';
  end if;

  today_key := (now() at time zone resolved_zone)::date;

  select count(*)::integer into fuel_count
  from public.fuel_logs log
  where log.user_id = caller_id
    and log.type in ('fuel', 'fuel_hydration')
    and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid');

  cursor_key := today_key;
  if not exists (
    select 1 from public.fuel_logs log
    where log.user_id = caller_id
      and log.type in ('fuel', 'hydration', 'fuel_hydration')
      and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')
      and (log.logged_at at time zone resolved_zone)::date = cursor_key
  ) then
    cursor_key := today_key - 1;
  end if;

  while exists (
    select 1 from public.fuel_logs log
    where log.user_id = caller_id
      and log.type in ('fuel', 'hydration', 'fuel_hydration')
      and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')
      and (log.logged_at at time zone resolved_zone)::date = cursor_key
  ) loop
    current_streak := current_streak + 1;
    cursor_key := cursor_key - 1;
  end loop;

  for definition in
    select * from public.fuel_point_milestone_definitions
    where role_context = 'athlete'
    order by sort_order
  loop
    current_value := case
      when definition.event_type like 'athlete_streak_%' then current_streak
      when definition.event_type like 'athlete_fuel_%' then fuel_count
      else 0
    end;
    if current_value >= definition.threshold then
      insert into public.fuel_points_ledger (
        user_id, role_context, event_type, event_id, points, reason, source_table, occurred_at
      ) values (
        caller_id, 'athlete', definition.event_type,
        'athlete:' || definition.event_type,
        definition.points, definition.title, 'fuel_logs', now()
      ) on conflict (user_id, role_context, event_id) do nothing;
      if found then awarded := awarded + 1; end if;
    end if;
  end loop;
  return awarded;
end;
$$;

revoke all on function public.fuel_sync_athlete_points(text) from public, anon;
grant execute on function public.fuel_sync_athlete_points(text) to authenticated;

alter table public.fuel_coach_reports
  add column if not exists review_kind text not null default 'standard',
  add column if not exists status text not null default 'draft',
  add column if not exists week_start date,
  add column if not exists week_end date,
  add column if not exists completed_at timestamptz,
  add column if not exists completion_note text,
  add column if not exists organisation_id uuid references public.fuel_organisations(id) on delete set null,
  add column if not exists version integer not null default 1;

alter table public.fuel_coach_reports
  drop constraint if exists fuel_coach_reports_period_type_check,
  drop constraint if exists fuel_coach_reports_review_kind_check,
  drop constraint if exists fuel_coach_reports_status_check,
  drop constraint if exists fuel_coach_reports_week_check,
  drop constraint if exists fuel_coach_reports_completion_check,
  add constraint fuel_coach_reports_period_type_check
    check (period_type in ('week', '4_weeks', '8_weeks', '12_weeks', 'season', 'custom')),
  add constraint fuel_coach_reports_review_kind_check
    check (review_kind in ('standard', 'weekly')),
  add constraint fuel_coach_reports_status_check
    check (status in ('draft', 'completed')),
  add constraint fuel_coach_reports_week_check check (
    (review_kind = 'standard' and week_start is null and week_end is null)
    or
    (review_kind = 'weekly' and week_start is not null and week_end = week_start + 6
      and extract(isodow from week_start) = 1)
  ),
  add constraint fuel_coach_reports_completion_check check (
    (status = 'draft' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  );

create unique index fuel_coach_reports_weekly_identity_idx
  on public.fuel_coach_reports (coach_id, athlete_id, week_start)
  where review_kind = 'weekly';
create index fuel_coach_reports_weekly_history_idx
  on public.fuel_coach_reports (coach_id, status, week_start desc)
  where review_kind = 'weekly';

drop policy if exists fuel_coach_reports_select_participant on public.fuel_coach_reports;
create policy fuel_coach_reports_select_participant
  on public.fuel_coach_reports for select to authenticated
  using (
    ((select auth.uid()) = athlete_id and (review_kind <> 'weekly' or status = 'completed'))
    or (
      (select auth.uid()) = coach_id
      and exists (
        select 1 from public.fuel_coach_athletes relationship
        where relationship.coach_id = fuel_coach_reports.coach_id
          and relationship.athlete_id = fuel_coach_reports.athlete_id
          and relationship.status = 'active'
      )
    )
  );

drop policy if exists fuel_coach_reports_insert_assigned_coach on public.fuel_coach_reports;
create policy fuel_coach_reports_insert_assigned_coach
  on public.fuel_coach_reports for insert to authenticated
  with check (
    review_kind = 'standard'
    and status = 'draft'
    and (select auth.uid()) = coach_id
    and exists (
      select 1 from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_reports_update_assigned_coach on public.fuel_coach_reports;
create policy fuel_coach_reports_update_assigned_coach
  on public.fuel_coach_reports for update to authenticated
  using (
    review_kind = 'standard' and status = 'draft'
    and (select auth.uid()) = coach_id
    and exists (
      select 1 from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  )
  with check (
    review_kind = 'standard' and status = 'draft'
    and (select auth.uid()) = coach_id
  );

drop policy if exists fuel_coach_reports_delete_assigned_coach on public.fuel_coach_reports;
create policy fuel_coach_reports_delete_assigned_coach
  on public.fuel_coach_reports for delete to authenticated
  using (
    review_kind = 'standard' and status = 'draft'
    and (select auth.uid()) = coach_id
  );

create or replace function public.fuel_save_weekly_review(
  p_athlete_id uuid,
  p_week_start date,
  p_summary text,
  p_coach_note text default null,
  p_metrics jsonb default '{}'::jsonb,
  p_organisation_id uuid default null
)
returns public.fuel_coach_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  saved public.fuel_coach_reports;
begin
  if caller_id is null
     or p_athlete_id is null
     or p_week_start is null
     or extract(isodow from p_week_start) <> 1
     or nullif(trim(p_summary), '') is null then
    raise exception 'A valid athlete, Monday week start and evidence summary are required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.fuel_coach_athletes relationship
    where relationship.coach_id = caller_id
      and relationship.athlete_id = p_athlete_id
      and relationship.status = 'active'
  ) then
    raise exception 'Coach access denied.' using errcode = '42501';
  end if;
  if p_organisation_id is not null and not exists (
    select 1 from public.fuel_organisation_members member
    where member.organisation_id = p_organisation_id
      and member.user_id = caller_id and member.status = 'active'
  ) then
    raise exception 'Organisation access denied.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.fuel_coach_reports report
    where report.coach_id = caller_id and report.athlete_id = p_athlete_id
      and report.review_kind = 'weekly' and report.week_start = p_week_start
      and report.status = 'completed'
  ) then
    raise exception 'This weekly review is already completed.' using errcode = '23505';
  end if;

  insert into public.fuel_coach_reports (
    coach_id, athlete_id, report_date, period_start, period_end, period_type,
    title, summary, coach_notes, metrics, previous_metrics, review_kind,
    status, week_start, week_end, organisation_id, version, updated_at
  ) values (
    caller_id, p_athlete_id, current_date, p_week_start, p_week_start + 6, 'week',
    'Weekly Coach Review', trim(p_summary), nullif(trim(p_coach_note), ''),
    coalesce(p_metrics, '{}'::jsonb), '{}'::jsonb, 'weekly', 'draft',
    p_week_start, p_week_start + 6, p_organisation_id, 1, now()
  )
  on conflict (coach_id, athlete_id, week_start) where review_kind = 'weekly'
  do update set
    summary = excluded.summary,
    coach_notes = excluded.coach_notes,
    metrics = excluded.metrics,
    organisation_id = excluded.organisation_id,
    updated_at = now()
  where fuel_coach_reports.status = 'draft'
  returning * into saved;

  if saved.id is null then
    raise exception 'This weekly review is no longer editable.' using errcode = '55000';
  end if;
  return saved;
end;
$$;

revoke all on function public.fuel_save_weekly_review(uuid, date, text, text, jsonb, uuid) from public, anon;
grant execute on function public.fuel_save_weekly_review(uuid, date, text, text, jsonb, uuid) to authenticated;

create or replace function public.fuel_points_profile(p_time_zone text default 'UTC')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  result jsonb;
  fuel_count integer;
  current_streak integer;
  today_key date;
  cursor_key date;
  resolved_zone text := coalesce(nullif(trim(p_time_zone), ''), 'UTC');
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = resolved_zone) then
    resolved_zone := 'UTC';
  end if;
  perform public.fuel_sync_athlete_points(resolved_zone);

  select count(*)::integer into fuel_count from public.fuel_logs log
  where log.user_id = caller_id and log.type in ('fuel', 'fuel_hydration')
    and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid');
  today_key := (now() at time zone resolved_zone)::date;
  cursor_key := today_key;
  if not exists (
    select 1 from public.fuel_logs log where log.user_id = caller_id
      and log.type in ('fuel', 'hydration', 'fuel_hydration')
      and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')
      and (log.logged_at at time zone resolved_zone)::date = cursor_key
  ) then cursor_key := today_key - 1; end if;
  current_streak := 0;
  while exists (
    select 1 from public.fuel_logs log where log.user_id = caller_id
      and log.type in ('fuel', 'hydration', 'fuel_hydration')
      and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')
      and (log.logged_at at time zone resolved_zone)::date = cursor_key
  ) loop
    current_streak := current_streak + 1;
    cursor_key := cursor_key - 1;
  end loop;

  select jsonb_build_object(
    'totalPoints', coalesce((select sum(ledger.points) from public.fuel_points_ledger ledger where ledger.user_id = caller_id), 0),
    'athletePoints', coalesce((select sum(ledger.points) from public.fuel_points_ledger ledger where ledger.user_id = caller_id and ledger.role_context = 'athlete'), 0),
    'coachPoints', coalesce((select sum(ledger.points) from public.fuel_points_ledger ledger where ledger.user_id = caller_id and ledger.role_context = 'coach'), 0),
    'currentStreak', current_streak,
    'fuelMoments', fuel_count,
    'roles', coalesce((select jsonb_agg(role.role order by role.role) from public.fuel_user_role_memberships role where role.user_id = caller_id and role.revoked_at is null), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', definition.event_type,
        'roleContext', definition.role_context,
        'threshold', definition.threshold,
        'points', definition.points,
        'title', definition.title,
        'description', definition.description,
        'currentValue', case
          when definition.event_type like 'athlete_streak_%' then current_streak
          when definition.event_type like 'athlete_fuel_%' then fuel_count
          else null
        end,
        'earnedAt', ledger.occurred_at
      ) order by definition.sort_order)
      from public.fuel_point_milestone_definitions definition
      left join public.fuel_points_ledger ledger
        on ledger.user_id = caller_id and ledger.event_type = definition.event_type
      where definition.role_context = 'athlete'
    ), '[]'::jsonb),
    'recentAwards', coalesce((
      select jsonb_agg(recent.item order by recent.created_at desc)
      from (
        select ledger.created_at, jsonb_build_object(
          'id', ledger.id, 'roleContext', ledger.role_context,
          'eventType', ledger.event_type, 'points', ledger.points,
          'reason', ledger.reason, 'occurredAt', ledger.occurred_at
        ) as item
        from public.fuel_points_ledger ledger
        where ledger.user_id = caller_id order by ledger.created_at desc limit 12
      ) recent
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.fuel_points_profile(text) from public, anon;
grant execute on function public.fuel_points_profile(text) to authenticated;

create or replace function public.fuel_complete_weekly_review(
  p_report_id uuid,
  p_completion_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  report public.fuel_coach_reports;
  definition record;
  review_count integer;
  review_streak integer := 0;
  cursor_week date;
  assigned_count integer;
  completed_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into report from public.fuel_coach_reports existing
  where existing.id = p_report_id and existing.coach_id = caller_id
    and existing.review_kind = 'weekly'
  for update;
  if report.id is null then
    raise exception 'Weekly review not found.' using errcode = '42501';
  end if;
  if report.status = 'completed' then
    return jsonb_build_object('reportId', report.id, 'status', report.status, 'points', public.fuel_points_profile('UTC'));
  end if;
  if not exists (
    select 1 from public.fuel_coach_athletes relationship
    where relationship.coach_id = caller_id and relationship.athlete_id = report.athlete_id
      and relationship.status = 'active'
  ) then
    raise exception 'Coach access denied.' using errcode = '42501';
  end if;

  update public.fuel_coach_reports
  set status = 'completed', completed_at = now(),
      completion_note = nullif(trim(p_completion_note), ''), updated_at = now()
  where id = report.id
  returning * into report;

  select count(*)::integer into review_count from public.fuel_coach_reports completed
  where completed.coach_id = caller_id and completed.review_kind = 'weekly'
    and completed.status = 'completed';

  for definition in
    select * from public.fuel_point_milestone_definitions
    where event_type in ('coach_first_review', 'coach_reviews_10', 'coach_reviews_25')
      and threshold <= review_count
  loop
    insert into public.fuel_points_ledger (
      user_id, role_context, event_type, event_id, points, reason,
      source_table, source_id, occurred_at
    ) values (
      caller_id, 'coach', definition.event_type, 'coach:' || definition.event_type,
      definition.points, definition.title, 'fuel_coach_reports', report.id, report.completed_at
    ) on conflict (user_id, role_context, event_id) do nothing;
  end loop;

  cursor_week := report.week_start;
  while exists (
    select 1 from public.fuel_coach_reports completed
    where completed.coach_id = caller_id and completed.review_kind = 'weekly'
      and completed.status = 'completed' and completed.week_start = cursor_week
  ) loop
    review_streak := review_streak + 1;
    cursor_week := cursor_week - 7;
  end loop;

  for definition in
    select * from public.fuel_point_milestone_definitions
    where event_type in ('coach_review_streak_4', 'coach_review_streak_12')
      and threshold <= review_streak
  loop
    insert into public.fuel_points_ledger (
      user_id, role_context, event_type, event_id, points, reason,
      source_table, source_id, occurred_at
    ) values (
      caller_id, 'coach', definition.event_type, 'coach:' || definition.event_type,
      definition.points, definition.title, 'fuel_coach_reports', report.id, report.completed_at
    ) on conflict (user_id, role_context, event_id) do nothing;
  end loop;

  select count(*)::integer into assigned_count
  from public.fuel_coach_athletes relationship
  where relationship.coach_id = caller_id and relationship.status = 'active';
  select count(distinct completed.athlete_id)::integer into completed_count
  from public.fuel_coach_reports completed
  where completed.coach_id = caller_id and completed.review_kind = 'weekly'
    and completed.status = 'completed' and completed.week_start = report.week_start;

  if assigned_count > 0 and completed_count >= assigned_count then
    select * into definition from public.fuel_point_milestone_definitions
    where event_type = 'coach_all_assigned_week';
    insert into public.fuel_points_ledger (
      user_id, role_context, event_type, event_id, points, reason,
      source_table, source_id, occurred_at
    ) values (
      caller_id, 'coach', definition.event_type,
      'coach:all_assigned:' || report.week_start::text,
      definition.points, definition.title || ' · ' || report.week_start::text,
      'fuel_coach_reports', report.id, report.completed_at
    ) on conflict (user_id, role_context, event_id) do nothing;
  end if;

  return jsonb_build_object(
    'reportId', report.id,
    'status', report.status,
    'reviewCount', review_count,
    'reviewStreak', review_streak,
    'points', public.fuel_points_profile('UTC')
  );
end;
$$;

revoke all on function public.fuel_complete_weekly_review(uuid, text) from public, anon;
grant execute on function public.fuel_complete_weekly_review(uuid, text) to authenticated;

create or replace function public.fuel_performance_people_hierarchy(p_organisation_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  base jsonb;
  enriched jsonb;
  can_manage boolean;
begin
  base := public.fuel_performance_staff_access(p_organisation_id);
  can_manage := private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access');

  select coalesce(jsonb_agg(
    person || jsonb_build_object(
      'jobTitle', profile.job_title,
      'roles', coalesce(roles.items, '[]'::jsonb),
      'assignedAthletes', coalesce(athletes.items, '[]'::jsonb),
      'coachPoints', coalesce(points.total, 0),
      'completedWeeklyReviews', coalesce(review_stats.review_count, 0),
      'currentReviewStreak', coalesce(review_stats.streak_count, 0)
    ) order by coalesce(person->>'displayName', person->>'userId')
  ), '[]'::jsonb) into enriched
  from jsonb_array_elements(coalesce(base->'staff', '[]'::jsonb)) person
  left join public.fuel_user_profiles profile on profile.user_id = (person->>'userId')::uuid
  left join lateral (
    select jsonb_agg(role.role order by role.role) as items
    from public.fuel_user_role_memberships role
    where role.user_id = (person->>'userId')::uuid and role.revoked_at is null
  ) roles on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'athleteId', assigned.athlete_id,
      'displayName', coalesce(athlete_profile.display_name, 'Fuel Guard Athlete')
    ) order by coalesce(athlete_profile.display_name, assigned.athlete_id::text)) as items
    from (
      select relationship.athlete_id
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (person->>'userId')::uuid
        and relationship.status = 'active'
      union
      select scope.athlete_id
      from public.fuel_staff_scopes scope
      where scope.organisation_id = p_organisation_id
        and scope.user_id = (person->>'userId')::uuid
        and scope.scope_type = 'athlete' and scope.status = 'active'
    ) assigned
    left join public.fuel_user_profiles athlete_profile on athlete_profile.user_id = assigned.athlete_id
    where can_manage or private.fuel_performance_can_access_athlete(
      p_organisation_id, assigned.athlete_id, null, false
    )
  ) athletes on true
  left join lateral (
    select sum(ledger.points)::integer as total
    from public.fuel_points_ledger ledger
    where ledger.user_id = (person->>'userId')::uuid and ledger.role_context = 'coach'
  ) points on true
  left join lateral (
    with review_weeks as (
      select distinct report.week_start
      from public.fuel_coach_reports report
      where report.coach_id = (person->>'userId')::uuid
        and report.review_kind = 'weekly' and report.status = 'completed'
    ), ranked as (
      select week_start, row_number() over (order by week_start desc) as position
      from review_weeks
    )
    select
      (select count(*)::integer from public.fuel_coach_reports report
       where report.coach_id = (person->>'userId')::uuid
         and report.review_kind = 'weekly' and report.status = 'completed') as review_count,
      coalesce((select count(*)::integer from ranked
        where week_start = (select max(week_start) from ranked) - ((position - 1)::integer * 7)), 0) as streak_count
  ) review_stats on true;

  return jsonb_build_object(
    'status', case when jsonb_array_length(enriched) = 0 then 'empty' else 'ready' end,
    'canManage', coalesce((base->>'canManage')::boolean, false),
    'staff', enriched
  );
end;
$$;

revoke all on function public.fuel_performance_people_hierarchy(uuid) from public, anon;
grant execute on function public.fuel_performance_people_hierarchy(uuid) to authenticated;

comment on table public.fuel_points_ledger is
  'Append-only, server-awarded Fuel Guard points. Totals are derived by summing immutable award events.';
comment on table public.fuel_user_role_memberships is
  'Additive role labels for users who may be athletes, coaches and organisation Performance staff at the same time.';
comment on function public.fuel_complete_weekly_review(uuid, text) is
  'Atomically completes one authorised weekly coach review and idempotently awards eligible coach points.';
