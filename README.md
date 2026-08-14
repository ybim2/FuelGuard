# Fuel Guard

The canonical frontend is the mobile-first Fuel Guard PWA with one primary bottom-navigation screen: Log. Settings opens from the sticky header icon.

The current core keeps today’s status, today-only fuelling-pattern chart and the expanded timeline with compact fuel/hydration/undo actions on Log. Settings stays focused on account sync, connected Garmin apps, CSV/data clearing, app update, version, and privacy.

Read `AGENTS.md` and `FRONTEND_SOURCE_OF_TRUTH.md` before making frontend changes.

The app is a static PWA served from the repository root. There is no package install or build step.

## Removed legacy areas

The current app no longer ships the old parked sections. Historical MVP notes live in git history.

## Supabase setup

Run `supabase/fuel_logs.sql`, `supabase/fuel_targets.sql`, `supabase/fuel_demand_planning.sql`, `supabase/garmin_zero_secret_auth.sql`, and `supabase/garmin_health_snapshots.sql` in the Supabase project to create the cloud log, target, demand-planning, Garmin pairing, and opt-in Garmin health-pattern tables, grants, RLS, and owner-only policies.

`supabase/fuel_logs.sql` also enables Garmin idempotency by adding `external_event_id`, allowing the `garmin` source, and adding a unique partial index for Garmin event IDs.

For Vercel, set only public client values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The runtime config endpoint also accepts the older `FUEL_GUARD_SUPABASE_*`, `SUPABASE_*`, and `NEXT_PUBLIC_SUPABASE_*` names for deployment compatibility.

Fuel Guard supports Google, Sign in with Apple and email/password through the same Supabase Auth account. Add `/auth/callback/` to the Supabase redirect allow list. Configure the Apple web Services ID, signing key and rotating client secret in Supabase—not in this repository or Vercel browser variables. Email confirmation and password recovery remain enabled; Fuel Guard does not expose email OTP or magic-code login. Manual `linkIdentity()` controls are available only when both the Supabase manual-linking setting and `FUEL_GUARD_MANUAL_IDENTITY_LINKING_ENABLED=true` are enabled. See `docs/runbooks/apple-auth-rotation.md`; the active Apple secret must be rotated before its six-month expiry.

Do not set or expose a service role key in the PWA.

For Garmin beta logging and account pairing, set these Vercel server-side variables only:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `GARMIN_TOKEN_PEPPER`

Generate `GARMIN_TOKEN_PEPPER` as a high-entropy server-only secret. It is used to HMAC-hash Garmin device tokens before storage. Do not expose `SUPABASE_SECRET_KEY`, `GARMIN_TOKEN_PEPPER`, or any service-role/secret key in Garmin source, frontend JavaScript, public config, HTML or service workers. See `garmin/README.md` for SDK setup, Forerunner 255 limitations and build instructions.

The opt-in Garmin health-pattern layer uses `/api/garmin/health` with the same paired device-token authentication as Garmin logging. It stores only Connect IQ-local watch samples and derived daily features; it does not use Garmin Health API, Garmin Activity API cloud access, sleep, HRV Status, Training Readiness or Recovery Time data.

Supabase's built-in email sender has very low testing limits and is not intended for beta or production auth email volume. Fuel Guard uses Resend custom SMTP for Supabase Auth messages and an authenticated server endpoint for Coach/organisation invitation messages. Configure and accept the complete flow described in `docs/resend-transactional-email.md` before wider beta testing.
