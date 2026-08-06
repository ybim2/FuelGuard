import Toybox.Lang;
import Toybox.Application.Properties;
import Toybox.Test;

(:debug)
function fuelGuardQuickReset(responseCode as Number, data as Dictionary or String or Null) as Void {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setConnectedForTest("device-token-test");
    FuelGuardApi.resetForTest();
    FuelGuardApi.useTestTransport(responseCode, data, false);
    FuelGuardHealthApi.resetForTest();
    try {
        Properties.setValue("shareHealthPatterns", false);
        Properties.setValue("clearHealthPatterns", false);
    } catch (e) {
    }
}

(:debug)
function fuelGuardQuickHealthReset(responseCode as Number, data as Dictionary or String or Null, throwOnRequest as Boolean) as Void {
    fuelGuardQuickReset(500, null);
    FuelGuardHealthApi.resetForTest();
    FuelGuardHealthApi.useTestTransport(responseCode, data, throwOnRequest);
    try {
        Properties.setValue("shareHealthPatterns", true);
        Properties.setValue("clearHealthPatterns", false);
    } catch (e) {
    }
}

(:debug)
function fuelGuardQuickHealthSnapshot(id as String) as Dictionary {
    return {
        "schema_version" => 1,
        "snapshot_external_id" => id,
        "device_id" => FuelGuardEvents.DEVICE_ID,
        "collected_at" => "2026-08-06T10:00:00Z",
        "capabilities" => {"heart_rate_history" => true},
        "heart_rate_samples" => [],
        "stress_samples" => [],
        "body_battery_samples" => [],
        "activity_summaries" => []
    };
}

(:debug)
function fuelGuardQuickLastChar(value as String) as String {
    return value.substring(value.length() - 1, value.length());
}

(:debug)
function fuelGuardQuickIsoShape(value as String) as Boolean {
    return value.length() == 20
        && value.substring(4, 5).equals("-")
        && value.substring(7, 8).equals("-")
        && value.substring(10, 11).equals("T")
        && value.substring(13, 14).equals(":")
        && value.substring(16, 17).equals(":")
        && fuelGuardQuickLastChar(value).equals("Z");
}

(:debug)
function fuelGuardQuickAssertSelection(view as FuelGuardQuickLogView, index as Number, type as String, label as String) as Boolean {
    return view.selectedIndex() == index
        && view.selectedTypeForTest().equals(type)
        && view.selectedLabelForTest().equals(label)
        && view.selectedRowCountForTest() == 1;
}

(:debug)
function fuelGuardQuickEventMatches(event as Dictionary, type as String) as Boolean {
    var eventId = FuelGuardQueue.externalEventId(event);
    var loggedAt = event["logged_at"];
    var deviceId = event["device_id"];
    var eventType = event["type"];

    return eventId != null
        && (eventId as String).length() > 0
        && loggedAt instanceof String
        && fuelGuardQuickIsoShape(loggedAt as String)
        && deviceId instanceof String
        && (deviceId as String).equals(FuelGuardEvents.DEVICE_ID)
        && eventType instanceof String
        && (eventType as String).equals(type);
}

(:debug)
function fuelGuardQuickLogSelectedType(selectionMoves as Number, expectedType as String, expectedFirstLine as String) as Boolean {
    fuelGuardQuickReset(500, null);

    var view = new FuelGuardQuickLogView();
    var delegate = new FuelGuardQuickLogDelegate(view);
    for (var i = 0; i < selectionMoves; i++) {
        delegate.onNextPage();
    }

    var pendingBefore = FuelGuardQueue.pendingCount();
    delegate.onSelect();

    var event = FuelGuardQueue.peek();
    if (event == null) {
        return false;
    }

    var eventId = FuelGuardQueue.externalEventId(event);
    var loggedAt = event["logged_at"];
    if (eventId == null || !(loggedAt instanceof String)) {
        return false;
    }

    var dispatchCount = FuelGuardApi.dispatchCountForTest();
    var dispatchedEventId = FuelGuardApi.lastEventIdForTest();
    var dispatchedLoggedAt = FuelGuardApi.lastLoggedAtForTest();

    var pendingAfterFirstEnter = FuelGuardQueue.pendingCount();
    delegate.onSelect();

    return pendingAfterFirstEnter == pendingBefore + 1
        && FuelGuardQueue.pendingCount() == pendingAfterFirstEnter
        && dispatchCount == FuelGuardApi.dispatchCountForTest()
        && FuelGuardApi.queuedBeforeDispatchForTest()
        && dispatchedEventId != null
        && (dispatchedEventId as String).equals(eventId as String)
        && dispatchedLoggedAt != null
        && (dispatchedLoggedAt as String).equals(loggedAt as String)
        && fuelGuardQuickEventMatches(event, expectedType)
        && view.isConfirming()
        && view.confirmationTypeForTest().equals(expectedType)
        && view.confirmationFirstLineForTest().equals(expectedFirstLine);
}

