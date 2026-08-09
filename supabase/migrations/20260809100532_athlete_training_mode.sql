-- Fuel Guard Athlete Training Mode and restrained usage milestones.
-- Daily fuel_logs remain valid and quantity-free. Training context is nullable,
-- session-scoped, user-owned, and linked to the existing timing event.

create table public.fuel_training_mode_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  name text not null,
  carbs_g integer not null default 0,
  fluid_ml integer not null default 0,
  sodium_mg integer not null default 0,
  caffeine_mg integer not null default 0,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_training_mode_presets_user_identity_unique unique (id, user_id),
  constraint fuel_training_mode_presets_event_type_check check (event_type in ('fuel', 'hydration')),
  constraint fuel_training_mode_presets_name_check check (char_length(trim(name)) between 1 and 80),
  constraint fuel_training_mode_presets_carbs_check check (carbs_g between 0 and 500),
  constraint fuel_training_mode_presets_fluid_check check (fluid_ml between 0 and 5000),
  constraint fuel_training_mode_presets_sodium_check check (sodium_mg between 0 and 10000),
  constraint fuel_training_mode_presets_caffeine_check check (caffeine_mg between 0 and 1000),
  constraint fuel_training_mode_presets_nonempty_check check (carbs_g + fluid_ml + sodium_mg + caffeine_mg > 0)
);

create unique index fuel_training_mode_presets_default_idx
  on public.fuel_training_mode_presets (user_id, event_type)
  where is_default;

create index fuel_training_mode_presets_user_idx
  on public.fuel_training_mode_presets (user_id, event_type, updated_at desc);

create table public.fuel_training_mode_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Training session',
  session_type text not null default 'training',
  status text not null default 'active',
  started_at timestamptz not null,
  ended_at timestamptz,
  fuel_preset_id uuid not null,
  hydration_preset_id uuid not null,
  fuel_carbs_g integer not null,
  fuel_fluid_ml integer not null,
  fuel_sodium_mg integer not null,
  fuel_caffeine_mg integer not null,
  hydration_carbs_g integer not null,
  hydration_fluid_ml integer not null,
  hydration_sodium_mg integer not null,
  hydration_caffeine_mg integer not null,
  plan_carbs_g_per_hour integer not null default 0,
  plan_fluid_ml_per_hour integer not null default 0,
  plan_sodium_mg_per_hour integer not null default 0,
  plan_caffeine_mg_per_hour integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_training_mode_sessions_user_identity_unique unique (id, user_id),
  constraint fuel_training_mode_sessions_title_check check (char_length(trim(title)) between 1 and 120),
  constraint fuel_training_mode_sessions_type_check check (session_type in ('bike', 'run', 'swim', 'brick', 'triathlon', 'race', 'other', 'training')),
  constraint fuel_training_mode_sessions_status_check check (status in ('active', 'completed')),
  constraint fuel_training_mode_sessions_time_check check (
    (status = 'active' and ended_at is null)
    or (status = 'completed' and ended_at is not null and ended_at >= started_at)
  ),
  constraint fuel_training_mode_sessions_fuel_preset_fk
    foreign key (fuel_preset_id, user_id)
    references public.fuel_training_mode_presets(id, user_id)
    on delete restrict,
  constraint fuel_training_mode_sessions_hydration_preset_fk
    foreign key (hydration_preset_id, user_id)
    references public.fuel_training_mode_presets(id, user_id)
    on delete restrict,
  constraint fuel_training_mode_sessions_fuel_quantities_check check (
    fuel_carbs_g between 0 and 500
    and fuel_fluid_ml between 0 and 5000
    and fuel_sodium_mg between 0 and 10000
    and fuel_caffeine_mg between 0 and 1000
    and fuel_carbs_g + fuel_fluid_ml + fuel_sodium_mg + fuel_caffeine_mg > 0
  ),
  constraint fuel_training_mode_sessions_hydration_quantities_check check (
    hydration_carbs_g between 0 and 500
    and hydration_fluid_ml between 0 and 5000
    and hydration_sodium_mg between 0 and 10000
    and hydration_caffeine_mg between 0 and 1000
    and hydration_carbs_g + hydration_fluid_ml + hydration_sodium_mg + hydration_caffeine_mg > 0
  ),
  constraint fuel_training_mode_sessions_plan_check check (
    plan_carbs_g_per_hour between 0 and 500
    and plan_fluid_ml_per_hour between 0 and 5000
    and plan_sodium_mg_per_hour between 0 and 10000
    and plan_caffeine_mg_per_hour between 0 and 1000
  )
);

