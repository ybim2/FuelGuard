-- Fuel Guard lean product analytics.
--
-- Existing domain tables remain authoritative for meaningful Athlete actions.
-- This migration adds a privacy-minimised explicit event stream, immutable
-- first-touch attribution, and founder-only aggregate/detail RPCs protected by
-- the existing revocable platform-administrator identity.

create table public.fuel_product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  platform text not null default 'pwa',
  app_version text,
  session_id uuid,
  timezone_name text not null default 'UTC',
  dedupe_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint fuel_product_events_name_check check (event_name in (
    'app_open',
    'session_started',
    'session_ended',
    'daily_mode_viewed',
    'analytics_viewed',
    'settings_viewed',
    'account_created',
    'onboarding_started',
    'onboarding_completed',
    'fuel_logged',
    'hydration_logged',
    'supplement_logged',
    'sleepy_logged',
    'training_started',
    'training_completed',
    'reflection_completed',
    'work_pattern_configured',
    'garmin_connected',
    'coach_connected',
    'fuel_log_failed',
    'supplement_log_failed',
    'training_start_failed',
    'training_complete_failed',
    'garmin_connection_failed'
  )),
  constraint fuel_product_events_platform_check check (
    platform in ('pwa', 'ios_pwa', 'android_pwa', 'web', 'garmin', 'server')
  ),
  constraint fuel_product_events_app_version_check check (
    app_version is null or char_length(app_version) between 1 and 120
  ),
  constraint fuel_product_events_timezone_check check (
    char_length(trim(timezone_name)) between 1 and 100
  ),
  constraint fuel_product_events_dedupe_key_check check (
    dedupe_key is null or char_length(dedupe_key) between 1 and 200
  ),
  constraint fuel_product_events_metadata_object_check check (
    jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048
  )
);

create index fuel_product_events_user_idx
  on public.fuel_product_events (user_id);
create index fuel_product_events_name_idx
  on public.fuel_product_events (event_name);
create index fuel_product_events_occurred_idx
  on public.fuel_product_events (occurred_at desc);
create index fuel_product_events_user_occurred_idx
  on public.fuel_product_events (user_id, occurred_at desc);
create unique index fuel_product_events_user_dedupe_idx
  on public.fuel_product_events (user_id, dedupe_key)
  where dedupe_key is not null;

create table public.fuel_product_attribution (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source text,
  medium text,
  campaign text,
  creator text,
  content text,
  landing_variant text,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint fuel_product_attribution_source_check
    check (source is null or char_length(source) between 1 and 120),
  constraint fuel_product_attribution_medium_check
    check (medium is null or char_length(medium) between 1 and 120),
  constraint fuel_product_attribution_campaign_check
    check (campaign is null or char_length(campaign) between 1 and 160),
  constraint fuel_product_attribution_creator_check
    check (creator is null or char_length(creator) between 1 and 160),
  constraint fuel_product_attribution_content_check
    check (content is null or char_length(content) between 1 and 200),
  constraint fuel_product_attribution_landing_check
    check (landing_variant is null or char_length(landing_variant) between 1 and 120),
  constraint fuel_product_attribution_nonempty_check check (
    num_nonnulls(source, medium, campaign, creator, content, landing_variant) > 0
  )
);

create index fuel_product_attribution_source_campaign_idx
  on public.fuel_product_attribution (source, campaign, captured_at);

create table private.fuel_product_analytics_exclusions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null,
  excluded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_product_analytics_exclusions_reason_check
    check (char_length(trim(reason)) between 1 and 300)
);

create index fuel_product_analytics_exclusions_actor_idx
  on private.fuel_product_analytics_exclusions (excluded_by, updated_at desc);

create table private.fuel_product_analytics_access_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  occurred_at timestamptz not null default now(),
  constraint fuel_product_analytics_access_action_check
    check (action in ('user_detail_viewed', 'test_account_excluded', 'test_account_included'))
);

create index fuel_product_analytics_access_actor_idx
  on private.fuel_product_analytics_access_audit (actor_user_id, occurred_at desc);
create index fuel_product_analytics_access_target_idx
  on private.fuel_product_analytics_access_audit (target_user_id, occurred_at desc)
  where target_user_id is not null;

alter table public.fuel_product_events enable row level security;
alter table public.fuel_product_attribution enable row level security;
alter table private.fuel_product_analytics_exclusions enable row level security;
alter table private.fuel_product_analytics_access_audit enable row level security;

revoke all on table public.fuel_product_events from public, anon, authenticated;
revoke all on table public.fuel_product_attribution from public, anon, authenticated;
revoke all on table private.fuel_product_analytics_exclusions from public, anon, authenticated;
revoke all on table private.fuel_product_analytics_access_audit from public, anon, authenticated;

