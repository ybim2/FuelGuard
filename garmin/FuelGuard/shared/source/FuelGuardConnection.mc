import Toybox.Application.Storage;
import Toybox.Authentication;
import Toybox.Communications;
import Toybox.Cryptography;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Time;
import Toybox.WatchUi;

class FuelGuardOAuthCallback {
    public function initialize() {
    }

    public function onOAuthMessage(message as Authentication.OAuthMessage) as Void {
        try {
            FuelGuardConnection.onOAuthMessage(message);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-AUTH-02", "OAuth callback", e);
            FuelGuardDiagnostics.requestUpdate();
        }
    }
}

class FuelGuardAuthExchangeCallback {
    public function initialize() {
    }

    public function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        try {
            FuelGuardConnection.onExchangeResponse(responseCode, data, context);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-AUTH-03", "token exchange callback", e);
            FuelGuardDiagnostics.requestUpdate();
        }
    }
}

class FuelGuardRevokeCallback {
    public function initialize() {
    }

    public function onResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        FuelGuardConnection.onRevokeResponse(responseCode, data, context);
    }
}

(:debug)
class FuelGuardAuthRequestException extends Lang.Exception {
    public function initialize() {
        Exception.initialize();
        self.mMessage = "Fuel Guard auth test request exception";
    }
}

module FuelGuardConnection {
    const APP_QUICK_LOG = "quick_log";
    const APP_ACTIVITY_LOGGER = "activity_logger";
    const PRODUCTION_BASE_URL = "https://fuelguardapp.com";
    const CONNECT_URL = PRODUCTION_BASE_URL + "/garmin/connect/";
    const RESULT_URL = "connectiq://oauth";
    const LOG_PATH = "/api/garmin/log";
    const HEALTH_PATH = "/api/garmin/health";
    const TRAINING_PATH = "/api/garmin/training";
    const EXCHANGE_PATH = "/api/garmin/auth/exchange";
    const REVOKE_PATH = "/api/garmin/devices/revoke";
    const TOKEN_KEY = "fg_device_token";
    const TOKEN_PREFIX_KEY = "fg_token_prefix";
    const PENDING_STATE_KEY = "fg_pending_oauth_state";
    const STATUS_KEY = "fg_connection_status";
    const APP_ID_KEY = "fg_app_id";

    var _appId = APP_QUICK_LOG;
    var _oauthCallback = null;
    var _oauthRegistered = false;
    var _exchangeCallback = null;
    var _revokeCallback = null;

    (:debug) var _authRequestCount = 0;
    (:debug) var _exchangeRequestCount = 0;
    (:debug) var _lastExchangeCode = null;
    (:debug) var _lastExchangeState = null;
    (:debug) var _lastAuthState = null;
    (:debug) var _lastRevokeToken = null;
    (:debug) var _testExchangeEnabled = false;
    (:debug) var _testExchangeCode = 200;
    (:debug) var _testExchangeData = null;
    (:debug) var _testThrowOnAuth = false;
    (:debug) var _testAuthRequestOnly = false;
    (:debug) var _testRevokeEnabled = false;
    (:debug) var _testRevokeCode = 200;
    (:debug) var _testRevokeData = {"result" => "revoked"};
    (:debug) var _testThrowOnOAuthRegister = false;
    (:debug) var _testOAuthRegistrationOnly = false;

    function isConnectActionKey(key as WatchUi.Key) as Boolean {
        return key == WatchUi.KEY_START || key == WatchUi.KEY_ENTER;
    }

    function configure(appId as String) as Void {
        if (appId.equals(APP_ACTIVITY_LOGGER)) {
            _appId = APP_ACTIVITY_LOGGER;
        } else {
            _appId = APP_QUICK_LOG;
        }
        try {
            Storage.setValue(APP_ID_KEY, _appId);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-STATE-01", "save app identity", e);
        }
    }

    function appId() as String {
        var stored = null;
        try {
            stored = Storage.getValue(APP_ID_KEY);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-STATE-01", "read app identity", e);
            return _appId;
        }
        if (stored instanceof String) {
            var text = stored as String;
            if (text.equals(APP_ACTIVITY_LOGGER) || text.equals(APP_QUICK_LOG)) {
                _appId = text;
            }
        }
        return _appId;
    }