create unique index fuel_training_mode_sessions_one_active_idx
  on public.fuel_training_mode_sessions (user_id)
  where status = 'active';

create index fuel_training_mode_sessions_user_started_idx
  on public.fuel_training_mode_sessions (user_id, started_at desc);

alter table public.fuel_logs
  add column training_mode_session_id uuid,
  add column training_mode_preset_id uuid,
  add column carbs_g integer,
  add column fluid_ml integer,
  add column sodium_mg integer,
  add column caffeine_mg integer;

alter table public.fuel_logs
  add constraint fuel_logs_training_mode_session_fk
    foreign key (training_mode_session_id, user_id)
    references public.fuel_training_mode_sessions(id, user_id)
    on delete restrict,
  add constraint fuel_logs_training_mode_preset_fk
    foreign key (training_mode_preset_id, user_id)
    references public.fuel_training_mode_presets(id, user_id)
    on delete restrict,
  add constraint fuel_logs_training_mode_context_check check (
    (
      training_mode_session_id is null
      and training_mode_preset_id is null
      and carbs_g is null
      and fluid_ml is null
      and sodium_mg is null
      and caffeine_mg is null
    )
    or
    (
      training_mode_session_id is not null
      and training_mode_preset_id is not null
      and carbs_g between 0 and 500
      and fluid_ml between 0 and 5000
      and sodium_mg between 0 and 10000
      and caffeine_mg between 0 and 1000
      and carbs_g + fluid_ml + sodium_mg + caffeine_mg > 0
    )
  );

create index fuel_logs_training_mode_session_logged_idx
  on public.fuel_logs (training_mode_session_id, logged_at)
  where training_mode_session_id is not null;

create table public.fuel_milestone_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  threshold integer not null,
  achieved_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fuel_milestone_achievements_category_check check (category in ('streak', 'fuel', 'hydration')),
  constraint fuel_milestone_achievements_threshold_check check (threshold > 0),
  constraint fuel_milestone_achievements_user_threshold_unique unique (user_id, category, threshold)
);

create index fuel_milestone_achievements_user_idx
  on public.fuel_milestone_achievements (user_id, achieved_at desc);

alter table public.fuel_training_mode_presets enable row level security;
alter table public.fuel_training_mode_sessions enable row level security;
alter table public.fuel_milestone_achievements enable row level security;

revoke all on table public.fuel_training_mode_presets from public, anon, authenticated;
revoke all on table public.fuel_training_mode_sessions from public, anon, authenticated;
revoke all on table public.fuel_milestone_achievements from public, anon, authenticated;

grant select, insert, update on table public.fuel_training_mode_presets to authenticated;
grant select, insert, update on table public.fuel_training_mode_sessions to authenticated;
grant select, insert, update on table public.fuel_milestone_achievements to authenticated;

create policy fuel_training_mode_presets_select_own
  on public.fuel_training_mode_presets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_training_mode_presets_insert_own
  on public.fuel_training_mode_presets for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fuel_training_mode_presets_update_own
  on public.fuel_training_mode_presets for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_training_mode_sessions_select_own
  on public.fuel_training_mode_sessions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_training_mode_sessions_insert_own
  on public.fuel_training_mode_sessions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fuel_training_mode_sessions_update_own
  on public.fuel_training_mode_sessions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy fuel_milestone_achievements_select_own
  on public.fuel_milestone_achievements for select to authenticated
  using ((select auth.uid()) = user_id);
create policy fuel_milestone_achievements_insert_own
  on public.fuel_milestone_achievements for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy fuel_milestone_achievements_update_own
  on public.fuel_milestone_achievements for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.fuel_training_mode_presets is
  'User-owned Training Mode one-tap quantity presets. Only carbohydrate, fluid, sodium and caffeine are represented.';
comment on table public.fuel_training_mode_sessions is
  'Explicit endurance Training Mode sessions with immutable preset snapshots and optional user-selected planned rates.';
comment on column public.fuel_logs.training_mode_session_id is
  'Nullable link from the existing timing event to an explicit user-owned Training Mode session. Null means ordinary Daily Mode.';
comment on table public.fuel_milestone_achievements is
  'Derived usage milestones and one-time acknowledgement state. Event history remains the source of truth for counts.';
