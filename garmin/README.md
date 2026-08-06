# Fuel Guard Garmin Apps

This folder contains two separate Garmin Connect IQ apps for the Forerunner 255 product ID `fr255`.

## Apps

1. Fuel Guard Activity Logger
   - Connect IQ Data Field used inside Garmin Run, Bike and compatible native activities.
   - Records a Fuel Guard `fuel` event when Garmin emits `DataField.onTimerLap()`.

2. Fuel Guard Quick Log
   - Watch App with a Glance.
   - Logs `fuel`, `hydration` or `fuel_hydration` outside an activity.

Both apps pair to a Fuel Guard account through Garmin mobile authentication. After pairing, they send events to:

```text
POST /api/garmin/log
```

No tester manually enters a Garmin token, Vercel bypass secret, Supabase key or API endpoint.

## Important Forerunner 255 limitation

The Forerunner 255 does not support `DataField.onTimerLap2()`. The Activity Logger therefore uses `DataField.onTimerLap()` and cannot distinguish manual laps from Auto Lap, structured workout-step laps or other Garmin lap sources.

For the Fuel Guard Activity Logger on Forerunner 255:

- Disable Auto Lap before using the data field.
- Structured workout laps may be interpreted as Fuel Guard fuel logs.
- Each Fuel Guard fuel log also remains a normal Garmin lap.

## Garmin SDK setup

1. Install Garmin Connect IQ SDK Manager.
2. Install an SDK that supports `fr255`.
3. In SDK Manager's Devices tab, install the Forerunner 255 device package for product ID `fr255`.
   The compiler needs `~/Library/Application Support/Garmin/ConnectIQ/Devices/fr255/compiler.json`.
4. Create your own Connect IQ developer key.
5. Export the key path before building:

```bash
export GARMIN_DEVELOPER_KEY=/absolute/path/to/developer_key.der
```

If `monkeyc` is not on `PATH`, either set `CONNECTIQ_HOME` to the active SDK directory or let `scripts/build-garmin.sh` discover the SDK Manager install under:

```text
~/Library/Application Support/Garmin/ConnectIQ/Sdks
```

## Build

From the repository root:

```bash
scripts/build-garmin.sh
```

Outputs:

```text
build/garmin/fuel-guard-activity-logger-fr255.prg
build/garmin/fuel-guard-quick-log-fr255.prg
```

The build directory is ignored by git. The developer key is never generated, copied or committed by the script.

## Vercel environment variables

Set these server-side Vercel variables for the Fuel Guard production deployment:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
GARMIN_TOKEN_PEPPER
```

`SUPABASE_SECRET_KEY` and `GARMIN_TOKEN_PEPPER` must stay server-side. Do not put either value in the PWA, Garmin app source, public config endpoint, service worker or frontend environment variables.

The Garmin apps use the public production Fuel Guard domain as a compile-time non-secret endpoint. Store users do not see endpoint or credential settings.

## Supabase setup

Apply:

```text
supabase/fuel_logs.sql
supabase/garmin_zero_secret_auth.sql
```

`fuel_logs.sql` adds Garmin log idempotency through `source = 'garmin'`, `external_event_id`, and the unique partial index on `(user_id, source, external_event_id)`.

`garmin_zero_secret_auth.sql` adds short-lived Garmin pairing sessions and revocable device tokens. The token table stores only HMAC hashes using `GARMIN_TOKEN_PEPPER`; raw device tokens are returned once to the paired Garmin app and are never stored server-side. RLS is enabled on both Garmin auth tables, direct anon/authenticated table access is denied, and user access goes through secure API routes.

## Loading onto Forerunner 255 for local smoke tests

1. Build both PRG files.
2. Connect the Forerunner 255 by USB.
3. Run `scripts/sideload-garmin.sh` or copy both `.prg` files into the device `GARMIN/APPS` folder for sideload testing.
4. Disconnect safely and restart the watch if needed.

## Activity Logger setup

1. Install Fuel Guard Activity Logger.
2. Open the data-field settings from the Run activity configuration.
3. Select Connect Fuel Guard.
4. Approve the connection on the phone while signed into Fuel Guard.
5. Add the data field to Run, Bike or a compatible native activity profile.
6. Disable Auto Lap.
7. Start the activity.
8. Press the Garmin lap button to record a Fuel Guard fuel event.

## Quick Log setup

1. Install Fuel Guard Quick Log.
2. Open Fuel Guard Quick Log from the app list or glance.
3. Select Connect Fuel Guard.
4. Approve the connection on the phone while signed into Fuel Guard.
5. Fuel is selected by default after pairing.
6. Use UP/DOWN to select Fuel, Hydration or Fuel + Water.
7. Press ENTER to log.
8. ESC exits normally.

## Offline queue behaviour

Each app persists the event locally before any network request. Failed uploads stay queued. Retry sends one event at a time, reuses the same `external_event_id`, and removes only the specifically acknowledged event. Duplicate/already-recorded server responses are treated as acknowledged.

Existing pending events are preserved when pairing, disconnecting or reconnecting. Pairing immediately attempts to sync the queue with the account that approved the Garmin app.

## Private beta sequence

1. Deploy Fuel Guard production from main with the zero-secret Garmin routes.
2. Apply `supabase/fuel_logs.sql` and `supabase/garmin_zero_secret_auth.sql` to the linked Supabase project.
3. Set the server-side Vercel variables: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `GARMIN_TOKEN_PEPPER`.
4. Upload each 0.3.0 IQ package as a new version of its existing beta listing.
5. Do not create new listings.
6. Keep Apps for beta testing only enabled.
7. Sync/update both apps on the Forerunner 255.
8. Open Quick Log, select Connect Fuel Guard, approve on the phone, and verify pending events sync.
9. Open Activity Logger field settings, select Connect Fuel Guard, approve on the phone, and verify pending events sync.
10. Disable Auto Lap on the Forerunner 255 activity profile used for testing.
11. Test one Quick Log event.
12. Test one LAP event.
13. Test one offline retry.
14. Confirm exactly one Fuel Guard row per event with `source = 'garmin'` and a stable `external_event_id`.
15. Confirm the Connected Garmin Apps section in Fuel Guard Settings can revoke each app.

No Garmin token, Vercel bypass secret or endpoint entry is required.
