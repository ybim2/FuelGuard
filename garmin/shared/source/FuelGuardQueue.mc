import Toybox.Application.Storage;
import Toybox.Lang;

module FuelGuardQueue {
    const QUEUE_KEY = "fg_pending_events";

    function queue() as Array<Dictionary> {
        var value = Storage.getValue(QUEUE_KEY);
        if (value instanceof Array) {
            return value as Array<Dictionary>;
        }
        return [];
    }

    function saveQueue(items as Array<Dictionary>) as Void {
        Storage.setValue(QUEUE_KEY, items);
    }

    function enqueue(event as Dictionary) as Void {
        var items = queue();
        var eventId = event[:external_event_id];
        for (var i = 0; i < items.size(); i++) {
            if (items[i][:external_event_id] == eventId) {
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
        return items.size() > 0 ? items[0] : null;
    }

    function removeAcknowledged(eventId as String) as Void {
        var items = queue();
        var kept = [];
        for (var i = 0; i < items.size(); i++) {
            if (items[i][:external_event_id] != eventId) {
                kept.add(items[i]);
            }
        }
        saveQueue(kept);
    }
}
