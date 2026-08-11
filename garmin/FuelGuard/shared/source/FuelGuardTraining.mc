import Toybox.Application.Storage;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class FuelGuardTrainingStatusCallback {
    public function initialize() {
    }

    public function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        FuelGuardTraining.onStatusResponse(responseCode, data, context);
    }
}

(:debug)
class FuelGuardTrainingTestRequestException extends Lang.Exception {
    public function initialize() {
        Exception.initialize();
        self.mMessage = "Fuel Guard training test request-start exception";
    }
}

module FuelGuardTraining {
    const ACTIVE_KEY = "fg_training_active";
    const SESSION_KEY = "fg_training_session_id";
    const STATUS_KEY = "fg_training_status";
    const PENDING_ACTION_KEY = "fg_training_pending_action";
    const PENDING_FAILED_KEY = "fg_training_pending_failed";
    const STARTED_AT_KEY = "fg_training_started_at";
    const COMPLETED_AT_KEY = "fg_training_completed_at";
    const COMPLETED_DURATION_KEY = "fg_training_completed_duration";
    const STATUS_REQUEST_CONTEXT = "training_status";
    const REFRESH_INTERVAL_SECONDS = 60;

    var _statusCallback = null;
    var _refreshInFlight = false;
    var _lastRefreshAt = 0;

    (:debug) var _testThrowOnRefreshRequest = false;
    (:debug) var _testHoldRefreshResponse = false;
    (:debug) var _testRefreshResponseCode = 200;
    (:debug) var _testRefreshResponseData = null;
    (:debug) var _testRefreshDispatchCount = 0;
    (:debug) var _testLastRefreshContext = null;

    function active() as Boolean {
        var value = Storage.getValue(ACTIVE_KEY);
        return value instanceof Boolean ? value as Boolean : false;
    }

    function sessionId() as String {
        var value = Storage.getValue(SESSION_KEY);
        return value instanceof String ? value as String : "";
    }

    function statusText() as String {
        var value = Storage.getValue(STATUS_KEY);
        if (value instanceof String && (value as String).length() > 0) {
            return value as String;
        }
        return active() ? "Training Mode active" : "Training Mode ready";
    }

    function pendingAction() as String {
        var value = Storage.getValue(PENDING_ACTION_KEY);
        return value instanceof String ? value as String : "";
    }

    function transitionPending() as Boolean {
        return pendingAction().length() > 0;
    }

    function transitionFailed() as Boolean {
        var value = Storage.getValue(PENDING_FAILED_KEY);
        return value instanceof Boolean ? value as Boolean : false;
    }

    function completionActive() as Boolean {
        var value = Storage.getValue(COMPLETED_AT_KEY);
        return value instanceof Number && Time.now().value() - (value as Number) < 5;
    }

    function completionDurationText() as String {
        var value = Storage.getValue(COMPLETED_DURATION_KEY);
        if (!(value instanceof Number) || (value as Number) < 60) {
            return "";
        }
        var minutes = (value as Number) / 60;
        var hours = minutes / 60;
        if (hours > 0) {
            return Lang.format("$1$h $2$m", [hours, minutes % 60]);
        }
        return Lang.format("$1$m", [minutes]);
    }

    function recordConfirmedTransition(action as String, nextActive as Boolean) as Void {
        var now = Time.now().value();
        if (action.equals("start") && nextActive) {
            Storage.setValue(STARTED_AT_KEY, now);
            Storage.deleteValue(COMPLETED_AT_KEY);
            Storage.deleteValue(COMPLETED_DURATION_KEY);
            FuelGuardFeedback.vibrateSuccess();
        } else if (action.equals("end") && !nextActive) {
            var startedAt = Storage.getValue(STARTED_AT_KEY);
            if (startedAt instanceof Number) {
                var duration = now - (startedAt as Number);
                Storage.setValue(COMPLETED_DURATION_KEY, duration > 0 ? duration : 0);
            } else {
                Storage.deleteValue(COMPLETED_DURATION_KEY);
            }
            Storage.setValue(COMPLETED_AT_KEY, now);
            Storage.deleteValue(STARTED_AT_KEY);
            FuelGuardFeedback.vibrateSuccess();
        }
    }

    function setTransition(action as String, failed as Boolean, status as String) as Void {
        Storage.setValue(PENDING_ACTION_KEY, action);
        Storage.setValue(PENDING_FAILED_KEY, failed);
        Storage.setValue(STATUS_KEY, status);
        WatchUi.requestUpdate();
    }

