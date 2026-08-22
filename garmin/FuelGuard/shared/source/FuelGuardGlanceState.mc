import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;

(:glance)
module FuelGuardGlanceState {
    const LAST_FUEL_KEY = "fg_last_fuel_at";
    const LAST_SYNC_KEY = "fg_last_fuel_sync_at";
    const STATUS_KNOWN_KEY = "fg_last_fuel_status_known";
    const MAX_STALE_SECONDS = 6 * 60 * 60;
    const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

    function nowSeconds() as Number {
        return Time.now().value();
    }

    function safeStoredNumber(key as String) as Number? {
        var value = Storage.getValue(key);
        if (!(value instanceof Number)) {
            return null;
        }
        var seconds = value as Number;
        if (seconds <= 0 || seconds > nowSeconds() + MAX_CLOCK_SKEW_SECONDS) {
            return null;
        }
        return seconds;
    }

    function lastFuelSeconds() as Number? {
        return safeStoredNumber(LAST_FUEL_KEY);
    }

    function lastSyncSeconds() as Number? {
        return safeStoredNumber(LAST_SYNC_KEY);
    }

    function statusKnown() as Boolean {
        var value = Storage.getValue(STATUS_KNOWN_KEY);
        return value instanceof Boolean ? value as Boolean : false;
    }

    function fresh() as Boolean {
        var syncedAt = lastSyncSeconds();
        if (!statusKnown() || syncedAt == null) {
            return false;
        }
        var age = nowSeconds() - (syncedAt as Number);
        return age >= 0 && age <= MAX_STALE_SECONDS;
    }

    function dictionaryValue(data as Dictionary, stringKey as String, symbolKey as Symbol) as Object? {
        var value = data[stringKey];
        if (value == null) {
            value = data[symbolKey];
        }
        return value;
    }

    function applyServerStatus(data as Dictionary) as Boolean {
        var status = dictionaryValue(data, "fuel_status", :fuel_status);
        if (!(status instanceof Dictionary)) {
            return false;
        }
        var values = status as Dictionary;
        var syncedAt = dictionaryValue(values, "synced_at_seconds", :synced_at_seconds);
        if (!(syncedAt instanceof Number)) {
            return false;
        }
        var safeSync = syncedAt as Number;
        if (safeSync <= 0 || safeSync > nowSeconds() + MAX_CLOCK_SKEW_SECONDS) {
            return false;
        }

        var lastFuel = dictionaryValue(values, "last_fuel_at_seconds", :last_fuel_at_seconds);
        if (lastFuel != null && !(lastFuel instanceof Number)) {
            return false;
        }
        if (lastFuel instanceof Number) {
            var safeFuel = lastFuel as Number;
            if (safeFuel <= 0 || safeFuel > nowSeconds() + MAX_CLOCK_SKEW_SECONDS) {
                return false;
            }
            Storage.setValue(LAST_FUEL_KEY, safeFuel);
        } else {
            Storage.deleteValue(LAST_FUEL_KEY);
        }
        Storage.setValue(LAST_SYNC_KEY, safeSync);
        Storage.setValue(STATUS_KNOWN_KEY, true);
        return true;
    }

    function recordFuel(timestamp as Number, synced as Boolean) as Boolean {
        var now = nowSeconds();
        if (timestamp <= 0 || timestamp > now + MAX_CLOCK_SKEW_SECONDS) {
            return false;
        }
        var existing = lastFuelSeconds();
        if (existing == null || timestamp >= (existing as Number)) {
            Storage.setValue(LAST_FUEL_KEY, timestamp);
        }
        if (synced) {
            Storage.setValue(LAST_SYNC_KEY, now);
        }
        Storage.setValue(STATUS_KNOWN_KEY, true);
        return true;
    }

    function recordLocalFuel(timestamp as Number) as Boolean {
        return recordFuel(timestamp, false);
    }

    function recordAcknowledgedFuel(timestamp as Number) as Boolean {
        return recordFuel(timestamp, true);
    }

    function markUnavailable() as Void {
        Storage.deleteValue(LAST_FUEL_KEY);
        Storage.deleteValue(LAST_SYNC_KEY);
        Storage.deleteValue(STATUS_KNOWN_KEY);
    }

    function elapsedText(elapsed as Number) as String {
        if (elapsed < 0) {
            elapsed = 0;
        }
        if (elapsed < 60) {
            return "<1m ago";
        }
        var minutes = elapsed / 60;
        var hours = minutes / 60;
        if (hours >= 24) {
            var days = hours / 24;
            return Lang.format("$1$d ago", [days]);
        }
        if (hours >= 1) {
            return Lang.format("$1$h $2$m ago", [hours, minutes % 60]);
        }
        return Lang.format("$1$m ago", [minutes]);
    }

    function metric() as String {
        var lastFuel = lastFuelSeconds();
        if (lastFuel != null) {
            return elapsedText(nowSeconds() - (lastFuel as Number));
        }
        if (statusKnown()) {
            return "No fuel logged";
        }
        return "Open Fuel Guard";
    }

    function label() as String {
        if (lastFuelSeconds() != null) {
            return fresh() ? "Last fuel" : "Last fuel cached";
        }
        if (statusKnown()) {
            return fresh() ? "today" : "cached";
        }
        return "to sync";
    }

    (:debug)
    function resetForTest() as Void {
        Storage.deleteValue(LAST_FUEL_KEY);
        Storage.deleteValue(LAST_SYNC_KEY);
        Storage.deleteValue(STATUS_KNOWN_KEY);
    }

    (:debug)
    function setStatusForTest(lastFuel as Number?, syncedAt as Number) as Void {
        if (lastFuel == null) {
            Storage.deleteValue(LAST_FUEL_KEY);
        } else {
            Storage.setValue(LAST_FUEL_KEY, lastFuel as Number);
        }
        Storage.setValue(LAST_SYNC_KEY, syncedAt);
        Storage.setValue(STATUS_KNOWN_KEY, true);
    }

    (:debug)
    function lastFuelSecondsForTest() as Number? {
        return lastFuelSeconds();
    }

    (:debug)
    function freshForTest() as Boolean {
        return fresh();
    }
}
