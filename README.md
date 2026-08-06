# Fuel Guard

The canonical frontend is the mobile-first Fuel Guard PWA with the bottom tabs Plan, Log, History, and Trends. Settings opens from the sticky header icon.

Read `AGENTS.md` and `FRONTEND_SOURCE_OF_TRUTH.md` before making frontend changes.

The app is a static PWA served from the repository root. There is no package install or build step.

## Removed legacy areas

The current app no longer ships the old parked sections. Historical MVP notes live in git history.

## Supabase setup

Run `supabase/fuel_logs.sql`, `supabase/fuel_targets.sql`, and `supabase/fuel_demand_planning.sql` in the Supabase project to create the cloud log, target, and demand-planning tables, grants, RLS, and owner-only policies.

`supabase/fuel_logs.sql` also enables Garmin idempotency by adding `external_event_id`, allowing the `garmin` source, and adding a unique partial index for Garmin event IDs.

For Vercel, set only public client values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The runtime config endpoint also accepts the older `FUEL_GUARD_SUPABASE_*`, `SUPABASE_*`, and `NEXT_PUBLIC_SUPABASE_*` names for deployment compatibility.

Do not set or expose a service role key in the PWA.

For Garmin beta logging, set these Vercel server-side variables only:

- `GARMIN_BETA_TOKEN`
- `GARMIN_BETA_USER_ID`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Do not expose `SUPABASE_SECRET_KEY` or any service-role/secret key in Garmin source, frontend JavaScript, public config, HTML or service workers. See `garmin/README.md` for SDK setup, Forerunner 255 limitations and build instructions.

Supabase's built-in email sender has very low testing limits and is not intended for beta or production auth email volume. Before wider testing, configure a custom SMTP provider in Supabase Auth settings so sign-up confirmation and password reset emails are not constrained by the default sender's tight limits.
