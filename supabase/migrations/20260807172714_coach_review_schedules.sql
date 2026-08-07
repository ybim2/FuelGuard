-- Recurring and one-off Coach Beta review schedules.
-- Due state is calculated by the client from next_due_date in the coach's timezone.

create table public.fuel_coach_review_schedules (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  review_type text not null,
  report_period_type text not null default '12_weeks',
  report_period_start date,
  report_period_end date,
  cadence text not null default 'none',
  cadence_days integer,
  due_date date not null,
  next_due_date date,
  status text not null default 'active',
  coach_notes text,
  last_completed_at timestamptz,
  last_report_id uuid references public.fuel_coach_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fuel_coach_review_schedules_distinct_users_check
    check (coach_id <> athlete_id),
  constraint fuel_coach_review_schedules_review_type_check
    check (review_type in ('monthly', '8_week', 'contract', 'end_of_season', 'custom')),
  constraint fuel_coach_review_schedules_report_period_type_check
    check (report_period_type in ('4_weeks', '8_weeks', '12_weeks', 'season', 'custom')),
  constraint fuel_coach_review_schedules_cadence_check
    check (cadence in ('none', 'monthly', '8_weeks', 'custom_days')),
  constraint fuel_coach_review_schedules_status_check
    check (status in ('active', 'paused', 'completed')),
  constraint fuel_coach_review_schedules_custom_cadence_check
    check (
      (cadence = 'custom_days' and cadence_days between 1 and 3650)
      or (cadence <> 'custom_days' and cadence_days is null)
    ),
  constraint fuel_coach_review_schedules_custom_period_check
    check (
      (report_period_start is null and report_period_end is null)
      or (
        report_period_start is not null
        and report_period_end is not null
        and report_period_start <= report_period_end
      )
    ),
  constraint fuel_coach_review_schedules_active_due_check
    check (status <> 'active' or next_due_date is not null)
);

create index fuel_coach_review_schedules_coach_due_idx
  on public.fuel_coach_review_schedules (coach_id, status, next_due_date, athlete_id);

create index fuel_coach_review_schedules_athlete_idx
  on public.fuel_coach_review_schedules (coach_id, athlete_id, created_at desc);

alter table public.fuel_coach_review_schedules enable row level security;

revoke all on table public.fuel_coach_review_schedules from anon, authenticated;
grant select, insert, update, delete on table public.fuel_coach_review_schedules to authenticated;

create policy fuel_coach_review_schedules_select_assigned_coach
  on public.fuel_coach_review_schedules
  for select
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_review_schedules.coach_id
        and relationship.athlete_id = fuel_coach_review_schedules.athlete_id
        and relationship.status = 'active'
    )
  );

create policy fuel_coach_review_schedules_insert_assigned_coach
  on public.fuel_coach_review_schedules
  for insert
  to authenticated
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_review_schedules.coach_id
        and relationship.athlete_id = fuel_coach_review_schedules.athlete_id
        and relationship.status = 'active'
    )
  );

create policy fuel_coach_review_schedules_update_assigned_coach
  on public.fuel_coach_review_schedules
  for update
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_review_schedules.coach_id
        and relationship.athlete_id = fuel_coach_review_schedules.athlete_id
        and relationship.status = 'active'
    )
  )
  with check (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_review_schedules.coach_id
        and relationship.athlete_id = fuel_coach_review_schedules.athlete_id
        and relationship.status = 'active'
    )
  );

create policy fuel_coach_review_schedules_delete_assigned_coach
  on public.fuel_coach_review_schedules
  for delete
  to authenticated
  using (
    (select auth.uid()) = coach_id
    and exists (
      select 1
      from public.fuel_coach_athletes relationship
      where relationship.coach_id = fuel_coach_review_schedules.coach_id
        and relationship.athlete_id = fuel_coach_review_schedules.athlete_id
        and relationship.status = 'active'
    )
  );
