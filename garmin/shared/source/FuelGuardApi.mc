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

(:debug)
class FuelGuardTestRequestException extends Lang.Exception {
    public function initialize() {
        Exception.initialize();
        self.mMessage = "Fuel Guard test request-start exception";
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

    (:debug) var _testTransportEnabled = false;
    (:debug) var _testResponseCode = 201;
    (:debug) var _testResponseData = null;
    (:debug) var _testThrowOnRequest = false;
    (:debug) var _testDispatchCount = 0;
    (:debug) var _testLastEventId = null;
    (:debug) var _testLastLoggedAt = null;
    (:debug) var _testQueuedBeforeDispatch = false;

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

    function realConfigured() as Boolean {
        return settingString(ENDPOINT_PROPERTY).length() > 0 && settingString(TOKEN_PROPERTY).length() > 0;
    }

    (:release)
    function configured() as Boolean {
        return realConfigured();
    }

    (:debug)
    function configured() as Boolean {
        return _testTransportEnabled || realConfigured();
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

    function sendWebRequest(event as Dictionary, eventId as String) as Void {
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

        Communications.makeWebRequest(
            settingString(ENDPOINT_PROPERTY),
            event,
            options,
            responseCallback()
        );
    }

    (:release)
    function dispatchRequest(event as Dictionary, eventId as String) as Void {
        sendWebRequest(event, eventId);
    }

    (:debug)
    function dispatchRequest(event as Dictionary, eventId as String) as Void {
        if (!_testTransportEnabled) {
            sendWebRequest(event, eventId);
            return;
        }

        if (_testThrowOnRequest) {
            throw new FuelGuardTestRequestException();
        }

        _testDispatchCount += 1;
        _testLastEventId = eventId;

        var loggedAt = event["logged_at"];
        _testLastLoggedAt = loggedAt instanceof String ? loggedAt as String : null;

        _testQueuedBeforeDispatch = false;
        var queuedEvent = FuelGuardQueue.peek();
        if (queuedEvent != null) {
            var queuedId = FuelGuardQueue.externalEventId(queuedEvent);
            if (queuedId != null && (queuedId as String).equals(eventId)) {
                _testQueuedBeforeDispatch = true;
            }
        }

        onResponse(_testResponseCode, _testResponseData, eventId);
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

        try {
            dispatchRequest(event, eventId as String);
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

    (:debug)
    function resetForTest() as Void {
        _testTransportEnabled = false;
        _testResponseCode = 201;
        _testResponseData = null;
        _testThrowOnRequest = false;
        _testDispatchCount = 0;
        _testLastEventId = null;
        _testLastLoggedAt = null;
        _testQueuedBeforeDispatch = false;
        _inFlight = false;
        _lastAttempt = 0;
    }

    (:debug)
    function useTestTransport(responseCode as Number, data as Dictionary or String or Null, throwOnRequest as Boolean) as Void {
        _testTransportEnabled = true;
        _testResponseCode = responseCode;
        _testResponseData = data;
        _testThrowOnRequest = throwOnRequest;
        _testDispatchCount = 0;
        _testLastEventId = null;
        _testLastLoggedAt = null;
        _testQueuedBeforeDispatch = false;
        _inFlight = false;
        _lastAttempt = 0;
    }

    (:debug)
    function dispatchCountForTest() as Number {
        return _testDispatchCount;
    }

    (:debug)
    function lastEventIdForTest() as String? {
        return _testLastEventId instanceof String ? _testLastEventId as String : null;
    }

    (:debug)
    function lastLoggedAtForTest() as String? {
        return _testLastLoggedAt instanceof String ? _testLastLoggedAt as String : null;
    }

    (:debug)
    function queuedBeforeDispatchForTest() as Boolean {
        return _testQueuedBeforeDispatch;
    }

    (:debug)
    function inFlightForTest() as Boolean {
        return _inFlight;
    }
}
