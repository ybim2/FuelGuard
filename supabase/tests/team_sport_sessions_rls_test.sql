begin;
select plan(34);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'team-coach-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'team-coach-b@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'team-athlete-a@fuelguard.test', '', now(), '{}', '{}', now(), now()),
  ('11000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'team-athlete-b@fuelguard.test', '', now(), '{}', '{}', now(), now());

insert into public.fuel_user_profiles (user_id, role, coach_enabled, display_name) values
  ('11000000-0000-0000-0000-000000000001', 'coach', true, 'Team Coach A'),
  ('11000000-0000-0000-0000-000000000002', 'coach', true, 'Team Coach B'),
  ('11000000-0000-0000-0000-000000000101', 'athlete', false, 'Team Athlete A'),
  ('11000000-0000-0000-0000-000000000102', 'athlete', false, 'Team Athlete B');

insert into public.fuel_coach_athletes (coach_id, athlete_id, status, accepted_at) values
  ('11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000101', 'active', now()),
  ('11000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000102', 'active', now());

insert into public.fuel_targets (user_id, maximum_fuel_gap_minutes) values
  ('11000000-0000-0000-0000-000000000101', 180),
  ('11000000-0000-0000-0000-000000000102', 180);

insert into public.fuel_logs (user_id, logged_at, type, source) values
  ('11000000-0000-0000-0000-000000000101', '2026-08-09T16:30:00Z', 'fuel', 'manual'),
  ('11000000-0000-0000-0000-000000000101', '2026-08-09T21:45:00Z', 'fuel', 'manual');

-- 1-3: internal membership history and coach notes are explicitly protected.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fuel_team_athlete_membership_periods'::regclass),
  'Team membership history has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.fuel_training_session_coach_notes'::regclass),
  'Team session coach notes have RLS enabled'
);
select results_eq(
  $$select count(*) from pg_policies
    where schemaname = 'public'
      and tablename = 'fuel_team_athlete_membership_periods'
      and policyname = 'fuel_team_athlete_membership_periods_select_authorised'$$,
  array[1::bigint],
  'Membership-history access is protected by an explicit RLS policy'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 4-6: Coach A creates an organisation, team and active team athlete.
select lives_ok(
  $$insert into public.fuel_organisations (id, name, created_by)
    values ('21000000-0000-0000-0000-000000000001', 'Team Organisation A', '11000000-0000-0000-0000-000000000001')$$,
  'Coach A can create Team Organisation A'
);
select lives_ok(
  $$insert into public.fuel_teams (id, organisation_id, name, timezone_name, created_by)
    values ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'First Team', 'UTC', '11000000-0000-0000-0000-000000000001')$$,
  'Coach A can create a generic team unit'
);
select lives_ok(
  $$insert into public.fuel_team_athletes (
      id, organisation_id, team_id, athlete_id, status, added_by, joined_at
    ) values (
      '41000000-0000-0000-0000-000000000101',
      '21000000-0000-0000-0000-000000000001',
      '31000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000101', 'active',
      '11000000-0000-0000-0000-000000000001', '2026-08-01T00:00:00Z'
    )$$,
  'Authorised coach can add an actively shared athlete to the team'
);

