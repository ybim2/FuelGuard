import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class FuelGuardQuickLogGlance extends WatchUi.GlanceView {
    public function initialize() {
        GlanceView.initialize();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        FuelGuardApi.trySync(false);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var center = dc.getWidth() / 2;
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(center, 8, Graphics.FONT_XTINY, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.drawText(center, 32, Graphics.FONT_XTINY, FuelGuardFeedback.elapsedFuelText(), Graphics.TEXT_JUSTIFY_CENTER);
        var pending = FuelGuardQueue.pendingCount();
        if (pending > 0) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_BLACK);
            dc.drawText(center, 56, Graphics.FONT_XTINY, Lang.format("Pending $1$", [pending]), Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}
