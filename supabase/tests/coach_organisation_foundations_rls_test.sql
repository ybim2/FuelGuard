begin;
select plan(47);

-- Fixed identities make policy failures easy to diagnose.
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach-b@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'athlete-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_user_profiles (user_id, role, coach_enabled, display_name) values
  ('10000000-0000-0000-0000-000000000001', 'coach', true, 'Coach A'),
  ('10000000-0000-0000-0000-000000000002', 'coach', true, 'Nutritionist A'),
  ('10000000-0000-0000-0000-000000000003', 'coach', true, 'Coach B'),
  ('10000000-0000-0000-0000-000000000101', 'athlete', false, 'Athlete A'),
  ('10000000-0000-0000-0000-000000000102', 'athlete', false, 'Athlete B');

insert into public.fuel_coach_athletes (
  coach_id,
  athlete_id,
  status,
  accepted_at
) values
  ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000101', 'active', now()),
  ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000101', 'active', now()),
  ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000102', 'active', now());

insert into public.fuel_targets (user_id, maximum_fuel_gap_minutes) values
  ('10000000-0000-0000-0000-000000000101', 180),
  ('10000000-0000-0000-0000-000000000102', 180);

insert into public.fuel_logs (user_id, logged_at, type, source) values
  ('10000000-0000-0000-0000-000000000101', '2026-08-08T21:00:00Z', 'fuel', 'manual'),
  ('10000000-0000-0000-0000-000000000102', '2026-08-08T21:30:00Z', 'fuel', 'manual');

-- 1-10: every exposed table has RLS enabled.
select ok(class.relrowsecurity, format('%s has RLS enabled', table_name))
from unnest(array[
  'fuel_organisations',
  'fuel_organisation_members',
  'fuel_teams',
  'fuel_team_staff',
  'fuel_team_athletes',
  'fuel_staff_notes',
  'fuel_saved_groups',
  'fuel_saved_group_members',
  'fuel_training_sessions',
  'fuel_training_session_athletes'
]) as tables(table_name)
join pg_class class on class.oid = format('public.%I', table_name)::regclass;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 11-12: Coach A can bootstrap an organisation and team; triggers add owner/manager rows.
select lives_ok(
  $$insert into public.fuel_organisations (id, name, created_by)
    values ('20000000-0000-0000-0000-000000000001', 'Organisation A', '10000000-0000-0000-0000-000000000001')$$,
  'Coach A can create Organisation A'
);
select lives_ok(
  $$insert into public.fuel_teams (id, organisation_id, name, timezone_name, created_by)
    values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'First Team', 'Europe/London', '10000000-0000-0000-0000-000000000001')$$,
  'Organisation owner can create a team'
);

-- 13-15: Organisation membership, staff access, and athlete membership are separate.
select lives_ok(
  $$insert into public.fuel_organisation_members (
      organisation_id, user_id, role, status, invited_by, joined_at
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'staff', 'active',
      '10000000-0000-0000-0000-000000000001', now()
    )$$,
  'Organisation owner can add a staff member'
);
select lives_ok(
  $$insert into public.fuel_team_staff (
      organisation_id, team_id, user_id, staff_role, access_level, status, added_by, joined_at
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      'performance_nutritionist', 'contributor', 'active',
      '10000000-0000-0000-0000-000000000001', now()
    )$$,
  'Team manager can add active organisation staff'
);
select lives_ok(
  $$insert into public.fuel_team_athletes (
      organisation_id, team_id, athlete_id, status, added_by, joined_at
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000101',
      'active', '10000000-0000-0000-0000-000000000001', now()
    )$$,
  'Team contributor with direct sharing can add an athlete'
);

