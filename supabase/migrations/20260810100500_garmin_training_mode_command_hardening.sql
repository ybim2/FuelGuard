-- Make the Garmin Training command ledger's direct-access denial explicit and
-- cover its composite session foreign key for efficient integrity checks.

create policy fuel_garmin_training_commands_no_direct_access
  on private.fuel_garmin_training_commands
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

create index fuel_garmin_training_commands_session_user_idx
  on private.fuel_garmin_training_commands (session_id, user_id)
  where session_id is not null;
