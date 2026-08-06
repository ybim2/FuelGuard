import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

class FuelGuardActivityLoggerApp extends Application.AppBase {
    public function initialize() {
        AppBase.initialize();
    }

    public function onStart(state as Dictionary?) as Void {
    }

    public function onStop(state as Dictionary?) as Void {
    }

    public function getInitialView() as [Views] or [Views, InputDelegates] {
        return [new $.FuelGuardActivityLoggerField()];
    }
}
