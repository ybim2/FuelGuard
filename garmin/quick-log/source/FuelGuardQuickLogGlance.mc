import Toybox.Graphics;
import Toybox.Lang;
import Toybox.WatchUi;

(:glance)
class FuelGuardQuickLogGlance extends WatchUi.GlanceView {
    public function initialize() {
        GlanceView.initialize();
    }

    private function contentWidth(dc as Graphics.Dc) as Number {
        var width = dc.getWidth() - 32;
        if (width < 80) {
            return dc.getWidth() - 16;
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
        var pendingCount = FuelGuardQueue.pendingCount();
        if (pendingCount > 0) {
            return Lang.format("$1$ pending", [pendingCount]);
        }
        return null;
    }

    (:debug)
    public function metricForTest() as String {
        return FuelGuardFeedback.elapsedFuelMetric();
    }

    (:debug)
    public function labelForTest() as String {
        return FuelGuardFeedback.elapsedFuelLabel();
    }

    (:debug)
    public function pendingTextForTest() as String? {
        return pendingText();
    }

    public function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var height = dc.getHeight();
        drawCenter(dc, 14, Graphics.FONT_XTINY, "Fuel Guard", Graphics.COLOR_GREEN);
        drawCenter(dc, height / 2, Graphics.FONT_SMALL, FuelGuardFeedback.elapsedFuelMetric(), Graphics.COLOR_WHITE);
        drawCenter(dc, height / 2 + 26, Graphics.FONT_XTINY, FuelGuardFeedback.elapsedFuelLabel(), Graphics.COLOR_LT_GRAY);

        var pending = pendingText();
        if (pending != null && height > 104) {
            drawCenter(dc, height - 16, Graphics.FONT_XTINY, pending as String, Graphics.COLOR_LT_GRAY);
        }
    }
}
