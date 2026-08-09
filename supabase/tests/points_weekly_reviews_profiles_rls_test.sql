begin;
select plan(44);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'points-coach-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'points-coach-b@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'points-athlete-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'points-athlete-b@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-4000-8000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'points-athlete-c@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_user_profiles
  (user_id, role, coach_enabled, display_name, first_name, last_name, job_title)
values
  ('a1000000-0000-4000-8000-000000000001', 'coach', true, 'Coach A', 'Coach', 'A', 'Endurance coach'),
  ('a1000000-0000-4000-8000-000000000002', 'coach', true, 'Coach B', 'Coach', 'B', 'Physiotherapist'),
  ('a1000000-0000-4000-8000-000000000101', 'athlete', false, 'Athlete A', 'Athlete', 'A', null),
  ('a1000000-0000-4000-8000-000000000102', 'athlete', false, 'Athlete B', 'Athlete', 'B', null),
  ('a1000000-0000-4000-8000-000000000103', 'athlete', false, 'Athlete C', 'Athlete', 'C', null);

insert into public.fuel_coach_athletes (coach_id, athlete_id, status, accepted_at) values
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000101', 'active', now()),
  ('a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000102', 'active', now()),
  ('a1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000103', 'active', now());

-- 1-3: new exposed tables are RLS protected.
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_user_role_memberships'::regclass), 'Multi-role memberships have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_point_milestone_definitions'::regclass), 'Point definitions have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_points_ledger'::regclass), 'Points ledger has RLS enabled');

-- 4-6: the ledger is readable but not client-mutable.
select ok(has_table_privilege('authenticated', 'public.fuel_points_ledger', 'SELECT'), 'Authenticated users can read RLS-filtered ledger rows');
select ok(not has_table_privilege('authenticated', 'public.fuel_points_ledger', 'INSERT'), 'Authenticated users cannot insert point awards directly');
select ok(not has_table_privilege('authenticated', 'public.fuel_points_ledger', 'UPDATE,DELETE'), 'Authenticated users cannot mutate point awards');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

insert into public.fuel_logs (user_id, logged_at, type, source)
select
  'a1000000-0000-4000-8000-000000000101',
  ('2026-08-07 08:00:00+00'::timestamptz + ((moment - 1) * interval '20 minutes')),
  'fuel', 'manual'
from generate_series(1, 23) moment;
insert into public.fuel_logs (user_id, logged_at, type, source) values
  ('a1000000-0000-4000-8000-000000000101', '2026-08-08 08:00:00+00', 'fuel', 'manual'),
  ('a1000000-0000-4000-8000-000000000101', '2026-08-09 08:00:00+00', 'fuel', 'manual');

-- 7-13: athlete awards are derived, idempotent, and isolated.
select is(public.fuel_sync_athlete_points('UTC'), 2, 'Three-day streak and 25 Fuel milestones are awarded together');
select is(public.fuel_sync_athlete_points('UTC'), 0, 'Repeating athlete award sync is idempotent');
select results_eq($$select count(*) from public.fuel_points_ledger$$, array[2::bigint], 'Athlete sees exactly their two ledger awards');
select results_eq($$select sum(points)::bigint from public.fuel_points_ledger$$, array[50::bigint], 'Athlete points total is the immutable ledger sum');
select results_eq(
  $$select (public.fuel_points_profile('UTC')->>'athletePoints')::integer$$,
  array[50],
  'Points profile reports the server-derived athlete total'
);
select throws_ok(
  $$insert into public.fuel_points_ledger (user_id, role_context, event_type, event_id, points, reason)
    values ('a1000000-0000-4000-8000-000000000101', 'athlete', 'athlete_streak_7', 'forged', 50, 'Forged')$$,
  '42501', null,
  'Athlete cannot forge a ledger award'
);
select results_eq(
  $$select count(*) from public.fuel_user_role_memberships where user_id <> 'a1000000-0000-4000-8000-000000000101'$$,
  array[0::bigint],
  'Role memberships are owner-isolated'
);

