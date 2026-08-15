import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;

module FuelGuardHealthSettings {
    const SHARE_PROPERTY_KEY = "shareHealthPatterns";
    const CLEAR_PROPERTY_KEY = "clearHealthPatterns";
    const LAST_COLLECTION_KEY = "fg_health_last_collection";
    const COLLECTION_COOLDOWN_SECONDS = 45 * 60;

    function normalizedBoolean(value as Object?) as Boolean {
        return value instanceof Boolean ? value as Boolean : false;
    }

    function booleanProperty(key as String) as Boolean {
        try {
            var value = Properties.getValue(key);
            return normalizedBoolean(value);
        } catch (e) {
            return false;
        }
    }

    function sharingEnabled() as Boolean {
        return booleanProperty(SHARE_PROPERTY_KEY);
    }

    function clearRequested() as Boolean {
        return booleanProperty(CLEAR_PROPERTY_KEY);
    }

    function clearLocalData() as Void {
        FuelGuardHealthQueue.clear();
        Storage.deleteValue(LAST_COLLECTION_KEY);
        try {
            Properties.setValue(CLEAR_PROPERTY_KEY, false);
        } catch (e) {
        }
    }

    function maybeClearRequested() as Void {
        if (clearRequested()) {
            clearLocalData();
        }
    }

    function lastCollectionSeconds() as Number {
        var value = Storage.getValue(LAST_COLLECTION_KEY);
        if (!(value instanceof Number)) {
            return 0;
        }
        var seconds = value as Number;
        var now = Time.now().value();
        return seconds > 0 && seconds <= now ? seconds : 0;
    }

    function collectionStale() as Boolean {
        var last = lastCollectionSeconds();
        if (last <= 0) {
            return true;
        }
        return Time.now().value() - last >= COLLECTION_COOLDOWN_SECONDS;
    }

    function markCollected() as Void {
        Storage.setValue(LAST_COLLECTION_KEY, Time.now().value());
    }

    function validateStoredState() as Void {
        sharingEnabled();
        clearRequested();
        lastCollectionSeconds();
    }

    (:debug)
    function normalizedBooleanForTest(value as Object?) as Boolean {
        return normalizedBoolean(value);
    }
}