(:test)
function testFuelGuardQuickLogNavigationAndDelegateMovement(logger) as Boolean {
    fuelGuardQuickReset(500, null);

    var view = new FuelGuardQuickLogView();
    var delegate = new FuelGuardQuickLogDelegate(view);

    if (!fuelGuardQuickAssertSelection(view, 0, FuelGuardEvents.TYPE_FUEL, "Log fuel")) {
        return false;
    }

    view.move(1);
    if (!fuelGuardQuickAssertSelection(view, 1, FuelGuardEvents.TYPE_HYDRATION, "Hydrate")) {
        return false;
    }

    delegate.onNextPage();
    if (!fuelGuardQuickAssertSelection(view, 2, FuelGuardEvents.TYPE_FUEL_HYDRATION, "Fuel + water")) {
        return false;
    }

    view.move(1);
    if (!fuelGuardQuickAssertSelection(view, 0, FuelGuardEvents.TYPE_FUEL, "Log fuel")) {
        return false;
    }

    delegate.onPreviousPage();
    return fuelGuardQuickAssertSelection(view, 2, FuelGuardEvents.TYPE_FUEL_HYDRATION, "Fuel + water");
}

(:test)
function testFuelGuardQuickLogEnterFuelPersistsAndConfirms(logger) as Boolean {
    return fuelGuardQuickLogSelectedType(0, FuelGuardEvents.TYPE_FUEL, "FUEL");
}

(:test)
function testFuelGuardQuickLogEnterHydrationPersistsAndConfirms(logger) as Boolean {
    return fuelGuardQuickLogSelectedType(1, FuelGuardEvents.TYPE_HYDRATION, "HYDRATION");
}

(:test)
function testFuelGuardQuickLogEnterFuelHydrationPersistsAndConfirms(logger) as Boolean {
    return fuelGuardQuickLogSelectedType(2, FuelGuardEvents.TYPE_FUEL_HYDRATION, "FUEL + WATER");
}

(:test)
function testFuelGuardQuickLogDirectLogSelectionUsesProductionPath(logger) as Boolean {
    fuelGuardQuickReset(500, null);

    var view = new FuelGuardQuickLogView();
    view.move(1);
    view.logSelection();

    var event = FuelGuardQueue.peek();
    if (event == null) {
        return false;
    }

    return view.isConfirming()
        && FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 1
        && FuelGuardApi.queuedBeforeDispatchForTest()
        && fuelGuardQuickEventMatches(event, FuelGuardEvents.TYPE_HYDRATION);
}


(:test)
function testFuelGuardQuickLogUnconnectedEnterInitiatesAuth(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.useTestAuthRequestOnly();
    FuelGuardApi.resetForTest();

    var view = new FuelGuardQuickLogView();
    var delegate = new FuelGuardQuickLogDelegate(view);
    delegate.onSelect();

    return FuelGuardQueue.pendingCount() == 0
        && FuelGuardConnection.authRequestCountForTest() == 1
        && FuelGuardConnection.lastAuthStateForTest() != null;
}

(:test)
function testFuelGuardQuickLogStateMismatchDoesNotStoreToken(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setPendingStateForTest("expected-state");
    FuelGuardConnection.handleOAuthDataForTest({"code" => "one-time-code", "state" => "wrong-state"});

    return !FuelGuardConnection.connected()
        && FuelGuardConnection.exchangeRequestCountForTest() == 0
        && FuelGuardConnection.statusText().equals("Connection state mismatch");
}

