# Fuel Guard Garmin Source

The active Garmin Connect IQ implementation lives in:

```text
garmin/FuelGuard/
```

Use that folder for all current Garmin app work. It contains the two supported
Forerunner 255 (`fr255`) apps:

- `activity-logger/` - the Activity Logger data field. It records fuel on
  `DataField.onTimerLap()`. Disable Auto Lap on the Forerunner 255 before using
  it, because the device does not support distinguishing manual laps from Auto
  Lap through `onTimerLap2()`.
- `quick-log/` - the Quick Log watch app plus its existing glance. It records
  fuel, hydration, and fuel+hydration events outside activities.

Shared Monkey C modules are in `garmin/FuelGuard/shared/`. Private beta store
metadata is in `garmin/FuelGuard/private-beta/`.

The `garmin/connect/` folder is not a Connect IQ app. It is the web pairing page
served by the Fuel Guard PWA/backend.

Historical Garmin prototypes should be treated as archived reference material
only. Do not edit dated project copies or archived branches as the source of
truth for production Garmin work.

Build from the repository root:

```bash
export GARMIN_DEVELOPER_KEY="$HOME/.garmin-connectiq/developer_key.der"
./scripts/build-garmin.sh
```
