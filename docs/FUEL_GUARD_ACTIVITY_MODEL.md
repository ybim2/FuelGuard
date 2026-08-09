# Fuel Guard canonical activity model

Fuel Guard treats Garmin, Strava, Training Mode, coach-scheduled sessions and manual activities as providers of the same activity context. `FuelGuardDomain.normalizeWorkout` is the canonical adapter and produces:

- provider (`source`)
- provider activity ID (`sourceActivityId`)
- athlete/user ID
- activity type and title
- start, end and duration
- timezone and provider-specific raw metadata

Provider IDs deduplicate repeated delivery from one provider. Across providers, completed activities are treated as the same context only when athlete ID and normalised activity type match, start times are within two minutes, and duration differs by no more than two minutes or 5%. Activities without an athlete ID are never cross-provider merged. This prevents cross-user deduplication.

Training Mode sessions remain athlete-owned rows with quantities linked to the ordinary Fuel/Hydration event stream. Coach and future Performance adapters consume the canonical activity representation; they do not receive broader database grants. Performance must continue to use its existing organisation capability, scope and consent checks before any future aggregation of Training Mode coverage or execution.

## Strava foundation status

`lib/strava-activity.js` maps Strava completed-activity payloads into the canonical model. OAuth, webhook subscription and token storage are deliberately not activated without approved Strava application credentials and redirect/webhook configuration. The integration needs activity read access only; Fuel Guard does not ingest social, route, segment, leaderboard, follower, comment or kudos data.

## Training measurement boundary

Training Mode intentionally tracks only carbohydrate, fluid, sodium and caffeine for acute endurance-session execution. Protein and fat are not collected or exposed in this release. Additional endurance modes can add separate optional metrics later without changing the identity of existing activity, session or Fuel/Hydration event records.
