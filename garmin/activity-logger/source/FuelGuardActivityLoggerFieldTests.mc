import Toybox.Lang;
import Toybox.Test;

(:debug)
function fuelGuardActivityIsoShape(value as String) as Boolean {
    return value.length() == 20
        && value.substring(4, 5).equals("-")
        && value.substring(7, 8).equals("-")
        && value.substring(10, 11).equals("T")
        && value.substring(13, 14).equals(":")
        && value.substring(16, 17).equals(":")
        && value.substring(value.length() - 1, value.length()).equals("Z");
}

(:test)
function testFuelGuardActivityLoggerLapCreatesFuelEvent(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setConnectedForTest("device-token-test");
    FuelGuardApi.resetForTest();
    FuelGuardApi.useTestTransport(500, null, false);

    var field = new FuelGuardActivityLoggerField();
    field.onTimerLap();

    var event = FuelGuardQueue.peek();
    if (event == null) {
        return false;
    }

    var eventId = FuelGuardQueue.externalEventId(event);
    var loggedAt = event["logged_at"];
    var eventType = event["type"];
    var deviceId = event["device_id"];

    return FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 1
        && FuelGuardApi.queuedBeforeDispatchForTest()
        && eventId != null
        && FuelGuardApi.lastEventIdForTest() != null
        && (FuelGuardApi.lastEventIdForTest() as String).equals(eventId as String)
        && loggedAt instanceof String
        && FuelGuardApi.lastLoggedAtForTest() != null
        && (FuelGuardApi.lastLoggedAtForTest() as String).equals(loggedAt as String)
        && fuelGuardActivityIsoShape(loggedAt as String)
        && eventType instanceof String
        && (eventType as String).equals(FuelGuardEvents.TYPE_FUEL)
        && deviceId instanceof String
        && (deviceId as String).equals(FuelGuardEvents.DEVICE_ID);
}


(:test)
function testFuelGuardActivityLoggerSettingsInitiatesAuth(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.useTestAuthRequestOnly();
    FuelGuardApi.resetForTest();

    var view = new FuelGuardActivityLoggerSettingsView();
    var delegate = new FuelGuardActivityLoggerSettingsDelegate(view);
    delegate.onSelect();

    return FuelGuardConnection.authRequestCountForTest() == 1
        && FuelGuardConnection.lastAuthStateForTest() != null
        && !FuelGuardConnection.connected();
}

(:test)
function testFuelGuardActivityLoggerUnconnectedLapQueuesSafely(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardApi.resetForTest();

    var field = new FuelGuardActivityLoggerField();
    field.onTimerLap();

    var event = FuelGuardQueue.peek();
    return event != null
        && FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 0
        && !FuelGuardConnection.connected();
}

(:test)
function testFuelGuardActivityLoggerDisconnectDoesNotErasePendingEvents(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setConnectedForTest("device-token-test");
    FuelGuardConnection.useTestRevoke(200, {"result" => "revoked"});

    var event = FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL);
    var eventId = FuelGuardQueue.externalEventId(event);
    FuelGuardQueue.enqueue(event);
    FuelGuardConnection.disconnect();

    var queued = FuelGuardQueue.peek();
    return eventId != null
        && queued != null
        && FuelGuardQueue.pendingCount() == 1
        && FuelGuardQueue.externalEventId(queued) != null
        && (FuelGuardQueue.externalEventId(queued) as String).equals(eventId as String)
        && !FuelGuardConnection.connected();
}
