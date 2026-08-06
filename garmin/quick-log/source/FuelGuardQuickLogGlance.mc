import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class FuelGuardQuickLogGlance extends WatchUi.GlanceView {
    public function initialize() {
        GlanceView.initialize();
    }

    private function drawCenter(dc as Graphics.Dc, y as Number, font, text as String, color) as Void {
        dc.setColor(color, Graphics.COLOR_BLACK);
        dc.drawText(dc.getWidth() / 2, y, font, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    (:debug)
    public function metricForTest() as String {
        return FuelGuardGlanceState.metric();
    }

    (:debug)
    public function labelForTest() as String {
        return FuelGuardGlanceState.label();
    }

    (:debug)
    public function countLabelForTest() as String {
        return FuelGuardGlanceState.countLabel();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var height = dc.getHeight();
        var metric = "Ready to log";
        var label = "";
        var count = "";

        try {
            metric = FuelGuardGlanceState.metric();
            label = FuelGuardGlanceState.label();
            count = FuelGuardGlanceState.countLabel();
        } catch (e) {
            metric = "Ready to log";
            label = "";
            count = "";
        }

        if (label.length() == 0) {
            drawCenter(dc, height / 2 - 18, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
            drawCenter(dc, height / 2 + 12, Graphics.FONT_XTINY, metric, Graphics.COLOR_WHITE);
            return;
        }

        var titleY = height < 100 ? 12 : height / 2 - 42;
        var metricY = height < 100 ? 38 : height / 2 - 12;
        var labelY = height < 100 ? 60 : height / 2 + 14;
        var countY = height < 100 ? height - 12 : height / 2 + 38;

        drawCenter(dc, titleY, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
        drawCenter(dc, metricY, Graphics.FONT_SMALL, metric, Graphics.COLOR_WHITE);
        drawCenter(dc, labelY, Graphics.FONT_XTINY, label, Graphics.COLOR_LT_GRAY);
        drawCenter(dc, countY, Graphics.FONT_XTINY, count, Graphics.COLOR_LT_GRAY);
    }
}
