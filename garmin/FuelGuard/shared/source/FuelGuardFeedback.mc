import Toybox.Attention;
import Toybox.Application.Storage;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;

module FuelGuardFeedback {
    const CONFIRM_SECONDS = 3;

    function vibrate() as Void {
        vibrateSuccess();
    }

    function vibrateSuccess() as Void {
        if (Attention has :vibrate) {
            Attention.vibrate([
                new Attention.VibeProfile(70, 120),
                new Attention.VibeProfile(0, 80),
                new Attention.VibeProfile(70, 120)
            ]);
        }
    }

    function drawSuccessMark(dc as Graphics.Dc, centerX as Number, centerY as Number, radius as Number) as Void {
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_BLACK);
        dc.setPenWidth(radius > 16 ? 4 : 3);
        dc.drawCircle(centerX, centerY, radius);
        dc.drawLine(centerX - (radius / 2), centerY, centerX - (radius / 8), centerY + (radius / 3));
        dc.drawLine(centerX - (radius / 8), centerY + (radius / 3), centerX + (radius / 2), centerY - (radius / 3));
        dc.setPenWidth(1);
    }

    function confirmationActive(startSeconds as Number?) as Boolean {
        if (startSeconds == null) {
            return false;
        }
        return Time.now().value() - (startSeconds as Number) < CONFIRM_SECONDS;
    }

    function localYear(seconds as Number) as Number {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        return info.year instanceof Number ? info.year as Number : 0;
    }

    function localMonth(seconds as Number) as Number {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        return info.month instanceof Number ? info.month as Number : 0;
    }

    function localDay(seconds as Number) as Number {
        var info = Gregorian.info(new Time.Moment(seconds), Time.FORMAT_SHORT);
        return info.day instanceof Number ? info.day as Number : 0;
    }

    function sameLocalDay(leftSeconds as Number, rightSeconds as Number) as Boolean {
        return localYear(leftSeconds) == localYear(rightSeconds)
            && localMonth(leftSeconds) == localMonth(rightSeconds)
            && localDay(leftSeconds) == localDay(rightSeconds);
    }

    function elapsedFuelMetric() as String {
        var lastFuel = FuelGuardEvents.lastFuelSeconds();
        if (lastFuel == null) {
            return "Ready";
        }
        var nowSeconds = Time.now().value();
        if (!sameLocalDay(lastFuel as Number, nowSeconds)) {
            return "No fuel today";
        }
        var elapsed = nowSeconds - (lastFuel as Number);
        if (elapsed < 60) {
            return "<1m";
        }
        var minutes = elapsed / 60;
        var hours = minutes / 60;
        if (hours >= 1) {
            return Lang.format("$1$h $2$m", [hours, minutes % 60]);
        }
        return Lang.format("$1$m", [minutes]);
    }

    function elapsedFuelLabel() as String {
        var lastFuel = FuelGuardEvents.lastFuelSeconds();
        if (lastFuel == null) {
            return "to log";
        }
        if (!sameLocalDay(lastFuel as Number, Time.now().value())) {
            return "Ready to log";
        }
        return "since fuel";
    }

    function elapsedFuelText() as String {
        var metric = elapsedFuelMetric();
        var label = elapsedFuelLabel();
        if (label.equals("since fuel")) {
            return Lang.format("$1$ since fuel", [metric]);
        }
        if (metric.equals("Ready")) {
            return "Ready to log";
        }
        return metric;
    }

    function eventConfirmation(type as String) as String {
        if (type.equals(FuelGuardEvents.TYPE_HYDRATION)) {
            return "HYDRATION|LOGGED";
        }
        if (type.equals(FuelGuardEvents.TYPE_FUEL_HYDRATION)) {
            return "FUEL + WATER|LOGGED";
        }
        if (type.equals(FuelGuardEvents.TYPE_SLEEPY)) {
            return "SLEEPY|LOGGED";
        }
        return "FUEL|LOGGED";
    }

    function confirmationFirstLine(type as String) as String {
        if (type.equals(FuelGuardEvents.TYPE_HYDRATION)) {
            return "HYDRATION";
        }
        if (type.equals(FuelGuardEvents.TYPE_FUEL_HYDRATION)) {
            return "FUEL + WATER";
        }
        if (type.equals(FuelGuardEvents.TYPE_SLEEPY)) {
            return "SLEEPY";
        }
        return "FUEL";
    }

    function confirmationSecondLine(type as String) as String {
        return "LOGGED";
    }

    function drawCentered(dc as Graphics.Dc, lines as Array<String>, font as Graphics.FontDefinition, yStart as Number, color as Graphics.ColorType) as Void {
        dc.setColor(color, Graphics.COLOR_BLACK);
        for (var i = 0; i < lines.size(); i++) {
            dc.drawText(dc.getWidth() / 2, yStart + (i * 26), font, lines[i], Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}
