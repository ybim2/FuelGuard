begin;
select plan(14);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('71000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'training-coach@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'training-athlete-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('71000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'training-athlete-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_user_profiles (user_id, role, coach_enabled, display_name) values
  ('71000000-0000-0000-0000-000000000001', 'coach', true, 'Training Coach'),
  ('71000000-0000-0000-0000-000000000101', 'athlete', false, 'Training Athlete A'),
  ('71000000-0000-0000-0000-000000000102', 'athlete', false, 'Training Athlete B');

insert into public.fuel_coach_athletes (id, coach_id, athlete_id, status, accepted_at) values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000101', 'active', now());

insert into public.garmin_activity_summaries (
  id, user_id, device_id, source, source_activity_id, activity_type, started_at, duration_seconds
) values
  ('73000000-0000-0000-0000-000000000101', '71000000-0000-0000-0000-000000000101', 'watch-a', 'garmin_connect_iq_local', 'activity-a', 'run', '2026-08-08T10:00:00Z', 3600),
  ('73000000-0000-0000-0000-000000000102', '71000000-0000-0000-0000-000000000102', 'watch-b', 'garmin_connect_iq_local', 'activity-b', 'run', '2026-08-08T10:00:00Z', 3600);

insert into public.fuel_demand_blocks (
  id, user_id, date, type, start_time, end_time, title, session_type
) values
  ('74000000-0000-0000-0000-000000000101', '71000000-0000-0000-0000-000000000101', '2026-08-08', 'training', '2026-08-08T10:00:00Z', '2026-08-08T11:00:00Z', 'Manual A', 'run'),
  ('74000000-0000-0000-0000-000000000102', '71000000-0000-0000-0000-000000000102', '2026-08-08', 'training', '2026-08-08T10:00:00Z', '2026-08-08T11:00:00Z', 'Manual B', 'run');

select ok((select relrowsecurity from pg_class where oid = 'public.garmin_activity_summaries'::regclass), 'Garmin activities have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_demand_blocks'::regclass), 'Manual demand blocks have RLS enabled');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

select results_eq($$select count(*) from public.garmin_activity_summaries where user_id = '71000000-0000-0000-0000-000000000101'$$, array[1::bigint], 'Athlete reads own Garmin workout');
select results_eq($$select count(*) from public.fuel_demand_blocks where user_id = '71000000-0000-0000-0000-000000000101'$$, array[1::bigint], 'Athlete reads own manual workout');
select results_eq($$select count(*) from public.garmin_activity_summaries where id = '73000000-0000-0000-0000-000000000102'$$, array[0::bigint], 'Athlete direct-ID attack cannot read another Garmin workout');
select results_eq($$select count(*) from public.fuel_demand_blocks where id = '74000000-0000-0000-0000-000000000102'$$, array[0::bigint], 'Athlete direct-ID attack cannot read another manual workout');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$select count(*) from public.garmin_activity_summaries where user_id = '71000000-0000-0000-0000-000000000101'$$, array[1::bigint], 'Active coach reads assigned athlete Garmin workout');
select results_eq($$select count(*) from public.fuel_demand_blocks where user_id = '71000000-0000-0000-0000-000000000101'$$, array[1::bigint], 'Active coach reads assigned athlete manual workout');
select results_eq($$select count(*) from public.garmin_activity_summaries where id = '73000000-0000-0000-0000-000000000102'$$, array[0::bigint], 'Coach direct-ID attack cannot read unassigned Garmin workout');
select results_eq($$select count(*) from public.fuel_demand_blocks where id = '74000000-0000-0000-0000-000000000102'$$, array[0::bigint], 'Coach direct-ID attack cannot read unassigned manual workout');

select throws_ok(
  $$insert into public.fuel_demand_blocks (user_id, date, type, start_time, end_time, session_type)
    values ('71000000-0000-0000-0000-000000000101', '2026-08-09', 'training', '2026-08-09T10:00:00Z', '2026-08-09T11:00:00Z', 'run')$$,
  '42501', null,
  'Coach cannot fabricate a manual workout for an athlete'
);
select results_eq(
  $$with changed as (
      update public.fuel_demand_blocks set title = 'Changed by coach'
      where id = '74000000-0000-0000-0000-000000000101' returning 1
    ) select count(*) from changed$$,
  array[0::bigint],
  'Coach cannot update an athlete manual workout'
);

reset role;
update public.fuel_coach_athletes
set status = 'revoked', revoked_at = now()
where id = '72000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$select count(*) from public.garmin_activity_summaries where user_id = '71000000-0000-0000-0000-000000000101'$$, array[0::bigint], 'Revocation immediately removes Garmin workout access');
select results_eq($$select count(*) from public.fuel_demand_blocks where user_id = '71000000-0000-0000-0000-000000000101'$$, array[0::bigint], 'Revocation immediately removes manual workout access');

select * from finish();
rollback;