    function clearTransition() as Void {
        Storage.deleteValue(PENDING_ACTION_KEY);
        Storage.deleteValue(PENDING_FAILED_KEY);
    }

    function setState(isActive as Boolean, nextSessionId as String?, status as String) as Void {
        Storage.setValue(ACTIVE_KEY, isActive);
        if (nextSessionId != null && (nextSessionId as String).length() > 0) {
            Storage.setValue(SESSION_KEY, nextSessionId as String);
        } else if (!isActive) {
            Storage.deleteValue(SESSION_KEY);
        }
        Storage.setValue(STATUS_KEY, status);
        WatchUi.requestUpdate();
    }

    function dictionaryString(data as Dictionary, key as String) as String {
        var value = data[key];
        if (!(value instanceof String)) {
            if (key.equals("result")) {
                value = data[:result];
            } else if (key.equals("session_id")) {
                value = data[:session_id];
            }
        }
        return value instanceof String ? value as String : "";
    }

    function dictionaryBoolean(data as Dictionary, key as String) as Boolean? {
        var value = data[key];
        if (!(value instanceof Boolean) && key.equals("active")) {
            value = data[:active];
        }
        return value instanceof Boolean ? value as Boolean : null;
    }

    function dictionarySessionId(data as Dictionary) as String {
        var direct = dictionaryString(data, "session_id");
        if (direct.length() > 0) {
            return direct;
        }
        var session = data["session"];
        if (!(session instanceof Dictionary)) {
            session = data[:session];
        }
        if (session instanceof Dictionary) {
            return dictionaryString(session as Dictionary, "id");
        }
        return "";
    }

    function isCommand(event as Dictionary) as Boolean {
        var value = event["kind"];
        return value instanceof String && (value as String).equals("training");
    }

    function createCommand(action as String) as Dictionary {
        var timestamp = FuelGuardEvents.nowSeconds();
        var counter = FuelGuardEvents.nextCounter();
        var commandId = Lang.format("fg-$1$-training-$2$-$3$", [FuelGuardEvents.DEVICE_ID, timestamp, counter]);
        return {
            "kind" => "training",
            "action" => action,
            "external_event_id" => commandId,
            "external_action_id" => commandId,
            "occurred_at" => FuelGuardEvents.isoUtcFromSeconds(timestamp),
            "device_id" => FuelGuardEvents.DEVICE_ID
        };
    }

    function toggle() as String {
        var existingAction = pendingAction();
        if (existingAction.length() > 0) {
            var retryStatus = existingAction.equals("start") ? "Retrying Training start" : "Retrying Training end";
            setTransition(existingAction, false, retryStatus);
            FuelGuardApi.trySync(true);
            return existingAction;
        }
        var action = active() ? "end" : "start";
        FuelGuardQueue.enqueue(createCommand(action));
        if (action.equals("start")) {
            setTransition(action, false, "Starting Training Mode");
        } else {
            setTransition(action, false, "Ending Training Mode");
        }
        FuelGuardApi.trySync(true);
        return action;
    }

    function handleCommandResponse(responseCode as Number, data as Dictionary or String or Null) as Boolean {
        var action = pendingAction();
        if ((responseCode == 200 || responseCode == 201) && data instanceof Dictionary) {
            var values = data as Dictionary;
            var result = dictionaryString(values, "result");
            var nextActive = dictionaryBoolean(values, "active");
            var nextSessionId = dictionarySessionId(values);
            if (nextActive != null) {
                recordConfirmedTransition(action, nextActive as Boolean);
                var message = nextActive as Boolean ? "Training Mode started" : "Training complete";
                if (result.equals("already_active")) {
                    message = "Training Mode active";
                } else if (result.equals("no_active")) {
                    message = "No active training";
                }
                clearTransition();
                setState(nextActive as Boolean, nextSessionId, message);
                return true;
            }
        }
        var failureStatus = "Training update failed - retry";
        if (action.equals("start")) {
            failureStatus = "Training start failed - retry";
        } else if (action.equals("end")) {
            failureStatus = "Training end failed - retry";
        }
        setTransition(action, true, failureStatus);
        return false;
    }

    function statusCallback() as Method {
        if (_statusCallback == null) {
            _statusCallback = new FuelGuardTrainingStatusCallback();
        }
        return (_statusCallback as FuelGuardTrainingStatusCallback).method(:onResponse);
    }

