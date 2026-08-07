-- Keep the migration ledger aligned with the already-applied production fix.
-- This definition also appears in the canonical Coach Beta bootstrap SQL.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.fuel_user_is_coach(check_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    check_user_id = (select auth.uid())
    and exists (
      select 1
      from public.fuel_user_profiles coach_profile
      where coach_profile.user_id = check_user_id
        and (coach_profile.coach_enabled is true or coach_profile.role = 'coach')
    );
$$;

revoke all on function private.fuel_user_is_coach(uuid) from public;
revoke execute on function private.fuel_user_is_coach(uuid) from anon;
grant execute on function private.fuel_user_is_coach(uuid) to authenticated;

drop policy if exists fuel_coach_athletes_insert_by_participant
  on public.fuel_coach_athletes;
create policy fuel_coach_athletes_insert_by_participant
  on public.fuel_coach_athletes
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and status = 'pending'
    and (select private.fuel_user_is_coach((select auth.uid())))
  );
