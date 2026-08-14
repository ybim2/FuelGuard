begin;
select plan(31);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('a1400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supp-a@fuelguard.test','',now(),'{}','{}',now(),now()),
  ('a1400000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','supp-b@fuelguard.test','',now(),'{}','{}',now(),now());

select has_table('public','fuel_supplement_plans','Supplement plans exist');
select has_table('public','fuel_supplement_schedule_slots','Supplement schedule slots exist');
select has_table('public','fuel_supplement_events','Supplement events exist');
select has_table('public','fuel_recovery_focus_sessions','Recovery Focus sessions exist');
select ok((select relrowsecurity from pg_class where oid='public.fuel_supplement_plans'::regclass),'Plans have RLS');
select ok((select relrowsecurity from pg_class where oid='public.fuel_supplement_schedule_slots'::regclass),'Slots have RLS');
select ok((select relrowsecurity from pg_class where oid='public.fuel_supplement_events'::regclass),'Events have RLS');
select ok((select relrowsecurity from pg_class where oid='public.fuel_recovery_focus_sessions'::regclass),'Recovery Focus has RLS');
select ok(not has_table_privilege('anon','public.fuel_supplement_events','select'),'Anonymous users cannot read supplements');
select ok(has_table_privilege('authenticated','public.fuel_supplement_events','select'),'Authenticated users read through RLS');

insert into public.fuel_training_mode_presets (id,user_id,event_type,name,carbs_g,fluid_ml,sodium_mg,caffeine_mg) values
 ('a1410000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','fuel','Fuel',30,0,0,0),
 ('a1410000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000001','hydration','Hydrate',0,250,200,0),
 ('a1410000-0000-4000-8000-000000000003','a1400000-0000-4000-8000-000000000002','fuel','Fuel',30,0,0,0),
 ('a1410000-0000-4000-8000-000000000004','a1400000-0000-4000-8000-000000000002','hydration','Hydrate',0,250,200,0);
insert into public.fuel_training_mode_sessions (id,user_id,status,started_at,ended_at,fuel_preset_id,hydration_preset_id,fuel_carbs_g,fuel_fluid_ml,fuel_sodium_mg,fuel_caffeine_mg,hydration_carbs_g,hydration_fluid_ml,hydration_sodium_mg,hydration_caffeine_mg) values
 ('a1420000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','completed','2026-08-14T08:00Z','2026-08-14T09:00Z','a1410000-0000-4000-8000-000000000001','a1410000-0000-4000-8000-000000000002',30,0,0,0,0,250,200,0),
 ('a1420000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000002','completed','2026-08-14T08:00Z','2026-08-14T09:00Z','a1410000-0000-4000-8000-000000000003','a1410000-0000-4000-8000-000000000004',30,0,0,0,0,250,200,0);

