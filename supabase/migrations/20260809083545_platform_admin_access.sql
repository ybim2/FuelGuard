-- Fuel Guard internal platform-administrator access.
--
-- Platform administrators are a separate, explicitly granted and revocable
-- operator class. Access to customer/demo organisations is also explicit per
-- organisation. The Performance capability/scope helpers recognise that
-- context, while active athlete sharing and unit assignment remain mandatory.

create table private.fuel_platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  reason text not null,
  updated_at timestamptz not null default now(),
  constraint fuel_platform_admins_status_check
    check (status in ('active', 'revoked')),
  constraint fuel_platform_admins_reason_check
    check (char_length(trim(reason)) between 1 and 500),
  constraint fuel_platform_admins_revocation_check
    check ((status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null))
);

create table private.fuel_platform_admin_organisation_access (
  id uuid primary key default gen_random_uuid(),
  platform_admin_user_id uuid not null
    references private.fuel_platform_admins(user_id) on delete cascade,
  organisation_id uuid not null
    references public.fuel_organisations(id) on delete cascade,
  status text not null default 'active',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  reason text not null,
  updated_at timestamptz not null default now(),
  constraint fuel_platform_admin_organisation_access_unique
    unique (platform_admin_user_id, organisation_id),
  constraint fuel_platform_admin_organisation_access_status_check
    check (status in ('active', 'revoked')),
  constraint fuel_platform_admin_organisation_access_reason_check
    check (char_length(trim(reason)) between 1 and 500),
  constraint fuel_platform_admin_organisation_access_revocation_check
    check ((status = 'active' and revoked_at is null)
      or (status = 'revoked' and revoked_at is not null))
);

create table private.fuel_platform_admin_audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  platform_admin_user_id uuid references auth.users(id) on delete set null,
  organisation_id uuid references public.fuel_organisations(id) on delete set null,
  event_type text not null,
  reason text not null,
  event_at timestamptz not null default now(),
  constraint fuel_platform_admin_audit_event_type_check
    check (event_type in (
      'platform_admin_granted',
      'platform_admin_revoked',
      'organisation_access_granted',
      'organisation_access_revoked'
    )),
  constraint fuel_platform_admin_audit_reason_check
    check (char_length(trim(reason)) between 1 and 500)
);

create index fuel_platform_admins_status_idx
  on private.fuel_platform_admins (status, user_id);
create index fuel_platform_admins_granted_by_idx
  on private.fuel_platform_admins (granted_by)
  where granted_by is not null;
create index fuel_platform_admins_revoked_by_idx
  on private.fuel_platform_admins (revoked_by)
  where revoked_by is not null;
create index fuel_platform_admin_org_access_org_status_idx
  on private.fuel_platform_admin_organisation_access
  (organisation_id, status, platform_admin_user_id);
create index fuel_platform_admin_org_access_user_status_idx
  on private.fuel_platform_admin_organisation_access
  (platform_admin_user_id, status, organisation_id);
create index fuel_platform_admin_org_access_granted_by_idx
  on private.fuel_platform_admin_organisation_access (granted_by)
  where granted_by is not null;
create index fuel_platform_admin_org_access_revoked_by_idx
  on private.fuel_platform_admin_organisation_access (revoked_by)
  where revoked_by is not null;
create index fuel_platform_admin_audit_actor_idx
  on private.fuel_platform_admin_audit_events (actor_user_id, event_at desc)
  where actor_user_id is not null;
create index fuel_platform_admin_audit_subject_idx
  on private.fuel_platform_admin_audit_events
  (platform_admin_user_id, event_at desc)
  where platform_admin_user_id is not null;
create index fuel_platform_admin_audit_org_idx
  on private.fuel_platform_admin_audit_events (organisation_id, event_at desc)
  where organisation_id is not null;

revoke all on table private.fuel_platform_admins
  from public, anon, authenticated;
revoke all on table private.fuel_platform_admin_organisation_access
  from public, anon, authenticated;
revoke all on table private.fuel_platform_admin_audit_events
  from public, anon, authenticated;

create or replace function private.fuel_platform_admin_prevent_identity_repoint()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_table_name = 'fuel_platform_admins' then
    if old.user_id is distinct from new.user_id then
      raise exception 'Platform administrator identity is immutable.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'fuel_platform_admin_organisation_access' then
    if old.platform_admin_user_id is distinct from new.platform_admin_user_id
       or old.organisation_id is distinct from new.organisation_id then
      raise exception 'Platform administrator organisation access identity is immutable.' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.fuel_platform_admin_record_audit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
  actor_id uuid;
  subject_id uuid;
  target_organisation_id uuid;
  event_reason text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;

  if tg_table_name = 'fuel_platform_admins' then
    event_name := case when new.status = 'active'
      then 'platform_admin_granted' else 'platform_admin_revoked' end;
    actor_id := coalesce((select auth.uid()),
      case when new.status = 'active' then new.granted_by else new.revoked_by end);
    subject_id := new.user_id;
    target_organisation_id := null;
  else
    event_name := case when new.status = 'active'
      then 'organisation_access_granted' else 'organisation_access_revoked' end;
    actor_id := coalesce((select auth.uid()),
      case when new.status = 'active' then new.granted_by else new.revoked_by end);
    subject_id := new.platform_admin_user_id;
    target_organisation_id := new.organisation_id;
  end if;
  event_reason := new.reason;

  insert into private.fuel_platform_admin_audit_events (
    actor_user_id,
    platform_admin_user_id,
    organisation_id,
    event_type,
    reason
  ) values (
    actor_id,
    subject_id,
    target_organisation_id,
    event_name,
    event_reason
  );
  return new;
