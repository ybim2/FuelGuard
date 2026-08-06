import Toybox.Lang;
import Toybox.Test;

(:debug)
function fuelGuardApiTestReset(responseCode as Number, data as Dictionary or String or Null, throwOnRequest as Boolean) as Void {
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useTestTransport(responseCode, data, throwOnRequest);
}

(:debug)
function fuelGuardApiTestEnqueue(type as String) as Dictionary {
    var event = FuelGuardEvents.create(type);
    FuelGuardQueue.enqueue(event);
    return event;
}

(:test)
function testFuelGuardApiAcknowledgesExpectedResponses(logger) as Boolean {
    return FuelGuardApi.responseAcknowledged(201, {"result" => "ok"})
        && FuelGuardApi.responseAcknowledged(200, {"result" => "duplicate"})
        && FuelGuardApi.responseAcknowledged(500, {:result => "ok"})
        && FuelGuardApi.responseAcknowledged(500, {"result" => "already_recorded"})
        && !FuelGuardApi.responseAcknowledged(500, {"result" => null})
        && !FuelGuardApi.responseAcknowledged(500, {"result" => 12})
        && !FuelGuardApi.responseAcknowledged(500, null);
}

(:test)
function testFuelGuardApiSuccessRemovesOnlyAcknowledgedEvent(logger) as Boolean {
    fuelGuardApiTestReset(201, {"result" => "ok"}, false);

    var first = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_FUEL);
    var second = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_HYDRATION);
    var firstId = FuelGuardQueue.externalEventId(first);
    var secondId = FuelGuardQueue.externalEventId(second);

    FuelGuardApi.trySync(true);

    var remaining = FuelGuardQueue.peek();
    if (remaining == null || firstId == null || secondId == null) {
        return false;
    }

    return FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 1
        && FuelGuardApi.queuedBeforeDispatchForTest()
        && FuelGuardQueue.externalEventId(remaining) != null
        && (FuelGuardQueue.externalEventId(remaining) as String).equals(secondId as String)
        && !(firstId as String).equals(secondId as String);
}

(:test)
function testFuelGuardApiDuplicateResponseAcknowledgesMatchingEvent(logger) as Boolean {
    fuelGuardApiTestReset(200, {"result" => "duplicate"}, false);

    var event = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_FUEL_HYDRATION);
    var eventId = FuelGuardQueue.externalEventId(event);
    FuelGuardApi.trySync(true);

    return eventId != null
        && FuelGuardQueue.pendingCount() == 0
        && FuelGuardApi.dispatchCountForTest() == 1
        && FuelGuardApi.lastEventIdForTest() != null
        && (FuelGuardApi.lastEventIdForTest() as String).equals(eventId as String);
}

(:test)
function testFuelGuardApiOfflineKeepsEventAndRetryKeepsTimestamp(logger) as Boolean {
    fuelGuardApiTestReset(500, null, false);

    var event = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_FUEL);
    var eventId = FuelGuardQueue.externalEventId(event);
    var loggedAt = event["logged_at"];

    FuelGuardApi.trySync(true);
    var firstDispatchId = FuelGuardApi.lastEventIdForTest();
    var firstDispatchLoggedAt = FuelGuardApi.lastLoggedAtForTest();

    FuelGuardApi.trySync(true);
    var secondDispatchId = FuelGuardApi.lastEventIdForTest();
    var secondDispatchLoggedAt = FuelGuardApi.lastLoggedAtForTest();

    return eventId != null
        && loggedAt instanceof String
        && FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 2
        && firstDispatchId != null
        && secondDispatchId != null
        && (firstDispatchId as String).equals(eventId as String)
        && (secondDispatchId as String).equals(eventId as String)
        && firstDispatchLoggedAt != null
        && secondDispatchLoggedAt != null
        && (firstDispatchLoggedAt as String).equals(loggedAt as String)
        && (secondDispatchLoggedAt as String).equals(loggedAt as String);
}

(:test)
function testFuelGuardApiRequestStartExceptionKeepsQueueAndResetsInFlight(logger) as Boolean {
    fuelGuardApiTestReset(201, {"result" => "ok"}, true);

    var event = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_FUEL);
    var eventId = FuelGuardQueue.externalEventId(event);

    FuelGuardApi.trySync(true);

    var queued = FuelGuardQueue.peek();
    return eventId != null
        && queued != null
        && FuelGuardQueue.externalEventId(queued) != null
        && (FuelGuardQueue.externalEventId(queued) as String).equals(eventId as String)
        && FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 0
        && !FuelGuardApi.inFlightForTest();
}
