-- Prevent a participant from repointing an existing sharing relationship to a
-- different coach or athlete. RLS validates the resulting row, so immutable
-- identity columns also need column-level privileges.

revoke update, delete on table public.fuel_coach_athletes from authenticated;

grant update (
  status,
  athlete_label,
  coach_label,
  accepted_at,
  revoked_at,
  updated_at
) on table public.fuel_coach_athletes to authenticated;

drop policy if exists fuel_coach_athletes_delete_by_participant
  on public.fuel_coach_athletes;

comment on table public.fuel_coach_athletes is
  'Coach-athlete sharing audit. coach_id and athlete_id are immutable after insert; participants revoke rather than delete relationships.';

-- A revoked team-roster row must remain manageable by authorised staff so the
-- same athlete can be re-added without deleting the audit row. Direct active
-- coach-athlete sharing is still mandatory.
drop policy if exists fuel_team_athletes_select_authorised
  on public.fuel_team_athletes;
create policy fuel_team_athletes_select_authorised
  on public.fuel_team_athletes for select to authenticated
  using (
    athlete_id = (select auth.uid())
    or (
      (select private.fuel_has_team_access(team_id, 'viewer'))
      and (select private.fuel_has_direct_athlete_access(athlete_id))
    )
  );

drop policy if exists fuel_team_athletes_update_authorised
  on public.fuel_team_athletes;
create policy fuel_team_athletes_update_authorised
  on public.fuel_team_athletes for update to authenticated
  using (
    athlete_id = (select auth.uid())
    or (
      (select private.fuel_has_team_access(team_id, 'contributor'))
      and (select private.fuel_has_direct_athlete_access(athlete_id))
    )
  )
  with check (
    (athlete_id = (select auth.uid()) and status = 'revoked')
    or (
      (select private.fuel_has_team_access(team_id, 'contributor'))
      and (select private.fuel_has_direct_athlete_access(athlete_id))
      and status in ('active', 'revoked')
    )
  );
