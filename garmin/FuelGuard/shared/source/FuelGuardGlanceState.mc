import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;

(:glance)
module FuelGuardGlanceState {
    const TOKEN_KEY = "fg_device_token";
    const LAST_FUEL_KEY = "fg_last_fuel_at";
    const LOCAL_FUEL_KEY = "fg_last_local_fuel_at";
    const LAST_SYNC_KEY = "fg_last_fuel_sync_at";
    const STATUS_KNOWN_KEY = "fg_last_fuel_status_known";
    const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

    function nowSeconds() as Number {
        return Time.now().value();
    }

    function connected() as Boolean {
        var value = Storage.getValue(TOKEN_KEY);
        return value instanceof String
            && (value as String).length() > 0
            && (value as String).length() <= 1024;
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

    function localFuelSeconds() as Number? {
        return safeStoredNumber(LOCAL_FUEL_KEY);
    }

    function statusKnown() as Boolean {
        var value = Storage.getValue(STATUS_KNOWN_KEY);
        return value instanceof Boolean ? value as Boolean : false;
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

        var serverFuel = dictionaryValue(values, "last_fuel_at_seconds", :last_fuel_at_seconds);
        if (serverFuel != null && !(serverFuel instanceof Number)) {
            return false;
        }
        var resolvedFuel = null;
        if (serverFuel instanceof Number) {
            var safeFuel = serverFuel as Number;
            if (safeFuel <= 0 || safeFuel > nowSeconds() + MAX_CLOCK_SKEW_SECONDS) {
                return false;
            }
            resolvedFuel = safeFuel;
        }

        var localFuel = localFuelSeconds();
        if (localFuel != null && resolvedFuel instanceof Number && (resolvedFuel as Number) >= (localFuel as Number)) {
            Storage.deleteValue(LOCAL_FUEL_KEY);
            localFuel = null;
        }
        if (localFuel != null && (resolvedFuel == null || (localFuel as Number) > (resolvedFuel as Number))) {
            resolvedFuel = localFuel as Number;
        }

        if (resolvedFuel instanceof Number) {
            Storage.setValue(LAST_FUEL_KEY, resolvedFuel as Number);
        } else {
            Storage.deleteValue(LAST_FUEL_KEY);
        }
        Storage.setValue(LAST_SYNC_KEY, safeSync);
        Storage.setValue(STATUS_KNOWN_KEY, true);
        return true;
    }

    function recordLocalFuel(timestamp as Number) as Boolean {
        var now = nowSeconds();
        if (timestamp <= 0 || timestamp > now + MAX_CLOCK_SKEW_SECONDS) {
            return false;
        }
        var existing = lastFuelSeconds();
        if (existing == null || timestamp >= (existing as Number)) {
            Storage.setValue(LAST_FUEL_KEY, timestamp);
        }
        var localFuel = localFuelSeconds();
        if (localFuel == null || timestamp >= (localFuel as Number)) {
            Storage.setValue(LOCAL_FUEL_KEY, timestamp);
        }
        Storage.setValue(STATUS_KNOWN_KEY, true);
        return true;
    }

    function recordAcknowledgedFuel(timestamp as Number) as Boolean {
        var now = nowSeconds();
        if (timestamp <= 0 || timestamp > now + MAX_CLOCK_SKEW_SECONDS) {
            return false;
        }
        var existing = lastFuelSeconds();
        if (existing == null || timestamp >= (existing as Number)) {
            Storage.setValue(LAST_FUEL_KEY, timestamp);
        }
        Storage.setValue(LAST_SYNC_KEY, now);
        Storage.setValue(STATUS_KNOWN_KEY, true);
        return true;
    }

    function markUnavailable() as Void {
        Storage.deleteValue(LAST_FUEL_KEY);
        Storage.deleteValue(LOCAL_FUEL_KEY);
        Storage.deleteValue(LAST_SYNC_KEY);
        Storage.deleteValue(STATUS_KNOWN_KEY);
    }

    function elapsedText(elapsed as Number) as String {
        if (elapsed < 60) {
            return "just now";
        }
        var minutes = elapsed / 60;
        var hours = minutes / 60;
        var days = hours / 24;
        if (days >= 1) {
            return Lang.format("$1$d $2$h ago", [days, hours % 24]);
        }
        if (hours >= 1) {
            return Lang.format("$1$h $2$m ago", [hours, minutes % 60]);
        }
        return Lang.format("$1$m ago", [minutes]);
    }

    function metric() as String {
        if (!statusKnown()) {
            return "Open Fuel Guard";
        }
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null) {
            return "No fuel logged";
        }
        var elapsed = nowSeconds() - (lastFuel as Number);
        return elapsed < 60 ? "Fuelled just now" : elapsedText(elapsed);
    }

    function label() as String {
        if (!statusKnown()) {
            return "to sync";
        }
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null || nowSeconds() - (lastFuel as Number) < 60) {
            return "";
        }
        return "Last fuel";
    }

    function summary() as String {
        if (!statusKnown()) {
            return "Open FG to sync";
        }
        var lastFuel = lastFuelSeconds();
        if (lastFuel == null) {
            return "No fuel logged";
        }
        var elapsed = nowSeconds() - (lastFuel as Number);
        if (elapsed < 60) {
            return "Fuelled just now";
        }
        return "Last fuel: " + elapsedText(elapsed);
    }

    (:debug)
    function resetForTest() as Void {
        Storage.deleteValue(LAST_FUEL_KEY);
        Storage.deleteValue(LOCAL_FUEL_KEY);
        Storage.deleteValue(LAST_SYNC_KEY);
        Storage.deleteValue(STATUS_KNOWN_KEY);
    }

    (:debug)
    function setStatusForTest(lastFuel as Number?, syncedAt as Number) as Void {
        Storage.deleteValue(LOCAL_FUEL_KEY);
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
    function localFuelSecondsForTest() as Number? {
        return localFuelSeconds();
    }

    (:debug)
    function statusKnownForTest() as Boolean {
        return statusKnown();
    }
}
