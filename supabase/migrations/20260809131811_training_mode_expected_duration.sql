-- Persist the athlete's expected Training Mode duration separately from the
-- actual started/ended timestamps used for completed-session intake rates.
-- Existing RLS policies and table privileges continue to apply unchanged.

alter table public.fuel_training_mode_sessions
  add column estimated_duration_minutes integer not null default 60;

alter table public.fuel_training_mode_sessions
  add constraint fuel_training_mode_sessions_estimated_duration_check
    check (estimated_duration_minutes between 15 and 1440);

comment on column public.fuel_training_mode_sessions.estimated_duration_minutes is
  'Athlete-entered expected session duration used only for planned session amounts; actual rates use started_at and ended_at.';
