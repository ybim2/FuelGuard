-- Fuel Guard Performance: generic nested organisational units, explicit
-- athlete-to-organisation sharing, independent staff scope/capability grants,
-- and server-side, cohort-suppressed organisational reporting.
--
-- Apply after:
--   20260807172400_coach_organisation_foundations.sql
--   20260807172300_coach_daily_workflow.sql
--   20260808114819_pre_post_training_fuel.sql
--
-- The existing fuel_teams table remains the sole organisational-unit store.
-- Its historical name is not used by the permission model or Performance UI.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter table public.fuel_organisations
  add column if not exists minimum_reporting_cohort integer not null default 5;

alter table public.fuel_organisations
  drop constraint if exists fuel_organisations_minimum_reporting_cohort_check,
  add constraint fuel_organisations_minimum_reporting_cohort_check
    check (minimum_reporting_cohort between 3 and 25);

alter table public.fuel_teams
  add column if not exists parent_team_id uuid,
  add column if not exists unit_type text,
  add column if not exists display_order integer not null default 0;

alter table public.fuel_teams
  drop constraint if exists fuel_teams_parent_fk,
  drop constraint if exists fuel_teams_not_self_parent_check,
  drop constraint if exists fuel_teams_unit_type_check,
  add constraint fuel_teams_parent_fk
    foreign key (parent_team_id, organisation_id)
    references public.fuel_teams(id, organisation_id)
    on delete restrict,
  add constraint fuel_teams_not_self_parent_check
    check (parent_team_id is null or parent_team_id <> id),
  add constraint fuel_teams_unit_type_check
    check (unit_type is null or char_length(trim(unit_type)) between 1 and 80);

create index if not exists fuel_teams_parent_idx
  on public.fuel_teams (organisation_id, parent_team_id, display_order, name);

comment on table public.fuel_teams is
  'Generic nested organisation units. The legacy table name is retained to avoid a parallel hierarchy; permission logic is label-independent.';
comment on column public.fuel_teams.parent_team_id is
  'Optional parent unit in the same organisation.';

create table public.fuel_staff_capabilities (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.fuel_organisations(id) on delete cascade,
  user_id uuid not null,
  capability text not null,
  status text not null default 'active',
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_staff_capabilities_member_fk
    foreign key (organisation_id, user_id)
    references public.fuel_organisation_members(organisation_id, user_id) on delete cascade,
  constraint fuel_staff_capabilities_value_check
    check (capability in (
      'view_performance',
      'view_org_aggregates',
      'view_athlete_detail',
      'view_staff_activity',
      'view_interventions',
      'manage_structure',
      'manage_staff_access',
      'manage_reports',
      'manage_interventions'
    )),
  constraint fuel_staff_capabilities_status_check
    check (status in ('active', 'revoked')),
  constraint fuel_staff_capabilities_revoked_check
    check (status <> 'revoked' or revoked_at is not null),
  constraint fuel_staff_capabilities_unique
    unique (organisation_id, user_id, capability)
);

create table public.fuel_staff_scopes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.fuel_organisations(id) on delete cascade,
  user_id uuid not null,
  scope_type text not null,
  unit_id uuid,
  athlete_id uuid references auth.users(id) on delete cascade,
  include_descendants boolean not null default false,
  status text not null default 'active',
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_staff_scopes_member_fk
    foreign key (organisation_id, user_id)
    references public.fuel_organisation_members(organisation_id, user_id) on delete cascade,
  constraint fuel_staff_scopes_unit_fk
    foreign key (unit_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_staff_scopes_shape_check check (
    (scope_type = 'organisation' and unit_id is null and athlete_id is null and include_descendants)
    or (scope_type = 'unit' and unit_id is not null and athlete_id is null)
    or (scope_type = 'athlete' and unit_id is null and athlete_id is not null and not include_descendants)
  ),
  constraint fuel_staff_scopes_status_check
    check (status in ('active', 'revoked')),
  constraint fuel_staff_scopes_revoked_check
    check (status <> 'revoked' or revoked_at is not null)
);

create unique index fuel_staff_scopes_org_unique
  on public.fuel_staff_scopes (organisation_id, user_id)
  where scope_type = 'organisation';
create unique index fuel_staff_scopes_unit_unique
  on public.fuel_staff_scopes (organisation_id, user_id, unit_id)
  where scope_type = 'unit';
create unique index fuel_staff_scopes_athlete_unique
  on public.fuel_staff_scopes (organisation_id, user_id, athlete_id)
  where scope_type = 'athlete';
create index fuel_staff_scopes_user_status_idx
  on public.fuel_staff_scopes (user_id, organisation_id, status);

create table public.fuel_organisation_athlete_shares (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.fuel_organisations(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  shared_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_organisation_athlete_shares_status_check
    check (status in ('invited', 'active', 'revoked')),
  constraint fuel_organisation_athlete_shares_active_check
    check (status <> 'active' or shared_at is not null),
  constraint fuel_organisation_athlete_shares_revoked_check
    check (status <> 'revoked' or revoked_at is not null),
  constraint fuel_organisation_athlete_shares_unique
    unique (organisation_id, athlete_id)
);

create index fuel_organisation_athlete_shares_athlete_idx
  on public.fuel_organisation_athlete_shares (athlete_id, status, organisation_id);
create index fuel_organisation_athlete_shares_org_idx
  on public.fuel_organisation_athlete_shares (organisation_id, status, athlete_id);

-- A recursive trigger prevents same-organisation cycles while allowing safe
-- reparenting. The composite foreign key already prevents cross-org parents.
create or replace function private.fuel_performance_validate_unit_parent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.parent_team_id is null then
    return new;
  end if;

  if new.parent_team_id = new.id then
    raise exception 'An organisation unit cannot be its own parent.' using errcode = '23514';
  end if;

  if exists (
    with recursive descendants as (
      select child.id
      from public.fuel_teams child
      where child.parent_team_id = new.id
      union all
      select child.id
      from public.fuel_teams child
      join descendants parent on child.parent_team_id = parent.id
    )
    select 1 from descendants where id = new.parent_team_id
  ) then
    raise exception 'Organisation unit hierarchy cannot contain a cycle.' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.fuel_performance_validate_unit_parent() from public, anon, authenticated;

drop trigger if exists fuel_performance_validate_unit_parent_trigger on public.fuel_teams;
create trigger fuel_performance_validate_unit_parent_trigger
  before insert or update of parent_team_id, organisation_id on public.fuel_teams
  for each row execute function private.fuel_performance_validate_unit_parent();

-- Scope and relationship identity fields are immutable. Status changes are
-- audit-preserving revocations; callers cannot repoint a grant or share.
create or replace function private.fuel_performance_prevent_identity_repoint()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_table_name = 'fuel_staff_capabilities'
     and (new.organisation_id, new.user_id, new.capability)
         is distinct from (old.organisation_id, old.user_id, old.capability) then
    raise exception 'Capability identity cannot be changed.' using errcode = '42501';
  elsif tg_table_name = 'fuel_staff_scopes'
     and (new.organisation_id, new.user_id, new.scope_type, new.unit_id, new.athlete_id)
         is distinct from (old.organisation_id, old.user_id, old.scope_type, old.unit_id, old.athlete_id) then
    raise exception 'Scope identity cannot be changed.' using errcode = '42501';
  elsif tg_table_name = 'fuel_organisation_athlete_shares'
     and (new.organisation_id, new.athlete_id)
         is distinct from (old.organisation_id, old.athlete_id) then
    raise exception 'Organisation sharing identity cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_performance_prevent_identity_repoint() from public, anon, authenticated;

create trigger fuel_staff_capabilities_identity_trigger
  before update on public.fuel_staff_capabilities
  for each row execute function private.fuel_performance_prevent_identity_repoint();
create trigger fuel_staff_scopes_identity_trigger
  before update on public.fuel_staff_scopes
  for each row execute function private.fuel_performance_prevent_identity_repoint();
create trigger fuel_organisation_athlete_shares_identity_trigger
  before update on public.fuel_organisation_athlete_shares
  for each row execute function private.fuel_performance_prevent_identity_repoint();

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
    and exists (
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
    );
$$;

revoke all on function private.fuel_performance_has_capability(uuid, text, uuid) from public, anon;
grant execute on function private.fuel_performance_has_capability(uuid, text, uuid) to authenticated;

create or replace function private.fuel_performance_unit_is_descendant(
  p_organisation_id uuid,
  p_candidate_unit_id uuid,
  p_ancestor_unit_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  with recursive ancestors as (
    select unit.id, unit.parent_team_id
    from public.fuel_teams unit
    where unit.organisation_id = p_organisation_id
      and unit.id = p_candidate_unit_id
    union all
    select parent.id, parent.parent_team_id
    from public.fuel_teams parent
    join ancestors child on child.parent_team_id = parent.id
    where parent.organisation_id = p_organisation_id
  )
  select exists (select 1 from ancestors where id = p_ancestor_unit_id);
$$;

revoke all on function private.fuel_performance_unit_is_descendant(uuid, uuid, uuid) from public, anon, authenticated;

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
    and exists (
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
              or (scope.include_descendants and private.fuel_performance_unit_is_descendant(
                p_organisation_id, p_unit_id, scope.unit_id
              ))
            )
          )
        )
    );
