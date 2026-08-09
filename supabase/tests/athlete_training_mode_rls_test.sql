begin;
select plan(20);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('91000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'training-mode-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('91000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'training-mode-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

select ok((select relrowsecurity from pg_class where oid = 'public.fuel_training_mode_presets'::regclass), 'Training presets have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_training_mode_sessions'::regclass), 'Training sessions have RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_milestone_achievements'::regclass), 'Milestone acknowledgements have RLS enabled');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.fuel_training_mode_presets (
  id, user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg
) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-0000-0000-000000000001', 'fuel', 'Fuel', 30, 0, 0, 0),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-0000-0000-000000000001', 'hydration', 'Hydrate', 10, 200, 250, 0);

insert into public.fuel_training_mode_sessions (
  id, user_id, title, session_type, status, started_at,
  fuel_preset_id, hydration_preset_id,
  fuel_carbs_g, fuel_fluid_ml, fuel_sodium_mg, fuel_caffeine_mg,
  hydration_carbs_g, hydration_fluid_ml, hydration_sodium_mg, hydration_caffeine_mg,
  plan_carbs_g_per_hour, plan_fluid_ml_per_hour, plan_sodium_mg_per_hour
) values (
  '93000000-0000-4000-8000-000000000001', '91000000-0000-0000-0000-000000000001',
  'Long ride', 'bike', 'active', '2026-08-09T08:00:00Z',
  '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002',
  30, 0, 0, 0, 10, 200, 250, 0, 60, 500, 600
);

select results_eq($$select count(*) from public.fuel_training_mode_presets$$, array[2::bigint], 'Athlete reads own Training presets');
select results_eq($$select count(*) from public.fuel_training_mode_sessions$$, array[1::bigint], 'Athlete reads own active Training session');

insert into public.fuel_logs (
  id, user_id, logged_at, type, source,
  training_mode_session_id, training_mode_preset_id,
  carbs_g, fluid_ml, sodium_mg, caffeine_mg
) values (
  '94000000-0000-4000-8000-000000000001', '91000000-0000-0000-0000-000000000001',
  '2026-08-09T08:30:00Z', 'hydration', 'manual',
  '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002',
  10, 200, 250, 0
);

select results_eq(
  $$select carbs_g, fluid_ml, sodium_mg, caffeine_mg from public.fuel_logs where id = '94000000-0000-4000-8000-000000000001'$$,
  $$values (10, 200, 250, 0)$$,
  'Training Hydrate preserves mixed carbohydrate, fluid and sodium quantities in canonical units'
);

insert into public.fuel_logs (id, user_id, logged_at, type, source) values
  ('94000000-0000-4000-8000-000000000002', '91000000-0000-0000-0000-000000000001', '2026-08-09T09:00:00Z', 'fuel', 'manual');
select results_eq(
  $$select count(*) from public.fuel_logs where id = '94000000-0000-4000-8000-000000000002' and training_mode_session_id is null and carbs_g is null and fluid_ml is null and sodium_mg is null and caffeine_mg is null$$,
  array[1::bigint],
  'Ordinary Daily Mode logs remain quantity-free'
);

