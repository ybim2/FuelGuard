import Toybox.Communications;
import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

class FuelGuardHealthApiCallback {
    public function initialize() {
    }

    public function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        FuelGuardHealthApi.onResponse(responseCode, data, context);
    }
}

(:debug)
class FuelGuardHealthTestRequestException extends Lang.Exception {
    public function initialize() {
        Exception.initialize();
        self.mMessage = "Fuel Guard health test request-start exception";
    }
}

module FuelGuardHealthApi {
    const RETRY_INTERVAL_SECONDS = 15 * 60;
    const STATUS_VISIBLE_SECONDS = 20;

    var _inFlight = false;
    var _lastAttempt = 0;
    var _callback = null;
    var _lastStatus = null;
    var _lastStatusAt = null;

    (:debug) var _testTransportEnabled = false;
    (:debug) var _testResponseCode = 200;
    (:debug) var _testResponseData = {"result" => "ok"};
    (:debug) var _testThrowOnRequest = false;
    (:debug) var _testDispatchCount = 0;
    (:debug) var _testLastSnapshotId = null;
    (:debug) var _testLastEndpoint = null;

    function responseCallback() as Method {
        if (_callback == null) {
            _callback = new FuelGuardHealthApiCallback();
        }
        return (_callback as FuelGuardHealthApiCallback).method(:onResponse);
    }

    function configured() as Boolean {
        return FuelGuardConnection.connected() && FuelGuardHealthSettings.sharingEnabled();
    }

    function noteStatus(text as String?) as Void {
        _lastStatus = text;
        _lastStatusAt = text == null ? null : Time.now().value();
        WatchUi.requestUpdate();
    }

    function clearExpiredStatus() as Void {
        if (_lastStatusAt != null && Time.now().value() - (_lastStatusAt as Number) >= STATUS_VISIBLE_SECONDS) {
            _lastStatus = null;
            _lastStatusAt = null;
        }
    }

    function statusText() as String? {
        clearExpiredStatus();
        if (_inFlight) {
            return "Health syncing";
        }
        if (_lastStatus instanceof String) {
            return _lastStatus as String;
        }
        var pending = FuelGuardHealthQueue.pendingCount();
        if (pending > 0) {
            return pending == 1 ? "1 health pending" : Lang.format("$1$ health pending", [pending]);
        }
        return null;
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
                var text = result as String;
                return text.equals("ok") || text.equals("duplicate") || text.equals("already_recorded");
            }
        }
        return false;
    }

    function sendWebRequest(snapshot as Dictionary, snapshotId as String) as Void {
        var headers = {
            "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
            "Authorization" => "Bearer " + FuelGuardConnection.token()
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => headers,
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
            :context => snapshotId
        };
        Communications.makeWebRequest(
            FuelGuardConnection.healthEndpoint(),
            snapshot,
            options,
            responseCallback()
        );
    }

    (:release)
    function dispatchRequest(snapshot as Dictionary, snapshotId as String) as Void {
        sendWebRequest(snapshot, snapshotId);
    }

    (:debug)
    function dispatchRequest(snapshot as Dictionary, snapshotId as String) as Void {
        if (!_testTransportEnabled) {
            _testLastEndpoint = FuelGuardConnection.healthEndpoint();
            sendWebRequest(snapshot, snapshotId);
            return;
        }
        if (_testThrowOnRequest) {
            throw new FuelGuardHealthTestRequestException();
        }
        _testDispatchCount += 1;
        _testLastSnapshotId = snapshotId;
        _testLastEndpoint = FuelGuardConnection.healthEndpoint();
        onResponse(_testResponseCode, _testResponseData, snapshotId);
    }

    function trySync(force as Boolean) as Void {
        if (_inFlight) {
            return;
        }
        if (!configured()) {
            return;
        }
        if (FuelGuardQueue.pendingCount() > 0) {
            if (FuelGuardHealthQueue.pendingCount() > 0) {
                noteStatus("Health waits for logs");
            }
            return;
        }
        var now = Time.now().value();
        if (!force && _lastAttempt > 0 && now - _lastAttempt < RETRY_INTERVAL_SECONDS) {
            return;
        }
        var snapshot = FuelGuardHealthQueue.peek();
        if (snapshot == null) {
            return;
        }
        var snapshotId = FuelGuardHealthQueue.snapshotId(snapshot);
        if (snapshotId == null) {
            noteStatus("Health rejected");
            return;
        }
        _inFlight = true;
        _lastAttempt = now;
        noteStatus("Health syncing");
        try {
            dispatchRequest(snapshot as Dictionary, snapshotId as String);
        } catch (e) {
            _inFlight = false;
            noteStatus("Health pending");
        }
    }

    function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        _inFlight = false;
        if (responseAcknowledged(responseCode, data)) {
            if (context instanceof String) {
                FuelGuardHealthQueue.removeAcknowledged(context as String);
            }
            noteStatus("Health uploaded");
        } else if (responseCode == 400 || responseCode == 401 || responseCode == 403) {
            noteStatus("Health rejected");
        } else {
            noteStatus("Health pending");
        }
        trySync(false);
        WatchUi.requestUpdate();
    }

    (:debug)
    function resetForTest() as Void {
        FuelGuardHealthQueue.clear();
        _inFlight = false;
        _lastAttempt = 0;
        _testTransportEnabled = false;
        _testResponseCode = 200;
        _testResponseData = {"result" => "ok"};
        _testThrowOnRequest = false;
        _testDispatchCount = 0;
        _testLastSnapshotId = null;
        _testLastEndpoint = null;
        _lastStatus = null;
        _lastStatusAt = null;
    }

    (:debug)
    function useTestTransport(responseCode as Number, data as Dictionary or String or Null, throwOnRequest as Boolean) as Void {
        _testTransportEnabled = true;
        _testResponseCode = responseCode;
        _testResponseData = data;
        _testThrowOnRequest = throwOnRequest;
    }

    (:debug)
    function dispatchCountForTest() as Number {
        return _testDispatchCount;
    }

    (:debug)
    function lastSnapshotIdForTest() as String? {
        return _testLastSnapshotId instanceof String ? _testLastSnapshotId as String : null;
    }

    (:debug)
    function lastEndpointForTest() as String? {
        return _testLastEndpoint instanceof String ? _testLastEndpoint as String : null;
    }

    (:debug)
    function statusTextForTest() as String? {
        return statusText();
    }
}

module FuelGuardHealth {
    function maybeCollectAndSync(reason as String) as Void {
        FuelGuardHealthSettings.maybeClearRequested();
        if (!FuelGuardConnection.appId().equals(FuelGuardConnection.APP_QUICK_LOG)) {
            return;
        }
        if (!FuelGuardConnection.connected() || !FuelGuardHealthSettings.sharingEnabled()) {
            return;
        }
        if (FuelGuardHealthSettings.collectionStale()) {
            var snapshot = FuelGuardHealthCollector.collect();
            if (snapshot != null) {
                FuelGuardHealthQueue.enqueue(snapshot as Dictionary);
                FuelGuardHealthSettings.markCollected();
                FuelGuardHealthApi.noteStatus("Health queued");
            } else {
                FuelGuardHealthApi.noteStatus("No health data");
            }
        }
        FuelGuardHealthApi.trySync(false);
    }

    function afterFuelSync() as Void {
        maybeCollectAndSync("fuel_sync");
    }

    function statusText() as String? {
        if (!FuelGuardHealthSettings.sharingEnabled() && FuelGuardHealthQueue.pendingCount() == 0) {
            return null;
        }
        return FuelGuardHealthApi.statusText();
    }
}