end;
$$;

revoke all on function private.fuel_platform_admin_prevent_identity_repoint()
  from public, anon, authenticated;
revoke all on function private.fuel_platform_admin_record_audit_event()
  from public, anon, authenticated;

create trigger fuel_platform_admins_identity_trigger
  before update on private.fuel_platform_admins
  for each row execute function private.fuel_platform_admin_prevent_identity_repoint();
create trigger fuel_platform_admin_org_access_identity_trigger
  before update on private.fuel_platform_admin_organisation_access
  for each row execute function private.fuel_platform_admin_prevent_identity_repoint();
create trigger fuel_platform_admins_audit_trigger
  after insert or update of status on private.fuel_platform_admins
  for each row execute function private.fuel_platform_admin_record_audit_event();
create trigger fuel_platform_admin_org_access_audit_trigger
  after insert or update of status
  on private.fuel_platform_admin_organisation_access
  for each row execute function private.fuel_platform_admin_record_audit_event();

create or replace function private.fuel_is_active_platform_admin(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = (select auth.uid())
    and exists (
      select 1
      from private.fuel_platform_admins platform_admin
      where platform_admin.user_id = p_user_id
        and platform_admin.status = 'active'
        and platform_admin.revoked_at is null
    );
$$;

create or replace function private.fuel_platform_admin_has_organisation_access(
  p_organisation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = (select auth.uid())
    and private.fuel_is_active_platform_admin(p_user_id)
    and exists (
      select 1
      from private.fuel_platform_admin_organisation_access access_grant
      where access_grant.organisation_id = p_organisation_id
        and access_grant.platform_admin_user_id = p_user_id
        and access_grant.status = 'active'
        and access_grant.revoked_at is null
    );
$$;

revoke all on function private.fuel_is_active_platform_admin(uuid)
  from public, anon, authenticated;
revoke all on function private.fuel_platform_admin_has_organisation_access(uuid, uuid)
  from public, anon, authenticated;

create or replace function private.fuel_performance_has_capability(
  p_organisation_id uuid,
  p_capability text,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = (select auth.uid())
    and (
      exists (
        select 1
        from public.fuel_organisation_members member
        join public.fuel_staff_capabilities capability
          on capability.organisation_id = member.organisation_id
         and capability.user_id = member.user_id
        where member.organisation_id = p_organisation_id
          and member.user_id = p_user_id
          and member.status = 'active'
          and capability.capability = p_capability
          and capability.status = 'active'
      )
      or (
        p_capability = any (array[
          'view_performance',
          'view_org_aggregates',
          'view_athlete_detail',
          'view_staff_activity',
          'view_interventions',
          'manage_structure',
          'manage_staff_access',
          'manage_reports',
          'manage_interventions'
        ])
        and private.fuel_platform_admin_has_organisation_access(
          p_organisation_id,
          p_user_id
        )
      )
    );
$$;

create or replace function private.fuel_performance_unit_in_scope(
  p_organisation_id uuid,
  p_unit_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select p_user_id is not null
    and p_user_id = (select auth.uid())
    and (
      private.fuel_platform_admin_has_organisation_access(
        p_organisation_id,
        p_user_id
      )
      or exists (
        select 1
        from public.fuel_staff_scopes scope
        join public.fuel_organisation_members member
          on member.organisation_id = scope.organisation_id
         and member.user_id = scope.user_id
        where scope.organisation_id = p_organisation_id
          and scope.user_id = p_user_id
          and scope.status = 'active'
          and member.status = 'active'
          and (
            scope.scope_type = 'organisation'
            or (
              scope.scope_type = 'unit'
              and (
                scope.unit_id = p_unit_id
                or (scope.include_descendants
                  and private.fuel_performance_unit_is_descendant(
                    p_organisation_id,
                    p_unit_id,
                    scope.unit_id
                  ))
              )
            )
          )
      )
    );
$$;

revoke all on function private.fuel_performance_has_capability(uuid, text, uuid)
  from public, anon;
grant execute on function private.fuel_performance_has_capability(uuid, text, uuid)
  to authenticated;
revoke all on function private.fuel_performance_unit_in_scope(uuid, uuid, uuid)
  from public, anon;
grant execute on function private.fuel_performance_unit_in_scope(uuid, uuid, uuid)
  to authenticated;

create or replace function private.fuel_bootstrap_team_manager()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.created_by is distinct from (select auth.uid()) then
    raise exception 'Team creator must match the authenticated user' using errcode = '42501';
  end if;

  -- Platform administrators remain a separate operator class rather than
  -- receiving an ordinary organisation/team membership as a side effect.
  if private.fuel_platform_admin_has_organisation_access(
    new.organisation_id,
    new.created_by
  ) then
    return new;
  end if;

  insert into public.fuel_team_staff (
    organisation_id,
    team_id,
    user_id,
    staff_role,
    access_level,
    status,
    added_by,
    joined_at
  ) values (
    new.organisation_id,
    new.id,
    new.created_by,
    'head_coach',
    'manager',
    'active',
    new.created_by,
    now()
  );
  return new;
end;
$$;

revoke all on function private.fuel_bootstrap_team_manager()
  from public, anon, authenticated;

create or replace function private.fuel_bootstrap_organisation_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.created_by is distinct from (select auth.uid()) then
    raise exception 'Organisation creator must match the authenticated user' using errcode = '42501';
  end if;

  -- A platform administrator receives an explicit platform organisation
  -- context below. Do not silently turn that operator into the customer owner;
  -- this keeps platform access independently revocable.
  if private.fuel_is_active_platform_admin(new.created_by) then
    return new;
  end if;

  insert into public.fuel_organisation_members (
    organisation_id,
    user_id,
    role,
    status,
    invited_by,
    joined_at
  ) values (
    new.id,
    new.created_by,
    'owner',
    'active',
    new.created_by,
    now()
  );
  return new;
end;
$$;

revoke all on function private.fuel_bootstrap_organisation_owner()
  from public, anon, authenticated;

create or replace function public.fuel_performance_context()
returns table (
  organisation_id uuid,
  organisation_name text,
  minimum_reporting_cohort integer,
  capabilities text[],
  can_manage_structure boolean,
  can_manage_access boolean,
  can_manage_reports boolean
)
language sql
security definer
stable
set search_path = ''
as $$
  with ordinary_context as (
    select
      organisation.id as organisation_id,
      organisation.name as organisation_name,
      organisation.minimum_reporting_cohort,
      array_agg(capability.capability order by capability.capability) as capabilities,
      bool_or(capability.capability = 'manage_structure') as can_manage_structure,
      bool_or(capability.capability = 'manage_staff_access') as can_manage_access,
      bool_or(capability.capability = 'manage_reports') as can_manage_reports,
      false as platform_context
    from public.fuel_organisations organisation
    join public.fuel_organisation_members member
      on member.organisation_id = organisation.id
     and member.user_id = (select auth.uid())
     and member.status = 'active'
    join public.fuel_staff_capabilities capability
      on capability.organisation_id = organisation.id
     and capability.user_id = member.user_id
     and capability.status = 'active'
    where (select auth.uid()) is not null
      and exists (
        select 1 from public.fuel_staff_capabilities entry
        where entry.organisation_id = organisation.id
          and entry.user_id = member.user_id
          and entry.capability = 'view_performance'
          and entry.status = 'active'
      )
      and exists (
        select 1 from public.fuel_staff_scopes scope
        where scope.organisation_id = organisation.id
          and scope.user_id = member.user_id
          and scope.status = 'active'
      )
    group by organisation.id, organisation.name,
      organisation.minimum_reporting_cohort
  ),
  platform_context as (
    select
      organisation.id as organisation_id,
      organisation.name as organisation_name,
      organisation.minimum_reporting_cohort,
      array[
        'manage_interventions',
        'manage_reports',
        'manage_staff_access',
        'manage_structure',
        'view_athlete_detail',
        'view_interventions',
        'view_org_aggregates',
        'view_performance',
        'view_staff_activity'
      ]::text[] as capabilities,
      true as can_manage_structure,
      true as can_manage_access,
      true as can_manage_reports,
      true as platform_context
    from public.fuel_organisations organisation
    join private.fuel_platform_admin_organisation_access access_grant
      on access_grant.organisation_id = organisation.id
     and access_grant.platform_admin_user_id = (select auth.uid())
     and access_grant.status = 'active'
     and access_grant.revoked_at is null
    join private.fuel_platform_admins platform_admin
      on platform_admin.user_id = access_grant.platform_admin_user_id
     and platform_admin.status = 'active'
     and platform_admin.revoked_at is null
    where (select auth.uid()) is not null
  ),
  resolved as (
    select * from ordinary_context
    union all
    select * from platform_context
  )
  select distinct on (resolved.organisation_id)
    resolved.organisation_id,
    resolved.organisation_name,
    resolved.minimum_reporting_cohort,
    resolved.capabilities,
    resolved.can_manage_structure,
    resolved.can_manage_access,
    resolved.can_manage_reports
  from resolved
  order by resolved.organisation_id, resolved.platform_context desc;
$$;

revoke all on function public.fuel_performance_context()
  from public, anon;
grant execute on function public.fuel_performance_context()
  to authenticated;

create or replace function public.fuel_platform_admin_context()
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then
      jsonb_build_object(
        'isPlatformAdmin', false,
        'organisations', '[]'::jsonb
      )
    else
      jsonb_build_object(
        'isPlatformAdmin', private.fuel_is_active_platform_admin(),
        'organisations', coalesce((
          select jsonb_agg(jsonb_build_object(
            'organisationId', organisation.id,
            'organisationName', organisation.name,
            'grantedAt', access_grant.granted_at,
            'reason', access_grant.reason
          ) order by organisation.name)
          from private.fuel_platform_admin_organisation_access access_grant
          join public.fuel_organisations organisation
            on organisation.id = access_grant.organisation_id
          where access_grant.platform_admin_user_id = (select auth.uid())
            and access_grant.status = 'active'
            and access_grant.revoked_at is null
            and private.fuel_is_active_platform_admin()
        ), '[]'::jsonb)
      )
  end;
$$;

revoke all on function public.fuel_platform_admin_context()
  from public, anon;
grant execute on function public.fuel_platform_admin_context()
  to authenticated;

create or replace function public.fuel_platform_admin_set_organisation_access_by_email(
  p_organisation_id uuid,
  p_email text,
  p_active boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  access_id uuid;
  access_reason text := nullif(trim(p_reason), '');
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(
       p_organisation_id,
       'manage_staff_access'
     ) then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if access_reason is null or char_length(access_reason) > 500 then
    raise exception 'A reason between 1 and 500 characters is required.' using errcode = '22023';
  end if;

  -- Authorise before the Auth lookup. Only an active platform administrator
  -- can be selected, so this is not a general account-enumeration endpoint.
  select platform_admin.user_id
  into target_user_id
  from private.fuel_platform_admins platform_admin
  join auth.users account on account.id = platform_admin.user_id
  where platform_admin.status = 'active'
    and platform_admin.revoked_at is null
    and lower(account.email) = lower(trim(p_email))
  limit 1;

  if target_user_id is null then
    raise exception 'No active Fuel Guard platform administrator matches that email.' using errcode = '22023';
  end if;

  insert into private.fuel_platform_admin_organisation_access (
    platform_admin_user_id,
    organisation_id,
    status,
    granted_by,
    granted_at,
    revoked_by,
    revoked_at,
    reason
  ) values (
    target_user_id,
    p_organisation_id,
    case when p_active then 'active' else 'revoked' end,
    case when p_active then (select auth.uid()) else null end,
    now(),
    case when p_active then null else (select auth.uid()) end,
    case when p_active then null else now() end,
    access_reason
  )
  on conflict (platform_admin_user_id, organisation_id)
  do update set
    status = excluded.status,
    granted_by = case when p_active then (select auth.uid())
      else private.fuel_platform_admin_organisation_access.granted_by end,
    granted_at = case when p_active then now()
      else private.fuel_platform_admin_organisation_access.granted_at end,
    revoked_by = case when p_active then null else (select auth.uid()) end,
    revoked_at = case when p_active then null else now() end,
    reason = access_reason,
    updated_at = now()
  returning id into access_id;

  return access_id;
end;
$$;

revoke all on function public.fuel_platform_admin_set_organisation_access_by_email(uuid, text, boolean, text)
  from public, anon;
grant execute on function public.fuel_platform_admin_set_organisation_access_by_email(uuid, text, boolean, text)
  to authenticated;

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
  created_organisation_id uuid;
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
  returning id into created_organisation_id;

  if private.fuel_is_active_platform_admin(caller_id) then
    insert into private.fuel_platform_admin_organisation_access (
      platform_admin_user_id,
      organisation_id,
      status,
      granted_by,
      reason
    ) values (
      caller_id,
      created_organisation_id,
      'active',
      caller_id,
      'Platform administrator created this demo/support organisation.'
    )
    on conflict (platform_admin_user_id, organisation_id)
    do update set
      status = 'active',
      granted_by = caller_id,
      granted_at = now(),
      revoked_by = null,
      revoked_at = null,
      reason = excluded.reason,
      updated_at = now();
  end if;

  return created_organisation_id;
end;
$$;

revoke all on function public.fuel_performance_create_organisation(text)
  from public, anon;
grant execute on function public.fuel_performance_create_organisation(text)
  to authenticated;

create or replace function public.fuel_performance_set_capability(
  p_organisation_id uuid,
  p_user_id uuid,
  p_capability text,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Staff cannot change their own Performance capabilities.' using errcode = '42501';
  end if;
  if p_capability not in (
    'view_performance', 'view_org_aggregates', 'view_athlete_detail',
    'view_staff_activity', 'view_interventions', 'manage_structure',
    'manage_staff_access', 'manage_reports', 'manage_interventions'
  ) then
    raise exception 'Unknown Performance capability.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.fuel_organisation_members member
    where member.organisation_id = p_organisation_id
      and member.user_id = p_user_id and member.status = 'active'
  ) then
    raise exception 'Staff member is not active in this organisation.' using errcode = '22023';
  end if;
  if not p_active and p_capability = 'manage_staff_access'
     and not exists (
       select 1 from public.fuel_staff_capabilities other
       where other.organisation_id = p_organisation_id
         and other.capability = 'manage_staff_access'
         and other.status = 'active'
         and other.user_id <> p_user_id
     ) then
    raise exception 'At least one other active access manager is required.' using errcode = '22023';
  end if;

  insert into public.fuel_staff_capabilities (
    organisation_id, user_id, capability, status, granted_by, revoked_at
  ) values (
    p_organisation_id, p_user_id, p_capability,
    case when p_active then 'active' else 'revoked' end,
    (select auth.uid()), case when p_active then null else now() end
  )
  on conflict (organisation_id, user_id, capability)
  do update set
    status = excluded.status,
    granted_by = (select auth.uid()),
    granted_at = case when p_active then now() else public.fuel_staff_capabilities.granted_at end,
    revoked_at = excluded.revoked_at,
    updated_at = now();
end;
$$;

create or replace function public.fuel_performance_set_scope(
  p_organisation_id uuid,
  p_user_id uuid,
  p_scope_type text,
  p_unit_id uuid default null,
  p_athlete_id uuid default null,
  p_include_descendants boolean default false,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  scope_id uuid;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Staff cannot change their own Performance scope.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.fuel_organisation_members member
    where member.organisation_id = p_organisation_id
      and member.user_id = p_user_id and member.status = 'active'
  ) then
    raise exception 'Staff member is not active in this organisation.' using errcode = '22023';
  end if;
  if p_scope_type = 'unit' and not exists (
    select 1 from public.fuel_teams unit
    where unit.id = p_unit_id and unit.organisation_id = p_organisation_id
  ) then
    raise exception 'Unit does not belong to this organisation.' using errcode = '22023';
  end if;
  if p_scope_type = 'athlete' and not exists (
    select 1 from public.fuel_organisation_athlete_shares share
    where share.organisation_id = p_organisation_id
      and share.athlete_id = p_athlete_id and share.status = 'active'
  ) then
    raise exception 'Athlete is not actively sharing with this organisation.' using errcode = '22023';
  end if;

  select id into scope_id
  from public.fuel_staff_scopes scope
  where scope.organisation_id = p_organisation_id
    and scope.user_id = p_user_id
    and scope.scope_type = p_scope_type
    and scope.unit_id is not distinct from p_unit_id
    and scope.athlete_id is not distinct from p_athlete_id;

  if scope_id is null then
    insert into public.fuel_staff_scopes (
      organisation_id, user_id, scope_type, unit_id, athlete_id,
      include_descendants, status, assigned_by, revoked_at
    ) values (
      p_organisation_id, p_user_id, p_scope_type, p_unit_id, p_athlete_id,
      case when p_scope_type = 'organisation' then true
           when p_scope_type = 'unit' then p_include_descendants else false end,
      case when p_active then 'active' else 'revoked' end,
      (select auth.uid()), case when p_active then null else now() end
    ) returning id into scope_id;
  else
    update public.fuel_staff_scopes
    set include_descendants = case
          when p_scope_type = 'organisation' then true
          when p_scope_type = 'unit' then p_include_descendants
          else false
        end,
        status = case when p_active then 'active' else 'revoked' end,
        assigned_by = (select auth.uid()),
        assigned_at = case when p_active then now() else assigned_at end,
        revoked_at = case when p_active then null else now() end,
        updated_at = now()
    where id = scope_id;
  end if;
  return scope_id;
end;
$$;

create or replace function public.fuel_performance_set_staff_membership(
  p_organisation_id uuid,
  p_user_id uuid,
  p_role text default 'staff',
  p_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if p_user_id = (select auth.uid()) then
    raise exception 'Staff cannot change their own organisation membership.' using errcode = '42501';
  end if;
  if p_role not in ('admin', 'staff') then
    raise exception 'Staff membership role must be admin or staff.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.fuel_organisation_members member
    where member.organisation_id = p_organisation_id
      and member.user_id = p_user_id and member.role = 'owner'
  ) then
    raise exception 'Organisation owner membership cannot be changed here.' using errcode = '42501';
  end if;
  if not p_active and exists (
    select 1 from public.fuel_staff_capabilities capability
    where capability.organisation_id = p_organisation_id
      and capability.user_id = p_user_id
      and capability.capability = 'manage_staff_access'
      and capability.status = 'active'
  ) and not exists (
    select 1 from public.fuel_staff_capabilities other
    join public.fuel_organisation_members member
      on member.organisation_id = other.organisation_id and member.user_id = other.user_id
    where other.organisation_id = p_organisation_id
      and other.user_id <> p_user_id
      and other.capability = 'manage_staff_access' and other.status = 'active'
      and member.status = 'active'
  ) then
    raise exception 'At least one other active access manager is required.' using errcode = '22023';
  end if;

  insert into public.fuel_organisation_members (
    organisation_id, user_id, role, status, invited_by, joined_at, revoked_at
  ) values (
    p_organisation_id, p_user_id, p_role,
    case when p_active then 'active' else 'revoked' end,
    (select auth.uid()), case when p_active then now() else null end,
    case when p_active then null else now() end
  )
  on conflict (organisation_id, user_id)
  do update set
    role = excluded.role,
    status = excluded.status,
    invited_by = (select auth.uid()),
    joined_at = case when p_active then coalesce(public.fuel_organisation_members.joined_at, now())
                     else public.fuel_organisation_members.joined_at end,
    revoked_at = excluded.revoked_at,
    updated_at = now();
end;
$$;

revoke all on function public.fuel_performance_set_capability(uuid, uuid, text, boolean)
  from public, anon;
grant execute on function public.fuel_performance_set_capability(uuid, uuid, text, boolean)
  to authenticated;
revoke all on function public.fuel_performance_set_scope(uuid, uuid, text, uuid, uuid, boolean, boolean)
  from public, anon;
grant execute on function public.fuel_performance_set_scope(uuid, uuid, text, uuid, uuid, boolean, boolean)
  to authenticated;
revoke all on function public.fuel_performance_set_staff_membership(uuid, uuid, text, boolean)
  from public, anon;
grant execute on function public.fuel_performance_set_staff_membership(uuid, uuid, text, boolean)
  to authenticated;

create or replace function public.fuel_performance_save_unit(
  p_organisation_id uuid,
  p_unit_id uuid default null,
  p_parent_unit_id uuid default null,
  p_name text default null,
  p_unit_type text default null,
  p_timezone_name text default 'UTC',
  p_display_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid;
  has_org_scope boolean;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_structure') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  select private.fuel_platform_admin_has_organisation_access(p_organisation_id)
    or exists (
      select 1 from public.fuel_staff_scopes scope
      where scope.organisation_id = p_organisation_id
        and scope.user_id = (select auth.uid())
        and scope.scope_type = 'organisation' and scope.status = 'active'
    )
  into has_org_scope;
  if p_parent_unit_id is null and not has_org_scope then
    raise exception 'Organisation scope is required to manage root units.' using errcode = '42501';
  end if;
  if p_parent_unit_id is not null
     and not private.fuel_performance_unit_in_scope(p_organisation_id, p_parent_unit_id) then
    raise exception 'Parent unit is outside your scope.' using errcode = '42501';
  end if;
  if p_unit_id is not null
     and not private.fuel_performance_unit_in_scope(p_organisation_id, p_unit_id) then
    raise exception 'Unit is outside your scope.' using errcode = '42501';
  end if;

  if p_unit_id is null then
    insert into public.fuel_teams (
      organisation_id, parent_team_id, name, unit_type, timezone_name,
      display_order, created_by
    ) values (
      p_organisation_id, p_parent_unit_id, trim(p_name), nullif(trim(p_unit_type), ''),
      coalesce(nullif(trim(p_timezone_name), ''), 'UTC'), p_display_order, (select auth.uid())
    ) returning id into saved_id;
  else
    update public.fuel_teams
    set parent_team_id = p_parent_unit_id,
        name = trim(p_name),
        unit_type = nullif(trim(p_unit_type), ''),
        timezone_name = coalesce(nullif(trim(p_timezone_name), ''), timezone_name),
        display_order = p_display_order,
        updated_at = now()
    where id = p_unit_id and organisation_id = p_organisation_id
    returning id into saved_id;
    if saved_id is null then
      raise exception 'Unit not found.' using errcode = '22023';
    end if;
  end if;
  return saved_id;
end;
$$;

revoke all on function public.fuel_performance_save_unit(uuid, uuid, uuid, text, text, text, integer)
  from public, anon;
grant execute on function public.fuel_performance_save_unit(uuid, uuid, uuid, text, text, text, integer)
  to authenticated;

-- Performance follow-ups are organisation-scoped operational records. They
-- do not impersonate a coach or create a coach-athlete relationship. Direct
-- table access stays closed; the RPCs below enforce capability, scope, active
-- organisation sharing and unit assignment on every read and write.
create table public.fuel_performance_interventions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.fuel_organisations(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  responsible_staff_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active',
  observation text not null default '',
  action_text text not null,
  review_date date not null,
  review_notes text,
  reviewed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_performance_interventions_share_fk
    foreign key (organisation_id, athlete_id)
    references public.fuel_organisation_athlete_shares(organisation_id, athlete_id)
    on delete cascade,
  constraint fuel_performance_interventions_status_check
    check (status in ('active', 'reviewed', 'closed')),
  constraint fuel_performance_interventions_observation_check
    check (char_length(observation) <= 1000),
  constraint fuel_performance_interventions_action_check
    check (char_length(trim(action_text)) between 1 and 1000),
  constraint fuel_performance_interventions_review_notes_check
    check (review_notes is null or char_length(review_notes) <= 2000),
  constraint fuel_performance_interventions_review_date_check
    check (review_date >= created_at::date),
  constraint fuel_performance_interventions_state_dates_check
    check (
      (status = 'active' and reviewed_at is null and closed_at is null)
      or (status = 'reviewed' and reviewed_at is not null and closed_at is null)
      or (status = 'closed' and closed_at is not null)
    )
);

create index fuel_performance_interventions_org_status_review_idx
  on public.fuel_performance_interventions
  (organisation_id, status, review_date, created_at desc);
create index fuel_performance_interventions_athlete_created_idx
  on public.fuel_performance_interventions
  (athlete_id, created_at desc);
create index fuel_performance_interventions_actor_idx
  on public.fuel_performance_interventions
  (actor_user_id, created_at desc);
create index fuel_performance_interventions_responsible_staff_idx
  on public.fuel_performance_interventions
  (responsible_staff_user_id, status, review_date)
  where responsible_staff_user_id is not null;
create index fuel_performance_interventions_share_fk_idx
  on public.fuel_performance_interventions
  (organisation_id, athlete_id);

alter table public.fuel_performance_interventions enable row level security;
revoke all on table public.fuel_performance_interventions
  from public, anon, authenticated;

create policy fuel_performance_interventions_deny_direct_access
  on public.fuel_performance_interventions
  for all
  to authenticated
  using (false)
  with check (false);

create or replace function private.fuel_performance_intervention_guard()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organisation_id is distinct from old.organisation_id
    or new.athlete_id is distinct from old.athlete_id
    or new.actor_user_id is distinct from old.actor_user_id
  ) then
    raise exception 'Performance intervention identity is immutable.' using errcode = '42501';
  end if;
  new.updated_at := now();
  if new.status = 'reviewed' and old.status is distinct from 'reviewed' then
    new.reviewed_at := now();
    new.closed_at := null;
  elsif new.status = 'closed' and old.status is distinct from 'closed' then
    new.closed_at := now();
  elsif new.status = 'active' then
    new.reviewed_at := null;
    new.closed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_performance_intervention_guard()
  from public, anon, authenticated;
create trigger fuel_performance_intervention_guard_trigger
  before update on public.fuel_performance_interventions
  for each row execute function private.fuel_performance_intervention_guard();

create or replace function public.fuel_performance_athlete_detail(
  p_organisation_id uuid,
  p_athlete_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  athlete jsonb;
  workouts jsonb;
  fuel_events jsonb;
  interventions jsonb;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_can_access_athlete(
       p_organisation_id,
       p_athlete_id,
       null,
       true
     ) then
    raise exception 'Performance athlete access denied.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', p_athlete_id,
    'name', coalesce(profile.display_name, 'Athlete'),
    'unitId', unit.id,
    'unitName', unit.name,
    'responsibleStaffId', relationship.coach_id,
    'responsibleStaffName', coalesce(coach_profile.display_name, 'Unassigned')
  )
  into athlete
  from public.fuel_team_athletes assignment
  join public.fuel_teams unit
    on unit.id = assignment.team_id
   and unit.organisation_id = assignment.organisation_id
  left join public.fuel_user_profiles profile
    on profile.user_id = assignment.athlete_id
  left join public.fuel_coach_athletes relationship
    on relationship.athlete_id = assignment.athlete_id
   and relationship.status = 'active'
   and exists (
     select 1
     from public.fuel_organisation_members coach_membership
     where coach_membership.organisation_id = p_organisation_id
       and coach_membership.user_id = relationship.coach_id
       and coach_membership.status = 'active'
   )
  left join public.fuel_user_profiles coach_profile
    on coach_profile.user_id = relationship.coach_id
  where assignment.organisation_id = p_organisation_id
    and assignment.athlete_id = p_athlete_id
    and assignment.status = 'active'
  order by unit.display_order, unit.name, relationship.created_at
  limit 1;

  select coalesce(jsonb_agg(workout.row order by workout.started_at desc), '[]'::jsonb)
  into workouts
  from (
    select activity.started_at,
      jsonb_build_object(
        'id', activity.id,
        'athleteId', activity.user_id,
        'source', case when activity.source like 'garmin%' then 'garmin' else activity.source end,
        'sourceActivityId', activity.source_activity_id,
        'type', activity.activity_type,
        'title', activity.activity_type,
        'startAt', activity.started_at,
        'endAt', activity.started_at + make_interval(secs => activity.duration_seconds),
        'timeZone', 'UTC'
      ) as row
    from public.garmin_activity_summaries activity
    where activity.user_id = p_athlete_id
      and activity.started_at >= now() - interval '28 days'
      and activity.started_at <= now()
    union all
    select training_session.starts_at,
      jsonb_build_object(
        'id', training_session.id,
        'athleteId', assignment.athlete_id,
        'source', case when training_session.source = 'external_provider'
          then coalesce(training_session.source_provider, 'external_provider')
          else 'coach_schedule' end,
        'sourceActivityId', training_session.external_session_id,
        'type', training_session.session_type,
        'title', training_session.session_name,
        'startAt', training_session.starts_at,
        'endAt', training_session.ends_at,
        'timeZone', training_session.timezone_name
      ) as row
    from public.fuel_training_session_athletes assignment
    join public.fuel_training_sessions training_session
      on training_session.id = assignment.session_id
    where assignment.athlete_id = p_athlete_id
      and training_session.organisation_id = p_organisation_id
      and training_session.starts_at >= now() - interval '28 days'
      and training_session.starts_at <= now()
  ) workout;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', log.id,
    'userId', log.user_id,
    'loggedAt', log.logged_at,
    'type', log.type,
    'source', log.source
  ) order by log.logged_at), '[]'::jsonb)
  into fuel_events
  from public.fuel_logs log
  where log.user_id = p_athlete_id
    and log.type in ('fuel', 'fuel_hydration')
    and log.logged_at >= now() - interval '35 days'
    and log.logged_at <= now();

  select coalesce(jsonb_agg(entry.row order by entry.created_at desc), '[]'::jsonb)
  into interventions
  from (
    select intervention.created_at,
      jsonb_build_object(
        'id', intervention.id,
        'source', 'performance',
        'status', intervention.status,
        'observation', intervention.observation,
        'actionText', intervention.action_text,
        'reviewDate', intervention.review_date,
        'reviewNotes', intervention.review_notes,
        'responsibleStaffName', coalesce(staff_profile.display_name, 'Unassigned'),
        'createdAt', intervention.created_at
      ) as row
    from public.fuel_performance_interventions intervention
    left join public.fuel_user_profiles staff_profile
      on staff_profile.user_id = intervention.responsible_staff_user_id
    where intervention.organisation_id = p_organisation_id
      and intervention.athlete_id = p_athlete_id
    union all
    select intervention.created_at,
      jsonb_build_object(
        'id', intervention.id,
        'source', 'coach',
        'status', intervention.status,
        'observation', intervention.observation,
        'actionText', intervention.action_text,
        'reviewDate', intervention.review_date,
        'reviewNotes', intervention.review_notes,
        'responsibleStaffName', coalesce(coach_profile.display_name, 'Coach'),
        'createdAt', intervention.created_at
      ) as row
    from public.fuel_coach_interventions intervention
    left join public.fuel_user_profiles coach_profile
      on coach_profile.user_id = intervention.coach_id
    where intervention.athlete_id = p_athlete_id
      and exists (
        select 1
        from public.fuel_organisation_members coach_membership
        where coach_membership.organisation_id = p_organisation_id
          and coach_membership.user_id = intervention.coach_id
          and coach_membership.status = 'active'
      )
  ) entry;

  return jsonb_build_object(
    'status', case
      when jsonb_array_length(workouts) = 0 then 'insufficient_training_data'
      else 'ready'
    end,
    'athlete', athlete,
    'workouts', workouts,
    'fuelEvents', fuel_events,
    'interventions', interventions
  );
end;
$$;

revoke all on function public.fuel_performance_athlete_detail(uuid, uuid)
  from public, anon;
grant execute on function public.fuel_performance_athlete_detail(uuid, uuid)
  to authenticated;

create or replace function public.fuel_performance_create_intervention(
  p_organisation_id uuid,
  p_athlete_id uuid,
  p_responsible_staff_user_id uuid,
  p_observation text,
  p_action_text text,
  p_review_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  intervention_id uuid;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(
       p_organisation_id,
       'manage_interventions'
     )
     or not private.fuel_performance_can_access_athlete(
       p_organisation_id,
       p_athlete_id,
       null,
       true
     ) then
    raise exception 'Performance intervention access denied.' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_action_text, ''))) not between 1 and 1000
     or char_length(coalesce(p_observation, '')) > 1000 then
    raise exception 'Intervention text is invalid.' using errcode = '22023';
  end if;
  if p_review_date < current_date or p_review_date > current_date + 84 then
    raise exception 'Review date must be within the next 84 days.' using errcode = '22023';
  end if;
  if p_responsible_staff_user_id is not null and not exists (
    select 1
    from public.fuel_organisation_members member
    where member.organisation_id = p_organisation_id
      and member.user_id = p_responsible_staff_user_id
      and member.status = 'active'
  ) then
    raise exception 'Responsible staff must be active in this organisation.' using errcode = '22023';
  end if;

  insert into public.fuel_performance_interventions (
    organisation_id,
    athlete_id,
    actor_user_id,
    responsible_staff_user_id,
    observation,
    action_text,
    review_date
  ) values (
    p_organisation_id,
    p_athlete_id,
    (select auth.uid()),
    p_responsible_staff_user_id,
    coalesce(trim(p_observation), ''),
    trim(p_action_text),
    p_review_date
  ) returning id into intervention_id;
  return intervention_id;
