# Fuel Guard Activity Logger

Connect IQ Data Field for compatible endurance watches. The Forerunner 255 (`fr255`) is the primary physical reference target; see `../public-release/SUPPORTED_DEVICES.md` for the production public-beta range.

## What it does

- Runs inside Garmin native activities such as Run or Bike.
- Uses `DataField.onTimerLap()` to record a Fuel Guard `fuel` event.
- Persists the event before upload.
- Shows a short `FUEL LOGGED` confirmation.
- Shows time since last fuel and pending upload count.
- Retries queued events without parallel duplicate requests.
- Records Fuel only. It does not provide a separate in-activity Hydration action; use Fuel Guard Quick Log for Hydrate events.

## Forerunner 255 warning

The Forerunner 255 does not support `DataField.onTimerLap2()`, so this app cannot tell why a lap happened.

Auto Lap must be disabled before use. Structured workouts or other lap-producing features may create Fuel Guard fuel logs.

## Build

From the repository root:

```bash
scripts/build-garmin.sh
```

Output:

```text
build/garmin/fuel-guard-activity-logger-fr255.prg
```

For a signed multi-device public candidate, run `scripts/export-garmin-public-release.sh` from the repository root.
