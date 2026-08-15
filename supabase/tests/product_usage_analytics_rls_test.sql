begin;
select plan(40);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-admin@fuelguard.test', '', now(), '{}', '{}', now() - interval '60 days', now()),
  ('a1700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-athlete-a@fuelguard.test', '', now(), '{}', '{}', now() - interval '40 days', now()),
  ('a1700000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'analytics-athlete-b@fuelguard.test', '', now(), '{}', '{}', now() - interval '10 days', now());

insert into private.fuel_platform_admins (user_id, status, granted_by, reason)
values (
  'a1700000-0000-4000-8000-000000000001',
  'active',
  'a1700000-0000-4000-8000-000000000001',
  'Temporary pgTAP founder analytics administrator'
);

select has_table('public', 'fuel_product_events', 'Product events table exists');
select has_table('public', 'fuel_product_attribution', 'Product attribution table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_product_events'::regclass), 'Product events retain RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_product_attribution'::regclass), 'Product attribution retains RLS');
select ok(not has_table_privilege('anon', 'public.fuel_product_events', 'select'), 'Anon cannot read product events');
select ok(not has_table_privilege('anon', 'public.fuel_product_attribution', 'select'), 'Anon cannot read attribution');
select ok(not has_table_privilege('authenticated', 'public.fuel_product_events', 'insert'), 'Authenticated clients cannot directly insert product events');
select ok(not has_table_privilege('authenticated', 'public.fuel_product_attribution', 'insert'), 'Authenticated clients cannot directly insert attribution');
select ok(to_regprocedure('public.fuel_track_product_event(text,text,text,uuid,text,text,jsonb)') is not null, 'Allowlisted product event RPC exists');
select ok(to_regprocedure('public.fuel_product_analytics_summary(boolean)') is not null, 'Founder analytics summary RPC exists');
select ok(to_regprocedure('public.fuel_product_analytics_user(uuid)') is not null, 'Founder individual usage RPC exists');
select ok((select relrowsecurity from pg_class where oid = 'private.fuel_product_analytics_exclusions'::regclass), 'Private test-account exclusions retain RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1700000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a1700000-0000-4000-8000-000000000002","role":"authenticated"}', true);

select lives_ok(
  $$select public.fuel_track_product_event(
    'app_open', 'ios_pwa', 'test-v1', 'a1710000-0000-4000-8000-000000000001',
    'Not/A_Timezone', 'session:one:app_open', '{"source":"qa","count":1}'::jsonb
  )$$,
  'Authenticated user records an allowlisted privacy-minimised event'
);
select results_eq(
  $$select count(*) from public.fuel_product_events where dedupe_key = 'session:one:app_open'$$,
  array[1::bigint],
  'Event dedupe key creates exactly one own event'
);
select results_eq(
  $$select timezone_name from public.fuel_product_events where dedupe_key = 'session:one:app_open'$$,
  array['UTC'::text],
  'Invalid client timezone safely falls back to UTC'
);
select throws_ok(
  $$insert into public.fuel_product_events (user_id, event_name)
    values ('a1700000-0000-4000-8000-000000000002', 'app_open')$$,
  '42501', null,
  'Direct event insertion is denied even for the owner'
);
select throws_ok(
  $$select public.fuel_track_product_event('invented_event')$$,
  '22023', 'Unsupported Fuel Guard product event.',
  'Arbitrary event names are rejected'
);
select throws_ok(
  $$select public.fuel_track_product_event('app_open', p_metadata := '{"email":"private@example.test"}'::jsonb)$$,
  '22023', 'Analytics metadata contains an unsupported field.',
  'Sensitive or unsupported metadata fields are rejected'
);
select throws_ok(
  $$select public.fuel_track_product_event('app_open', p_metadata := '{"source":{"nested":true}}'::jsonb)$$,
  '22023', 'Analytics metadata values must be scalar.',
  'Nested metadata values are rejected'
);
select lives_ok(
  $$select public.fuel_capture_first_touch_attribution('qa-source', 'social', 'launch', 'tester', null, 'a')$$,
  'Authenticated user captures first-touch attribution'
);
select lives_ok(
  $$select public.fuel_capture_first_touch_attribution('later-source', null, null, null, null, null)$$,
  'A later attribution attempt is harmless'
);
select results_eq(
  $$select source from public.fuel_product_attribution$$,
  array['qa-source'::text],
  'First-touch attribution remains immutable'
);
select results_eq(
  $$select count(*) from public.fuel_product_attribution$$,
  array[1::bigint],
  'Athlete reads only the own attribution row'
);

