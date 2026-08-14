-- Fuel Guard Athlete automatic Work context and the expanded private
-- Supplementation catalogue. Work is inferred from timestamps; these tables do
-- not create sessions or attach a Work relationship to fuel_logs.

create table public.fuel_work_patterns (
  user_id uuid primary key references auth.users(id) on delete cascade,
  timezone_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_work_patterns_timezone_check check (char_length(trim(timezone_name)) between 1 and 100)
);

create table public.fuel_work_pattern_days (
  user_id uuid not null,
  day_of_week smallint not null,
  is_work_day boolean not null default false,
  start_time time,
  end_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day_of_week),
  constraint fuel_work_pattern_days_pattern_fk foreign key (user_id)
    references public.fuel_work_patterns(user_id) on delete cascade,
  constraint fuel_work_pattern_days_day_check check (day_of_week between 0 and 6),
  constraint fuel_work_pattern_days_times_check check (
    (not is_work_day and start_time is null and end_time is null)
    or (is_work_day and start_time is not null and end_time is not null and start_time <> end_time)
  )
);

create or replace function private.fuel_work_pattern_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.user_id is distinct from new.user_id then
    raise exception 'Work pattern owner identity is immutable.' using errcode = '23514';
  end if;
  if tg_table_name = 'fuel_work_pattern_days'
     and old.day_of_week is distinct from new.day_of_week then
    raise exception 'Work pattern day identity is immutable.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_work_pattern_update_guard() from public, anon, authenticated;

create trigger fuel_work_patterns_update_guard
  before update on public.fuel_work_patterns
  for each row execute function private.fuel_work_pattern_update_guard();
create trigger fuel_work_pattern_days_update_guard
  before update on public.fuel_work_pattern_days
  for each row execute function private.fuel_work_pattern_update_guard();

alter table public.fuel_work_patterns enable row level security;
alter table public.fuel_work_pattern_days enable row level security;

revoke all on table public.fuel_work_patterns from public, anon, authenticated;
revoke all on table public.fuel_work_pattern_days from public, anon, authenticated;
grant select, insert, update on table public.fuel_work_patterns to authenticated;
grant select, insert, update on table public.fuel_work_pattern_days to authenticated;

create policy fuel_work_patterns_select_own on public.fuel_work_patterns
  for select to authenticated using ((select auth.uid()) = user_id);
create policy fuel_work_patterns_insert_own on public.fuel_work_patterns
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy fuel_work_patterns_update_own on public.fuel_work_patterns
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_work_pattern_days_select_own on public.fuel_work_pattern_days
  for select to authenticated using ((select auth.uid()) = user_id);
create policy fuel_work_pattern_days_insert_own on public.fuel_work_pattern_days
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy fuel_work_pattern_days_update_own on public.fuel_work_pattern_days
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

alter table public.fuel_supplement_plans
  drop constraint fuel_supplement_plans_type_check,
  add constraint fuel_supplement_plans_type_check check (
    supplement_type in (
      'creatine',
      'iron',
      'vitamin_c',
      'vitamin_d',
      'vitamin_b12',
      'multivitamin',
      'magnesium',
      'calcium',
      'zinc',
      'electrolytes',
      'omega_3',
      'protein_supplement',
      'custom'
    )
  );

alter table public.fuel_supplement_events
  add column event_local_date date,
  add column timezone_name text;

update public.fuel_supplement_events
set event_local_date = (taken_at at time zone 'UTC')::date,
    timezone_name = 'UTC'
where event_local_date is null or timezone_name is null;

alter table public.fuel_supplement_events
  alter column event_local_date set not null,
  alter column event_local_date set default current_date,
  alter column timezone_name set not null,
  alter column timezone_name set default 'UTC',
  add constraint fuel_supplement_events_timezone_check
    check (char_length(trim(timezone_name)) between 1 and 100);

create index fuel_supplement_events_user_local_date_idx
  on public.fuel_supplement_events (user_id, event_local_date desc, taken_at desc);
