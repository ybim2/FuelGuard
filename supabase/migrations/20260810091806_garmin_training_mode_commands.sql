-- Atomic, retry-safe Training Mode commands from an authenticated Garmin device.
-- The public function is callable only by service_role; the server endpoint
-- resolves the opaque device token to its owner before invoking it.

create table private.fuel_garmin_training_commands (
  id uuid primary key default gen_random_uuid(),
  device_token_id uuid not null references public.garmin_device_tokens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  external_action_id text not null,
  action text not null,
  session_id uuid,
  occurred_at timestamptz not null,
  result text not null,
  created_at timestamptz not null default now(),
  constraint fuel_garmin_training_commands_identity_unique
    unique (device_token_id, external_action_id),
  constraint fuel_garmin_training_commands_action_check
    check (action in ('start', 'end')),
  constraint fuel_garmin_training_commands_external_id_check
    check (char_length(trim(external_action_id)) between 1 and 160),
  constraint fuel_garmin_training_commands_result_check
    check (result in ('started', 'already_active', 'ended', 'no_active')),
  constraint fuel_garmin_training_commands_session_fk
    foreign key (session_id, user_id)
    references public.fuel_training_mode_sessions(id, user_id)
    on delete restrict
);

create index fuel_garmin_training_commands_user_created_idx
  on private.fuel_garmin_training_commands (user_id, created_at desc);

alter table private.fuel_garmin_training_commands enable row level security;
revoke all on table private.fuel_garmin_training_commands from public, anon, authenticated;