(:test)
function testFuelGuardQuickLogAuthErrorDoesNotStoreToken(logger) as Boolean {
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setPendingStateForTest("expected-state");
    FuelGuardConnection.handleOAuthDataForTest({"error" => "access_denied", "state" => "expected-state"});

    return !FuelGuardConnection.connected()
        && FuelGuardConnection.pendingState().length() == 0
        && FuelGuardConnection.statusText().equals("Connection denied");
}

(:test)
function testFuelGuardQuickLogValidExchangeStoresTokenAndStartsSync(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setPendingStateForTest("expected-state");
    FuelGuardConnection.useTestExchange(200, {"result" => "ok", "device_token" => "device-token-from-exchange", "token_prefix" => "device-t"});
    FuelGuardApi.resetForTest();
    FuelGuardApi.useTestTransport(201, {"result" => "ok"}, false);

    var event = FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL);
    var eventId = FuelGuardQueue.externalEventId(event);
    FuelGuardQueue.enqueue(event);
    FuelGuardConnection.handleOAuthDataForTest({"code" => "one-time-code", "state" => "expected-state"});

    return eventId != null
        && FuelGuardConnection.connected()
        && FuelGuardConnection.token().equals("device-token-from-exchange")
        && FuelGuardConnection.pendingState().length() == 0
        && FuelGuardConnection.exchangeRequestCountForTest() == 1
        && FuelGuardApi.dispatchCountForTest() == 1
        && FuelGuardQueue.pendingCount() == 0;
}

(:test)
function testFuelGuardQuickLogPairingPreservesPendingEventWhenUploadFails(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardConnection.resetForTest();
    FuelGuardConnection.setPendingStateForTest("expected-state");
    FuelGuardConnection.useTestExchange(200, {"result" => "ok", "device_token" => "device-token-from-exchange", "token_prefix" => "device-t"});
    FuelGuardApi.resetForTest();
    FuelGuardApi.useTestTransport(500, null, false);

    var event = FuelGuardEvents.create(FuelGuardEvents.TYPE_HYDRATION);
    var eventId = FuelGuardQueue.externalEventId(event);
    var loggedAt = event["logged_at"];
    FuelGuardQueue.enqueue(event);
    FuelGuardConnection.handleOAuthDataForTest({"code" => "one-time-code", "state" => "expected-state"});

    var queued = FuelGuardQueue.peek();
    return eventId != null
        && loggedAt instanceof String
        && queued != null
        && FuelGuardQueue.pendingCount() == 1
        && FuelGuardApi.dispatchCountForTest() == 1
        && FuelGuardApi.lastEventIdForTest() != null
        && (FuelGuardApi.lastEventIdForTest() as String).equals(eventId as String)
        && FuelGuardApi.lastLoggedAtForTest() != null
        && (FuelGuardApi.lastLoggedAtForTest() as String).equals(loggedAt as String);
}

(:test)
function testFuelGuardQuickLogGlanceShowsRecentLocalFuel(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardEvents.setLastFuelSecondsForTest(FuelGuardEvents.nowSeconds() - ((2 * 60 * 60) + (37 * 60)));

    var glance = new FuelGuardQuickLogGlance();

    return glance.metricForTest().equals("2h 37m")
        && glance.labelForTest().equals("since fuel")
        && glance.pendingTextForTest() == null;
}

(:test)
function testFuelGuardQuickLogGlanceShowsNoLogFallback(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardEvents.setLastFuelSecondsForTest(null);

    var glance = new FuelGuardQuickLogGlance();

    return glance.metricForTest().equals("Ready")
        && glance.labelForTest().equals("to log")
        && glance.pendingTextForTest() == null;
}

(:test)
function testFuelGuardQuickLogGlanceShowsPendingIndicator(logger) as Boolean {
    FuelGuardQueue.saveQueue([]);
    FuelGuardEvents.setLastFuelSecondsForTest(null);
    FuelGuardQueue.enqueue(FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL));

    var glance = new FuelGuardQuickLogGlance();

    return glance.pendingTextForTest() != null
        && (glance.pendingTextForTest() as String).equals("1 pending");
}

