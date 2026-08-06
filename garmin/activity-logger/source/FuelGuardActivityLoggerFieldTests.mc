import Toybox.Lang;
import Toybox.Test;

(:test)
function testFuelGuardActivityLoggerLapCreatesFuelEvent(logger) as Boolean {
    var field = new FuelGuardActivityLoggerField();
    var pendingBefore = FuelGuardQueue.pendingCount();

    field.onTimerLap();

    return FuelGuardQueue.pendingCount() >= pendingBefore + 1;
}
