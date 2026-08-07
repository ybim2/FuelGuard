-- Fuel Guard organisational foundations for shared staff notes, saved roster
-- groups, and team training schedules.
--
-- This migration deliberately composes with public.fuel_coach_athletes. A team,
-- staff membership, saved group, or training assignment never grants access to
-- athlete data by itself. Staff access to an athlete always also requires an
-- active direct coach-athlete sharing relationship.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.fuel_organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_organisations_name_check
    check (char_length(trim(name)) between 1 and 160)
);

create table public.fuel_organisation_members (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.fuel_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff',
  status text not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_organisation_members_role_check
    check (role in ('owner', 'admin', 'staff')),
  constraint fuel_organisation_members_status_check
    check (status in ('pending', 'active', 'revoked')),
  constraint fuel_organisation_members_joined_check
    check (status <> 'active' or joined_at is not null),
  constraint fuel_organisation_members_revoked_check
    check (status <> 'revoked' or revoked_at is not null),
  constraint fuel_organisation_members_unique unique (organisation_id, user_id)
);

create table public.fuel_teams (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.fuel_organisations(id) on delete cascade,
  name text not null,
  timezone_name text not null default 'UTC',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_teams_name_check
    check (char_length(trim(name)) between 1 and 160),
  constraint fuel_teams_timezone_check
    check (char_length(trim(timezone_name)) between 1 and 80),
  constraint fuel_teams_id_organisation_unique unique (id, organisation_id),
  constraint fuel_teams_organisation_name_unique unique (organisation_id, name)
);

