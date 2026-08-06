import Toybox.Application.Storage;
import Toybox.Lang;

module FuelGuardGlanceState {
    const LAST_FUEL_KEY = "fg_last_fuel_at";

    function recordFuel(timestamp as Number) as Void {
        Storage.setValue(LAST_FUEL_KEY, timestamp);
    }

    (:debug)
    function resetForTest() as Void {
        Storage.deleteValue(LAST_FUEL_KEY);
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
