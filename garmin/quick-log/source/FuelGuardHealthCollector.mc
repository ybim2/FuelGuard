import Toybox.Lang;
import Toybox.SensorHistory;
import Toybox.Time;
import Toybox.UserProfile;

module FuelGuardHealthCollector {
    const SENSOR_SAMPLE_COUNT = 24;
    const ACTIVITY_SAMPLE_COUNT = 8;

    function supportedCapabilities() as Dictionary {
        var hasSensorHistory = Toybox has :SensorHistory;
        var hasUserProfile = Toybox has :UserProfile;
        return {
            "sensor_history" => hasSensorHistory,
            "heart_rate_history" => hasSensorHistory && (SensorHistory has :getHeartRateHistory),
            "stress_history" => hasSensorHistory && (SensorHistory has :getStressHistory),
            "body_battery_history" => hasSensorHistory && (SensorHistory has :getBodyBatteryHistory),
            "user_profile" => hasUserProfile && (UserProfile has :getProfile),
            "activity_history" => hasUserProfile && (UserProfile has :getUserActivityHistory),
            "resting_heart_rate" => hasUserProfile && (UserProfile has :getProfile),
            "average_resting_heart_rate" => hasUserProfile && (UserProfile has :getProfile)
        };
    }

    function newSnapshotId(nowSeconds as Number) as String {
        return Lang.format("fg-health-$1$-$2$-$3$", [FuelGuardEvents.DEVICE_ID, nowSeconds, FuelGuardEvents.nextCounter()]);
    }

    function sampleIso(sample as Object) as String? {
        if (sample instanceof SensorHistory.SensorSample && (sample as SensorHistory.SensorSample).when != null) {
            return FuelGuardEvents.isoUtcFromSeconds(((sample as SensorHistory.SensorSample).when as Time.Moment).value());
        }
        return null;
    }

    function sensorSamples(methodSymbol as Symbol, key as String, includeNullStress as Boolean) as Array<Dictionary> {
        var rows = [];
        if (!((Toybox has :SensorHistory) && (SensorHistory has methodSymbol))) {
            return rows;
        }
        try {
            var getMethod = new Lang.Method(SensorHistory, methodSymbol);
            var iterator = getMethod.invoke({
                :period => SENSOR_SAMPLE_COUNT,
                :order => SensorHistory.ORDER_OLDEST_FIRST
            });
            if (iterator == null) {
                return rows;
            }
            var sample = iterator.next();
            var count = 0;
            while (sample != null && count < SENSOR_SAMPLE_COUNT) {
                var observedAt = sampleIso(sample);
                var data = (sample as SensorHistory.SensorSample).data;
                if (observedAt != null && (data != null || includeNullStress)) {
                    var row = {
                        "observed_at" => observedAt
                    };
                    row[key] = data;
                    if (includeNullStress && data == null) {
                        row["status"] = "invalid";
                    }
                    rows.add(row);
                }
                sample = iterator.next();
                count += 1;
            }
        } catch (e) {
            return [];
        }
        return rows;
    }

    function profileSnapshot(nowIso as String) as Dictionary? {
        if (!((Toybox has :UserProfile) && (UserProfile has :getProfile))) {
            return null;
        }
        try {
            var profile = UserProfile.getProfile();
            var row = {
                "observed_at" => nowIso
            };
            var resting = profile.restingHeartRate;
            var averageResting = profile.averageRestingHeartRate;
            var hasValue = false;
            if (resting instanceof Number) {
                row["resting_heart_rate"] = resting as Number;
                hasValue = true;
            }
            if (averageResting instanceof Number) {
                row["average_resting_heart_rate"] = averageResting as Number;
                hasValue = true;
            }
            return hasValue ? row : null;
        } catch (e) {
            return null;
        }
    }

    function activitySummaries() as Array<Dictionary> {
        var rows = [];
        if (!((Toybox has :UserProfile) && (UserProfile has :getUserActivityHistory))) {
            return rows;
        }
        try {
            var iterator = UserProfile.getUserActivityHistory();
            var activity = iterator.next();
            var count = 0;
            while (activity != null && count < ACTIVITY_SAMPLE_COUNT) {
                var startTime = activity.startTime;
                var duration = activity.duration;
                if (startTime != null && duration != null) {
                    var row = {
                        "started_at" => FuelGuardEvents.isoUtcFromSeconds((startTime as Time.Moment).value()),
                        "duration_seconds" => duration.value(),
                        "activity_type" => activity.type == null ? "activity" : activity.type.toString()
                    };
                    var distance = activity.distance;
                    if (distance instanceof Number) {
                        row["distance_metres"] = distance as Number;
                    }
                    rows.add(row);
                }
                activity = iterator.next();
                count += 1;
            }
        } catch (e) {
            return [];
        }
        return rows;
    }

    function hasCollectedData(payload as Dictionary) as Boolean {
        return (payload["heart_rate_samples"] as Array).size() > 0
            || (payload["stress_samples"] as Array).size() > 0
            || (payload["body_battery_samples"] as Array).size() > 0
            || payload["profile_snapshot"] != null
            || (payload["activity_summaries"] as Array).size() > 0;
    }

    function collect() as Dictionary? {
        var nowSeconds = Time.now().value();
        var nowIso = FuelGuardEvents.isoUtcFromSeconds(nowSeconds);
        var payload = {
            "schema_version" => 1,
            "snapshot_external_id" => newSnapshotId(nowSeconds),
            "device_id" => FuelGuardEvents.DEVICE_ID,
            "collected_at" => nowIso,
            "timezone" => "UTC",
            "capabilities" => supportedCapabilities(),
            "heart_rate_samples" => sensorSamples(:getHeartRateHistory, "value_bpm", false),
            "stress_samples" => sensorSamples(:getStressHistory, "value", true),
            "body_battery_samples" => sensorSamples(:getBodyBatteryHistory, "value", false),
            "profile_snapshot" => profileSnapshot(nowIso),
            "activity_summaries" => activitySummaries()
        };
        return hasCollectedData(payload) ? payload : null;
    }
}