$$;

revoke all on function private.fuel_performance_unit_in_scope(uuid, uuid, uuid) from public, anon;
grant execute on function private.fuel_performance_unit_in_scope(uuid, uuid, uuid) to authenticated;

create or replace function private.fuel_performance_can_access_athlete(
  p_organisation_id uuid,
  p_athlete_id uuid,
  p_unit_filter uuid default null,
  p_require_detail boolean default false,
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
    and private.fuel_performance_has_capability(
      p_organisation_id,
      case when p_require_detail then 'view_athlete_detail' else 'view_org_aggregates' end,
      p_user_id
    )
    and exists (
      select 1
      from public.fuel_organisation_athlete_shares share
      where share.organisation_id = p_organisation_id
        and share.athlete_id = p_athlete_id
        and share.status = 'active'
    )
    and exists (
      select 1
      from public.fuel_team_athletes assignment
      where assignment.organisation_id = p_organisation_id
        and assignment.athlete_id = p_athlete_id
        and assignment.status = 'active'
        and (p_unit_filter is null or private.fuel_performance_unit_is_descendant(
          p_organisation_id, assignment.team_id, p_unit_filter
        ))
        and (
          private.fuel_performance_unit_in_scope(p_organisation_id, assignment.team_id, p_user_id)
          or exists (
            select 1
            from public.fuel_staff_scopes scope
            where scope.organisation_id = p_organisation_id
              and scope.user_id = p_user_id
              and scope.scope_type = 'athlete'
              and scope.athlete_id = p_athlete_id
              and scope.status = 'active'
          )
        )
    );
$$;

revoke all on function private.fuel_performance_can_access_athlete(uuid, uuid, uuid, boolean, uuid) from public, anon;
grant execute on function private.fuel_performance_can_access_athlete(uuid, uuid, uuid, boolean, uuid) to authenticated;

create or replace function private.fuel_performance_permitted_athletes(
  p_organisation_id uuid,
  p_unit_filter uuid default null,
  p_require_detail boolean default false,
  p_user_id uuid default auth.uid()
)
returns table (athlete_id uuid)
language sql
security definer
stable
set search_path = ''
as $$
  select distinct share.athlete_id
  from public.fuel_organisation_athlete_shares share
  where share.organisation_id = p_organisation_id
    and share.status = 'active'
    and private.fuel_performance_can_access_athlete(
      p_organisation_id, share.athlete_id, p_unit_filter, p_require_detail, p_user_id
    );
$$;

revoke all on function private.fuel_performance_permitted_athletes(uuid, uuid, boolean, uuid) from public, anon, authenticated;

-- Owner bootstrap provides the controls needed to configure a new
-- organisation, but deliberately excludes athlete-detail and intervention
-- capabilities. Those sensitive capabilities always require an explicit grant.
create or replace function private.fuel_performance_bootstrap_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap_capability text;
begin
  if new.status = 'active' and new.role = 'owner' then
    foreach bootstrap_capability in array array[
      'view_performance',
      'view_org_aggregates',
      'view_staff_activity',
      'manage_structure',
      'manage_staff_access',
      'manage_reports'
    ] loop
      insert into public.fuel_staff_capabilities (
        organisation_id, user_id, capability, status, granted_by
      ) values (
        new.organisation_id, new.user_id, bootstrap_capability, 'active', new.user_id
      )
      on conflict (organisation_id, user_id, capability)
      do update set
        status = 'active', revoked_at = null, updated_at = now();
    end loop;

    insert into public.fuel_staff_scopes (
      organisation_id, user_id, scope_type, include_descendants, status, assigned_by
    ) values (
      new.organisation_id, new.user_id, 'organisation', true, 'active', new.user_id
    )
    on conflict (organisation_id, user_id) where scope_type = 'organisation'
    do update set
      status = 'active', revoked_at = null, include_descendants = true, updated_at = now();
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_performance_bootstrap_owner() from public, anon, authenticated;

drop trigger if exists fuel_performance_bootstrap_owner_trigger on public.fuel_organisation_members;
create trigger fuel_performance_bootstrap_owner_trigger
  after insert or update of role, status on public.fuel_organisation_members
  for each row execute function private.fuel_performance_bootstrap_owner();

insert into public.fuel_staff_capabilities (
  organisation_id, user_id, capability, status, granted_by
)
select member.organisation_id, member.user_id, capability, 'active', member.user_id
from public.fuel_organisation_members member
cross join unnest(array[
  'view_performance',
  'view_org_aggregates',
  'view_staff_activity',
  'manage_structure',
  'manage_staff_access',
  'manage_reports'
]) as bootstrap(capability)
where member.role = 'owner' and member.status = 'active'
on conflict (organisation_id, user_id, capability)
do update set status = 'active', revoked_at = null, updated_at = now();

insert into public.fuel_staff_scopes (
  organisation_id, user_id, scope_type, include_descendants, status, assigned_by
)
select organisation_id, user_id, 'organisation', true, 'active', user_id
from public.fuel_organisation_members
where role = 'owner' and status = 'active'
on conflict (organisation_id, user_id) where scope_type = 'organisation'
do update set status = 'active', revoked_at = null, include_descendants = true, updated_at = now();

create or replace function private.fuel_performance_validate_share_transition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if (select auth.uid()) is distinct from new.athlete_id
     and old.status = 'active' and new.status = 'invited' then
    raise exception 'Active athlete sharing cannot be replaced by an invitation.' using errcode = '42501';
  end if;
  if new.status = 'active' and old.status is distinct from 'active'
     and auth.uid() is distinct from new.athlete_id then
    raise exception 'Only the athlete can activate organisation sharing.' using errcode = '42501';
  end if;
  new.shared_at := case
    when new.status = 'active' then coalesce(old.shared_at, now())
    else old.shared_at
  end;
  new.revoked_at := case when new.status = 'revoked' then coalesce(new.revoked_at, now()) else null end;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_performance_validate_share_transition() from public, anon, authenticated;

create trigger fuel_organisation_athlete_shares_transition_trigger
  before update on public.fuel_organisation_athlete_shares
  for each row execute function private.fuel_performance_validate_share_transition();

revoke all on table public.fuel_staff_capabilities from anon, authenticated;
revoke all on table public.fuel_staff_scopes from anon, authenticated;
revoke all on table public.fuel_organisation_athlete_shares from anon, authenticated;

grant select, insert on table public.fuel_staff_capabilities to authenticated;
grant update (status, revoked_at, updated_at)
  on table public.fuel_staff_capabilities to authenticated;
grant select, insert on table public.fuel_staff_scopes to authenticated;
grant update (include_descendants, status, revoked_at, updated_at)
  on table public.fuel_staff_scopes to authenticated;
grant select, insert on table public.fuel_organisation_athlete_shares to authenticated;
grant update (status, shared_at, revoked_at, updated_at)
  on table public.fuel_organisation_athlete_shares to authenticated;

alter table public.fuel_staff_capabilities enable row level security;
alter table public.fuel_staff_scopes enable row level security;
alter table public.fuel_organisation_athlete_shares enable row level security;

create policy fuel_staff_capabilities_select_permitted
  on public.fuel_staff_capabilities
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.fuel_performance_has_capability(organisation_id, 'view_staff_activity')
    or private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
  );

