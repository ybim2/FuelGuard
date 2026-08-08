# Fuel Guard Garmin Health Data Boundary

Fuel Guard currently uses only data available locally to the Connect IQ app on the watch. It does not use Garmin Health API, Garmin Activity API cloud access, sleep-score data, overnight HRV Status, Training Readiness, Recovery Time or undocumented Garmin metrics.

## Available Now

Quick Log can optionally share bounded Connect IQ-local snapshots after the user enables health-pattern sharing in Garmin Connect / Connect IQ settings.

Collection is opportunistic when Quick Log opens, refreshes or logs fuel; it is not triggered by completion of a Garmin activity. The current collector does not emit a Garmin cloud activity ID, so `source_activity_id` remains empty and Fuel Guard uses the summary fields for ingestion deduplication.

Supported sources are runtime-detected per device:

- `Toybox.SensorHistory.getHeartRateHistory()`
- `Toybox.SensorHistory.getStressHistory()`
- `Toybox.SensorHistory.getBodyBatteryHistory()`
- `Toybox.UserProfile.getProfile()` for `restingHeartRate` and `averageRestingHeartRate`
- `Toybox.UserProfile.getUserActivityHistory()` for high-level recent activity summaries

Fuel Guard stores these separately from fuel and hydration logs with `source = 'garmin_connect_iq_local'`.

## Device-Dependent Availability

Connect IQ method availability varies by product, firmware and SDK API level. Quick Log must check for module and method support before every collection attempt. Missing support should produce a capability record and an insufficient-data message, not a crash.

The current target is Forerunner 255 (`fr255`) with the installed SDK reporting API level 5.2 / CIQ 5.2.0.

## Not Available In This Layer

This layer intentionally does not collect or infer:

- Sleep duration, sleep stages or sleep score
- Overnight HRV or HRV Status
- Training Readiness
- Recovery Time
- GPS routes or location tracks
- Raw beat-to-beat intervals
- Gender, birth year, height or weight
- Calories, food details, macros or nutrition quantities

Those metrics must not appear in production controls until a separate Garmin Health API or documented source is implemented and reviewed.

## Future Garmin Health API Integration

Future cloud data should use a distinct `source`, such as `garmin_health_api`, and should land in the same raw-table and daily-feature architecture where possible. Cloud data may replace or supplement Connect IQ-local samples when it covers the same time period more completely.

Future ingestion should keep these rules:

- Keep raw samples separate from derived daily features.
- Keep owner-only Row Level Security.
- Preserve observation time separately from server receive time.
- Dedupe by user, source, device/source identifier and timestamp.
- Prefer the more complete source for feature generation when two sources cover the same period.
- Label mixed-source insights clearly so users know whether the pattern came from local watch samples, Garmin cloud data or both.

## Analysis Boundary

Insights must describe personal associations only. Fuel Guard may say that stress, Body Battery, heart-rate samples or training behaviour tended to coincide with a fuelling pattern. It must not claim fuelling caused a medical or physiological outcome.

When data coverage is limited, the UI should say what data is still needed rather than showing generic or fabricated insights.
