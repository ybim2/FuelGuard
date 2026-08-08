begin;
select plan(50);

-- ABC Fitness gym/location/PT/client fixture plus an isolated organisation.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       email, '', now(), '{}', '{}', now(), now()
from (values
  ('81000000-0000-0000-0000-000000000001'::uuid, 'owner@abc.test'),
  ('81000000-0000-0000-0000-000000000002'::uuid, 'pta@abc.test'),
  ('81000000-0000-0000-0000-000000000003'::uuid, 'ptb@abc.test'),
  ('81000000-0000-0000-0000-000000000004'::uuid, 'bedford.manager@abc.test'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'performance.lead@abc.test'),
  ('81000000-0000-0000-0000-000000000006'::uuid, 'admin@abc.test'),
  ('81000000-0000-0000-0000-000000000007'::uuid, 'northampton.pt@abc.test'),
  ('81000000-0000-0000-0000-000000000008'::uuid, 'owner@other.test'),
  ('82000000-0000-0000-0000-000000000001'::uuid, 'athlete1@abc.test'),
  ('82000000-0000-0000-0000-000000000002'::uuid, 'athlete2@abc.test'),
  ('82000000-0000-0000-0000-000000000003'::uuid, 'athlete3@abc.test'),
  ('82000000-0000-0000-0000-000000000004'::uuid, 'athlete4@abc.test'),
  ('82000000-0000-0000-0000-000000000005'::uuid, 'athlete5@abc.test'),
  ('82000000-0000-0000-0000-000000000006'::uuid, 'athlete6@abc.test'),
  ('82000000-0000-0000-0000-000000000007'::uuid, 'athlete7@abc.test')
) fixture(id, email);

insert into public.fuel_user_profiles (user_id, role, coach_enabled, display_name)
select id, case when id::text like '82%' then 'athlete' else 'coach' end,
       id::text not like '82%', display_name
from (values
  ('81000000-0000-0000-0000-000000000001'::uuid, 'ABC Owner'),
  ('81000000-0000-0000-0000-000000000002'::uuid, 'PT A'),
  ('81000000-0000-0000-0000-000000000003'::uuid, 'PT B'),
  ('81000000-0000-0000-0000-000000000004'::uuid, 'Bedford Manager'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'Performance Lead'),
  ('81000000-0000-0000-0000-000000000006'::uuid, 'Organisation Admin'),
  ('81000000-0000-0000-0000-000000000007'::uuid, 'Northampton PT'),
  ('81000000-0000-0000-0000-000000000008'::uuid, 'Other Owner'),
  ('82000000-0000-0000-0000-000000000001'::uuid, 'Athlete 1'),
  ('82000000-0000-0000-0000-000000000002'::uuid, 'Athlete 2'),
  ('82000000-0000-0000-0000-000000000003'::uuid, 'Athlete 3'),
  ('82000000-0000-0000-0000-000000000004'::uuid, 'Athlete 4'),
  ('82000000-0000-0000-0000-000000000005'::uuid, 'Athlete 5'),
  ('82000000-0000-0000-0000-000000000006'::uuid, 'Athlete 6'),
  ('82000000-0000-0000-0000-000000000007'::uuid, 'Athlete 7')
) profiles(id, display_name);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
insert into public.fuel_organisations (id, name, created_by, minimum_reporting_cohort) values
  ('83000000-0000-0000-0000-000000000001', 'ABC Fitness', '81000000-0000-0000-0000-000000000001', 3);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000008', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
insert into public.fuel_organisations (id, name, created_by, minimum_reporting_cohort) values
  ('83000000-0000-0000-0000-000000000002', 'Other Organisation', '81000000-0000-0000-0000-000000000008', 3);
reset role;

insert into public.fuel_organisation_members (
  organisation_id, user_id, role, status, joined_at
)
select '83000000-0000-0000-0000-000000000001', id, role, 'active', now()
from (values
  ('81000000-0000-0000-0000-000000000002'::uuid, 'staff'),
  ('81000000-0000-0000-0000-000000000003'::uuid, 'staff'),
  ('81000000-0000-0000-0000-000000000004'::uuid, 'staff'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'staff'),
  ('81000000-0000-0000-0000-000000000006'::uuid, 'admin'),
  ('81000000-0000-0000-0000-000000000007'::uuid, 'staff')
) members(id, role);

