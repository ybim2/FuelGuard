import Toybox.Application;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class FuelGuardQuickLogApp extends Application.AppBase {
    public function initialize() {
        AppBase.initialize();
    }

    public function onStart(state as Dictionary?) as Void {
        FuelGuardDiagnostics.beginLaunch();
    }

    public function onAuthenticationRequest() as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_QUICK_LOG);
        FuelGuardConnection.registerForOAuthMessages();
    }

    public function onStop(state as Dictionary?) as Void {
    }

    public function getInitialView() as [Views] or [Views, InputDelegates] {
        var view = new $.FuelGuardQuickLogView();
        return [view, new $.FuelGuardQuickLogDelegate(view)];
    }

    public function getGlanceView() as [WatchUi.GlanceView] or [WatchUi.GlanceView, WatchUi.GlanceViewDelegate] or Null {
        return [new $.FuelGuardQuickLogGlance()];
    }
}
