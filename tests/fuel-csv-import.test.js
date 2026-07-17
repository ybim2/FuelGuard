const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadFuelGuardCsvImporter() {
  const appState = {
    logs: [],
    archive: {},
    dayTypes: {},
    trainingSessions: {},
    ridePlans: [],
    rideTemplates: [],
    foodRunway: [],
    targets: {},
    thresholds: {}
  };
  const classList = {
    add() {},
    remove() {},
    contains() { return false; },
    toggle() {}
  };
  const document = {
    body: {
      classList,
      appendChild() {},
      removeChild() {}
    },
    createElement() {
      return {
        classList,
        click() {},
        getContext() { return null; },
        getBoundingClientRect() { return { width: 0, height: 0 }; },
        setAttribute() {},
        toBlob(callback) { callback(new Blob([])); }
      };
    },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
  const context = {
    Blob,
    URL,
    URLSearchParams,
    console,
    document,
    navigator: { onLine: true },
    requestAnimationFrame(callback) { callback(); },
    setTimeout() { return 0; },
    window: {
      addEventListener() {},
      fuelGuardCloud: {},
      location: { hash: "", search: "" },
      scrollTo() {},
      setTimeout() { return 0; }
    },
    fuelGapState() { return appState; },
    fuelLogDate(log) {
      const value = typeof log === "string"
        ? log
        : log?.timestamp || log?.eventTime || log?.logged_at || log?.date || log?.createdAt;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    },
    renderAll() {},
    switchScreen() {},
    todayKey(date = new Date()) {
      return date.toISOString().slice(0, 10);
    }
  };
  context.window.window = context.window;
  context.window.document = document;
  context.window.navigator = context.navigator;
  context.window.requestAnimationFrame = context.requestAnimationFrame;

  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "fuel-beta.js"), "utf8");
  vm.runInContext(source, context, { filename: "fuel-beta.js" });
  return { importer: context.window.fuelGuardCsvImport, appState };
}

test("imports ESP32 CSV rows with event_millis", () => {
  const { importer, appState } = loadFuelGuardCsvImporter();
  const csv = `event_id,event_type,event_millis,source,device_id
fg-1,FUEL_LOG,1327693,esp32,FG_001
fg-2,FUEL_LOG,1329986,esp32,FG_001
fg-3,FUEL_LOG,1656970,esp32,FG_001
fg-4,FUEL_LOG,1749539,esp32,FG_001`;

  const preview = importer.buildFuelCsvImportPreview(csv, {
    baseDateKey: "2026-07-18",
    now: new Date("2026-07-18T12:00:00")
  });

  assert.equal(preview.recognized, true);
  assert.equal(preview.validCount, 4);
  assert.equal(preview.invalidCount, 0);
  assert.equal(preview.duplicateCount, 0);
  assert.equal(preview.logs.length, 4);
  assert.deepEqual(Array.from(preview.logs, log => log.type), ["fuel", "fuel", "fuel", "fuel"]);
  assert.deepEqual(Array.from(preview.logs, log => log.importDeviceId), ["FG_001", "FG_001", "FG_001", "FG_001"]);
  assert.deepEqual(Array.from(preview.logs, log => log.importSource), ["esp32", "esp32", "esp32", "esp32"]);
  assert.deepEqual(Array.from(preview.logs, log => log.importEventMillis), [1327693, 1329986, 1656970, 1749539]);

  const base = new Date("2026-07-18T12:00:00");
  base.setHours(0, 0, 0, 0);
  assert.deepEqual(
    Array.from(preview.logs, log => new Date(log.timestamp).getTime() - base.getTime()),
    [1327693, 1329986, 1656970, 1749539]
  );
  assert.equal(appState.logs.length, 0);
});

test("accepts ESP32 CSV with BOM, CRLF endings, trimmed values, and trailing blank lines", () => {
  const { importer } = loadFuelGuardCsvImporter();
  const csv = "\uFEFF event_id , event_type , event_millis , source , device_id \r\n fg-1 , FUEL_LOG , 1327693 , esp32 , FG_001 \r\n\r\n";

  const preview = importer.buildFuelCsvImportPreview(csv, {
    baseDateKey: "2026-07-18",
    now: new Date("2026-07-18T12:00:00")
  });

  assert.equal(preview.recognized, true);
  assert.equal(preview.validCount, 1);
  assert.equal(preview.invalidCount, 0);
  assert.equal(preview.logs[0].importEventId, "fg-1");
  assert.equal(preview.logs[0].importDeviceId, "FG_001");
  assert.equal(preview.logs[0].importEventMillis, 1327693);
});

test("reports a specific CSV header validation error", () => {
  const { importer } = loadFuelGuardCsvImporter();
  const preview = importer.buildFuelCsvImportPreview("event_id,event_type,source,device_id\nfg-1,FUEL_LOG,esp32,FG_001");

  assert.equal(preview.recognized, false);
  assert.match(preview.validationMessage, /Missing required header: event_millis/);
});