set local role authenticated;
select set_config('request.jwt.claim.sub','a1400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select lives_ok($$insert into public.fuel_supplement_plans (id,user_id,supplement_type,label) values ('a1430000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','creatine','Creatine')$$,'Athlete creates own plan');
select lives_ok($$insert into public.fuel_supplement_schedule_slots (id,user_id,supplement_plan_id,local_time) values ('a1440000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','a1430000-0000-4000-8000-000000000001','08:00')$$,'Athlete creates own schedule');
select lives_ok($$insert into public.fuel_supplement_events (id,user_id,supplement_plan_id,schedule_slot_id,taken_at,idempotency_key,context_snapshot) values ('a1450000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','a1430000-0000-4000-8000-000000000001','a1440000-0000-4000-8000-000000000001',now(),'schedule:a1440000-0000-4000-8000-000000000001:2026-08-14','{"primary":"everyday"}')$$,'Athlete logs own supplement');
select results_eq($$select count(*) from public.fuel_supplement_events$$,array[1::bigint],'Athlete reads own supplement event');
select throws_ok($$insert into public.fuel_supplement_events (user_id,supplement_plan_id,taken_at,idempotency_key) values ('a1400000-0000-4000-8000-000000000001','a1430000-0000-4000-8000-000000000001',now(),'schedule:a1440000-0000-4000-8000-000000000001:2026-08-14')$$,'23505',null,'Idempotency prevents duplicate sends');
select lives_ok($$update public.fuel_supplement_events set taken_at=now()-interval '5 minutes' where id='a1450000-0000-4000-8000-000000000001'$$,'Athlete edits event timestamp');
select throws_ok($$update public.fuel_supplement_events set supplement_plan_id='a1430000-0000-4000-8000-000000000099' where id='a1450000-0000-4000-8000-000000000001'$$,'23514','Supplement event relationship identity is immutable.','Plan identity cannot be repointed');
select lives_ok($$insert into public.fuel_recovery_focus_sessions (id,user_id,source_training_session_id,started_at,expires_at) values ('a1460000-0000-4000-8000-000000000001','a1400000-0000-4000-8000-000000000001','a1420000-0000-4000-8000-000000000001','2026-08-14T09:00Z','2026-08-15T09:00Z')$$,'Athlete explicitly starts Recovery Focus');
select throws_ok($$insert into public.fuel_recovery_focus_sessions (user_id,source_training_session_id,started_at,expires_at) values ('a1400000-0000-4000-8000-000000000001','a1420000-0000-4000-8000-000000000001',now(),now()+interval '2 hours')$$,'23505',null,'Only one Recovery Focus is active');
select lives_ok($$update public.fuel_recovery_focus_sessions set status='completed',ended_at='2026-08-14T10:00Z',end_reason='manual' where id='a1460000-0000-4000-8000-000000000001'$$,'Athlete ends Recovery Focus');
select throws_ok($$update public.fuel_recovery_focus_sessions set source_training_session_id='a1420000-0000-4000-8000-000000000002' where id='a1460000-0000-4000-8000-000000000001'$$,'23514','Recovery Focus training relationship is immutable.','Recovery relationship cannot be repointed');

reset role;
insert into public.fuel_supplement_plans (id,user_id,supplement_type,label) values ('a1430000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000002','iron','Iron');
insert into public.fuel_supplement_events (id,user_id,supplement_plan_id,taken_at) values ('a1450000-0000-4000-8000-000000000002','a1400000-0000-4000-8000-000000000002','a1430000-0000-4000-8000-000000000002',now());
set local role authenticated;
select set_config('request.jwt.claim.sub','a1400000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1400000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select results_eq($$select count(*) from public.fuel_supplement_events where id='a1450000-0000-4000-8000-000000000002'$$,array[0::bigint],'Cross-athlete direct-ID read is blocked');
select results_eq($$with changed as (update public.fuel_supplement_events set notes='stolen' where id='a1450000-0000-4000-8000-000000000002' returning 1) select count(*) from changed$$,array[0::bigint],'Cross-athlete update is blocked');
select throws_ok($$insert into public.fuel_supplement_plans (user_id,supplement_type,label) values ('a1400000-0000-4000-8000-000000000002','creatine','Other')$$,'42501',null,'Athlete cannot create another user plan');
select throws_ok($$insert into public.fuel_supplement_events (user_id,supplement_plan_id,taken_at) values ('a1400000-0000-4000-8000-000000000001','a1430000-0000-4000-8000-000000000002',now())$$,'23503',null,'Composite ownership blocks cross-athlete plan links');
select results_eq($$select count(*) from public.fuel_recovery_focus_sessions where source_training_session_id='a1420000-0000-4000-8000-000000000002'$$,array[0::bigint],'Other athlete Recovery Focus remains private');
select lives_ok($$delete from public.fuel_supplement_events where id='a1450000-0000-4000-8000-000000000001'$$,'Athlete can undo an own supplement event');
select lives_ok($$delete from public.fuel_supplement_plans where id='a1430000-0000-4000-8000-000000000001'$$,'Athlete can delete an own plan after history is removed');
select results_eq($$with removed as (delete from public.fuel_supplement_events where id='a1450000-0000-4000-8000-000000000002' returning 1) select count(*) from removed$$,array[0::bigint],'Athlete cannot delete another user event');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename like 'fuel_supplement%' and policyname ilike '%coach%'),'No Coach supplement policy exists');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='fuel_recovery_focus_sessions' and policyname ilike '%coach%'),'No Coach Recovery policy exists');

select * from finish();
rollback;