    function appLabel() as String {
        return appId().equals(APP_ACTIVITY_LOGGER) ? "Activity Logger" : "Quick Log";
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
        return value.substring(start, finish);
    }

    function isWhitespace(value as String or Null) as Boolean {
        var character = value as String;
        return character.equals(" ") || character.equals("\t") || character.equals("\n") || character.equals("\r");
    }

    function storedString(key as String) as String {
        var value = null;
        try {
            value = Storage.getValue(key);
        } catch (e) {
            FuelGuardDiagnostics.report("QL-STATE-01", "read connection state", e);
            return "";
        }
        if (!(value instanceof String)) {
            if (value != null) {
                FuelGuardDiagnostics.report("QL-STATE-02", "malformed connection state", null);
                try {
                    Storage.deleteValue(key);
                } catch (deleteError) {
                    FuelGuardDiagnostics.report("QL-STATE-03", "repair connection state", deleteError);
                }
            }
            return "";
        }
        var text = value as String;
        if (text.length() > 1024) {
            FuelGuardDiagnostics.report("QL-STATE-02", "oversized connection state", null);
            try {
                Storage.deleteValue(key);
            } catch (deleteError) {
                FuelGuardDiagnostics.report("QL-STATE-03", "repair connection state", deleteError);
            }
            return "";
        }
        return trimString(text);
    }

    function token() as String {
        return storedString(TOKEN_KEY);
    }

    function tokenPrefix() as String {
        return storedString(TOKEN_PREFIX_KEY);
    }

    function pendingState() as String {
        return storedString(PENDING_STATE_KEY);
    }

    function statusText() as String {
        var status = storedString(STATUS_KEY);
        if (status.length() > 0) {
            return status;
        }
        return connected() ? "Connected" : "Not connected";
    }

    function connected() as Boolean {
        return token().length() > 0;
    }

    function handleAuthenticationFailure(responseCode as Number) as Boolean {
        if (responseCode != 401) {
            return false;
        }
        clearLocalToken();
        Storage.setValue(STATUS_KEY, "Disconnected - reconnect");
        FuelGuardDiagnostics.report("QL-AUTH-01", "device token rejected", null);
        WatchUi.requestUpdate();
        return true;
    }

    function logEndpoint() as String {
        return PRODUCTION_BASE_URL + LOG_PATH;
    }

    function healthEndpoint() as String {
        return PRODUCTION_BASE_URL + HEALTH_PATH;
    }

    function trainingEndpoint() as String {
        return PRODUCTION_BASE_URL + TRAINING_PATH;
    }

    function exchangeEndpoint() as String {
        return PRODUCTION_BASE_URL + EXCHANGE_PATH;
    }

    function revokeEndpoint() as String {
        return PRODUCTION_BASE_URL + REVOKE_PATH;
    }

    (:release)
    function dispatchOAuthRegistration(callback as Method) as Void {
        Authentication.registerForOAuthMessages(callback);
    }

    (:debug)
    function dispatchOAuthRegistration(callback as Method) as Void {
        if (_testThrowOnOAuthRegister) {
            throw new FuelGuardAuthRequestException();
        }
        if (_testOAuthRegistrationOnly) {
            return;
        }
        Authentication.registerForOAuthMessages(callback);
    }

    function registerForOAuthMessages() as Boolean {
        if (_oauthRegistered) {
            return true;
        }
        if (_oauthCallback == null) {
            _oauthCallback = new FuelGuardOAuthCallback();
        }
        try {
            dispatchOAuthRegistration((_oauthCallback as FuelGuardOAuthCallback).method(:onOAuthMessage));
            _oauthRegistered = true;
            return true;
        } catch (e) {
            FuelGuardDiagnostics.report("QL-CONNECT-01", "register OAuth messages", e);
            return false;
        }
    }

