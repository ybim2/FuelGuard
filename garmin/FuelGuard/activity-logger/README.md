# Fuel Guard Activity Logger

Connect IQ Data Field for Forerunner 255 (`fr255`).

## What it does

- Runs inside Garmin native activities such as Run or Bike.
- Uses `DataField.onTimerLap()` to record a Fuel Guard `fuel` event.
- Persists the event before upload.
- Shows a short `FUEL LOGGED` confirmation.
- Shows time since last fuel and pending upload count.
- Retries queued events without parallel duplicate requests.

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