    function sendRefreshRequest(options as Dictionary) as Void {
        Communications.makeWebRequest(FuelGuardConnection.trainingEndpoint(), {}, options, statusCallback());
    }

    (:release)
    function dispatchRefreshRequest(options as Dictionary) as Void {
        sendRefreshRequest(options);
    }

    (:debug)
    function dispatchRefreshRequest(options as Dictionary) as Void {
        if (_testThrowOnRefreshRequest) {
            throw new FuelGuardTrainingTestRequestException();
        }
        if (_testHoldRefreshResponse) {
            _testRefreshDispatchCount += 1;
            _testLastRefreshContext = options[:context];
            return;
        }
        sendRefreshRequest(options);
    }

    function refresh(force as Boolean) as Void {
        if (_refreshInFlight || !FuelGuardConnection.connected()) {
            return;
        }
        var now = Time.now().value();
        if (!force && _lastRefreshAt > 0 && now - _lastRefreshAt < REFRESH_INTERVAL_SECONDS) {
            return;
        }
        _refreshInFlight = true;
        _lastRefreshAt = now;
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_GET,
            :headers => {"Authorization" => "Bearer " + FuelGuardConnection.token()},
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
            :context => STATUS_REQUEST_CONTEXT
        };
        try {
            dispatchRefreshRequest(options);
        } catch (e) {
            _refreshInFlight = false;
        }
    }

    function onStatusResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        _refreshInFlight = false;
        if (FuelGuardConnection.handleAuthenticationFailure(responseCode)) {
            return;
        }
        if (responseCode == 200 && data instanceof Dictionary) {
            var values = data as Dictionary;
            var nextActive = dictionaryBoolean(values, "active");
            if (nextActive != null) {
                var action = pendingAction();
                var canonicalActive = nextActive as Boolean;
                var transitionConfirmed = (action.equals("start") && canonicalActive)
                    || (action.equals("end") && !canonicalActive);
                if (transitionConfirmed) {
                    recordConfirmedTransition(action, canonicalActive);
                    clearTransition();
                    setState(canonicalActive, dictionarySessionId(values), canonicalActive ? "Training Mode active" : "Training complete");
                } else if (action.length() == 0) {
                    setState(canonicalActive, dictionarySessionId(values), canonicalActive ? "Training Mode active" : "Training Mode ready");
                }
            }
        }
    }

    (:debug)
    function resetForTest() as Void {
        Storage.deleteValue(ACTIVE_KEY);
        Storage.deleteValue(SESSION_KEY);
        Storage.deleteValue(STATUS_KEY);
        Storage.deleteValue(PENDING_ACTION_KEY);
        Storage.deleteValue(PENDING_FAILED_KEY);
        Storage.deleteValue(STARTED_AT_KEY);
        Storage.deleteValue(COMPLETED_AT_KEY);
        Storage.deleteValue(COMPLETED_DURATION_KEY);
        _refreshInFlight = false;
        _lastRefreshAt = 0;
        _testThrowOnRefreshRequest = false;
        _testHoldRefreshResponse = false;
        _testRefreshResponseCode = 200;
        _testRefreshResponseData = null;
        _testRefreshDispatchCount = 0;
        _testLastRefreshContext = null;
    }

    (:debug)
    function setActiveForTest(value as Boolean) as Void {
        setState(value, null, value ? "Training Mode active" : "Training Mode ready");
    }

    (:debug)
    function useThrowingRefreshTransportForTest() as Void {
        _testThrowOnRefreshRequest = true;
    }

    (:debug)
    function useHeldRefreshTransportForTest(responseCode as Number, data as Dictionary or String or Null) as Void {
        _testHoldRefreshResponse = true;
        _testRefreshResponseCode = responseCode;
        _testRefreshResponseData = data;
    }

    (:debug)
    function deliverHeldRefreshResponseForTest() as Void {
        if (!_testHoldRefreshResponse || _testLastRefreshContext == null) {
            return;
        }
        _testHoldRefreshResponse = false;
        statusCallback().invoke(_testRefreshResponseCode, _testRefreshResponseData, _testLastRefreshContext as Object);
    }

    (:debug)
    function refreshDispatchCountForTest() as Number {
        return _testRefreshDispatchCount;
    }

    (:debug)
    function lastRefreshContextForTest() as Object? {
        return _testLastRefreshContext;
    }

    (:debug)
    function refreshInFlightForTest() as Boolean {
        return _refreshInFlight;
    }
}
