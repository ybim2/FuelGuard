import Toybox.Lang;
import Toybox.Test;

(:test)
function testFuelGuardIsoUtcJanuary(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1704164645);
    return actual.equals("2024-01-02T03:04:05Z");
}

(:test)
function testFuelGuardIsoUtcAugust(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1723165323);
    return actual.equals("2024-08-09T01:02:03Z");
}

(:test)
function testFuelGuardIsoUtcOctober(logger) as Boolean {
    var actual = FuelGuardEvents.isoUtcFromSeconds(1728555072);
    return actual.equals("2024-10-10T10:11:12Z");
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

    return fuelLoggedAt.substring(fuelLoggedAt.length() - 1, fuelLoggedAt.length()).equals("Z")
        && hydrationLoggedAt.substring(hydrationLoggedAt.length() - 1, hydrationLoggedAt.length()).equals("Z")
        && fuelHydrationLoggedAt.substring(fuelHydrationLoggedAt.length() - 1, fuelHydrationLoggedAt.length()).equals("Z");
}