set local session_replication_role = replica;
insert into public.fuel_teams (
  id, organisation_id, parent_team_id, name, unit_type, timezone_name, display_order
) values
  ('84000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001', null, 'ABC Fitness', 'Company', 'Europe/London', 0),
  ('84000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 'Bedford', 'Location', 'Europe/London', 1),
  ('84000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002', 'PT A Clients', 'Programme', 'Europe/London', 1),
  ('84000000-0000-0000-0000-000000000004', '83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000002', 'PT B Clients', 'Programme', 'Europe/London', 2),
  ('84000000-0000-0000-0000-000000000005', '83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000001', 'Northampton', 'Location', 'Europe/London', 2),
  ('84000000-0000-0000-0000-000000000006', '83000000-0000-0000-0000-000000000002', null, 'Other Unit', 'Department', 'UTC', 0);
set local session_replication_role = origin;

insert into public.fuel_team_athletes (
  organisation_id, team_id, athlete_id, status, joined_at
) values
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000003', '82000000-0000-0000-0000-000000000001', 'active', now()),
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000003', '82000000-0000-0000-0000-000000000002', 'active', now()),
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000003', '82000000-0000-0000-0000-000000000003', 'active', now()),
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000004', '82000000-0000-0000-0000-000000000004', 'active', now()),
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000004', '82000000-0000-0000-0000-000000000005', 'active', now()),
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000005', '82000000-0000-0000-0000-000000000006', 'active', now()),
  ('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000003', '82000000-0000-0000-0000-000000000007', 'active', now());

insert into public.fuel_organisation_athlete_shares (
  organisation_id, athlete_id, status, shared_at
)
select '83000000-0000-0000-0000-000000000001', id, 'active', now()
from unnest(array[
  '82000000-0000-0000-0000-000000000001'::uuid,
  '82000000-0000-0000-0000-000000000002'::uuid,
  '82000000-0000-0000-0000-000000000003'::uuid,
  '82000000-0000-0000-0000-000000000004'::uuid,
  '82000000-0000-0000-0000-000000000005'::uuid,
  '82000000-0000-0000-0000-000000000006'::uuid
]) athletes(id);
insert into public.fuel_organisation_athlete_shares (
  organisation_id, athlete_id, status
) values (
  '83000000-0000-0000-0000-000000000001',
  '82000000-0000-0000-0000-000000000007', 'invited'
);

insert into public.fuel_staff_capabilities (organisation_id, user_id, capability, status)
select '83000000-0000-0000-0000-000000000001', user_id, capability, 'active'
from (values
  ('81000000-0000-0000-0000-000000000002'::uuid, 'view_performance'),
  ('81000000-0000-0000-0000-000000000002'::uuid, 'view_org_aggregates'),
  ('81000000-0000-0000-0000-000000000002'::uuid, 'view_athlete_detail'),
  ('81000000-0000-0000-0000-000000000002'::uuid, 'view_interventions'),
  ('81000000-0000-0000-0000-000000000003'::uuid, 'view_performance'),
  ('81000000-0000-0000-0000-000000000003'::uuid, 'view_org_aggregates'),
  ('81000000-0000-0000-0000-000000000003'::uuid, 'view_athlete_detail'),
  ('81000000-0000-0000-0000-000000000004'::uuid, 'view_performance'),
  ('81000000-0000-0000-0000-000000000004'::uuid, 'view_org_aggregates'),
  ('81000000-0000-0000-0000-000000000004'::uuid, 'view_staff_activity'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'view_performance'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'view_org_aggregates'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'view_staff_activity'),
  ('81000000-0000-0000-0000-000000000005'::uuid, 'view_interventions'),
  ('81000000-0000-0000-0000-000000000006'::uuid, 'view_performance'),
  ('81000000-0000-0000-0000-000000000006'::uuid, 'manage_structure'),
  ('81000000-0000-0000-0000-000000000006'::uuid, 'manage_staff_access'),
  ('81000000-0000-0000-0000-000000000007'::uuid, 'view_performance'),
  ('81000000-0000-0000-0000-000000000007'::uuid, 'view_org_aggregates'),
  ('81000000-0000-0000-0000-000000000007'::uuid, 'view_athlete_detail')
) grants(user_id, capability)
on conflict (organisation_id, user_id, capability) do nothing;

insert into public.fuel_staff_scopes (
  organisation_id, user_id, scope_type, unit_id, athlete_id, include_descendants, status
) values
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', 'athlete', null, '82000000-0000-0000-0000-000000000001', false, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', 'athlete', null, '82000000-0000-0000-0000-000000000002', false, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', 'athlete', null, '82000000-0000-0000-0000-000000000003', false, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002', 'athlete', null, '82000000-0000-0000-0000-000000000007', false, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003', 'athlete', null, '82000000-0000-0000-0000-000000000004', false, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003', 'athlete', null, '82000000-0000-0000-0000-000000000005', false, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000004', 'unit', '84000000-0000-0000-0000-000000000002', null, true, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000005', 'organisation', null, null, true, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000006', 'organisation', null, null, true, 'active'),
  ('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000007', 'unit', '84000000-0000-0000-0000-000000000005', null, false, 'active');

insert into public.fuel_logs (user_id, logged_at, type, source, notes)
select id, logged_at, 'fuel', 'manual', notes
from (values
  ('82000000-0000-0000-0000-000000000001'::uuid, now() - interval '2 hours', null::text),
  ('82000000-0000-0000-0000-000000000002'::uuid, now() - interval '3 hours', 'fuel_guard_checkin:{"checkinType":"sleepy"}'),
  ('82000000-0000-0000-0000-000000000003'::uuid, now() - interval '5 days', null::text),
  ('82000000-0000-0000-0000-000000000004'::uuid, now() - interval '1 hour', null::text),
  ('82000000-0000-0000-0000-000000000005'::uuid, now() - interval '4 hours', null::text),
  ('82000000-0000-0000-0000-000000000006'::uuid, now() - interval '30 minutes', null::text)
) logs(id, logged_at, notes);

-- 1-3: all new public relationship tables are RLS-protected.
select ok(class.relrowsecurity, format('%s has RLS enabled', table_name))
from unnest(array[
  'fuel_staff_capabilities',
  'fuel_staff_scopes',
  'fuel_organisation_athlete_shares'
]) tables(table_name)
join pg_class class on class.oid = format('public.%I', table_name)::regclass;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 4-5: owner bootstrap provides administration without sensitive detail.
select ok(not private.fuel_performance_has_capability('83000000-0000-0000-0000-000000000001', 'view_athlete_detail'),
  'Organisation owner is not automatically granted athlete detail');
select ok(private.fuel_performance_has_capability('83000000-0000-0000-0000-000000000001', 'manage_staff_access'),
  'Organisation owner receives explicit access-management bootstrap');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 6-10: PT A has explicit client scope and cannot see PT B or Northampton clients.
select ok(private.fuel_performance_can_access_athlete('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', null, true), 'PT A can access assigned Athlete 1');
select ok(private.fuel_performance_can_access_athlete('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000002', null, true), 'PT A can access assigned Athlete 2');
select ok(private.fuel_performance_can_access_athlete('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000003', null, true), 'PT A can access assigned Athlete 3');
select ok(not private.fuel_performance_can_access_athlete('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000004', null, true), 'PT A cannot access PT B client');
select ok(not private.fuel_performance_can_access_athlete('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000006', null, true), 'PT A cannot access Northampton client');

-- 11-13: nested hierarchy resolves generically and rejects a cycle.
select ok((public.fuel_performance_pathway('83000000-0000-0000-0000-000000000001')->'units')::text like '%PT A Clients%', 'PT A pathway includes the assigned nested programme');
select ok((public.fuel_performance_pathway('83000000-0000-0000-0000-000000000001')->'units')::text not like '%Northampton%', 'PT A pathway excludes the sibling Northampton location');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$select public.fuel_performance_save_unit(
      '83000000-0000-0000-0000-000000000001',
      '84000000-0000-0000-0000-000000000002',
      '84000000-0000-0000-0000-000000000003',
      'Bedford', 'Location', 'Europe/London', 1
    )$$,
  '23514', 'Organisation unit hierarchy cannot contain a cycle.', 'Nested organisation units reject a cycle');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 14-19: PT RPCs return only three active, assigned clients and permitted detail.
