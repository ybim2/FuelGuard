import Toybox.Application.Properties;
import Toybox.Application.Storage;
import Toybox.Lang;
import Toybox.Time;

module FuelGuardHealthSettings {
    const SHARE_PROPERTY_KEY = "shareHealthPatterns";
    const CLEAR_PROPERTY_KEY = "clearHealthPatterns";
    const LAST_COLLECTION_KEY = "fg_health_last_collection";
    const COLLECTION_COOLDOWN_SECONDS = 45 * 60;

    function booleanProperty(key as String) as Boolean {
        try {
            var value = Properties.getValue(key);
            return value instanceof Boolean ? value as Boolean : false;
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
        return value instanceof Number ? value as Number : 0;
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
}
