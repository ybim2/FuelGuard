create extension if not exists pgcrypto;

create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logged_at timestamptz not null,
  type text not null,
  source text not null default 'manual',
  day_type text,
  training_session text,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.fuel_logs
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists logged_at timestamptz,
  add column if not exists type text,
  add column if not exists source text default 'manual',
  add column if not exists day_type text,
  add column if not exists training_session text,
  add column if not exists notes text,
  add column if not exists created_at timestamptz default now();

alter table public.fuel_logs
  alter column user_id set not null,
  alter column logged_at set not null,
  alter column type set not null,
  alter column source set not null,
  alter column source set default 'manual',
  alter column created_at set not null,
  alter column created_at set default now();

alter table public.fuel_logs
  drop constraint if exists fuel_logs_type_check,
  add constraint fuel_logs_type_check
    check (type in ('fuel', 'hydration', 'fuel_hydration'));

alter table public.fuel_logs
  drop constraint if exists fuel_logs_source_check,
  add constraint fuel_logs_source_check
    check (source in ('manual', 'csv_import', 'hardware', 'bluetooth'));

create index if not exists fuel_logs_user_logged_at_idx
  on public.fuel_logs (user_id, logged_at desc);

create index if not exists fuel_logs_user_type_logged_at_idx
  on public.fuel_logs (user_id, type, logged_at desc);

revoke all on table public.fuel_logs from anon, authenticated;
grant select, insert, update, delete on table public.fuel_logs to authenticated;

alter table public.fuel_logs enable row level security;

drop policy if exists "fuel_logs_select_own" on public.fuel_logs;
create policy "fuel_logs_select_own"
on public.fuel_logs
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "fuel_logs_insert_own" on public.fuel_logs;
create policy "fuel_logs_insert_own"
on public.fuel_logs
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "fuel_logs_update_own" on public.fuel_logs;
create policy "fuel_logs_update_own"
on public.fuel_logs
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "fuel_logs_delete_own" on public.fuel_logs;
create policy "fuel_logs_delete_own"
on public.fuel_logs
for delete
to authenticated
using ((select auth.uid()) = user_id);
