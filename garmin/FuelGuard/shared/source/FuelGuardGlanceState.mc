import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;

(:glance)
module FuelGuardGlanceState {
    const LAST_FUEL_KEY = "fg_last_fuel_at";
    const LAST_SYNC_KEY = "fg_last_fuel_sync_at";
    const STATUS_KNOWN_KEY = "fg_last_fuel_status_known";
    const PENDING_LOCAL_FUEL_KEY = "fg_pending_local_fuel_at";
    const MAX_STALE_SECONDS = 6 * 60 * 60;
    const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

    function nowSeconds() as Number {
        return Time.now().value();
    }

    function safeStoredValue(key as String) as Object? {
        try {
            return Storage.getValue(key);
        } catch (e) {
            return null;
        }
    }

    function storeValue(key as String, value as Object) as Boolean {
        try {
            Storage.setValue(key, value);
            return true;
        } catch (e) {
            return false;
        }
    }

    function deleteValue(key as String) as Boolean {
        try {
            Storage.deleteValue(key);
            return true;
        } catch (e) {
            return false;
        }
    }

    function safeStoredNumber(key as String) as Number? {
        var value = safeStoredValue(key);
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

    function pendingLocalFuelSeconds() as Number? {
        return safeStoredNumber(PENDING_LOCAL_FUEL_KEY);
    }

    function statusKnown() as Boolean {
        var rawFuel = safeStoredValue(LAST_FUEL_KEY);
        if (rawFuel != null && safeStoredNumber(LAST_FUEL_KEY) == null) {
            return false;
        }
        var value = safeStoredValue(STATUS_KNOWN_KEY);
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
        var pendingLocalFuel = pendingLocalFuelSeconds();
        var stored = true;
        if (lastFuel instanceof Number) {
            var safeFuel = lastFuel as Number;
            if (safeFuel <= 0 || safeFuel > nowSeconds() + MAX_CLOCK_SKEW_SECONDS) {
                return false;
            }
            if (pendingLocalFuel == null || safeFuel >= (pendingLocalFuel as Number)) {
                stored = storeValue(LAST_FUEL_KEY, safeFuel) && stored;
                stored = deleteValue(PENDING_LOCAL_FUEL_KEY) && stored;
            }
        } else if (pendingLocalFuel == null) {
            stored = deleteValue(LAST_FUEL_KEY) && stored;
        }
        stored = storeValue(LAST_SYNC_KEY, safeSync) && stored;
        stored = storeValue(STATUS_KNOWN_KEY, true) && stored;
        return stored;
    }

    function validFuelTimestamp(timestamp as Number) as Boolean {
        var now = nowSeconds();
        return timestamp > 0 && timestamp <= now + MAX_CLOCK_SKEW_SECONDS;
    }

    function recordLocalFuel(timestamp as Number) as Boolean {
        if (!validFuelTimestamp(timestamp)) {
            return false;
        }
        var existing = lastFuelSeconds();
        var stored = true;
        if (existing == null || timestamp >= (existing as Number)) {
            stored = storeValue(LAST_FUEL_KEY, timestamp) && stored;
        }
        var pending = pendingLocalFuelSeconds();
        if (pending == null || timestamp >= (pending as Number)) {
            stored = storeValue(PENDING_LOCAL_FUEL_KEY, timestamp) && stored;
        }
        stored = storeValue(STATUS_KNOWN_KEY, true) && stored;
        return stored;
    }

    function recordAcknowledgedFuel(timestamp as Number) as Boolean {
        if (!validFuelTimestamp(timestamp)) {
            return false;
        }
        var existing = lastFuelSeconds();
        var stored = true;
        if (existing == null || timestamp >= (existing as Number)) {
            stored = storeValue(LAST_FUEL_KEY, timestamp) && stored;
        }
        var pending = pendingLocalFuelSeconds();
        if (pending != null && timestamp >= (pending as Number)) {
            stored = deleteValue(PENDING_LOCAL_FUEL_KEY) && stored;
        }
        stored = storeValue(LAST_SYNC_KEY, nowSeconds()) && stored;
        stored = storeValue(STATUS_KNOWN_KEY, true) && stored;
        return stored;
    }

    function markUnavailable() as Void {
        deleteValue(LAST_FUEL_KEY);
        deleteValue(LAST_SYNC_KEY);
        deleteValue(STATUS_KNOWN_KEY);
        deleteValue(PENDING_LOCAL_FUEL_KEY);
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
        deleteValue(LAST_FUEL_KEY);
        deleteValue(LAST_SYNC_KEY);
        deleteValue(STATUS_KNOWN_KEY);
        deleteValue(PENDING_LOCAL_FUEL_KEY);
    }

    (:debug)
    function setStatusForTest(lastFuel as Number?, syncedAt as Number) as Void {
        if (lastFuel == null) {
            deleteValue(LAST_FUEL_KEY);
        } else {
            storeValue(LAST_FUEL_KEY, lastFuel as Number);
        }
        storeValue(LAST_SYNC_KEY, syncedAt);
        storeValue(STATUS_KNOWN_KEY, true);
        deleteValue(PENDING_LOCAL_FUEL_KEY);
    }

    (:debug)
    function setMalformedStateForTest() as Void {
        Storage.setValue(LAST_FUEL_KEY, "not-a-timestamp");
        Storage.setValue(LAST_SYNC_KEY, "not-a-sync-time");
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

    (:debug)
    function pendingLocalFuelSecondsForTest() as Number? {
        return pendingLocalFuelSeconds();
    }
}
