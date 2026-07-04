# Fuel Guard

The canonical frontend is the mobile-first Fuel Guard PWA with the three main tabs: Rhythm, History, and Settings.

Read `AGENTS.md` and `FRONTEND_SOURCE_OF_TRUTH.md` before making frontend changes.

The app is a static PWA served from the repository root. There is no package install or build step.

## Removed legacy areas

The current app no longer ships the old parked sections. Historical MVP notes live in git history.

## Supabase setup

Run `supabase/fuel_logs.sql` in the Supabase project to create the cloud log table, grants, RLS, and owner-only policies.

For Vercel, set only public client values:

- `FUEL_GUARD_SUPABASE_URL`
- `FUEL_GUARD_SUPABASE_ANON_KEY` or `FUEL_GUARD_SUPABASE_PUBLISHABLE_KEY`

Do not set or expose a service role key in the PWA.