create table public.fuel_team_staff (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  staff_role text not null default 'coach',
  access_level text not null default 'viewer',
  status text not null default 'active',
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_team_staff_team_fk
    foreign key (team_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_team_staff_organisation_member_fk
    foreign key (organisation_id, user_id)
    references public.fuel_organisation_members(organisation_id, user_id) on delete cascade,
  constraint fuel_team_staff_role_check
    check (staff_role in ('head_coach', 'coach', 'performance_nutritionist', 'strength_conditioning', 'support_staff', 'other')),
  constraint fuel_team_staff_access_check
    check (access_level in ('viewer', 'contributor', 'manager')),
  constraint fuel_team_staff_status_check
    check (status in ('active', 'revoked')),
  constraint fuel_team_staff_joined_check
    check (status <> 'active' or joined_at is not null),
  constraint fuel_team_staff_revoked_check
    check (status <> 'revoked' or revoked_at is not null),
  constraint fuel_team_staff_unique unique (team_id, user_id)
);

create table public.fuel_team_athletes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  team_id uuid not null,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active',
  added_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_team_athletes_team_fk
    foreign key (team_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_team_athletes_status_check
    check (status in ('active', 'revoked')),
  constraint fuel_team_athletes_joined_check
    check (status <> 'active' or joined_at is not null),
  constraint fuel_team_athletes_revoked_check
    check (status <> 'revoked' or revoked_at is not null),
  constraint fuel_team_athletes_unique unique (team_id, athlete_id)
);

create table public.fuel_staff_notes (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  team_id uuid not null,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  author_display_name text,
  category text not null default 'general',
  note_text text not null,
  created_at timestamptz not null default now(),
  constraint fuel_staff_notes_team_fk
    foreign key (team_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_staff_notes_category_check
    check (category in ('general', 'nutrition_reviewed', 'coach_contact', 'travel_plan', 'training', 'other')),
  constraint fuel_staff_notes_text_check
    check (char_length(trim(note_text)) between 1 and 4000)
);

create table public.fuel_saved_groups (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  organisation_id uuid,
  team_id uuid,
  coach_id uuid references auth.users(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_saved_groups_team_fk
    foreign key (team_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_saved_groups_scope_check
    check (
      (scope = 'personal' and coach_id is not null and organisation_id is null and team_id is null)
      or
      (scope = 'team' and coach_id is null and organisation_id is not null and team_id is not null)
    ),
  constraint fuel_saved_groups_name_check
    check (char_length(trim(name)) between 1 and 100),
  constraint fuel_saved_groups_id_team_unique unique (id, organisation_id, team_id)
);

create table public.fuel_saved_group_members (
  group_id uuid not null references public.fuel_saved_groups(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (group_id, athlete_id)
);

create table public.fuel_training_sessions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  team_id uuid not null,
  saved_group_id uuid,
  session_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone_name text not null,
  session_type text not null,
  session_name text,
  location text,
  source text not null default 'manual',
  source_provider text,
  external_session_id text,
  source_updated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_training_sessions_team_fk
    foreign key (team_id, organisation_id)
    references public.fuel_teams(id, organisation_id) on delete cascade,
  constraint fuel_training_sessions_group_fk
    foreign key (saved_group_id, organisation_id, team_id)
    references public.fuel_saved_groups(id, organisation_id, team_id)
    on delete set null (saved_group_id),
  constraint fuel_training_sessions_time_order_check
    check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours'),
  constraint fuel_training_sessions_local_date_check
    check (session_date = timezone(timezone_name, starts_at)::date),
  constraint fuel_training_sessions_timezone_check
    check (char_length(trim(timezone_name)) between 1 and 80),
  constraint fuel_training_sessions_type_check
    check (char_length(trim(session_type)) between 1 and 80),
  constraint fuel_training_sessions_name_check
    check (session_name is null or char_length(trim(session_name)) between 1 and 160),
  constraint fuel_training_sessions_source_check
    check (
      (source in ('manual', 'csv_import') and source_provider is null and external_session_id is null)
      or
      (source = 'external_provider' and char_length(trim(source_provider)) between 1 and 100 and char_length(trim(external_session_id)) between 1 and 240)
    )
);

create table public.fuel_training_session_athletes (
  session_id uuid not null references public.fuel_training_sessions(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (session_id, athlete_id)
);

create index fuel_organisation_members_user_status_idx
  on public.fuel_organisation_members (user_id, status, organisation_id);
create index fuel_organisation_members_organisation_status_idx
  on public.fuel_organisation_members (organisation_id, status, user_id);
create index fuel_organisations_created_by_idx
  on public.fuel_organisations (created_by)
  where created_by is not null;
create index fuel_organisation_members_invited_by_idx
  on public.fuel_organisation_members (invited_by)
  where invited_by is not null;
create index fuel_teams_organisation_idx
  on public.fuel_teams (organisation_id, name);
create index fuel_teams_created_by_idx
  on public.fuel_teams (created_by)
  where created_by is not null;
create index fuel_team_staff_user_status_idx
  on public.fuel_team_staff (user_id, status, team_id);
create index fuel_team_staff_team_status_idx
  on public.fuel_team_staff (team_id, status, user_id);
create index fuel_team_staff_organisation_user_idx
  on public.fuel_team_staff (organisation_id, user_id);
create index fuel_team_staff_added_by_idx
  on public.fuel_team_staff (added_by)
  where added_by is not null;
create index fuel_team_athletes_athlete_status_idx
  on public.fuel_team_athletes (athlete_id, status, team_id);
create index fuel_team_athletes_team_status_idx
  on public.fuel_team_athletes (team_id, status, athlete_id);
create index fuel_team_athletes_added_by_idx
  on public.fuel_team_athletes (added_by)
  where added_by is not null;
create index fuel_staff_notes_team_athlete_created_idx
  on public.fuel_staff_notes (team_id, athlete_id, created_at desc);
create index fuel_staff_notes_organisation_created_idx
  on public.fuel_staff_notes (organisation_id, created_at desc);
create index fuel_staff_notes_athlete_created_idx
  on public.fuel_staff_notes (athlete_id, created_at desc);
create index fuel_staff_notes_author_created_idx
  on public.fuel_staff_notes (author_id, created_at desc)
  where author_id is not null;
create unique index fuel_saved_groups_personal_name_idx
  on public.fuel_saved_groups (coach_id, lower(name))
  where scope = 'personal';
create unique index fuel_saved_groups_team_name_idx
  on public.fuel_saved_groups (team_id, lower(name))
  where scope = 'team';
create index fuel_saved_groups_organisation_team_idx
  on public.fuel_saved_groups (organisation_id, team_id)
  where organisation_id is not null;
create index fuel_saved_groups_created_by_idx
  on public.fuel_saved_groups (created_by)
  where created_by is not null;
create index fuel_saved_group_members_athlete_idx
  on public.fuel_saved_group_members (athlete_id, group_id);
create index fuel_saved_group_members_added_by_idx
  on public.fuel_saved_group_members (added_by)
  where added_by is not null;
create index fuel_training_sessions_team_start_idx
  on public.fuel_training_sessions (team_id, starts_at, ends_at);
create index fuel_training_sessions_group_start_idx
  on public.fuel_training_sessions (saved_group_id, starts_at)
  where saved_group_id is not null;
create index fuel_training_sessions_local_date_idx
  on public.fuel_training_sessions (organisation_id, session_date, starts_at);
create unique index fuel_training_sessions_external_idx
  on public.fuel_training_sessions (source_provider, external_session_id)
  where source = 'external_provider';
create index fuel_training_sessions_created_by_idx
  on public.fuel_training_sessions (created_by)
  where created_by is not null;
create index fuel_training_sessions_updated_by_idx
  on public.fuel_training_sessions (updated_by)
  where updated_by is not null;
create index fuel_training_session_athletes_athlete_idx
  on public.fuel_training_session_athletes (athlete_id, session_id);
create index fuel_training_session_athletes_assigned_by_idx
  on public.fuel_training_session_athletes (assigned_by)
  where assigned_by is not null;

create or replace function private.fuel_is_active_organisation_member(p_organisation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_organisation_members member
      where member.organisation_id = p_organisation_id
        and member.user_id = (select auth.uid())
        and member.status = 'active'
    );
$$;

create or replace function private.fuel_can_manage_organisation(p_organisation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.fuel_organisations organisation
        where organisation.id = p_organisation_id
          and organisation.created_by = (select auth.uid())
      )
      or exists (
        select 1
        from public.fuel_organisation_members member
        where member.organisation_id = p_organisation_id
          and member.user_id = (select auth.uid())
          and member.status = 'active'
          and member.role in ('owner', 'admin')
      )
    );
$$;

create or replace function private.fuel_has_team_access(
  p_team_id uuid,
  p_required_access text default 'viewer'
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_team_staff staff
      join public.fuel_organisation_members member
        on member.organisation_id = staff.organisation_id
       and member.user_id = staff.user_id
      where staff.team_id = p_team_id
        and staff.user_id = (select auth.uid())
        and staff.status = 'active'
        and member.status = 'active'
        and case staff.access_level
          when 'viewer' then 1
          when 'contributor' then 2
          when 'manager' then 3
          else 0
        end >= case p_required_access
          when 'viewer' then 1
          when 'contributor' then 2
          when 'manager' then 3
          else 4
        end
    );
$$;

create or replace function private.fuel_has_direct_athlete_access(p_athlete_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = (select auth.uid())
        and relationship.athlete_id = p_athlete_id
        and relationship.status = 'active'
    );
$$;

create or replace function private.fuel_can_access_team_athlete(
  p_team_id uuid,
  p_athlete_id uuid,
  p_required_access text default 'viewer'
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (select private.fuel_has_team_access(p_team_id, p_required_access))
    and (select private.fuel_has_direct_athlete_access(p_athlete_id))
    and exists (
      select 1
      from public.fuel_team_athletes athlete
      where athlete.team_id = p_team_id
        and athlete.athlete_id = p_athlete_id
        and athlete.status = 'active'
    );
$$;

create or replace function private.fuel_can_view_saved_group(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_saved_groups saved_group
      where saved_group.id = p_group_id
        and (
          (saved_group.scope = 'personal' and saved_group.coach_id = (select auth.uid()))
          or
          (saved_group.scope = 'team' and (select private.fuel_has_team_access(saved_group.team_id, 'viewer')))
        )
    );
$$;

create or replace function private.fuel_can_manage_saved_group(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_saved_groups saved_group
      where saved_group.id = p_group_id
        and (
          (saved_group.scope = 'personal' and saved_group.coach_id = (select auth.uid()))
          or
          (saved_group.scope = 'team' and (select private.fuel_has_team_access(saved_group.team_id, 'contributor')))
        )
    );
$$;

create or replace function private.fuel_can_access_saved_group_athlete(
  p_group_id uuid,
  p_athlete_id uuid,
  p_require_manage boolean default false
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and case
      when p_require_manage then (select private.fuel_can_manage_saved_group(p_group_id))
      else (select private.fuel_can_view_saved_group(p_group_id))
    end
    and (select private.fuel_has_direct_athlete_access(p_athlete_id))
    and exists (
      select 1
      from public.fuel_saved_groups saved_group
      where saved_group.id = p_group_id
        and (
          saved_group.scope = 'personal'
          or exists (
            select 1
            from public.fuel_team_athletes athlete
            where athlete.team_id = saved_group.team_id
              and athlete.athlete_id = p_athlete_id
              and athlete.status = 'active'
          )
        )
    );
$$;

create or replace function private.fuel_is_training_session_athlete(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_training_session_athletes assignment
      join public.fuel_training_sessions training_session
        on training_session.id = assignment.session_id
      join public.fuel_team_athletes team_athlete
        on team_athlete.team_id = training_session.team_id
       and team_athlete.athlete_id = assignment.athlete_id
       and team_athlete.status = 'active'
      where assignment.session_id = p_session_id
        and assignment.athlete_id = (select auth.uid())
    );
$$;

create or replace function private.fuel_can_access_training_session_athlete(
  p_session_id uuid,
  p_athlete_id uuid,
  p_required_access text default 'viewer'
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.fuel_training_sessions training_session
      where training_session.id = p_session_id
        and (select private.fuel_can_access_team_athlete(
          training_session.team_id,
          p_athlete_id,
          p_required_access
        ))
    );
$$;

revoke all on function private.fuel_is_active_organisation_member(uuid) from public, anon;
revoke all on function private.fuel_can_manage_organisation(uuid) from public, anon;
revoke all on function private.fuel_has_team_access(uuid, text) from public, anon;
revoke all on function private.fuel_has_direct_athlete_access(uuid) from public, anon;
revoke all on function private.fuel_can_access_team_athlete(uuid, uuid, text) from public, anon;
revoke all on function private.fuel_can_view_saved_group(uuid) from public, anon;
revoke all on function private.fuel_can_manage_saved_group(uuid) from public, anon;
revoke all on function private.fuel_can_access_saved_group_athlete(uuid, uuid, boolean) from public, anon;
revoke all on function private.fuel_is_training_session_athlete(uuid) from public, anon;
revoke all on function private.fuel_can_access_training_session_athlete(uuid, uuid, text) from public, anon;

grant execute on function private.fuel_is_active_organisation_member(uuid) to authenticated;
grant execute on function private.fuel_can_manage_organisation(uuid) to authenticated;
grant execute on function private.fuel_has_team_access(uuid, text) to authenticated;
grant execute on function private.fuel_has_direct_athlete_access(uuid) to authenticated;
grant execute on function private.fuel_can_access_team_athlete(uuid, uuid, text) to authenticated;
grant execute on function private.fuel_can_view_saved_group(uuid) to authenticated;
grant execute on function private.fuel_can_manage_saved_group(uuid) to authenticated;
grant execute on function private.fuel_can_access_saved_group_athlete(uuid, uuid, boolean) to authenticated;
grant execute on function private.fuel_is_training_session_athlete(uuid) to authenticated;
grant execute on function private.fuel_can_access_training_session_athlete(uuid, uuid, text) to authenticated;

create or replace function private.fuel_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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

create or replace function private.fuel_prepare_staff_note()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or new.author_id is distinct from (select auth.uid()) then
    raise exception 'Staff note author must match the authenticated user' using errcode = '42501';
  end if;

  select coalesce(nullif(trim(profile.display_name), ''), 'Fuel Guard Staff')
  into new.author_display_name
  from public.fuel_user_profiles profile
  where profile.user_id = new.author_id;

  new.author_display_name := coalesce(new.author_display_name, 'Fuel Guard Staff');
  new.created_at := now();
  return new;
end;
$$;

create or replace function private.fuel_touch_training_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce((select auth.uid()), old.updated_by);
  return new;
end;
$$;

revoke all on function private.fuel_touch_updated_at() from public, anon, authenticated;
revoke all on function private.fuel_bootstrap_organisation_owner() from public, anon, authenticated;
revoke all on function private.fuel_bootstrap_team_manager() from public, anon, authenticated;
revoke all on function private.fuel_prepare_staff_note() from public, anon, authenticated;
revoke all on function private.fuel_touch_training_session() from public, anon, authenticated;

create trigger fuel_organisations_touch_updated_at
  before update on public.fuel_organisations
  for each row execute function private.fuel_touch_updated_at();
create trigger fuel_organisation_members_touch_updated_at
  before update on public.fuel_organisation_members
  for each row execute function private.fuel_touch_updated_at();
create trigger fuel_teams_touch_updated_at
  before update on public.fuel_teams
  for each row execute function private.fuel_touch_updated_at();
create trigger fuel_team_staff_touch_updated_at
  before update on public.fuel_team_staff
  for each row execute function private.fuel_touch_updated_at();
create trigger fuel_team_athletes_touch_updated_at
  before update on public.fuel_team_athletes
  for each row execute function private.fuel_touch_updated_at();
create trigger fuel_saved_groups_touch_updated_at
  before update on public.fuel_saved_groups
  for each row execute function private.fuel_touch_updated_at();
create trigger fuel_training_sessions_touch_updated_at
  before update on public.fuel_training_sessions
  for each row execute function private.fuel_touch_training_session();
create trigger fuel_organisations_bootstrap_owner
  after insert on public.fuel_organisations
  for each row execute function private.fuel_bootstrap_organisation_owner();
create trigger fuel_teams_bootstrap_manager
  after insert on public.fuel_teams
  for each row execute function private.fuel_bootstrap_team_manager();
create trigger fuel_staff_notes_prepare
  before insert on public.fuel_staff_notes
  for each row execute function private.fuel_prepare_staff_note();

alter table public.fuel_organisations enable row level security;
alter table public.fuel_organisation_members enable row level security;
alter table public.fuel_teams enable row level security;
alter table public.fuel_team_staff enable row level security;
alter table public.fuel_team_athletes enable row level security;
alter table public.fuel_staff_notes enable row level security;
alter table public.fuel_saved_groups enable row level security;
alter table public.fuel_saved_group_members enable row level security;
alter table public.fuel_training_sessions enable row level security;
alter table public.fuel_training_session_athletes enable row level security;

revoke all on table public.fuel_organisations from public, anon, authenticated;
revoke all on table public.fuel_organisation_members from public, anon, authenticated;
revoke all on table public.fuel_teams from public, anon, authenticated;
revoke all on table public.fuel_team_staff from public, anon, authenticated;
revoke all on table public.fuel_team_athletes from public, anon, authenticated;
revoke all on table public.fuel_staff_notes from public, anon, authenticated;
revoke all on table public.fuel_saved_groups from public, anon, authenticated;
revoke all on table public.fuel_saved_group_members from public, anon, authenticated;
revoke all on table public.fuel_training_sessions from public, anon, authenticated;
revoke all on table public.fuel_training_session_athletes from public, anon, authenticated;

grant select, insert on table public.fuel_organisations to authenticated;
grant update (name) on table public.fuel_organisations to authenticated;
grant select, insert on table public.fuel_organisation_members to authenticated;
grant update (role, status, joined_at, revoked_at) on table public.fuel_organisation_members to authenticated;
grant select, insert on table public.fuel_teams to authenticated;
grant update (name, timezone_name) on table public.fuel_teams to authenticated;
grant select, insert on table public.fuel_team_staff to authenticated;
grant update (staff_role, access_level, status, joined_at, revoked_at) on table public.fuel_team_staff to authenticated;
grant select, insert on table public.fuel_team_athletes to authenticated;
grant update (status, joined_at, revoked_at) on table public.fuel_team_athletes to authenticated;
grant select, insert on table public.fuel_staff_notes to authenticated;
grant select, insert, delete on table public.fuel_saved_groups to authenticated;
grant update (name) on table public.fuel_saved_groups to authenticated;
grant select, insert, delete on table public.fuel_saved_group_members to authenticated;
grant select, delete on table public.fuel_training_sessions to authenticated;
grant insert (
  id,
  organisation_id,
  team_id,
  saved_group_id,
  session_date,
  starts_at,
  ends_at,
  timezone_name,
  session_type,
  session_name,
  location,
  created_by,
  updated_by
) on table public.fuel_training_sessions to authenticated;
grant update (
  saved_group_id,
  session_date,
  starts_at,
  ends_at,
  timezone_name,
  session_type,
  session_name,
  location,
  source_updated_at
) on table public.fuel_training_sessions to authenticated;
grant select, insert, delete on table public.fuel_training_session_athletes to authenticated;

create policy fuel_organisations_select_member
  on public.fuel_organisations for select to authenticated
  using ((select private.fuel_is_active_organisation_member(id)));
create policy fuel_organisations_insert_coach
  on public.fuel_organisations for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.fuel_user_profiles profile
      where profile.user_id = (select auth.uid())
        and (profile.coach_enabled is true or profile.role = 'coach')
    )
  );
create policy fuel_organisations_update_manager
  on public.fuel_organisations for update to authenticated
  using ((select private.fuel_can_manage_organisation(id)))
  with check ((select private.fuel_can_manage_organisation(id)));

create policy fuel_organisation_members_select_same_organisation
  on public.fuel_organisation_members for select to authenticated
  using ((select private.fuel_is_active_organisation_member(organisation_id)));
create policy fuel_organisation_members_insert_manager
  on public.fuel_organisation_members for insert to authenticated
  with check (
    (select private.fuel_can_manage_organisation(organisation_id))
    and invited_by = (select auth.uid())
  );
create policy fuel_organisation_members_update_manager
  on public.fuel_organisation_members for update to authenticated
  using ((select private.fuel_can_manage_organisation(organisation_id)))
  with check ((select private.fuel_can_manage_organisation(organisation_id)));

create policy fuel_teams_select_staff
  on public.fuel_teams for select to authenticated
  using (
    (select private.fuel_has_team_access(id, 'viewer'))
    or (select private.fuel_can_manage_organisation(organisation_id))
  );
create policy fuel_teams_insert_organisation_manager
  on public.fuel_teams for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select private.fuel_can_manage_organisation(organisation_id))
  );
create policy fuel_teams_update_manager
  on public.fuel_teams for update to authenticated
  using (
    (select private.fuel_has_team_access(id, 'manager'))
    or (select private.fuel_can_manage_organisation(organisation_id))
  )
  with check (
    (select private.fuel_has_team_access(id, 'manager'))
    or (select private.fuel_can_manage_organisation(organisation_id))
  );

create policy fuel_team_staff_select_authorised
  on public.fuel_team_staff for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.fuel_has_team_access(team_id, 'manager'))
    or (select private.fuel_can_manage_organisation(organisation_id))
  );