grant select on table public.fuel_product_events to authenticated;
grant select on table public.fuel_product_attribution to authenticated;

create policy fuel_product_events_select_own
  on public.fuel_product_events for select to authenticated
  using ((select auth.uid()) = user_id);

create policy fuel_product_attribution_select_own
  on public.fuel_product_attribution for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.fuel_track_product_event(
  p_event_name text,
  p_platform text default 'pwa',
  p_app_version text default null,
  p_session_id uuid default null,
  p_timezone_name text default 'UTC',
  p_dedupe_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_event_name text := lower(trim(coalesce(p_event_name, '')));
  clean_platform text := lower(trim(coalesce(p_platform, 'pwa')));
  clean_app_version text := nullif(left(trim(coalesce(p_app_version, '')), 120), '');
  clean_timezone text := left(trim(coalesce(p_timezone_name, 'UTC')), 100);
  clean_dedupe_key text := nullif(left(trim(coalesce(p_dedupe_key, '')), 200), '');
  clean_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  metadata_key text;
  metadata_value jsonb;
  event_id uuid;
begin
  if caller_id is null then
    raise exception 'Authentication is required to record a product event.' using errcode = '42501';
  end if;

  if clean_event_name not in (
    'app_open', 'session_started', 'session_ended',
    'daily_mode_viewed', 'analytics_viewed', 'settings_viewed',
    'account_created', 'onboarding_started', 'onboarding_completed',
    'fuel_logged', 'hydration_logged', 'supplement_logged', 'sleepy_logged',
    'training_started', 'training_completed', 'reflection_completed',
    'work_pattern_configured', 'garmin_connected', 'coach_connected',
    'fuel_log_failed', 'supplement_log_failed', 'training_start_failed',
    'training_complete_failed', 'garmin_connection_failed'
  ) then
    raise exception 'Unsupported Fuel Guard product event.' using errcode = '22023';
  end if;

  if clean_platform not in ('pwa', 'ios_pwa', 'android_pwa', 'web', 'garmin', 'server') then
    raise exception 'Unsupported Fuel Guard analytics platform.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = clean_timezone
  ) then
    clean_timezone := 'UTC';
  end if;

  if jsonb_typeof(clean_metadata) is distinct from 'object'
     or pg_column_size(clean_metadata) > 2048 then
    raise exception 'Analytics metadata must be a small JSON object.' using errcode = '22023';
  end if;

  for metadata_key, metadata_value in
    select entry.key, entry.value from jsonb_each(clean_metadata) entry
  loop
    if metadata_key not in (
      'source', 'mode', 'screen', 'failure_category', 'connection_type',
      'entry_method', 'environment', 'count'
    ) then
      raise exception 'Analytics metadata contains an unsupported field.' using errcode = '22023';
    end if;
    if jsonb_typeof(metadata_value) not in ('string', 'number', 'boolean', 'null') then
      raise exception 'Analytics metadata values must be scalar.' using errcode = '22023';
    end if;
  end loop;

  insert into public.fuel_product_events (
    user_id,
    event_name,
    platform,
    app_version,
    session_id,
    timezone_name,
    dedupe_key,
    metadata
  ) values (
    caller_id,
    clean_event_name,
    clean_platform,
    clean_app_version,
    p_session_id,
    clean_timezone,
    clean_dedupe_key,
    clean_metadata
  )
  on conflict (user_id, dedupe_key) where dedupe_key is not null
  do nothing
  returning id into event_id;

  if event_id is null and clean_dedupe_key is not null then
    select event.id into event_id
    from public.fuel_product_events event
    where event.user_id = caller_id
      and event.dedupe_key = clean_dedupe_key;
  end if;

  return event_id;
end;
$$;

revoke all on function public.fuel_track_product_event(text, text, text, uuid, text, text, jsonb)
  from public, anon;
grant execute on function public.fuel_track_product_event(text, text, text, uuid, text, text, jsonb)
  to authenticated;

