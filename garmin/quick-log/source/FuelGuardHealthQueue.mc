import Toybox.Application.Storage;
import Toybox.Lang;

module FuelGuardHealthQueue {
    const QUEUE_KEY = "fg_pending_health_snapshots";
    const MAX_QUEUE_SIZE = 3;

    function snapshotId(snapshot as Object) as String? {
        if (snapshot instanceof Dictionary) {
            var id = (snapshot as Dictionary)[:snapshot_external_id];
            if (!(id instanceof String)) {
                id = (snapshot as Dictionary)["snapshot_external_id"];
            }
            if (id instanceof String) {
                return id as String;
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
                if (item instanceof Dictionary && snapshotId(item) != null) {
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

    function enqueue(snapshot as Dictionary) as Void {
        var id = snapshotId(snapshot);
        if (id == null) {
            return;
        }
        var stableId = id as String;
        var items = queue();
        for (var i = 0; i < items.size(); i++) {
            var existingId = snapshotId(items[i]);
            if (existingId != null && (existingId as String).equals(stableId)) {
                saveQueue(items);
                return;
            }
        }
        if (items.size() >= MAX_QUEUE_SIZE) {
            var trimmed = [];
            var start = items.size() - MAX_QUEUE_SIZE + 1;
            for (var trimIndex = start; trimIndex < items.size(); trimIndex++) {
                if (trimIndex >= 0) {
                    trimmed.add(items[trimIndex]);
                }
            }
            items = trimmed;
        }
        items.add(snapshot);
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

    function removeAcknowledged(id as String) as Void {
        var items = queue();
        var kept = [];
        for (var i = 0; i < items.size(); i++) {
            var itemId = snapshotId(items[i]);
            if (itemId == null || !(itemId as String).equals(id)) {
                kept.add(items[i]);
            }
        }
        saveQueue(kept);
    }

    function clear() as Void {
        saveQueue([]);
    }
}
