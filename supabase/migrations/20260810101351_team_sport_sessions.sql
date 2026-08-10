-- Fuel Guard team-sport support builds on the existing organisation/team and
-- training-session foundations. Team-wide sessions derive their audience from
-- dated team membership instead of creating one assignment row per athlete.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.fuel_training_sessions
  add column if not exists audience_scope text not null default 'assigned',
  add column if not exists status text not null default 'scheduled',
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

alter table public.fuel_training_sessions
  drop constraint if exists fuel_training_sessions_audience_scope_check,
  drop constraint if exists fuel_training_sessions_status_check,
  drop constraint if exists fuel_training_sessions_team_audience_check,
  drop constraint if exists fuel_training_sessions_cancelled_check,
  add constraint fuel_training_sessions_audience_scope_check
    check (audience_scope in ('assigned', 'team')),
  add constraint fuel_training_sessions_status_check
    check (status in ('scheduled', 'cancelled')),
  add constraint fuel_training_sessions_team_audience_check
    check (
      audience_scope <> 'team'
      or (
        saved_group_id is null
        and lower(trim(session_type)) in ('training', 'game', 'other')
      )
    ),
  add constraint fuel_training_sessions_cancelled_check
    check (
      (status = 'scheduled' and cancelled_at is null and cancelled_by is null)
      or
      (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null)
    );

create index if not exists fuel_training_sessions_team_status_start_idx
  on public.fuel_training_sessions (team_id, status, starts_at, ends_at)
  where audience_scope = 'team';
create index if not exists fuel_training_sessions_cancelled_by_idx
  on public.fuel_training_sessions (cancelled_by)
  where cancelled_by is not null;

