import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

(:glance)
module FuelGuardGlanceData {
    const LAST_FUEL_KEY = "fg_last_fuel_at";
    const TODAY_FUEL_COUNT_KEY = "fg_today_fuel_count";
    const TODAY_FUEL_DATE_KEY = "fg_today_fuel_date";

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

    function lastFuelSeconds() as Number? {
        var value = Storage.getValue(LAST_FUEL_KEY);
        return value instanceof Number ? value as Number : null;
    }

    function todayFuelCount() as Number {
        var today = localDateKey(Time.now().value());
        var storedDate = Storage.getValue(TODAY_FUEL_DATE_KEY);
        if (!(storedDate instanceof String) || !(storedDate as String).equals(today)) {
            Storage.setValue(TODAY_FUEL_DATE_KEY, today);
            Storage.setValue(TODAY_FUEL_COUNT_KEY, 0);
            return 0;
        }
        var count = Storage.getValue(TODAY_FUEL_COUNT_KEY);
        return count instanceof Number ? count as Number : 0;
    }

    function elapsedText(elapsed as Number) as String {
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

    function metric() as String {
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null) {
            return "No fuel today";
        }
        var nowSeconds = Time.now().value();
        if (!sameLocalDay(lastFuel as Number, nowSeconds)) {
            return "No fuel today";
        }
        return Lang.format("$1$ since fuel", [elapsedText(nowSeconds - (lastFuel as Number))]);
    }

    function label() as String {
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null) {
            return "Press START to log";
        }
        if (!sameLocalDay(lastFuel as Number, Time.now().value())) {
            return "Press START to log";
        }
        var count = todayFuelCount();
        if (count < 1) {
            count = 1;
        }
        return Lang.format("$1$ $2$ today", [count, count == 1 ? "log" : "logs"]);
    }

    (:debug)
    function todayFuelCountForTest() as Number {
        return todayFuelCount();
    }

    (:debug)
    function localDateKeyForTest(seconds as Number) as String {
        return localDateKey(seconds);
    }
}
