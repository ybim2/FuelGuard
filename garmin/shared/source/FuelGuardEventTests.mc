import Toybox.Lang;
import Toybox.Test;

(:debug)
function fuelGuardIsoLastChar(value as String) as String {
    return value.substring(value.length() - 1, value.length());
}

(:debug)
function fuelGuardIsoStrictShape(value as String) as Boolean {
    return value.length() == 20
        && value.substring(4, 5).equals("-")
        && value.substring(7, 8).equals("-")
        && value.substring(10, 11).equals("T")
        && value.substring(13, 14).equals(":")
        && value.substring(16, 17).equals(":")
        && fuelGuardIsoLastChar(value).equals("Z");
}

(:test)
function testFuelGuardIsoUtcJanuary(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1704164645);
    return actual.equals("2024-01-02T03:04:05Z") && fuelGuardIsoStrictShape(actual);
}

(:test)
function testFuelGuardIsoUtcAugust(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1723165323);
    return actual.equals("2024-08-09T01:02:03Z") && fuelGuardIsoStrictShape(actual);
}

(:test)
function testFuelGuardIsoUtcOctober(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1728555072);
    return actual.equals("2024-10-10T10:11:12Z") && fuelGuardIsoStrictShape(actual);
}

(:test)
function testFuelGuardIsoUtcSingleDigitPadding(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1704164645);
    return actual.substring(5, 7).equals("01")
        && actual.substring(8, 10).equals("02")
        && actual.substring(11, 13).equals("03")
        && actual.substring(14, 16).equals("04")
        && actual.substring(17, 19).equals("05");
}

(:test)
function testFuelGuardIsoUtcMalformedShapeFailsTest(logger) as Boolean {
    return !fuelGuardIsoStrictShape("2024-Aug-09T01:02:03Z")
        && !fuelGuardIsoStrictShape("2024-8-9T1:2:3Z")
        && !fuelGuardIsoStrictShape("2024-08-09T01:02:03");
}

(:test)
function testFuelGuardCreateAllEventTypes(logger) as Boolean {
    var fuel = FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL);
    var hydration = FuelGuardEvents.create(FuelGuardEvents.TYPE_HYDRATION);
    var fuelHydration = FuelGuardEvents.create(FuelGuardEvents.TYPE_FUEL_HYDRATION);

    if (!(fuel["type"] as String).equals(FuelGuardEvents.TYPE_FUEL)) {
        return false;
    }
    if (!(hydration["type"] as String).equals(FuelGuardEvents.TYPE_HYDRATION)) {
        return false;
    }
    if (!(fuelHydration["type"] as String).equals(FuelGuardEvents.TYPE_FUEL_HYDRATION)) {
        return false;
    }

    var fuelLoggedAt = fuel["logged_at"] as String;
    var hydrationLoggedAt = hydration["logged_at"] as String;
    var fuelHydrationLoggedAt = fuelHydration["logged_at"] as String;

    return fuelGuardIsoStrictShape(fuelLoggedAt)
        && fuelGuardIsoStrictShape(hydrationLoggedAt)
        && fuelGuardIsoStrictShape(fuelHydrationLoggedAt);
}
