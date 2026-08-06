# Fuel Guard Activity Logger Beta

## Beta app title

Fuel Guard Activity Logger

## Concise description

Private Fuel Guard data field for recording fuel logs from Forerunner 255 lap presses.

## Longer description

Fuel Guard Activity Logger is a private alpha Connect IQ data field for the Forerunner 255. It records a Fuel Guard fuel event when LAP is pressed during an activity and queues the event before attempting upload to the Fuel Guard beta endpoint.

Auto Lap must be disabled on the Forerunner 255 activity profile used for testing. Pressing LAP logs fuel and also creates a normal Garmin lap. Structured workout laps or other lap-producing features may also be interpreted as Fuel Guard fuel logs.

Events can be retried later when network access is available. Duplicate retries use the same external event ID so the Fuel Guard backend can keep one row per event.

## Test instructions

1. Install the private beta app on the paired Forerunner 255 from the developer account.
2. Configure the API endpoint, Garmin beta bearer token, and optional Vercel automation bypass secret in Garmin Connect or Connect IQ settings.
3. Disable Auto Lap on the Run profile used for testing.
4. Add Fuel Guard Activity Logger to the Run data screens.
5. Start a Run activity.
6. Press LAP once.
7. Confirm one Fuel Guard fuel row appears with source `garmin`.
8. Repeat once with network unavailable, then reconnect and confirm the queued event syncs once.

## Privacy and data use

This beta records timestamped Fuel Guard fuel events from the watch. It sends the event type, timestamp, Garmin source, device identifier, and stable external event ID to the configured Fuel Guard endpoint. It does not collect passwords, email addresses, location tracks, heart-rate data, calories, weight, or nutrition details.

## Forerunner 255 support note

This beta targets Garmin product ID `fr255`. The 48x48 launcher source has been replaced with a valid 40x40 launcher resource for this device family.

## Screenshot checklist

- App listed as a data field in Garmin Connect IQ.
- Settings screen showing endpoint, beta token, and optional bypass fields.
- Run data screen with Fuel Guard Activity Logger visible.
- Post-LAP confirmation state on the data field.
- Fuel Guard History row showing one synced Garmin fuel event.

## Garmin Developer Dashboard upload steps

1. Open the Garmin Connect IQ Developer Dashboard.
2. Open the existing Beta App listing for Fuel Guard Activity Logger.
3. Confirm the app type is Data Field.
4. Upload `build/garmin-beta/fuel-guard-activity-logger-beta.iq` as a new version of the existing beta listing.
5. Confirm Forerunner 255 support.
6. Keep Apps for beta testing only enabled and keep the app private.
7. Add the description, privacy text, store icon, and screenshots.
8. Save the beta listing and sync/update it on the paired Forerunner 255.
