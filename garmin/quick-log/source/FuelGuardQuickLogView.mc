import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

class FuelGuardQuickLogView extends WatchUi.View {
    private const ACTION_COUNT = 3;
    private const ACTION_HYDRATION = 1;
    private const ACTION_FUEL_HYDRATION = 2;

    private var _selection as Number = 0;
    private var _confirmStartedAt as Number?;
    private var _confirmType as String = FuelGuardEvents.TYPE_FUEL;
    private var _confirmationTimer as Timer.Timer?;

    public function initialize() {
        View.initialize();
    }

    public function onShow() as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_QUICK_LOG);
        FuelGuardConnection.registerForOAuthMessages();
        if (FuelGuardConnection.connected()) {
            FuelGuardApi.trySync(true);
            FuelGuardHealth.maybeCollectAndSync("open");
        }
    }

    public function onHide() as Void {
        cancelConfirmationTimer();
    }

    public function move(delta as Number) as Void {
        if (confirming() || !FuelGuardConnection.connected()) {
            return;
        }
        _selection = (_selection + delta + ACTION_COUNT) % ACTION_COUNT;
        WatchUi.requestUpdate();
    }

    public function beginConnection() as Void {
        FuelGuardConnection.beginAuth();
    }

    public function logSelection() as Void {
        if (confirming()) {
            return;
        }
        if (!FuelGuardConnection.connected()) {
            beginConnection();
            return;
        }
        var eventType = typeForSelection(_selection);
        var event = FuelGuardEvents.create(eventType);
        FuelGuardQueue.enqueue(event);
        _confirmStartedAt = Time.now().value();
        _confirmType = eventType;
        FuelGuardFeedback.vibrate();
        FuelGuardApi.trySync(true);
        FuelGuardHealth.maybeCollectAndSync("fuel_log");
        startConfirmationTimer();
        WatchUi.requestUpdate();
    }

    public function selectedIndex() as Number {
        return _selection;
    }

    public function isConfirming() as Boolean {
        return confirming();
    }

    (:debug)
    public function selectedTypeForTest() as String {
        return typeForSelection(_selection);
    }

    (:debug)
    public function selectedLabelForTest() as String {
        return labelForSelection(_selection);
    }

    (:debug)
    public function selectedRowCountForTest() as Number {
        return selectedRowCount();
    }

    (:debug)
    public function confirmationTypeForTest() as String {
        return _confirmType;
    }

    (:debug)
    public function confirmationFirstLineForTest() as String {
        return FuelGuardFeedback.confirmationFirstLine(_confirmType);
    }

    private function confirming() as Boolean {
        return FuelGuardFeedback.confirmationActive(_confirmStartedAt);
    }

    private function cancelConfirmationTimer() as Void {
        if (_confirmationTimer != null) {
            (_confirmationTimer as Timer.Timer).stop();
            _confirmationTimer = null;
        }
    }

    private function startConfirmationTimer() as Void {
        cancelConfirmationTimer();
        if (Timer has :Timer) {
            _confirmationTimer = new Timer.Timer();
            (_confirmationTimer as Timer.Timer).start(method(:finishConfirmation), FuelGuardFeedback.CONFIRM_SECONDS * 1000, false);
        }
    }

    public function finishConfirmation() as Void {
        _confirmStartedAt = null;
        cancelConfirmationTimer();
        WatchUi.requestUpdate();
    }

    private function selectedRowCount() as Number {
        return 1;
    }

    private function labelForSelection(index as Number) as String {
        if (index == ACTION_HYDRATION) {
            return "Hydration";
        }
        if (index == ACTION_FUEL_HYDRATION) {
            return "Fuel + Water";
        }
        return "Fuel";
    }

    private function typeForSelection(index as Number) as String {
        if (index == ACTION_HYDRATION) {
            return FuelGuardEvents.TYPE_HYDRATION;
        }
        if (index == ACTION_FUEL_HYDRATION) {
            return FuelGuardEvents.TYPE_FUEL_HYDRATION;
        }
        return FuelGuardEvents.TYPE_FUEL;
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        if (FuelGuardConnection.connected()) {
            FuelGuardApi.trySync(false);
            FuelGuardHealth.maybeCollectAndSync("refresh");
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();
        var center = width / 2;

        if (!FuelGuardConnection.connected()) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
            dc.drawText(center, 22, Graphics.FONT_SMALL, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
            dc.drawText(center, height / 2 - 24, Graphics.FONT_XTINY, "Connect Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(center, height / 2 + 4, Graphics.FONT_XTINY, "ENTER to connect", Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(center, height - 32, Graphics.FONT_XTINY, Lang.format("Pending $1$", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        if (confirming()) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
            dc.drawText(center, height / 2 - 36, Graphics.FONT_SMALL, FuelGuardFeedback.confirmationFirstLine(_confirmType), Graphics.TEXT_JUSTIFY_CENTER);
            dc.drawText(center, height / 2 - 6, Graphics.FONT_SMALL, FuelGuardFeedback.confirmationSecondLine(_confirmType), Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(center, height / 2 + 36, Graphics.FONT_XTINY, Lang.format("Pending $1$", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(center, 22, Graphics.FONT_SMALL, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
        dc.drawText(center, 48, Graphics.FONT_XTINY, "Connected", Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(center, 68, Graphics.FONT_XTINY, FuelGuardFeedback.elapsedFuelText(), Graphics.TEXT_JUSTIFY_CENTER);

        var rowWidth = width - 64;
        var rowLeft = (width - rowWidth) / 2;
        var firstRowY = 100;
        var rowGap = 36;
        var rowHeight = 28;
        for (var i = 0; i < ACTION_COUNT; i++) {
            var y = firstRowY + (i * rowGap);
            var selected = i == _selection;
            if (selected) {
                dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
                dc.fillRectangle(rowLeft, y - 15, rowWidth, rowHeight);
                dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_GREEN);
            } else {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
            }
            dc.drawText(center, y - 8, Graphics.FONT_XTINY, labelForSelection(i), Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
        dc.drawText(center, height - 32, Graphics.FONT_XTINY, Lang.format("Pending $1$  ENTER logs", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class FuelGuardQuickLogDelegate extends WatchUi.BehaviorDelegate {
    private var _view as FuelGuardQuickLogView;

    public function initialize(view as FuelGuardQuickLogView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    public function onPreviousPage() as Boolean {
        _view.move(-1);
        return true;
    }

    public function onNextPage() as Boolean {
        _view.move(1);
        return true;
    }

    public function onSelect() as Boolean {
        _view.logSelection();
        return true;
    }

    public function onBack() as Boolean {
        return false;
    }
}
