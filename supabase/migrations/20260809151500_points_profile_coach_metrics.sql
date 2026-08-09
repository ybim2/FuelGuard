-- Expose persisted Coach review totals, streak progress and milestones through
-- the same owner-scoped points profile used by Athlete and Coach surfaces.

create or replace function public.fuel_points_profile(p_time_zone text default 'UTC')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  result jsonb;
  fuel_count integer;
  current_streak integer;
  coach_review_count integer := 0;
  coach_review_streak integer := 0;
  coach_cursor_week date;
  today_key date;
  cursor_key date;
  resolved_zone text := coalesce(nullif(trim(p_time_zone), ''), 'UTC');
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = resolved_zone) then
    resolved_zone := 'UTC';
  end if;
  perform public.fuel_sync_athlete_points(resolved_zone);

  select count(*)::integer into fuel_count from public.fuel_logs log
  where log.user_id = caller_id and log.type in ('fuel', 'fuel_hydration')
    and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid');
  today_key := (now() at time zone resolved_zone)::date;
  cursor_key := today_key;
  if not exists (
    select 1 from public.fuel_logs log where log.user_id = caller_id
      and log.type in ('fuel', 'hydration', 'fuel_hydration')
      and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')
      and (log.logged_at at time zone resolved_zone)::date = cursor_key
  ) then cursor_key := today_key - 1; end if;
  current_streak := 0;
  while exists (
    select 1 from public.fuel_logs log where log.user_id = caller_id
      and log.type in ('fuel', 'hydration', 'fuel_hydration')
      and lower(coalesce(log.source, 'manual')) not in ('test', 'fixture', 'invalid')
      and (log.logged_at at time zone resolved_zone)::date = cursor_key
  ) loop
    current_streak := current_streak + 1;
    cursor_key := cursor_key - 1;
  end loop;

  select count(*)::integer, max(report.week_start)
  into coach_review_count, coach_cursor_week
  from public.fuel_coach_reports report
  where report.coach_id = caller_id and report.review_kind = 'weekly'
    and report.status = 'completed';
  while coach_cursor_week is not null and exists (
    select 1 from public.fuel_coach_reports report
    where report.coach_id = caller_id and report.review_kind = 'weekly'
      and report.status = 'completed' and report.week_start = coach_cursor_week
  ) loop
    coach_review_streak := coach_review_streak + 1;
    coach_cursor_week := coach_cursor_week - 7;
  end loop;

  select jsonb_build_object(
    'totalPoints', coalesce((select sum(ledger.points) from public.fuel_points_ledger ledger where ledger.user_id = caller_id), 0),
    'athletePoints', coalesce((select sum(ledger.points) from public.fuel_points_ledger ledger where ledger.user_id = caller_id and ledger.role_context = 'athlete'), 0),
    'coachPoints', coalesce((select sum(ledger.points) from public.fuel_points_ledger ledger where ledger.user_id = caller_id and ledger.role_context = 'coach'), 0),
    'currentStreak', current_streak,
    'fuelMoments', fuel_count,
    'completedWeeklyReviews', coach_review_count,
    'currentReviewStreak', coach_review_streak,
    'roles', coalesce((select jsonb_agg(role.role order by role.role) from public.fuel_user_role_memberships role where role.user_id = caller_id and role.revoked_at is null), '[]'::jsonb),
    'milestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', definition.event_type,
        'roleContext', definition.role_context,
        'threshold', definition.threshold,
        'points', definition.points,
        'title', definition.title,
        'description', definition.description,
        'currentValue', case
          when definition.event_type like 'athlete_streak_%' then current_streak
          when definition.event_type like 'athlete_fuel_%' then fuel_count
          else null
        end,
        'earnedAt', ledger.occurred_at
      ) order by definition.sort_order)
      from public.fuel_point_milestone_definitions definition
      left join public.fuel_points_ledger ledger
        on ledger.user_id = caller_id and ledger.event_type = definition.event_type
      where definition.role_context = 'athlete'
    ), '[]'::jsonb),
    'coachMilestones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', definition.event_type,
        'roleContext', definition.role_context,
        'threshold', definition.threshold,
        'points', definition.points,
        'title', definition.title,
        'description', definition.description,
        'currentValue', case
          when definition.event_type like 'coach_review_streak_%' then coach_review_streak
          when definition.event_type in ('coach_first_review', 'coach_reviews_10', 'coach_reviews_25') then coach_review_count
          else null
        end,
        'earnedAt', (
          select min(ledger.occurred_at) from public.fuel_points_ledger ledger
          where ledger.user_id = caller_id and ledger.event_type = definition.event_type
        )
      ) order by definition.sort_order)
      from public.fuel_point_milestone_definitions definition
      where definition.role_context = 'coach'
    ), '[]'::jsonb),
    'recentAwards', coalesce((
      select jsonb_agg(recent.item order by recent.created_at desc)
      from (
        select ledger.created_at, jsonb_build_object(
          'id', ledger.id, 'roleContext', ledger.role_context,
          'eventType', ledger.event_type, 'points', ledger.points,
          'reason', ledger.reason, 'occurredAt', ledger.occurred_at
        ) as item
        from public.fuel_points_ledger ledger
        where ledger.user_id = caller_id order by ledger.created_at desc limit 12
      ) recent
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.fuel_points_profile(text) from public, anon;
grant execute on function public.fuel_points_profile(text) to authenticated;
