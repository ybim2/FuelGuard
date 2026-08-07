begin;
select plan(28);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'active-coach@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pending-coach@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revoked-coach@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'declined-coach@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_coach_athletes (coach_id, athlete_id, status, accepted_at, revoked_at) values
  ('71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000101', 'active', now(), null),
  ('71000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000101', 'pending', null, null),
  ('71000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000101', 'revoked', now(), now()),
  ('71000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000101', 'declined', null, null);

insert into public.fuel_logs (id, user_id, logged_at, type, source) values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000101', '2026-08-07T08:00:00Z', 'fuel', 'manual'),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000101', '2026-08-07T12:00:00Z', 'fuel', 'manual');

insert into public.garmin_activity_summaries (
  id, user_id, device_id, source, source_activity_id, activity_type, started_at, duration_seconds
) values
  ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000101', 'test-device-a', 'garmin_health_api', 'activity-a', 'running', '2026-08-07T09:00:00Z', 3600),
  ('73000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000102', 'test-device-b', 'garmin_health_api', 'activity-b', 'cycling', '2026-08-07T10:00:00Z', 3600);

-- 1-4: both exposed tables have RLS enabled and forced.
select ok(relrowsecurity, 'fuel_daily_contexts has RLS enabled') from pg_class where oid = 'public.fuel_daily_contexts'::regclass;
select ok(relforcerowsecurity, 'fuel_daily_contexts has FORCE RLS enabled') from pg_class where oid = 'public.fuel_daily_contexts'::regclass;
select ok(relrowsecurity, 'fuel_gap_barriers has RLS enabled') from pg_class where oid = 'public.fuel_gap_barriers'::regclass;
select ok(relforcerowsecurity, 'fuel_gap_barriers has FORCE RLS enabled') from pg_class where oid = 'public.fuel_gap_barriers'::regclass;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

-- 5-9: Athlete A owns reads/writes and cannot forge Athlete B.
select lives_ok(
  $$insert into public.fuel_daily_contexts (user_id, context_date, environment_context, training_periods)
    values ('71000000-0000-0000-0000-000000000101', '2026-08-07', 'travel', array['morning','evening'])$$,
  'Athlete A can create own context'
);
select lives_ok(
  $$insert into public.fuel_gap_barriers (
      user_id, gap_key, preceding_fuel_log_id, following_fuel_log_id,
      gap_start, gap_end, target_minutes, actual_minutes, exceeded_minutes,
      barrier_reason, response_status, data_quality_status
    ) values (
      '71000000-0000-0000-0000-000000000101', 'completed:test-one:test-two',
      '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002',
      '2026-08-07T08:00:00Z', '2026-08-07T12:00:00Z', 180, 240, 60,
      'busy', 'answered', 'confirmed'
    )$$,
  'Athlete A can create own barrier'
);
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[1::bigint], 'Athlete A reads own context');
select results_eq($$select count(*) from public.fuel_gap_barriers$$, array[1::bigint], 'Athlete A reads own barrier');
select throws_ok(
  $$insert into public.fuel_daily_contexts (user_id, context_date) values ('71000000-0000-0000-0000-000000000102', '2026-08-07')$$,
  '42501', null, 'Athlete A cannot write Athlete B context'
);

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000102","role":"authenticated"}', true);

-- 10-12: Athlete B has no visibility into Athlete A records and cannot forge a barrier.
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[0::bigint], 'Athlete B cannot read Athlete A context');
select results_eq($$select count(*) from public.fuel_gap_barriers$$, array[0::bigint], 'Athlete B cannot read Athlete A barrier');
select throws_ok(
  $$insert into public.fuel_gap_barriers (
      user_id, gap_key, gap_start, gap_end, target_minutes, actual_minutes, exceeded_minutes,
      barrier_reason, response_status, data_quality_status
    ) values (
      '71000000-0000-0000-0000-000000000101', 'completed:forged:barrier',
      '2026-08-07T08:00:00Z', '2026-08-07T12:00:00Z', 180, 240, 60,
      'forgot', 'answered', 'confirmed'
    )$$,
  '42501', null, 'Athlete B cannot write Athlete A barrier'
);

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 13-18: active Coach has read-only access and RPC returns only the linked athlete.
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[1::bigint], 'Active Coach can read Athlete A context');
select results_eq($$select count(*) from public.fuel_gap_barriers$$, array[1::bigint], 'Active Coach can read Athlete A barrier');
select results_eq(
  $$with changed as (update public.fuel_daily_contexts set environment_context = 'shift' returning 1) select count(*) from changed$$,
  array[0::bigint], 'Coach cannot update athlete context'
);
select results_eq(
  $$with removed as (delete from public.fuel_gap_barriers returning 1) select count(*) from removed$$,
  array[0::bigint], 'Coach cannot delete athlete barrier'
);
select results_eq(
  $$select count(*) from public.fuel_coach_training_activity_timing(
      array['71000000-0000-0000-0000-000000000101'::uuid], '2026-08-07T00:00:00Z', '2026-08-08T00:00:00Z'
    )$$,
  array[1::bigint], 'Active Coach receives linked athlete activity timing'
);
select results_eq(
  $$select count(*) from public.fuel_coach_training_activity_timing(
      array['71000000-0000-0000-0000-000000000101'::uuid, '71000000-0000-0000-0000-000000000102'::uuid],
      '2026-08-07T00:00:00Z', '2026-08-08T00:00:00Z'
    ) where athlete_id = '71000000-0000-0000-0000-000000000102'$$,
  array[0::bigint], 'Knowing Athlete B UUID does not expose activity timing'
);

-- 19-24: non-active relationship states expose nothing.
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[0::bigint], 'Pending Coach cannot read Athlete A context');
select results_eq($$select count(*) from public.fuel_gap_barriers$$, array[0::bigint], 'Pending Coach cannot read Athlete A barrier');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[0::bigint], 'Declined Coach cannot read Athlete A context');
select results_eq($$select count(*) from public.fuel_gap_barriers$$, array[0::bigint], 'Declined Coach cannot read Athlete A barrier');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[0::bigint], 'Revoked Coach cannot read Athlete A context');
select results_eq($$select count(*) from public.fuel_gap_barriers$$, array[0::bigint], 'Revoked Coach cannot read Athlete A barrier');

-- 25-26: anonymous clients have neither table nor RPC privileges.
set local role anon;
select throws_ok($$select count(*) from public.fuel_daily_contexts$$, '42501', null, 'Anonymous caller cannot read context');
select throws_ok(
  $$select count(*) from public.fuel_coach_training_activity_timing(
      array['71000000-0000-0000-0000-000000000101'::uuid], '2026-08-07T00:00:00Z', '2026-08-08T00:00:00Z'
    )$$,
  '42501', null, 'Anonymous caller cannot execute timing RPC'
);

-- 27-28: revoking a formerly active link removes both table and RPC access immediately.
reset role;
update public.fuel_coach_athletes
set status = 'revoked', revoked_at = now(), updated_at = now()
where coach_id = '71000000-0000-0000-0000-000000000001'
  and athlete_id = '71000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_daily_contexts$$, array[0::bigint], 'Revocation immediately removes context access');
select results_eq(
  $$select count(*) from public.fuel_coach_training_activity_timing(
      array['71000000-0000-0000-0000-000000000101'::uuid], '2026-08-07T00:00:00Z', '2026-08-08T00:00:00Z'
    )$$,
  array[0::bigint], 'Revocation immediately removes activity timing access'
);

select * from finish();
rollback;