select results_eq($$select count(*) from public.fuel_performance_context()$$, array[1::bigint], 'PT A resolves one Performance organisation');
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'cohort'->>'count')::integer$$, array[3], 'PT A aggregate includes only three active clients');
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000004')->'cohort'->>'count')::integer$$, array[0], 'Direct sibling unit ID returns no PT B clients');
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000005')->'cohort'->>'count')::integer$$, array[0], 'Direct Northampton unit ID returns no clients');
select ok(jsonb_array_length(public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'attentionItems') > 0, 'PT A detail capability returns permitted attention items');
select ok((public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'attentionItems')::text not like '%Athlete 4%', 'PT A attention detail excludes PT B client');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

-- 20-21: Bedford manager sees subtree aggregates but no athlete identities.
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'cohort'->>'count')::integer$$, array[5], 'Bedford manager aggregate includes both Bedford PT programmes');
select results_eq($$select jsonb_array_length(public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'attentionItems')$$, array[0], 'Aggregate-only manager receives no athlete detail rows');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

-- 22-23: Performance lead sees organisation aggregate and staff responsibility.
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'cohort'->>'count')::integer$$, array[6], 'Performance lead sees six actively shared organisation athletes');
select ok(jsonb_array_length(public.fuel_performance_staff_access('83000000-0000-0000-0000-000000000001')->'staff') >= 7, 'Performance lead can view staff activity and responsibility');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000006","role":"authenticated"}', true);

