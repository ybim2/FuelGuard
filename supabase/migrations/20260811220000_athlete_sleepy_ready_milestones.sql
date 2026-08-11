-- Extend existing owner-only milestone acknowledgements for Athlete Sleepy
-- check-ins and canonical Ready for the Day checks. Counts remain derived from
-- the existing source records; this migration stores acknowledgement only.

alter table public.fuel_milestone_achievements
  drop constraint if exists fuel_milestone_achievements_category_check,
  add constraint fuel_milestone_achievements_category_check
    check (category in ('streak', 'fuel', 'hydration', 'sleepy', 'ready', 'training', 'work'));
