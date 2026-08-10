-- Preserve completed team-session history. Legacy assigned schedules retain
-- their existing update behaviour, while team-wide schedules become immutable
-- once their start time has passed.

drop policy if exists fuel_training_sessions_update_contributor
  on public.fuel_training_sessions;
create policy fuel_training_sessions_update_contributor
  on public.fuel_training_sessions for update to authenticated
  using (
    (select private.fuel_has_team_access(team_id, 'contributor'))
    and (audience_scope <> 'team' or starts_at > now())
  )
  with check (
    (select private.fuel_has_team_access(team_id, 'contributor'))
    and (saved_group_id is null or (select private.fuel_can_manage_saved_group(saved_group_id)))
    and (audience_scope <> 'team' or starts_at > now())
  );

comment on policy fuel_training_sessions_update_contributor
  on public.fuel_training_sessions is
  'Contributors may edit or cancel future team-wide sessions. Completed team-session history is immutable.';
