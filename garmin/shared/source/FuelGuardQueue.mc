import Toybox.Application.Storage;
import Toybox.Lang;

module FuelGuardQueue {
    const QUEUE_KEY = "fg_pending_events";

    function externalEventId(event as Object) as String? {
        if (event instanceof Dictionary) {
            var eventId = (event as Dictionary)[:external_event_id];
            if (!(eventId instanceof String)) {
                eventId = (event as Dictionary)["external_event_id"];
            }
            if (eventId instanceof String) {
                return eventId as String;
            }
        }
        return null;
    }

    function queue() as Array<Dictionary> {
        var value = Storage.getValue(QUEUE_KEY);
        if (value instanceof Array) {
            var items = value as Array;
            var clean = [];
            var changed = false;
            for (var i = 0; i < items.size(); i++) {
                var item = items[i];
                if (item instanceof Dictionary && externalEventId(item) != null) {
                    clean.add(item as Dictionary);
                } else {
                    changed = true;
                }
            }
            if (changed) {
                saveQueue(clean);
            }
            return clean;
        }
        return [];
    }

    function saveQueue(items as Array<Dictionary>) as Void {
        Storage.setValue(QUEUE_KEY, items);
    }

    function enqueue(event as Dictionary) as Void {
        var items = queue();
        var eventId = externalEventId(event);
        if (eventId == null) {
            return;
        }
        var stableEventId = eventId as String;
        for (var i = 0; i < items.size(); i++) {
            var itemId = externalEventId(items[i]);
            if (itemId != null && (itemId as String).equals(stableEventId)) {
                saveQueue(items);
                return;
            }
        }
        items.add(event);
        saveQueue(items);
    }

    function pendingCount() as Number {
        return queue().size();
    }

    function peek() as Dictionary? {
        var items = queue();
        if (items.size() == 0) {
            return null;
        }
        return items[0];
    }

    function removeAcknowledged(eventId as String) as Void {
        var items = queue();
        var kept = [];
        for (var i = 0; i < items.size(); i++) {
            var itemId = externalEventId(items[i]);
            if (itemId == null || !(itemId as String).equals(eventId)) {
                kept.add(items[i]);
            }
        }
        saveQueue(kept);
    }
}