create table public.fuel_team_athlete_membership_periods (
  id uuid primary key default gen_random_uuid(),
  team_athlete_id uuid not null references public.fuel_team_athletes(id) on delete cascade,
  organisation_id uuid not null,
  team_id uuid not null,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fuel_team_athlete_membership_periods_team_fk
    foreign key (team_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_team_athlete_membership_periods_order_check
    check (left_at is null or left_at >= joined_at)
);

create unique index fuel_team_athlete_membership_periods_active_idx
  on public.fuel_team_athlete_membership_periods (team_athlete_id)
  where left_at is null;
create index fuel_team_athlete_membership_periods_athlete_time_idx
  on public.fuel_team_athlete_membership_periods (athlete_id, joined_at, left_at, team_id);
create index fuel_team_athlete_membership_periods_team_time_idx
  on public.fuel_team_athlete_membership_periods (team_id, joined_at, left_at, athlete_id);

insert into public.fuel_team_athlete_membership_periods (
  team_athlete_id,
  organisation_id,
  team_id,
  athlete_id,
  joined_at,
  left_at
)
select
  membership.id,
  membership.organisation_id,
  membership.team_id,
  membership.athlete_id,
  coalesce(membership.joined_at, membership.created_at),
  case when membership.status = 'revoked'
    then coalesce(membership.revoked_at, membership.updated_at)
    else null
  end
from public.fuel_team_athletes membership
on conflict do nothing;

create table public.fuel_training_session_coach_notes (
  session_id uuid primary key references public.fuel_training_sessions(id) on delete cascade,
  note_text text not null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_training_session_coach_notes_text_check
    check (char_length(trim(note_text)) between 1 and 2000)
);

create index fuel_training_session_coach_notes_created_by_idx
  on public.fuel_training_session_coach_notes (created_by)
  where created_by is not null;
create index fuel_training_session_coach_notes_updated_by_idx
  on public.fuel_training_session_coach_notes (updated_by)
  where updated_by is not null;

create or replace function private.fuel_sync_team_athlete_membership_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  period_start timestamptz;
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    insert into public.fuel_team_athlete_membership_periods (
      team_athlete_id, organisation_id, team_id, athlete_id, joined_at
    ) values (
      new.id, new.organisation_id, new.team_id, new.athlete_id,
      coalesce(new.joined_at, new.created_at, now())
    );
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'revoked' then
    update public.fuel_team_athlete_membership_periods
    set left_at = greatest(coalesce(new.revoked_at, now()), joined_at)
    where team_athlete_id = new.id
      and left_at is null;
  elsif tg_op = 'UPDATE' and old.status = 'revoked' and new.status = 'active' then
    select greatest(
      coalesce(new.joined_at, now()),
      coalesce(max(period.left_at), '-infinity'::timestamptz)
    )
    into period_start
    from public.fuel_team_athlete_membership_periods period
    where period.team_athlete_id = new.id;

    insert into public.fuel_team_athlete_membership_periods (
      team_athlete_id, organisation_id, team_id, athlete_id, joined_at
    ) values (
      new.id, new.organisation_id, new.team_id, new.athlete_id,
      coalesce(period_start, now())
    );
  end if;
  return new;
end;
$$;

create or replace function private.fuel_prepare_team_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'scheduled';
    new.cancelled_at := null;
    new.cancelled_by := null;
  else
    if new.organisation_id is distinct from old.organisation_id
       or new.team_id is distinct from old.team_id
       or new.audience_scope is distinct from old.audience_scope
       or new.created_by is distinct from old.created_by
       or new.source is distinct from old.source
       or new.source_provider is distinct from old.source_provider
       or new.external_session_id is distinct from old.external_session_id then
      raise exception 'Training session identity cannot be changed' using errcode = '42501';
    end if;

    if old.status = 'cancelled' and new.status <> old.status then
      raise exception 'A cancelled session cannot be reopened' using errcode = '42501';
    end if;

    if old.status = 'scheduled' and new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := coalesce((select auth.uid()), new.cancelled_by, old.updated_by, old.created_by);
    else
      new.cancelled_at := old.cancelled_at;
      new.cancelled_by := old.cancelled_by;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.fuel_prepare_training_session_coach_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce((select auth.uid()), new.updated_by, new.created_by);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_sync_team_athlete_membership_period() from public, anon, authenticated;
revoke all on function private.fuel_prepare_team_session_change() from public, anon, authenticated;
revoke all on function private.fuel_prepare_training_session_coach_note() from public, anon, authenticated;

create trigger fuel_team_athletes_sync_membership_period
  after insert or update of status, joined_at, revoked_at
  on public.fuel_team_athletes
  for each row execute function private.fuel_sync_team_athlete_membership_period();

create trigger fuel_training_sessions_prepare_team_change
  before insert or update on public.fuel_training_sessions
  for each row execute function private.fuel_prepare_team_session_change();

create trigger fuel_training_session_coach_notes_prepare
  before insert or update on public.fuel_training_session_coach_notes
  for each row execute function private.fuel_prepare_training_session_coach_note();

alter table public.fuel_team_athlete_membership_periods enable row level security;
alter table public.fuel_training_session_coach_notes enable row level security;

revoke all on table public.fuel_team_athlete_membership_periods from public, anon, authenticated;
revoke all on table public.fuel_training_session_coach_notes from public, anon, authenticated;

grant select, insert, delete on table public.fuel_training_session_coach_notes to authenticated;
grant update (note_text) on table public.fuel_training_session_coach_notes to authenticated;
grant insert (audience_scope, status, cancelled_at, cancelled_by)
  on table public.fuel_training_sessions to authenticated;
grant update (status) on table public.fuel_training_sessions to authenticated;

create policy fuel_training_session_coach_notes_select_staff
  on public.fuel_training_session_coach_notes for select to authenticated
  using (
    exists (
      select 1
      from public.fuel_training_sessions training_session
      where training_session.id = session_id
        and (select private.fuel_has_team_access(training_session.team_id, 'viewer'))
    )
  );
create policy fuel_training_session_coach_notes_insert_staff
  on public.fuel_training_session_coach_notes for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and exists (
      select 1
      from public.fuel_training_sessions training_session
      where training_session.id = session_id
        and (select private.fuel_has_team_access(training_session.team_id, 'contributor'))
    )
  );
