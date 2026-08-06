import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

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
    const RETRY_INTERVAL_SECONDS = 45;
    const SYNC_SUMMARY_SECONDS = 2;

    var _inFlight = false;
    var _lastAttempt = 0;
    var _callback = null;
    var _batchActive = false;
    var _batchStartCount = 0;
    var _batchSyncedCount = 0;
    var _batchFinishedAt = null;
    var _batchFinishedSyncedCount = 0;
    var _batchFinishedRemainingCount = 0;

    (:debug) var _testTransportEnabled = false;
    (:debug) var _testResponseCode = 201;
    (:debug) var _testResponseData = null;
    (:debug) var _testThrowOnRequest = false;
    (:debug) var _testHoldResponse = false;
    (:debug) var _testDispatchCount = 0;
    (:debug) var _testLastEventId = null;
    (:debug) var _testLastLoggedAt = null;
    (:debug) var _testQueuedBeforeDispatch = false;
    (:debug) var _testLastAuthorizationHeader = null;
    (:debug) var _testLastEndpoint = null;

    function realConfigured() as Boolean {
        return FuelGuardConnection.connected();
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
        return "Saved pending";
    }

    function logWord(count as Number) as String {
        return count == 1 ? "log" : "logs";
    }

    function beginBatch(pendingCount as Number) as Void {
        if (_batchActive) {
            return;
        }
        _batchActive = true;
        _batchStartCount = pendingCount;
        _batchSyncedCount = 0;
        _batchFinishedAt = null;
        _batchFinishedSyncedCount = 0;
        _batchFinishedRemainingCount = 0;
        WatchUi.requestUpdate();
    }

    function finishBatch() as Void {
        if (!_batchActive) {
            return;
        }
        _batchFinishedAt = Time.now().value();
        _batchFinishedSyncedCount = _batchSyncedCount;
        _batchFinishedRemainingCount = FuelGuardQueue.pendingCount();
        _batchActive = false;
        WatchUi.requestUpdate();
    }

    function clearSyncSummary() as Void {
        _batchFinishedAt = null;
        _batchFinishedSyncedCount = 0;
        _batchFinishedRemainingCount = 0;
    }

    function clearExpiredSyncSummary() as Void {
        if (_batchFinishedAt != null && Time.now().value() - (_batchFinishedAt as Number) >= SYNC_SUMMARY_SECONDS) {
            clearSyncSummary();
        }
    }

    function syncStatusText() as String? {
        clearExpiredSyncSummary();
        if (_batchActive) {
            return Lang.format("Syncing $1$ $2$...", [_batchStartCount, logWord(_batchStartCount)]);
        }
        if (_batchFinishedAt != null) {
            if (_batchFinishedRemainingCount > 0) {
                return Lang.format("$1$ $2$ still pending", [_batchFinishedRemainingCount, logWord(_batchFinishedRemainingCount)]);
            }
            if (_batchFinishedSyncedCount > 1) {
                return Lang.format("$1$ logs synced", [_batchFinishedSyncedCount]);
            }
            return "All synced";
        }
        var pendingCount = FuelGuardQueue.pendingCount();
        if (pendingCount > 0) {
            return Lang.format("$1$ pending", [pendingCount]);
        }
        return null;
    }

    function syncSummaryVisible() as Boolean {
        clearExpiredSyncSummary();
        return _batchFinishedAt != null;
    }

    function syncActive() as Boolean {
        return _batchActive;
    }

    function responseCallback() as Method {
        if (_callback == null) {
            _callback = new FuelGuardApiCallback();
        }
        return (_callback as FuelGuardApiCallback).method(:onResponse);
    }

    function sendWebRequest(event as Dictionary, eventId as String) as Void {
        var deviceToken = FuelGuardConnection.token();
        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "Authorization" => "Bearer " + deviceToken
        };

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
            :context => eventId
        };

        Communications.makeWebRequest(
            FuelGuardConnection.logEndpoint(),
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
            _testLastAuthorizationHeader = "Bearer " + FuelGuardConnection.token();
            _testLastEndpoint = FuelGuardConnection.logEndpoint();
            sendWebRequest(event, eventId);
            return;
        }

        if (_testThrowOnRequest) {
            throw new FuelGuardTestRequestException();
        }

        _testDispatchCount += 1;
        _testLastEventId = eventId;
        _testLastAuthorizationHeader = "Bearer " + FuelGuardConnection.token();
        _testLastEndpoint = FuelGuardConnection.logEndpoint();

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

        if (_testHoldResponse) {
            return;
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
            finishBatch();
            return;
        }
        var eventId = FuelGuardQueue.externalEventId(event);
        if (eventId == null) {
            finishBatch();
            return;
        }

        beginBatch(FuelGuardQueue.pendingCount());
        _inFlight = true;
        _lastAttempt = now;

        try {
            dispatchRequest(event, eventId as String);
        } catch (e) {
            _inFlight = false;
            finishBatch();
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
        var acknowledged = responseAcknowledged(responseCode, data);
        if (acknowledged) {
            if (context instanceof String) {
                FuelGuardQueue.removeAcknowledged(context as String);
                _batchSyncedCount += 1;
            }
        }
        if (acknowledged && FuelGuardQueue.pendingCount() > 0) {
            trySync(true);
        } else {
            finishBatch();
        }
    }

    (:debug)
    function resetForTest() as Void {
        _testTransportEnabled = false;
        _testResponseCode = 201;
        _testResponseData = null;
        _testThrowOnRequest = false;
        _testHoldResponse = false;
        _testDispatchCount = 0;
        _testLastEventId = null;
        _testLastLoggedAt = null;
        _testQueuedBeforeDispatch = false;
        _testLastAuthorizationHeader = null;
        _testLastEndpoint = null;
        _inFlight = false;
        _lastAttempt = 0;
        _batchActive = false;
        _batchStartCount = 0;
        _batchSyncedCount = 0;
        _batchFinishedAt = null;
        _batchFinishedSyncedCount = 0;
        _batchFinishedRemainingCount = 0;
    }

    (:debug)
    function useTestTransport(responseCode as Number, data as Dictionary or String or Null, throwOnRequest as Boolean) as Void {
        _testTransportEnabled = true;
        _testResponseCode = responseCode;
        _testResponseData = data;
        _testThrowOnRequest = throwOnRequest;
        _testHoldResponse = false;
        _testDispatchCount = 0;
        _testLastEventId = null;
        _testLastLoggedAt = null;
        _testQueuedBeforeDispatch = false;
        _testLastAuthorizationHeader = null;
        _testLastEndpoint = null;
        _inFlight = false;
        _lastAttempt = 0;
        _batchActive = false;
        _batchStartCount = 0;
        _batchSyncedCount = 0;
        _batchFinishedAt = null;
        _batchFinishedSyncedCount = 0;
        _batchFinishedRemainingCount = 0;
    }

    (:debug)
    function useHeldTestTransport() as Void {
        _testTransportEnabled = true;
        _testResponseCode = 201;
        _testResponseData = {"result" => "ok"};
        _testThrowOnRequest = false;
        _testHoldResponse = true;
        _testDispatchCount = 0;
        _testLastEventId = null;
        _testLastLoggedAt = null;
        _testQueuedBeforeDispatch = false;
        _testLastAuthorizationHeader = null;
        _testLastEndpoint = null;
        _inFlight = false;
        _lastAttempt = 0;
        _batchActive = false;
        _batchStartCount = 0;
        _batchSyncedCount = 0;
        _batchFinishedAt = null;
        _batchFinishedSyncedCount = 0;
        _batchFinishedRemainingCount = 0;
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

    (:debug)
    function syncStatusTextForTest() as String? {
        return syncStatusText();
    }

    (:debug)
    function syncActiveForTest() as Boolean {
        return syncActive();
    }

    (:debug)
    function batchStartCountForTest() as Number {
        return _batchStartCount;
    }

    (:debug)
    function lastAuthorizationHeaderForTest() as String? {
        return _testLastAuthorizationHeader instanceof String ? _testLastAuthorizationHeader as String : null;
    }

    (:debug)
    function lastEndpointForTest() as String? {
        return _testLastEndpoint instanceof String ? _testLastEndpoint as String : null;
    }
}
