# Fuel Guard Garmin Apps

This folder contains two separate Garmin Connect IQ apps for the Forerunner 255 product ID `fr255`.

## Apps

1. Fuel Guard Activity Logger
   - Connect IQ Data Field used inside Garmin Run, Bike and compatible native activities.
   - Records a Fuel Guard `fuel` event when Garmin emits `DataField.onTimerLap()`.

2. Fuel Guard Quick Log
   - Watch App with a Glance.
   - Logs `fuel`, `hydration` or `fuel_hydration` outside an activity.
   - Optionally collects bounded Connect IQ-local Garmin health-pattern snapshots after explicit opt-in.

Both apps pair to a Fuel Guard account through Garmin mobile authentication. After pairing, they send events to:

```text
POST /api/garmin/log
```

Quick Log can also send opt-in local watch snapshots to:

```text
POST /api/garmin/health
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
supabase/garmin_health_snapshots.sql
```

`fuel_logs.sql` adds Garmin log idempotency through `source = 'garmin'`, `external_event_id`, and the unique partial index on `(user_id, source, external_event_id)`.

`garmin_zero_secret_auth.sql` adds short-lived Garmin pairing sessions and revocable device tokens. The token table stores only HMAC hashes using `GARMIN_TOKEN_PEPPER`; raw device tokens are returned once to the paired Garmin app and are never stored server-side. RLS is enabled on both Garmin auth tables, direct anon/authenticated table access is denied, and user access goes through secure API routes.

`garmin_health_snapshots.sql` adds separate owner-isolated tables for optional Connect IQ-local heart-rate history, stress history, Body Battery, resting-heart-rate snapshots, recent activity summaries, derived daily features and daily check-ins. It includes explicit authenticated grants, owner-only RLS policies and idempotency indexes. It does not change existing fuel-log rows.

## Optional Garmin health-pattern sharing

Quick Log includes the disabled-by-default setting:

```text
Share Garmin health patterns with Fuel Guard
```

When enabled, Quick Log may collect the metrics that the current watch and Connect IQ API expose through documented local APIs:

- `SensorHistory.getHeartRateHistory()`
- `SensorHistory.getStressHistory()`
- `SensorHistory.getBodyBatteryHistory()`
- `UserProfile.getProfile()` for `restingHeartRate` and `averageRestingHeartRate`
- `UserProfile.getUserActivityHistory()`

Availability is device-dependent. Quick Log uses runtime guards such as `Toybox has :SensorHistory` and `SensorHistory has :getStressHistory` before calling a method.

The Activity Logger does not request `SensorHistory` or `UserProfile` permissions and does not collect health-pattern snapshots.

### Compatibility matrix

| Device target | Connect IQ API | Heart-rate history | Stress history | Body Battery history | Activity history | UserProfile |
| --- | --- | --- | --- | --- | --- | --- |
| Forerunner 255 (`fr255`) | Installed API level 5.2 / CIQ 5.2.0 | Runtime detected | Runtime detected | Runtime detected | Runtime detected | Runtime detected |

### Collection limits and priority

- Health-pattern sharing is optional and off for existing users.
- Collection happens when Quick Log opens, after a successful fuel-log sync, or during a refresh when the last collection is stale.
- Collection is rate-limited to roughly once every 45 minutes.
- Each snapshot is bounded to 24 samples per sensor-history metric and 8 recent activity summaries.
- The health queue is separate from the fuel/hydration event queue and capped at 3 snapshots.
- Fuel and hydration logs are always higher priority. If event logs are pending, health snapshots wait.
- Failed health uploads stay queued, but they must not block fuel logs from saving or uploading.

### Health-pattern data not collected

Quick Log does not collect raw beat-to-beat intervals, GPS routes, precise location, sleep stages, sleep score, HRV Status, Training Readiness, Recovery Time, gender, birth year, height, weight, passwords, emails, food details, calories or nutrition quantities.

### Clearing health-pattern sharing

Users can disable health-pattern sharing in Garmin Connect / Connect IQ settings. Quick Log also includes a `Clear shared health cache` setting that clears only the local pending health-snapshot queue and collection timestamp on the watch; it does not delete fuel/hydration log events.

See `garmin/GARMIN_HEALTH_API_BOUNDARY.md` for the current Connect IQ-local boundary and the future Garmin Health API integration plan.

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
4. Upload each 0.4.0 IQ package as a new version of its existing beta listing.
5. Do not create new listings.
6. Keep Apps for beta testing only enabled.
7. Sync/update both apps on the Forerunner 255.
8. Open Quick Log, select Connect Fuel Guard, approve on the phone, and verify pending events sync.
9. Open Activity Logger field settings, select Connect Fuel Guard, approve on the phone, and verify pending events sync.
10. Disable Auto Lap on the Forerunner 255 activity profile used for testing.
11. Test one Quick Log event.
12. Test one LAP event.
13. In Quick Log settings, turn on Share Garmin health patterns with Fuel Guard.
14. Open Quick Log and wait for one opt-in health snapshot attempt.
15. Test one offline retry.
16. Confirm exactly one Fuel Guard row per event with `source = 'garmin'` and a stable `external_event_id`.
17. Confirm opt-in health rows use `source = 'garmin_connect_iq_local'`.
18. Confirm the Connected Garmin Apps section in Fuel Guard Settings can revoke each app.

No Garmin token, Vercel bypass secret or endpoint entry is required.
