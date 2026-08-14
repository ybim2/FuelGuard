# Resend transactional email

Fuel Guard uses two delivery paths while preserving Supabase Auth as the owner of account security:

- Supabase Auth sends signup confirmation, password recovery, email-change, and Auth invitation messages through Resend custom SMTP.
- Fuel Guard's authenticated `/api/email/invitation` endpoint sends Coach connection requests, Coach approval/decline decisions, organisation-sharing invitations, and organisation staff-access messages through the Resend Email API.

## Required server configuration

Configure these as server-only deployment secrets. Never add them to `api/supabase-config.js`, client JavaScript, the service worker, or source control.

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `RESEND_API_KEY`
- `FUEL_GUARD_EMAIL_FROM=Fuel Guard <noreply@fuelguardapp.com>`
- `FUEL_GUARD_APP_URL=https://fuelguardapp.com`

The endpoint authenticates the caller with their Supabase access token, then uses the server-only Supabase secret to verify the exact database state and derive the recipient from Auth. Browser callers cannot supply or override the recipient address. Resend requests include a stable idempotency key for each invitation or relationship transition, so retries within Resend's idempotency window cannot duplicate the same message.

## Supabase Auth configuration

Connect the production Supabase project to Resend using the Supabase/Resend integration or configure Auth custom SMTP with the Resend SMTP credentials. Use a verified sending domain, preserve email confirmation and the existing redirect allow-list, and set the Auth email rate limit for the planned beta volume (approximately 150 users) without weakening per-user resend throttles.

Auth templates must keep Supabase's generated confirmation/recovery links intact. Do not replace signup or recovery with the invitation endpoint.

Fuel Guard uses Supabase Auth SMTP for account confirmation and password recovery. Email OTP and magic-code login are not exposed by the application. Keep confirmation and recovery templates configured without exposing whether an address already has an account; the beta Auth email rate limit still applies.

## Acceptance checklist

1. Confirm all five server variables are present in the target deployment without printing their values.
2. Confirm Supabase Auth reports custom SMTP enabled and the sender matches the verified Resend domain.
3. With temporary accounts, complete signup confirmation and password recovery end to end.
4. Send a Coach connection request, approve a separate request, decline a separate request, send an organisation-sharing invitation, and send an organisation staff-access message; confirm each arrives once and links to `https://fuelguardapp.com`.
5. Confirm the invitations remain pending until the athlete accepts and that an unrelated authenticated account receives `404 invitation_not_found` for direct-ID attempts.
6. Review server logs by invitation kind, entity ID, actor ID, and Resend message ID. Logs must not contain access tokens, service keys, or recipient addresses.
7. Remove the temporary accounts and invitation rows after acceptance.

If Resend or SMTP delivery fails, the database invitation remains saved and the UI states that email delivery failed. Access is never granted by successful email delivery alone.
