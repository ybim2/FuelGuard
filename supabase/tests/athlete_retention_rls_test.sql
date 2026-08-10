begin;
select plan(34);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retention-coach-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('b2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retention-coach-b@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('b2000000-0000-4000-8000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'retention-athlete-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('b2000000-0000-4000-8000-000000000102', '00000000-0000-0000-8000-000000000000', 'authenticated', 'authenticated', 'retention-athlete-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_user_profiles
  (user_id, role, coach_enabled, display_name, first_name, last_name)
values
  ('b2000000-0000-4000-8000-000000000001', 'coach', true, 'Retention Coach A', 'Retention', 'Coach A'),
  ('b2000000-0000-4000-8000-000000000002', 'coach', true, 'Retention Coach B', 'Retention', 'Coach B'),
  ('b2000000-0000-4000-8000-000000000101', 'athlete', false, 'Retention Athlete A', 'Retention', 'Athlete A'),
  ('b2000000-0000-4000-8000-000000000102', 'athlete', false, 'Retention Athlete B', 'Retention', 'Athlete B');

insert into public.fuel_coach_athletes (coach_id, athlete_id, status, accepted_at) values
  ('b2000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000101', 'active', now()),
  ('b2000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000102', 'active', now());

-- 1-3: the preference table is owner-scoped and not client-deletable.
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_athlete_nudge_preferences'::regclass), 'Nudge preferences have RLS enabled');
select ok(has_table_privilege('authenticated', 'public.fuel_athlete_nudge_preferences', 'SELECT,INSERT,UPDATE'), 'Authenticated Athletes can manage owner-scoped preferences');
select ok(not has_table_privilege('authenticated', 'public.fuel_athlete_nudge_preferences', 'DELETE'), 'Authenticated Athletes cannot delete preference rows');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000101","role":"authenticated"}', true);

-- 4-7: own preference persistence works; direct-ID writes do not.
select lives_ok(
  $$insert into public.fuel_athlete_nudge_preferences
      (user_id, maximum_gap_enabled, post_training_enabled, training_mode_enabled)
    values ('b2000000-0000-4000-8000-000000000101', false, true, false)$$,
  'Athlete can create own contextual reminder preferences'
);
select results_eq(
  $$select maximum_gap_enabled, post_training_enabled, training_mode_enabled
    from public.fuel_athlete_nudge_preferences$$,
  $$values (false, true, false)$$,
  'Own reminder categories persist exactly'
);
select throws_ok(
  $$insert into public.fuel_athlete_nudge_preferences (user_id)
    values ('b2000000-0000-4000-8000-000000000102')$$,
  '42501', null,
  'Athlete cannot create another Athlete preference row by direct ID'
);
select throws_ok(
  $$update public.fuel_athlete_nudge_preferences
    set user_id = 'b2000000-0000-4000-8000-000000000102'
    where user_id = 'b2000000-0000-4000-8000-000000000101'$$,
  '42501', null,
  'Athlete cannot repoint preference ownership'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_athlete_nudge_preferences$$,
  array[0::bigint],
  'Another Athlete cannot see owner preference rows'
);

-- 9-12: an active Coach can complete once with explicit feedback; retries stay idempotent.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.fuel_save_weekly_review(
    'b2000000-0000-4000-8000-000000000101', '2026-08-03',
    'INTERNAL summary must not cross the Athlete feed.',
    'INTERNAL Coach note must stay private.', '{}'::jsonb, null)$$,
  'Active Coach can save the weekly review used by the feedback test'
);
select lives_ok(
  $$select public.fuel_complete_weekly_review_with_feedback(
    (select id from public.fuel_coach_reports
      where athlete_id = 'b2000000-0000-4000-8000-000000000101' and week_start = '2026-08-03'),
    'INTERNAL completion note', 'Strong consistency across the recorded week.')$$,
  'Coach can atomically complete a review with explicit Athlete feedback'
);
select set_config(
  'fuelguard.test_report_id',
  (select id::text from public.fuel_coach_reports
    where athlete_id = 'b2000000-0000-4000-8000-000000000101' and week_start = '2026-08-03'),
  true
);
select lives_ok(
  $$select public.fuel_complete_weekly_review_with_feedback(
    (select id from public.fuel_coach_reports
      where athlete_id = 'b2000000-0000-4000-8000-000000000101' and week_start = '2026-08-03'),
    'Repeated completion', 'Strong consistency across the recorded week.')$$,
  'Repeated completion and feedback publication are idempotent'
);
select results_eq(
  $$select count(*) from public.fuel_points_ledger
    where user_id = 'b2000000-0000-4000-8000-000000000001' and event_type = 'coach_first_review'$$,
  array[1::bigint],
  'Repeated completion does not duplicate the Coach points award'
);

