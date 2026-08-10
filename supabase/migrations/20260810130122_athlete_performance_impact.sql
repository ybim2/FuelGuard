-- Fuel Guard Athlete Performance Impact, Phase 1.
--
-- Athlete-entered performance outcomes and lightweight completed-session
-- feedback remain user-owned. Derived reports are calculated from these
-- records plus existing Fuel Guard logs and completed workout context.
-- Coach/organisation visibility is deliberately deferred to Phase 2 so this
-- migration cannot widen existing sharing or organisation scope.

create table public.fuel_performance_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sport_type text not null default 'custom',
  preset_key text,
  name text not null,
  unit text not null,
  measurement_type text not null default 'number',
  direction text not null,
  target_min numeric(16,4),
  target_max numeric(16,4),
  display_order smallint not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_performance_metrics_user_identity_unique unique (id, user_id),
  constraint fuel_performance_metrics_sport_check check (
    sport_type in ('running', 'cycling', 'swimming', 'triathlon', 'football', 'team_sport', 'strength', 'general', 'custom')
  ),
  constraint fuel_performance_metrics_preset_length_check check (
    preset_key is null or char_length(preset_key) between 1 and 80
  ),
  constraint fuel_performance_metrics_name_check check (char_length(trim(name)) between 1 and 100),
  constraint fuel_performance_metrics_unit_check check (char_length(trim(unit)) between 1 and 24),
  constraint fuel_performance_metrics_measurement_check check (measurement_type in ('number', 'duration_seconds')),
  constraint fuel_performance_metrics_direction_check check (direction in ('lower', 'higher', 'target_range')),
  constraint fuel_performance_metrics_target_check check (
    (
      direction = 'target_range'
      and target_min is not null
      and target_max is not null
      and target_min <= target_max
    )
    or (
      direction in ('lower', 'higher')
      and target_min is null
      and target_max is null
    )
  ),
  constraint fuel_performance_metrics_display_order_check check (display_order between 1 and 3)
);

create unique index fuel_performance_metrics_active_slot_idx
  on public.fuel_performance_metrics (user_id, display_order)
  where archived_at is null;
create index fuel_performance_metrics_user_updated_idx
  on public.fuel_performance_metrics (user_id, updated_at desc);

create table public.fuel_performance_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  metric_id uuid not null,
  observed_on date not null,
  value numeric(16,4) not null,
  source text not null default 'athlete_entry',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_performance_results_metric_user_fk
    foreign key (metric_id, user_id)
    references public.fuel_performance_metrics(id, user_id)
    on delete restrict,
  constraint fuel_performance_results_value_check check (value between -100000000 and 100000000),
  constraint fuel_performance_results_source_check check (source in ('athlete_entry', 'garmin', 'imported')),
  constraint fuel_performance_results_notes_check check (notes is null or char_length(notes) <= 500)
);

create index fuel_performance_results_metric_date_idx
  on public.fuel_performance_results (metric_id, observed_on, created_at);
create index fuel_performance_results_user_date_idx
  on public.fuel_performance_results (user_id, observed_on desc);

create table public.fuel_training_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  training_mode_session_id uuid,
  activity_source text not null default 'training_mode',
  activity_external_id text,
  session_started_at timestamptz not null,
  session_ended_at timestamptz not null,
  energy_rating text not null,
  session_completion text not null,
  source text not null default 'athlete_entry',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_training_feedback_session_user_fk
    foreign key (training_mode_session_id, user_id)
    references public.fuel_training_mode_sessions(id, user_id)
    on delete restrict,
  constraint fuel_training_feedback_activity_source_check check (
    activity_source in ('training_mode', 'garmin', 'coach_schedule', 'manual', 'other')
  ),
  constraint fuel_training_feedback_activity_identity_check check (
    (training_mode_session_id is not null and activity_source = 'training_mode' and activity_external_id is null)
    or
    (training_mode_session_id is null and activity_external_id is not null and char_length(activity_external_id) between 1 and 180)
  ),
  constraint fuel_training_feedback_time_check check (session_ended_at > session_started_at),
  constraint fuel_training_feedback_duration_check check (session_ended_at <= session_started_at + interval '24 hours'),
  constraint fuel_training_feedback_energy_check check (energy_rating in ('strong', 'normal', 'low_energy')),
  constraint fuel_training_feedback_completion_check check (session_completion in ('yes', 'partially', 'no')),
  constraint fuel_training_feedback_source_check check (source = 'athlete_entry'),
  constraint fuel_training_feedback_notes_check check (notes is null or char_length(notes) <= 500)
);

create unique index fuel_training_feedback_training_session_idx
  on public.fuel_training_feedback (training_mode_session_id)
  where training_mode_session_id is not null;
