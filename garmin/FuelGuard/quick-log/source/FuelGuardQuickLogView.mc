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
    private const PENDING_INPUT_LOCK_SECONDS = 1;

    private var _selection as Number = 0;
    private var _confirmStartedAt as Number?;
    private var _confirmType as String = FuelGuardEvents.TYPE_FUEL;
    private var _confirmationTimer as Timer.Timer?;
    private var _syncStatusTimer as Timer.Timer?;
    private var _pendingEventId as String?;
    private var _pendingStartedAt as Number?;

    public function initialize() {
        View.initialize();
    }

    public function onShow() as Void {
        recoverRuntime();
    }

    public function onHide() as Void {
        cancelConfirmationTimer();
        cancelSyncStatusTimer();
    }

    public function move(delta as Number) as Void {
        try {
            if (FuelGuardDiagnostics.hasError() || confirming() || !FuelGuardConnection.connected()) {
                return;
            }
            _selection = (_selection + delta + ACTION_COUNT) % ACTION_COUNT;
            WatchUi.requestUpdate();
        } catch (e) {
            FuelGuardDiagnostics.report("QL-STATE-07", "change selection", e);
        }
    }

    public function beginConnection() as Void {
        try {
            FuelGuardConnection.beginAuth();
        } catch (e) {
            FuelGuardDiagnostics.report("QL-CONNECT-04", "begin connection", e);
        }
    }

    public function logSelection() as Void {
        if (FuelGuardDiagnostics.hasError()) {
            recoverRuntime();
            return;
        }
        try {
            if (confirming() || pendingInputLocked()) {
                return;
            }
            if (!FuelGuardConnection.connected()) {
                beginConnection();
                return;
            }
            if (_selection == ACTION_TRAINING) {
                FuelGuardTraining.toggle();
                WatchUi.requestUpdate();
                return;
            }
            var eventType = typeForSelection(_selection);
            var event = FuelGuardEvents.create(eventType);
            var eventId = FuelGuardQueue.externalEventId(event);
            FuelGuardQueue.enqueue(event);
            if (FuelGuardDiagnostics.hasError()) {
                WatchUi.requestUpdate();
                return;
            }
            if (eventType.equals(FuelGuardEvents.TYPE_FUEL)) {
                var localFuelAt = event["logged_at_seconds"];
                if (localFuelAt instanceof Number) {
                    FuelGuardGlanceState.recordLocalFuel(localFuelAt as Number);
                }
            }
            _confirmType = eventType;
            _pendingEventId = eventId != null ? eventId as String : null;
            _pendingStartedAt = Time.now().value();
            _confirmStartedAt = _pendingStartedAt;
            FuelGuardFeedback.vibrateSuccess();
            startConfirmationTimer();
            FuelGuardApi.trySync(true);
            FuelGuardHealth.maybeCollectAndSync("fuel_log");
            updateAcknowledgedConfirmation();
            WatchUi.requestUpdate();
        } catch (e) {
            FuelGuardDiagnostics.report("QL-STATE-08", "log selection", e);
        }
    }

    private function recoverRuntime() as Void {
        FuelGuardDiagnostics.clearCurrent();
        try {
            FuelGuardConnection.configure(FuelGuardConnection.APP_QUICK_LOG);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-START-01", "configure Quick Logger", e);
            return;
        }
        if (FuelGuardDiagnostics.hasError()) {
            return;
        }
        if (!FuelGuardConnection.registerForOAuthMessages()) {
            return;
        }
        try {
            FuelGuardQueue.pendingCount();
            FuelGuardTraining.validateStoredState();
            FuelGuardHealthSettings.validateStoredState();
            if (FuelGuardConnection.connected()) {
                FuelGuardApi.trySync(true);
                FuelGuardTraining.refresh(true);
                FuelGuardHealth.maybeCollectAndSync("open");
            }
        } catch (e) {
            FuelGuardDiagnostics.report("QL-START-02", "restore Quick Logger state", e);
        }
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

    (:debug)
    public function pendingEventIdForTest() as String? {
        return _pendingEventId;
    }

    private function confirming() as Boolean {
        return FuelGuardFeedback.confirmationActive(_confirmStartedAt);
    }

    private function pendingInputLocked() as Boolean {
        return _pendingEventId != null
            && _pendingStartedAt != null
            && Time.now().value() - (_pendingStartedAt as Number) < PENDING_INPUT_LOCK_SECONDS;
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

    private function updateAcknowledgedConfirmation() as Void {
        if (_pendingEventId == null || !FuelGuardApi.eventAcknowledged(_pendingEventId)) {
            return;
        }
        var acknowledgedType = FuelGuardApi.acknowledgedType();
        if (acknowledgedType != null) {
            _confirmType = acknowledgedType as String;
        }
        _pendingEventId = null;
        _pendingStartedAt = null;
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

    private function drawErrorState(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var height = dc.getHeight();
        drawCenter(dc, 26, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
        drawCenter(dc, height / 2 - 42, Graphics.FONT_XTINY, FuelGuardDiagnostics.title(), Graphics.COLOR_WHITE);
        drawCenter(dc, height / 2 - 10, Graphics.FONT_XTINY, FuelGuardDiagnostics.message(), Graphics.COLOR_LT_GRAY);
        drawCenter(dc, height / 2 + 24, Graphics.FONT_XTINY, "Error: " + FuelGuardDiagnostics.code(), Graphics.COLOR_LT_GRAY);
        drawCenter(dc, height - 28, Graphics.FONT_XTINY, "Press START to retry", Graphics.COLOR_GREEN);
    }

    private function refreshRuntime() as Void {
        try {
            if (FuelGuardConnection.connected()) {
                FuelGuardApi.trySync(false);
                FuelGuardTraining.refresh(false);
                FuelGuardHealth.maybeCollectAndSync("refresh");
            }
            updateAcknowledgedConfirmation();
        } catch (e) {
            FuelGuardDiagnostics.report("QL-API-04", "refresh connected view", e);
        }
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        if (!FuelGuardDiagnostics.hasError()) {
            refreshRuntime();
        }
        if (FuelGuardDiagnostics.hasError()) {
            drawErrorState(dc);
            return;
        }
        try {
            drawNormal(dc);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-START-03", "render Quick Logger", e);
            drawErrorState(dc);
        }
    }

    private function drawNormal(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var height = dc.getHeight();
        var center = width / 2;
        var syncText = pendingText();

        if (!FuelGuardConnection.connected()) {
            drawCenter(dc, 28, Graphics.FONT_SMALL, "Fuel Guard", Graphics.COLOR_GREEN);
            drawCenter(dc, height / 2 - 24, Graphics.FONT_XTINY, "Disconnected", Graphics.COLOR_LT_GRAY);
            drawCenter(dc, height / 2 + 2, Graphics.FONT_XTINY, "Connect Fuel Guard", Graphics.COLOR_WHITE);
            drawCenter(dc, height / 2 + 28, Graphics.FONT_XTINY, "Press START", Graphics.COLOR_LT_GRAY);
            if (syncText != null) {
                drawCenter(dc, height - 34, Graphics.FONT_XTINY, syncText as String, Graphics.COLOR_LT_GRAY);
            }
            updateSyncStatusTimer();
            return;
        }

        if (FuelGuardTraining.completionActive()) {
            FuelGuardFeedback.drawSuccessMark(dc, center, height / 2 - 34, height < 230 ? 16 : 21);
            drawCenter(dc, height / 2 + 8, Graphics.FONT_XTINY, "TRAINING COMPLETE", Graphics.COLOR_GREEN);
            var completionDuration = FuelGuardTraining.completionDurationText();
            if (completionDuration.length() > 0) {
                drawCenter(dc, height / 2 + 34, Graphics.FONT_XTINY, completionDuration, Graphics.COLOR_LT_GRAY);
            }
            updateSyncStatusTimer();
            return;
        }

        if (confirming()) {
            FuelGuardFeedback.drawSuccessMark(dc, center, height / 2 - 30, height < 230 ? 16 : 21);
            drawCenter(dc, height / 2 + 10, Graphics.FONT_XTINY, confirmationFirstLine() + " " + confirmationSecondLine(), Graphics.COLOR_GREEN);
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

    private function activateKey(key as WatchUi.Key) as Boolean {
        if (FuelGuardConnection.isConnectActionKey(key)) {
            _view.logSelection();
            return true;
        }
        return false;
    }

    public function onKey(keyEvent as WatchUi.KeyEvent) as Boolean {
        return activateKey(keyEvent.getKey());
    }

    (:debug)
    public function activateKeyForTest(key as WatchUi.Key) as Boolean {
        return activateKey(key);
    }

    public function onBack() as Boolean {
        return false;
    }
}
