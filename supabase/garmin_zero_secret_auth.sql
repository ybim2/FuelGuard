create extension if not exists pgcrypto;

create table if not exists public.garmin_auth_sessions (
  id uuid primary key default gen_random_uuid(),
  app_id text not null,
  state_hash text not null,
  authorization_code_hash text,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  approved_at timestamptz,
  exchanged_at timestamptz
);

alter table public.garmin_auth_sessions
  add column if not exists app_id text,
  add column if not exists state_hash text,
  add column if not exists authorization_code_hash text,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists status text default 'pending',
  add column if not exists created_at timestamptz default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists exchanged_at timestamptz;

alter table public.garmin_auth_sessions
  alter column app_id set not null,
  alter column state_hash set not null,
  alter column status set not null,
  alter column status set default 'pending',
  alter column created_at set not null,
  alter column created_at set default now(),
  alter column expires_at set not null;

alter table public.garmin_auth_sessions
  drop constraint if exists garmin_auth_sessions_app_id_check,
  add constraint garmin_auth_sessions_app_id_check
    check (app_id in ('quick_log', 'activity_logger'));

alter table public.garmin_auth_sessions
  drop constraint if exists garmin_auth_sessions_status_check,
  add constraint garmin_auth_sessions_status_check
    check (status in ('pending', 'approved', 'denied', 'exchanged', 'expired'));

create index if not exists garmin_auth_sessions_app_state_idx
  on public.garmin_auth_sessions (app_id, state_hash, created_at desc);

create index if not exists garmin_auth_sessions_status_expires_idx
  on public.garmin_auth_sessions (status, expires_at);

create unique index if not exists garmin_auth_sessions_code_hash_idx
  on public.garmin_auth_sessions (authorization_code_hash)
  where authorization_code_hash is not null;

create index if not exists garmin_auth_sessions_user_idx
  on public.garmin_auth_sessions (user_id, created_at desc)
  where user_id is not null;

create table if not exists public.garmin_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null,
  token_hash text not null,
  token_prefix text not null,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.garmin_device_tokens
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists app_id text,
  add column if not exists token_hash text,
  add column if not exists token_prefix text,
  add column if not exists label text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists last_used_at timestamptz,
  add column if not exists revoked_at timestamptz;

alter table public.garmin_device_tokens
  alter column user_id set not null,
  alter column app_id set not null,
  alter column token_hash set not null,
  alter column token_prefix set not null,
  alter column created_at set not null,
  alter column created_at set default now();

alter table public.garmin_device_tokens
  drop constraint if exists garmin_device_tokens_app_id_check,
  add constraint garmin_device_tokens_app_id_check
    check (app_id in ('quick_log', 'activity_logger'));

create unique index if not exists garmin_device_tokens_token_hash_idx
  on public.garmin_device_tokens (token_hash);

create index if not exists garmin_device_tokens_user_created_idx
  on public.garmin_device_tokens (user_id, created_at desc);

create index if not exists garmin_device_tokens_active_idx
  on public.garmin_device_tokens (token_hash, revoked_at)
  where revoked_at is null;

revoke all on table public.garmin_auth_sessions from anon, authenticated;
revoke all on table public.garmin_device_tokens from anon, authenticated;

alter table public.garmin_auth_sessions enable row level security;
alter table public.garmin_device_tokens enable row level security;

drop policy if exists "garmin_auth_sessions_no_direct_access" on public.garmin_auth_sessions;
create policy "garmin_auth_sessions_no_direct_access"
on public.garmin_auth_sessions
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "garmin_device_tokens_no_direct_access" on public.garmin_device_tokens;
create policy "garmin_device_tokens_no_direct_access"
on public.garmin_device_tokens
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

comment on table public.garmin_auth_sessions is 'Short-lived one-time Garmin pairing sessions. Accessed only by server routes with a Supabase backend key.';
comment on table public.garmin_device_tokens is 'Revocable Garmin device credentials. Stores only HMAC token hashes, never raw tokens.';