create policy fuel_team_staff_insert_manager
  on public.fuel_team_staff for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and (
      (select private.fuel_has_team_access(team_id, 'manager'))
      or (select private.fuel_can_manage_organisation(organisation_id))
    )
    and exists (
      select 1
      from public.fuel_organisation_members member
      where member.organisation_id = fuel_team_staff.organisation_id
        and member.user_id = fuel_team_staff.user_id
        and member.status = 'active'
    )
  );
create policy fuel_team_staff_update_manager
  on public.fuel_team_staff for update to authenticated
  using (
    (select private.fuel_has_team_access(team_id, 'manager'))
    or (select private.fuel_can_manage_organisation(organisation_id))
  )
  with check (
    (select private.fuel_has_team_access(team_id, 'manager'))
    or (select private.fuel_can_manage_organisation(organisation_id))
  );

create policy fuel_team_athletes_select_authorised
  on public.fuel_team_athletes for select to authenticated
  using (
    athlete_id = (select auth.uid())
    or (select private.fuel_can_access_team_athlete(team_id, athlete_id, 'viewer'))
  );
create policy fuel_team_athletes_insert_contributor
  on public.fuel_team_athletes for insert to authenticated
  with check (
    status = 'active'
    and added_by = (select auth.uid())
    and (select private.fuel_has_team_access(team_id, 'contributor'))
    and (select private.fuel_has_direct_athlete_access(athlete_id))
  );