    function byteToHex(value as Number) as String {
        var fixed = value;
        if (fixed < 0) {
            fixed += 256;
        }
        return fixed.format("%02x");
    }

    function randomState() as String {
        var bytes = Cryptography.randomBytes(24);
        var state = "";
        for (var i = 0; i < bytes.size(); i++) {
            var item = bytes[i];
            if (item instanceof Number) {
                state += byteToHex(item as Number);
            }
        }
        if (state.length() > 0) {
            return state;
        }
        return Lang.format("$1$-$2$", [Time.now().value(), Math.rand()]);
    }

    (:release)
    function noteAuthRequest(state as String) as Void {
    }

    (:debug)
    function noteAuthRequest(state as String) as Void {
        _lastAuthState = state;
        _authRequestCount += 1;
    }

    (:release)
    function noteExchangeRequest(code as String, state as String) as Void {
    }

    (:debug)
    function noteExchangeRequest(code as String, state as String) as Void {
        _lastExchangeCode = code;
        _lastExchangeState = state;
        _exchangeRequestCount += 1;
    }

    (:release)
    function noteRevokeToken(deviceToken as String) as Void {
    }

    (:debug)
    function noteRevokeToken(deviceToken as String) as Void {
        _lastRevokeToken = deviceToken;
    }

    (:release)
    function testAuthRequestHandled() as Boolean {
        return false;
    }

    (:debug)
    function testAuthRequestHandled() as Boolean {
        if (_testThrowOnAuth) {
            throw new FuelGuardAuthRequestException();
        }
        return _testAuthRequestOnly;
    }

    (:release)
    function testExchangeHandled(state as String) as Boolean {
        return false;
    }

    (:debug)
    function testExchangeHandled(state as String) as Boolean {
        if (_testExchangeEnabled) {
            onExchangeResponse(_testExchangeCode, _testExchangeData, state);
            return true;
        }
        return false;
    }

    (:release)
    function testRevokeHandled() as Boolean {
        return false;
    }

    (:debug)
    function testRevokeHandled() as Boolean {
        if (_testRevokeEnabled) {
            onRevokeResponse(_testRevokeCode, _testRevokeData, null);
            return true;
        }
        return false;
    }

    function beginAuth() as Void {
        try {
            var state = randomState();
            Storage.setValue(PENDING_STATE_KEY, state);
            // Authentication.makeOAuthRequest is handled by the Connect IQ Store
            // mobile app, not the Garmin Connect mobile app.
            Storage.setValue(STATUS_KEY, "Open Connect IQ on phone");
            noteAuthRequest(state);

            if (testAuthRequestHandled()) {
                WatchUi.requestUpdate();
                return;
            }

            var params = {
                "redirect_uri" => RESULT_URL,
                "response_type" => "code",
                "client_id" => "fuel_guard_" + appId(),
                "app" => appId(),
                "state" => state
            };

            Authentication.makeOAuthRequest(
                CONNECT_URL,
                params,
                RESULT_URL,
                Authentication.OAUTH_RESULT_TYPE_URL,
                {"code" => "code", "state" => "state", "error" => "error"}
            );
            WatchUi.requestUpdate();
        } catch (e) {
            FuelGuardDiagnostics.report("QL-CONNECT-02", "start OAuth request", e);
        }
    }

    function dictionaryString(data as Dictionary, key as String) as String {
        var value = data[key];
        if (!(value instanceof String)) {
            if (key.equals("code")) {
                value = data[:code];
            } else if (key.equals("state")) {
                value = data[:state];
            } else if (key.equals("error")) {
                value = data[:error];
            } else if (key.equals("device_token")) {
                value = data[:device_token];
            } else if (key.equals("token_prefix")) {
                value = data[:token_prefix];
            }
        }
        return value instanceof String ? value as String : "";
    }

