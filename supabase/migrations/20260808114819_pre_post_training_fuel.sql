-- Permissioned workout-relative fuelling context.
--
-- Calculated pre/post gaps remain derived in domain code from these source
-- events. This migration only lets an athlete's active, directly assigned
-- coach read the two existing workout sources needed for that derivation.

alter table public.garmin_activity_summaries enable row level security;
alter table public.fuel_demand_blocks enable row level security;

drop policy if exists "Users can read their Garmin activity summaries"
  on public.garmin_activity_summaries;
drop policy if exists garmin_activity_summaries_select_own_or_active_coach
  on public.garmin_activity_summaries;
create policy garmin_activity_summaries_select_own_or_active_coach
  on public.garmin_activity_summaries
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (select private.fuel_has_direct_athlete_access(user_id))
  );

drop policy if exists fuel_demand_blocks_select_own
  on public.fuel_demand_blocks;
drop policy if exists fuel_demand_blocks_select_own_or_active_coach
  on public.fuel_demand_blocks;
create policy fuel_demand_blocks_select_own_or_active_coach
  on public.fuel_demand_blocks
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (select private.fuel_has_direct_athlete_access(user_id))
  );

-- Prevent repeat cross-device imports without deleting historical rows. The
-- ingestion path now checks this key before insert; a non-unique lookup index
-- is safe even if an older database already contains duplicates.
create index if not exists garmin_activity_user_source_activity_lookup_idx
  on public.garmin_activity_summaries (user_id, source, source_activity_id)
  where source_activity_id is not null;

-- Every deterministic Needs Attention type that can be persisted by the
-- current Coach UI must satisfy the database constraint.
alter table public.fuel_coach_attention_actions
  drop constraint if exists fuel_coach_attention_actions_item_type_check,
  add constraint fuel_coach_attention_actions_item_type_check
    check (item_type in (
      'gap_exceeded',
      'gap_approaching',
      'repeated_sleepy',
      'no_logs_today',
      'prolonged_absence',
      'insufficient_data',
      'garmin_reconnect',
      'intervention_review_due',
      'training_exceeded',
      'training_close',
      'training_no_prior_fuel',
      'training_repeated_long_pre_gap',
      'training_missing_post_fuel'
    ));

comment on policy garmin_activity_summaries_select_own_or_active_coach
  on public.garmin_activity_summaries is
  'Athletes can read their own completed Garmin activities. Active directly assigned coaches can read only the athlete rows already shared with them.';

comment on policy fuel_demand_blocks_select_own_or_active_coach
  on public.fuel_demand_blocks is
  'Athletes can read their own demand blocks. Active directly assigned coaches can read training context without receiving write access.';
