-- Fuel Guard fuelling-adherence context.
--
-- Daily context stores imprecise athlete-entered training periods without
-- inventing session timestamps. Exact Garmin, demand-block, or team schedule
-- timestamps remain in their canonical tables and take precedence in the app.

create extension if not exists pgcrypto;

create schema if not exists private;

create table public.fuel_daily_contexts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  context_date date not null,
  environment_context text,
  training_periods text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_daily_contexts_user_date_unique unique (user_id, context_date),
  constraint fuel_daily_contexts_environment_check
    check (
      environment_context is null
      or environment_context in ('normal', 'work', 'shift', 'travel', 'competition', 'holiday')
    ),
  constraint fuel_daily_contexts_training_periods_check
    check (
      training_periods <@ array['morning', 'afternoon', 'evening']::text[]
      and cardinality(training_periods) <= 3
    )
);

create table public.fuel_gap_barriers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gap_key text not null,
  preceding_fuel_log_id uuid references public.fuel_logs(id) on delete set null,
  following_fuel_log_id uuid references public.fuel_logs(id) on delete set null,
  gap_start timestamptz not null,
  gap_end timestamptz not null,
  target_minutes integer not null,
  actual_minutes integer not null,
  exceeded_minutes integer not null,
  barrier_reason text not null default 'unknown',
  note text,
  response_status text not null default 'answered',
  data_quality_status text not null default 'confirmed',
  was_ongoing boolean not null default false,
  training_overlap_kind text not null default 'unknown',
  training_reference_type text,
  training_reference_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_gap_barriers_user_gap_unique unique (user_id, gap_key),
  constraint fuel_gap_barriers_key_check
    check (char_length(gap_key) between 8 and 320),
  constraint fuel_gap_barriers_time_check
    check (gap_end > gap_start),
  constraint fuel_gap_barriers_duration_check
    check (
      target_minutes between 1 and 1440
      and actual_minutes >= 0
      and exceeded_minutes = greatest(0, actual_minutes - target_minutes)
    ),
  constraint fuel_gap_barriers_distinct_events_check
    check (
      preceding_fuel_log_id is null
      or following_fuel_log_id is null
      or preceding_fuel_log_id <> following_fuel_log_id
    ),
  constraint fuel_gap_barriers_reason_check
    check (
      barrier_reason in (
        'training',
        'busy',
        'no_food_available',
        'travel',
        'forgot',
        'plan_didnt_fit',
        'fuelled_not_logged',
        'other',
        'unknown'
      )
    ),
  constraint fuel_gap_barriers_note_check
    check (note is null or char_length(note) <= 240),
  constraint fuel_gap_barriers_response_status_check
    check (response_status in ('answered', 'skipped')),
  constraint fuel_gap_barriers_response_consistency_check
    check (
      (response_status = 'skipped' and barrier_reason = 'unknown')
      or
      (response_status = 'answered' and barrier_reason <> 'unknown')
    ),
  constraint fuel_gap_barriers_data_quality_check
    check (data_quality_status in ('confirmed', 'timing_uncertain')),
  constraint fuel_gap_barriers_data_quality_consistency_check
    check (
      (barrier_reason = 'fuelled_not_logged' and data_quality_status = 'timing_uncertain')
      or
      (barrier_reason <> 'fuelled_not_logged' and data_quality_status = 'confirmed')
    ),
  constraint fuel_gap_barriers_training_overlap_check
    check (training_overlap_kind in ('exact', 'period', 'none', 'unknown')),
  constraint fuel_gap_barriers_training_reference_check
    check (
      (training_reference_id is null and training_reference_type is null)
      or
      (
        training_reference_id is not null
        and training_reference_type in ('demand_block', 'team_schedule', 'garmin_activity', 'manual_exact')
      )
    )
);

create index fuel_daily_contexts_user_date_idx
  on public.fuel_daily_contexts (user_id, context_date desc);

create index fuel_gap_barriers_user_start_idx
  on public.fuel_gap_barriers (user_id, gap_start desc);

create index fuel_gap_barriers_user_quality_start_idx
  on public.fuel_gap_barriers (user_id, data_quality_status, gap_start desc);

create index fuel_gap_barriers_preceding_log_idx
  on public.fuel_gap_barriers (preceding_fuel_log_id)
  where preceding_fuel_log_id is not null;