    function handleOAuthData(data as Dictionary) as Void {
        var error = dictionaryString(data, "error");
        if (error.length() > 0) {
            Storage.setValue(STATUS_KEY, "Connection denied");
            Storage.deleteValue(PENDING_STATE_KEY);
            WatchUi.requestUpdate();
            return;
        }

        var code = dictionaryString(data, "code");
        var state = dictionaryString(data, "state");
        var expectedState = pendingState();
        if (code.length() == 0 || state.length() == 0 || expectedState.length() == 0 || !state.equals(expectedState)) {
            Storage.setValue(STATUS_KEY, "Connection state mismatch");
            WatchUi.requestUpdate();
            return;
        }
        exchangeAuthorizationCode(code, state);
    }

    function onOAuthMessage(message as Authentication.OAuthMessage) as Void {
        var data = message.data;
        if (!(data instanceof Dictionary)) {
            Storage.setValue(STATUS_KEY, "Connection returned invalid data");
            WatchUi.requestUpdate();
            return;
        }
        handleOAuthData(data as Dictionary);
    }

    function exchangeCallback() as Method {
        if (_exchangeCallback == null) {
            _exchangeCallback = new FuelGuardAuthExchangeCallback();
        }
        return (_exchangeCallback as FuelGuardAuthExchangeCallback).method(:onResponse);
    }

    function exchangeAuthorizationCode(code as String, state as String) as Void {
        noteExchangeRequest(code, state);
        Storage.setValue(STATUS_KEY, "Completing connection");

        if (testExchangeHandled(state)) {
            return;
        }

        var payload = {
            "app_id" => appId(),
            "state" => state,
            "authorization_code" => code
        };
        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {"Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON},
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
            :context => state
        };
        try {
            Communications.makeWebRequest(exchangeEndpoint(), payload, options, exchangeCallback());
        } catch (e) {
            FuelGuardDiagnostics.report("QL-CONNECT-03", "start token exchange", e);
            try {
                Storage.setValue(STATUS_KEY, "Phone unavailable; retry connection");
            } catch (storageError) {
                FuelGuardDiagnostics.report("QL-STATE-03", "save token exchange failure", storageError);
            }
        }
    }

