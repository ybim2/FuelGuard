begin;
select plan(40);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-next-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('a1100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-next-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_user_profiles (user_id, display_name) values
  ('a1100000-0000-4000-8000-000000000001', 'Athlete A'),
  ('a1100000-0000-4000-8000-000000000002', 'Athlete B');

select has_table('public', 'fuel_kit_checks', 'Fuel Kit checks table exists');
select has_table('public', 'fuel_everyday_reflections', 'Everyday Reflection table exists');
select has_column('public', 'fuel_user_profiles', 'username', 'Athlete profile has a username field');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_kit_checks'::regclass), 'Fuel Kit has RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.fuel_everyday_reflections'::regclass), 'Everyday Reflection has RLS enabled');
select results_eq(
  $$select attgenerated::text from pg_attribute where attrelid = 'public.fuel_kit_checks'::regclass and attname = 'prepared'$$,
  array['s'::text],
  'Fuel Kit prepared status is database-derived'
);
select ok(not has_table_privilege('anon', 'public.fuel_kit_checks', 'select'), 'Anon cannot read Fuel Kit checks');
select ok(not has_table_privilege('anon', 'public.fuel_everyday_reflections', 'select'), 'Anon cannot read Everyday Reflection');
select ok(has_table_privilege('authenticated', 'public.fuel_kit_checks', 'select'), 'Authenticated users may select through Fuel Kit RLS');
select ok(has_table_privilege('authenticated', 'public.fuel_everyday_reflections', 'select'), 'Authenticated users may select through Everyday Reflection RLS');
select ok(not has_table_privilege('authenticated', 'public.fuel_kit_checks', 'delete'), 'Fuel Kit deletion is not exposed');
select ok(not has_table_privilege('authenticated', 'public.fuel_everyday_reflections', 'delete'), 'Everyday Reflection deletion is not exposed');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select lives_ok(
  $$insert into public.fuel_kit_checks (
      id, user_id, checked_on, fuel_options, reserve_ready, hydration_ready, training_today, training_fuel_ready
    ) values (
      'a1200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', '2026-08-11', 3, true, true, true, true
    )$$,
  'Athlete can save an own Ready Check'
);
select results_eq(
  $$select prepared from public.fuel_kit_checks where id = 'a1200000-0000-4000-8000-000000000001'$$,
  array[true],
  'Ready Check derives prepared from required readiness fields'
);
select results_eq($$select count(*) from public.fuel_kit_checks$$, array[1::bigint], 'Athlete reads only the own Ready Check');

select lives_ok(
  $$insert into public.fuel_everyday_reflections (
      id, user_id, entry_type, observed_on, meal_prep_organisation, healthy_snacking_ability,
      work_applicable, training_applicable
    ) values (
      'a1300000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'baseline', '2026-08-11', 3, 4, false, false
    )$$,
  'Athlete can save incomplete own baseline progress'
);
select results_eq($$select count(*) from public.fuel_everyday_reflections$$, array[1::bigint], 'Athlete reads the own Everyday baseline');
select throws_ok(
  $$update public.fuel_everyday_reflections set meal_prep_organisation = 6 where id = 'a1300000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'Everyday ratings reject values outside 1–5'
);
select throws_ok(
  $$insert into public.fuel_everyday_reflections (
      user_id, entry_type, observed_on, meal_prep_organisation, healthy_snacking_ability, completed_at
    ) values (
      'a1100000-0000-4000-8000-000000000001', 'checkin', '2026-08-12', 3, 4, now()
    )$$,
  '23514', null,
  'An applicable incomplete review cannot be marked complete'
);
select lives_ok(
  $$update public.fuel_everyday_reflections set completed_at = now() where id = 'a1300000-0000-4000-8000-000000000001'$$,
  'Athlete can complete a valid baseline'
);
select results_eq(
  $$select count(*) from public.fuel_everyday_reflections where entry_type = 'baseline' and completed_at is not null$$,
  array[1::bigint],
  'Completed Everyday baseline persists'
);
select throws_ok(
  $$update public.fuel_everyday_reflections set healthy_snacking_ability = 5 where id = 'a1300000-0000-4000-8000-000000000001'$$,
  '23514', 'Completed Everyday Reflection records are immutable.',
  'Completed baseline values cannot be rewritten'
);
select throws_ok(
  $$insert into public.fuel_everyday_reflections (
      user_id, entry_type, observed_on, meal_prep_organisation, healthy_snacking_ability,
      work_applicable, training_applicable
    ) values (
      'a1100000-0000-4000-8000-000000000001', 'baseline', '2026-08-13', 4, 4, false, false
    )$$,
  '23505', null,
  'Each athlete has exactly one Everyday baseline'
);
select lives_ok(
  $$insert into public.fuel_everyday_reflections (
      id, user_id, entry_type, observed_on, meal_prep_organisation, healthy_snacking_ability,
      work_applicable, training_applicable
    ) values (
      'a1300000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000001', 'checkin', '2026-08-25', 4, 5, false, false
    )$$,
  'Athlete can save a later check-in draft'
);
select throws_ok(
  $$update public.fuel_everyday_reflections set observed_on = '2026-08-26' where id = 'a1300000-0000-4000-8000-000000000002'$$,
  '23514', 'Everyday Reflection identity fields are immutable.',
  'Reflection type and date identity cannot be repointed'
);
select lives_ok(
  $$insert into public.fuel_milestone_achievements (user_id, category, threshold)
    values ('a1100000-0000-4000-8000-000000000001', 'training', 5)$$,
  'Training cumulative milestones are accepted'
);
select lives_ok(
  $$insert into public.fuel_milestone_achievements (user_id, category, threshold)
    values ('a1100000-0000-4000-8000-000000000001', 'work', 5)$$,
  'Work cumulative milestones are accepted'
);

reset role;
insert into public.fuel_kit_checks (
  id, user_id, checked_on, fuel_options, reserve_ready, hydration_ready
) values (
  'a1200000-0000-4000-8000-000000000002', 'a1100000-0000-4000-8000-000000000002', '2026-08-11', 2, true, true
);
insert into public.fuel_everyday_reflections (
  id, user_id, entry_type, observed_on, meal_prep_organisation, healthy_snacking_ability,
  work_applicable, training_applicable, completed_at
) values (
  'a1300000-0000-4000-8000-000000000003', 'a1100000-0000-4000-8000-000000000002', 'baseline', '2026-08-11', 2, 3, false, false, now()
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select results_eq($$select count(*) from public.fuel_kit_checks where user_id = 'a1100000-0000-4000-8000-000000000002'$$, array[0::bigint], 'Cross-user Ready Check direct-ID reads are blocked');
select results_eq($$select count(*) from public.fuel_everyday_reflections where user_id = 'a1100000-0000-4000-8000-000000000002'$$, array[0::bigint], 'Cross-user Reflection direct-ID reads are blocked');
select throws_ok(
  $$insert into public.fuel_kit_checks (user_id, checked_on) values ('a1100000-0000-4000-8000-000000000002', '2026-08-12')$$,
  '42501', null,
  'Athlete cannot create a Ready Check for another account'
);
select throws_ok(
  $$insert into public.fuel_everyday_reflections (
      user_id, entry_type, observed_on, meal_prep_organisation, healthy_snacking_ability, work_applicable, training_applicable
    ) values ('a1100000-0000-4000-8000-000000000002', 'checkin', '2026-08-25', 3, 3, false, false)$$,
  '42501', null,
  'Athlete cannot create Reflection data for another account'
);
select results_eq(
  $$with changed as (
      update public.fuel_kit_checks set fuel_options = 20 where id = 'a1200000-0000-4000-8000-000000000002' returning 1
    ) select count(*) from changed$$,
  array[0::bigint],
  'Cross-user Ready Check updates are blocked'
);
select results_eq(
  $$with changed as (
      update public.fuel_everyday_reflections set meal_prep_organisation = 5 where id = 'a1300000-0000-4000-8000-000000000003' returning 1
    ) select count(*) from changed$$,
  array[0::bigint],
  'Cross-user Reflection updates are blocked'
);
select throws_ok(
  $$delete from public.fuel_kit_checks where id = 'a1200000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'Authenticated clients cannot delete Ready Check history'
);
select throws_ok(
  $$delete from public.fuel_everyday_reflections where id = 'a1300000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'Authenticated clients cannot delete the immutable baseline'
);
select lives_ok(
  $$update public.fuel_user_profiles set username = 'athlete_one' where user_id = 'a1100000-0000-4000-8000-000000000001'$$,
  'Athlete can set an own safe username'
);
select results_eq(
  $$select username from public.fuel_user_profiles where user_id = 'a1100000-0000-4000-8000-000000000001'$$,
  array['athlete_one'::text],
  'Own username persists'
);
select throws_ok(
  $$update public.fuel_user_profiles set username = 'Email@Address' where user_id = 'a1100000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'Username rejects email-shaped and unsafe identity values'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1100000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a1100000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$update public.fuel_user_profiles set username = 'athlete_one' where user_id = 'a1100000-0000-4000-8000-000000000002'$$,
  '23505', null,
  'Usernames remain unique across Athlete accounts'
);
select results_eq(
  $$select count(*) from public.fuel_user_profiles where user_id = 'a1100000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'Unrelated accounts cannot read another Athlete identity without an active relationship'
);

select * from finish();
rollback;