-- 7: one team-tenure row is created, not one row per team session.
reset role;
select results_eq(
  $$select count(*) from public.fuel_team_athlete_membership_periods
    where team_athlete_id = '41000000-0000-0000-0000-000000000101'$$,
  array[1::bigint],
  'Active team membership creates one dated membership period'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- 8-11: atomic creation saves a private note and no athlete assignment rows.
select lives_ok(
  $$select set_config(
      'test.team_session_id',
      public.fuel_save_team_session(
        null,
        '31000000-0000-0000-0000-000000000001',
        '2026-08-09T19:00:00Z', '2026-08-09T21:00:00Z',
        'UTC', 'training', 'Sunday training', 'Training ground', 'Internal preparation note'
      )::text,
      true
    )$$,
  'Authorised contributor can create a team-wide session atomically'
);
select results_eq(
  $$select count(*) from public.fuel_training_sessions
    where id = current_setting('test.team_session_id')::uuid
      and audience_scope = 'team' and status = 'scheduled'$$,
  array[1::bigint],
  'Created session is team-wide and scheduled'
);
select results_eq(
  $$select count(*) from public.fuel_training_session_athletes
    where session_id = current_setting('test.team_session_id')::uuid$$,
  array[0::bigint],
  'Team session creation does not create per-athlete assignment rows'
);
select results_eq(
  $$select count(*) from public.fuel_training_session_coach_notes
    where session_id = current_setting('test.team_session_id')::uuid
      and note_text = 'Internal preparation note'$$,
  array[1::bigint],
  'Coach note is saved in the staff-only table'
);

-- 12-14: the coach receives the expected pre/post classifications and one row.
select results_eq(
  $$select pre_session_status, gap_minutes_at_start
    from public.fuel_team_session_context('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  $$values ('yellow'::text, 150)$$,
  'Pre-session status is yellow at 30 minutes before the configured maximum gap'
);
select results_eq(
  $$select post_session_status, post_fuel_gap_minutes
    from public.fuel_team_session_context('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  $$values ('prompt'::text, 45)$$,
  'Post-session status is prompt when Fuel is recorded within 60 minutes'
);
select results_eq(
  $$select count(*) from public.fuel_team_session_context('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[1::bigint],
  'Coach sees exactly one directly shared athlete context row'
);

-- 15-17: Athlete A sees their schedule but never the coach note; Athlete B is not yet a member.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000101","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_athlete_team_sessions('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[1::bigint],
  'Active athlete automatically sees the shared team session'
);
select results_eq(
  $$select count(*) from public.fuel_training_session_coach_notes$$,
  array[0::bigint],
  'Athlete cannot read the private coach note'
);
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000102","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_athlete_team_sessions('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[0::bigint],
  'Knowing the date range does not expose a session to a non-member athlete'
);

-- Create an isolated second organisation without spending assertions on setup.
reset role;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into public.fuel_organisations (id, name, created_by)
values ('21000000-0000-0000-0000-000000000002', 'Team Organisation B', '11000000-0000-0000-0000-000000000002');
insert into public.fuel_organisation_members (
  organisation_id, user_id, role, status, invited_by, joined_at
) values (
  '21000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002',
  'owner', 'active', '11000000-0000-0000-0000-000000000002', now()
) on conflict do nothing;
insert into public.fuel_teams (id, organisation_id, name, timezone_name, created_by)
values ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', 'Other Team', 'UTC', '11000000-0000-0000-0000-000000000002');
insert into public.fuel_team_staff (
  organisation_id, team_id, user_id, staff_role, access_level, status, added_by, joined_at
) values (
  '21000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000002',
  '11000000-0000-0000-0000-000000000002', 'head_coach', 'manager', 'active',
  '11000000-0000-0000-0000-000000000002', now()
) on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

-- 18-20: cross-organisation and direct-ID attempts disclose and mutate nothing.
select results_eq(
  $$select count(*) from public.fuel_training_sessions
    where id = current_setting('test.team_session_id')::uuid$$,
  array[0::bigint],
  'Cross-organisation coach cannot read Team A session'
);
select results_eq(
  $$select count(*) from public.fuel_team_session_context('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[0::bigint],
  'Cross-organisation coach cannot read Team A session context'
);
select results_eq(
  $$select public.fuel_cancel_team_session(current_setting('test.team_session_id')::uuid)$$,
  array[false],
  'Cross-organisation direct-ID cancellation attempt is blocked'
);

-- Add Athlete B to Team A as trusted setup. Team membership grants own schedule
-- context, but Coach A still lacks direct access to Athlete B data.
reset role;
insert into public.fuel_team_athletes (
  id, organisation_id, team_id, athlete_id, status, added_by, joined_at
) values (
  '41000000-0000-0000-0000-000000000102',
  '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001',
  '11000000-0000-0000-0000-000000000102', 'active',
  '11000000-0000-0000-0000-000000000001', '2026-08-01T00:00:00Z'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000102', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000102","role":"authenticated"}', true);

-- 21: active team membership applies the shared session automatically.
select results_eq(
  $$select count(*) from public.fuel_athlete_team_sessions('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[1::bigint],
  'Second active athlete receives the same session without an assignment row'
);

-- 22: team membership alone still does not expose Athlete B data to Coach A.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_team_session_context('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[1::bigint],
  'Coach visibility still requires a direct active Athlete relationship'
);

-- End Athlete A membership after the completed session, then create a session
-- during the absence and a session after rejoining.
reset role;
update public.fuel_team_athletes
set status = 'revoked', revoked_at = '2026-08-10T00:00:00Z'
where id = '41000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

-- 23: departure does not rewrite completed team-session history.
select results_eq(
  $$select count(*) from public.fuel_athlete_team_sessions('2026-08-09T00:00:00Z', '2026-08-10T00:00:00Z')$$,
  array[1::bigint],
  'Athlete retains historical team session context after leaving'
);

reset role;
insert into public.fuel_training_sessions (
  id, organisation_id, team_id, audience_scope, status, session_date,
  starts_at, ends_at, timezone_name, session_type, session_name, created_by, updated_by
) values (
  '51000000-0000-0000-0000-000000000002',
  '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001', 'team', 'scheduled', '2026-08-10',
  '2026-08-10T12:00:00Z', '2026-08-10T13:00:00Z', 'UTC', 'other', 'During absence',
  '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

-- 24: a session during an absence is not retroactively exposed.
select results_eq(
  $$select count(*) from public.fuel_athlete_team_sessions('2026-08-09T00:00:00Z', '2026-08-11T00:00:00Z')$$,
  array[1::bigint],
  'Athlete does not receive a team session held while membership was inactive'
);

reset role;
update public.fuel_team_athletes
set status = 'active', joined_at = '2026-08-10T14:00:00Z', revoked_at = null
where id = '41000000-0000-0000-0000-000000000101';

-- 25: rejoining appends a second period rather than rewriting the first.
select results_eq(
  $$select count(*) from public.fuel_team_athlete_membership_periods
    where team_athlete_id = '41000000-0000-0000-0000-000000000101'$$,
  array[2::bigint],
  'Rejoining appends a new membership period'
);

insert into public.fuel_training_sessions (
  id, organisation_id, team_id, audience_scope, status, session_date,
  starts_at, ends_at, timezone_name, session_type, session_name, created_by, updated_by
) values (
  '51000000-0000-0000-0000-000000000003',
  '21000000-0000-0000-0000-000000000001',
  '31000000-0000-0000-0000-000000000001', 'team', 'scheduled', '2026-08-10',
  '2026-08-10T15:00:00Z', '2026-08-10T16:00:00Z', 'UTC', 'game', 'After rejoining',
  '11000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000101', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000101","role":"authenticated"}', true);

-- 26: the athlete receives the original and post-rejoin sessions, not the gap.
select results_eq(
  $$select count(*) from public.fuel_athlete_team_sessions('2026-08-09T00:00:00Z', '2026-08-11T00:00:00Z')$$,
  array[2::bigint],
  'Athlete schedule respects both historical membership periods'
);

-- 27: completed/past session deletion is blocked by RLS.
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
delete from public.fuel_training_sessions
where id = current_setting('test.team_session_id')::uuid;
select results_eq(
  $$select count(*) from public.fuel_training_sessions
    where id = current_setting('test.team_session_id')::uuid$$,
  array[1::bigint],
  'Past team session deletion is blocked to preserve history'
);

-- 28-29: completed team-session fields and cancellation state are immutable.
update public.fuel_training_sessions
set session_name = 'Rewritten history'
where id = current_setting('test.team_session_id')::uuid;
select results_eq(
  $$select session_name from public.fuel_training_sessions
    where id = current_setting('test.team_session_id')::uuid$$,
  $$values ('Sunday training'::text)$$,
  'Past team session schedule fields cannot be rewritten'
);
select results_eq(
  $$select public.fuel_cancel_team_session(current_setting('test.team_session_id')::uuid)$$,
  array[false],
  'Past team session cannot be cancelled after it starts'
);

-- Create a future session for cancellation and immutability checks.
select set_config(
  'test.future_session_id',
  public.fuel_save_team_session(
    null,
    '31000000-0000-0000-0000-000000000001',
    now() + interval '2 days', now() + interval '2 days 2 hours',
    'UTC', 'game', 'Future game', '', ''
  )::text,
  true
);

-- 30: identity cannot be repointed even when both team IDs are known.
select throws_ok(
  $$update public.fuel_training_sessions
    set team_id = '31000000-0000-0000-0000-000000000002'
    where id = current_setting('test.future_session_id')::uuid$$,
  '42501', null,
  'Team session identity cannot be repointed by direct ID'
);

-- 31-33: cancellation is authorised, attributed and irreversible.
select results_eq(
  $$select public.fuel_cancel_team_session(current_setting('test.future_session_id')::uuid)$$,
  array[true],
  'Authorised contributor can cancel a future team session'
);
select results_eq(
  $$select status, cancelled_by
    from public.fuel_training_sessions
    where id = current_setting('test.future_session_id')::uuid$$,
  $$values ('cancelled'::text, '11000000-0000-0000-0000-000000000001'::uuid)$$,
  'Cancellation retains an auditable actor'
);
select throws_ok(
  $$update public.fuel_training_sessions set status = 'scheduled'
    where id = current_setting('test.future_session_id')::uuid$$,
  '42501', null,
  'Cancelled team session cannot be reopened'
);

-- 34: relationship revocation removes Coach A athlete timing data immediately.
reset role;
update public.fuel_coach_athletes
set status = 'revoked', revoked_at = now(), updated_at = now()
where coach_id = '11000000-0000-0000-0000-000000000001'
  and athlete_id = '11000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$select count(*) from public.fuel_team_session_context('2026-08-09T00:00:00Z', now() + interval '3 days')$$,
  array[0::bigint],
  'Coach relationship revocation removes athlete timing context'
);

select * from finish();
rollback;
