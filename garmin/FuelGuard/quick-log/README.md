# Fuel Guard Quick Log

Connect IQ Watch App with Glance on compatible devices. The Forerunner 255 (`fr255`) is the primary physical reference target; see `../public-release/SUPPORTED_DEVICES.md` for the production public-beta range. Older supported devices that do not expose Watch App glances still run the main Quick Log app.

## What it does

- Glance shows Fuel Guard, time since the most recent fuel log saved locally on the watch, and a small pending count when needed. It does not fetch the latest server state while sitting in the glance.
- Opening the app defaults to Fuel for the fastest flow.
- UP/DOWN changes selection.
- START logs Fuel, Hydrate or Sleepy.
- ESC exits normally.
- Events are persisted before upload and retried later if offline.
- A successful local save confirms immediately; pending sync remains visible until the server acknowledges it.

## Build

From the repository root:

```bash
scripts/build-garmin.sh
```

Output:

```text
build/garmin/fuel-guard-quick-log-fr255.prg
```

For a signed multi-device public candidate, run `scripts/export-garmin-public-release.sh` from the repository root.
