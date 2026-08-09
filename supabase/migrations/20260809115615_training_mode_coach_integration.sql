-- Training Mode interval planning and direct-Coach read access.
--
-- Quantity snapshots remain athlete-owned. A coach gains SELECT only through
-- the existing active direct relationship predicate; no organisation or
-- aggregate capability receives these rows.

alter table public.fuel_training_mode_presets
  add column intended_interval_minutes integer not null default 30;

update public.fuel_training_mode_presets
set intended_interval_minutes = case event_type when 'hydration' then 20 else 30 end;

alter table public.fuel_training_mode_presets
  add constraint fuel_training_mode_presets_interval_check
    check (intended_interval_minutes between 5 and 360);

alter table public.fuel_training_mode_sessions
  add column fuel_interval_minutes integer not null default 30,
  add column hydration_interval_minutes integer not null default 20,
  add column plan_source text not null default 'derived';

alter table public.fuel_training_mode_sessions
  add constraint fuel_training_mode_sessions_fuel_interval_check
    check (fuel_interval_minutes between 5 and 360),
  add constraint fuel_training_mode_sessions_hydration_interval_check
    check (hydration_interval_minutes between 5 and 360),
  add constraint fuel_training_mode_sessions_plan_source_check
    check (plan_source in ('derived', 'advanced'));

drop policy if exists fuel_training_mode_sessions_select_own
  on public.fuel_training_mode_sessions;
drop policy if exists fuel_training_mode_sessions_select_own_or_active_coach
  on public.fuel_training_mode_sessions;
create policy fuel_training_mode_sessions_select_own_or_active_coach
  on public.fuel_training_mode_sessions
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (select private.fuel_has_direct_athlete_access(user_id))
  );

comment on column public.fuel_training_mode_presets.intended_interval_minutes is
  'Athlete-selected interval for this one-tap preset; used to derive hourly plan rates.';
comment on column public.fuel_training_mode_sessions.plan_source is
  'Whether stored hourly plan rates were derived from preset intervals or explicitly overridden by the athlete.';
comment on policy fuel_training_mode_sessions_select_own_or_active_coach
  on public.fuel_training_mode_sessions is
  'Athletes read their own sessions. Only a currently active direct coach relationship grants read-only session access.';
