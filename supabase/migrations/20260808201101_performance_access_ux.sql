-- Performance account and access UX support.
--
-- These functions expose the existing least-privilege organisation model
-- without requiring normal administrators to copy raw Auth UUIDs. Creating an
-- organisation still relies on the existing owner bootstrap triggers, which
-- grant organisation-management capabilities but not athlete-detail access.

create or replace function public.fuel_performance_create_organisation(
  p_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  organisation_id uuid;
  organisation_name text := nullif(trim(p_name), '');
begin
  if caller_id is null then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if organisation_name is null or char_length(organisation_name) > 160 then
    raise exception 'Organisation name must be between 1 and 160 characters.' using errcode = '22023';
  end if;

  insert into public.fuel_organisations (name, created_by)
  values (organisation_name, caller_id)
  returning id into organisation_id;

  return organisation_id;
end;
$$;

revoke all on function public.fuel_performance_create_organisation(text) from public, anon;
grant execute on function public.fuel_performance_create_organisation(text) to authenticated;

create or replace function public.fuel_performance_set_staff_membership_by_email(
  p_organisation_id uuid,
  p_email text,
  p_role text default 'staff',
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_id uuid;
  account_email text := lower(nullif(trim(p_email), ''));
begin
  -- Authorise before looking up the account so this cannot be used as a general
  -- Fuel Guard account-enumeration endpoint.
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if account_email is null or char_length(account_email) > 320 then
    raise exception 'Enter a valid Fuel Guard account email address.' using errcode = '22023';
  end if;

  select account.id
  into account_id
  from auth.users account
  where lower(account.email) = account_email
  limit 1;

  if account_id is null then
    raise exception 'No Fuel Guard account matches that email address.' using errcode = '22023';
  end if;

  perform public.fuel_performance_set_staff_membership(
    p_organisation_id,
    account_id,
    p_role,
    p_active
  );
  return account_id;
end;
$$;

revoke all on function public.fuel_performance_set_staff_membership_by_email(uuid, text, text, boolean) from public, anon;
grant execute on function public.fuel_performance_set_staff_membership_by_email(uuid, text, text, boolean) to authenticated;

create or replace function public.fuel_performance_staff_accounts(
  p_organisation_id uuid
)
returns table (
  user_id uuid,
  email text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;

  return query
  select member.user_id, account.email::text
  from public.fuel_organisation_members member
  join auth.users account on account.id = member.user_id
  where member.organisation_id = p_organisation_id
  order by lower(account.email), member.user_id;
end;
$$;

revoke all on function public.fuel_performance_staff_accounts(uuid) from public, anon;
grant execute on function public.fuel_performance_staff_accounts(uuid) to authenticated;