create index fuel_gap_barriers_following_log_idx
  on public.fuel_gap_barriers (following_fuel_log_id)
  where following_fuel_log_id is not null;

create or replace function private.fuel_adherence_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.fuel_adherence_touch_updated_at() from public, anon, authenticated;

create trigger fuel_daily_contexts_touch_updated_at
  before update on public.fuel_daily_contexts
  for each row execute function private.fuel_adherence_touch_updated_at();

create trigger fuel_gap_barriers_touch_updated_at
  before update on public.fuel_gap_barriers
  for each row execute function private.fuel_adherence_touch_updated_at();

revoke all on table public.fuel_daily_contexts from public, anon, authenticated;
revoke all on table public.fuel_gap_barriers from public, anon, authenticated;
grant select, insert, update, delete on table public.fuel_daily_contexts to authenticated;
grant select, insert, update, delete on table public.fuel_gap_barriers to authenticated;

alter table public.fuel_daily_contexts enable row level security;
alter table public.fuel_daily_contexts force row level security;
alter table public.fuel_gap_barriers enable row level security;
alter table public.fuel_gap_barriers force row level security;

create policy fuel_daily_contexts_select_own_or_active_coach
  on public.fuel_daily_contexts
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = fuel_daily_contexts.user_id
        and relationship.status = 'active'
    )
  );

create policy fuel_daily_contexts_insert_own
  on public.fuel_daily_contexts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy fuel_daily_contexts_update_own
  on public.fuel_daily_contexts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_daily_contexts_delete_own
  on public.fuel_daily_contexts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy fuel_gap_barriers_select_own_or_active_coach
  on public.fuel_gap_barriers
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = fuel_gap_barriers.user_id
        and relationship.status = 'active'
    )
  );

create policy fuel_gap_barriers_insert_own
  on public.fuel_gap_barriers
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy fuel_gap_barriers_update_own
  on public.fuel_gap_barriers
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_gap_barriers_delete_own
  on public.fuel_gap_barriers
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- Exact athlete-authored demand blocks remain athlete-owned for writes. An
-- actively connected coach receives read-only access so exact training timing
-- can be compared with gaps without copying or weakening the canonical block.
drop policy if exists fuel_demand_blocks_select_assigned_coach on public.fuel_demand_blocks;
create policy fuel_demand_blocks_select_assigned_coach
  on public.fuel_demand_blocks
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = fuel_demand_blocks.user_id
        and relationship.status = 'active'
    )
  );

-- Return only activity timing needed for gap-overlap analysis. The function
-- verifies every requested athlete against the caller's active direct sharing
-- relationship and does not expose distance, calories, device IDs, or health
-- metrics from the underlying Garmin table.
create or replace function public.fuel_coach_training_activity_timing(
  p_athlete_ids uuid[],
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  activity_id uuid,
  athlete_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  activity_type text,
  source text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_athlete_ids is null or cardinality(p_athlete_ids) = 0 or cardinality(p_athlete_ids) > 100 then
    raise exception 'invalid athlete selection' using errcode = '22023';
  end if;
  if p_start is null or p_end is null or p_end <= p_start or p_end > p_start + interval '400 days' then
    raise exception 'invalid activity timing range' using errcode = '22023';
  end if;

  return query
  select
    activity.id,
    activity.user_id,
    activity.started_at,
    activity.started_at + make_interval(secs => activity.duration_seconds),
    activity.activity_type,
    activity.source
  from public.garmin_activity_summaries activity
  where activity.user_id = any(p_athlete_ids)
    and activity.started_at >= p_start
    and activity.started_at < p_end
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = activity.user_id
        and relationship.status = 'active'
    )
  order by activity.started_at;
end;
$$;

revoke all on function public.fuel_coach_training_activity_timing(uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.fuel_coach_training_activity_timing(uuid[], timestamptz, timestamptz) to authenticated;

comment on table public.fuel_daily_contexts is
  'Athlete-owned daily environment and imprecise manual training-period context.';
comment on column public.fuel_daily_contexts.training_periods is
  'Period classifications only; values do not represent fabricated session timestamps.';
comment on table public.fuel_gap_barriers is
  'Athlete responses attached to stable excessive fuel-gap episodes; coaches have read-only active-relationship access.';
comment on column public.fuel_gap_barriers.data_quality_status is
  'timing_uncertain means the athlete reported fuelling without an exact log; no missing fuel event is fabricated.';