-- 13-15: private feedback identity is fixed and never table-readable by clients.
reset role;
select results_eq(
  $$select count(*) from private.fuel_athlete_review_feedback
    where athlete_id = 'b2000000-0000-4000-8000-000000000101'$$,
  array[1::bigint],
  'Exactly one private feedback record backs the completed review'
);
select throws_ok(
  $$update private.fuel_athlete_review_feedback
    set athlete_id = 'b2000000-0000-4000-8000-000000000102'
    where athlete_id = 'b2000000-0000-4000-8000-000000000101'$$,
  '22023', 'Review feedback identity cannot be changed.',
  'Feedback identity cannot be repointed'
);
select ok(not has_table_privilege('authenticated', 'private.fuel_athlete_review_feedback', 'SELECT,INSERT,UPDATE,DELETE'), 'Authenticated clients have no private feedback table privileges');

-- 16-21: Athlete feed contains acknowledgement and explicit feedback only.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_coach_reports$$,
  array[0::bigint],
  'Athlete cannot select raw Coach report rows'
);
select results_eq(
  $$select jsonb_array_length(public.fuel_athlete_coach_review_feed(8)->'items')$$,
  array[1],
  'Athlete sees one completed review acknowledgement for the active Coach'
);
select results_eq(
  $$select public.fuel_athlete_coach_review_feed(8)#>>'{items,0,visibleFeedback}'$$,
  array['Strong consistency across the recorded week.'::text],
  'Only explicitly marked Athlete feedback is returned'
);
select results_eq(
  $$select public.fuel_athlete_coach_review_feed(8)#>>'{items,0,coachName}'$$,
  array['Retention Coach A'::text],
  'Athlete feed identifies the active Coach'
);
select ok(public.fuel_athlete_coach_review_feed(8)::text not like '%INTERNAL%', 'Internal summary, note and completion fields do not cross the feed');
select throws_ok(
  $$select public.fuel_set_athlete_review_feedback(
    current_setting('fuelguard.test_report_id')::uuid,
    'Forged Athlete feedback', true)$$,
  '42501', null,
  'Athlete cannot publish feedback through a direct-ID RPC attack'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000102","role":"authenticated"}', true);
select results_eq(
  $$select jsonb_array_length(public.fuel_athlete_coach_review_feed(8)->'items')$$,
  array[0],
  'Athlete without this Coach relationship sees no acknowledgement or feedback'
);

-- 23-25: a Coach elsewhere cannot read, publish or complete by direct ID.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_coach_reports$$, array[0::bigint], 'Unrelated Coach cannot read another Coach review');
select throws_ok(
  $$select public.fuel_set_athlete_review_feedback(
    current_setting('fuelguard.test_report_id')::uuid, 'Cross-team feedback', true)$$,
  '42501', null,
  'Unrelated Coach cannot publish feedback by direct ID'
);
select throws_ok(
  $$select public.fuel_complete_weekly_review_with_feedback(
    current_setting('fuelguard.test_report_id')::uuid, null, 'Cross-team feedback')$$,
  '42501', null,
  'Unrelated Coach cannot complete a review by direct ID'
);

-- 26-30: revocation removes the feed; republishing requires renewed access.
reset role;
update public.fuel_coach_athletes set status = 'revoked', revoked_at = now()
where coach_id = 'b2000000-0000-4000-8000-000000000001'
  and athlete_id = 'b2000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select results_eq(
  $$select jsonb_array_length(public.fuel_athlete_coach_review_feed(8)->'items')$$,
  array[0],
  'Removed Coach relationship immediately removes review acknowledgement and feedback'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.fuel_set_athlete_review_feedback(
    current_setting('fuelguard.test_report_id')::uuid,
    'Should remain blocked', true)$$,
  '42501', null,
  'Removed Coach cannot republish Athlete feedback'
);
select lives_ok(
  $$select public.fuel_set_athlete_review_feedback(
    current_setting('fuelguard.test_report_id')::uuid,
    null, false)$$,
  'Original Coach can retract previously shared feedback after relationship removal'
);
reset role;
update public.fuel_coach_athletes set status = 'active', revoked_at = null
where coach_id = 'b2000000-0000-4000-8000-000000000001'
  and athlete_id = 'b2000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select is(
  public.fuel_athlete_coach_review_feed(8)#>>'{items,0,visibleFeedback}',
  null,
  'Reactivated relationship restores acknowledgement without retracted feedback'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.fuel_set_athlete_review_feedback(
    current_setting('fuelguard.test_report_id')::uuid,
    'New explicitly shared feedback', true)$$,
  'Active Coach can explicitly republish Athlete feedback'
);

-- 31-34: owner isolation and function grants cover final denial paths.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-4000-8000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"b2000000-0000-4000-8000-000000000101","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_athlete_nudge_preferences where user_id <> 'b2000000-0000-4000-8000-000000000101'$$,
  array[0::bigint],
  'Preference reads remain owner-isolated after Coach workflow activity'
);
reset role;
select ok(not has_function_privilege('anon', 'public.fuel_athlete_coach_review_feed(integer)', 'EXECUTE'), 'Anon cannot execute the Athlete review feed');
select ok(not has_function_privilege('anon', 'public.fuel_set_athlete_review_feedback(uuid,text,boolean)', 'EXECUTE'), 'Anon cannot publish Athlete review feedback');
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$select public.fuel_athlete_coach_review_feed(8)$$,
  '42501', null,
  'Unauthenticated callers cannot read the review feed'
);

select * from finish();
rollback;
