# Sign in with Apple secret rotation

Fuel Guard web Sign in with Apple is configured in the canonical Supabase Auth provider. The Apple signing key and generated client secret are operational credentials; neither belongs in this repository, Vercel public configuration, browser code, logs, screenshots or support messages.

## Credential inventory

- Store the Apple `.p8` signing key in the account owner’s approved password manager or secrets vault outside the repository.
- Record the Apple Team ID, Key ID and web Services ID in that same restricted inventory.
- Record the actual client-secret generation and expiry dates in the private inventory. They are deliberately not copied into Git.
- Current secret generation date: **account-owner verification required**.
- Next rotation deadline: **six months after the verified generation date, and before the encoded Apple client-secret expiry**.

The missing dates are a release-operations item, not a placeholder credential. Fill them in the private inventory as soon as the active Apple provider secret is confirmed.

## Generate and install a replacement

1. In the private secrets environment, create a new Apple client-secret JWT using the active Team ID, web Services ID, Key ID and `.p8` private key. Set the audience to `https://appleid.apple.com` and an expiry no more than six months ahead.
2. Never paste the `.p8` contents into a terminal command that is recorded in shell history. Use the approved local secret file or vault integration.
3. In Supabase Dashboard → Authentication → Providers → Apple, keep the web Services ID first in the Client IDs list. A future native bundle ID may follow it.
4. Replace only the Apple secret with the newly generated value and save the provider configuration.
5. Keep `https://kwnfbdoxppiajrnkejjk.supabase.co/auth/v1/callback` registered as the Apple Services ID return URL, and keep `fuelguardapp.com` as the web domain.
6. Record the real generation and expiry dates in the private operations inventory, then schedule the next rotation at least 14 days before expiry.

## Acceptance after rotation

1. Open Fuel Guard in a private browser session.
2. Choose **Continue with Apple** and complete Apple authentication.
3. Confirm the Supabase callback returns to `/auth/callback/`, exchanges the PKCE code, and redirects only to an allowlisted Fuel Guard route.
4. Confirm an existing Apple user reaches the same account and a new user without a preferred name sees **What should Fuel Guard call you?**.
5. Confirm Google and email/password login still work, including email confirmation and password recovery.
6. Review Supabase Auth logs for a successful Apple provider exchange and no invalid-client-secret errors. Do not record tokens or relay addresses in the runbook.

## Compromised key procedure

1. Generate a new Sign in with Apple key in Apple Developer and store its `.p8` securely.
2. Generate and install a replacement client secret in Supabase using the new Key ID.
3. Complete the acceptance steps above.
4. Revoke the compromised Apple key in Apple Developer only after the replacement is active.
5. Review Supabase Auth logs for unexpected Apple failures or sign-in activity and document the incident without secrets or user identifiers.
