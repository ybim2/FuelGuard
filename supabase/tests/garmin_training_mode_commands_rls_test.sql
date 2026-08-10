begin;
select plan(26);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('c1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'garmin-training-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('c1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'garmin-training-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.garmin_device_tokens
  (id, user_id, app_id, token_hash, token_prefix, label)
values
  ('c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'quick_log', 'garmin-training-token-a', 'train-a', 'Test Quick Log A'),
  ('c2000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'quick_log', 'garmin-training-token-b', 'train-b', 'Test Quick Log B');

insert into public.fuel_training_mode_presets (
  id, user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg,
  intended_interval_minutes, is_default
) values
  ('c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'fuel', 'Legacy Fuel', 30, 0, 0, 40, 30, true),
  ('c3000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'hydration', 'Hydrate', 0, 200, 250, 0, 20, true),
  ('c3000000-0000-4000-8000-000000000011', 'c1000000-0000-4000-8000-000000000002', 'fuel', 'Fuel', 25, 0, 0, 0, 30, true),
  ('c3000000-0000-4000-8000-000000000012', 'c1000000-0000-4000-8000-000000000002', 'hydration', 'Hydrate', 0, 250, 200, 0, 20, true);

select ok(
  (select relrowsecurity from pg_class where oid = 'private.fuel_garmin_training_commands'::regclass),
  'Garmin Training command audit has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'private.fuel_garmin_training_commands', 'SELECT,INSERT,UPDATE,DELETE'),
  'Authenticated clients have no Garmin Training command audit privileges'
);
select results_eq(
  $$select count(*)
    from pg_policies
    where schemaname = 'private'
      and tablename = 'fuel_garmin_training_commands'
      and policyname = 'fuel_garmin_training_commands_no_direct_access'
      and permissive = 'RESTRICTIVE'$$,
  array[1::bigint],
  'The Garmin Training command audit has an explicit restrictive direct-access policy'
);
select results_eq(
  $$select count(*)
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'fuel_garmin_training_commands'
      and indexname = 'fuel_garmin_training_commands_session_user_idx'$$,
  array[1::bigint],
  'The Garmin Training command audit session relationship has a covering index'
);
select ok(
  not has_function_privilege('authenticated', 'public.fuel_garmin_training_command(uuid,uuid,text,text,timestamptz)', 'EXECUTE'),
  'Authenticated clients cannot execute the Garmin Training mutation'
);
select ok(
  has_function_privilege('service_role', 'public.fuel_garmin_training_command(uuid,uuid,text,text,timestamptz)', 'EXECUTE'),
  'Only the server service role receives Garmin Training mutation access'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'start', 'client-forgery', now())$$,
  '42501', null,
  'An Athlete cannot bypass the server and start Training Mode directly'
);

reset role;
set local role service_role;
select results_eq(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'start', 'start-a', now())->>'result'$$,
  array['started'::text],
  'An authorised Garmin device starts Training Mode'
);
select results_eq(
  $$select count(*) from public.fuel_training_mode_sessions
    where user_id = 'c1000000-0000-4000-8000-000000000001' and status = 'active'$$,
  array[1::bigint],
  'Garmin start creates exactly one active session'
);
select results_eq(
  $$select user_id from public.fuel_training_mode_sessions where status = 'active'$$,
  array['c1000000-0000-4000-8000-000000000001'::uuid],
  'The Garmin session belongs to the paired Athlete'
);
select results_eq(
  $$select fuel_caffeine_mg from public.fuel_training_mode_sessions where status = 'active'$$,
  array[0],
  'A watch-started session does not duplicate legacy caffeine into Fuel'
);
select results_eq(
  $$select hydration_caffeine_mg from public.fuel_training_mode_sessions where status = 'active'$$,
  array[40],
  'Legacy caffeine remains available once through the canonical Hydrate context'
);
select results_eq(
  $$select (public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'start', 'start-a', now())->>'duplicate')::boolean$$,
  array[true],
  'A repeated Garmin start identity returns the recorded result'
);
reset role;
select results_eq(
  $$select count(*) from private.fuel_garmin_training_commands where external_action_id = 'start-a'$$,
  array[1::bigint],
  'A repeated Garmin start identity creates one audit command'
);
set local role service_role;
select results_eq(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'start', 'start-a-again', now())->>'result'$$,
  array['already_active'::text],
  'A distinct repeated start reuses the existing active PWA/backend state'
);
select results_eq(
  $$select count(*) from public.fuel_training_mode_sessions
    where user_id = 'c1000000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'Repeated start commands cannot create duplicate sessions'
);
select throws_ok(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
      'start', 'cross-athlete', now())$$,
  '42501', 'Garmin device is not authorised for this athlete.',
  'A paired device cannot mutate a different Athlete by direct ID'
);
select results_eq(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'end', 'end-a', now())->>'result'$$,
  array['ended'::text],
  'An authorised Garmin device ends Training Mode'
);
select results_eq(
  $$select (public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'end', 'end-a', now())->>'duplicate')::boolean$$,
  array[true],
  'A repeated end identity is idempotent'
);
select results_eq(
  $$select status from public.fuel_training_mode_sessions
    where user_id = 'c1000000-0000-4000-8000-000000000001'$$,
  array['completed'::text],
  'The ended Garmin session remains durably completed'
);
select results_eq(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'end', 'end-without-active', now())->>'result'$$,
  array['no_active'::text],
  'Ending without an active session is safe and explicit'
);
select results_eq(
  $$select count(*) from public.fuel_training_mode_sessions
    where user_id = 'c1000000-0000-4000-8000-000000000001' and status = 'active'$$,
  array[0::bigint],
  'Ending never leaves a duplicate active session'
);

reset role;
update public.garmin_device_tokens
set revoked_at = now()
where id = 'c2000000-0000-4000-8000-000000000001';
set local role service_role;
select throws_ok(
  $$select public.fuel_garmin_training_command(
      'c2000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
      'start', 'revoked-start', now())$$,
  '42501', 'Garmin device is not authorised for this athlete.',
  'Revocation immediately blocks Garmin Training Mode mutation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select count(*) from private.fuel_garmin_training_commands$$,
  '42501', null,
  'Another Athlete cannot inspect private Garmin Training command identities'
);

reset role;
select results_eq(
  $$select count(*) from private.fuel_garmin_training_commands$$,
  array[4::bigint],
  'Only unique successful command identities are recorded in the audit ledger'
);
select throws_ok(
  $$delete from public.fuel_training_mode_sessions
    where user_id = 'c1000000-0000-4000-8000-000000000001'$$,
  '23503', null,
  'A session referenced by a Garmin command audit cannot be deleted'
);

select * from finish();
rollback;