-- 14-15: own profile metadata is editable but direct-ID profile writes remain blocked.
select lives_ok(
  $$update public.fuel_user_profiles set first_name = 'Updated', avatar_url = 'https://example.test/a.png'
    where user_id = 'a1000000-0000-4000-8000-000000000101'$$,
  'Athlete can edit own additive profile metadata'
);
select results_eq(
  $$with changed as (
      update public.fuel_user_profiles set first_name = 'Stolen'
      where user_id = 'a1000000-0000-4000-8000-000000000102' returning 1
    ) select count(*) from changed$$,
  array[0::bigint],
  'Athlete cannot edit another profile by direct ID'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

-- 16-19: the same user can hold Athlete and Coach identity, and weekly draft saves are stable.
select results_eq(
  $$select role from public.fuel_user_role_memberships order by role$$,
  $$values ('athlete'::text), ('coach'::text)$$,
  'Coach account retains both Athlete and Coach roles'
);
select lives_ok(
  $$select public.fuel_save_weekly_review(
    'a1000000-0000-4000-8000-000000000101', '2026-08-03',
    'Shared logging was present. No fuel was recorded on one day.', 'Discuss logging barriers.',
    '{"discussionPrompts":["What made logging harder?"]}'::jsonb, null)$$,
  'Active coach can save an authorised weekly review draft'
);
select lives_ok(
  $$select public.fuel_save_weekly_review(
    'a1000000-0000-4000-8000-000000000101', '2026-08-03',
    'Updated evidence summary.', 'Updated note.', '{}'::jsonb, null)$$,
  'Saving the same coach-athlete-week updates the draft'
);
select results_eq(
  $$select count(*) from public.fuel_coach_reports where review_kind = 'weekly' and week_start = '2026-08-03'$$,
  array[1::bigint],
  'Weekly draft identity prevents duplicate records'
);

-- 20-24: completion is atomic and awards once.
select lives_ok(
  $$select public.fuel_complete_weekly_review(
    (select id from public.fuel_coach_reports where athlete_id = 'a1000000-0000-4000-8000-000000000101' and week_start = '2026-08-03'),
    'Review discussed with Athlete A.')$$,
  'Coach can complete an authorised weekly review'
);
select results_eq(
  $$select status, completion_note from public.fuel_coach_reports where athlete_id = 'a1000000-0000-4000-8000-000000000101' and week_start = '2026-08-03'$$,
  $$values ('completed'::text, 'Review discussed with Athlete A.'::text)$$,
  'Completed review status and note persist'
);
select results_eq(
  $$select sum(points)::bigint from public.fuel_points_ledger where role_context = 'coach'$$,
  array[25::bigint],
  'First completed weekly review awards 25 Coach points'
);
select lives_ok(
  $$select public.fuel_complete_weekly_review(
    (select id from public.fuel_coach_reports where athlete_id = 'a1000000-0000-4000-8000-000000000101' and week_start = '2026-08-03'),
    'Repeated request')$$,
  'Repeated completion request is safely idempotent'
);
select results_eq(
  $$select count(*) from public.fuel_points_ledger where role_context = 'coach'$$,
  array[1::bigint],
  'Repeated completion does not duplicate the first-review award'
);

-- 25-27: all-assigned weekly completion is an idempotent roster event.
select lives_ok(
  $$select public.fuel_save_weekly_review(
    'a1000000-0000-4000-8000-000000000102', '2026-08-03',
    'Shared logging evidence for Athlete B.', null, '{}'::jsonb, null)$$,
  'Coach can save the second assigned athlete review'
);
select lives_ok(
  $$select public.fuel_complete_weekly_review(
    (select id from public.fuel_coach_reports where athlete_id = 'a1000000-0000-4000-8000-000000000102' and week_start = '2026-08-03'), null)$$,
  'Completing every assigned athlete closes the weekly roster'
);
select results_eq(
  $$select count(*), sum(points)::bigint from public.fuel_points_ledger where role_context = 'coach'$$,
  $$values (2::bigint, 50::bigint)$$,
  'Roster completion adds one 25-point weekly event'
);

-- 28-30: completed history is immutable through client table operations.
select results_eq(
  $$with changed as (
      update public.fuel_coach_reports set summary = 'Rewritten'
      where review_kind = 'weekly' and status = 'completed' returning 1
    ) select count(*) from changed$$,
  array[0::bigint],
  'Completed weekly reviews cannot be rewritten directly'
);
select results_eq(
  $$with removed as (
      delete from public.fuel_coach_reports
      where review_kind = 'weekly' and status = 'completed' returning 1
    ) select count(*) from removed$$,
  array[0::bigint],
  'Completed weekly reviews cannot be deleted directly'
);
select throws_ok(
  $$select public.fuel_save_weekly_review(
    'a1000000-0000-4000-8000-000000000101', '2026-08-03',
    'Attempted rewrite.', null, '{}'::jsonb, null)$$,
  '23505', null,
  'Completed coach-athlete-week identity cannot be recreated'
);

-- 31-33: total-count and streak awards derive from completed history.
select lives_ok(
  $$do $test$
    declare week_key date;
    declare saved public.fuel_coach_reports;
    begin
      for week_key in select generate_series('2026-06-01'::date, '2026-07-20'::date, interval '7 days')::date loop
        saved := public.fuel_save_weekly_review(
          'a1000000-0000-4000-8000-000000000101', week_key,
          'Historical weekly evidence.', null, '{}'::jsonb, null
        );
        perform public.fuel_complete_weekly_review(saved.id, null);
      end loop;
    end $test$;$$,
  'Coach can complete the historical sequence used for total and streak milestones'
);
select results_eq(
  $$select count(*) from public.fuel_coach_reports where coach_id = 'a1000000-0000-4000-8000-000000000001' and review_kind = 'weekly' and status = 'completed'$$,
  array[10::bigint],
  'Ten completed weekly reviews are retained as history'
);
select results_eq(
  $$select sum(points)::bigint from public.fuel_points_ledger where role_context = 'coach'$$,
  array[150::bigint],
  'Coach total includes first review, roster completion, 4-week streak and 10-review awards'
);
select results_eq(
  $$select (public.fuel_points_profile('UTC')->>'completedWeeklyReviews')::integer$$,
  array[10],
  'Coach points profile reports the persisted completed-review total'
);
select results_eq(
  $$select (public.fuel_points_profile('UTC')->>'currentReviewStreak')::integer$$,
  array[1],
  'Coach points profile reports the current consecutive-week review streak'
);

-- 36-38: participant visibility excludes drafts and unrelated identities.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_coach_reports where review_kind = 'weekly'$$,
  array[9::bigint],
  'Athlete can read only their own completed weekly review history'
);
select results_eq(
  $$select count(*) from public.fuel_points_ledger where role_context = 'coach'$$,
  array[0::bigint],
  'Athlete cannot read Coach ledger rows'
);
select throws_ok(
  $$select public.fuel_complete_weekly_review(
    (select id from public.fuel_coach_reports limit 1), null)$$,
  '42501', null,
  'Athlete cannot complete a Coach review by direct ID'
);

