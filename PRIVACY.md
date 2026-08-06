# Fuel Guard Privacy Notes

Fuel Guard stores fuel and hydration timing data so you can review your fuelling rhythm. The app does not add calories, macros, weight, dieting, body-image scoring, food-quality judgement, or medical diagnosis.

## Supabase account data

Fuel Guard uses Supabase Auth for account sign-up and login. Fuel and hydration logs are stored against the signed-in user ID and protected by Row Level Security so users can only access their own app data through the normal client paths.

## Garmin connection

Fuel Guard Garmin apps connect through a phone approval flow. The user signs into Fuel Guard, approves the requested Garmin app, and the backend issues that Garmin app its own revocable device token.

- Users do not type Garmin bearer tokens, Vercel bypass secrets, Supabase keys, passwords, or API endpoints into the watch.
- Device tokens are shown only once to the Garmin app during the code exchange.
- Fuel Guard stores only an HMAC hash of each device token on the server, not the raw token.
- Quick Log and Activity Logger have separate app identities and separate revocable tokens.
- Connected Garmin apps can be viewed and revoked from Fuel Guard Settings.

## Garmin event data

Garmin event uploads include only the Fuel Guard event type, timestamp, `garmin` source, device identifier, and stable external event ID for duplicate prevention. The Garmin apps do not send GPS tracks, heart-rate data, calories, body weight, nutrition details, or the user's account email address.

## Revocation

Revoking a Garmin app disables future uploads from that app token. Existing Fuel Guard logs remain in the account unless the user deletes them in Fuel Guard.
