-- Cover new foreign-key columns used by joins and cascading cleanup.

create index if not exists fuel_points_ledger_event_type_idx
  on public.fuel_points_ledger (event_type);

create index if not exists fuel_user_role_memberships_granted_by_idx
  on public.fuel_user_role_memberships (granted_by)
  where granted_by is not null;
