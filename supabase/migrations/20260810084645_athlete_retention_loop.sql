-- Athlete retention loop: owner-scoped contextual reminder preferences and a
-- deliberately narrow Coach-review acknowledgement boundary.

create table public.fuel_athlete_nudge_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  maximum_gap_enabled boolean not null default true,
  post_training_enabled boolean not null default true,
  training_mode_enabled boolean not null default true,
  minimum_interval_minutes integer not null default 120,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_athlete_nudge_preferences_interval_check
    check (minimum_interval_minutes between 15 and 1440)
);

alter table public.fuel_athlete_nudge_preferences enable row level security;
revoke all on table public.fuel_athlete_nudge_preferences from public, anon, authenticated;
grant select, insert, update on table public.fuel_athlete_nudge_preferences to authenticated;

create policy fuel_athlete_nudge_preferences_select_owner
  on public.fuel_athlete_nudge_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

create policy fuel_athlete_nudge_preferences_insert_owner
  on public.fuel_athlete_nudge_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy fuel_athlete_nudge_preferences_update_owner
  on public.fuel_athlete_nudge_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table private.fuel_athlete_review_feedback (
  report_id uuid primary key references public.fuel_coach_reports(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  feedback text not null,
  visible_at timestamptz not null default now(),
  retracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_athlete_review_feedback_length_check
    check (char_length(trim(feedback)) between 1 and 600)
);

create index fuel_athlete_review_feedback_coach_idx
  on private.fuel_athlete_review_feedback (coach_id, visible_at desc);
create index fuel_athlete_review_feedback_athlete_idx
  on private.fuel_athlete_review_feedback (athlete_id, visible_at desc)
  where retracted_at is null;

revoke all on table private.fuel_athlete_review_feedback from public, anon, authenticated;

create or replace function private.fuel_prevent_review_feedback_repoint()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.report_id is distinct from old.report_id
    or new.coach_id is distinct from old.coach_id
    or new.athlete_id is distinct from old.athlete_id then
    raise exception 'Review feedback identity cannot be changed.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_prevent_review_feedback_repoint()
  from public, anon, authenticated;

create trigger fuel_athlete_review_feedback_identity_trigger
  before update on private.fuel_athlete_review_feedback
  for each row execute function private.fuel_prevent_review_feedback_repoint();

-- Athletes must not select raw weekly reports: those rows contain internal
-- summary, coach_notes, metrics and organisation context. Coaches retain the
-- same active-direct-relationship access. Athlete acknowledgement is exposed
-- only through fuel_athlete_coach_review_feed below.
drop policy if exists fuel_coach_reports_select_participant on public.fuel_coach_reports;
create policy fuel_coach_reports_select_assigned_coach
  on public.fuel_coach_reports for select to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1 from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_reports.coach_id
        and relationship.athlete_id = fuel_coach_reports.athlete_id
        and relationship.status = 'active'
    )
  );