select throws_ok(
  $$insert into public.fuel_training_mode_presets (user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg, is_default)
    values ('91000000-0000-0000-0000-000000000001', 'fuel', 'Unsafe caffeine', 0, 0, 0, 1001, false)$$,
  '23514', null,
  'Unreasonable caffeine input is rejected in milligrams'
);
select throws_ok(
  $$insert into public.fuel_logs (user_id, logged_at, type, source, training_mode_session_id, training_mode_preset_id, carbs_g, fluid_ml, sodium_mg, caffeine_mg)
    values ('91000000-0000-0000-0000-000000000001', now(), 'fuel', 'manual', '93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 30, 0, -1, 0)$$,
  '23514', null,
  'Negative sodium input is rejected in milligrams'
);
select throws_ok(
  $$insert into public.fuel_training_mode_sessions (
      user_id, title, session_type, status, started_at, fuel_preset_id, hydration_preset_id,
      fuel_carbs_g, fuel_fluid_ml, fuel_sodium_mg, fuel_caffeine_mg,
      hydration_carbs_g, hydration_fluid_ml, hydration_sodium_mg, hydration_caffeine_mg
    ) values (
      '91000000-0000-0000-0000-000000000001', 'Second ride', 'bike', 'active', now(),
      '92000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000002',
      30, 0, 0, 0, 10, 200, 250, 0
    )$$,
  '23505', null,
  'Only one active Training Mode session is allowed per athlete'
);

insert into public.fuel_milestone_achievements (user_id, category, threshold, achieved_at)
values ('91000000-0000-0000-0000-000000000001', 'streak', 5, '2026-08-09T09:00:00Z');
select results_eq($$select count(*) from public.fuel_milestone_achievements$$, array[1::bigint], 'Athlete reads own milestone acknowledgement state');
select throws_ok(
  $$insert into public.fuel_milestone_achievements (user_id, category, threshold)
    values ('91000000-0000-0000-0000-000000000002', 'fuel', 50)$$,
  '42501', null,
  'Athlete cannot create milestone state for another user'
);

select lives_ok(
  $$update public.fuel_training_mode_sessions
    set status = 'completed', ended_at = '2026-08-09T10:00:00Z', updated_at = now()
    where id = '93000000-0000-4000-8000-000000000001'$$,
  'Athlete can explicitly end own Training Mode session'
);
select results_eq(
  $$select status from public.fuel_training_mode_sessions where id = '93000000-0000-4000-8000-000000000001'$$,
  array['completed'::text],
  'Completed Training Mode state persists'
);

reset role;
insert into public.fuel_training_mode_presets (
  id, user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg
) values
  ('92000000-0000-4000-8000-000000000011', '91000000-0000-0000-0000-000000000002', 'fuel', 'Other fuel', 25, 0, 0, 0),
  ('92000000-0000-4000-8000-000000000012', '91000000-0000-0000-0000-000000000002', 'hydration', 'Other hydrate', 0, 300, 200, 0);
insert into public.fuel_training_mode_sessions (
  id, user_id, title, session_type, status, started_at,
  fuel_preset_id, hydration_preset_id,
  fuel_carbs_g, fuel_fluid_ml, fuel_sodium_mg, fuel_caffeine_mg,
  hydration_carbs_g, hydration_fluid_ml, hydration_sodium_mg, hydration_caffeine_mg
) values (
  '93000000-0000-4000-8000-000000000002', '91000000-0000-0000-0000-000000000002',
  'Other run', 'run', 'active', now(),
  '92000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000012',
  25, 0, 0, 0, 0, 300, 200, 0
);
insert into public.fuel_milestone_achievements (user_id, category, threshold)
values ('91000000-0000-0000-0000-000000000002', 'fuel', 50);

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq($$select count(*) from public.fuel_training_mode_presets where user_id = '91000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'Cross-user preset direct-ID access is blocked');
select results_eq($$select count(*) from public.fuel_training_mode_sessions where id = '93000000-0000-4000-8000-000000000002'$$, array[0::bigint], 'Cross-user Training session direct-ID access is blocked');
select results_eq($$select count(*) from public.fuel_milestone_achievements where user_id = '91000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'Cross-user milestone direct-ID access is blocked');
select results_eq(
  $$with changed as (
      update public.fuel_training_mode_sessions set title = 'Stolen session'
      where id = '93000000-0000-4000-8000-000000000002' returning 1
    ) select count(*) from changed$$,
  array[0::bigint],
  'Cross-user Training session update is blocked'
);
select throws_ok(
  $$insert into public.fuel_logs (
      user_id, logged_at, type, source, training_mode_session_id, training_mode_preset_id,
      carbs_g, fluid_ml, sodium_mg, caffeine_mg
    ) values (
      '91000000-0000-0000-0000-000000000001', now(), 'fuel', 'manual',
      '93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000011',
      25, 0, 0, 0
    )$$,
  '23503', null,
  'Composite ownership keys prevent linking a log to another user session or preset'
);
select throws_ok(
  $$delete from public.fuel_training_mode_sessions where id = '93000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'Training session deletion is not exposed to authenticated clients'
);

select * from finish();
rollback;
