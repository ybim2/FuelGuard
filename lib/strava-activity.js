// Provider adapter foundation only. OAuth/token persistence is intentionally
// not enabled until Fuel Guard has approved Strava application credentials.
const domain = require("../fuel-guard-domain.js");

const STRAVA_ACTIVITY_SCOPE = "activity:read";
const STRAVA_PRIVATE_ACTIVITY_SCOPE = "activity:read_all";

function canonicalActivityFromStrava(activity = {}, userId = "") {
  const durationSeconds = Number(activity.elapsed_time || activity.moving_time || 0);
  return domain.normalizeWorkout({
    id: `strava:${String(activity.id || "")}`,
    athleteId: userId,
    source: "strava",
    sourceActivityId: String(activity.id || ""),
    type: activity.sport_type || activity.type || "training",
    title: activity.name || "Strava activity",
    startedAt: activity.start_date,
    durationSeconds,
    timeZone: activity.timezone || "",
    sourceMetadata: {
      trainer: Boolean(activity.trainer),
      commute: Boolean(activity.commute),
      manual: Boolean(activity.manual)
    }
  });
}

module.exports = {
  STRAVA_ACTIVITY_SCOPE,
  STRAVA_PRIVATE_ACTIVITY_SCOPE,
  canonicalActivityFromStrava
};