select set_config('request.jwt.claim.sub', 'a1700000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"a1700000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$select public.fuel_track_product_event('settings_viewed', p_dedupe_key := 'athlete-b-settings')$$,
  'A second authenticated account records its own event'
);
select results_eq(
  $$select count(*) from public.fuel_product_events$$,
  array[1::bigint],
  'The second account sees only its own event'
);

select set_config('request.jwt.claim.sub', 'a1700000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a1700000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_product_events$$,
  array[1::bigint],
  'Cross-account product events remain hidden by direct ID/RLS'
);
select throws_ok(
  $$select public.fuel_product_analytics_summary(false)$$,
  '42501', 'Fuel Guard product analytics access denied.',
  'Ordinary authenticated users cannot read founder aggregates'
);
select throws_ok(
  $$select public.fuel_product_analytics_user('a1700000-0000-4000-8000-000000000003')$$,
  '42501', 'Fuel Guard product analytics access denied.',
  'Ordinary authenticated users cannot inspect another user timeline'
);
select throws_ok(
  $$select public.fuel_product_analytics_set_exclusion('a1700000-0000-4000-8000-000000000003', true, 'Not allowed')$$,
  '42501', 'Fuel Guard product analytics access denied.',
  'Ordinary authenticated users cannot alter test-account exclusions'
);

reset role;
insert into public.fuel_logs (user_id, logged_at, type, source)
values ('a1700000-0000-4000-8000-000000000002', now(), 'fuel', 'manual');
select results_eq(
  $$select event_name from private.fuel_product_meaningful_actions
    where user_id = 'a1700000-0000-4000-8000-000000000002'
      and source_table = 'fuel_logs'$$,
  array['fuel_logged'::text],
  'Canonical Fuel logs derive a meaningful activation action'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1700000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1700000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$select public.fuel_product_analytics_summary(false)$$,
  'Active platform administrator can load founder aggregates'
);
select ok(
  (public.fuel_product_analytics_summary(false) #>> '{overview,dau}')::integer >= 1,
  'Founder summary counts a current local-day meaningful action'
);
select lives_ok(
  $$select public.fuel_product_analytics_user('a1700000-0000-4000-8000-000000000002')$$,
  'Active platform administrator can inspect a user product timeline'
);
select ok(
  jsonb_path_exists(
    public.fuel_product_analytics_user('a1700000-0000-4000-8000-000000000002'),
    '$.timeline[*] ? (@.eventName == "fuel_logged")'
  ),
  'Individual timeline contains the authoritative Fuel action'
);
select lives_ok(
  $$select public.fuel_product_analytics_set_exclusion(
    'a1700000-0000-4000-8000-000000000003', true, 'Temporary test account'
  )$$,
  'Founder can exclude a test account'
);
select is(
  public.fuel_product_analytics_user('a1700000-0000-4000-8000-000000000003') #>> '{account,exclusionReason}',
  'Temporary test account',
  'Test-account exclusion reason is retained for auditability'
);
select ok(
  not jsonb_path_exists(
    public.fuel_product_analytics_summary(false),
    '$.users[*] ? (@.userId == "a1700000-0000-4000-8000-000000000003")'
  ),
  'Excluded test account is absent from default founder metrics'
);
select lives_ok(
  $$select public.fuel_product_analytics_set_exclusion(
    'a1700000-0000-4000-8000-000000000003', false, 'QA complete'
  )$$,
  'Founder can restore an excluded account'
);
reset role;
select results_eq(
  $$select count(*) from private.fuel_product_analytics_access_audit
    where actor_user_id = 'a1700000-0000-4000-8000-000000000001'
      and action in ('user_detail_viewed', 'test_account_excluded', 'test_account_included')$$,
  array[5::bigint],
  'Founder detail and exclusion operations are audited'
);
select results_eq(
  $$select count(*) from private.fuel_product_analytics_exclusions
    where user_id = 'a1700000-0000-4000-8000-000000000003'$$,
  array[0::bigint],
  'Restored test account has no remaining exclusion row'
);

select coalesce(string_agg(result, E'\n'), 'ok 40/40') as tap_summary
from finish() as result;
rollback;