create policy fuel_staff_capabilities_insert_manager
  on public.fuel_staff_capabilities
  for insert to authenticated
  with check (
    private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
    and status = 'active'
    and granted_by = (select auth.uid())
  );

create policy fuel_staff_capabilities_update_manager
  on public.fuel_staff_capabilities
  for update to authenticated
  using (private.fuel_performance_has_capability(organisation_id, 'manage_staff_access'))
  with check (private.fuel_performance_has_capability(organisation_id, 'manage_staff_access'));

create policy fuel_staff_scopes_select_permitted
  on public.fuel_staff_scopes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.fuel_performance_has_capability(organisation_id, 'view_staff_activity')
    or private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
  );

create policy fuel_staff_scopes_insert_manager
  on public.fuel_staff_scopes
  for insert to authenticated
  with check (
    private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
    and status = 'active'
    and assigned_by = (select auth.uid())
  );

create policy fuel_staff_scopes_update_manager
  on public.fuel_staff_scopes
  for update to authenticated
  using (private.fuel_performance_has_capability(organisation_id, 'manage_staff_access'))
  with check (private.fuel_performance_has_capability(organisation_id, 'manage_staff_access'));

create policy fuel_organisation_athlete_shares_select_permitted
  on public.fuel_organisation_athlete_shares
  for select to authenticated
  using (
    athlete_id = (select auth.uid())
    or private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
    or private.fuel_performance_can_access_athlete(
      organisation_id, athlete_id, null, true
    )
  );

create policy fuel_organisation_athlete_shares_insert_manager
  on public.fuel_organisation_athlete_shares
  for insert to authenticated
  with check (
    private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
    and status = 'invited'
    and invited_by = (select auth.uid())
  );

create policy fuel_organisation_athlete_shares_update_participant
  on public.fuel_organisation_athlete_shares
  for update to authenticated
  using (
    athlete_id = (select auth.uid())
    or private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
  )
  with check (
    athlete_id = (select auth.uid())
    or private.fuel_performance_has_capability(organisation_id, 'manage_staff_access')
  );

-- Performance access to unit metadata composes with the existing Coach unit
-- policies. It never grants athlete-event access.
create policy fuel_teams_select_performance_scope
  on public.fuel_teams
  for select to authenticated
  using (
    private.fuel_performance_has_capability(organisation_id, 'view_performance')
    and private.fuel_performance_unit_in_scope(organisation_id, id)
  );

create policy fuel_teams_insert_performance_manager
  on public.fuel_teams
  for insert to authenticated
  with check (private.fuel_performance_has_capability(organisation_id, 'manage_structure'));

create policy fuel_teams_update_performance_manager
  on public.fuel_teams
  for update to authenticated
  using (private.fuel_performance_has_capability(organisation_id, 'manage_structure'))
  with check (private.fuel_performance_has_capability(organisation_id, 'manage_structure'));

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