-- 24-25: organisation administration is distinct from data capability.
select throws_ok(
  $$select public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')$$,
  '42501', 'Performance access denied.', 'Admin without aggregate capability cannot run overview');
select lives_ok(
  $$select public.fuel_performance_save_unit('83000000-0000-0000-0000-000000000001', null, '84000000-0000-0000-0000-000000000001', 'Corporate Programme', 'Programme', 'Europe/London', 9)$$,
  'Admin with structure capability can add a scoped unit');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000007', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000007","role":"authenticated"}', true);

-- 26-27: the one-person Northampton view is server-side suppressed.
select results_eq($$select public.fuel_performance_reports('83000000-0000-0000-0000-000000000001')->>'status'$$, array['suppressed'::text], 'Northampton small cohort report is suppressed');
select results_eq($$select public.fuel_performance_reports('83000000-0000-0000-0000-000000000001')->>'reason'$$, array['Insufficient cohort size'::text], 'Suppression returns an explicit state, not zero');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000005', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000005","role":"authenticated"}', true);

-- 28-29: reportable organisation metrics are server-side and non-empty.
select results_eq($$select public.fuel_performance_reports('83000000-0000-0000-0000-000000000001')->>'status'$$, array['available'::text], 'Organisation report is available above minimum cohort');
select results_eq($$select (public.fuel_performance_reports('83000000-0000-0000-0000-000000000001')->'fuelling'->>'fuelEvents')::integer$$, array[6], 'Organisation report counts only permitted active-share fuel events');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 30-32: cross-organisation and direct-ID attacks fail closed.
select results_eq($$select count(*) from public.fuel_performance_context() where organisation_id = '83000000-0000-0000-0000-000000000002'$$, array[0::bigint], 'Other organisation is absent from PT A context');
select throws_ok($$select public.fuel_performance_overview('83000000-0000-0000-0000-000000000002')$$, '42501', 'Performance access denied.', 'Cross-organisation overview RPC is denied');
select throws_ok($$select public.fuel_performance_overview('83000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000006')$$, '22023', 'Unit does not belong to this organisation.', 'Cross-organisation unit ID is rejected');

