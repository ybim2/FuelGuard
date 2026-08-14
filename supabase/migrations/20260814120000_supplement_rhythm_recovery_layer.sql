-- Fuel Guard Athlete Supplement Rhythm and the optional post-training Recovery
-- Focus layer. These records are private to the authenticated athlete and are
-- deliberately separate from fuel_logs, Coach sharing, milestones and points.

alter table public.fuel_logs
  add constraint fuel_logs_user_identity_unique unique (id, user_id);

create table public.fuel_supplement_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplement_type text not null,
  custom_name text,
  label text not null,
  routine_source text,
  notes text,
  active boolean not null default true,
  track_caffeine_separation boolean not null default false,
  caffeine_separation_before_minutes integer,
  caffeine_separation_after_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_supplement_plans_user_identity_unique unique (id, user_id),
  constraint fuel_supplement_plans_type_check check (supplement_type in ('iron', 'creatine', 'vitamin_c', 'custom')),
  constraint fuel_supplement_plans_label_check check (char_length(trim(label)) between 1 and 80),
  constraint fuel_supplement_plans_custom_check check (
    (supplement_type = 'custom' and custom_name is not null and char_length(trim(custom_name)) between 1 and 80)
    or (supplement_type <> 'custom' and custom_name is null)
  ),
  constraint fuel_supplement_plans_routine_source_check check (routine_source is null or routine_source in ('self_selected','clinician','dietitian','coach','other','prefer_not_to_say')),
  constraint fuel_supplement_plans_notes_check check (notes is null or char_length(notes) <= 500),
  constraint fuel_supplement_plans_iron_window_check check (
    (supplement_type = 'iron' and (
      (not track_caffeine_separation and caffeine_separation_before_minutes is null and caffeine_separation_after_minutes is null)
      or (track_caffeine_separation and caffeine_separation_before_minutes is not null and caffeine_separation_after_minutes is not null
        and caffeine_separation_before_minutes between 0 and 360 and caffeine_separation_after_minutes between 0 and 360
        and caffeine_separation_before_minutes + caffeine_separation_after_minutes > 0)
    ))
    or (supplement_type <> 'iron' and not track_caffeine_separation and caffeine_separation_before_minutes is null and caffeine_separation_after_minutes is null)
  )
);

create index fuel_supplement_plans_user_active_idx
  on public.fuel_supplement_plans (user_id, active, updated_at desc);

create table public.fuel_supplement_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplement_plan_id uuid not null,
  local_time time,
  days_of_week smallint[] not null default array[0,1,2,3,4,5,6]::smallint[],
  label text,
  active boolean not null default true,
  reminder_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_supplement_schedule_slots_user_identity_unique unique (id, user_id),
  constraint fuel_supplement_schedule_slots_plan_identity_unique unique (id, supplement_plan_id, user_id),
  constraint fuel_supplement_schedule_slots_plan_fk foreign key (supplement_plan_id, user_id)
    references public.fuel_supplement_plans(id, user_id) on delete cascade,
  constraint fuel_supplement_schedule_slots_days_check check (
    cardinality(days_of_week) between 1 and 7
    and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint fuel_supplement_schedule_slots_label_check check (label is null or char_length(trim(label)) between 1 and 80),
  constraint fuel_supplement_schedule_slots_unique unique (supplement_plan_id, local_time, days_of_week)
);

create index fuel_supplement_schedule_slots_user_time_idx
  on public.fuel_supplement_schedule_slots (user_id, local_time);
create index fuel_supplement_schedule_slots_plan_user_fk_idx
  on public.fuel_supplement_schedule_slots (supplement_plan_id, user_id);

create table public.fuel_supplement_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  supplement_plan_id uuid not null,
  schedule_slot_id uuid,
  event_status text not null default 'taken',
  taken_at timestamptz not null,
  planned_for timestamptz,
  source text not null default 'manual',
  idempotency_key text,
  with_food boolean,
  linked_fuel_event_id uuid,
  context_mode text not null default 'everyday',
  recovery_focus_id uuid,
  context_snapshot jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_supplement_events_user_identity_unique unique (id, user_id),
  constraint fuel_supplement_events_plan_fk foreign key (supplement_plan_id, user_id)
    references public.fuel_supplement_plans(id, user_id) on delete restrict,
  constraint fuel_supplement_events_slot_fk foreign key (schedule_slot_id, supplement_plan_id, user_id)
    references public.fuel_supplement_schedule_slots(id, supplement_plan_id, user_id) on delete restrict,
  constraint fuel_supplement_events_fuel_log_fk foreign key (linked_fuel_event_id, user_id)
    references public.fuel_logs(id, user_id) on delete restrict,
  constraint fuel_supplement_events_status_check check (event_status in ('taken', 'skipped')),
  constraint fuel_supplement_events_source_check check (source in ('manual', 'reminder', 'watch', 'import')),
  constraint fuel_supplement_events_context_check check (context_mode in ('everyday', 'work', 'training')),
  constraint fuel_supplement_events_idempotency_check check (idempotency_key is null or char_length(idempotency_key) between 8 and 200),
  constraint fuel_supplement_events_notes_check check (notes is null or char_length(notes) <= 500)
);

create unique index fuel_supplement_events_idempotency_idx
  on public.fuel_supplement_events (user_id, idempotency_key)
  where idempotency_key is not null;
create index fuel_supplement_events_user_taken_idx
  on public.fuel_supplement_events (user_id, taken_at desc);