revoke all on function public.fuel_performance_set_capability(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.fuel_performance_set_capability(uuid, uuid, text, boolean) to authenticated;

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

revoke all on function public.fuel_performance_set_scope(uuid, uuid, text, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.fuel_performance_set_scope(uuid, uuid, text, uuid, uuid, boolean, boolean) to authenticated;

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

revoke all on function public.fuel_performance_set_staff_membership(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.fuel_performance_set_staff_membership(uuid, uuid, text, boolean) to authenticated;

create or replace function public.fuel_performance_set_athlete_unit(
  p_organisation_id uuid,
  p_athlete_id uuid,
  p_unit_id uuid,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_id uuid;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if not private.fuel_performance_unit_in_scope(p_organisation_id, p_unit_id) then
    raise exception 'Unit is outside your scope.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.fuel_organisation_athlete_shares share
    where share.organisation_id = p_organisation_id
      and share.athlete_id = p_athlete_id and share.status = 'active'
  ) then
    raise exception 'Athlete is not actively sharing with this organisation.' using errcode = '22023';
  end if;

  insert into public.fuel_team_athletes (
    organisation_id, team_id, athlete_id, status, added_by, joined_at, revoked_at
  ) values (
    p_organisation_id, p_unit_id, p_athlete_id,
    case when p_active then 'active' else 'revoked' end,
    (select auth.uid()), case when p_active then now() else null end,
    case when p_active then null else now() end
  )
  on conflict (team_id, athlete_id)
  do update set
    status = excluded.status,
    added_by = (select auth.uid()),
    joined_at = case when p_active then coalesce(public.fuel_team_athletes.joined_at, now())
                     else public.fuel_team_athletes.joined_at end,
    revoked_at = excluded.revoked_at,
    updated_at = now()
  returning id into assignment_id;
  return assignment_id;
end;
$$;

revoke all on function public.fuel_performance_set_athlete_unit(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.fuel_performance_set_athlete_unit(uuid, uuid, uuid, boolean) to authenticated;

create or replace function public.fuel_performance_invite_athlete(
  p_organisation_id uuid,
  p_athlete_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  share_id uuid;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;

  insert into public.fuel_organisation_athlete_shares (
    organisation_id, athlete_id, status, invited_by
  ) values (
    p_organisation_id, p_athlete_id, 'invited', (select auth.uid())
  )
  on conflict (organisation_id, athlete_id)
  do update set
    status = 'invited', invited_by = (select auth.uid()), invited_at = now(),
    revoked_at = null, updated_at = now()
  where public.fuel_organisation_athlete_shares.status <> 'active'
  returning id into share_id;
  if share_id is null then
    select id into share_id
    from public.fuel_organisation_athlete_shares
    where organisation_id = p_organisation_id and athlete_id = p_athlete_id;
  end if;
  return share_id;
end;
$$;

revoke all on function public.fuel_performance_invite_athlete(uuid, uuid) from public, anon;
grant execute on function public.fuel_performance_invite_athlete(uuid, uuid) to authenticated;

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
  select
    organisation.id,
    organisation.name,
    organisation.minimum_reporting_cohort,
    array_agg(capability.capability order by capability.capability),
    bool_or(capability.capability = 'manage_structure'),
    bool_or(capability.capability = 'manage_staff_access'),
    bool_or(capability.capability = 'manage_reports')
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
  group by organisation.id, organisation.name, organisation.minimum_reporting_cohort;
$$;

revoke all on function public.fuel_performance_context() from public, anon;
grant execute on function public.fuel_performance_context() to authenticated;

create or replace function public.fuel_performance_overview(
  p_organisation_id uuid,
  p_unit_id uuid default null,
  p_from date default (current_date - 6),
  p_to date default current_date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  minimum_cohort integer;
  cohort_count integer;
  active_staff_count integer;
  logged_count integer;
  fuel_event_count integer;
  sleepy_event_count integer;
  connected_count integer;
  stale_count integer;
  stale_integration_count integer;
  attention_count integer;
  reviewed_count integer;
  open_interventions integer;
  interventions_created integer;
  follow_up_due integer;
  resolved_interventions integer;
  has_detail boolean;
  attention_details jsonb := '[]'::jsonb;
  attention_by_unit jsonb := '[]'::jsonb;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'view_performance')
     or not private.fuel_performance_has_capability(p_organisation_id, 'view_org_aggregates') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Reporting period must be between 1 and 367 days.' using errcode = '22023';
  end if;
  if p_unit_id is not null and not exists (
    select 1 from public.fuel_teams unit
    where unit.id = p_unit_id and unit.organisation_id = p_organisation_id
  ) then
    raise exception 'Unit does not belong to this organisation.' using errcode = '22023';
  end if;

  select organisation.minimum_reporting_cohort
  into minimum_cohort
  from public.fuel_organisations organisation
  where organisation.id = p_organisation_id;
  if minimum_cohort is null then
    raise exception 'Organisation not found.' using errcode = '22023';
  end if;

  select count(*)::integer into cohort_count
  from private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false);

  select count(distinct member.user_id)::integer into active_staff_count
  from public.fuel_organisation_members member
  where member.organisation_id = p_organisation_id
    and member.status = 'active'
    and exists (
      select 1 from public.fuel_staff_scopes scope
      where scope.organisation_id = member.organisation_id
        and scope.user_id = member.user_id
        and scope.status = 'active'
        and (
          p_unit_id is null
          or scope.scope_type = 'organisation'
          or (scope.scope_type = 'unit' and (
            scope.unit_id = p_unit_id
            or (scope.include_descendants and private.fuel_performance_unit_is_descendant(
              p_organisation_id, p_unit_id, scope.unit_id
            ))
          ))
          or (scope.scope_type = 'athlete' and private.fuel_performance_can_access_athlete(
            p_organisation_id, scope.athlete_id, p_unit_id, false, (select auth.uid())
          ))
        )
    );

  select
    count(distinct permitted.athlete_id) filter (where log_health.period_logs > 0)::integer,
    coalesce(sum(log_health.fuel_events), 0)::integer,
    coalesce(sum(log_health.sleepy_events), 0)::integer,
    count(distinct permitted.athlete_id) filter (where device_health.active_devices > 0)::integer,
    count(distinct permitted.athlete_id) filter (
      where log_health.last_log_at is null or log_health.last_log_at < now() - interval '3 days'
    )::integer,
    count(distinct permitted.athlete_id) filter (
      where device_health.active_devices > 0
        and coalesce(device_health.last_used_at, device_health.connected_at) < now() - interval '7 days'
    )::integer
  into logged_count, fuel_event_count, sleepy_event_count, connected_count, stale_count, stale_integration_count
  from private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
  left join lateral (
    select
      count(*) filter (
        where log.logged_at >= p_from::timestamptz
          and log.logged_at < (p_to + 1)::timestamptz
      ) as period_logs,
      count(*) filter (
        where log.type in ('fuel', 'fuel_hydration')
          and log.logged_at >= p_from::timestamptz
          and log.logged_at < (p_to + 1)::timestamptz
      ) as fuel_events,
      count(*) filter (
        where (log.notes like '%"checkinType":"sleepy"%' or log.notes like '%fuel_guard_event:crash%')
          and log.logged_at >= p_from::timestamptz
          and log.logged_at < (p_to + 1)::timestamptz
      ) as sleepy_events,
      max(log.logged_at) as last_log_at
    from public.fuel_logs log
    where log.user_id = permitted.athlete_id
  ) log_health on true
  left join lateral (
    select count(*) filter (where token.revoked_at is null) as active_devices,
           min(token.created_at) filter (where token.revoked_at is null) as connected_at,
           max(token.last_used_at) filter (where token.revoked_at is null) as last_used_at
    from public.garmin_device_tokens token
    where token.user_id = permitted.athlete_id
  ) device_health on true;

  select count(distinct permitted.athlete_id)::integer into attention_count
  from private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
  where
    not exists (
      select 1 from public.fuel_logs log
      where log.user_id = permitted.athlete_id
        and log.logged_at >= now() - interval '3 days'
    )
    or (
      select count(*) from public.fuel_logs log
      where log.user_id = permitted.athlete_id
        and log.logged_at >= now() - interval '7 days'
        and (log.notes like '%"checkinType":"sleepy"%' or log.notes like '%fuel_guard_event:crash%')
    ) >= 2
    or exists (
      select 1 from public.fuel_coach_interventions intervention
      where intervention.athlete_id = permitted.athlete_id
        and intervention.status in ('active', 'review_due')
        and intervention.review_date <= current_date
    )
    or exists (
      select 1
      from (
        select extract(epoch from (log.logged_at - lag(log.logged_at) over (
          order by log.logged_at
        ))) / 60.0 as gap_minutes
        from public.fuel_logs log
        where log.user_id = permitted.athlete_id
          and log.type in ('fuel', 'fuel_hydration')
          and log.logged_at >= now() - interval '7 days'
      ) recent_gap
      where recent_gap.gap_minutes > coalesce((
        select target.maximum_fuel_gap_minutes
        from public.fuel_targets target where target.user_id = permitted.athlete_id
      ), 180)
    )
    or exists (
      select 1 from public.garmin_daily_features feature
      where feature.user_id = permitted.athlete_id
        and feature.local_date >= current_date - 6
        and (feature.workouts_missing_pre_fuel > 0 or feature.workouts_missing_post_fuel > 0)
    )
    or (
      exists (
        select 1 from public.garmin_device_tokens token
        where token.user_id = permitted.athlete_id and token.revoked_at is not null
      )
      and not exists (
        select 1 from public.garmin_device_tokens token
        where token.user_id = permitted.athlete_id and token.revoked_at is null
      )
    )
    or exists (
      select 1 from public.garmin_device_tokens token
      where token.user_id = permitted.athlete_id and token.revoked_at is null
      group by token.user_id
      having coalesce(max(token.last_used_at), min(token.created_at)) < now() - interval '7 days'
    );

  select count(*)::integer into reviewed_count
  from public.fuel_coach_attention_actions action
  join private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
    on permitted.athlete_id = action.athlete_id
  where action.status = 'reviewed'
    and action.acted_at >= p_from::timestamptz
    and action.acted_at < (p_to + 1)::timestamptz;

  select
    count(*) filter (where intervention.status in ('active', 'review_due'))::integer,
    count(*) filter (
      where intervention.created_at >= p_from::timestamptz
        and intervention.created_at < (p_to + 1)::timestamptz
    )::integer,
    count(*) filter (
      where intervention.status in ('active', 'review_due')
        and intervention.review_date <= current_date
    )::integer,
    count(*) filter (
      where intervention.status in ('reviewed', 'closed')
        and intervention.updated_at >= p_from::timestamptz
        and intervention.updated_at < (p_to + 1)::timestamptz
    )::integer
  into open_interventions, interventions_created, follow_up_due, resolved_interventions
  from public.fuel_coach_interventions intervention
  join private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
    on permitted.athlete_id = intervention.athlete_id;

  has_detail := private.fuel_performance_has_capability(
    p_organisation_id, 'view_athlete_detail'
  );

  if has_detail then
    select coalesce(jsonb_agg(jsonb_build_object(
      'athleteId', signal.athlete_id,
      'athleteName', coalesce(profile.display_name, 'Athlete'),
      'unitId', signal.unit_id,
      'unitName', signal.unit_name,
      'responsibleStaffId', signal.coach_id,
      'responsibleStaffName', coalesce(coach_profile.display_name, 'Unassigned'),
      'issue', signal.issue,
      'status', signal.issue_status,
      'lastLogAt', signal.last_log_at,
      'followUpDue', signal.follow_up_due
    ) order by signal.priority desc, signal.last_log_at nulls first), '[]'::jsonb)
    into attention_details
    from (
      select distinct on (permitted.athlete_id)
        permitted.athlete_id,
        unit.id as unit_id,
        unit.name as unit_name,
        relationship.coach_id,
        log_health.last_log_at,
        due_intervention.follow_up_due,
        case
          when due_intervention.follow_up_due then 'Intervention follow-up due'
          when training_health.concern_count > 0 then 'Workout-relative fuelling concern'
          when gap_health.extended_gap_count > 0 then 'Repeated or extended fuel gap'
          when log_health.sleepy_events >= 2 then 'Repeated low-energy check-ins'
          when device_health.reconnect_required then 'Garmin connection requires attention'
          when device_health.stale_connection then 'Garmin sync appears stale'
          when log_health.last_log_at is null then 'No logging data'
          else 'No logs in the last 3 days'
        end as issue,
        case
          when due_intervention.intervention_count > 0 then 'intervention_created'
          when latest_action.status = 'reviewed' then 'reviewed'
          when latest_action.status = 'dismissed' then 'dismissed'
          else 'open'
        end as issue_status,
        case when due_intervention.follow_up_due then 5
             when training_health.concern_count > 0 then 4
             when gap_health.extended_gap_count > 0 then 3
             when log_health.sleepy_events >= 2 then 2 else 1 end as priority
      from private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, true) permitted
      join public.fuel_team_athletes assignment
        on assignment.organisation_id = p_organisation_id
       and assignment.athlete_id = permitted.athlete_id
       and assignment.status = 'active'
      join public.fuel_teams unit on unit.id = assignment.team_id
      left join public.fuel_coach_athletes relationship
        on relationship.athlete_id = permitted.athlete_id
       and relationship.status = 'active'
      left join lateral (
        select max(log.logged_at) as last_log_at,
               count(*) filter (
                 where log.logged_at >= now() - interval '7 days'
                   and (log.notes like '%"checkinType":"sleepy"%' or log.notes like '%fuel_guard_event:crash%')
               ) as sleepy_events
        from public.fuel_logs log where log.user_id = permitted.athlete_id
      ) log_health on true
      left join lateral (
        select count(*)::integer as extended_gap_count
        from (
          select extract(epoch from (log.logged_at - lag(log.logged_at) over (
            order by log.logged_at
          ))) / 60.0 as gap_minutes
          from public.fuel_logs log
          where log.user_id = permitted.athlete_id
            and log.type in ('fuel', 'fuel_hydration')
            and log.logged_at >= now() - interval '7 days'
        ) recent_gap
        where recent_gap.gap_minutes > coalesce((
          select target.maximum_fuel_gap_minutes
          from public.fuel_targets target where target.user_id = permitted.athlete_id
        ), 180)
      ) gap_health on true
      left join lateral (
        select count(*)::integer as concern_count
        from public.garmin_daily_features feature
        where feature.user_id = permitted.athlete_id
          and feature.local_date >= current_date - 6
          and (feature.workouts_missing_pre_fuel > 0 or feature.workouts_missing_post_fuel > 0)
      ) training_health on true
      left join lateral (
        select (count(*) filter (where token.revoked_at is not null) > 0
                and count(*) filter (where token.revoked_at is null) = 0) as reconnect_required,
               (count(*) filter (where token.revoked_at is null) > 0
                and coalesce(
                  max(token.last_used_at) filter (where token.revoked_at is null),
                  min(token.created_at) filter (where token.revoked_at is null)
                ) < now() - interval '7 days') as stale_connection
        from public.garmin_device_tokens token
        where token.user_id = permitted.athlete_id
      ) device_health on true
      left join lateral (
        select count(*) as intervention_count,
               bool_or(intervention.review_date <= current_date) as follow_up_due
        from public.fuel_coach_interventions intervention
        where intervention.athlete_id = permitted.athlete_id
          and intervention.status in ('active', 'review_due')
      ) due_intervention on true
      left join lateral (
        select action.status
        from public.fuel_coach_attention_actions action
        where action.athlete_id = permitted.athlete_id
        order by action.acted_at desc limit 1
      ) latest_action on true
      where log_health.last_log_at is null
         or log_health.last_log_at < now() - interval '3 days'
         or log_health.sleepy_events >= 2
         or due_intervention.follow_up_due
         or gap_health.extended_gap_count > 0
         or training_health.concern_count > 0
         or device_health.reconnect_required
         or device_health.stale_connection
      order by permitted.athlete_id, priority desc, unit.display_order, unit.name
    ) signal
    left join public.fuel_user_profiles profile on profile.user_id = signal.athlete_id
    left join public.fuel_user_profiles coach_profile on coach_profile.user_id = signal.coach_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'unitId', grouped.unit_id,
    'unitName', grouped.unit_name,
    'athletesNeedingAttention', grouped.attention_count
  ) order by grouped.attention_count desc, grouped.unit_name), '[]'::jsonb)
  into attention_by_unit
  from (
    select unit.id as unit_id, unit.name as unit_name,
           count(distinct permitted.athlete_id)::integer as attention_count
    from private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
    join public.fuel_team_athletes assignment
      on assignment.organisation_id = p_organisation_id
     and assignment.athlete_id = permitted.athlete_id
     and assignment.status = 'active'
    join public.fuel_teams unit on unit.id = assignment.team_id
    where not exists (
      select 1 from public.fuel_logs log
      where log.user_id = permitted.athlete_id
        and log.logged_at >= now() - interval '3 days'
    ) or exists (
      select 1 from public.fuel_coach_interventions intervention
      where intervention.athlete_id = permitted.athlete_id
        and intervention.status in ('active', 'review_due')
        and intervention.review_date <= current_date
    ) or exists (
      select 1
      from (
        select extract(epoch from (log.logged_at - lag(log.logged_at) over (
          order by log.logged_at
        ))) / 60.0 as gap_minutes
        from public.fuel_logs log
        where log.user_id = permitted.athlete_id
          and log.type in ('fuel', 'fuel_hydration')
          and log.logged_at >= now() - interval '7 days'
      ) recent_gap
      where recent_gap.gap_minutes > coalesce((
        select target.maximum_fuel_gap_minutes
        from public.fuel_targets target where target.user_id = permitted.athlete_id
      ), 180)
    ) or exists (
      select 1 from public.garmin_daily_features feature
      where feature.user_id = permitted.athlete_id
        and feature.local_date >= current_date - 6
        and (feature.workouts_missing_pre_fuel > 0 or feature.workouts_missing_post_fuel > 0)
    ) or (
      exists (
        select 1 from public.garmin_device_tokens token
        where token.user_id = permitted.athlete_id and token.revoked_at is not null
      ) and not exists (
        select 1 from public.garmin_device_tokens token
        where token.user_id = permitted.athlete_id and token.revoked_at is null
      )
    ) or exists (
      select 1 from public.garmin_device_tokens token
      where token.user_id = permitted.athlete_id and token.revoked_at is null
      group by token.user_id
      having coalesce(max(token.last_used_at), min(token.created_at)) < now() - interval '7 days'
    )
    group by unit.id, unit.name
  ) grouped;

  if cohort_count < minimum_cohort and not has_detail then
    attention_by_unit := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'status', case when cohort_count = 0 then 'empty' else 'ready' end,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'cohort', jsonb_build_object('count', cohort_count, 'minimum', minimum_cohort),
    'organisationHealth', jsonb_build_object(
      'activeAthletes', cohort_count,
      'activeStaff', coalesce(active_staff_count, 0),
      'loggingCoverage', case when cohort_count < minimum_cohort then null
        else round((coalesce(logged_count, 0)::numeric / nullif(cohort_count, 0)) * 100, 1) end,
      'wearableCoverage', case when cohort_count < minimum_cohort then null
        else round((coalesce(connected_count, 0)::numeric / nullif(cohort_count, 0)) * 100, 1) end,
      'athletesNeedingAttention', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(attention_count, 0) end,
      'openInterventions', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(open_interventions, 0) end
    ),
    'accountability', jsonb_build_object(
      'reviewedThisPeriod', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(reviewed_count, 0) end,
      'interventionsCreated', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(interventions_created, 0) end,
      'followUpDue', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(follow_up_due, 0) end,
      'resolvedThisPeriod', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(resolved_interventions, 0) end
    ),
    'dataHealth', jsonb_build_object(
      'status', case when cohort_count < minimum_cohort then 'insufficient_cohort' else 'available' end,
      'staleOrNoLogs', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(stale_count, 0) end,
      'connectedWearables', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(connected_count, 0) end,
      'disconnectedOrNotConnected', case when cohort_count < minimum_cohort and not has_detail
        then null else greatest(cohort_count - coalesce(connected_count, 0), 0) end,
      'staleIntegrations', case when cohort_count < minimum_cohort and not has_detail
        then null else coalesce(stale_integration_count, 0) end
    ),
    'behaviour', case when cohort_count < minimum_cohort then jsonb_build_object(
      'status', 'suppressed', 'reason', 'Insufficient cohort size',
      'fuelEvents', null, 'sleepyEvents', null
    ) else jsonb_build_object(
      'status', 'available', 'fuelEvents', coalesce(fuel_event_count, 0),
      'sleepyEvents', coalesce(sleepy_event_count, 0)
    ) end,
    'attentionItems', attention_details,
    'attentionByUnit', attention_by_unit,
    'weeklyBrief', jsonb_build_array(
      format('%s active athletes or clients are in your permitted scope.', cohort_count),
      case when cohort_count < minimum_cohort
        then 'Behavioural rates are suppressed because the permitted cohort is below the reporting minimum.'
        else format('%s%% logged during this reporting period.', round((coalesce(logged_count, 0)::numeric / nullif(cohort_count, 0)) * 100, 1)) end,
      case when cohort_count < minimum_cohort and not has_detail
        then 'Attention and intervention counts are protected for this small cohort.'
        else format('%s athlete%s currently require%s operational attention.', coalesce(attention_count, 0),
          case when coalesce(attention_count, 0) = 1 then '' else 's' end,
          case when coalesce(attention_count, 0) = 1 then 's' else '' end) end,
      case when cohort_count < minimum_cohort and not has_detail
        then 'Follow-up counts are protected for this small cohort.'
        else format('%s intervention follow-up%s due.', coalesce(follow_up_due, 0),
          case when coalesce(follow_up_due, 0) = 1 then ' is' else 's are' end) end,
      case when cohort_count < minimum_cohort and not has_detail
        then 'Data-health counts are protected for this small cohort.'
        else format('%s athlete%s have stale or missing log data.', coalesce(stale_count, 0),
          case when coalesce(stale_count, 0) = 1 then '' else 's' end) end
    )
  );
