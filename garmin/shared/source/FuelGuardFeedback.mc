import Toybox.Attention;
import Toybox.Application.Storage;
import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Time;

module FuelGuardFeedback {
    const CONFIRM_SECONDS = 3;

    function vibrate() as Void {
        if (Attention has :vibrate) {
            Attention.vibrate([
                new Attention.VibeProfile(70, 120),
                new Attention.VibeProfile(0, 80),
                new Attention.VibeProfile(70, 120)
            ]);
        }
    }

    function confirmationActive(startSeconds as Number?) as Boolean {
        if (startSeconds == null) {
            return false;
        }
        return Time.now().value() - (startSeconds as Number) < CONFIRM_SECONDS;
    }

    function elapsedFuelText() as String {
        var lastFuel = FuelGuardEvents.lastFuelSeconds();
        if (lastFuel == null) {
            return "No fuel logged";
        }
        var elapsed = Time.now().value() - (lastFuel as Number);
        if (elapsed < 60) {
            return "<1m since fuel";
        }
        var minutes = elapsed / 60;
        var hours = minutes / 60;
        if (hours >= 1) {
            return Lang.format("$1$h $2$m since fuel", [hours, minutes % 60]);
        }
        return Lang.format("$1$m since fuel", [minutes]);
    }

    function eventConfirmation(type as String) as String {
        if (type == FuelGuardEvents.TYPE_HYDRATION) {
            return "HYDRATION|LOGGED";
        }
        if (type == FuelGuardEvents.TYPE_FUEL_HYDRATION) {
            return "FUEL + WATER|LOGGED";
        }
        return "FUEL|LOGGED";
    }

    function confirmationFirstLine(type as String) as String {
        if (type == FuelGuardEvents.TYPE_HYDRATION) {
            return "HYDRATION";
        }
        if (type == FuelGuardEvents.TYPE_FUEL_HYDRATION) {
            return "FUEL + WATER";
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
