begin;
select plan(7);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'milestone-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'milestone-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

select ok((select relrowsecurity from pg_class where oid = 'public.fuel_milestone_achievements'::regclass), 'Milestone acknowledgements retain RLS');
select ok(not has_table_privilege('anon', 'public.fuel_milestone_achievements', 'select'), 'Anon cannot read milestone acknowledgements');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1600000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1600000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.fuel_milestone_achievements (user_id, category, threshold)
    values ('a1600000-0000-4000-8000-000000000001', 'sleepy', 10)$$,
  'Athlete can acknowledge an own Sleepy milestone'
);
select lives_ok(
  $$insert into public.fuel_milestone_achievements (user_id, category, threshold)
    values ('a1600000-0000-4000-8000-000000000001', 'ready', 5)$$,
  'Athlete can acknowledge an own Ready for the Day milestone'
);
select results_eq(
  $$select category from public.fuel_milestone_achievements order by category$$,
  $$values ('ready'::text), ('sleepy'::text)$$,
  'Athlete reads only the two own acknowledgement rows'
);
select throws_ok(
  $$insert into public.fuel_milestone_achievements (user_id, category, threshold)
    values ('a1600000-0000-4000-8000-000000000002', 'sleepy', 10)$$,
  '42501', null,
  'Athlete cannot create another account milestone by direct ID'
);
select results_eq(
  $$select count(*) from public.fuel_milestone_achievements where user_id = 'a1600000-0000-4000-8000-000000000002'$$,
  array[0::bigint],
  'Cross-account milestone rows remain hidden'
);

select * from finish();
rollback;
