-- Enforce one persisted Garmin workout per athlete and upstream activity.
--
-- Connect IQ-local history currently has no source activity ID, so its stable
-- fallback identity is start time, normalized activity type and duration. The
-- device ID is intentionally excluded: two connected watches can expose the
-- same Garmin Connect history item.

with ranked_source_activities as (
  select
    id,
    row_number() over (
      partition by user_id, source, source_activity_id
      order by received_at, created_at, id
    ) as duplicate_position
  from public.garmin_activity_summaries
  where source_activity_id is not null
)
delete from public.garmin_activity_summaries as activity
using ranked_source_activities as ranked
where activity.id = ranked.id
  and ranked.duplicate_position > 1;

with ranked_local_summaries as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        source,
        started_at,
        lower(btrim(activity_type)),
        duration_seconds
      order by received_at, created_at, id
    ) as duplicate_position
  from public.garmin_activity_summaries
  where source_activity_id is null
)
delete from public.garmin_activity_summaries as activity
using ranked_local_summaries as ranked
where activity.id = ranked.id
  and ranked.duplicate_position > 1;

create unique index if not exists garmin_activity_user_source_identity_idx
  on public.garmin_activity_summaries (user_id, source, source_activity_id)
  where source_activity_id is not null;

create unique index if not exists garmin_activity_user_summary_identity_idx
  on public.garmin_activity_summaries (
    user_id,
    source,
    started_at,
    (lower(btrim(activity_type))),
    duration_seconds
  )
  where source_activity_id is null;

-- The bootstrap schema previously enforced these exact identities under older
-- names. Keep only the canonical indexes above so each write maintains one
-- unique index per identity instead of an identical pair.
drop index if exists public.garmin_activity_user_source_activity_idx;
drop index if exists public.garmin_activity_user_started_type_duration_idx;

comment on index public.garmin_activity_user_source_identity_idx is
  'Race-safe Garmin workout deduplication by athlete, provider and upstream activity ID.';

comment on index public.garmin_activity_user_summary_identity_idx is
  'Race-safe Connect IQ-local workout deduplication across devices when Garmin supplies no activity ID.';
