import Toybox.Activity;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class FuelGuardActivityLoggerField extends WatchUi.DataField {
    private var _confirmStartedAt as Number?;
    private var _handlingLap as Boolean = false;

    public function initialize() {
        DataField.initialize();
        _confirmStartedAt = null;
    }

    public function compute(info as Activity.Info) as Void {
    }

    public function onTimerLap() as Void {
        if (_handlingLap) {
            return;
        }
        _handlingLap = true;

        var event = FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL);
        FuelGuardQueue.enqueue(event);
        _confirmStartedAt = Time.now().value();
        FuelGuardFeedback.vibrate();
        FuelGuardApi.trySync(true);
        WatchUi.requestUpdate();

        _handlingLap = false;
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_ACTIVITY_LOGGER);
        if (FuelGuardConnection.connected()) {
            FuelGuardApi.trySync(false);
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();
        var smallLayout = height < 90 || width < 120;

        if (FuelGuardFeedback.confirmationActive(_confirmStartedAt)) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
            dc.drawText(width / 2, height / 2, smallLayout ? Graphics.FONT_XTINY : Graphics.FONT_SMALL, "FUEL LOGGED", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(width / 2, smallLayout ? 4 : 8, Graphics.FONT_XTINY, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);

        if (!FuelGuardConnection.connected()) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
            dc.drawText(width / 2, smallLayout ? height / 2 - 10 : height / 2 - 14, Graphics.FONT_XTINY, "Connect in field settings", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(width / 2, smallLayout ? height - 18 : height - 24, Graphics.FONT_XTINY, Lang.format("Pending $1$", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.drawText(width / 2, smallLayout ? height / 2 - 8 : height / 2 - 12, smallLayout ? Graphics.FONT_XTINY : Graphics.FONT_SMALL, FuelGuardFeedback.elapsedFuelText(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
        var pendingCount = FuelGuardQueue.pendingCount();
        var pendingText = pendingCount > 0
            ? FuelGuardApi.savedSyncPendingText()
            : Lang.format("Pending $1$", [pendingCount]);
        dc.drawText(width / 2, smallLayout ? height - 18 : height - 24, Graphics.FONT_XTINY, pendingText, Graphics.TEXT_JUSTIFY_CENTER);
    }
}
