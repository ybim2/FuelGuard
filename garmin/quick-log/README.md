# Fuel Guard Quick Log

Connect IQ Watch App with Glance for Forerunner 255 (`fr255`).

## What it does

- Glance shows Fuel Guard, time since last fuel and pending count.
- Opening the app defaults to Fuel for the fastest flow.
- UP/DOWN changes selection.
- ENTER logs Fuel, Hydration or Fuel + Water.
- ESC exits normally.
- Events are persisted before upload and retried later if offline.

## Build

From the repository root:

```bash
scripts/build-garmin.sh
```

Output:

```text
build/garmin/fuel-guard-quick-log-fr255.prg
```
