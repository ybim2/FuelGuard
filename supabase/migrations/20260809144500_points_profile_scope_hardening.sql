-- Keep additive role labels accurate after organisation revocation and ensure
-- Performance never exposes a coach's out-of-organisation athlete identities.

create or replace function private.fuel_sync_organisation_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    insert into public.fuel_user_role_memberships (user_id, role, source, granted_by)
    values (new.user_id, 'performance', 'organisation', new.invited_by)
    on conflict (user_id, role) where revoked_at is null do nothing;
  elsif not exists (
    select 1 from public.fuel_organisation_members member
    where member.user_id = new.user_id
      and member.status = 'active'
      and member.id <> new.id
  ) then
    update public.fuel_user_role_memberships
    set revoked_at = now()
    where user_id = new.user_id
      and role = 'performance'
      and source = 'organisation'
      and revoked_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_sync_organisation_role() from public, anon, authenticated;

create or replace function public.fuel_performance_people_hierarchy(p_organisation_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  base jsonb;
  enriched jsonb;
  can_manage boolean;
begin
  base := public.fuel_performance_staff_access(p_organisation_id);
  can_manage := private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access');

  select coalesce(jsonb_agg(
    person || jsonb_build_object(
      'jobTitle', profile.job_title,
      'roles', coalesce(roles.items, '[]'::jsonb),
      'assignedAthletes', coalesce(athletes.items, '[]'::jsonb),
      'coachPoints', coalesce(points.total, 0),
      'completedWeeklyReviews', coalesce(review_stats.review_count, 0),
      'currentReviewStreak', coalesce(review_stats.streak_count, 0)
    ) order by coalesce(person->>'displayName', person->>'userId')
  ), '[]'::jsonb) into enriched
  from jsonb_array_elements(coalesce(base->'staff', '[]'::jsonb)) person
  left join public.fuel_user_profiles profile on profile.user_id = (person->>'userId')::uuid
  left join lateral (
    select jsonb_agg(role.role order by role.role) as items
    from public.fuel_user_role_memberships role
    where role.user_id = (person->>'userId')::uuid and role.revoked_at is null
  ) roles on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'athleteId', assigned.athlete_id,
      'displayName', coalesce(athlete_profile.display_name, 'Fuel Guard Athlete')
    ) order by coalesce(athlete_profile.display_name, assigned.athlete_id::text)) as items
    from (
      select relationship.athlete_id
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (person->>'userId')::uuid
        and relationship.status = 'active'
      union
      select scope.athlete_id
      from public.fuel_staff_scopes scope
      where scope.organisation_id = p_organisation_id
        and scope.user_id = (person->>'userId')::uuid
        and scope.scope_type = 'athlete' and scope.status = 'active'
    ) assigned
    left join public.fuel_user_profiles athlete_profile on athlete_profile.user_id = assigned.athlete_id
    where exists (
      select 1 from public.fuel_organisation_athlete_shares share
      where share.organisation_id = p_organisation_id
        and share.athlete_id = assigned.athlete_id
        and share.status = 'active'
    )
      and exists (
        select 1 from public.fuel_team_athletes assignment
        where assignment.organisation_id = p_organisation_id
          and assignment.athlete_id = assigned.athlete_id
          and assignment.status = 'active'
      )
      and (
        can_manage or private.fuel_performance_can_access_athlete(
          p_organisation_id, assigned.athlete_id, null, false
        )
      )
  ) athletes on true
  left join lateral (
    select sum(ledger.points)::integer as total
    from public.fuel_points_ledger ledger
    where ledger.user_id = (person->>'userId')::uuid and ledger.role_context = 'coach'
  ) points on true
  left join lateral (
    with review_weeks as (
      select distinct report.week_start
      from public.fuel_coach_reports report
      where report.coach_id = (person->>'userId')::uuid
        and report.review_kind = 'weekly' and report.status = 'completed'
    ), ranked as (
      select week_start, row_number() over (order by week_start desc) as position
      from review_weeks
    )
    select
      (select count(*)::integer from public.fuel_coach_reports report
       where report.coach_id = (person->>'userId')::uuid
         and report.review_kind = 'weekly' and report.status = 'completed') as review_count,
      coalesce((select count(*)::integer from ranked
        where week_start = (select max(week_start) from ranked) - ((position - 1)::integer * 7)), 0) as streak_count
  ) review_stats on true;

  return jsonb_build_object(
    'status', case when jsonb_array_length(enriched) = 0 then 'empty' else 'ready' end,
    'canManage', coalesce((base->>'canManage')::boolean, false),
    'staff', enriched
  );
end;
$$;

revoke all on function public.fuel_performance_people_hierarchy(uuid) from public, anon;
grant execute on function public.fuel_performance_people_hierarchy(uuid) to authenticated;

comment on function public.fuel_performance_people_hierarchy(uuid) is
  'Returns staff identity and review contribution while intersecting every assigned athlete with active organisation consent, assignment, capability and scope.';
