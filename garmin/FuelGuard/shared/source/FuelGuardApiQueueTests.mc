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
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useHeldTestTransport();

    var first = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_FUEL);
    var second = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_HYDRATION);
    var firstId = FuelGuardQueue.externalEventId(first);
    var secondId = FuelGuardQueue.externalEventId(second);

    FuelGuardApi.trySync(true);
    if (firstId == null) {
        return false;
    }
    FuelGuardApi.onResponse(201, {"result" => "ok"}, firstId as String);

    var remaining = FuelGuardQueue.peek();
    if (remaining == null || secondId == null) {
        return false;
    }

    return FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 2
        && FuelGuardApi.inFlightForTest()
        && FuelGuardApi.queuedBeforeDispatchForTest()
        && FuelGuardApi.lastEventIdForTest() != null
        && (FuelGuardApi.lastEventIdForTest() as String).equals(secondId as String)
        && FuelGuardQueue.externalEventId(remaining) != null
        && (FuelGuardQueue.externalEventId(remaining) as String).equals(secondId as String)
        && !(firstId as String).equals(secondId as String);
}

(:test)
function testFuelGuardApiDuplicateResponseAcknowledgesMatchingEvent(logger) as Boolean {
    fuelGuardApiTestReset(200, {"result" => "duplicate"}, false);

    var event = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_SLEEPY);
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

(:debug)
function fuelGuardApiTestEnqueueMany(count as Number) as Void {
    for (var i = 0; i < count; i++) {
        fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_FUEL);
    }
}

(:test)
function testFuelGuardApiBatchSyncKeepsStableVisibleCount(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useHeldTestTransport();
    fuelGuardApiTestEnqueueMany(5);

    FuelGuardApi.trySync(true);
    var firstStatus = FuelGuardApi.syncStatusTextForTest();
    var firstEventId = FuelGuardApi.lastEventIdForTest();
    if (firstStatus == null || firstEventId == null) {
        return false;
    }

    FuelGuardApi.onResponse(201, {"result" => "ok"}, firstEventId as String);
    var afterOneStatus = FuelGuardApi.syncStatusTextForTest();

    return FuelGuardQueue.pendingCount() == 4
        && FuelGuardApi.batchStartCountForTest() == 5
        && FuelGuardApi.syncActiveForTest()
        && firstStatus.equals("Syncing 5 logs...")
        && afterOneStatus != null
        && (afterOneStatus as String).equals("Syncing 5 logs...");
}

(:test)
function testFuelGuardApiBatchSyncFinalSuccessSummary(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useHeldTestTransport();
    fuelGuardApiTestEnqueueMany(3);

    FuelGuardApi.trySync(true);
    while (FuelGuardQueue.pendingCount() > 0) {
        var eventId = FuelGuardApi.lastEventIdForTest();
        if (eventId == null) {
            return false;
        }
        FuelGuardApi.onResponse(201, {"result" => "ok"}, eventId as String);
    }

    var status = FuelGuardApi.syncStatusTextForTest();
    return !FuelGuardApi.syncActiveForTest()
        && status != null
        && (status as String).equals("3 logs synced")
        && FuelGuardQueue.pendingCount() == 0;
}

(:test)
function testFuelGuardApiBatchSyncPartialFailureSummary(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useHeldTestTransport();
    fuelGuardApiTestEnqueueMany(3);

    FuelGuardApi.trySync(true);
    var firstEventId = FuelGuardApi.lastEventIdForTest();
    if (firstEventId == null) {
        return false;
    }
    FuelGuardApi.onResponse(201, {"result" => "ok"}, firstEventId as String);

    var secondEventId = FuelGuardApi.lastEventIdForTest();
    if (secondEventId == null) {
        return false;
    }
    FuelGuardApi.onResponse(500, null, secondEventId as String);

    var status = FuelGuardApi.syncStatusTextForTest();
    return !FuelGuardApi.syncActiveForTest()
        && FuelGuardQueue.pendingCount() == 2
        && status != null
        && (status as String).equals("2 logs still pending");
}

(:test)
function testFuelGuardApiOnlyMarksExactSuccessfulEventAcknowledged(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useHeldTestTransport();
    var event = fuelGuardApiTestEnqueue(FuelGuardEvents.TYPE_HYDRATION);
    var eventId = FuelGuardQueue.externalEventId(event);
    if (eventId == null) {
        return false;
    }

    FuelGuardApi.trySync(true);
    if (FuelGuardApi.eventAcknowledged(eventId as String)) {
        return false;
    }
    FuelGuardApi.deliverHeldResponseForTest(201, {"result" => "ok"});

    return FuelGuardApi.eventAcknowledged(eventId as String)
        && FuelGuardApi.acknowledgedType() != null
        && (FuelGuardApi.acknowledgedType() as String).equals(FuelGuardEvents.TYPE_HYDRATION)
        && FuelGuardQueue.pendingCount() == 0;
}
