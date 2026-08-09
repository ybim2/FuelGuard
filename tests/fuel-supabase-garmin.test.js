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

test("Training Mode context and canonical quantities round-trip through fuel_logs", () => {
  const api = loadFuelSupabase();
  const user = { id: "22222222-2222-4222-8222-222222222222" };
  const sessionId = "33333333-3333-4333-8333-333333333333";
  const presetId = "44444444-4444-4444-8444-444444444444";
  const row = api.rowForLog({
    timestamp: "2026-08-09T08:30:00.000Z",
    type: "hydration",
    source: "garmin",
    externalEventId: "training-hydrate-1",
    trainingModeSessionId: sessionId,
    trainingModePresetId: presetId,
    carbsG: 10,
    fluidMl: 200,
    sodiumMg: 250,
    caffeineMg: 0
  }, user);

  assert.deepEqual({
    session: row.training_mode_session_id,
    preset: row.training_mode_preset_id,
    carbs: row.carbs_g,
    fluid: row.fluid_ml,
    sodium: row.sodium_mg,
    caffeine: row.caffeine_mg
  }, { session: sessionId, preset: presetId, carbs: 10, fluid: 200, sodium: 250, caffeine: 0 });

  const log = api.rowToLog({
    id: "11111111-1111-4111-8111-111111111111",
    user_id: user.id,
    logged_at: row.logged_at,
    type: row.type,
    source: row.source,
    external_event_id: row.external_event_id,
    training_mode_session_id: row.training_mode_session_id,
    training_mode_preset_id: row.training_mode_preset_id,
    carbs_g: row.carbs_g,
    fluid_ml: row.fluid_ml,
    sodium_mg: row.sodium_mg,
    caffeine_mg: row.caffeine_mg,
    notes: null,
    created_at: row.logged_at
  });
  assert.equal(log.trainingModeSessionId, sessionId);
  assert.equal(log.trainingModePresetId, presetId);
  assert.deepEqual(
    { carbsG: log.carbsG, fluidMl: log.fluidMl, sodiumMg: log.sodiumMg, caffeineMg: log.caffeineMg },
    { carbsG: 10, fluidMl: 200, sodiumMg: 250, caffeineMg: 0 }
  );
});

test("Sleepy check-ins round-trip as observational cloud logs", () => {
  const api = loadFuelSupabase();
  const row = api.rowForLog({
    timestamp: "2026-07-18T15:45:00.000Z",
    type: "checkin",
    source: "manual",
    checkin: {
      version: 1,
      checkinType: "sleepy",
      context: "general_day",
      arousalLevel: "sleepy"
    }
  }, { id: "22222222-2222-4222-8222-222222222222" });

  assert.equal(row.type, "fuel");
  assert.match(row.notes, /fuel_guard_checkin:/);
  assert.match(row.notes, /"checkinType":"sleepy"/);
  assert.match(row.notes, /"arousalLevel":"sleepy"/);

  const log = api.rowToLog({
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    logged_at: "2026-07-18T15:45:00.000Z",
    type: "fuel",
    source: "manual",
    notes: 'fuel_guard_checkin:{"version":1,"checkinType":"sleepy","context":"general_day","arousalLevel":"sleepy"}',
    created_at: "2026-07-18T15:45:01.000Z"
  });

  assert.equal(log.type, "checkin");
  assert.equal(log.label, "Sleepy");
  assert.equal(log.checkin.checkinType, "sleepy");
  assert.equal(log.checkin.arousalLevel, "sleepy");
});

test("Garmin Sleepy rows load as the same observational Sleepy event", () => {
  const api = loadFuelSupabase();
  const log = api.rowToLog({
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "22222222-2222-4222-8222-222222222222",
    logged_at: "2026-07-18T15:45:00.000Z",
    type: "fuel",
    source: "garmin",
    external_event_id: "fr255-sleepy-1",
    notes: 'fuel_guard_checkin:{"version":1,"checkinType":"sleepy","context":"general_day","arousalLevel":"sleepy"}',
    created_at: "2026-07-18T15:45:01.000Z"
  });

  assert.equal(log.source, "garmin");
  assert.equal(log.externalEventId, "fr255-sleepy-1");
  assert.equal(log.type, "checkin");
  assert.equal(log.label, "Sleepy");
  assert.equal(log.checkin.checkinType, "sleepy");
});
