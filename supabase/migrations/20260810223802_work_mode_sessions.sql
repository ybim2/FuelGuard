-- Athlete-owned Work Mode periods. Fuel, Hydration and Sleepy events remain
-- canonical fuel_logs rows and gain only an optional Work Mode context link.

create table public.fuel_work_mode_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Work period',
  status text not null default 'active',
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_work_mode_sessions_user_identity_unique unique (id, user_id),
  constraint fuel_work_mode_sessions_title_check check (char_length(trim(title)) between 1 and 120),
  constraint fuel_work_mode_sessions_status_check check (status in ('active', 'completed')),
  constraint fuel_work_mode_sessions_time_check check (
    (status = 'active' and ended_at is null)
    or (status = 'completed' and ended_at is not null and ended_at >= started_at)
  )
);

create unique index fuel_work_mode_sessions_one_active_idx
  on public.fuel_work_mode_sessions (user_id)
  where status = 'active';
create index fuel_work_mode_sessions_user_started_idx
  on public.fuel_work_mode_sessions (user_id, started_at desc);

alter table public.fuel_logs
  add column work_mode_session_id uuid;

alter table public.fuel_logs
  add constraint fuel_logs_work_mode_session_fk
    foreign key (work_mode_session_id, user_id)
    references public.fuel_work_mode_sessions(id, user_id)
    on delete restrict;

create index fuel_logs_work_mode_session_logged_idx
  on public.fuel_logs (work_mode_session_id, logged_at)
  where work_mode_session_id is not null;
create index fuel_logs_work_mode_session_user_fk_idx
  on public.fuel_logs (work_mode_session_id, user_id)
  where work_mode_session_id is not null;

create or replace function private.fuel_work_mode_session_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.id, new.user_id, new.started_at) is distinct from (old.id, old.user_id, old.started_at) then
    raise exception 'Work Mode session identity is immutable.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status = 'completed' and new.status <> old.status then
    raise exception 'A completed Work Mode session cannot be reopened.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_work_mode_session_guard() from public, anon, authenticated, service_role;

create trigger fuel_work_mode_sessions_guard_trigger
  before update on public.fuel_work_mode_sessions
  for each row execute function private.fuel_work_mode_session_guard();

alter table public.fuel_work_mode_sessions enable row level security;

revoke all on table public.fuel_work_mode_sessions from public, anon, authenticated;
grant select, insert, update on table public.fuel_work_mode_sessions to authenticated;

create policy fuel_work_mode_sessions_select_own
  on public.fuel_work_mode_sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy fuel_work_mode_sessions_insert_own
  on public.fuel_work_mode_sessions
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy fuel_work_mode_sessions_update_own
  on public.fuel_work_mode_sessions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.fuel_work_mode_sessions is
  'Athlete-owned work-period context for existing Fuel Guard logs. This is not productivity or employee monitoring data.';
comment on column public.fuel_logs.work_mode_session_id is
  'Optional owner-matched Work Mode period. The log remains part of the ordinary Daily timeline and may also retain Training Mode context.';