create unique index fuel_training_feedback_external_activity_idx
  on public.fuel_training_feedback (user_id, activity_source, activity_external_id)
  where activity_external_id is not null;
create index fuel_training_feedback_user_ended_idx
  on public.fuel_training_feedback (user_id, session_ended_at desc);

create or replace function private.fuel_performance_impact_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.fuel_training_mode_sessions%rowtype;
begin
  -- Branch on the table before referencing table-specific record fields.
  -- PostgreSQL record expressions do not guarantee SQL boolean short-circuiting.
  if tg_table_name = 'fuel_performance_metrics' then
    if tg_op = 'UPDATE' and (new.id, new.user_id) is distinct from (old.id, old.user_id) then
      raise exception 'Performance metric identity is immutable.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'fuel_performance_results' then
    if tg_op = 'UPDATE' and (new.id, new.user_id, new.metric_id) is distinct from (old.id, old.user_id, old.metric_id) then
      raise exception 'Performance result identity is immutable.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'fuel_training_feedback' then
    if tg_op = 'UPDATE'
      and (new.id, new.user_id, new.training_mode_session_id, new.activity_source, new.activity_external_id)
        is distinct from (old.id, old.user_id, old.training_mode_session_id, old.activity_source, old.activity_external_id) then
      raise exception 'Training feedback identity is immutable.' using errcode = '42501';
    end if;

    if new.training_mode_session_id is not null then
      select * into session_row
      from public.fuel_training_mode_sessions session
      where session.id = new.training_mode_session_id
        and session.user_id = new.user_id;

      if not found or session_row.status <> 'completed' or session_row.ended_at is null then
        raise exception 'Feedback requires a completed Training Mode session.' using errcode = '23514';
      end if;

      new.activity_source := 'training_mode';
      new.activity_external_id := null;
      new.session_started_at := session_row.started_at;
      new.session_ended_at := session_row.ended_at;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_performance_impact_guard() from public, anon, authenticated, service_role;

create trigger fuel_performance_metrics_guard_trigger
  before update on public.fuel_performance_metrics
  for each row execute function private.fuel_performance_impact_guard();
create trigger fuel_performance_results_guard_trigger
  before update on public.fuel_performance_results
  for each row execute function private.fuel_performance_impact_guard();
create trigger fuel_training_feedback_guard_trigger
  before insert or update on public.fuel_training_feedback
  for each row execute function private.fuel_performance_impact_guard();

alter table public.fuel_performance_metrics enable row level security;
alter table public.fuel_performance_results enable row level security;
alter table public.fuel_training_feedback enable row level security;

revoke all on table public.fuel_performance_metrics from public, anon, authenticated;
revoke all on table public.fuel_performance_results from public, anon, authenticated;
revoke all on table public.fuel_training_feedback from public, anon, authenticated;

grant select, insert, update on table public.fuel_performance_metrics to authenticated;
grant select, insert, update on table public.fuel_performance_results to authenticated;
grant select, insert, update on table public.fuel_training_feedback to authenticated;

create policy fuel_performance_metrics_select_own
  on public.fuel_performance_metrics for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_performance_metrics_insert_own
  on public.fuel_performance_metrics for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fuel_performance_metrics_update_own
  on public.fuel_performance_metrics for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_performance_results_select_own
  on public.fuel_performance_results for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_performance_results_insert_own
  on public.fuel_performance_results for insert to authenticated
  with check ((select auth.uid()) = user_id and source = 'athlete_entry');
create policy fuel_performance_results_update_own
  on public.fuel_performance_results for update to authenticated
  using ((select auth.uid()) = user_id and source = 'athlete_entry')
  with check ((select auth.uid()) = user_id and source = 'athlete_entry');

create policy fuel_training_feedback_select_own
  on public.fuel_training_feedback for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_training_feedback_insert_own
  on public.fuel_training_feedback for insert to authenticated
  with check ((select auth.uid()) = user_id and source = 'athlete_entry');
create policy fuel_training_feedback_update_own
  on public.fuel_training_feedback for update to authenticated
  using ((select auth.uid()) = user_id and source = 'athlete_entry')
  with check ((select auth.uid()) = user_id and source = 'athlete_entry');

comment on table public.fuel_performance_metrics is
  'At most three active, athlete-owned primary performance outcomes. Slots 1-3 enforce the maximum without a cross-row counting trigger.';
comment on table public.fuel_performance_results is
  'Dated outcome observations. Phase 1 authenticated writes are explicitly athlete entries; future trusted adapters may add source-labelled observations.';
comment on table public.fuel_training_feedback is
  'Optional, lightweight athlete energy and completion feedback for a completed workout. One row is retained per source activity.';
comment on function private.fuel_performance_impact_guard() is
  'Protects impact record identity and copies authoritative timestamps from completed Training Mode sessions.';
