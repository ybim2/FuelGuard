import Toybox.Graphics;
import Toybox.WatchUi;

(:glance)
class FuelGuardQuickLogGlance extends WatchUi.GlanceView {
    public function initialize() {
        GlanceView.initialize();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var center = dc.getWidth() / 2;
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.drawText(center, 8, Graphics.FONT_XTINY, "Fuel Guard", Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.drawText(center, 32, Graphics.FONT_XTINY, "Open to log", Graphics.TEXT_JUSTIFY_CENTER);
    }
}