-- 33-37: invited sharing grants nothing; athlete activation and revocation are immediate.
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'cohort'->>'count')::integer$$, array[3], 'Invited athlete is excluded from PT aggregate');
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000007', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select results_eq($$select public.fuel_athlete_set_organisation_sharing((select id from public.fuel_organisation_athlete_shares where athlete_id = '82000000-0000-0000-0000-000000000007'), 'active')$$, array['active'::text], 'Athlete can activate explicit organisation sharing');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'cohort'->>'count')::integer$$, array[4], 'Accepted sharing is immediately included');
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000007', true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select results_eq($$select public.fuel_athlete_set_organisation_sharing((select id from public.fuel_organisation_athlete_shares where athlete_id = '82000000-0000-0000-0000-000000000007'), 'revoked')$$, array['revoked'::text], 'Athlete can revoke organisation sharing without deleting history');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq($$select (public.fuel_performance_overview('83000000-0000-0000-0000-000000000001')->'cohort'->>'count')::integer$$, array[3], 'Revocation immediately removes the athlete from PT aggregate access');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000006","role":"authenticated"}', true);

-- 38-43: relationship identity columns and audit rows cannot be repointed/deleted.
select throws_ok($$update public.fuel_staff_scopes set unit_id = '84000000-0000-0000-0000-000000000005' where user_id = '81000000-0000-0000-0000-000000000004'$$, '42501', null, 'Scope relationship cannot be repointed');
select throws_ok($$update public.fuel_organisation_athlete_shares set athlete_id = '82000000-0000-0000-0000-000000000006' where athlete_id = '82000000-0000-0000-0000-000000000001'$$, '42501', null, 'Organisation sharing relationship cannot be repointed');
select throws_ok($$update public.fuel_staff_capabilities set capability = 'view_athlete_detail' where user_id = '81000000-0000-0000-0000-000000000004' and capability = 'view_staff_activity'$$, '42501', null, 'Capability relationship cannot be repointed');
select throws_ok($$delete from public.fuel_staff_capabilities where user_id = '81000000-0000-0000-0000-000000000004'$$, '42501', null, 'Capability audit rows cannot be deleted');
select throws_ok($$delete from public.fuel_staff_scopes where user_id = '81000000-0000-0000-0000-000000000004'$$, '42501', null, 'Scope audit rows cannot be deleted');
select throws_ok($$delete from public.fuel_organisation_athlete_shares where athlete_id = '82000000-0000-0000-0000-000000000001'$$, '42501', null, 'Sharing audit rows cannot be deleted');

select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000004', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000004","role":"authenticated"}', true);

-- 44-50: capability enforcement, membership lifecycle, assignment and anonymous access.
select throws_ok($$select public.fuel_performance_set_capability('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000004', 'view_athlete_detail', true)$$, '42501', 'Performance access denied.', 'View-only manager cannot grant capabilities');
select ok(not private.fuel_performance_has_capability('83000000-0000-0000-0000-000000000001', 'view_org_aggregates', '81000000-0000-0000-0000-000000000005'), 'Private helper cannot impersonate another staff user');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$select public.fuel_performance_set_staff_membership('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003', 'staff', false)$$, 'Access manager can deactivate staff membership without deleting grants');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select results_eq($$select count(*) from public.fuel_performance_context()$$, array[0::bigint], 'Inactive staff immediately lose Performance context');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000006', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$select public.fuel_performance_set_staff_membership('83000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000003', 'staff', true)$$, 'Access manager can safely reactivate existing staff membership');
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000007', true);
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$select public.fuel_performance_set_athlete_unit('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001', '84000000-0000-0000-0000-000000000005', true)$$, '42501', 'Performance access denied.', 'Staff without access-management capability cannot reassign an athlete by direct RPC');
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$select * from public.fuel_performance_context()$$, '42501', null, 'Anonymous caller cannot execute Performance context');

select * from finish();
rollback;
