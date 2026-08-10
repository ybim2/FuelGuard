begin;
select plan(30);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'impact-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'impact-b@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'impact-coach@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_training_mode_presets (
  id, user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg, intended_interval_minutes
) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'fuel', 'Fuel', 30, 0, 0, 0, 30),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'hydration', 'Hydrate', 0, 200, 250, 0, 20),
  ('a2000000-0000-4000-8000-000000000011', 'a1000000-0000-0000-0000-000000000002', 'fuel', 'Fuel', 25, 0, 0, 0, 30),
  ('a2000000-0000-4000-8000-000000000012', 'a1000000-0000-0000-0000-000000000002', 'hydration', 'Hydrate', 0, 250, 200, 0, 20);

insert into public.fuel_training_mode_sessions (
  id, user_id, title, session_type, status, started_at, ended_at,
  fuel_preset_id, hydration_preset_id,
  fuel_carbs_g, fuel_fluid_ml, fuel_sodium_mg, fuel_caffeine_mg,
  hydration_carbs_g, hydration_fluid_ml, hydration_sodium_mg, hydration_caffeine_mg
) values
  ('a3000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Completed run', 'run', 'completed', '2026-07-01T09:00:00Z', '2026-07-01T10:00:00Z', 'a2000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 30, 0, 0, 0, 0, 200, 250, 0),
  ('a3000000-0000-4000-8000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'Other ride', 'bike', 'completed', '2026-07-02T09:00:00Z', '2026-07-02T10:00:00Z', 'a2000000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000012', 25, 0, 0, 0, 0, 250, 200, 0);

select ok((select relrowsecurity from pg_class where oid = 'public.fuel_performance_metrics'::regclass), 'Performance metrics have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_performance_results'::regclass), 'Performance results have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_training_feedback'::regclass), 'Training feedback has RLS enabled');
select ok(not has_table_privilege('anon', 'public.fuel_performance_metrics', 'SELECT'), 'Anonymous role has no metric access');
select ok(not has_table_privilege('anon', 'public.fuel_performance_results', 'SELECT'), 'Anonymous role has no result access');
select ok(not has_table_privilege('anon', 'public.fuel_training_feedback', 'SELECT'), 'Anonymous role has no feedback access');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.fuel_performance_metrics (id, user_id, sport_type, preset_key, name, unit, measurement_type, direction, display_order) values
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'running', 'running_5k', '5K time', 'time', 'duration_seconds', 'lower', 1),
  ('a4000000-0000-4000-8000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'running', 'bleep_test', 'Bleep test', 'level', 'number', 'higher', 2),
  ('a4000000-0000-4000-8000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'strength', null, 'Broad jump', 'cm', 'number', 'higher', 3);

select results_eq($$select count(*) from public.fuel_performance_metrics$$, array[3::bigint], 'Athlete reads exactly three own active metrics');
select throws_ok(
  $$insert into public.fuel_performance_metrics (user_id, name, unit, direction, display_order) values ('a1000000-0000-0000-0000-000000000001', 'Fourth', 'sec', 'lower', 3)$$,
  '23505', null, 'A fourth active metric cannot reuse an occupied primary slot'
);
select throws_ok(
  $$insert into public.fuel_performance_metrics (user_id, name, unit, direction, display_order) values ('a1000000-0000-0000-0000-000000000001', 'Fourth', 'sec', 'lower', 4)$$,
  '23514', null, 'Primary metric slots are limited to one through three'
);

insert into public.fuel_performance_results (id, user_id, metric_id, observed_on, value, notes) values
  ('a5000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a4000000-0000-4000-8000-000000000001', '2026-06-01', 1720, 'Baseline');
select results_eq($$select value from public.fuel_performance_results where id = 'a5000000-0000-4000-8000-000000000001'$$, array[1720::numeric], 'Athlete reads own performance result');
select lives_ok($$update public.fuel_performance_results set value = 1719 where id = 'a5000000-0000-4000-8000-000000000001'$$, 'Athlete can correct an own manual result');
select throws_ok(
  $$update public.fuel_performance_results set metric_id = 'a4000000-0000-4000-8000-000000000002' where id = 'a5000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Performance result identity cannot be repointed'
);
select throws_ok(
  $$insert into public.fuel_performance_results (user_id, metric_id, observed_on, value, source) values ('a1000000-0000-0000-0000-000000000001', 'a4000000-0000-4000-8000-000000000001', '2026-07-01', 1700, 'garmin')$$,
  '42501', null, 'Authenticated athletes cannot forge a Garmin result source'
);

insert into public.fuel_training_feedback (
  id, user_id, training_mode_session_id, activity_source, session_started_at, session_ended_at,
  energy_rating, session_completion
) values (
  'a6000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'a3000000-0000-4000-8000-000000000001', 'training_mode', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z',
  'strong', 'yes'
);
select results_eq($$select session_started_at, session_ended_at from public.fuel_training_feedback where id = 'a6000000-0000-4000-8000-000000000001'$$, $$values ('2026-07-01T09:00:00Z'::timestamptz, '2026-07-01T10:00:00Z'::timestamptz)$$, 'Feedback copies authoritative completed-session timestamps');
select throws_ok(
  $$update public.fuel_training_feedback set training_mode_session_id = 'a3000000-0000-4000-8000-000000000002' where id = 'a6000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Training feedback identity cannot be repointed'
);
select throws_ok(
  $$delete from public.fuel_training_feedback where id = 'a6000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'Authenticated clients cannot delete feedback history'
);

reset role;
insert into public.fuel_performance_metrics (id, user_id, name, unit, direction, display_order) values
  ('a4000000-0000-4000-8000-000000000011', 'a1000000-0000-0000-0000-000000000002', 'Other FTP', 'W', 'higher', 1);
insert into public.fuel_performance_results (id, user_id, metric_id, observed_on, value) values
  ('a5000000-0000-4000-8000-000000000011', 'a1000000-0000-0000-0000-000000000002', 'a4000000-0000-4000-8000-000000000011', '2026-06-01', 250);
insert into public.fuel_training_feedback (
  id, user_id, training_mode_session_id, activity_source, session_started_at, session_ended_at, energy_rating, session_completion
) values (
  'a6000000-0000-4000-8000-000000000011', 'a1000000-0000-0000-0000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'training_mode', '2026-07-02T09:00:00Z', '2026-07-02T10:00:00Z', 'normal', 'partially'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_performance_metrics where user_id = 'a1000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'Cross-athlete metric direct-ID reads are blocked');
select results_eq($$select count(*) from public.fuel_performance_results where id = 'a5000000-0000-4000-8000-000000000011'$$, array[0::bigint], 'Cross-athlete result direct-ID reads are blocked');
select results_eq($$select count(*) from public.fuel_training_feedback where id = 'a6000000-0000-4000-8000-000000000011'$$, array[0::bigint], 'Cross-athlete feedback direct-ID reads are blocked');
select results_eq(
  $$with changed as (update public.fuel_performance_metrics set name = 'Stolen' where id = 'a4000000-0000-4000-8000-000000000011' returning 1) select count(*) from changed$$,
  array[0::bigint], 'Cross-athlete metric update is blocked'
);
select results_eq(
  $$with changed as (update public.fuel_performance_results set value = 999 where id = 'a5000000-0000-4000-8000-000000000011' returning 1) select count(*) from changed$$,
  array[0::bigint], 'Cross-athlete result update is blocked'
);
select results_eq(
  $$with changed as (update public.fuel_training_feedback set energy_rating = 'strong' where id = 'a6000000-0000-4000-8000-000000000011' returning 1) select count(*) from changed$$,
  array[0::bigint], 'Cross-athlete feedback update is blocked'
);
select throws_ok(
  $$insert into public.fuel_performance_results (user_id, metric_id, observed_on, value) values ('a1000000-0000-0000-0000-000000000001', 'a4000000-0000-4000-8000-000000000011', '2026-07-01', 999)$$,
  '23503', null, 'Composite ownership key blocks cross-athlete metric/result linking'
);
select throws_ok(
  $$insert into public.fuel_training_feedback (user_id, training_mode_session_id, activity_source, session_started_at, session_ended_at, energy_rating, session_completion) values ('a1000000-0000-0000-0000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'training_mode', '2026-07-02T09:00:00Z', '2026-07-02T10:00:00Z', 'strong', 'yes')$$,
  '23514', null, 'Feedback cannot link to another athlete completed session'
);

reset role;
insert into public.fuel_coach_athletes (id, coach_id, athlete_id, status, accepted_at) values
  ('a7000000-0000-4000-8000-000000000001', 'a1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'active', now());
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_performance_metrics where user_id = 'a1000000-0000-0000-0000-000000000001'$$, array[0::bigint], 'Phase 1 does not widen Coach access to athlete metrics');
select results_eq($$select count(*) from public.fuel_performance_results where user_id = 'a1000000-0000-0000-0000-000000000001'$$, array[0::bigint], 'Phase 1 does not widen Coach access to athlete results');
select results_eq($$select count(*) from public.fuel_training_feedback where user_id = 'a1000000-0000-0000-0000-000000000001'$$, array[0::bigint], 'Phase 1 does not widen Coach access to private training feedback');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
update public.fuel_performance_metrics set archived_at = now() where id = 'a4000000-0000-4000-8000-000000000003';
select lives_ok(
  $$insert into public.fuel_performance_metrics (user_id, name, unit, direction, display_order) values ('a1000000-0000-0000-0000-000000000001', 'Replacement', 'sec', 'lower', 3)$$,
  'Archiving a metric frees its slot without deleting history'
);
select results_eq($$select count(*) from public.fuel_performance_results where metric_id = 'a4000000-0000-4000-8000-000000000001'$$, array[1::bigint], 'Changing selected metrics preserves historical result rows');
select results_eq($$select count(*) from public.fuel_performance_metrics where archived_at is null$$, array[3::bigint], 'Athlete still has no more than three active metrics');

reset role;
select * from finish();
rollback;
