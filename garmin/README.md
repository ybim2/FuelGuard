# Fuel Guard Garmin Apps

This folder contains two separate Garmin Connect IQ apps for the Forerunner 255 product ID `fr255`.

## Apps

1. Fuel Guard Activity Logger
   - Connect IQ Data Field used inside Garmin Run, Bike and compatible native activities.
   - Records a Fuel Guard `fuel` event when Garmin emits `DataField.onTimerLap()`.

2. Fuel Guard Quick Log
   - Watch App with a Glance.
   - Logs `fuel`, `hydration` or `fuel_hydration` outside an activity.

Both apps send events to the Fuel Guard Vercel endpoint:

```text
POST /api/garmin-log
```

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

Set these server-side Vercel variables for the Fuel Guard deployment:

```text
GARMIN_BETA_TOKEN
GARMIN_BETA_USER_ID
SUPABASE_URL
SUPABASE_SECRET_KEY
```

`SUPABASE_SECRET_KEY` must stay server-side. Do not put it in the PWA, Garmin app source, public config endpoint, service worker or frontend environment variables.

The Garmin app settings need only:

- Fuel Guard API endpoint, for example `https://fuel-guard-iota.vercel.app/api/garmin-log`
- Garmin beta bearer token matching `GARMIN_BETA_TOKEN`

## Supabase setup

Apply:

```text
supabase/fuel_logs.sql
```

The migration adds:

- nullable `external_event_id`
- `garmin` as an allowed `fuel_logs.source`
- unique partial idempotency index on `(user_id, source, external_event_id)` when `external_event_id is not null`

Existing owner-only RLS policies and grants are preserved.

## Loading onto Forerunner 255

1. Build both PRG files.
2. Connect the Forerunner 255 by USB.
3. Run `scripts/sideload-garmin.sh` or copy both `.prg` files into the device `GARMIN/APPS` folder for sideload testing.
4. Disconnect safely and restart the watch if needed.

## Activity Logger setup

1. Install `fuel-guard-activity-logger-fr255.prg`.
2. Configure endpoint and token in Garmin Connect or Connect IQ settings.
3. Add the data field to Run, Bike or a compatible native activity profile.
4. Disable Auto Lap.
5. Start the activity.
6. Press the Garmin lap button to record a Fuel Guard fuel event.

## Quick Log setup

1. Install `fuel-guard-quick-log-fr255.prg`.
2. Configure endpoint and token in Garmin Connect or Connect IQ settings.
3. Add/open the Fuel Guard glance.
4. Select the glance to open the app.
5. Fuel is selected by default.
6. Use UP/DOWN to select Fuel, Hydration or Fuel + Water.
7. Press ENTER to log.
8. ESC exits normally.

## Offline queue behaviour

Each app persists the event locally before any network request. Failed uploads stay queued. Retry sends one event at a time, reuses the same `external_event_id`, and removes only the specifically acknowledged event. Duplicate/already-recorded server responses are treated as acknowledged.

## Private alpha sequence

1. Deploy a Vercel preview that includes `api/garmin-log.js`.
2. Apply `supabase/fuel_logs.sql` to the linked Supabase project.
3. Set the server-side Vercel environment variables: `GARMIN_BETA_TOKEN`, `GARMIN_BETA_USER_ID`, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
4. Configure each Garmin app with the preview `/api/garmin-log` endpoint and the private alpha bearer token. Do not put `SUPABASE_SECRET_KEY` on the watch.
5. Connect the Forerunner 255 by USB.
6. Run `scripts/sideload-garmin.sh` to copy both PRG files into `GARMIN/APPS`.
7. Disable Auto Lap on the Forerunner 255 activity profile used for testing.
8. Add Fuel Guard Activity Logger to the Run data screens.
9. Open Fuel Guard Quick Log from the app list or glance.
10. Test one outside-activity fuel log from Quick Log.
11. Test one lap-triggered fuel log from Activity Logger.
12. Confirm exactly one Supabase row per event by checking `source = 'garmin'` and a stable `external_event_id`.
13. Run `scripts/test-garmin-endpoint.sh` against the deployed endpoint to confirm duplicate requests are idempotent.
14. Confirm Fuel Guard cloud sync shows the Garmin rows in the PWA.
