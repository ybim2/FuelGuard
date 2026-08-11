import Toybox.Application;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

class FuelGuardActivityLoggerApp extends Application.AppBase {
    public function initialize() {
        AppBase.initialize();
    }

    public function onStart(state as Dictionary?) as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_ACTIVITY_LOGGER);
        FuelGuardConnection.registerForOAuthMessages();
    }

    public function onAuthenticationRequest() as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_ACTIVITY_LOGGER);
        FuelGuardConnection.registerForOAuthMessages();
    }

    public function onStop(state as Dictionary?) as Void {
    }

    public function getInitialView() as [Views] or [Views, InputDelegates] {
        return [new $.FuelGuardActivityLoggerField()];
    }

    public function getSettingsView() as [Views] or [Views, InputDelegates] or Null {
        var view = new $.FuelGuardActivityLoggerSettingsView();
        return [view, new $.FuelGuardActivityLoggerSettingsDelegate(view)];
    }
}

class FuelGuardActivityLoggerSettingsView extends WatchUi.View {
    public function initialize() {
        View.initialize();
    }

    public function onShow() as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_ACTIVITY_LOGGER);
        FuelGuardConnection.registerForOAuthMessages();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var width = dc.getWidth();
        var height = dc.getHeight();
        var center = width / 2;
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(center, 18, Graphics.FONT_XTINY, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        if (FuelGuardConnection.connected()) {
            dc.drawText(center, height / 2 - 26, Graphics.FONT_XTINY, "Connected", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(center, height / 2 + 2, Graphics.FONT_XTINY, "ENTER disconnects", Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.drawText(center, height / 2 - 26, Graphics.FONT_XTINY, "Connect Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(center, height / 2 + 2, Graphics.FONT_XTINY, "ENTER to connect", Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.drawText(center, height - 28, Graphics.FONT_XTINY, FuelGuardConnection.statusText(), Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class FuelGuardActivityLoggerSettingsDelegate extends WatchUi.BehaviorDelegate {
    public function initialize(view as FuelGuardActivityLoggerSettingsView) {
        BehaviorDelegate.initialize();
    }

    public function onSelect() as Boolean {
        if (FuelGuardConnection.connected()) {
            FuelGuardConnection.disconnect();
        } else {
            FuelGuardConnection.beginAuth();
        }
        WatchUi.requestUpdate();
        return true;
    }

    public function onBack() as Boolean {
        return false;
    }
}