end;
$$;

revoke all on function public.fuel_performance_overview(uuid, uuid, date, date) from public, anon;
grant execute on function public.fuel_performance_overview(uuid, uuid, date, date) to authenticated;

create or replace function public.fuel_performance_pathway(
  p_organisation_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  minimum_cohort integer;
  units jsonb;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'view_performance')
     or not private.fuel_performance_has_capability(p_organisation_id, 'view_org_aggregates') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;

  select organisation.minimum_reporting_cohort into minimum_cohort
  from public.fuel_organisations organisation
  where organisation.id = p_organisation_id;
  if minimum_cohort is null then
    raise exception 'Organisation not found.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', unit_metrics.id,
    'parentId', unit_metrics.parent_team_id,
    'name', unit_metrics.name,
    'type', unit_metrics.unit_type,
    'displayOrder', unit_metrics.display_order,
    'athleteCount', unit_metrics.athlete_count,
    'staffCount', unit_metrics.staff_count,
    'attentionCount', case when unit_metrics.athlete_count < minimum_cohort
      then null else unit_metrics.attention_count end,
    'loggingCoverage', case when unit_metrics.athlete_count < minimum_cohort then null
      else round((unit_metrics.logged_count::numeric / nullif(unit_metrics.athlete_count, 0)) * 100, 1) end,
    'reportingStatus', case when unit_metrics.athlete_count < minimum_cohort
      then 'suppressed' else 'available' end
  ) order by unit_metrics.depth, unit_metrics.path_order), '[]'::jsonb)
  into units
  from (
    with recursive visible_units as (
      select unit.id, unit.parent_team_id, unit.name, unit.unit_type,
             unit.display_order, 0 as depth,
             lpad(unit.display_order::text, 8, '0') || ':' || unit.name as path_order
      from public.fuel_teams unit
      where unit.organisation_id = p_organisation_id
        and unit.parent_team_id is null
        and (
          private.fuel_performance_unit_in_scope(p_organisation_id, unit.id)
          or exists (
            select 1
            from private.fuel_performance_permitted_athletes(p_organisation_id, unit.id, false)
          )
        )
      union all
      select child.id, child.parent_team_id, child.name, child.unit_type,
             child.display_order, parent.depth + 1,
             parent.path_order || '/' || lpad(child.display_order::text, 8, '0') || ':' || child.name
      from public.fuel_teams child
      join visible_units parent on child.parent_team_id = parent.id
      where child.organisation_id = p_organisation_id
        and (
          private.fuel_performance_unit_in_scope(p_organisation_id, child.id)
          or exists (
            select 1
            from private.fuel_performance_permitted_athletes(p_organisation_id, child.id, false)
          )
        )
    )
    select visible.*,
      (select count(*)::integer
       from private.fuel_performance_permitted_athletes(p_organisation_id, visible.id, false)) as athlete_count,
      (select count(distinct scope.user_id)::integer
       from public.fuel_staff_scopes scope
       join public.fuel_organisation_members member
         on member.organisation_id = scope.organisation_id and member.user_id = scope.user_id
       where scope.organisation_id = p_organisation_id
         and scope.status = 'active' and member.status = 'active'
         and (scope.scope_type = 'organisation'
              or (scope.scope_type = 'unit' and (
                scope.unit_id = visible.id
                or (scope.include_descendants and private.fuel_performance_unit_is_descendant(
                  p_organisation_id, visible.id, scope.unit_id
                ))
              )))
      ) as staff_count,
      (select count(distinct permitted.athlete_id)::integer
       from private.fuel_performance_permitted_athletes(p_organisation_id, visible.id, false) permitted
       where not exists (
         select 1 from public.fuel_logs log
         where log.user_id = permitted.athlete_id and log.logged_at >= now() - interval '3 days'
       ) or exists (
         select 1 from public.fuel_coach_interventions intervention
         where intervention.athlete_id = permitted.athlete_id
           and intervention.status in ('active', 'review_due')
           and intervention.review_date <= current_date
       )
      ) as attention_count,
      (select count(distinct permitted.athlete_id)::integer
       from private.fuel_performance_permitted_athletes(p_organisation_id, visible.id, false) permitted
       where exists (
         select 1 from public.fuel_logs log
         where log.user_id = permitted.athlete_id and log.logged_at >= current_date - interval '6 days'
       )
      ) as logged_count
    from visible_units visible
  ) unit_metrics;

  return jsonb_build_object(
    'status', case when jsonb_array_length(units) = 0 then 'empty' else 'ready' end,
    'minimumReportingCohort', minimum_cohort,
    'units', units
  );