create or replace function public.fuel_garmin_training_command(
  p_device_token_id uuid,
  p_user_id uuid,
  p_action text,
  p_external_action_id text,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text := lower(trim(coalesce(p_action, '')));
  v_external_action_id text := trim(coalesce(p_external_action_id, ''));
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
  v_existing private.fuel_garmin_training_commands%rowtype;
  v_session public.fuel_training_mode_sessions%rowtype;
  v_fuel public.fuel_training_mode_presets%rowtype;
  v_hydration public.fuel_training_mode_presets%rowtype;
  v_result text;
begin
  if p_device_token_id is null or p_user_id is null then
    raise exception 'Garmin device and athlete identity are required.' using errcode = '22023';
  end if;
  if v_action not in ('start', 'end') then
    raise exception 'Garmin Training Mode action must be start or end.' using errcode = '22023';
  end if;
  if char_length(v_external_action_id) not between 1 and 160 then
    raise exception 'Garmin Training Mode action identity is invalid.' using errcode = '22023';
  end if;
  if v_occurred_at < now() - interval '30 days' or v_occurred_at > now() + interval '5 minutes' then
    raise exception 'Garmin Training Mode action timestamp is outside the accepted retry window.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1
    from public.garmin_device_tokens token
    where token.id = p_device_token_id
      and token.user_id = p_user_id
      and token.revoked_at is null
  ) then
    raise exception 'Garmin device is not authorised for this athlete.' using errcode = '42501';
  end if;

  select command.*
  into v_existing
  from private.fuel_garmin_training_commands command
  where command.device_token_id = p_device_token_id
    and command.external_action_id = v_external_action_id;

  if found then
    return jsonb_build_object(
      'result', v_existing.result,
      'duplicate', true,
      'active', v_existing.result in ('started', 'already_active'),
      'session_id', v_existing.session_id,
      'occurred_at', v_existing.occurred_at
    );
  end if;

  if v_action = 'start' then
    select session.*
    into v_session
    from public.fuel_training_mode_sessions session
    where session.user_id = p_user_id
      and session.status = 'active'
    order by session.started_at desc
    limit 1
    for update;

    if found then
      v_result := 'already_active';
    else
      select preset.*
      into v_fuel
      from public.fuel_training_mode_presets preset
      where preset.user_id = p_user_id
        and preset.event_type = 'fuel'
        and preset.is_default
      order by preset.updated_at desc
      limit 1;

      if not found then
        insert into public.fuel_training_mode_presets (
          user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg,
          intended_interval_minutes, is_default
        ) values (
          p_user_id, 'fuel', 'Fuel', 30, 0, 0, 0, 30, true
        ) returning * into v_fuel;
      end if;

      select preset.*
      into v_hydration
      from public.fuel_training_mode_presets preset
      where preset.user_id = p_user_id
        and preset.event_type = 'hydration'
        and preset.is_default
      order by preset.updated_at desc
      limit 1;

      if not found then
        insert into public.fuel_training_mode_presets (
          user_id, event_type, name, carbs_g, fluid_ml, sodium_mg, caffeine_mg,
          intended_interval_minutes, is_default
        ) values (
          p_user_id, 'hydration', 'Hydrate', 0, 200, 250, 0, 20, true
        ) returning * into v_hydration;
      end if;

      insert into public.fuel_training_mode_sessions (
        user_id, title, session_type, status, started_at, ended_at,
        fuel_preset_id, hydration_preset_id,
        fuel_carbs_g, fuel_fluid_ml, fuel_sodium_mg, fuel_caffeine_mg,
        hydration_carbs_g, hydration_fluid_ml, hydration_sodium_mg, hydration_caffeine_mg,
        fuel_interval_minutes, hydration_interval_minutes, plan_source,
        plan_carbs_g_per_hour, plan_fluid_ml_per_hour,
        plan_sodium_mg_per_hour, plan_caffeine_mg_per_hour
      ) values (
        p_user_id, 'Garmin training', 'training', 'active', v_occurred_at, null,
        v_fuel.id, v_hydration.id,
        v_fuel.carbs_g, v_fuel.fluid_ml, v_fuel.sodium_mg, 0,
        v_hydration.carbs_g, v_hydration.fluid_ml, v_hydration.sodium_mg,
        case when v_hydration.caffeine_mg > 0 then v_hydration.caffeine_mg else v_fuel.caffeine_mg end,
        v_fuel.intended_interval_minutes, v_hydration.intended_interval_minutes, 'derived',
        round((v_fuel.carbs_g * 60.0 / v_fuel.intended_interval_minutes)
          + (v_hydration.carbs_g * 60.0 / v_hydration.intended_interval_minutes)),
        round((v_fuel.fluid_ml * 60.0 / v_fuel.intended_interval_minutes)
          + (v_hydration.fluid_ml * 60.0 / v_hydration.intended_interval_minutes)),
        round((v_fuel.sodium_mg * 60.0 / v_fuel.intended_interval_minutes)
          + (v_hydration.sodium_mg * 60.0 / v_hydration.intended_interval_minutes)),
        round((case when v_hydration.caffeine_mg > 0 then v_hydration.caffeine_mg else v_fuel.caffeine_mg end)
          * 60.0 / v_hydration.intended_interval_minutes)
      ) returning * into v_session;
      v_result := 'started';
    end if;
  else
    select session.*
    into v_session
    from public.fuel_training_mode_sessions session
    where session.user_id = p_user_id
      and session.status = 'active'
    order by session.started_at desc
    limit 1
    for update;

    if found then
      update public.fuel_training_mode_sessions
      set status = 'completed',
          ended_at = greatest(v_occurred_at, started_at),
          updated_at = now()
      where id = v_session.id
        and user_id = p_user_id
        and status = 'active'
      returning * into v_session;
      v_result := 'ended';
    else
      v_session := null;
      v_result := 'no_active';
    end if;
  end if;

  insert into private.fuel_garmin_training_commands (
    device_token_id, user_id, external_action_id, action,
    session_id, occurred_at, result
  ) values (
    p_device_token_id, p_user_id, v_external_action_id, v_action,
    v_session.id, v_occurred_at, v_result
  );

  return jsonb_build_object(
    'result', v_result,
    'duplicate', false,
    'active', v_result in ('started', 'already_active'),
    'session_id', v_session.id,
    'started_at', v_session.started_at,
    'ended_at', v_session.ended_at
  );
end;
$$;

revoke all on function public.fuel_garmin_training_command(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.fuel_garmin_training_command(uuid, uuid, text, text, timestamptz)
  to service_role;

comment on table private.fuel_garmin_training_commands is
  'Private idempotency and audit ledger for authenticated Garmin Training Mode start/end commands.';
comment on function public.fuel_garmin_training_command(uuid, uuid, text, text, timestamptz) is
  'Service-only atomic Garmin Training Mode mutation. Revalidates device ownership, serialises per athlete and deduplicates retry identities.';
