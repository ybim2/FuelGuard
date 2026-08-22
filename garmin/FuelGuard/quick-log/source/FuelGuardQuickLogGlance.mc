import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class FuelGuardQuickLogGlance extends WatchUi.GlanceView {
    public function initialize() {
        GlanceView.initialize();
    }

    private function contentWidth(dc as Graphics.Dc) as Number {
        var width = dc.getWidth() - 24;
        if (width < 80) {
            return dc.getWidth() - 12;
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

    (:debug)
    public function metricForTest() as String {
        return FuelGuardGlanceState.metric();
    }

    (:debug)
    public function labelForTest() as String {
        return FuelGuardGlanceState.label();
    }

    (:debug)
    public function summaryForTest() as String {
        return FuelGuardGlanceState.summary();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var height = dc.getHeight();
        var summary = "Open FG to sync";
        try {
            summary = FuelGuardGlanceState.connected()
                ? FuelGuardGlanceState.summary()
                : "Connect Fuel Guard";
        } catch (e) {
            summary = "Open FG to sync";
        }
        var titleY = height / 2 - 13;
        var summaryY = height / 2 + 13;
        var summaryFont = summary.length() > 20 || dc.getWidth() < 140 ? Graphics.FONT_XTINY : Graphics.FONT_SMALL;

        drawCenter(dc, titleY, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
        drawCenter(dc, summaryY, summaryFont, summary, Graphics.COLOR_WHITE);
    }
}