end;
$$;

revoke all on function public.fuel_performance_pathway(uuid) from public, anon;
grant execute on function public.fuel_performance_pathway(uuid) to authenticated;

create or replace function public.fuel_performance_staff_access(
  p_organisation_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  staff_rows jsonb;
begin
  if (select auth.uid()) is null
     or not (
       private.fuel_performance_has_capability(p_organisation_id, 'view_staff_activity')
       or private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access')
     ) then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'userId', member.user_id,
    'displayName', coalesce(profile.display_name, 'Staff member'),
    'membershipRole', member.role,
    'status', member.status,
    'capabilities', coalesce(capabilities.items, '[]'::jsonb),
    'scopes', coalesce(scopes.items, '[]'::jsonb),
    'lastMeaningfulActivityAt', activity.last_activity_at
  ) order by coalesce(profile.display_name, member.user_id::text)), '[]'::jsonb)
  into staff_rows
  from public.fuel_organisation_members member
  left join public.fuel_user_profiles profile on profile.user_id = member.user_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'capability', capability.capability,
      'status', capability.status
    ) order by capability.capability) as items
    from public.fuel_staff_capabilities capability
    where capability.organisation_id = member.organisation_id
      and capability.user_id = member.user_id
  ) capabilities on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', scope.id,
      'type', scope.scope_type,
      'unitId', scope.unit_id,
      'unitName', unit.name,
      'athleteId', scope.athlete_id,
      'athleteName', athlete_profile.display_name,
      'includeDescendants', scope.include_descendants,
      'status', scope.status
    ) order by scope.scope_type, coalesce(unit.name, athlete_profile.display_name, 'Organisation')) as items
    from public.fuel_staff_scopes scope
    left join public.fuel_teams unit on unit.id = scope.unit_id
    left join public.fuel_user_profiles athlete_profile on athlete_profile.user_id = scope.athlete_id
    where scope.organisation_id = member.organisation_id
      and scope.user_id = member.user_id
      and (
        private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access')
        or scope.user_id = (select auth.uid())
        or (scope.scope_type = 'organisation' and exists (
          select 1 from public.fuel_staff_scopes viewer_scope
          where viewer_scope.organisation_id = p_organisation_id
            and viewer_scope.user_id = (select auth.uid())
            and viewer_scope.scope_type = 'organisation'
            and viewer_scope.status = 'active'
        ))
        or (scope.scope_type = 'unit' and private.fuel_performance_unit_in_scope(
          p_organisation_id, scope.unit_id
        ))
        or (scope.scope_type = 'athlete' and private.fuel_performance_can_access_athlete(
          p_organisation_id, scope.athlete_id, null, false
        ))
      )
  ) scopes on true
  left join lateral (
    select max(event_at) as last_activity_at
    from (
      select max(action.acted_at) as event_at
      from public.fuel_coach_attention_actions action where action.coach_id = member.user_id
      union all
      select max(intervention.updated_at)
      from public.fuel_coach_interventions intervention where intervention.coach_id = member.user_id
      union all
      select max(note.created_at)
      from public.fuel_staff_notes note where note.author_id = member.user_id
    ) staff_events
  ) activity on true
  where member.organisation_id = p_organisation_id
    and (
      private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access')
      or member.user_id = (select auth.uid())
      or exists (
        select 1 from public.fuel_staff_scopes target_scope
        where target_scope.organisation_id = member.organisation_id
          and target_scope.user_id = member.user_id
          and target_scope.status = 'active'
          and (
            (target_scope.scope_type = 'organisation' and exists (
              select 1 from public.fuel_staff_scopes viewer_scope
              where viewer_scope.organisation_id = p_organisation_id
                and viewer_scope.user_id = (select auth.uid())
                and viewer_scope.scope_type = 'organisation'
                and viewer_scope.status = 'active'
            ))
            or (target_scope.scope_type = 'unit' and private.fuel_performance_unit_in_scope(
              p_organisation_id, target_scope.unit_id
            ))
            or (target_scope.scope_type = 'athlete' and private.fuel_performance_can_access_athlete(
              p_organisation_id, target_scope.athlete_id, null, false
            ))
          )
      )
    );

  return jsonb_build_object(
    'status', case when jsonb_array_length(staff_rows) = 0 then 'empty' else 'ready' end,
    'canManage', private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access'),
    'staff', staff_rows
  );
