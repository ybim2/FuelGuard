import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.WatchUi;

module FuelGuardEvents {
    const TYPE_FUEL = "fuel";
    const TYPE_HYDRATION = "hydration";
    const TYPE_FUEL_HYDRATION = "fuel_hydration";
    const DEVICE_ID = "fr255";
    const COUNTER_KEY = "fg_event_counter";
    const LAST_FUEL_KEY = "fg_last_fuel_at";
    const TODAY_FUEL_COUNT_KEY = "fg_today_fuel_count";
    const TODAY_FUEL_DATE_KEY = "fg_today_fuel_date";

    function normalizeType(type as String) as String {
        if (type.equals(TYPE_HYDRATION)) {
            return TYPE_HYDRATION;
        }
        if (type.equals(TYPE_FUEL_HYDRATION)) {
            return TYPE_FUEL_HYDRATION;
        }
        return TYPE_FUEL;
    }

    function nextCounter() as Number {
        var value = Storage.getValue(COUNTER_KEY);
        var counter = value instanceof Number ? value as Number : 0;
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

    function localDateKey(seconds as Number) as String {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        var year = info.year instanceof Number ? info.year as Number : 1970;
        var month = info.month instanceof Number ? info.month as Number : 1;
        var day = info.day instanceof Number ? info.day as Number : 1;
        return Lang.format("$1$-$2$-$3$", [
            year.format("%04d"),
            month.format("%02d"),
            day.format("%02d")
        ]);
    }

    function todayFuelCountAt(seconds as Number) as Number {
        var today = localDateKey(seconds);
        var storedDate = Storage.getValue(TODAY_FUEL_DATE_KEY);
        if (!(storedDate instanceof String) || !(storedDate as String).equals(today)) {
            Storage.setValue(TODAY_FUEL_DATE_KEY, today);
            Storage.setValue(TODAY_FUEL_COUNT_KEY, 0);
            return 0;
        }
        var count = Storage.getValue(TODAY_FUEL_COUNT_KEY);
        return count instanceof Number ? count as Number : 0;
    }

    function recordFuelForGlance(timestamp as Number) as Void {
        var today = localDateKey(timestamp);
        var storedDate = Storage.getValue(TODAY_FUEL_DATE_KEY);
        var count = 0;
        if (storedDate instanceof String && (storedDate as String).equals(today)) {
            var storedCount = Storage.getValue(TODAY_FUEL_COUNT_KEY);
            count = storedCount instanceof Number ? storedCount as Number : 0;
        }
        Storage.setValue(TODAY_FUEL_DATE_KEY, today);
        Storage.setValue(TODAY_FUEL_COUNT_KEY, count + 1);
        Storage.setValue(LAST_FUEL_KEY, timestamp);
        WatchUi.requestUpdate();
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
        if (normalizedType.equals(TYPE_FUEL) || normalizedType.equals(TYPE_FUEL_HYDRATION)) {
            recordFuelForGlance(timestamp);
        }
        return event;
    }

    function lastFuelSeconds() as Number? {
        var value = Storage.getValue(LAST_FUEL_KEY);
        return value instanceof Number ? value as Number : null;
    }

    (:debug)
    function setLastFuelSecondsForTest(seconds as Number?) as Void {
        if (seconds == null) {
            Storage.deleteValue(LAST_FUEL_KEY);
            Storage.deleteValue(TODAY_FUEL_COUNT_KEY);
            Storage.deleteValue(TODAY_FUEL_DATE_KEY);
        } else {
            Storage.setValue(LAST_FUEL_KEY, seconds as Number);
        }
    }

    (:debug)
    function setTodayFuelCountForTest(count as Number, dateKey as String) as Void {
        Storage.setValue(TODAY_FUEL_COUNT_KEY, count);
        Storage.setValue(TODAY_FUEL_DATE_KEY, dateKey);
    }

    (:debug)
    function todayFuelCountForTest() as Number {
        return todayFuelCountAt(nowSeconds());
    }

    (:debug)
    function localDateKeyForTest(seconds as Number) as String {
        return localDateKey(seconds);
    }
}
