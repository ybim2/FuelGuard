import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

class FuelGuardQuickLogView extends WatchUi.View {
    private const ACTION_COUNT = 4;
    private const ACTION_HYDRATION = 1;
    private const ACTION_SLEEPY = 2;
    private const ACTION_TRAINING = 3;

    private var _selection as Number = 0;
    private var _confirmStartedAt as Number?;
    private var _confirmType as String = FuelGuardEvents.TYPE_FUEL;
    private var _confirmationTimer as Timer.Timer?;
    private var _syncStatusTimer as Timer.Timer?;

    public function initialize() {
        View.initialize();
    }

    public function onShow() as Void {
        FuelGuardConnection.configure(FuelGuardConnection.APP_QUICK_LOG);
        FuelGuardConnection.registerForOAuthMessages();
        if (FuelGuardConnection.connected()) {
            FuelGuardApi.trySync(true);
            FuelGuardTraining.refresh(true);
            FuelGuardHealth.maybeCollectAndSync("open");
        }
    }

    public function onHide() as Void {
        cancelConfirmationTimer();
        cancelSyncStatusTimer();
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
        if (_selection == ACTION_TRAINING) {
            FuelGuardTraining.toggle();
            FuelGuardFeedback.vibrate();
            WatchUi.requestUpdate();
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
        return confirmationFirstLine();
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

    private function cancelSyncStatusTimer() as Void {
        if (_syncStatusTimer != null) {
            (_syncStatusTimer as Timer.Timer).stop();
            _syncStatusTimer = null;
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

    public function finishSyncStatus() as Void {
        FuelGuardApi.clearSyncSummary();
        cancelSyncStatusTimer();
        WatchUi.requestUpdate();
    }

    private function updateSyncStatusTimer() as Void {
        if (FuelGuardApi.syncSummaryVisible()) {
            if (_syncStatusTimer == null && Timer has :Timer) {
                _syncStatusTimer = new Timer.Timer();
                (_syncStatusTimer as Timer.Timer).start(method(:finishSyncStatus), FuelGuardApi.SYNC_SUMMARY_SECONDS * 1000, false);
            }
        } else if (!FuelGuardApi.syncActive()) {
            cancelSyncStatusTimer();
        }
    }

    private function selectedRowCount() as Number {
        return 1;
    }

    private function labelForSelection(index as Number) as String {
        if (index == ACTION_TRAINING) {
            var pendingAction = FuelGuardTraining.pendingAction();
            if (pendingAction.length() > 0) {
                if (FuelGuardTraining.transitionFailed()) {
                    return pendingAction.equals("start") ? "Retry Start" : "Retry End";
                }
                return pendingAction.equals("start") ? "Starting Training" : "Ending Training";
            }
            return FuelGuardTraining.active() ? "End Training" : "Start Training";
        }
        if (index == ACTION_HYDRATION) {
            return "Hydrate";
        }
        if (index == ACTION_SLEEPY) {
            return "Sleepy";
        }
        return "Fuel";
    }

    private function contentWidth(dc as Graphics.Dc) as Number {
        var width = dc.getWidth() - 56;
        if (width < 120) {
            return dc.getWidth() - 36;
        }
        return width;
    }

    private function fitText(dc as Graphics.Dc, text as String, font) as String {
        var maxWidth = contentWidth(dc);
        if (dc.getTextWidthInPixels(text, font) <= maxWidth) {
            return text;
        }
        var suffix = "...";
        var keep = text.length();
        while (keep > 0) {
            var candidate = text.substring(0, keep) + suffix;
            if (dc.getTextWidthInPixels(candidate, font) <= maxWidth) {
                return candidate;
            }
            keep -= 1;
        }
        return "";
    }

    private function drawCenter(dc as Graphics.Dc, y as Number, font, text as String, color) as Void {
        dc.setColor(color, Graphics.COLOR_BLACK);
        dc.drawText(dc.getWidth() / 2, y, font, fitText(dc, text, font), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    private function pendingText() as String? {
        if (FuelGuardTraining.transitionPending()) {
            return FuelGuardTraining.statusText();
        }
        var status = FuelGuardApi.syncStatusText();
        if (status != null) {
            return status as String;
        }
        return null;
    }

    private function typeForSelection(index as Number) as String {
        if (index == ACTION_TRAINING) {
            var pendingAction = FuelGuardTraining.pendingAction();
            if (pendingAction.length() > 0) {
                return pendingAction.equals("start") ? "training_start" : "training_end";
            }
            return FuelGuardTraining.active() ? "training_end" : "training_start";
        }
        if (index == ACTION_HYDRATION) {
            return FuelGuardEvents.TYPE_HYDRATION;
        }
        if (index == ACTION_SLEEPY) {
            return FuelGuardEvents.TYPE_SLEEPY;
        }
        return FuelGuardEvents.TYPE_FUEL;
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        if (FuelGuardConnection.connected()) {
            FuelGuardApi.trySync(false);
            FuelGuardTraining.refresh(false);
            FuelGuardHealth.maybeCollectAndSync("refresh");
        }

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();
        var center = width / 2;
        var syncText = pendingText();

        if (!FuelGuardConnection.connected()) {
            drawCenter(dc, 28, Graphics.FONT_SMALL, "Fuel Guard", Graphics.COLOR_GREEN);
            drawCenter(dc, height / 2 - 14, Graphics.FONT_XTINY, "Connect", Graphics.COLOR_WHITE);
            drawCenter(dc, height / 2 + 14, Graphics.FONT_XTINY, "Press START", Graphics.COLOR_LT_GRAY);
            if (syncText != null) {
                drawCenter(dc, height - 34, Graphics.FONT_XTINY, syncText as String, Graphics.COLOR_LT_GRAY);
            }
            updateSyncStatusTimer();
            return;
        }

        if (confirming()) {
            drawCenter(dc, height / 2 - 28, Graphics.FONT_SMALL, confirmationFirstLine(), Graphics.COLOR_GREEN);
            drawCenter(dc, height / 2 + 2, Graphics.FONT_SMALL, confirmationSecondLine(), Graphics.COLOR_GREEN);
            if (syncText != null) {
                drawCenter(dc, height / 2 + 42, Graphics.FONT_XTINY, syncText as String, Graphics.COLOR_LT_GRAY);
            }
            updateSyncStatusTimer();
            return;
        }

        var metricY = height >= 320 ? 68 : 58;
        var metricLabelY = metricY + 26;
        var footerY = height - (height < 230 ? 24 : 34);
        drawCenter(dc, 24, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
        drawCenter(dc, metricY, Graphics.FONT_SMALL, FuelGuardFeedback.elapsedFuelMetric(), Graphics.COLOR_WHITE);
        drawCenter(dc, metricLabelY, Graphics.FONT_XTINY, FuelGuardFeedback.elapsedFuelLabel(), Graphics.COLOR_LT_GRAY);

        var rowWidth = width - 92;
        if (rowWidth < 132) {
            rowWidth = width - 68;
        }
        var rowLeft = (width - rowWidth) / 2;
        var actionTop = metricLabelY + 38;
        var actionBottom = footerY - 28;
        var rowGap = (actionBottom - actionTop) / (ACTION_COUNT - 1);
        if (rowGap < 24) {
            rowGap = 24;
        } else if (rowGap > 48) {
            rowGap = 48;
        }
        var actionHeight = rowGap * (ACTION_COUNT - 1);
        var firstRowY = ((actionTop + actionBottom) - actionHeight) / 2;
        var rowHeight = height < 230 ? 22 : 26;
        for (var i = 0; i < ACTION_COUNT; i++) {
            var y = firstRowY + (i * rowGap);
            var selected = i == _selection;
            if (selected) {
                dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
                dc.fillRectangle(rowLeft, y - (rowHeight / 2), rowWidth, rowHeight);
                dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_GREEN);
            } else {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
            }
            dc.drawText(center, y, Graphics.FONT_XTINY, fitText(dc, labelForSelection(i), Graphics.FONT_XTINY), Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        if (syncText != null) {
            drawCenter(dc, footerY, Graphics.FONT_XTINY, syncText as String, Graphics.COLOR_LT_GRAY);
        } else {
            drawCenter(dc, footerY, Graphics.FONT_XTINY, "Press START", Graphics.COLOR_LT_GRAY);
        }
        updateSyncStatusTimer();
    }

    private function confirmationFirstLine() as String {
        return FuelGuardFeedback.confirmationFirstLine(_confirmType);
    }

    private function confirmationSecondLine() as String {
        return FuelGuardFeedback.confirmationSecondLine(_confirmType);
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