end;
$$;

revoke all on function public.fuel_performance_staff_access(uuid) from public, anon;
grant execute on function public.fuel_performance_staff_access(uuid) to authenticated;

create or replace function public.fuel_performance_reports(
  p_organisation_id uuid,
  p_unit_id uuid default null,
  p_from date default (current_date - 27),
  p_to date default current_date
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  minimum_cohort integer;
  cohort_count integer;
  fuel_events integer;
  sleepy_events integer;
  average_gap_minutes numeric;
  extended_gap_count integer;
  workout_count integer;
  missing_pre integer;
  missing_post integer;
  units jsonb;
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'view_performance')
     or not private.fuel_performance_has_capability(p_organisation_id, 'view_org_aggregates') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    raise exception 'Reporting period must be between 1 and 367 days.' using errcode = '22023';
  end if;
  if p_unit_id is not null and not exists (
    select 1 from public.fuel_teams unit
    where unit.id = p_unit_id and unit.organisation_id = p_organisation_id
  ) then
    raise exception 'Unit does not belong to this organisation.' using errcode = '22023';
  end if;

  select organisation.minimum_reporting_cohort into minimum_cohort
  from public.fuel_organisations organisation where organisation.id = p_organisation_id;
  if minimum_cohort is null then
    raise exception 'Organisation not found.' using errcode = '22023';
  end if;
  select count(*)::integer into cohort_count
  from private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false);

  if cohort_count < minimum_cohort then
    return jsonb_build_object(
      'status', 'suppressed',
      'reason', 'Insufficient cohort size',
      'cohort', jsonb_build_object('count', cohort_count, 'minimum', minimum_cohort),
      'fuelling', null,
      'trainingContext', null,
      'units', '[]'::jsonb
    );
  end if;

  with ordered_fuel as (
    select log.user_id, log.logged_at,
           extract(epoch from (log.logged_at - lag(log.logged_at) over (
             partition by log.user_id order by log.logged_at
           ))) / 60.0 as gap_minutes,
           log.notes
    from public.fuel_logs log
    join private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
      on permitted.athlete_id = log.user_id
    where log.logged_at >= p_from::timestamptz
      and log.logged_at < (p_to + 1)::timestamptz
      and log.type in ('fuel', 'fuel_hydration')
  )
  select count(*)::integer,
         coalesce(sum(case when notes like '%"checkinType":"sleepy"%'
                            or notes like '%fuel_guard_event:crash%' then 1 else 0 end), 0)::integer,
         round(avg(gap_minutes) filter (where gap_minutes between 0 and 1440), 1),
         count(*) filter (where gap_minutes > 240 and gap_minutes <= 1440)::integer
  into fuel_events, sleepy_events, average_gap_minutes, extended_gap_count
  from ordered_fuel;

  select
    coalesce(sum(feature.activity_count), 0)::integer,
    coalesce(sum(feature.workouts_missing_pre_fuel), 0)::integer,
    coalesce(sum(feature.workouts_missing_post_fuel), 0)::integer
  into workout_count, missing_pre, missing_post
  from public.garmin_daily_features feature
  join private.fuel_performance_permitted_athletes(p_organisation_id, p_unit_id, false) permitted
    on permitted.athlete_id = feature.user_id
  where feature.local_date between p_from and p_to;

  select coalesce(jsonb_agg(jsonb_build_object(
    'unitId', unit_summary.id,
    'unitName', unit_summary.name,
    'cohortCount', unit_summary.cohort_count,
    'status', case when unit_summary.cohort_count < minimum_cohort then 'suppressed' else 'available' end,
    'loggingCoverage', case when unit_summary.cohort_count < minimum_cohort then null
      else round((unit_summary.logged_count::numeric / nullif(unit_summary.cohort_count, 0)) * 100, 1) end,
    'attentionCount', case when unit_summary.cohort_count < minimum_cohort then null
      else unit_summary.attention_count end
  ) order by unit_summary.name), '[]'::jsonb)
  into units
  from (
    select unit.id, unit.name,
      (select count(*)::integer
       from private.fuel_performance_permitted_athletes(p_organisation_id, unit.id, false)) as cohort_count,
      (select count(*)::integer
       from private.fuel_performance_permitted_athletes(p_organisation_id, unit.id, false) permitted
       where exists (
         select 1 from public.fuel_logs log
         where log.user_id = permitted.athlete_id
           and log.logged_at >= p_from::timestamptz
           and log.logged_at < (p_to + 1)::timestamptz
       )) as logged_count,
      (select count(*)::integer
       from private.fuel_performance_permitted_athletes(p_organisation_id, unit.id, false) permitted
       where not exists (
         select 1 from public.fuel_logs log
         where log.user_id = permitted.athlete_id and log.logged_at >= now() - interval '3 days'
       )) as attention_count
    from public.fuel_teams unit
    where unit.organisation_id = p_organisation_id
      and (
        private.fuel_performance_unit_in_scope(p_organisation_id, unit.id)
        or exists (
          select 1
          from private.fuel_performance_permitted_athletes(p_organisation_id, unit.id, false)
        )
      )
  ) unit_summary;

  return jsonb_build_object(
    'status', 'available',
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'cohort', jsonb_build_object('count', cohort_count, 'minimum', minimum_cohort),
    'fuelling', jsonb_build_object(
      'fuelEvents', coalesce(fuel_events, 0),
      'averageFuelGapMinutes', average_gap_minutes,
      'extendedGapCount', coalesce(extended_gap_count, 0),
      'sleepyEventCount', coalesce(sleepy_events, 0)
    ),
    'trainingContext', case when coalesce(workout_count, 0) = 0 then jsonb_build_object(
      'status', 'insufficient_data',
      'reason', 'No normalized workout summaries are available for this period.',
      'workoutCount', 0,
      'missingPreFuelCount', null,
      'missingPostFuelCount', null
    ) else jsonb_build_object(
      'status', 'available',
      'workoutCount', workout_count,
      'missingPreFuelCount', missing_pre,
      'missingPostFuelCount', missing_post
    ) end,
    'units', units
  );
