-- Fuel Guard daily coach workflow: operational attention state, notes, nudges,
-- intervention follow-up, and a credential-safe team data-health abstraction.
-- Apply after supabase/fuel_coach_beta.sql and supabase/garmin_zero_secret_auth.sql.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.fuel_coach_attention_actions (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null,
  occurrence_key text not null,
  status text not null,
  acted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_coach_attention_actions_status_check
    check (status in ('reviewed', 'dismissed')),
  constraint fuel_coach_attention_actions_item_type_check
    check (item_type in (
      'gap_exceeded',
      'gap_approaching',
      'repeated_sleepy',
      'no_logs_today',
      'prolonged_absence',
      'insufficient_data',
      'garmin_reconnect',
      'intervention_review_due'
    )),
  constraint fuel_coach_attention_actions_occurrence_key_check
    check (length(trim(occurrence_key)) between 1 and 240),
  constraint fuel_coach_attention_actions_distinct_users_check
    check (coach_id <> athlete_id),
  unique (coach_id, athlete_id, occurrence_key)
);

create index if not exists fuel_coach_attention_actions_coach_status_idx
  on public.fuel_coach_attention_actions (coach_id, status, acted_at desc);

create index if not exists fuel_coach_attention_actions_athlete_idx
  on public.fuel_coach_attention_actions (athlete_id, acted_at desc);

create table if not exists public.fuel_coach_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  attention_occurrence_key text,
  body text not null,
  created_at timestamptz not null default now(),
  constraint fuel_coach_notes_body_check
    check (length(trim(body)) between 1 and 2000),
  constraint fuel_coach_notes_occurrence_key_check
    check (attention_occurrence_key is null or length(trim(attention_occurrence_key)) between 1 and 240),
  constraint fuel_coach_notes_distinct_users_check
    check (coach_id <> athlete_id)
);

create index if not exists fuel_coach_notes_coach_athlete_created_idx
  on public.fuel_coach_notes (coach_id, athlete_id, created_at desc);

create table if not exists public.fuel_coach_nudges (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  attention_occurrence_key text,
  message text not null default 'Quick Fuel Guard check-in — remember to log when you next fuel.',
  sent_at timestamptz not null default now(),
  constraint fuel_coach_nudges_message_check
    check (length(trim(message)) between 1 and 280),
  constraint fuel_coach_nudges_occurrence_key_check
    check (attention_occurrence_key is null or length(trim(attention_occurrence_key)) between 1 and 240),
  constraint fuel_coach_nudges_distinct_users_check
    check (coach_id <> athlete_id)
);

create index if not exists fuel_coach_nudges_athlete_sent_idx
  on public.fuel_coach_nudges (athlete_id, sent_at desc);

create index if not exists fuel_coach_nudges_coach_sent_idx
  on public.fuel_coach_nudges (coach_id, sent_at desc);

alter table public.fuel_coach_interventions
  add column if not exists review_window_days integer not null default 28,
  add column if not exists source_attention_occurrence_key text,
  add column if not exists review_notes text,
  add column if not exists review_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_at timestamptz,
  add column if not exists closed_at timestamptz;

update public.fuel_coach_interventions
set review_date = intervention_date + review_window_days
where review_date is null;

alter table public.fuel_coach_interventions
  alter column review_date drop default,
  alter column review_date set not null,
  drop constraint if exists fuel_coach_interventions_status_check,
  drop constraint if exists fuel_coach_interventions_review_window_days_check,
  drop constraint if exists fuel_coach_interventions_review_date_check,
  add constraint fuel_coach_interventions_status_check
    check (status in ('active', 'review_due', 'reviewed', 'closed')),
  add constraint fuel_coach_interventions_review_window_days_check
    check (review_window_days between 7 and 84),
  add constraint fuel_coach_interventions_review_date_check
    check (review_date >= intervention_date),
  add constraint fuel_coach_interventions_source_attention_key_check
    check (source_attention_occurrence_key is null or length(trim(source_attention_occurrence_key)) between 1 and 240);

create or replace function private.fuel_coach_intervention_defaults()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.review_window_days := coalesce(new.review_window_days, 28);
  new.review_date := coalesce(new.review_date, new.intervention_date + new.review_window_days);
  if new.status = 'reviewed' and new.reviewed_at is null then
    new.reviewed_at := now();
  end if;
  if new.status = 'closed' and new.closed_at is null then
    new.closed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_coach_intervention_defaults() from public, anon, authenticated;

drop trigger if exists fuel_coach_intervention_defaults_trigger on public.fuel_coach_interventions;
create trigger fuel_coach_intervention_defaults_trigger
  before insert or update on public.fuel_coach_interventions
  for each row
  execute function private.fuel_coach_intervention_defaults();

revoke all on table public.fuel_coach_attention_actions from anon, authenticated;
revoke all on table public.fuel_coach_notes from anon, authenticated;
revoke all on table public.fuel_coach_nudges from anon, authenticated;

grant select, insert, update on table public.fuel_coach_attention_actions to authenticated;
grant select, insert on table public.fuel_coach_notes to authenticated;
grant select, insert on table public.fuel_coach_nudges to authenticated;

alter table public.fuel_coach_attention_actions enable row level security;
alter table public.fuel_coach_notes enable row level security;
alter table public.fuel_coach_nudges enable row level security;

drop policy if exists fuel_coach_attention_actions_select_active_coach on public.fuel_coach_attention_actions;
create policy fuel_coach_attention_actions_select_active_coach
  on public.fuel_coach_attention_actions
  for select
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_attention_actions.coach_id
        and relationship.athlete_id = fuel_coach_attention_actions.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_attention_actions_insert_active_coach on public.fuel_coach_attention_actions;
