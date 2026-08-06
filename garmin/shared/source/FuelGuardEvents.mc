import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

module FuelGuardEvents {
    const TYPE_FUEL = "fuel";
    const TYPE_HYDRATION = "hydration";
    const TYPE_FUEL_HYDRATION = "fuel_hydration";
    const DEVICE_ID = "fr255";
    const COUNTER_KEY = "fg_event_counter";
    const LAST_FUEL_KEY = "fg_last_fuel_at";

    function normalizeType(type as String) as String {
        if (type == TYPE_HYDRATION) {
            return TYPE_HYDRATION;
        }
        if (type == TYPE_FUEL_HYDRATION) {
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
        var info = Gregorian.utcInfo(new Time.Moment(seconds), Time.FORMAT_MEDIUM);
        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$Z", [
            info.year.format("%04d"),
            info.month.format("%02d"),
            info.day.format("%02d"),
            info.hour.format("%02d"),
            info.min.format("%02d"),
            info.sec.format("%02d")
        ]);
    }

    function create(type as String) as Dictionary {
        var timestamp = nowSeconds();
        var counter = nextCounter();
        var normalizedType = normalizeType(type);
        var event = {
            :external_event_id => Lang.format("fg-$1$-$2$-$3$", [DEVICE_ID, timestamp, counter]),
            :logged_at => isoUtcFromSeconds(timestamp),
            :logged_at_seconds => timestamp,
            :type => normalizedType,
            :device_id => DEVICE_ID
        };
        if (normalizedType == TYPE_FUEL || normalizedType == TYPE_FUEL_HYDRATION) {
            Storage.setValue(LAST_FUEL_KEY, timestamp);
        }
        return event;
    }

    function lastFuelSeconds() as Number? {
        var value = Storage.getValue(LAST_FUEL_KEY);
        return value instanceof Number ? value as Number : null;
    }
}
