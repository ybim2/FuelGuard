const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadFuelSupabase() {
  const context = {
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    console,
    document: {
      addEventListener() {}
    },
    navigator: { onLine: true },
    requestAnimationFrame() {},
    window: {
      FUEL_GUARD_SUPABASE_CONFIG: {},
      addEventListener() {},
      dispatchEvent() {},
      location: { origin: "https://fuel-guard.example", pathname: "/", search: "", hash: "" },
      history: { replaceState() {} }
    },
    fuelLogDate(log) {
      const date = new Date(log?.timestamp || log?.logged_at || log?.created_at || "");
      return Number.isNaN(date.getTime()) ? null : date;
    },
    fuelGapState() {
      return {
        logs: [],
        demandBlocks: [],
        workBreaks: [],
        cloud: {
          pendingDeleteIds: [],
          pendingDemandDeleteIds: [],
          pendingWorkBreakDeleteIds: []
        }
      };
    }
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.navigator = context.navigator;
  context.window.requestAnimationFrame = context.requestAnimationFrame;
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "fuel-supabase.js"), "utf8");
  vm.runInContext(source, context, { filename: "fuel-supabase.js" });
  return context.window.fuelGuardCloud._test;
}

test("garmin survives source normalization", () => {
  const api = loadFuelSupabase();
  assert.equal(api.normalizeSource("garmin"), "garmin");
});

test("existing source values still normalize", () => {
  const api = loadFuelSupabase();
  assert.equal(api.normalizeSource("manual"), "manual");
  assert.equal(api.normalizeSource("csv_import"), "csv_import");
  assert.equal(api.normalizeSource("hardware"), "hardware");
  assert.equal(api.normalizeSource("bluetooth"), "bluetooth");
  assert.equal(api.normalizeSource("unknown"), "manual");
});

test("Garmin cloud rows preserve source and event types", () => {
  const api = loadFuelSupabase();
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    logged_at: "2026-07-18T08:15:00.000Z",
    source: "garmin",
    external_event_id: "fr255-1000-1",
    notes: "fuel_guard_garmin_device:fr255",
    created_at: "2026-07-18T08:15:01.000Z"
  };

  assert.equal(api.rowToLog({ ...base, type: "fuel" }).source, "garmin");
  assert.equal(api.rowToLog({ ...base, type: "fuel" }).externalEventId, "fr255-1000-1");
  assert.equal(api.rowToLog({ ...base, type: "hydration" }).type, "hydration");
  assert.equal(api.rowToLog({ ...base, type: "fuel_hydration" }).type, "fuel_hydration");
});
