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

    private function pendingText() as String? {
        var pendingCount = FuelGuardGlanceData.pendingCount();
        if (pendingCount > 0) {
            return Lang.format("$1$ pending", [pendingCount]);
        }
        return null;
    }

    (:debug)
    public function metricForTest() as String {
        return FuelGuardGlanceData.metric();
    }

    (:debug)
    public function labelForTest() as String {
        return FuelGuardGlanceData.label();
    }

    (:debug)
    public function pendingTextForTest() as String? {
        return pendingText();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var height = dc.getHeight();
        var metric = FuelGuardGlanceData.metric();
        var label = FuelGuardGlanceData.label();
        var titleY = height < 80 ? 11 : 14;
        var metricY = height / 2;
        var labelY = height < 92 ? height - 18 : height / 2 + 26;
        var metricFont = metric.length() > 9 || dc.getWidth() < 130 ? Graphics.FONT_XTINY : Graphics.FONT_SMALL;

        drawCenter(dc, titleY, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
        drawCenter(dc, metricY, metricFont, metric, Graphics.COLOR_WHITE);
        drawCenter(dc, labelY, Graphics.FONT_XTINY, label, Graphics.COLOR_LT_GRAY);

        var pending = pendingText();
        if (pending != null && height > 112) {
            drawCenter(dc, height - 12, Graphics.FONT_XTINY, pending as String, Graphics.COLOR_LT_GRAY);
        }
    }
}
