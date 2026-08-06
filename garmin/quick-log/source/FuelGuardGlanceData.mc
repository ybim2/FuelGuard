import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

(:glance)
module FuelGuardGlanceData {
    const LAST_FUEL_KEY = "fg_last_fuel_at";
    const QUEUE_KEY = "fg_pending_events";

    function localYear(seconds as Number) as Number {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        return info.year instanceof Number ? info.year as Number : 0;
    }

    function localMonth(seconds as Number) as Number {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        return info.month instanceof Number ? info.month as Number : 0;
    }

    function localDay(seconds as Number) as Number {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        return info.day instanceof Number ? info.day as Number : 0;
    }

    function sameLocalDay(leftSeconds as Number, rightSeconds as Number) as Boolean {
        return localYear(leftSeconds) == localYear(rightSeconds)
            && localMonth(leftSeconds) == localMonth(rightSeconds)
            && localDay(leftSeconds) == localDay(rightSeconds);
    }

    function lastFuelSeconds() as Number? {
        var value = Storage.getValue(LAST_FUEL_KEY);
        return value instanceof Number ? value as Number : null;
    }

    function metric() as String {
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null) {
            return "Ready";
        }
        var nowSeconds = Time.now().value();
        if (!sameLocalDay(lastFuel as Number, nowSeconds)) {
            return "No fuel today";
        }
        var elapsed = nowSeconds - (lastFuel as Number);
        if (elapsed < 60) {
            return "<1m";
        }
        var minutes = elapsed / 60;
        var hours = minutes / 60;
        if (hours >= 1) {
            return Lang.format("$1$h $2$m", [hours, minutes % 60]);
        }
        return Lang.format("$1$m", [minutes]);
    }

    function label() as String {
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null) {
            return "to log";
        }
        if (!sameLocalDay(lastFuel as Number, Time.now().value())) {
            return "Ready to log";
        }
        return "since fuel";
    }

    function eventId(event as Object) as String? {
        if (event instanceof Dictionary) {
            var id = (event as Dictionary)[:external_event_id];
            if (!(id instanceof String)) {
                id = (event as Dictionary)["external_event_id"];
            }
            return id instanceof String ? id as String : null;
        }
        return null;
    }

    function pendingCount() as Number {
        var value = Storage.getValue(QUEUE_KEY);
        if (!(value instanceof Array)) {
            return 0;
        }
        var items = value as Array;
        var count = 0;
        for (var i = 0; i < items.size(); i++) {
            if (eventId(items[i]) != null) {
                count += 1;
            }
        }
        return count;
    }
}
