import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

module FuelGuardEvents {
    const TYPE_FUEL = "fuel";
    const TYPE_HYDRATION = "hydration";
    const TYPE_FUEL_HYDRATION = "fuel_hydration";
    const TYPE_SLEEPY = "sleepy";
    const DEVICE_ID = "fr255";
    const COUNTER_KEY = "fg_event_counter";
    const LAST_FUEL_KEY = "fg_last_fuel_at";

    function normalizeType(type as String) as String {
        if (type.equals(TYPE_HYDRATION)) {
            return TYPE_HYDRATION;
        }
        if (type.equals(TYPE_FUEL_HYDRATION)) {
            return TYPE_FUEL_HYDRATION;
        }
        if (type.equals(TYPE_SLEEPY)) {
            return TYPE_SLEEPY;
        }
        return TYPE_FUEL;
    }

    function nextCounter() as Number {
        var value = Storage.getValue(COUNTER_KEY);
        var counter = value instanceof Number ? value as Number : 0;
        if (counter < 0 || counter >= 2000000000) {
            FuelGuardDiagnostics.report("QL-STATE-05", "reset malformed event counter", null);
            counter = 0;
        }
        counter += 1;
        Storage.setValue(COUNTER_KEY, counter);
        return counter;
    }

    function nowSeconds() as Number {
        return Time.now().value();
    }

    function isoUtcFromSeconds(seconds as Number) as String {
        var info = Gregorian.utcInfo(new Time.Moment(seconds), Time.FORMAT_SHORT);
        var year = info.year instanceof Number ? info.year as Number : 1970;
        var month = info.month instanceof Number ? info.month as Number : 1;
        var day = info.day instanceof Number ? info.day as Number : 1;
        var hour = info.hour instanceof Number ? info.hour as Number : 0;
        var minute = info.min instanceof Number ? info.min as Number : 0;
        var second = info.sec instanceof Number ? info.sec as Number : 0;

        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$Z", [
            year.format("%04d"),
            month.format("%02d"),
            day.format("%02d"),
            hour.format("%02d"),
            minute.format("%02d"),
            second.format("%02d")
        ]);
    }

    function create(type as String) as Dictionary {
        var timestamp = nowSeconds();
        var counter = nextCounter();
        var normalizedType = normalizeType(type);
        var event = {
            "external_event_id" => Lang.format("fg-$1$-$2$-$3$", [DEVICE_ID, timestamp, counter]),
            "logged_at" => isoUtcFromSeconds(timestamp),
            "logged_at_seconds" => timestamp,
            "type" => normalizedType,
            "device_id" => DEVICE_ID
        };
        return event;
    }

    function lastFuelSeconds() as Number? {
        var value = Storage.getValue(LAST_FUEL_KEY);
        if (!(value instanceof Number)) {
            return null;
        }
        var seconds = value as Number;
        if (seconds <= 0 || seconds > Time.now().value() + (24 * 60 * 60)) {
            FuelGuardDiagnostics.report("QL-STATE-06", "ignore malformed last fuel time", null);
            try {
                Storage.deleteValue(LAST_FUEL_KEY);
            } catch (e) {
                FuelGuardDiagnostics.report("QL-STATE-03", "repair last fuel time", e);
            }
            return null;
        }
        return seconds;
    }

    (:debug)
    function setLastFuelSecondsForTest(seconds as Number?) as Void {
        if (seconds == null) {
            Storage.deleteValue(LAST_FUEL_KEY);
        } else {
            Storage.setValue(LAST_FUEL_KEY, seconds as Number);
        }
    }
}