create or replace function public.fuel_capture_first_touch_attribution(
  p_source text default null,
  p_medium text default null,
  p_campaign text default null,
  p_creator text default null,
  p_content text default null,
  p_landing_variant text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_source text := nullif(left(trim(coalesce(p_source, '')), 120), '');
  clean_medium text := nullif(left(trim(coalesce(p_medium, '')), 120), '');
  clean_campaign text := nullif(left(trim(coalesce(p_campaign, '')), 160), '');
  clean_creator text := nullif(left(trim(coalesce(p_creator, '')), 160), '');
  clean_content text := nullif(left(trim(coalesce(p_content, '')), 200), '');
  clean_landing text := nullif(left(trim(coalesce(p_landing_variant, '')), 120), '');
  inserted_count integer := 0;
begin
  if caller_id is null then
    raise exception 'Authentication is required to record attribution.' using errcode = '42501';
  end if;
  if num_nonnulls(clean_source, clean_medium, clean_campaign, clean_creator, clean_content, clean_landing) = 0 then
    return false;
  end if;

  insert into public.fuel_product_attribution (
    user_id, source, medium, campaign, creator, content, landing_variant
  ) values (
    caller_id, clean_source, clean_medium, clean_campaign, clean_creator, clean_content, clean_landing
  ) on conflict (user_id) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

revoke all on function public.fuel_capture_first_touch_attribution(text, text, text, text, text, text)
  from public, anon;
grant execute on function public.fuel_capture_first_touch_attribution(text, text, text, text, text, text)
  to authenticated;

create or replace view private.fuel_product_core_actions
with (security_invoker = true)
as
  select
    log.user_id,
    case
      when log.notes like 'fuel_guard_checkin:%"checkinType":"sleepy"%'
        then 'sleepy_logged'
      when log.type = 'hydration' then 'hydration_logged'
      else 'fuel_logged'
    end as event_name,
    log.logged_at as occurred_at,
    log.id as source_record_id,
    'fuel_logs'::text as source_table
  from public.fuel_logs log
  where lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')

  union all

  select
    supplement.user_id,
    'supplement_logged'::text,
    supplement.taken_at,
    (array_agg(supplement.id order by supplement.id))[1],
    'fuel_supplement_events'::text
  from public.fuel_supplement_events supplement
  where supplement.event_status = 'taken'
    and lower(coalesce(supplement.source, 'manual')) not in ('test', 'fixture', 'invalid')
  group by supplement.user_id, supplement.taken_at

  union all

  select
    training.user_id,
    'training_started'::text,
    training.started_at,
    training.id,
    'fuel_training_mode_sessions'::text
  from public.fuel_training_mode_sessions training

  union all

  select
    training.user_id,
    'training_completed'::text,
    training.ended_at,
    training.id,
    'fuel_training_mode_sessions'::text
  from public.fuel_training_mode_sessions training
  where training.status = 'completed'
    and training.ended_at is not null

  union all

  select
    reflection.user_id,
    'reflection_completed'::text,
    reflection.completed_at,
    reflection.id,
    'fuel_everyday_reflections'::text
  from public.fuel_everyday_reflections reflection
  where reflection.completed_at is not null

  union all

  select
    result.user_id,
    'reflection_completed'::text,
    result.created_at,
    result.id,
    'fuel_performance_results'::text
  from public.fuel_performance_results result

  union all

  select
    feedback.user_id,
    'reflection_completed'::text,
    feedback.created_at,
    feedback.id,
    'fuel_training_feedback'::text
  from public.fuel_training_feedback feedback

  union all

  select
    work_pattern.user_id,
    'work_pattern_configured'::text,
    work_pattern.created_at,
    work_pattern.user_id,
    'fuel_work_patterns'::text
  from public.fuel_work_patterns work_pattern
  where work_pattern.active;

revoke all on table private.fuel_product_core_actions from public, anon, authenticated;

create or replace view private.fuel_product_user_timezones
with (security_invoker = true)
as
  select
    account.id as user_id,
    coalesce(
      (
        select event.timezone_name
        from public.fuel_product_events event
        where event.user_id = account.id
        order by event.occurred_at desc
        limit 1
      ),
      (
        select work_pattern.timezone_name
        from public.fuel_work_patterns work_pattern
        where work_pattern.user_id = account.id
          and work_pattern.active
        limit 1
      ),
      (
        select supplement.timezone_name
        from public.fuel_supplement_events supplement
        where supplement.user_id = account.id
        order by supplement.taken_at desc
        limit 1
      ),
      'UTC'
    ) as timezone_name
  from auth.users account
  where account.deleted_at is null;

revoke all on table private.fuel_product_user_timezones from public, anon, authenticated;

create or replace view private.fuel_product_meaningful_actions
with (security_invoker = true)
as
  select
    action.user_id,
    action.event_name,
    action.occurred_at,
    timezone(user_timezone.timezone_name, action.occurred_at)::date as local_day,
    timezone(user_timezone.timezone_name, now())::date as today_local,
    user_timezone.timezone_name,
    action.source_record_id,
    action.source_table
  from private.fuel_product_core_actions action
  join private.fuel_product_user_timezones user_timezone
    on user_timezone.user_id = action.user_id;

revoke all on table private.fuel_product_meaningful_actions from public, anon, authenticated;

create or replace function public.fuel_product_analytics_summary(
  p_include_excluded boolean default false
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not private.fuel_is_active_platform_admin((select auth.uid())) then
    raise exception 'Fuel Guard product analytics access denied.' using errcode = '42501';
  end if;

  with base_users as (
    select
      account.id as user_id,
      account.email,
      account.created_at as joined_at,
      coalesce(profile.display_name, profile.first_name, split_part(account.email, '@', 1), 'Fuel Guard user') as display_name,
      user_timezone.timezone_name,
      timezone(user_timezone.timezone_name, now())::date as today_local,
      exclusion.user_id is not null as is_excluded
    from auth.users account
    left join public.fuel_user_profiles profile on profile.user_id = account.id
    join private.fuel_product_user_timezones user_timezone on user_timezone.user_id = account.id
    left join private.fuel_product_analytics_exclusions exclusion on exclusion.user_id = account.id
    where account.deleted_at is null
      and (p_include_excluded or exclusion.user_id is null)
  ),
  actions as (
    select action.*
    from private.fuel_product_meaningful_actions action
    join base_users account on account.user_id = action.user_id
  ),
  activation as (
    select distinct on (action.user_id)
      action.user_id,
      action.occurred_at as activation_at,
      action.local_day as activation_day
    from actions action
    order by action.user_id, action.occurred_at, action.source_table, action.source_record_id
  ),
  usage as (
    select
      account.user_id,
      account.email,
      account.display_name,
      account.joined_at,
      account.timezone_name,
      account.today_local,
      account.is_excluded,
      activation.activation_at,
      activation.activation_day,
      min(action.occurred_at) as first_activity_at,
      max(action.occurred_at) as last_activity_at,
      count(action.user_id)::integer as total_actions,
      count(action.user_id) filter (where action.local_day >= account.today_local - 29)::integer as actions_30,
      count(action.user_id) filter (where action.local_day = account.today_local) > 0 as active_today,
      count(distinct action.local_day)::integer as active_days_lifetime,
      count(distinct action.local_day) filter (where action.local_day >= account.today_local - 6)::integer as active_days_7,
      count(distinct action.local_day) filter (where action.local_day >= account.today_local - 29)::integer as active_days_30,
      count(distinct action.local_day) filter (
        where action.local_day >= date_trunc('week', account.today_local::timestamp)::date
      )::integer as active_days_week,
      count(*) filter (where action.event_name = 'fuel_logged')::integer as fuel_logs,
      count(*) filter (where action.event_name = 'hydration_logged')::integer as hydration_logs,
      count(*) filter (where action.event_name = 'supplement_logged')::integer as supplement_logs,
      count(*) filter (where action.event_name = 'sleepy_logged')::integer as sleepy_logs,
      count(*) filter (where action.event_name = 'training_started')::integer as training_sessions,
      count(*) filter (where action.event_name = 'reflection_completed')::integer as reflections
    from base_users account
    left join activation on activation.user_id = account.user_id
    left join actions action on action.user_id = account.user_id
    group by account.user_id, account.email, account.display_name, account.joined_at,
      account.timezone_name, account.today_local, account.is_excluded,
      activation.activation_at, activation.activation_day
  ),
  retention_flags as (
    select
      account.user_id,
      account.today_local,
      activation.activation_day,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day = activation.activation_day + 1
      ) as d1,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day between activation.activation_day + 7 and activation.activation_day + 13
      ) as d7,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day between activation.activation_day + 30 and activation.activation_day + 36
      ) as d30,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day between activation.activation_day + 1 and activation.activation_day + 7
      ) as week1,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day between activation.activation_day + 8 and activation.activation_day + 14
      ) as week2,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day between activation.activation_day + 22 and activation.activation_day + 28
      ) as week4,
      exists (
        select 1 from actions action
        where action.user_id = account.user_id
          and action.local_day >= activation.activation_day + 7
      ) as retained_any
    from base_users account
    join activation on activation.user_id = account.user_id
  ),
  retention as (
    select
      count(*) filter (where today_local >= activation_day + 1)::integer as d1_denominator,
      count(*) filter (where today_local >= activation_day + 1 and d1)::integer as d1_numerator,
      count(*) filter (where today_local >= activation_day + 7)::integer as d7_denominator,
      count(*) filter (where today_local >= activation_day + 7 and d7)::integer as d7_numerator,
      count(*) filter (where today_local >= activation_day + 30)::integer as d30_denominator,
      count(*) filter (where today_local >= activation_day + 30 and d30)::integer as d30_numerator,
      count(*) filter (where today_local >= activation_day + 7)::integer as week1_denominator,
      count(*) filter (where today_local >= activation_day + 7 and week1)::integer as week1_numerator,
      count(*) filter (where today_local >= activation_day + 14)::integer as week2_denominator,
      count(*) filter (where today_local >= activation_day + 14 and week2)::integer as week2_numerator,
      count(*) filter (where today_local >= activation_day + 28)::integer as week4_denominator,
      count(*) filter (where today_local >= activation_day + 28 and week4)::integer as week4_numerator
    from retention_flags
  ),
  feature_catalog(feature, display_order) as (
    values
      ('Fuel', 1),
      ('Hydration', 2),
      ('Supplements', 3),
      ('Sleepy', 4),
      ('Training Mode', 5),
      ('Reflections', 6),
      ('Analytics', 7),
      ('Garmin', 8),
      ('Coach sharing', 9)
  ),
  feature_events as (
    select
      action.user_id,
      case action.event_name
        when 'fuel_logged' then 'Fuel'
        when 'hydration_logged' then 'Hydration'
        when 'supplement_logged' then 'Supplements'
        when 'sleepy_logged' then 'Sleepy'
        when 'training_started' then 'Training Mode'
        when 'training_completed' then 'Training Mode'
        when 'reflection_completed' then 'Reflections'
      end as feature,
      action.occurred_at
    from actions action

    union all

    select event.user_id, 'Analytics', event.occurred_at
    from public.fuel_product_events event
    join base_users account on account.user_id = event.user_id
    where event.event_name = 'analytics_viewed'

    union all

    select device.user_id, 'Garmin', device.created_at
    from public.garmin_device_tokens device
    join base_users account on account.user_id = device.user_id
    where device.revoked_at is null

    union all

    select relationship.athlete_id, 'Coach sharing', coalesce(relationship.accepted_at, relationship.created_at)
    from public.fuel_coach_athletes relationship
    join base_users account on account.user_id = relationship.athlete_id
    where relationship.status = 'active'
  ),
  feature_usage as (
    select
      catalog.feature,
      catalog.display_order,
      count(distinct event.user_id)::integer as users,
      count(event.user_id)::integer as events
    from feature_catalog catalog
    left join feature_events event on event.feature = catalog.feature
    group by catalog.feature, catalog.display_order
  ),
  cohorts as (
    select
      date_trunc('week', account.joined_at)::date as cohort_week,
      count(*)::integer as users,
      count(activation.user_id)::integer as activated,
      count(*) filter (
        where flags.today_local >= flags.activation_day + 1
      )::integer as d1_denominator,
      count(*) filter (
        where flags.today_local >= flags.activation_day + 1 and flags.d1
      )::integer as d1_numerator,
      count(*) filter (
        where flags.today_local >= flags.activation_day + 7
      )::integer as d7_denominator,
      count(*) filter (
        where flags.today_local >= flags.activation_day + 7 and flags.d7
      )::integer as d7_numerator,
      count(*) filter (
        where flags.today_local >= flags.activation_day + 30
      )::integer as d30_denominator,
      count(*) filter (
        where flags.today_local >= flags.activation_day + 30 and flags.d30
      )::integer as d30_numerator
    from base_users account
    left join activation on activation.user_id = account.user_id
    left join retention_flags flags on flags.user_id = account.user_id
    group by date_trunc('week', account.joined_at)::date
  ),
  attribution_usage as (
    select
      coalesce(attribution.source, 'Unattributed') as source,
      coalesce(attribution.campaign, '') as campaign,
      coalesce(attribution.creator, '') as creator,
      count(*)::integer as signups,
      count(activation.user_id)::integer as activated,
      count(*) filter (where flags.retained_any)::integer as retained
    from base_users account
    left join public.fuel_product_attribution attribution on attribution.user_id = account.user_id
    left join activation on activation.user_id = account.user_id
    left join retention_flags flags on flags.user_id = account.user_id
    group by coalesce(attribution.source, 'Unattributed'),
      coalesce(attribution.campaign, ''), coalesce(attribution.creator, '')
  ),
  event_coverage as (
    select
      count(*)::integer as event_count,
      min(event.occurred_at) as first_event_at,
      count(distinct event.user_id)::integer as users_with_events
    from public.fuel_product_events event
    join base_users account on account.user_id = event.user_id
  ),
  failure_usage as (
    select
      event.event_name,
      coalesce(event.metadata->>'failure_category', 'unknown') as failure_category,
      count(distinct event.user_id)::integer as users,
      count(*)::integer as events,
      max(event.occurred_at) as last_occurred_at
    from public.fuel_product_events event
    join base_users account on account.user_id = event.user_id
    where event.event_name in (
      'fuel_log_failed', 'supplement_log_failed', 'training_start_failed',
      'training_complete_failed', 'garmin_connection_failed'
    )
    group by event.event_name, coalesce(event.metadata->>'failure_category', 'unknown')
  )
  select jsonb_build_object(
    'definitionsVersion', '2026-08-15-v1',
    'generatedAt', now(),
    'overview', jsonb_build_object(
      'totalUsers', (select count(*) from base_users),
      'newUsers7d', (select count(*) from base_users where joined_at >= now() - interval '7 days'),
      'newUsers30d', (select count(*) from base_users where joined_at >= now() - interval '30 days'),
      'activatedUsers', (select count(*) from activation),
      'activationRate', (
        select round(100.0 * count(activation.user_id) / nullif(count(*), 0), 1)
        from base_users account left join activation on activation.user_id = account.user_id
      ),
      'averageHoursToActivation', (
        select round(avg(extract(epoch from (activation.activation_at - account.joined_at)) / 3600.0)::numeric, 1)
        from base_users account join activation on activation.user_id = account.user_id
      ),
      'medianHoursToActivation', (
        select round((percentile_cont(0.5) within group (
          order by extract(epoch from (activation.activation_at - account.joined_at)) / 3600.0
        ))::numeric, 1)
        from base_users account join activation on activation.user_id = account.user_id
      ),
      'dau', (select count(*) from usage where active_today),
      'wau', (select count(*) from usage where active_days_7 > 0),
      'mau', (select count(*) from usage where active_days_30 > 0),
      'dauMau', (
        select round(100.0 * count(*) filter (where active_today)
          / nullif(count(*) filter (where active_days_30 > 0), 0), 1)
        from usage
      ),
      'inactive7d', (select count(*) from usage where last_activity_at is null or last_activity_at < now() - interval '7 days'),
      'inactive14d', (select count(*) from usage where last_activity_at is null or last_activity_at < now() - interval '14 days'),
      'inactive30d', (select count(*) from usage where last_activity_at is null or last_activity_at < now() - interval '30 days')
    ),
    'retention', (
      select jsonb_build_object(
        'd1', jsonb_build_object('percentage', round(100.0 * d1_numerator / nullif(d1_denominator, 0), 1), 'numerator', d1_numerator, 'denominator', d1_denominator),
        'd7', jsonb_build_object('percentage', round(100.0 * d7_numerator / nullif(d7_denominator, 0), 1), 'numerator', d7_numerator, 'denominator', d7_denominator),
        'd30', jsonb_build_object('percentage', round(100.0 * d30_numerator / nullif(d30_denominator, 0), 1), 'numerator', d30_numerator, 'denominator', d30_denominator),
        'week1', jsonb_build_object('percentage', round(100.0 * week1_numerator / nullif(week1_denominator, 0), 1), 'numerator', week1_numerator, 'denominator', week1_denominator),
        'week2', jsonb_build_object('percentage', round(100.0 * week2_numerator / nullif(week2_denominator, 0), 1), 'numerator', week2_numerator, 'denominator', week2_denominator),
        'week4', jsonb_build_object('percentage', round(100.0 * week4_numerator / nullif(week4_denominator, 0), 1), 'numerator', week4_numerator, 'denominator', week4_denominator)
      ) from retention
    ),
    'engagement', jsonb_build_object(
      'averageActiveDays30d', (select round(avg(active_days_30)::numeric, 1) from usage),
      'averageActionsPerActiveDay30d', (
        select round(sum(actions_30)::numeric / nullif(sum(active_days_30), 0), 1) from usage
      ),
      'medianActionsLifetime', (
        select round((percentile_cont(0.5) within group (order by total_actions))::numeric, 1) from usage
      ),
      'usersActive3DaysThisWeek', (select count(*) from usage where active_days_week >= 3),
      'usersActive5DaysThisWeek', (select count(*) from usage where active_days_week >= 5),
      'rolling7DayUsers', (select count(*) from usage where active_days_7 > 0),
      'rolling30DayUsers', (select count(*) from usage where active_days_30 > 0)
    ),
    'featureUsage', (
      select jsonb_agg(jsonb_build_object(
        'feature', feature,
        'users', users,
        'events', events
      ) order by display_order) from feature_usage
    ),
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'cohortWeek', cohort_week,
        'users', users,
        'activated', activated,
        'd1', case when d1_denominator = 0 then null else round(100.0 * d1_numerator / d1_denominator, 1) end,
        'd1Sample', d1_denominator,
        'd7', case when d7_denominator = 0 then null else round(100.0 * d7_numerator / d7_denominator, 1) end,
        'd7Sample', d7_denominator,
        'd30', case when d30_denominator = 0 then null else round(100.0 * d30_numerator / d30_denominator, 1) end,
        'd30Sample', d30_denominator
      ) order by cohort_week desc), '[]'::jsonb) from cohorts
    ),
    'acquisition', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'source', source,
        'campaign', campaign,
        'creator', creator,
        'signups', signups,
        'activated', activated,
        'retained', retained
      ) order by signups desc, source), '[]'::jsonb) from attribution_usage
    ),
    'funnel', jsonb_build_object(
      'visitors', null,
      'signups', (select count(*) from base_users),
      'activated', (select count(*) from activation),
      'retained', (select count(*) from retention_flags where retained_any),
      'signedUpNotActivated', (
        select count(*) from base_users account
        left join activation on activation.user_id = account.user_id
        where activation.user_id is null
      ),
      'activatedNotRetained', (
        select count(*) from activation
        left join retention_flags flags on flags.user_id = activation.user_id
        where coalesce(flags.retained_any, false) is false
      ),
      'paid', null
    ),
    'failures', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'eventName', event_name,
        'category', failure_category,
        'users', users,
        'events', events,
        'lastOccurredAt', last_occurred_at
      ) order by events desc, event_name), '[]'::jsonb)
      from failure_usage
    ),
    'eventCoverage', (
      select jsonb_build_object(
        'explicitEvents', event_count,
        'usersWithExplicitEvents', users_with_events,
        'explicitTrackingSince', first_event_at,
        'historicalCoreActionsDerived', true
      ) from event_coverage
    ),
    'users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'userId', usage.user_id,
        'email', usage.email,
        'displayName', usage.display_name,
        'joinedAt', usage.joined_at,
        'activationAt', usage.activation_at,
        'firstActivityAt', usage.first_activity_at,
        'lastActivityAt', usage.last_activity_at,
        'activeDaysLifetime', usage.active_days_lifetime,
        'activeDays7d', usage.active_days_7,
        'activeDays30d', usage.active_days_30,
        'totalActions', usage.total_actions,
        'isExcluded', usage.is_excluded,
        'engagementState', case
          when usage.activation_at is null then 'signed_up'
          when usage.last_activity_at < now() - interval '30 days' then 'dormant'
          when usage.last_activity_at < now() - interval '7 days' then 'at_risk'
          when coalesce(flags.retained_any, false) then 'retained'
          when usage.active_days_lifetime >= 2 then 'active'
          else 'activated'
        end
      ) order by usage.joined_at desc), '[]'::jsonb)
      from usage left join retention_flags flags on flags.user_id = usage.user_id
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.fuel_product_analytics_summary(boolean)
  from public, anon;