create policy fuel_training_session_coach_notes_update_staff
  on public.fuel_training_session_coach_notes for update to authenticated
  using (
    exists (
      select 1
      from public.fuel_training_sessions training_session
      where training_session.id = session_id
        and (select private.fuel_has_team_access(training_session.team_id, 'contributor'))
    )
  )
  with check (
    exists (
      select 1
      from public.fuel_training_sessions training_session
      where training_session.id = session_id
        and (select private.fuel_has_team_access(training_session.team_id, 'contributor'))
    )
  );
create policy fuel_training_session_coach_notes_delete_staff
  on public.fuel_training_session_coach_notes for delete to authenticated
  using (
    exists (
      select 1
      from public.fuel_training_sessions training_session
      where training_session.id = session_id
        and (select private.fuel_has_team_access(training_session.team_id, 'contributor'))
    )
  );

drop policy if exists fuel_training_sessions_delete_contributor
  on public.fuel_training_sessions;
create policy fuel_training_sessions_delete_contributor
  on public.fuel_training_sessions for delete to authenticated
  using (
    (select private.fuel_has_team_access(team_id, 'contributor'))
    and starts_at > now()
  );

create or replace function public.fuel_save_team_session(
  p_session_id uuid,
  p_team_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone_name text,
  p_session_type text,
  p_session_name text,
  p_location text,
  p_coach_note text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_session_id uuid;
  team_organisation_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'An authenticated user is required' using errcode = '42501';
  end if;
  if p_ends_at <= p_starts_at or p_ends_at > p_starts_at + interval '24 hours' then
    raise exception 'Session end must follow its start within 24 hours' using errcode = '22023';
  end if;
  if lower(trim(p_session_type)) not in ('training', 'game', 'other') then
    raise exception 'Session type must be Training, Game or Other' using errcode = '22023';
  end if;

  select team.organisation_id
  into team_organisation_id
  from public.fuel_teams team
  where team.id = p_team_id
    and (select private.fuel_has_team_access(team.id, 'contributor'));

  if team_organisation_id is null then
    raise exception 'Team contributor access is required' using errcode = '42501';
  end if;

  if p_session_id is null then
    insert into public.fuel_training_sessions (
      organisation_id,
      team_id,
      audience_scope,
      status,
      session_date,
      starts_at,
      ends_at,
      timezone_name,
      session_type,
      session_name,
      location,
      created_by,
      updated_by
    ) values (
      team_organisation_id,
      p_team_id,
      'team',
      'scheduled',
      timezone(p_timezone_name, p_starts_at)::date,
      p_starts_at,
      p_ends_at,
      trim(p_timezone_name),
      lower(trim(p_session_type)),
      nullif(trim(p_session_name), ''),
      nullif(trim(p_location), ''),
      (select auth.uid()),
      (select auth.uid())
    )
    returning id into saved_session_id;
  else
    update public.fuel_training_sessions training_session
    set session_date = timezone(p_timezone_name, p_starts_at)::date,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        timezone_name = trim(p_timezone_name),
        session_type = lower(trim(p_session_type)),
        session_name = nullif(trim(p_session_name), ''),
        location = nullif(trim(p_location), '')
    where training_session.id = p_session_id
      and training_session.team_id = p_team_id
      and training_session.audience_scope = 'team'
      and training_session.status = 'scheduled'
    returning training_session.id into saved_session_id;

    if saved_session_id is null then
      raise exception 'Scheduled team session is unavailable' using errcode = '42501';
    end if;
  end if;

  if nullif(trim(p_coach_note), '') is null then
    delete from public.fuel_training_session_coach_notes note
    where note.session_id = saved_session_id;
  else
    insert into public.fuel_training_session_coach_notes (session_id, note_text)
    values (saved_session_id, trim(p_coach_note))
    on conflict (session_id) do update
      set note_text = excluded.note_text;
  end if;

  return saved_session_id;
end;
$$;

create or replace function public.fuel_cancel_team_session(p_session_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  changed integer;
begin
  update public.fuel_training_sessions training_session
  set status = 'cancelled'
  where training_session.id = p_session_id
    and training_session.audience_scope = 'team'
    and training_session.status = 'scheduled';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create or replace function public.fuel_athlete_team_sessions(
  p_from timestamptz default now() - interval '14 days',
  p_to timestamptz default now() + interval '14 days'
)
returns table (
  session_id uuid,
  organisation_id uuid,
  team_id uuid,
  team_name text,
  session_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone_name text,
  session_type text,
  session_name text,
  location text,
  status text
)
language sql
security definer
stable
set search_path = ''
as $$
  select distinct
    training_session.id,
    training_session.organisation_id,
    training_session.team_id,
    team.name,
    training_session.session_date,
    training_session.starts_at,
    training_session.ends_at,
    training_session.timezone_name,
    training_session.session_type,
    training_session.session_name,
    training_session.location,
    training_session.status
  from public.fuel_training_sessions training_session
  join public.fuel_teams team
    on team.id = training_session.team_id
   and team.organisation_id = training_session.organisation_id
  join public.fuel_team_athlete_membership_periods period
    on period.team_id = training_session.team_id
   and period.organisation_id = training_session.organisation_id
   and period.athlete_id = (select auth.uid())
   and period.joined_at <= training_session.ends_at
   and (period.left_at is null or period.left_at >= training_session.starts_at)
  where (select auth.uid()) is not null
    and training_session.audience_scope = 'team'
    and training_session.starts_at >= p_from
    and training_session.starts_at < p_to
  order by training_session.starts_at, training_session.id;
$$;

create or replace function public.fuel_team_session_context(
  p_from timestamptz default now() - interval '14 days',
  p_to timestamptz default now() + interval '14 days'
)
returns table (
  session_id uuid,
  organisation_id uuid,
  team_id uuid,
  athlete_id uuid,
  athlete_name text,
  session_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone_name text,
  session_type text,
  session_name text,
  session_status text,
  last_fuel_at timestamptz,
  maximum_fuel_gap_minutes integer,
  gap_minutes_at_start integer,
  pre_session_status text,
  first_post_fuel_at timestamptz,
  post_fuel_gap_minutes integer,
  post_session_status text
)
language sql
security definer
stable
set search_path = ''
as $$
  with roster as (
    select distinct
      training_session.id as session_id,
      period.athlete_id
    from public.fuel_training_sessions training_session
    join public.fuel_team_athlete_membership_periods period
      on period.team_id = training_session.team_id
     and period.organisation_id = training_session.organisation_id
     and period.joined_at <= training_session.ends_at
     and (period.left_at is null or period.left_at >= training_session.starts_at)
    where training_session.audience_scope = 'team'
    union
    select assignment.session_id, assignment.athlete_id
    from public.fuel_training_session_athletes assignment
  )
  select
    training_session.id,
    training_session.organisation_id,
    training_session.team_id,
    roster.athlete_id,
    coalesce(nullif(trim(profile.display_name), ''), 'Fuel Guard Athlete'),
    training_session.session_date,
    training_session.starts_at,
    training_session.ends_at,
    training_session.timezone_name,
    training_session.session_type,
    training_session.session_name,
    training_session.status,
    last_fuel.logged_at,
    target.maximum_fuel_gap_minutes,
    pre_gap.minutes,
    case
      when last_fuel.logged_at is null or target.maximum_fuel_gap_minutes is null then 'no_logging'
      when pre_gap.minutes >= target.maximum_fuel_gap_minutes then 'red'
      when pre_gap.minutes >= greatest(0, target.maximum_fuel_gap_minutes - 30) then 'yellow'
      else 'green'
    end,
    post_fuel.logged_at,
    post_gap.minutes,
    case
      when training_session.ends_at > now() then 'pending'
      when post_fuel.logged_at is null then 'no_fuel'
      when post_gap.minutes <= 60 then 'prompt'
      when post_gap.minutes <= 240 then 'late'
      else 'no_fuel'
    end
  from public.fuel_training_sessions training_session
  join roster on roster.session_id = training_session.id
  left join public.fuel_user_profiles profile
    on profile.user_id = roster.athlete_id
  left join public.fuel_targets target
    on target.user_id = roster.athlete_id
  left join lateral (
    select fuel_log.logged_at
    from public.fuel_logs fuel_log
    where fuel_log.user_id = roster.athlete_id
      and fuel_log.type in ('fuel', 'fuel_hydration')
      and fuel_log.logged_at <= training_session.starts_at
    order by fuel_log.logged_at desc
    limit 1
  ) last_fuel on true
  left join lateral (
    select case when last_fuel.logged_at is null then null
      else floor(extract(epoch from (training_session.starts_at - last_fuel.logged_at)) / 60)::integer
    end as minutes
  ) pre_gap on true
  left join lateral (
    select fuel_log.logged_at
    from public.fuel_logs fuel_log
    where fuel_log.user_id = roster.athlete_id
      and fuel_log.type in ('fuel', 'fuel_hydration')
      and fuel_log.logged_at > training_session.ends_at
    order by fuel_log.logged_at
    limit 1
  ) post_fuel on true
  left join lateral (
    select case when post_fuel.logged_at is null then null
      else floor(extract(epoch from (post_fuel.logged_at - training_session.ends_at)) / 60)::integer
    end as minutes
  ) post_gap on true
  where (select auth.uid()) is not null
    and training_session.starts_at >= p_from
    and training_session.starts_at < p_to
    and training_session.status <> 'cancelled'
    and (select private.fuel_can_access_team_athlete(
      training_session.team_id,
      roster.athlete_id,
      'viewer'
    ))
  order by training_session.starts_at, training_session.id, roster.athlete_id;
$$;

revoke all on function public.fuel_athlete_team_sessions(timestamptz, timestamptz) from public, anon;
revoke all on function public.fuel_team_session_context(timestamptz, timestamptz) from public, anon;
revoke all on function public.fuel_save_team_session(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text) from public, anon;
revoke all on function public.fuel_cancel_team_session(uuid) from public, anon;
grant execute on function public.fuel_athlete_team_sessions(timestamptz, timestamptz) to authenticated;
grant execute on function public.fuel_team_session_context(timestamptz, timestamptz) to authenticated;
grant execute on function public.fuel_save_team_session(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text) to authenticated;
grant execute on function public.fuel_cancel_team_session(uuid) to authenticated;

comment on column public.fuel_training_sessions.audience_scope is
  'assigned preserves legacy/saved-group assignments; team derives the audience from dated team membership without per-session athlete rows.';
comment on table public.fuel_team_athlete_membership_periods is
  'Internal append-only team tenure history. It keeps historical session context stable when an athlete leaves or later rejoins.';
comment on table public.fuel_training_session_coach_notes is
  'Internal session notes visible only to authorised team staff; never returned by the athlete schedule API.';
comment on function public.fuel_athlete_team_sessions(timestamptz, timestamptz) is
  'Returns the authenticated athlete own shared team-session context without exposing coach notes or another athlete identity.';
comment on function public.fuel_team_session_context(timestamptz, timestamptz) is
  'Returns pre/post timing classifications only for athletes protected by active team scope and direct Coach-Athlete sharing.';
comment on function public.fuel_save_team_session(uuid, uuid, timestamptz, timestamptz, text, text, text, text, text) is
  'Atomically creates or edits a shared team session and its private coach note under contributor RLS.';
