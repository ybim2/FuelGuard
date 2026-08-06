import Toybox.Application.Properties;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;

class FuelGuardApiCallback {
    public function initialize() {
    }

    public function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        FuelGuardApi.onResponse(responseCode, data, context);
    }
}

module FuelGuardApi {
    const ENDPOINT_PROPERTY = "apiEndpoint";
    const TOKEN_PROPERTY = "betaToken";
    const VERCEL_BYPASS_PROPERTY = "vercelBypassSecret";
    const RETRY_INTERVAL_SECONDS = 45;

    var _inFlight = false;
    var _lastAttempt = 0;
    var _callback = null;

    function isWhitespace(value as String or Null) as Boolean {
        var character = value as String;
        return character.equals(" ") || character.equals("\t") || character.equals("\n") || character.equals("\r");
    }

    function trimString(value as String) as String {
        var start = 0;
        var finish = value.length();

        while (start < finish && isWhitespace(value.substring(start, start + 1))) {
            start += 1;
        }

        while (finish > start && isWhitespace(value.substring(finish - 1, finish))) {
            finish -= 1;
        }

        if (start == 0 && finish == value.length()) {
            return value;
        }

        return value.substring(start, finish);
    }

    function settingString(key as String) as String {
        var value = Properties.getValue(key);
        if (!(value instanceof String)) {
            return "";
        }
        return trimString(value as String);
    }

    function configured() as Boolean {
        return settingString(ENDPOINT_PROPERTY).length() > 0 && settingString(TOKEN_PROPERTY).length() > 0;
    }

    function queueAndSync(event as Dictionary) as Void {
        FuelGuardQueue.enqueue(event);
        trySync(false);
    }

    function savedSyncPendingText() as String {
        return "SAVED - SYNC PENDING";
    }

    function responseCallback() as Method {
        if (_callback == null) {
            _callback = new FuelGuardApiCallback();
        }
        return (_callback as FuelGuardApiCallback).method(:onResponse);
    }

    function trySync(force as Boolean) as Void {
        if (_inFlight || !configured()) {
            return;
        }

        var now = Time.now().value();
        if (!force && _lastAttempt > 0 && now - _lastAttempt < RETRY_INTERVAL_SECONDS) {
            return;
        }

        var event = FuelGuardQueue.peek();
        if (event == null) {
            return;
        }
        var eventId = FuelGuardQueue.externalEventId(event);
        if (eventId == null) {
            return;
        }

        _inFlight = true;
        _lastAttempt = now;

        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "Authorization" => "Bearer " + settingString(TOKEN_PROPERTY)
        };
        var bypassSecret = settingString(VERCEL_BYPASS_PROPERTY);
        if (bypassSecret.length() > 0) {
            headers["x-vercel-protection-bypass"] = bypassSecret;
        }

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
            :context => eventId
        };

        try {
            Communications.makeWebRequest(
                settingString(ENDPOINT_PROPERTY),
                event,
                options,
                responseCallback()
            );
        } catch (e) {
            _inFlight = false;
        }
    }

    function responseAcknowledged(responseCode as Number, data as Dictionary or String or Null) as Boolean {
        if (responseCode == 200 || responseCode == 201) {
            return true;
        }
        if (data instanceof Dictionary) {
            var result = data[:result];
            if (!(result instanceof String)) {
                result = data["result"];
            }
            if (result instanceof String) {
                var resultText = result as String;
                return resultText.equals("ok") || resultText.equals("duplicate") || resultText.equals("already_recorded");
            }
        }
        return false;
    }

    function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        _inFlight = false;
        if (responseAcknowledged(responseCode, data)) {
            if (context instanceof String) {
                FuelGuardQueue.removeAcknowledged(context as String);
            }
        }
        trySync(false);
    }
}
