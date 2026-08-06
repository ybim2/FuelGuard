import Toybox.Lang;
import Toybox.Test;

(:test)
function testFuelGuardQuickLogSelectionCreatesEvents(logger) as Boolean {
    var view = new FuelGuardQuickLogView();
    var pendingBefore = FuelGuardQueue.pendingCount();

    view.logSelection();
    if (!view.isConfirming()) {
        return false;
    }

    view.finishConfirmation();
    view.move(1);
    view.logSelection();
    if (!view.isConfirming()) {
        return false;
    }

    view.finishConfirmation();
    view.move(1);
    view.logSelection();
    if (!view.isConfirming()) {
        return false;
    }

    return FuelGuardQueue.pendingCount() >= pendingBefore + 3;
}
