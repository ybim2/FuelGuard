# Garmin Forerunner 255 pairing acceptance

This is the release gate for both Fuel Guard Garmin beta apps. Run it with a physical Forerunner 255 and the Connect IQ Store mobile app. `Toybox.Authentication.makeOAuthRequest()` hands the request to Connect IQ Store; Garmin Connect is not the OAuth handoff app.

## Pair each app

Repeat this sequence once for Quick Log and once for Activity Logger:

1. Install the exact candidate build and open its connection control on the watch.
2. Start pairing and confirm the watch says `Open Connect IQ on phone`.
3. Open the notification in the Connect IQ Store mobile app.
4. Confirm `https://fuelguardapp.com/garmin/connect/` opens with the expected app and a non-empty `state` value.
5. Sign in to the intended Fuel Guard athlete account and approve the request.
6. Confirm the browser returns through `connectiq://oauth`.
7. Confirm the watch leaves the waiting state, shows `Completing connection`, then `Connected`.
8. If it does not connect, record the exact watch status. The candidate distinguishes invalid callback data, state mismatch, denial, expired approval, device/network failure and server failure.

## End-to-end events

1. In Quick Log, create one Fuel event and one Hydrate event.
2. Confirm each produces exactly one `fuel_logs` row for the approving athlete with `source = 'garmin'` and a stable `external_event_id`.
3. Add Activity Logger to a native activity, disable Auto Lap, start the activity and press LAP once.
4. Confirm LAP produces exactly one Fuel row. Activity Logger has no separate in-activity Hydration control.
5. Retry one queued event after restoring phone/network connectivity and confirm idempotency keeps one row.

Do not merge or deploy the candidate until both apps complete this physical sequence.