-- 16: note creation records the authenticated author and server timestamp.
select lives_ok(
  $$insert into public.fuel_staff_notes (
      id, organisation_id, team_id, athlete_id, author_id, category, note_text
    ) values (
      '60000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000001',
      'coach_contact', 'Coach spoke to athlete.'
    )$$,
  'Authorised coach can add an immutable staff note'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 17-19: authorised staff collaborate and retain the original author audit fields.
select results_eq(
  $$select count(*) from public.fuel_staff_notes$$,
  array[1::bigint],
  'Authorised staff can see a colleague staff note'
);
select results_eq(
  $$select author_id from public.fuel_staff_notes where id = '60000000-0000-0000-0000-000000000001'$$,
  array['10000000-0000-0000-0000-000000000001'::uuid],
  'Shared note retains its original author ID'
);
select lives_ok(
  $$insert into public.fuel_staff_notes (
      organisation_id, team_id, athlete_id, author_id, category, note_text
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000002',
      'nutrition_reviewed', 'Nutritionist reviewed.'
    )$$,
  'Authorised contributor can add shared context'
);

-- 20: knowing Athlete B's UUID does not allow Staff A to write a note.
select throws_ok(
  $$insert into public.fuel_staff_notes (
      organisation_id, team_id, athlete_id, author_id, category, note_text
    ) values (
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000102',
      '10000000-0000-0000-0000-000000000002',
      'general', 'Must not be written.'
    )$$,
  '42501', null,
  'Unauthorised staff cannot write notes for another athlete'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

-- 21: athletes do not receive the internal staff record.
select results_eq(
  $$select count(*) from public.fuel_staff_notes$$,
  array[0::bigint],
  'Athlete cannot read internal staff notes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

-- 22-24: being a coach elsewhere creates no access into Organisation A.
select lives_ok(
  $$insert into public.fuel_organisations (id, name, created_by)
    values ('20000000-0000-0000-0000-000000000002', 'Organisation B', '10000000-0000-0000-0000-000000000003')$$,
  'Coach B can create a separate organisation'
);
select lives_ok(
  $$insert into public.fuel_teams (id, organisation_id, name, timezone_name, created_by)
    values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Academy', 'UTC', '10000000-0000-0000-0000-000000000003')$$,
  'Coach B can create a team in Organisation B'
);
select results_eq(
  $$select count(*) from public.fuel_staff_notes$$,
  array[0::bigint],
  'Coach in another organisation cannot read Organisation A notes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 25-27: saved groups support team scope but require direct athlete sharing.
select lives_ok(
  $$insert into public.fuel_saved_groups (
      id, scope, organisation_id, team_id, name, created_by
    ) values (
      '40000000-0000-0000-0000-000000000001', 'team',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'First Team', '10000000-0000-0000-0000-000000000001'
    )$$,
  'Team contributor can create a saved group'
);
select lives_ok(
  $$insert into public.fuel_saved_group_members (group_id, athlete_id, added_by)
    values (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  'Coach can add an actively shared team athlete to a group'
);
select throws_ok(
  $$insert into public.fuel_saved_group_members (group_id, athlete_id, added_by)
    values (
      '40000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000102',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  '42501', null,
  'Group membership cannot be created without athlete access'
);

-- Seed organisational metadata as the database owner to prove it still grants no access.
reset role;
insert into public.fuel_saved_group_members (group_id, athlete_id, added_by)
values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000102',
  '10000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 28-29: even an existing metadata row stays invisible and never unlocks logs.
select results_eq(
  $$select count(*) from public.fuel_authorised_group_roster where group_id = '40000000-0000-0000-0000-000000000001'$$,
  array[1::bigint],
  'Authorised group roster filters out athletes without sharing access'
);
select results_eq(
  $$select count(*) from public.fuel_logs where user_id = '10000000-0000-0000-0000-000000000102'$$,
  array[0::bigint],
  'Saved-group metadata never grants athlete log access'
);

-- 30-31: session date is the local date in its named timezone, not the UTC date.
select lives_ok(
  $$insert into public.fuel_training_sessions (
      id, organisation_id, team_id, saved_group_id, session_date,
      starts_at, ends_at, timezone_name, session_type, session_name,
      location, created_by, updated_by
    ) values (
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      '2026-08-09', '2026-08-08T23:30:00Z', '2026-08-09T01:30:00Z',
      'Europe/London', 'team_training', 'Afternoon training',
      'Training Ground',
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  'Manual training session accepts the correct Europe/London local date'
);
select throws_ok(
  $$insert into public.fuel_training_sessions (
      id, organisation_id, team_id, session_date, starts_at, ends_at,
      timezone_name, session_type, created_by, updated_by
    ) values (
      '50000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      '2026-08-08', '2026-08-08T23:30:00Z', '2026-08-09T01:30:00Z',
      'Europe/London', 'team_training',
      '10000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  '23514', null,
  'UTC date cannot be stored when it disagrees with the session timezone'
);

-- 32-34: explicit assignment, group linkage, and the bulk helper use the same model.
select lives_ok(
  $$insert into public.fuel_training_session_athletes (session_id, athlete_id, assigned_by)
    values (
      '50000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000001'
    )$$,
  'Authorised contributor can assign a shared team athlete'
);
select results_eq(
  $$select public.fuel_assign_training_session_group(
      '50000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001'
    )$$,
  array[0],
  'Group assignment is idempotent when the athlete is already assigned'
);
select results_eq(
  $$select count(*)
    from public.fuel_training_session_athletes
    where session_id = '50000000-0000-0000-0000-000000000001'$$,
  array[1::bigint],
  'Unauthorised seeded group metadata is not converted into a session assignment'
);

-- 35: a coach in another organisation cannot assign an athlete into Team A.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$insert into public.fuel_training_session_athletes (session_id, athlete_id, assigned_by)
    values (
      '50000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000102',
      '10000000-0000-0000-0000-000000000003'
    )$$,
  '42501', null,
  'Cross-organisation coach cannot assign an athlete'
);

-- 36: cross-organisation upcoming-session queries return no Team A rows.
select results_eq(
  $$select count(*) from public.fuel_upcoming_training_sessions(
      '2026-08-08T00:00:00Z', '2026-08-10T00:00:00Z', null
    )$$,
  array[0::bigint],
  'Cross-organisation coach cannot query Team A sessions'
);

-- 37-38: authorised staff receive the reusable schedule context, including close status.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_upcoming_training_sessions(
      '2026-08-08T00:00:00Z', '2026-08-10T00:00:00Z',
      '40000000-0000-0000-0000-000000000001'
    )$$,
  array[1::bigint],
  'Authorised staff can query upcoming sessions by saved group'
);
select results_eq(
  $$select gap_status, gap_minutes_at_start, maximum_fuel_gap_minutes
    from public.fuel_training_operational_context
    where session_id = '50000000-0000-0000-0000-000000000001'$$,
  $$values ('close'::text, 150, 180)$$,
  'Operational context compares timing with the configured threshold without changing it'
);

-- 39: contributor can manually update schedule details without changing ownership/source.
select lives_ok(
  $$update public.fuel_training_sessions
    set session_name = 'Updated training name'
    where id = '50000000-0000-0000-0000-000000000001'$$,
  'Authorised contributor can update a manual training session'
);

-- 40: assigned athlete sees their own upcoming session.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000101","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_upcoming_training_sessions(
      '2026-08-08T00:00:00Z', '2026-08-10T00:00:00Z', null
    )$$,
  array[1::bigint],
  'Assigned athlete can query their own upcoming session'
);

-- Revoke Coach A's direct share while keeping team, group, and assignment metadata.
reset role;
update public.fuel_coach_athletes
set status = 'revoked', revoked_at = now(), updated_at = now()
where coach_id = '10000000-0000-0000-0000-000000000001'
  and athlete_id = '10000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 41-44: revocation immediately removes athlete-specific group, note, context, and log access.
select results_eq(
  $$select count(*) from public.fuel_authorised_group_roster
    where group_id = '40000000-0000-0000-0000-000000000001'$$,
  array[0::bigint],
  'Revoked relationship hides saved-group membership'
);
select results_eq(
  $$select count(*) from public.fuel_staff_notes where athlete_id = '10000000-0000-0000-0000-000000000101'$$,
  array[0::bigint],
  'Revoked relationship hides shared staff notes'
);
select results_eq(
  $$select count(*) from public.fuel_training_operational_context
    where athlete_id = '10000000-0000-0000-0000-000000000101'$$,
  array[0::bigint],
  'Revoked relationship hides athlete-specific training context'
);
select results_eq(
  $$select count(*) from public.fuel_logs where user_id = '10000000-0000-0000-0000-000000000101'$$,
  array[0::bigint],
  'Revoked relationship still hides existing athlete logs'
);

-- 45: another genuinely authorised staff member continues to collaborate.
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_staff_notes where athlete_id = '10000000-0000-0000-0000-000000000101'$$,
  array[2::bigint],
  'Revoking one coach does not revoke another authorised staff member'
);

-- Restore Coach A only to verify group deletion does not delete the scheduled session.
reset role;
update public.fuel_coach_athletes
set status = 'active', revoked_at = null, updated_at = now()
where coach_id = '10000000-0000-0000-0000-000000000001'
  and athlete_id = '10000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 46-47: groups can be deleted; assignments survive and the optional group link is cleared.
select lives_ok(
  $$delete from public.fuel_saved_groups where id = '40000000-0000-0000-0000-000000000001'$$,
  'Authorised group owner can delete a saved group'
);
select results_eq(
  $$select saved_group_id, count(*) over ()
    from public.fuel_training_sessions
    where id = '50000000-0000-0000-0000-000000000001'$$,
  $$values (null::uuid, 1::bigint)$$,
  'Deleting a group clears its optional session link without deleting the session'
);

select * from finish();
rollback;
