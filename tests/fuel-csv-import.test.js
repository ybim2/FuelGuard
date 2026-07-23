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
    demandBlocks: [],
    workBreaks: [],
    ridePlans: [],
    rideTemplates: [],
    foodRunway: [],
    targets: {},
    thresholds: {},
    cloud: {
      pendingDeleteIds: [],
      pendingDemandDeleteIds: [],
      pendingWorkBreakDeleteIds: []
    }
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
      if (log instanceof Date) return Number.isNaN(log.getTime()) ? null : log;
      const value = typeof log === "string"
        ? log
        : log?.timestamp || log?.eventTime || log?.logged_at || log?.date || log?.createdAt;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    },
    duration(minutes) {
      const safeMinutes = Math.max(0, Math.round(Number(minutes) || 0));
      return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}m`;
    },
    formatClock(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "--";
      const hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return `${hours % 12 || 12}:${minutes}${hours >= 12 ? "PM" : "AM"}`;
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
  return {
    importer: context.window.fuelGuardCsvImport,
    planner: context.window.fuelGuardDemandPlanning,
    appState
  };
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

test("creates and scores demand-aware training fuel opportunities", () => {
  const { planner, appState } = loadFuelGuardCsvImporter();
  appState.targets.dailyFuelLogs = 2;
  appState.demandBlocks.push({
    id: "11111111-1111-4111-8111-111111111111",
    date: "2026-07-18",
    type: "training",
    startTime: "2026-07-18T08:00:00",
    endTime: "2026-07-18T09:45:00",
    sessionType: "run",
    intensity: "hard",
    isKeySession: true
  });
  appState.logs.push(
    { id: "fuel-1", timestamp: "2026-07-18T06:55:00", type: "fuel" },
    { id: "fuel-2", timestamp: "2026-07-18T10:05:00", type: "fuel" }
  );

  const opportunities = planner.generateFuelOpportunitiesForDay("2026-07-18", {
    now: new Date("2026-07-18T10:30:00")
  });

  assert.equal(planner.calculateOpportunityTimingScore(
    "2026-07-18T06:55:00",
    "2026-07-18T06:45:00",
    "2026-07-18T07:45:00"
  ), 100);
  assert.ok(opportunities.some(item => item.type === "pre_training"));
  assert.ok(opportunities.some(item => item.type === "during_training"));
  assert.ok(opportunities.some(item => item.type === "post_training"));
  assert.equal(opportunities.filter(item => item.matchedFuelLogId).length, 2);
  const score = planner.calculateDailyFuelScore("2026-07-18", {
    now: new Date("2026-07-18T10:30:00")
  });
  assert.ok(Number.isInteger(score.finalScore));
  assert.ok(score.components.some(component => component.id === "training_adherence"));
});

function testDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function recentWeekdayKeys(weekday, count) {
  const cursor = new Date();
  cursor.setUTCHours(12, 0, 0, 0);
  while (cursor.getUTCDay() !== weekday) cursor.setUTCDate(cursor.getUTCDate() - 1);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() - index * 7);
    return testDateKey(date);
  }).reverse();
}

function addFuelLogsForDay(appState, key, times) {
  times.forEach((time, index) => {
    appState.logs.push({
      id: `${key}-${index}`,
      timestamp: `${key}T${time}:00`,
      type: "fuel"
    });
  });
}

test("personalised insights wait for repeated evidence", () => {
  const { planner, appState } = loadFuelGuardCsvImporter();
  const [key] = recentWeekdayKeys(2, 4);
  addFuelLogsForDay(appState, key, ["08:00", "14:00"]);

  assert.equal(planner.personalisedInsights().length, 0);
});

test("personalised insights identify a repeated low-scoring weekday", () => {
  const { planner, appState } = loadFuelGuardCsvImporter();
  recentWeekdayKeys(2, 4).slice(0, 3).forEach(key => addFuelLogsForDay(appState, key, ["08:00", "14:30"]));
  recentWeekdayKeys(3, 4).slice(0, 3).forEach(key => addFuelLogsForDay(appState, key, ["08:00", "10:00", "12:00", "14:00"]));

  const insights = planner.personalisedInsights();

  assert.ok(insights.length <= 3);
  assert.ok(insights.some(insight => /Tuesday/.test(insight.text)));
});

test("personalised context marks fuel gaps that overlap work blocks", () => {
  const { planner, appState } = loadFuelGuardCsvImporter();
  const [key] = recentWeekdayKeys(1, 4);
  appState.demandBlocks.push({
    id: "work-test",
    date: key,
    type: "work",
    startTime: `${key}T09:00:00`,
    endTime: `${key}T17:00:00`
  });
  addFuelLogsForDay(appState, key, ["08:00", "12:00"]);

  const { context } = planner.personalisedInsightCandidates();
  const day = context.days.find(item => item.key === key);

  assert.equal(day.fuelGaps.length, 1);
  assert.equal(day.fuelGaps[0].overlapsWork, true);
});
