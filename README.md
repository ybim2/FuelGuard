# Fuel Guard

The canonical frontend is the mobile-first Fuel Guard PWA with the three main tabs: Log, Trends, and Settings.

Read `AGENTS.md` and `FRONTEND_SOURCE_OF_TRUTH.md` before making frontend changes.

The app is a static PWA served from the repository root. There is no package install or build step.

## Removed legacy areas

The current app no longer ships the old parked sections. Historical MVP notes live in git history.

## Supabase setup

Run `supabase/fuel_logs.sql` and `supabase/fuel_targets.sql` in the Supabase project to create the cloud log and target tables, grants, RLS, and owner-only policies.

For Vercel, set only public client values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The runtime config endpoint also accepts the older `FUEL_GUARD_SUPABASE_*`, `SUPABASE_*`, and `NEXT_PUBLIC_SUPABASE_*` names for deployment compatibility.

Do not set or expose a service role key in the PWA.

Supabase's built-in email sender has very low testing limits and is not intended for beta or production auth email volume. Before wider testing, configure a custom SMTP provider in Supabase Auth settings so sign-up confirmation and password reset emails are not constrained by the default sender's tight limits.
