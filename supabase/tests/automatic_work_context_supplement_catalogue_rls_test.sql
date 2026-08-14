begin;
select plan(24);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1500000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','context-a@fuelguard.test','',now(),'{}','{}',now(),now()),
  ('a1500000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','context-b@fuelguard.test','',now(),'{}','{}',now(),now());

select has_table('public','fuel_work_patterns','Work patterns exist');
select has_table('public','fuel_work_pattern_days','Work pattern days exist');
select has_column('public','fuel_supplement_events','event_local_date','Supplement events record their local date');
select has_column('public','fuel_supplement_events','timezone_name','Supplement events record their timezone');
select ok((select relrowsecurity from pg_class where oid='public.fuel_work_patterns'::regclass),'Work patterns have RLS');
select ok((select relrowsecurity from pg_class where oid='public.fuel_work_pattern_days'::regclass),'Work pattern days have RLS');
select ok(not has_table_privilege('anon','public.fuel_work_patterns','select'),'Anonymous users cannot read working patterns');
select ok(has_table_privilege('authenticated','public.fuel_work_patterns','select') and has_table_privilege('authenticated','public.fuel_work_patterns','insert') and has_table_privilege('authenticated','public.fuel_work_patterns','update') and not has_table_privilege('authenticated','public.fuel_work_patterns','delete'),'Authenticated pattern privileges remain owner-scoped and non-destructive');

set local role authenticated;
select set_config('request.jwt.claim.sub','a1500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1500000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select lives_ok($$insert into public.fuel_work_patterns (user_id,timezone_name) values ('a1500000-0000-4000-8000-000000000001','Europe/London')$$,'Athlete creates an own working pattern');
select lives_ok($$insert into public.fuel_work_pattern_days (user_id,day_of_week,is_work_day,start_time,end_time) values ('a1500000-0000-4000-8000-000000000001',1,true,'09:00','17:00'),('a1500000-0000-4000-8000-000000000001',5,true,'22:00','06:00'),('a1500000-0000-4000-8000-000000000001',6,false,null,null)$$,'Normal, overnight and off-day patterns are valid');
select results_eq($$select count(*) from public.fuel_work_pattern_days$$,array[3::bigint],'Athlete reads only the own pattern days');
select throws_ok($$insert into public.fuel_work_pattern_days (user_id,day_of_week,is_work_day,start_time,end_time) values ('a1500000-0000-4000-8000-000000000001',2,true,'08:00','08:00')$$,'23514',null,'Equal work start and finish are rejected');
select throws_ok($$insert into public.fuel_work_pattern_days (user_id,day_of_week,is_work_day,start_time,end_time) values ('a1500000-0000-4000-8000-000000000001',3,false,'09:00','17:00')$$,'23514',null,'Days off cannot retain hidden hours');
select throws_ok($$update public.fuel_work_pattern_days set day_of_week=4 where user_id='a1500000-0000-4000-8000-000000000001' and day_of_week=1$$,'23514','Work pattern day identity is immutable.','Work day identity cannot be repointed');
select throws_ok($$update public.fuel_work_patterns set user_id='a1500000-0000-4000-8000-000000000002' where user_id='a1500000-0000-4000-8000-000000000001'$$,'23514','Work pattern owner identity is immutable.','Work pattern owner cannot be repointed');
select throws_ok($$insert into public.fuel_work_patterns (user_id,timezone_name) values ('a1500000-0000-4000-8000-000000000002','UTC')$$,'42501',null,'Athlete cannot create another owner pattern');

select lives_ok($$insert into public.fuel_supplement_plans (id,user_id,supplement_type,label) values ('a1510000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','vitamin_d','Vitamin D'),('a1510000-0000-4000-8000-000000000002','a1500000-0000-4000-8000-000000000001','omega_3','Omega-3'),('a1510000-0000-4000-8000-000000000003','a1500000-0000-4000-8000-000000000001','protein_supplement','Protein supplement')$$,'Expanded catalogue types are accepted');
select lives_ok($$insert into public.fuel_supplement_events (id,user_id,supplement_plan_id,taken_at,event_local_date,timezone_name) values ('a1520000-0000-4000-8000-000000000001','a1500000-0000-4000-8000-000000000001','a1510000-0000-4000-8000-000000000001','2026-08-14T07:30:00Z','2026-08-14','Europe/London')$$,'Supplement event records local date and timestamp without an amount field');
select results_eq($$select event_local_date,timezone_name from public.fuel_supplement_events where id='a1520000-0000-4000-8000-000000000001'$$,$$values ('2026-08-14'::date,'Europe/London'::text)$$,'Supplement date context persists');
select ok(not exists(select 1 from information_schema.columns where table_schema='public' and table_name='fuel_supplement_events' and column_name in ('quantity','dosage','dose')),'Supplement events contain no amount or dosage column');

reset role;
insert into public.fuel_work_patterns (user_id,timezone_name) values ('a1500000-0000-4000-8000-000000000002','UTC');
insert into public.fuel_work_pattern_days (user_id,day_of_week,is_work_day,start_time,end_time) values ('a1500000-0000-4000-8000-000000000002',1,true,'08:00','16:00');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1500000-0000-4000-8000-000000000001","role":"authenticated"}',true);

select results_eq($$select count(*) from public.fuel_work_patterns where user_id='a1500000-0000-4000-8000-000000000002'$$,array[0::bigint],'Cross-athlete direct-ID pattern reads are blocked');
select results_eq($$with changed as (update public.fuel_work_pattern_days set start_time='07:00' where user_id='a1500000-0000-4000-8000-000000000002' returning 1) select count(*) from changed$$,array[0::bigint],'Cross-athlete direct-ID pattern updates are blocked');
select throws_ok($$delete from public.fuel_work_patterns where user_id='a1500000-0000-4000-8000-000000000001'$$,'42501',null,'Working pattern deletion is not exposed to clients');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename in ('fuel_work_patterns','fuel_work_pattern_days') and policyname ilike '%coach%'),'No Coach working-pattern policy exists');

select * from finish();
rollback;