end;
$$;

revoke all on function public.fuel_performance_create_intervention(uuid, uuid, uuid, text, text, date)
  from public, anon;
grant execute on function public.fuel_performance_create_intervention(uuid, uuid, uuid, text, text, date)
  to authenticated;

create or replace function public.fuel_performance_update_intervention(
  p_organisation_id uuid,
  p_intervention_id uuid,
  p_status text,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_athlete_id uuid;
begin
  select intervention.athlete_id
  into target_athlete_id
  from public.fuel_performance_interventions intervention
  where intervention.id = p_intervention_id
    and intervention.organisation_id = p_organisation_id;

  if (select auth.uid()) is null
     or target_athlete_id is null
     or not private.fuel_performance_has_capability(
       p_organisation_id,
       'manage_interventions'
     )
     or not private.fuel_performance_can_access_athlete(
       p_organisation_id,
       target_athlete_id,
       null,
       true
     ) then
    raise exception 'Performance intervention access denied.' using errcode = '42501';
  end if;
  if p_status not in ('active', 'reviewed', 'closed')
     or char_length(coalesce(p_review_notes, '')) > 2000 then
    raise exception 'Intervention review state is invalid.' using errcode = '22023';
  end if;

  update public.fuel_performance_interventions
  set status = p_status,
      review_notes = nullif(trim(p_review_notes), '')
  where id = p_intervention_id
    and organisation_id = p_organisation_id;
  return p_intervention_id;
end;
$$;

revoke all on function public.fuel_performance_update_intervention(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.fuel_performance_update_intervention(uuid, uuid, text, text)
  to authenticated;

create or replace function public.fuel_performance_create_demo_structure(
  p_organisation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  root_id uuid;
  location_id uuid;
  location_name text;
  location_order integer := 0;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(
       p_organisation_id,
       'manage_structure'
     ) then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.fuel_teams unit
    where unit.organisation_id = p_organisation_id
  ) then
    raise exception 'Demo structure requires an empty organisation.' using errcode = '22023';
  end if;

  insert into public.fuel_teams (
    organisation_id, name, unit_type, timezone_name, display_order, created_by
  )
  select organisation.id, organisation.name, 'Organisation',
    'Europe/London', 0, (select auth.uid())
  from public.fuel_organisations organisation
  where organisation.id = p_organisation_id
  returning id into root_id;
  if root_id is null then
    raise exception 'Organisation not found.' using errcode = '22023';
  end if;

  foreach location_name in array array['Bedford', 'Cambridge', 'Oxford'] loop
    location_order := location_order + 1;
    insert into public.fuel_teams (
      organisation_id, parent_team_id, name, unit_type, timezone_name,
      display_order, created_by
    ) values (
      p_organisation_id, root_id, location_name, 'Location', 'Europe/London',
      location_order, (select auth.uid())
    ) returning id into location_id;
    insert into public.fuel_teams (
      organisation_id, parent_team_id, name, unit_type, timezone_name,
      display_order, created_by
    ) values (
      p_organisation_id, location_id, location_name || ' Personal Training', 'Programme',
      'Europe/London', 1, (select auth.uid())
    );
  end loop;

  return jsonb_build_object('rootUnitId', root_id, 'unitCount', 7);
end;
$$;

revoke all on function public.fuel_performance_create_demo_structure(uuid)
  from public, anon;
grant execute on function public.fuel_performance_create_demo_structure(uuid)
  to authenticated;

comment on table private.fuel_platform_admins is
  'Explicit, revocable Fuel Guard operator grants. Never inferred from metadata or frontend state.';
comment on table private.fuel_platform_admin_organisation_access is
  'Explicit per-organisation platform-admin context. Does not replace athlete sharing or unit assignment.';
comment on table private.fuel_platform_admin_audit_events is
  'Append-only audit history for platform-admin and organisation-context grant transitions.';
comment on table public.fuel_performance_interventions is
  'Auditable organisation-scoped Performance follow-ups; writes require explicit manage_interventions capability and athlete-detail scope.';