create policy fuel_team_athletes_update_authorised
  on public.fuel_team_athletes for update to authenticated
  using (
    athlete_id = (select auth.uid())
    or (select private.fuel_can_access_team_athlete(team_id, athlete_id, 'contributor'))
  )
  with check (
    (athlete_id = (select auth.uid()) and status = 'revoked')
    or (
      (select private.fuel_has_team_access(team_id, 'contributor'))
      and (select private.fuel_has_direct_athlete_access(athlete_id))
      and status in ('active', 'revoked')
    )
  );

create policy fuel_staff_notes_select_authorised_staff
  on public.fuel_staff_notes for select to authenticated
  using ((select private.fuel_can_access_team_athlete(team_id, athlete_id, 'viewer')));
create policy fuel_staff_notes_insert_authorised_staff
  on public.fuel_staff_notes for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and (select private.fuel_can_access_team_athlete(team_id, athlete_id, 'contributor'))
  );

create policy fuel_saved_groups_select_authorised
  on public.fuel_saved_groups for select to authenticated
  using ((select private.fuel_can_view_saved_group(id)));
create policy fuel_saved_groups_insert_authorised
  on public.fuel_saved_groups for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (
        scope = 'personal'
        and coach_id = (select auth.uid())
        and exists (
          select 1
          from public.fuel_user_profiles profile
          where profile.user_id = (select auth.uid())
            and (profile.coach_enabled is true or profile.role = 'coach')
        )
      )
      or
      (scope = 'team' and (select private.fuel_has_team_access(team_id, 'contributor')))
    )
  );