create policy fuel_coach_attention_actions_insert_active_coach
  on public.fuel_coach_attention_actions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_attention_actions.coach_id
        and relationship.athlete_id = fuel_coach_attention_actions.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_attention_actions_update_active_coach on public.fuel_coach_attention_actions;
create policy fuel_coach_attention_actions_update_active_coach
  on public.fuel_coach_attention_actions
  for update
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_attention_actions.coach_id
        and relationship.athlete_id = fuel_coach_attention_actions.athlete_id
        and relationship.status = 'active'
    )
  )
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_attention_actions.coach_id
        and relationship.athlete_id = fuel_coach_attention_actions.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_notes_select_active_coach on public.fuel_coach_notes;
create policy fuel_coach_notes_select_active_coach
  on public.fuel_coach_notes
  for select
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_notes.coach_id
        and relationship.athlete_id = fuel_coach_notes.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_notes_insert_active_coach on public.fuel_coach_notes;
create policy fuel_coach_notes_insert_active_coach
  on public.fuel_coach_notes
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_notes.coach_id
        and relationship.athlete_id = fuel_coach_notes.athlete_id
        and relationship.status = 'active'
    )
  );

drop policy if exists fuel_coach_nudges_select_participant on public.fuel_coach_nudges;
create policy fuel_coach_nudges_select_participant
  on public.fuel_coach_nudges
  for select
  to authenticated
  using (
    (select auth.uid()) = athlete_id
    or (
      (select auth.uid()) = coach_id
      and exists (
        select 1
        from public.fuel_coach_athletes relationship
        where relationship.coach_id = fuel_coach_nudges.coach_id
          and relationship.athlete_id = fuel_coach_nudges.athlete_id
          and relationship.status = 'active'
      )
    )
  );

drop policy if exists fuel_coach_nudges_insert_active_coach on public.fuel_coach_nudges;
create policy fuel_coach_nudges_insert_active_coach
  on public.fuel_coach_nudges
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_nudges.coach_id
        and relationship.athlete_id = fuel_coach_nudges.athlete_id
        and relationship.status = 'active'
    )
  );

create or replace function public.fuel_coach_refresh_due_interventions()
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  updated_count integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.fuel_coach_interventions intervention
  set status = 'review_due',
      updated_at = now()
  where intervention.coach_id = auth.uid()
    and intervention.status = 'active'
    and intervention.review_date <= current_date
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = intervention.coach_id
        and relationship.athlete_id = intervention.athlete_id
        and relationship.status = 'active'
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.fuel_coach_refresh_due_interventions() from public, anon;
grant execute on function public.fuel_coach_refresh_due_interventions() to authenticated;

create or replace function private.fuel_coach_data_health_for_caller()
returns table (
  athlete_id uuid,
  last_log_at timestamptz,
  last_garmin_log_at timestamptz,
  garmin_connection_status text,
  garmin_connected_at timestamptz,
  garmin_last_used_at timestamptz,
  garmin_revoked_at timestamptz
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  caller_id uuid := auth.uid();
begin
  if caller_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.fuel_user_profiles profile
    where profile.user_id = caller_id
      and (profile.coach_enabled is true or profile.role = 'coach')
  ) then
    return;
  end if;

  return query
  select
    relationship.athlete_id,
    log_health.last_log_at,
    log_health.last_garmin_log_at,
    case
      when device_health.active_device_count > 0 then 'connected'
      when device_health.latest_revoked_at is not null then 'connection_revoked'
      else 'not_connected'
    end as garmin_connection_status,
    device_health.earliest_active_created_at as garmin_connected_at,
    device_health.latest_active_used_at as garmin_last_used_at,
    device_health.latest_revoked_at as garmin_revoked_at
  from public.fuel_coach_athletes relationship
  left join lateral (
    select
      max(logged_at) as last_log_at,
      max(logged_at) filter (where source = 'garmin') as last_garmin_log_at
    from public.fuel_logs
    where user_id = relationship.athlete_id
  ) log_health on true
  left join lateral (
    select
      count(*) filter (where revoked_at is null)::integer as active_device_count,
      min(created_at) filter (where revoked_at is null) as earliest_active_created_at,
      max(last_used_at) filter (where revoked_at is null) as latest_active_used_at,
      max(revoked_at) as latest_revoked_at
    from public.garmin_device_tokens
    where user_id = relationship.athlete_id
  ) device_health on true
  where relationship.coach_id = caller_id
    and relationship.status = 'active';
end;
$$;

revoke all on function private.fuel_coach_data_health_for_caller() from public, anon;
grant execute on function private.fuel_coach_data_health_for_caller() to authenticated;

create or replace function public.fuel_coach_data_health()
returns table (
  athlete_id uuid,
  last_log_at timestamptz,
  last_garmin_log_at timestamptz,
  garmin_connection_status text,
  garmin_connected_at timestamptz,
  garmin_last_used_at timestamptz,
  garmin_revoked_at timestamptz
)
language sql
security invoker
stable
set search_path = pg_catalog, public, private
as $$
  select * from private.fuel_coach_data_health_for_caller();
$$;

revoke all on function public.fuel_coach_data_health() from public, anon;
grant execute on function public.fuel_coach_data_health() to authenticated;

comment on table public.fuel_coach_attention_actions is
  'Persistent Reviewed/Dismissed state for deterministic coach attention occurrences.';
comment on table public.fuel_coach_notes is
  'Private coach notes tied to an athlete and optionally an attention occurrence.';
comment on table public.fuel_coach_nudges is
  'Auditable lightweight coach-to-athlete Fuel Guard check-ins; not a general messaging channel.';
comment on function public.fuel_coach_data_health() is
  'Returns safe logging and Garmin connection status timestamps for the caller active coach relationships. Never returns credentials.';