    function onExchangeResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        if (responseCode == 200 && data instanceof Dictionary) {
            var values = data as Dictionary;
            var deviceToken = dictionaryString(values, "device_token");
            var prefix = dictionaryString(values, "token_prefix");
            if (deviceToken.length() > 0) {
                Storage.setValue(TOKEN_KEY, deviceToken);
                Storage.setValue(TOKEN_PREFIX_KEY, prefix);
                Storage.deleteValue(PENDING_STATE_KEY);
                Storage.setValue(STATUS_KEY, "Connected");
                FuelGuardApi.trySync(true);
                WatchUi.requestUpdate();
                return;
            }
        }
        if (responseCode < 0) {
            Storage.setValue(STATUS_KEY, "Network error; retry connection");
        } else if (responseCode == 400 || responseCode == 401 || responseCode == 404) {
            Storage.setValue(STATUS_KEY, "Approval expired; retry connection");
        } else if (responseCode >= 500) {
            Storage.setValue(STATUS_KEY, "Fuel Guard server unavailable");
        } else if (responseCode == 200) {
            Storage.setValue(STATUS_KEY, "Connection returned invalid data");
            FuelGuardDiagnostics.report("QL-AUTH-04", "malformed token exchange response", null);
        } else {
            Storage.setValue(STATUS_KEY, "Connection incomplete; retry");
        }
        WatchUi.requestUpdate();
    }

    function revokeCallback() as Method {
        if (_revokeCallback == null) {
            _revokeCallback = new FuelGuardRevokeCallback();
        }
        return (_revokeCallback as FuelGuardRevokeCallback).method(:onResponse);
    }

    function disconnect() as Void {
        var currentToken = token();
        if (currentToken.length() == 0) {
            clearLocalToken();
            return;
        }
        noteRevokeToken(currentToken);
        Storage.setValue(STATUS_KEY, "Revoking connection");

        if (testRevokeHandled()) {
            return;
        }

        var options = {
            :method => Communications.HTTP_REQUEST_METHOD_POST,
            :headers => {
                "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON,
                "Authorization" => "Bearer " + currentToken
            },
            :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON,
            :context => appId()
        };
        Communications.makeWebRequest(revokeEndpoint(), {"app_id" => appId()}, options, revokeCallback());
        WatchUi.requestUpdate();
    }

    function onRevokeResponse(responseCode as Number, data as Dictionary or String or Null, context as Object) as Void {
        if (responseCode == 200 || responseCode == 404 || responseCode == 401) {
            clearLocalToken();
            WatchUi.requestUpdate();
            return;
        }
        Storage.setValue(STATUS_KEY, "Disconnect needs phone/data");
        WatchUi.requestUpdate();
    }

    function clearLocalToken() as Void {
        Storage.deleteValue(TOKEN_KEY);
        Storage.deleteValue(TOKEN_PREFIX_KEY);
        Storage.deleteValue(PENDING_STATE_KEY);
        Storage.setValue(STATUS_KEY, "Not connected");
        FuelGuardGlanceState.markUnavailable();
    }

    (:debug)
    function resetForTest() as Void {
        clearLocalToken();
        Storage.deleteValue(APP_ID_KEY);
        _appId = APP_QUICK_LOG;
        _oauthRegistered = false;
        _authRequestCount = 0;
        _exchangeRequestCount = 0;
        _lastExchangeCode = null;
        _lastExchangeState = null;
        _lastAuthState = null;
        _lastRevokeToken = null;
        _testExchangeEnabled = false;
        _testExchangeCode = 200;
        _testExchangeData = null;
        _testThrowOnAuth = false;
        _testAuthRequestOnly = false;
        _testRevokeEnabled = false;
        _testRevokeCode = 200;
        _testRevokeData = {"result" => "revoked"};
        _testThrowOnOAuthRegister = false;
        _testOAuthRegistrationOnly = false;
    }

    (:debug)
    function setConnectedForTest(deviceToken as String) as Void {
        Storage.setValue(TOKEN_KEY, deviceToken);
        Storage.setValue(TOKEN_PREFIX_KEY, deviceToken.substring(0, 4));
        Storage.setValue(STATUS_KEY, "Connected");
    }

    (:debug)
    function useTestAuthRequestOnly() as Void {
        _testAuthRequestOnly = true;
    }

    (:debug)
    function useThrowingAuthRequestForTest() as Void {
        _testThrowOnAuth = true;
    }

    (:debug)
    function useThrowingOAuthRegistrationForTest() as Void {
        _testThrowOnOAuthRegister = true;
        _oauthRegistered = false;
    }

    (:debug)
    function useTestOAuthRegistrationOnly() as Void {
        _testOAuthRegistrationOnly = true;
        _oauthRegistered = false;
    }

    (:debug)
    function setPendingStateForTest(state as String) as Void {
        Storage.setValue(PENDING_STATE_KEY, state);
    }

    (:debug)
    function handleOAuthDataForTest(data as Dictionary) as Void {
        handleOAuthData(data);
    }

    (:debug)
    function useTestExchange(responseCode as Number, data as Dictionary or String or Null) as Void {
        _testExchangeEnabled = true;
        _testExchangeCode = responseCode;
        _testExchangeData = data;
    }

    (:debug)
    function useTestRevoke(responseCode as Number, data as Dictionary or String or Null) as Void {
        _testRevokeEnabled = true;
        _testRevokeCode = responseCode;
        _testRevokeData = data;
    }

    (:debug)
    function authRequestCountForTest() as Number {
        return _authRequestCount;
    }

    (:debug)
    function exchangeRequestCountForTest() as Number {
        return _exchangeRequestCount;
    }

    (:debug)
    function lastAuthStateForTest() as String? {
        return _lastAuthState instanceof String ? _lastAuthState as String : null;
    }

    (:debug)
    function lastExchangeCodeForTest() as String? {
        return _lastExchangeCode instanceof String ? _lastExchangeCode as String : null;
    }

    (:debug)
    function lastExchangeStateForTest() as String? {
        return _lastExchangeState instanceof String ? _lastExchangeState as String : null;
    }

    (:debug)
    function lastRevokeTokenForTest() as String? {
        return _lastRevokeToken instanceof String ? _lastRevokeToken as String : null;
    }
}
