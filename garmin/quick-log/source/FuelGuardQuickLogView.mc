import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class FuelGuardQuickLogView extends WatchUi.View {
    private const ACTIONS = [
        { :label => "Fuel", :type => FuelGuardEvents.TYPE_FUEL },
        { :label => "Hydration", :type => FuelGuardEvents.TYPE_HYDRATION },
        { :label => "Fuel + Water", :type => FuelGuardEvents.TYPE_FUEL_HYDRATION }
    ];

    private var _selection as Number = 0;
    private var _confirmStartedAt as Number?;
    private var _confirmText as String = "";

    public function initialize() {
        View.initialize();
    }

    public function onShow() as Void {
        FuelGuardApi.trySync(true);
    }

    public function move(delta as Number) as Void {
        _selection = (_selection + delta + ACTIONS.size()) % ACTIONS.size();
        WatchUi.requestUpdate();
    }

    public function logSelection() as Void {
        var action = ACTIONS[_selection];
        var event = FuelGuardEvents.create(action[:type]);
        FuelGuardQueue.enqueue(event);
        _confirmStartedAt = Time.now().value();
        _confirmText = FuelGuardFeedback.eventConfirmation(action[:type]);
        FuelGuardFeedback.vibrate();
        FuelGuardApi.trySync(true);
        WatchUi.requestUpdate();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        FuelGuardApi.trySync(false);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var width = dc.getWidth();
        var center = width / 2;

        if (FuelGuardFeedback.confirmationActive(_confirmStartedAt)) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
            dc.drawText(center, 102, Graphics.FONT_SMALL, _confirmText, Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
            dc.drawText(center, 168, Graphics.FONT_XTINY, Lang.format("Pending $1$", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
            return;
        }

        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(center, 28, Graphics.FONT_SMALL, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
        dc.drawText(center, 54, Graphics.FONT_XTINY, FuelGuardFeedback.elapsedFuelText(), Graphics.TEXT_JUSTIFY_CENTER);

        for (var i = 0; i < ACTIONS.size(); i++) {
            var y = 96 + (i * 38);
            var selected = i == _selection;
            dc.setColor(selected ? Graphics.COLOR_BLACK : Graphics.COLOR_WHITE, selected ? Graphics.COLOR_GREEN : Graphics.COLOR_BLACK);
            dc.fillRectangle(46, y - 16, width - 92, 30);
            dc.drawText(center, y - 9, Graphics.FONT_XTINY, ACTIONS[i][:label], Graphics.TEXT_JUSTIFY_CENTER);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_BLACK);
        dc.drawText(center, 224, Graphics.FONT_XTINY, Lang.format("Pending $1$  ENTER logs", [FuelGuardQueue.pendingCount()]), Graphics.TEXT_JUSTIFY_CENTER);
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
