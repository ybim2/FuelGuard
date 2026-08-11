import Toybox.Activity;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class FuelGuardActivityLoggerField extends WatchUi.DataField {
    private var _confirmStartedAt as Number?;
    private var _pendingEventId as String?;
    private var _handlingLap as Boolean = false;

    public function initialize() {
        DataField.initialize();
        _confirmStartedAt = null;
    }

    public function compute(info as Activity.Info) as Void {
    }

    (:debug)
    public function isConfirmingForTest() as Boolean {
        return FuelGuardFeedback.confirmationActive(_confirmStartedAt);
    }

    (:debug)
    public function pendingEventIdForTest() as String? {
        return _pendingEventId;
    }

    public function onTimerLap() as Void {
        if (_handlingLap) {
            return;
        }
        _handlingLap = true;

        var event = FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL);
        var eventId = FuelGuardQueue.externalEventId(event);
        FuelGuardQueue.enqueue(event);
        _pendingEventId = eventId != null ? eventId as String : null;
        FuelGuardApi.trySync(true);
        updateAcknowledgedConfirmation();
        WatchUi.requestUpdate();

        _handlingLap = false;
    }

    private function updateAcknowledgedConfirmation() as Void {
        if (_pendingEventId == null || !FuelGuardApi.eventAcknowledged(_pendingEventId)) {
            return;
        }
        _pendingEventId = null;
        _confirmStartedAt = Time.now().value();
        FuelGuardFeedback.vibrateSuccess();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_ACTIVITY_LOGGER);
        if (FuelGuardConnection.connected()) {
            FuelGuardApi.trySync(false);
            FuelGuardTraining.refresh(false);
        }
        updateAcknowledgedConfirmation();

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();
        var smallLayout = height < 90 || width < 120;

        if (FuelGuardFeedback.confirmationActive(_confirmStartedAt)) {
            FuelGuardFeedback.drawSuccessMark(dc, width / 2, height / 2 - (smallLayout ? 5 : 13), smallLayout ? 8 : 12);
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
            dc.drawText(width / 2, smallLayout ? height - 14 : height / 2 + 16, Graphics.FONT_XTINY, "FUEL LOGGED", Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(width / 2, smallLayout ? 4 : 8, Graphics.FONT_XTINY, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);

        if (!FuelGuardConnection.connected()) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
            dc.drawText(width / 2, smallLayout ? height / 2 - 10 : height / 2 - 14, Graphics.FONT_XTINY, "Connect settings", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(width / 2, smallLayout ? height - 18 : height - 24, Graphics.FONT_XTINY, Lang.format("$1$ pending", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.drawText(width / 2, smallLayout ? height / 2 - 8 : height / 2 - 12, smallLayout ? Graphics.FONT_XTINY : Graphics.FONT_SMALL, FuelGuardFeedback.elapsedFuelText(), Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
        var pendingCount = FuelGuardQueue.pendingCount();
        var pendingText = pendingCount > 0
            ? FuelGuardApi.savedSyncPendingText()
            : "Synced";
        dc.drawText(width / 2, smallLayout ? height - 18 : height - 24, Graphics.FONT_XTINY, pendingText, Graphics.TEXT_JUSTIFY_CENTER);
    }
}