create index fuel_supplement_events_plan_user_fk_idx
  on public.fuel_supplement_events (supplement_plan_id, user_id);
create index fuel_supplement_events_slot_user_fk_idx
  on public.fuel_supplement_events (schedule_slot_id, supplement_plan_id, user_id)
  where schedule_slot_id is not null;
create index fuel_supplement_events_fuel_log_user_fk_idx
  on public.fuel_supplement_events (linked_fuel_event_id, user_id)
  where linked_fuel_event_id is not null;

create table public.fuel_recovery_focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_training_session_id uuid not null,
  status text not null default 'active',
  started_at timestamptz not null,
  ended_at timestamptz,
  expires_at timestamptz not null,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_recovery_focus_sessions_user_identity_unique unique (id, user_id),
  constraint fuel_recovery_focus_sessions_training_fk foreign key (source_training_session_id, user_id)
    references public.fuel_training_mode_sessions(id, user_id) on delete restrict,
  constraint fuel_recovery_focus_sessions_status_check check (status in ('active', 'completed', 'expired')),
  constraint fuel_recovery_focus_sessions_time_check check (
    expires_at > started_at
    and expires_at <= started_at + interval '24 hours'
    and ((status = 'active' and ended_at is null and end_reason is null)
      or (status <> 'active' and ended_at is not null and ended_at >= started_at and end_reason in ('manual', 'new_training', 'expired')))
  )
);

create unique index fuel_recovery_focus_sessions_one_active_idx
  on public.fuel_recovery_focus_sessions (user_id)
  where status = 'active';
create index fuel_recovery_focus_sessions_user_started_idx
  on public.fuel_recovery_focus_sessions (user_id, started_at desc);
create index fuel_recovery_focus_sessions_training_user_fk_idx
  on public.fuel_recovery_focus_sessions (source_training_session_id, user_id);

alter table public.fuel_supplement_events
  add constraint fuel_supplement_events_recovery_focus_fk
  foreign key (recovery_focus_id, user_id)
  references public.fuel_recovery_focus_sessions(id, user_id)
  on delete restrict;
create index fuel_supplement_events_recovery_user_fk_idx
  on public.fuel_supplement_events (recovery_focus_id, user_id)
  where recovery_focus_id is not null;

create or replace function private.fuel_supplement_recovery_update_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.id is distinct from new.id or old.user_id is distinct from new.user_id then
    raise exception 'Athlete-owned record identity is immutable.' using errcode = '23514';
  end if;
  if tg_table_name = 'fuel_supplement_events' then
    if old.supplement_plan_id is distinct from new.supplement_plan_id
       or old.schedule_slot_id is distinct from new.schedule_slot_id then
      raise exception 'Supplement event relationship identity is immutable.' using errcode = '23514';
    end if;
  end if;
  if tg_table_name = 'fuel_recovery_focus_sessions' then
    if old.source_training_session_id is distinct from new.source_training_session_id
       or old.started_at is distinct from new.started_at
       or old.expires_at is distinct from new.expires_at then
      raise exception 'Recovery Focus training relationship is immutable.' using errcode = '23514';
    end if;
    if old.status <> 'active' and new is distinct from old then
      raise exception 'Completed Recovery Focus sessions are immutable.' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_supplement_recovery_update_guard() from public, anon, authenticated;

create trigger fuel_supplement_plans_update_guard
  before update on public.fuel_supplement_plans
  for each row execute function private.fuel_supplement_recovery_update_guard();
create trigger fuel_supplement_schedule_slots_update_guard
  before update on public.fuel_supplement_schedule_slots
  for each row execute function private.fuel_supplement_recovery_update_guard();
create trigger fuel_supplement_events_update_guard
  before update on public.fuel_supplement_events
  for each row execute function private.fuel_supplement_recovery_update_guard();
create trigger fuel_recovery_focus_sessions_update_guard
  before update on public.fuel_recovery_focus_sessions
  for each row execute function private.fuel_supplement_recovery_update_guard();

alter table public.fuel_supplement_plans enable row level security;
alter table public.fuel_supplement_schedule_slots enable row level security;
alter table public.fuel_supplement_events enable row level security;
alter table public.fuel_recovery_focus_sessions enable row level security;

revoke all on table public.fuel_supplement_plans from public, anon, authenticated;
revoke all on table public.fuel_supplement_schedule_slots from public, anon, authenticated;
revoke all on table public.fuel_supplement_events from public, anon, authenticated;
revoke all on table public.fuel_recovery_focus_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.fuel_supplement_plans to authenticated;
grant select, insert, update, delete on table public.fuel_supplement_schedule_slots to authenticated;
grant select, insert, update, delete on table public.fuel_supplement_events to authenticated;
grant select, insert, update, delete on table public.fuel_recovery_focus_sessions to authenticated;

create policy fuel_supplement_plans_own on public.fuel_supplement_plans
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy fuel_supplement_schedule_slots_own on public.fuel_supplement_schedule_slots
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy fuel_supplement_events_own on public.fuel_supplement_events
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy fuel_recovery_focus_sessions_own on public.fuel_recovery_focus_sessions
  for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

comment on table public.fuel_supplement_plans is 'Private Athlete Supplement Rhythm plans. No Coach or organisation policy grants access.';
comment on table public.fuel_supplement_events is 'Private supplement completion history with an immutable point-in-time Fuel Guard context snapshot.';
comment on table public.fuel_recovery_focus_sessions is 'Optional Athlete post-training Recovery Focus. This is a secondary display layer, not a primary mode or recovery score.';