-- 39-41: a coach elsewhere has no cross-team read/write access.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_coach_reports$$,
  array[0::bigint],
  'Unrelated coach cannot read another coach weekly history'
);
select throws_ok(
  $$select public.fuel_save_weekly_review(
    'a1000000-0000-4000-8000-000000000101', '2026-08-03',
    'Cross-team attempt.', null, '{}'::jsonb, null)$$,
  '42501', null,
  'Unrelated coach cannot save a review for another coach athlete'
);
select results_eq(
  $$select count(*) from public.fuel_points_ledger where user_id = 'a1000000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'Unrelated coach cannot read another Coach points ledger'
);

-- 42: weekly identities must use a complete Monday-Sunday period.
select throws_ok(
  $$select public.fuel_save_weekly_review(
    'a1000000-0000-4000-8000-000000000103', '2026-08-04',
    'Invalid week.', null, '{}'::jsonb, null)$$,
  '22023', null,
  'Weekly review rejects a non-Monday week identity'
);

-- 43-44: new foreign keys retain covering indexes for joins and cleanup.
select ok(
  to_regclass('public.fuel_points_ledger_event_type_idx') is not null,
  'Point-event foreign key has a covering index'
);
select ok(
  to_regclass('public.fuel_user_role_memberships_granted_by_idx') is not null,
  'Role grant audit foreign key has a covering index'
);

select * from finish();
rollback;
