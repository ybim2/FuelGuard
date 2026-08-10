-- Correct the Phase 1 Impact identity guard on databases where the preceding
-- migration was applied before table-specific NEW/OLD branching was added.

create or replace function private.fuel_performance_impact_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  session_row public.fuel_training_mode_sessions%rowtype;
begin
  if tg_table_name = 'fuel_performance_metrics' then
    if tg_op = 'UPDATE' and (new.id, new.user_id) is distinct from (old.id, old.user_id) then
      raise exception 'Performance metric identity is immutable.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'fuel_performance_results' then
    if tg_op = 'UPDATE' and (new.id, new.user_id, new.metric_id) is distinct from (old.id, old.user_id, old.metric_id) then
      raise exception 'Performance result identity is immutable.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'fuel_training_feedback' then
    if tg_op = 'UPDATE'
      and (new.id, new.user_id, new.training_mode_session_id, new.activity_source, new.activity_external_id)
        is distinct from (old.id, old.user_id, old.training_mode_session_id, old.activity_source, old.activity_external_id) then
      raise exception 'Training feedback identity is immutable.' using errcode = '42501';
    end if;

    if new.training_mode_session_id is not null then
      select * into session_row
      from public.fuel_training_mode_sessions session
      where session.id = new.training_mode_session_id
        and session.user_id = new.user_id;

      if not found or session_row.status <> 'completed' or session_row.ended_at is null then
        raise exception 'Feedback requires a completed Training Mode session.' using errcode = '23514';
      end if;

      new.activity_source := 'training_mode';
      new.activity_external_id := null;
      new.session_started_at := session_row.started_at;
      new.session_ended_at := session_row.ended_at;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.fuel_performance_impact_guard() from public, anon, authenticated, service_role;

comment on function private.fuel_performance_impact_guard() is
  'Protects Impact record identity with table-specific branching and copies authoritative timestamps from completed Training Mode sessions.';
