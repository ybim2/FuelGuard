# Fuel Guard Quick Log Beta

## Beta app title

Fuel Guard Quick Log

## Concise description

Private Fuel Guard watch app and glance for quick fuel and hydration logging on Forerunner 255.

## Longer description

Fuel Guard Quick Log is a private alpha Connect IQ watch app with glance support for the Forerunner 255. It lets the tester choose Fuel, Hydration, or Fuel + Hydration and send the event to the Fuel Guard beta endpoint.

Use UP and DOWN to select the log type. Press ENTER to log the selected event. Events are persisted locally before upload, queue offline, and retry later with the same external event ID so duplicate requests do not create duplicate Fuel Guard rows.

## Test instructions

1. Install the private beta app on the paired Forerunner 255 from the developer account.
2. Configure the API endpoint, Garmin beta bearer token, and optional Vercel automation bypass secret in Garmin Connect or Connect IQ settings.
3. Open Fuel Guard Quick Log from the activity/app list or glance.
4. Use UP or DOWN to select Fuel.
5. Press ENTER and confirm one Fuel Guard row appears with source `garmin`.
6. Repeat for Hydration and Fuel + Hydration.
7. Test one queued event while network access is unavailable, then reconnect and confirm it syncs once.

## Privacy and data use

This beta records timestamped Fuel Guard fuel and hydration events from the watch. It sends the event type, timestamp, Garmin source, device identifier, and stable external event ID to the configured Fuel Guard endpoint. It does not collect passwords, email addresses, location tracks, heart-rate data, calories, weight, or nutrition details.

## Forerunner 255 support note

This beta targets Garmin product ID `fr255`. The 48x48 launcher source has been replaced with a valid 40x40 launcher resource for this device family.

## Screenshot checklist

- App list entry for Fuel Guard Quick Log.
- Glance entry for Fuel Guard Quick Log.
- Selection screen showing Fuel, Hydration, and Fuel + Hydration options.
- Confirmation state after pressing ENTER.
- Fuel Guard History row showing one synced Garmin event.

## Garmin Developer Dashboard upload steps

1. Open the Garmin Connect IQ Developer Dashboard.
2. Open the existing Beta App listing for Fuel Guard Quick Log.
3. Confirm the app type is Device App with Glance support.
4. Upload `build/garmin-beta/fuel-guard-quick-log-beta.iq` as a new version of the existing beta listing.
5. Confirm Forerunner 255 support.
6. Keep Apps for beta testing only enabled and keep the app private.
7. Add the description, privacy text, store icon, and screenshots.
8. Save the beta listing and sync/update it on the paired Forerunner 255.
