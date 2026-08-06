import Toybox.Lang;
import Toybox.Test;

(:debug)
function fuelGuardQuickReset(responseCode as Number, data as Dictionary or String or Null) as Void {
    FuelGuardQueue.saveQueue([]);
    FuelGuardApi.resetForTest();
    FuelGuardApi.useTestTransport(responseCode, data, false);
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

    if (!fuelGuardQuickAssertSelection(view, 0, FuelGuardEvents.TYPE_FUEL, "Fuel")) {
        return false;
    }

    view.move(1);
    if (!fuelGuardQuickAssertSelection(view, 1, FuelGuardEvents.TYPE_HYDRATION, "Hydration")) {
        return false;
    }

    delegate.onNextPage();
    if (!fuelGuardQuickAssertSelection(view, 2, FuelGuardEvents.TYPE_FUEL_HYDRATION, "Fuel + Water")) {
        return false;
    }

    view.move(1);
    if (!fuelGuardQuickAssertSelection(view, 0, FuelGuardEvents.TYPE_FUEL, "Fuel")) {
        return false;
    }

    delegate.onPreviousPage();
    return fuelGuardQuickAssertSelection(view, 2, FuelGuardEvents.TYPE_FUEL_HYDRATION, "Fuel + Water");
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
