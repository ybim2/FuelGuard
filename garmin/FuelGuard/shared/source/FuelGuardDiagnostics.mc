import Toybox.Lang;
import Toybox.System;
import Toybox.WatchUi;

module FuelGuardDiagnostics {
    var _currentCode = null;
    var _currentContext = null;
    var _lastCode = null;
    var _lastContext = null;

    function beginLaunch() as Void {
        _currentCode = null;
        _currentContext = null;
    }

    function clearCurrent() as Void {
        _currentCode = null;
        _currentContext = null;
    }

    function report(code as String, context as String, error as Object?) as Void {
        if (!(_currentCode instanceof String)) {
            _currentCode = code;
            _currentContext = context;
        }
        _lastCode = code;
        _lastContext = context;

        var detail = "";
        if (error instanceof Lang.Exception) {
            var message = (error as Lang.Exception).getErrorMessage();
            if (message instanceof String) {
                detail = " " + (message as String);
            }
        }
        System.println("Fuel Guard " + code + " " + context + detail);
    }

    function requestUpdate() as Void {
        try {
            WatchUi.requestUpdate();
        } catch (e) {
            System.println("Fuel Guard diagnostic UI update unavailable");
        }
    }

    function hasError() as Boolean {
        return _currentCode instanceof String;
    }

    function code() as String {
        return _currentCode instanceof String ? _currentCode as String : "";
    }

    function context() as String {
        return _currentContext instanceof String ? _currentContext as String : "";
    }

    function startsWith(value as String, prefix as String) as Boolean {
        return value.length() >= prefix.length()
            && value.substring(0, prefix.length()).equals(prefix);
    }

    function title() as String {
        var value = code();
        if (startsWith(value, "QL-CONNECT")) {
            return "Phone unavailable";
        }
        if (startsWith(value, "QL-AUTH")) {
            return "Reconnect Fuel Guard";
        }
        if (startsWith(value, "QL-API") || startsWith(value, "QL-SERVICE")) {
            return "Fuel Guard unavailable";
        }
        if (startsWith(value, "QL-STATE") || startsWith(value, "QL-QUEUE")) {
            return "Saved data unavailable";
        }
        return "Quick Logger couldn't load";
    }

    function message() as String {
        var value = code();
        if (startsWith(value, "QL-CONNECT")) {
            return "Check your phone and retry";
        }
        if (startsWith(value, "QL-AUTH")) {
            return "Reconnect Garmin in Fuel Guard";
        }
        if (startsWith(value, "QL-API") || startsWith(value, "QL-SERVICE")) {
            return "Try again shortly";
        }
        return "Close and reopen Quick Logger";
    }

    (:debug)
    function lastCodeForTest() as String? {
        return _lastCode instanceof String ? _lastCode as String : null;
    }

    (:debug)
    function lastContextForTest() as String? {
        return _lastContext instanceof String ? _lastContext as String : null;
    }

    (:debug)
    function resetForTest() as Void {
        _currentCode = null;
        _currentContext = null;
        _lastCode = null;
        _lastContext = null;
    }
}