grant execute on function public.fuel_product_analytics_summary(boolean)
  to authenticated;

create or replace function public.fuel_product_analytics_user(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  result jsonb;
begin
  if not private.fuel_is_active_platform_admin(caller_id) then
    raise exception 'Fuel Guard product analytics access denied.' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (
    select 1 from auth.users account where account.id = p_user_id and account.deleted_at is null
  ) then
    raise exception 'Fuel Guard user not found.' using errcode = '22023';
  end if;

  insert into private.fuel_product_analytics_access_audit (
    actor_user_id, target_user_id, action
  ) values (caller_id, p_user_id, 'user_detail_viewed');

  with user_timezone as (
    select * from private.fuel_product_user_timezones where user_id = p_user_id
  ),
  actions as (
    select * from private.fuel_product_meaningful_actions where user_id = p_user_id
  ),
  activation as (
    select occurred_at as activation_at, local_day as activation_day
    from actions order by occurred_at limit 1
  ),
  explicit_timeline as (
    select
      event.event_name,
      event.occurred_at,
      'explicit_event'::text as source,
      jsonb_strip_nulls(jsonb_build_object(
        'platform', event.platform,
        'failureCategory', event.metadata->>'failure_category',
        'source', event.metadata->>'source'
      )) as context
    from public.fuel_product_events event
    where event.user_id = p_user_id
          and event.event_name not in (
            'fuel_logged', 'hydration_logged', 'supplement_logged', 'sleepy_logged',
            'training_started', 'training_completed', 'reflection_completed',
            'work_pattern_configured'
          )
  ),
  combined_timeline as (
    select
      action.event_name,
      action.occurred_at,
      'derived_core_action'::text as source,
      jsonb_build_object('sourceTable', action.source_table) as context
    from actions action
    union all
    select * from explicit_timeline
  ),
  recent_timeline as (
    select * from combined_timeline order by occurred_at desc limit 200
  ),
  feature_counts as (
    select event_name, count(*)::integer as events
    from actions group by event_name
  )
  select jsonb_build_object(
    'account', jsonb_build_object(
      'userId', account.id,
      'email', account.email,
      'displayName', coalesce(profile.display_name, profile.first_name, split_part(account.email, '@', 1), 'Fuel Guard user'),
      'joinedAt', account.created_at,
      'timezoneName', user_timezone.timezone_name,
      'excludedFromMetrics', exclusion.user_id is not null,
      'exclusionReason', exclusion.reason
    ),
    'activation', jsonb_build_object(
      'activationAt', activation.activation_at,
      'hoursToActivation', case when activation.activation_at is null then null
        else round((extract(epoch from (activation.activation_at - account.created_at)) / 3600.0)::numeric, 1) end
    ),
    'usage', jsonb_build_object(
      'firstMeaningfulActivity', (select min(occurred_at) from actions),
      'lastMeaningfulActivity', (select max(occurred_at) from actions),
      'activeDaysLifetime', (select count(distinct local_day) from actions),
      'activeDays7d', (select count(distinct local_day) from actions where local_day >= timezone(user_timezone.timezone_name, now())::date - 6),
      'activeDays30d', (select count(distinct local_day) from actions where local_day >= timezone(user_timezone.timezone_name, now())::date - 29),
      'totalMeaningfulActions', (select count(*) from actions),
      'fuelLogs', (select count(*) from actions where event_name = 'fuel_logged'),
      'hydrationLogs', (select count(*) from actions where event_name = 'hydration_logged'),
      'supplementLogs', (select count(*) from actions where event_name = 'supplement_logged'),
      'sleepyLogs', (select count(*) from actions where event_name = 'sleepy_logged'),
      'trainingSessions', (select count(*) from actions where event_name = 'training_started'),
      'reflections', (select count(*) from actions where event_name = 'reflection_completed'),
      'garminConnected', exists (select 1 from public.garmin_device_tokens token where token.user_id = p_user_id and token.revoked_at is null),
      'coachConnected', exists (select 1 from public.fuel_coach_athletes relationship where relationship.athlete_id = p_user_id and relationship.status = 'active')
    ),
    'features', (
      select coalesce(jsonb_agg(jsonb_build_object('eventName', event_name, 'events', events) order by event_name), '[]'::jsonb)
      from feature_counts
    ),
    'attribution', (
      select to_jsonb(attribution) - 'user_id' - 'created_at'
      from public.fuel_product_attribution attribution
      where attribution.user_id = p_user_id
    ),
    'timeline', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'eventName', event_name,
        'occurredAt', occurred_at,
        'source', source,
        'context', context
      ) order by occurred_at desc), '[]'::jsonb)
      from recent_timeline
    )
  ) into result
  from auth.users account
  join user_timezone on user_timezone.user_id = account.id
  left join public.fuel_user_profiles profile on profile.user_id = account.id
  left join private.fuel_product_analytics_exclusions exclusion on exclusion.user_id = account.id
  left join activation on true
  where account.id = p_user_id;

  return result;