create policy fuel_saved_groups_update_authorised
  on public.fuel_saved_groups for update to authenticated
  using ((select private.fuel_can_manage_saved_group(id)))
  with check ((select private.fuel_can_manage_saved_group(id)));
create policy fuel_saved_groups_delete_authorised
  on public.fuel_saved_groups for delete to authenticated
  using ((select private.fuel_can_manage_saved_group(id)));

create policy fuel_saved_group_members_select_authorised
  on public.fuel_saved_group_members for select to authenticated
  using ((select private.fuel_can_access_saved_group_athlete(group_id, athlete_id, false)));
create policy fuel_saved_group_members_insert_authorised
  on public.fuel_saved_group_members for insert to authenticated
  with check (
    added_by = (select auth.uid())
    and (select private.fuel_can_access_saved_group_athlete(group_id, athlete_id, true))
  );
create policy fuel_saved_group_members_delete_authorised
  on public.fuel_saved_group_members for delete to authenticated
  using ((select private.fuel_can_access_saved_group_athlete(group_id, athlete_id, true)));

create policy fuel_training_sessions_select_authorised
  on public.fuel_training_sessions for select to authenticated
  using (
    (select private.fuel_has_team_access(team_id, 'viewer'))
    or (select private.fuel_is_training_session_athlete(id))
  );
