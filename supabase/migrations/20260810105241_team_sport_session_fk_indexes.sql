-- Cover the existing composite session foreign keys used by team-session
-- creation and deletion cascades.

create index if not exists fuel_training_sessions_team_fk_idx
  on public.fuel_training_sessions (team_id, organisation_id);

create index if not exists fuel_training_sessions_group_fk_idx
  on public.fuel_training_sessions (saved_group_id, organisation_id, team_id);