end;
$$;

revoke all on function public.fuel_performance_reports(uuid, uuid, date, date) from public, anon;
grant execute on function public.fuel_performance_reports(uuid, uuid, date, date) to authenticated;

create or replace function public.fuel_performance_set_reporting_minimum(
  p_organisation_id uuid,
  p_minimum integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not private.fuel_performance_has_capability(p_organisation_id, 'manage_reports') then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  if p_minimum < 3 or p_minimum > 25 then
    raise exception 'Minimum reporting cohort must be between 3 and 25.' using errcode = '22023';
  end if;
  update public.fuel_organisations
  set minimum_reporting_cohort = p_minimum, updated_at = now()
  where id = p_organisation_id;
  if not found then raise exception 'Organisation not found.' using errcode = '22023'; end if;
  return p_minimum;
end;
$$;

revoke all on function public.fuel_performance_set_reporting_minimum(uuid, integer) from public, anon;
grant execute on function public.fuel_performance_set_reporting_minimum(uuid, integer) to authenticated;

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
  select exists (
    select 1 from public.fuel_staff_scopes scope
    where scope.organisation_id = p_organisation_id
      and scope.user_id = (select auth.uid())
      and scope.scope_type = 'organisation' and scope.status = 'active'
  ) into has_org_scope;
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
    if saved_id is null then raise exception 'Unit not found.' using errcode = '22023'; end if;
  end if;
  return saved_id;
end;
$$;

revoke all on function public.fuel_performance_save_unit(uuid, uuid, uuid, text, text, text, integer) from public, anon;
grant execute on function public.fuel_performance_save_unit(uuid, uuid, uuid, text, text, text, integer) to authenticated;

create or replace function public.fuel_performance_athlete_shares(
  p_organisation_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  shares jsonb;
begin
  if (select auth.uid()) is null
     or not (
       private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access')
       or private.fuel_performance_has_capability(p_organisation_id, 'view_athlete_detail')
     ) then
    raise exception 'Performance access denied.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', share.id,
    'athleteId', share.athlete_id,
    'athleteName', coalesce(profile.display_name, 'Athlete'),
    'status', share.status,
    'sharedAt', share.shared_at,
    'revokedAt', share.revoked_at
  ) order by coalesce(profile.display_name, share.athlete_id::text)), '[]'::jsonb)
  into shares
  from public.fuel_organisation_athlete_shares share
  left join public.fuel_user_profiles profile on profile.user_id = share.athlete_id
  where share.organisation_id = p_organisation_id
    and (
      private.fuel_performance_has_capability(p_organisation_id, 'manage_staff_access')
      or private.fuel_performance_can_access_athlete(
        p_organisation_id, share.athlete_id, null, true
      )
    );
  return jsonb_build_object('shares', shares);
end;
$$;

revoke all on function public.fuel_performance_athlete_shares(uuid) from public, anon;
grant execute on function public.fuel_performance_athlete_shares(uuid) to authenticated;

create or replace function public.fuel_athlete_organisation_shares()
returns table (
  share_id uuid,
  organisation_id uuid,
  organisation_name text,
  status text,
  invited_at timestamptz,
  shared_at timestamptz,
  revoked_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select share.id, share.organisation_id, organisation.name, share.status,
         share.invited_at, share.shared_at, share.revoked_at
  from public.fuel_organisation_athlete_shares share
  join public.fuel_organisations organisation on organisation.id = share.organisation_id
  where (select auth.uid()) is not null
    and share.athlete_id = (select auth.uid())
  order by share.invited_at desc;
$$;

revoke all on function public.fuel_athlete_organisation_shares() from public, anon;
grant execute on function public.fuel_athlete_organisation_shares() to authenticated;

create or replace function public.fuel_athlete_set_organisation_sharing(
  p_share_id uuid,
  p_status text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or p_status not in ('active', 'revoked') then
    raise exception 'Invalid organisation sharing request.' using errcode = '22023';
  end if;
  update public.fuel_organisation_athlete_shares
  set status = p_status,
      shared_at = case when p_status = 'active' then coalesce(shared_at, now()) else shared_at end,
      revoked_at = case when p_status = 'revoked' then now() else null end,
      updated_at = now()
  where id = p_share_id and athlete_id = (select auth.uid());
  if not found then raise exception 'Organisation sharing request not found.' using errcode = '22023'; end if;
  return p_status;
end;
$$;

revoke all on function public.fuel_athlete_set_organisation_sharing(uuid, text) from public, anon;
grant execute on function public.fuel_athlete_set_organisation_sharing(uuid, text) to authenticated;

comment on function public.fuel_performance_overview(uuid, uuid, date, date) is
  'Permission-resolved organisational overview. Returns no raw athlete event history and suppresses behavioural rates below the configured cohort minimum.';
comment on function public.fuel_performance_reports(uuid, uuid, date, date) is
  'Server-side behavioural and normalized workout-context aggregates for only actively shared athletes in the caller scope.';