create policy fuel_training_sessions_insert_contributor
  on public.fuel_training_sessions for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and (select private.fuel_has_team_access(team_id, 'contributor'))
    and (saved_group_id is null or (select private.fuel_can_manage_saved_group(saved_group_id)))
  );
create policy fuel_training_sessions_update_contributor
  on public.fuel_training_sessions for update to authenticated
  using ((select private.fuel_has_team_access(team_id, 'contributor')))
  with check (
    (select private.fuel_has_team_access(team_id, 'contributor'))
    and (saved_group_id is null or (select private.fuel_can_manage_saved_group(saved_group_id)))
  );
create policy fuel_training_sessions_delete_contributor
  on public.fuel_training_sessions for delete to authenticated
  using ((select private.fuel_has_team_access(team_id, 'contributor')));

create policy fuel_training_session_athletes_select_authorised
  on public.fuel_training_session_athletes for select to authenticated
  using (
    (
      athlete_id = (select auth.uid())
      and (select private.fuel_is_training_session_athlete(session_id))
    )
    or (select private.fuel_can_access_training_session_athlete(session_id, athlete_id, 'viewer'))
  );
create policy fuel_training_session_athletes_insert_contributor
  on public.fuel_training_session_athletes for insert to authenticated
  with check (
    assigned_by = (select auth.uid())
    and (select private.fuel_can_access_training_session_athlete(session_id, athlete_id, 'contributor'))
  );
