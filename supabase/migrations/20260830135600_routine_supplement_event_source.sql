-- Routine confirmations are explicit athlete confirmations, not assumed consumption.
-- Preserve their provenance so supplement events created from a confirmed routine
-- can be distinguished from ad-hoc manual, reminder, watch and import events.

alter table public.fuel_supplement_events
  drop constraint if exists fuel_supplement_events_source_check;

alter table public.fuel_supplement_events
  add constraint fuel_supplement_events_source_check
  check (source in ('manual', 'reminder', 'watch', 'import', 'routine'));
