-- Advisor hardening for the team-session read path. Public RPCs now run with
-- caller privileges; the minimum membership rows they need are exposed through
-- explicit self/staff RLS rather than a public SECURITY DEFINER boundary.

create or replace function private.fuel_has_team_membership_period(p_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_team_athlete_membership_periods period
      where period.team_id = p_team_id
        and period.athlete_id = (select auth.uid())
    );
$$;

create or replace function private.fuel_is_team_session_athlete(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_training_sessions training_session
      join public.fuel_team_athlete_membership_periods period
        on period.team_id = training_session.team_id
       and period.organisation_id = training_session.organisation_id
       and period.athlete_id = (select auth.uid())
       and period.joined_at <= training_session.ends_at
       and (period.left_at is null or period.left_at >= training_session.starts_at)
      where training_session.id = p_session_id
        and training_session.audience_scope = 'team'
    );
$$;

revoke all on function private.fuel_has_team_membership_period(uuid) from public, anon;
revoke all on function private.fuel_is_team_session_athlete(uuid) from public, anon;
grant execute on function private.fuel_has_team_membership_period(uuid) to authenticated;
grant execute on function private.fuel_is_team_session_athlete(uuid) to authenticated;

grant select on table public.fuel_team_athlete_membership_periods to authenticated;

create policy fuel_team_athlete_membership_periods_select_authorised
  on public.fuel_team_athlete_membership_periods for select to authenticated
  using (
    athlete_id = (select auth.uid())
    or (select private.fuel_can_access_team_athlete(team_id, athlete_id, 'viewer'))
  );

drop policy if exists fuel_teams_select_staff on public.fuel_teams;
create policy fuel_teams_select_staff
  on public.fuel_teams for select to authenticated
  using (
    (select private.fuel_has_team_access(id, 'viewer'))
    or (select private.fuel_can_manage_organisation(organisation_id))
    or (select private.fuel_has_team_membership_period(id))
  );

drop policy if exists fuel_training_sessions_select_authorised
  on public.fuel_training_sessions;
create policy fuel_training_sessions_select_authorised
  on public.fuel_training_sessions for select to authenticated
  using (
    (select private.fuel_has_team_access(team_id, 'viewer'))
    or (select private.fuel_is_training_session_athlete(id))
    or (select private.fuel_is_team_session_athlete(id))
  );

alter function public.fuel_athlete_team_sessions(timestamptz, timestamptz)
  security invoker;
alter function public.fuel_team_session_context(timestamptz, timestamptz)
  security invoker;

create index if not exists fuel_team_athlete_membership_periods_team_fk_idx
  on public.fuel_team_athlete_membership_periods (team_id, organisation_id);

comment on policy fuel_team_athlete_membership_periods_select_authorised
  on public.fuel_team_athlete_membership_periods is
  'Athletes see only their own tenure history. Staff visibility still requires team scope, active membership and direct Athlete sharing.';
comment on function public.fuel_athlete_team_sessions(timestamptz, timestamptz) is
  'SECURITY INVOKER Athlete schedule feed. Team, session and membership rows remain filtered by caller RLS; coach notes are excluded.';
comment on function public.fuel_team_session_context(timestamptz, timestamptz) is
  'SECURITY INVOKER Coach pre/post context. Every athlete row remains protected by active team scope and direct Coach-Athlete sharing.';
