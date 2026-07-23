-- Fuel Guard demand-aware planning tables.
-- Run this in the same Supabase project as supabase/fuel_logs.sql.

create extension if not exists pgcrypto;

create table if not exists public.fuel_demand_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  type text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  title text,
  session_type text,
  intensity text,
  is_key_session boolean not null default false,
  shift_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_demand_blocks
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists date date,
  add column if not exists type text,
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists title text,
  add column if not exists session_type text,
  add column if not exists intensity text,
  add column if not exists is_key_session boolean not null default false,
  add column if not exists shift_name text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.fuel_demand_blocks
  alter column user_id set not null,
  alter column date set not null,
  alter column type set not null,
  alter column start_time set not null,
  alter column end_time set not null,
  alter column is_key_session set not null,
  alter column is_key_session set default false,
  alter column created_at set not null,
  alter column created_at set default now(),
  alter column updated_at set not null,
  alter column updated_at set default now();

alter table public.fuel_demand_blocks
  drop constraint if exists fuel_demand_blocks_type_check,
  add constraint fuel_demand_blocks_type_check
    check (type in ('training', 'work'));

alter table public.fuel_demand_blocks
  drop constraint if exists fuel_demand_blocks_session_type_check,
  add constraint fuel_demand_blocks_session_type_check
    check (session_type is null or session_type in ('run', 'bike', 'swim', 'strength', 'triathlon', 'sport', 'other'));

alter table public.fuel_demand_blocks
  drop constraint if exists fuel_demand_blocks_intensity_check,
  add constraint fuel_demand_blocks_intensity_check
    check (intensity is null or intensity in ('easy', 'moderate', 'hard', 'long'));

create index if not exists fuel_demand_blocks_user_start_idx
  on public.fuel_demand_blocks (user_id, start_time desc);

create index if not exists fuel_demand_blocks_user_date_idx
  on public.fuel_demand_blocks (user_id, date desc);

create table if not exists public.fuel_work_breaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  demand_block_id uuid not null references public.fuel_demand_blocks(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fuel_work_breaks
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists demand_block_id uuid references public.fuel_demand_blocks(id) on delete cascade,
  add column if not exists start_time timestamptz,
  add column if not exists end_time timestamptz,
  add column if not exists label text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.fuel_work_breaks
  alter column user_id set not null,
  alter column demand_block_id set not null,
  alter column start_time set not null,
  alter column end_time set not null,
  alter column created_at set not null,
  alter column created_at set default now(),
  alter column updated_at set not null,
  alter column updated_at set default now();

create index if not exists fuel_work_breaks_user_start_idx
  on public.fuel_work_breaks (user_id, start_time desc);

create index if not exists fuel_work_breaks_demand_block_idx
  on public.fuel_work_breaks (demand_block_id, start_time asc);

revoke all on table public.fuel_demand_blocks from anon, authenticated;
revoke all on table public.fuel_work_breaks from anon, authenticated;

grant select, insert, update, delete on table public.fuel_demand_blocks to authenticated;
grant select, insert, update, delete on table public.fuel_work_breaks to authenticated;

alter table public.fuel_demand_blocks enable row level security;
alter table public.fuel_work_breaks enable row level security;

drop policy if exists fuel_demand_blocks_select_own on public.fuel_demand_blocks;
create policy fuel_demand_blocks_select_own
  on public.fuel_demand_blocks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists fuel_demand_blocks_insert_own on public.fuel_demand_blocks;
create policy fuel_demand_blocks_insert_own
  on public.fuel_demand_blocks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_demand_blocks_update_own on public.fuel_demand_blocks;
create policy fuel_demand_blocks_update_own
  on public.fuel_demand_blocks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_demand_blocks_delete_own on public.fuel_demand_blocks;
create policy fuel_demand_blocks_delete_own
  on public.fuel_demand_blocks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists fuel_work_breaks_select_own on public.fuel_work_breaks;
create policy fuel_work_breaks_select_own
  on public.fuel_work_breaks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists fuel_work_breaks_insert_own on public.fuel_work_breaks;
create policy fuel_work_breaks_insert_own
  on public.fuel_work_breaks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_work_breaks_update_own on public.fuel_work_breaks;
create policy fuel_work_breaks_update_own
  on public.fuel_work_breaks
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists fuel_work_breaks_delete_own on public.fuel_work_breaks;
create policy fuel_work_breaks_delete_own
  on public.fuel_work_breaks
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
