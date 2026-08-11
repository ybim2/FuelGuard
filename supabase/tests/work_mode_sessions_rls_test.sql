begin;
select plan(18);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'work-mode-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('b1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'work-mode-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

select ok((select relrowsecurity from pg_class where oid = 'public.fuel_work_mode_sessions'::regclass), 'Work Mode sessions have RLS enabled');
select ok(not has_table_privilege('anon', 'public.fuel_work_mode_sessions', 'SELECT'), 'Anonymous users cannot read Work Mode sessions');
select ok(
  has_table_privilege('authenticated', 'public.fuel_work_mode_sessions', 'SELECT')
  and has_table_privilege('authenticated', 'public.fuel_work_mode_sessions', 'INSERT')
  and has_table_privilege('authenticated', 'public.fuel_work_mode_sessions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.fuel_work_mode_sessions', 'DELETE'),
  'Authenticated access is limited to read, start and end operations'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into public.fuel_work_mode_sessions (id, user_id, title, status, started_at) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'Office day', 'active', '2026-08-10T08:00:00Z');

select results_eq($$select count(*) from public.fuel_work_mode_sessions$$, array[1::bigint], 'Athlete reads the own Work Mode session');
select results_eq(
  $$select started_at from public.fuel_work_mode_sessions where id = 'b2000000-0000-4000-8000-000000000001'$$,
  array['2026-08-10T08:00:00Z'::timestamptz],
  'Work Mode start time persists'
);
select throws_ok(
  $$insert into public.fuel_work_mode_sessions (user_id, started_at) values ('b1000000-0000-0000-0000-000000000001', '2026-08-10T09:00:00Z')$$,
  '23505', null,
  'Only one active Work Mode session is allowed per athlete'
);
select lives_ok(
  $$update public.fuel_work_mode_sessions set status = 'completed', ended_at = '2026-08-10T17:00:00Z' where id = 'b2000000-0000-4000-8000-000000000001'$$,
  'Athlete can end the own Work Mode session'
);
select results_eq(
  $$select status, ended_at from public.fuel_work_mode_sessions where id = 'b2000000-0000-4000-8000-000000000001'$$,
  $$values ('completed'::text, '2026-08-10T17:00:00Z'::timestamptz)$$,
  'Completed Work Mode state persists'
);
select throws_ok(
  $$update public.fuel_work_mode_sessions set status = 'active', ended_at = null where id = 'b2000000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'A completed Work Mode session cannot be reopened'
);
select throws_ok(
  $$update public.fuel_work_mode_sessions set id = 'b2000000-0000-4000-8000-000000000099' where id = 'b2000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'Work Mode session identity cannot be repointed'
);

insert into public.fuel_logs (id, user_id, logged_at, type, source) values
  ('b3000000-0000-4000-8000-000000000001', 'b1000000-0000-0000-0000-000000000001', '2026-08-10T12:00:00Z', 'fuel', 'manual');
select results_eq(
  $$select count(*) from public.fuel_logs where id = 'b3000000-0000-4000-8000-000000000001' and work_mode_session_id is null$$,
  array[1::bigint],
  'Ordinary Fuel Guard logs remain valid without Work Mode'
);
select lives_ok(
  $$update public.fuel_logs set work_mode_session_id = 'b2000000-0000-4000-8000-000000000001' where id = 'b3000000-0000-4000-8000-000000000001'$$,
  'Athlete can associate an own existing log with the own Work Mode session'
);
select results_eq(
  $$select work_mode_session_id from public.fuel_logs where id = 'b3000000-0000-4000-8000-000000000001'$$,
  array['b2000000-0000-4000-8000-000000000001'::uuid],
  'Work Mode log context persists without replacing the canonical log'
);

reset role;
insert into public.fuel_work_mode_sessions (id, user_id, title, status, started_at) values
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-0000-0000-000000000002', 'Other athlete work', 'active', '2026-08-10T08:00:00Z');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select results_eq(
  $$select count(*) from public.fuel_work_mode_sessions where id = 'b2000000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Cross-athlete Work Mode direct-ID reads are blocked'
);
select results_eq(
  $$with changed as (update public.fuel_work_mode_sessions set title = 'Stolen' where id = 'b2000000-0000-4000-8000-000000000002' returning 1) select count(*) from changed$$,
  array[0::bigint],
  'Cross-athlete Work Mode direct-ID updates are blocked'
);
select throws_ok(
  $$insert into public.fuel_work_mode_sessions (user_id, started_at) values ('b1000000-0000-0000-0000-000000000002', now())$$,
  '42501', null,
  'Athlete cannot start Work Mode for another account'
);
select throws_ok(
  $$update public.fuel_logs set work_mode_session_id = 'b2000000-0000-4000-8000-000000000002' where id = 'b3000000-0000-4000-8000-000000000001'$$,
  '23503', null,
  'Composite ownership prevents linking a log to another athlete Work Mode session'
);
select throws_ok(
  $$delete from public.fuel_work_mode_sessions where id = 'b2000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'Work Mode session deletion is not exposed to authenticated clients'
);

select * from finish();
rollback;