create policy fuel_training_session_athletes_delete_authorised
  on public.fuel_training_session_athletes for delete to authenticated
  using (
    athlete_id = (select auth.uid())
    or (select private.fuel_can_access_training_session_athlete(session_id, athlete_id, 'contributor'))
  );

create view public.fuel_authorised_group_roster
with (security_invoker = true)
as
select
  saved_group.id as group_id,
  saved_group.scope,
  saved_group.organisation_id,
  saved_group.team_id,
  member.athlete_id,
  member.created_at as added_at
from public.fuel_saved_groups saved_group
join public.fuel_saved_group_members member
  on member.group_id = saved_group.id;

create view public.fuel_training_operational_context
with (security_invoker = true)
as
select
  training_session.id as session_id,
  training_session.organisation_id,
  training_session.team_id,
  training_session.saved_group_id,
  assignment.athlete_id,
  training_session.session_date,
  training_session.starts_at,
  training_session.ends_at,
  training_session.timezone_name,
  training_session.session_type,
  training_session.session_name,
  training_session.location,
  last_fuel.last_fuel_at,
  target.maximum_fuel_gap_minutes,
  gap.gap_minutes_at_start,
  case
    when target.maximum_fuel_gap_minutes is null then 'threshold_not_configured'
    when last_fuel.last_fuel_at is null then 'no_prior_fuel'
    when gap.gap_minutes_at_start >= target.maximum_fuel_gap_minutes then 'exceeded'
    when gap.gap_minutes_at_start >= target.maximum_fuel_gap_minutes - 30 then 'close'
    else 'within'
  end as gap_status,
  case
    when target.maximum_fuel_gap_minutes is null or gap.gap_minutes_at_start is null then null
    else target.maximum_fuel_gap_minutes - gap.gap_minutes_at_start
  end as minutes_until_threshold
