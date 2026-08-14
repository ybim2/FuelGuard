-- Retire manual Work Mode without deleting historical sessions or log links.
-- New Work context is inferred dynamically from fuel_work_patterns.

revoke insert, update on table public.fuel_work_mode_sessions from authenticated;
drop policy if exists fuel_work_mode_sessions_insert_own on public.fuel_work_mode_sessions;
drop policy if exists fuel_work_mode_sessions_update_own on public.fuel_work_mode_sessions;

create or replace function private.fuel_reject_new_manual_work_context()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.work_mode_session_id is not null then
    raise exception 'Manual Work Mode is retired; Work context is inferred from the athlete schedule.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.work_mode_session_id is distinct from new.work_mode_session_id then
    raise exception 'Historical Work relationships are immutable; Work context is inferred from the athlete schedule.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.fuel_reject_new_manual_work_context() from public, anon, authenticated;

create trigger fuel_logs_reject_new_manual_work_context
  before insert or update of work_mode_session_id on public.fuel_logs
  for each row execute function private.fuel_reject_new_manual_work_context();