create or replace function public.fuel_set_athlete_review_feedback(
  p_report_id uuid,
  p_feedback text,
  p_visible boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  report public.fuel_coach_reports;
  cleaned text := nullif(trim(p_feedback), '');
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  select * into report
  from public.fuel_coach_reports existing
  where existing.id = p_report_id
    and existing.coach_id = caller_id
    and existing.review_kind = 'weekly'
    and existing.status = 'completed';
  if report.id is null then
    raise exception 'Completed weekly review not found.' using errcode = '42501';
  end if;
  if coalesce(p_visible, false) and not exists (
    select 1 from public.fuel_coach_athletes relationship
    where relationship.coach_id = caller_id
      and relationship.athlete_id = report.athlete_id
      and relationship.status = 'active'
  ) then
    raise exception 'Coach access denied.' using errcode = '42501';
  end if;
  if coalesce(p_visible, false) and cleaned is null then
    raise exception 'Athlete-visible feedback is required.' using errcode = '22023';
  end if;
  if cleaned is not null and char_length(cleaned) > 600 then
    raise exception 'Athlete-visible feedback must be 600 characters or fewer.' using errcode = '22023';
  end if;

  if not coalesce(p_visible, false) then
    update private.fuel_athlete_review_feedback feedback
    set retracted_at = now(), updated_at = now()
    where feedback.report_id = report.id and feedback.coach_id = caller_id;
    return jsonb_build_object('reportId', report.id, 'visible', false);
  end if;

  insert into private.fuel_athlete_review_feedback
    (report_id, coach_id, athlete_id, feedback, visible_at, retracted_at, updated_at)
  values
    (report.id, caller_id, report.athlete_id, cleaned, now(), null, now())
  on conflict (report_id) do update
  set feedback = excluded.feedback,
      visible_at = now(),
      retracted_at = null,
      updated_at = now();

  return jsonb_build_object('reportId', report.id, 'visible', true);
end;
$$;

revoke all on function public.fuel_set_athlete_review_feedback(uuid, text, boolean)
  from public, anon;
grant execute on function public.fuel_set_athlete_review_feedback(uuid, text, boolean)
  to authenticated;

create or replace function public.fuel_complete_weekly_review_with_feedback(
  p_report_id uuid,
  p_completion_note text default null,
  p_athlete_feedback text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  cleaned_feedback text := nullif(trim(p_athlete_feedback), '');
begin
  result := public.fuel_complete_weekly_review(p_report_id, p_completion_note);
  if cleaned_feedback is not null then
    perform public.fuel_set_athlete_review_feedback(p_report_id, cleaned_feedback, true);
    result := result || jsonb_build_object('athleteFeedbackVisible', true);
  else
    result := result || jsonb_build_object('athleteFeedbackVisible', false);
  end if;
  return result;
end;
$$;

revoke all on function public.fuel_complete_weekly_review_with_feedback(uuid, text, text)
  from public, anon;
grant execute on function public.fuel_complete_weekly_review_with_feedback(uuid, text, text)
  to authenticated;

create or replace function public.fuel_athlete_coach_review_feed(p_limit integer default 8)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  item_limit integer := least(20, greatest(1, coalesce(p_limit, 8)));
  items jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(feed.item order by feed.completed_at desc), '[]'::jsonb)
  into items
  from (
    select report.completed_at, jsonb_build_object(
      'reportId', report.id,
      'weekStart', report.week_start,
      'weekEnd', report.week_end,
      'completedAt', report.completed_at,
      'coachName', coalesce(nullif(trim(profile.display_name), ''), 'Your Fuel Guard coach'),
      'visibleFeedback', case
        when feedback.retracted_at is null then feedback.feedback
        else null
      end,
      'feedbackVisibleAt', case
        when feedback.retracted_at is null then feedback.visible_at
        else null
      end
    ) as item
    from public.fuel_coach_reports report
    join public.fuel_coach_athletes relationship
      on relationship.coach_id = report.coach_id
      and relationship.athlete_id = report.athlete_id
      and relationship.status = 'active'
    left join public.fuel_user_profiles profile on profile.user_id = report.coach_id
    left join private.fuel_athlete_review_feedback feedback on feedback.report_id = report.id
    where report.athlete_id = caller_id
      and report.review_kind = 'weekly'
      and report.status = 'completed'
      and report.completed_at is not null
    order by report.completed_at desc
    limit item_limit
  ) feed;

  return jsonb_build_object('items', items);
end;
$$;

revoke all on function public.fuel_athlete_coach_review_feed(integer)
  from public, anon;
grant execute on function public.fuel_athlete_coach_review_feed(integer)
  to authenticated;

comment on table public.fuel_athlete_nudge_preferences is
  'Owner-scoped categories for contextual Athlete prompts; no generic reminder schedule or push token is stored here.';
comment on function public.fuel_athlete_coach_review_feed(integer) is
  'Returns only weekly-review acknowledgement and explicitly published Athlete feedback for active direct Coach relationships.';