from public.fuel_training_sessions training_session
join public.fuel_training_session_athletes assignment
  on assignment.session_id = training_session.id
left join public.fuel_targets target
  on target.user_id = assignment.athlete_id
left join lateral (
  select fuel_log.logged_at as last_fuel_at
  from public.fuel_logs fuel_log
  where fuel_log.user_id = assignment.athlete_id
    and fuel_log.type in ('fuel', 'fuel_hydration')
    and fuel_log.logged_at <= training_session.starts_at
  order by fuel_log.logged_at desc
  limit 1
) last_fuel on true
left join lateral (
  select case
    when last_fuel.last_fuel_at is null then null
    else floor(extract(epoch from (training_session.starts_at - last_fuel.last_fuel_at)) / 60)::integer
  end as gap_minutes_at_start
) gap on true;

revoke all on table public.fuel_authorised_group_roster from public, anon, authenticated;
revoke all on table public.fuel_training_operational_context from public, anon, authenticated;
grant select on table public.fuel_authorised_group_roster to authenticated;
grant select on table public.fuel_training_operational_context to authenticated;

create or replace function public.fuel_assign_training_session_group(
  p_session_id uuid,
  p_group_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  insert into public.fuel_training_session_athletes (session_id, athlete_id, assigned_by)
  select training_session.id, member.athlete_id, (select auth.uid())
  from public.fuel_training_sessions training_session
  join public.fuel_saved_groups saved_group
    on saved_group.id = p_group_id
   and saved_group.id = training_session.saved_group_id
   and saved_group.team_id = training_session.team_id
   and saved_group.organisation_id = training_session.organisation_id
  join public.fuel_saved_group_members member
    on member.group_id = saved_group.id
  where training_session.id = p_session_id
    and (select private.fuel_can_manage_saved_group(saved_group.id))
  on conflict (session_id, athlete_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.fuel_upcoming_training_sessions(
  p_from timestamptz default now(),
  p_to timestamptz default now() + interval '14 days',
  p_group_id uuid default null
)
returns table (
  session_id uuid,
  organisation_id uuid,
  team_id uuid,
  saved_group_id uuid,
  session_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone_name text,
  session_type text,
  session_name text,
  location text,
  source text,
  assigned_athlete_count bigint
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    training_session.id,
    training_session.organisation_id,
    training_session.team_id,
    training_session.saved_group_id,
    training_session.session_date,
    training_session.starts_at,
    training_session.ends_at,
    training_session.timezone_name,
    training_session.session_type,
    training_session.session_name,
    training_session.location,
    training_session.source,
    count(assignment.athlete_id) as assigned_athlete_count
  from public.fuel_training_sessions training_session
  left join public.fuel_training_session_athletes assignment
    on assignment.session_id = training_session.id
  where training_session.starts_at >= p_from
    and training_session.starts_at < p_to
    and (p_group_id is null or training_session.saved_group_id = p_group_id)
  group by training_session.id
  order by training_session.starts_at, training_session.id;
$$;

revoke all on function public.fuel_assign_training_session_group(uuid, uuid) from public, anon;
revoke all on function public.fuel_upcoming_training_sessions(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fuel_assign_training_session_group(uuid, uuid) to authenticated;
grant execute on function public.fuel_upcoming_training_sessions(timestamptz, timestamptz, uuid) to authenticated;

comment on table public.fuel_staff_notes is
  'Immutable shared staff context. Access requires active team staff membership, active team athlete membership, and an active direct coach-athlete share.';
comment on table public.fuel_saved_group_members is
  'Organisational metadata only. Rows never grant athlete-data access and become invisible when direct sharing is revoked.';
comment on table public.fuel_training_sessions is
  'Canonical Fuel Guard team training schedule. source_provider and external_session_id are the future adapter boundary; manual and CSV entry use Fuel Guard directly.';
comment on view public.fuel_training_operational_context is
  'RLS-aware schedule context derived from assigned sessions, athlete-configured fuel-gap thresholds, and the last authorised fuel log. It does not alter thresholds or prescribe nutrition.';
comment on function public.fuel_assign_training_session_group(uuid, uuid) is
  'Snapshots currently authorised saved-group members into explicit session assignments. Group membership itself grants no access.';