(:test)
function testFuelGuardQuickHealthQueueIsBoundedAndDeduped(logger) as Boolean {
    fuelGuardQuickHealthReset(200, {"result" => "ok"}, false);

    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-1"));
    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-1"));
    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-2"));
    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-3"));
    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-4"));

    var first = FuelGuardHealthQueue.peek();
    return FuelGuardHealthQueue.pendingCount() == 3
        && first != null
        && FuelGuardHealthQueue.snapshotId(first as Dictionary) != null
        && (FuelGuardHealthQueue.snapshotId(first as Dictionary) as String).equals("health-2");
}

(:test)
function testFuelGuardQuickHealthWaitsForFuelQueue(logger) as Boolean {
    fuelGuardQuickHealthReset(200, {"result" => "ok"}, false);

    FuelGuardQueue.enqueue(FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL));
    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-waits"));
    FuelGuardHealthApi.trySync(true);

    var status = FuelGuardHealthApi.statusTextForTest();
    return FuelGuardHealthApi.dispatchCountForTest() == 0
        && FuelGuardHealthQueue.pendingCount() == 1
        && FuelGuardQueue.pendingCount() == 1
        && status != null
        && (status as String).equals("Health waits for logs");
}

(:test)
function testFuelGuardQuickHealthSuccessRemovesOnlyAcknowledgedSnapshot(logger) as Boolean {
    fuelGuardQuickHealthReset(200, {"result" => "ok"}, false);

    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-first"));
    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-second"));
    FuelGuardHealthApi.trySync(true);

    var remaining = FuelGuardHealthQueue.peek();
    var status = FuelGuardHealthApi.statusTextForTest();
    return FuelGuardHealthApi.dispatchCountForTest() == 1
        && FuelGuardHealthApi.lastSnapshotIdForTest() != null
        && (FuelGuardHealthApi.lastSnapshotIdForTest() as String).equals("health-first")
        && FuelGuardHealthQueue.pendingCount() == 1
        && remaining != null
        && FuelGuardHealthQueue.snapshotId(remaining as Dictionary) != null
        && (FuelGuardHealthQueue.snapshotId(remaining as Dictionary) as String).equals("health-second")
        && status != null
        && (status as String).equals("Health uploaded");
}

(:test)
function testFuelGuardQuickHealthFailedUploadStaysQueued(logger) as Boolean {
    fuelGuardQuickHealthReset(500, null, false);

    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-failed"));
    FuelGuardHealthApi.trySync(true);

    var remaining = FuelGuardHealthQueue.peek();
    var status = FuelGuardHealthApi.statusTextForTest();
    return FuelGuardHealthApi.dispatchCountForTest() == 1
        && FuelGuardHealthQueue.pendingCount() == 1
        && remaining != null
        && FuelGuardHealthQueue.snapshotId(remaining as Dictionary) != null
        && (FuelGuardHealthQueue.snapshotId(remaining as Dictionary) as String).equals("health-failed")
        && status != null
        && (status as String).equals("Health pending");
}

(:test)
function testFuelGuardQuickHealthRejectedUploadStaysQueued(logger) as Boolean {
    fuelGuardQuickHealthReset(400, {"error" => "invalid_payload"}, false);

    FuelGuardHealthQueue.enqueue(fuelGuardQuickHealthSnapshot("health-rejected"));
    FuelGuardHealthApi.trySync(true);

    var remaining = FuelGuardHealthQueue.peek();
    var status = FuelGuardHealthApi.statusTextForTest();
    return FuelGuardHealthApi.dispatchCountForTest() == 1
        && FuelGuardHealthQueue.pendingCount() == 1
        && remaining != null
        && FuelGuardHealthQueue.snapshotId(remaining as Dictionary) != null
        && (FuelGuardHealthQueue.snapshotId(remaining as Dictionary) as String).equals("health-rejected")
        && status != null
        && (status as String).equals("Health rejected");
}