end;
$$;

revoke all on function public.fuel_product_analytics_user(uuid)
  from public, anon;
grant execute on function public.fuel_product_analytics_user(uuid)
  to authenticated;

create or replace function public.fuel_product_analytics_set_exclusion(
  p_user_id uuid,
  p_excluded boolean,
  p_reason text default 'Test or development account'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  clean_reason text := left(trim(coalesce(p_reason, '')), 300);
begin
  if not private.fuel_is_active_platform_admin(caller_id) then
    raise exception 'Fuel Guard product analytics access denied.' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (
    select 1 from auth.users account where account.id = p_user_id and account.deleted_at is null
  ) then
    raise exception 'Fuel Guard user not found.' using errcode = '22023';
  end if;
  if p_excluded and clean_reason = '' then
    raise exception 'An exclusion reason is required.' using errcode = '22023';
  end if;

  if p_excluded then
    insert into private.fuel_product_analytics_exclusions (
      user_id, reason, excluded_by
    ) values (
      p_user_id, clean_reason, caller_id
    ) on conflict (user_id) do update
      set reason = excluded.reason,
          excluded_by = excluded.excluded_by,
          updated_at = now();
  else
    delete from private.fuel_product_analytics_exclusions where user_id = p_user_id;
  end if;

  insert into private.fuel_product_analytics_access_audit (
    actor_user_id, target_user_id, action
  ) values (
    caller_id,
    p_user_id,
    case when p_excluded then 'test_account_excluded' else 'test_account_included' end
  );
  return p_excluded;
end;
$$;

revoke all on function public.fuel_product_analytics_set_exclusion(uuid, boolean, text)
  from public, anon;
grant execute on function public.fuel_product_analytics_set_exclusion(uuid, boolean, text)
  to authenticated;

comment on table public.fuel_product_events is
  'Privacy-minimised explicit product events recorded after the analytics release. Domain tables remain authoritative for Fuel Guard actions.';
comment on table public.fuel_product_attribution is
  'Immutable first-touch acquisition attribution. No health, nutrition-note or reflection content is stored.';
comment on function public.fuel_product_analytics_summary(boolean) is
  'Founder-only activation, engagement, retention, feature and acquisition analytics. Historical core actions are derived from authoritative domain tables.';
comment on function public.fuel_product_analytics_user(uuid) is
  'Founder-only product-support usage summary and privacy-minimised activity timeline for one Fuel Guard account.';
