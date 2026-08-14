const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "supplement-rhythm.js"), "utf8");
const styles = fs.readFileSync(path.join(root, "supplement-rhythm.css"), "utf8");

function fixture({ plans = [], events = [] } = {}) {
  const emitted = [];
  const listeners = new Map();
  const windowListeners = new Map();
  const elements = new Map();
  let settingsClicks = 0;
  let shownCategory = "";
  let failNextMutation = false;
  const rowsByTable = {
    fuel_supplement_plans: plans.map(row => ({ ...row })),
    fuel_supplement_schedule_slots: [],
    fuel_supplement_events: events.map(row => ({ ...row }))
  };
  const element = (id, initial = {}) => {
    const value = {
      id,
      hidden: false,
      disabled: false,
      innerHTML: "",
      textContent: "",
      value: "",
      attributes: new Map(),
      setAttribute(name, next) { this.attributes.set(name, next); },
      removeAttribute(name) { this.attributes.delete(name); },
      ...initial
    };
    elements.set(id, value);
    return value;
  };
  element("athleteSupplementManagement");
  element("supplementQuickLogSheet", { hidden: true });
  element("supplementQuickChoices");
  element("supplementQuickLogTitle");
  element("supplementQuickLogContext");
  element("graphLogSupplementButton");
  element("supplementLogStatus");
  element("foodLogCooldownMessage");
  const body = { classList: { add() {}, remove() {} } };

  function clientBuilder(table) {
    let operation = "select";
    let payload = null;
    let maximum = Infinity;
    const filters = [];
    const matchingRows = () => (rowsByTable[table] || []).filter(row => filters.every(([column, value]) => row[column] === value));
    const execute = async single => {
      if (operation !== "select" && failNextMutation) {
        failNextMutation = false;
        return { data: null, error: { message: "temporary save failure" } };
      }
      let data;
      if (operation === "insert") {
        const inserted = payload.map(row => ({ ...row, created_at: row.created_at || new Date().toISOString(), updated_at: new Date().toISOString() }));
        rowsByTable[table].push(...inserted);
        data = inserted;
      } else if (operation === "update") {
        const updated = [];
        rowsByTable[table] = rowsByTable[table].map(row => {
          if (!filters.every(([column, value]) => row[column] === value)) return row;
          const next = { ...row, ...payload, updated_at: new Date().toISOString() };
          updated.push(next);
          return next;
        });
        data = updated;
      } else {
        data = matchingRows().slice(0, maximum).map(row => ({ ...row }));
      }
      return { data: single ? (data[0] || null) : data, error: null };
    };
    const builder = {
      select() { return builder; },
      eq(column, value) { filters.push([column, value]); return builder; },
      order() { return builder; },
      limit(value) { maximum = value; return builder; },
      insert(rows) { operation = "insert"; payload = Array.isArray(rows) ? rows : [rows]; return builder; },
      update(values) { operation = "update"; payload = values; return builder; },
      single() { return execute(true); },
      then(resolve, reject) { return execute(false).then(resolve, reject); }
    };
    return builder;
  }

  const client = { from: clientBuilder };
  const document = {
    hidden: false,
    body,
    checkedPlans: [],
    addEventListener(type, listener) { listeners.set(type, listener); },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      if (selector === '[data-open-screen="checklist"]') return { click() { settingsClicks += 1; } };
      return null;
    },
    querySelectorAll() { return []; }
  };
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const window = {
    FuelGuardDomain: domain,
    FuelGuardContextLayer: { contextSnapshot: at => ({ primary: "everyday", capturedAt: at.toISOString() }) },
    FuelGuardSettingsNavigation: { showCategory(value) { shownCategory = value; } },
    FuelGuardLoggingFeedback: { celebrate() {} },
    fuelGuardCloud: { user: { id: "athlete-1" }, client },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    dispatchEvent(event) { emitted.push(event); },
    confirm() { return true; }
  };
  const context = {
    window,
    document,
    CustomEvent,
    fuelGapState: () => ({ logs: [] }),
    Date,
    Intl,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Blob,
    URL,
    crypto: { randomUUID: () => `a1600000-0000-4000-8000-${String(rowsByTable.fuel_supplement_plans.length + rowsByTable.fuel_supplement_events.length + 1).padStart(12, "0")}` },
    globalThis: {}
  };
  context.globalThis.crypto = context.crypto;
  vm.runInNewContext(source, context, { filename: "supplement-rhythm.js" });
  return {
    api: window.FuelGuardSupplementRhythm,
    document,
    elements,
    emitted,
    listeners,
    rowsByTable,
    failNextSave() { failNextMutation = true; },
    setUser(user) { window.fuelGuardCloud.user = user; },
    settingsClicks: () => settingsClicks,
    shownCategory: () => shownCategory,
    management: () => elements.get("athleteSupplementManagement").innerHTML
  };
}

function clickTarget(selector, dataset = {}) {
  return { closest(candidate) { return candidate === selector ? { dataset } : null; } };
}

function selectionTarget(value, checked) {
  const row = { classList: { toggle() {} } };
  const input = {
    value,
    checked,
    closest(selector) {
      if (selector === 'input[name="supplementSelection"]') return input;
      if (selector === "[data-supplement-selection-row]") return row;
      return null;
    }
  };
  return input;
}

async function changeSelection(view, value, checked) {
  await view.listeners.get("change")({ target: selectionTarget(value, checked) });
}

async function saveSelection(view) {
  await view.listeners.get("submit")({ target: { id: "supplementCatalogueForm" }, preventDefault() {} });
}

test("Supplement Settings is a compact curated selector with an explicit save action", async () => {
  const view = fixture();
  await view.api.load();
  const markup = view.management();
  for (const label of ["Creatine", "Protein powder", "Iron", "Vitamin D", "Vitamin C", "Vitamin B12", "Multivitamin", "Magnesium", "Zinc", "Calcium", "Omega-3 / Fish oil", "Electrolytes", "Caffeine", "Collagen", "Folic acid", "Probiotics", "Beta-alanine", "Nitrate / Beetroot", "Carbohydrate supplement", "Recovery drink"]) {
    assert.match(markup, new RegExp(label.replace(/[/-]/g, "\\$&")));
  }
  assert.match(markup, /Save supplement selection/);
  assert.match(markup, /id="supplementSelectionSave"[^>]*disabled/);
  assert.doesNotMatch(markup, /Another supplement|Add a name|Add selected supplements/);
  assert.match(styles, /max-height:\s*min\(46vh,360px\)/);
  assert.match(styles, /min-height:\s*48px/);
  assert.match(styles, /overflow-y:\s*auto/);
});

test("one or many supplement preferences persist explicitly and survive reload and account re-entry", async () => {
  const view = fixture();
  await view.api.load();
  await changeSelection(view, "creatine", true);
  await changeSelection(view, "iron", true);
  await changeSelection(view, "vitamin_d", true);
  view.api.render();
  assert.match(view.management(), /value="creatine" checked/, "in-app navigation/rendering must preserve unsaved checks");
  assert.equal(view.rowsByTable.fuel_supplement_plans.length, 0, "checking boxes must not create supplement events or preferences until Save");
  await saveSelection(view);
  assert.equal(view.rowsByTable.fuel_supplement_plans.length, 3);
  assert.ok(view.rowsByTable.fuel_supplement_plans.every(plan => plan.active));
  assert.equal(view.rowsByTable.fuel_supplement_events.length, 0, "saving preferences must not create supplement events");
  assert.match(view.management(), /Supplement selection saved/);

  await view.api.load();
  assert.match(view.management(), /value="creatine" checked/);
  assert.match(view.management(), /value="iron" checked/);
  assert.match(view.management(), /value="vitamin_d" checked/);

  view.setUser(null);
  await view.api.load();
  view.setUser({ id: "athlete-1" });
  await view.api.load();
  assert.match(view.management(), /value="creatine" checked/);

  const secondDevice = fixture({ plans: view.rowsByTable.fuel_supplement_plans });
  await secondDevice.api.load();
  assert.match(secondDevice.management(), /value="iron" checked/);
  assert.match(secondDevice.management(), /value="vitamin_d" checked/);
});

test("removing a saved preference deactivates it without deleting supplement history", async () => {
  const plans = [
    { id: "plan-1", user_id: "athlete-1", supplement_type: "creatine", custom_name: null, label: "Creatine", active: true },
    { id: "plan-2", user_id: "athlete-1", supplement_type: "iron", custom_name: null, label: "Iron", active: true }
  ];
  const events = [{ id: "event-1", user_id: "athlete-1", supplement_plan_id: "plan-2", event_status: "taken", taken_at: new Date().toISOString(), event_local_date: new Date().toISOString().slice(0, 10) }];
  const view = fixture({ plans, events });
  await view.api.load();
  await changeSelection(view, "iron", false);
  await saveSelection(view);
  assert.equal(view.rowsByTable.fuel_supplement_plans.find(plan => plan.id === "plan-2").active, false);
  assert.equal(view.rowsByTable.fuel_supplement_events.length, 1);
  const historicalTimeline = view.api.timelineEventsForDay(events[0].event_local_date);
  assert.equal(historicalTimeline.length, 1);
  assert.deepEqual([...historicalTimeline[0].supplementLabels], ["Iron"]);

  await view.listeners.get("click")({ target: clickTarget("#graphLogSupplementButton") });
  assert.equal(view.rowsByTable.fuel_supplement_events.length, 2);
  assert.equal(view.rowsByTable.fuel_supplement_events[1].supplement_plan_id, "plan-1", "future Daily logs use only the current active selection");
});

test("save failure preserves checked choices and a retry converges without duplicates", async () => {
  const view = fixture();
  await view.api.load();
  await changeSelection(view, "caffeine", true);
  view.failNextSave();
  await saveSelection(view);
  assert.equal(view.rowsByTable.fuel_supplement_plans.length, 0);
  assert.match(view.management(), /value="caffeine" checked/);
  assert.match(view.management(), /choices are still here/);
  await saveSelection(view);
  assert.equal(view.rowsByTable.fuel_supplement_plans.length, 1);
  assert.equal(view.rowsByTable.fuel_supplement_plans[0].supplement_type, "custom");
  assert.equal(view.rowsByTable.fuel_supplement_plans[0].custom_name, "Caffeine");
  assert.match(view.management(), /Supplement selection saved/);
});

test("Daily records every saved supplement in one tap and groups the moment for Today’s timeline", async () => {
  const started = Date.now();
  const view = fixture({ plans: [
    { id: "plan-1", user_id: "athlete-1", supplement_type: "creatine", custom_name: null, label: "Creatine", active: true },
    { id: "plan-2", user_id: "athlete-1", supplement_type: "vitamin_d", custom_name: null, label: "Vitamin D", active: true }
  ] });
  await view.api.load();
  await view.listeners.get("click")({ target: clickTarget("#graphLogSupplementButton") });
  assert.equal(view.settingsClicks(), 0);
  assert.equal(view.elements.get("supplementQuickLogSheet").hidden, true, "configured athletes must not see a second picker or confirmation sheet");
  assert.equal(view.rowsByTable.fuel_supplement_events.length, 2);
  const event = view.rowsByTable.fuel_supplement_events[0];
  assert.equal(event.user_id, "athlete-1");
  assert.equal(event.supplement_plan_id, "plan-1");
  assert.equal(event.event_status, "taken");
  assert.equal(event.source, "manual");
  assert.ok(new Date(event.taken_at).getTime() >= started - 1000, "the default quick-log time should be the current second");
  assert.equal("dosage" in event, false);
  assert.equal("quantity" in event, false);
  assert.equal(view.rowsByTable.fuel_supplement_events[1].supplement_plan_id, "plan-2");
  assert.equal(view.rowsByTable.fuel_supplement_events[1].taken_at, event.taken_at, "one tap must produce one grouped logging moment");
  const timeline = view.api.timelineEventsForDay(event.event_local_date);
  assert.equal(timeline.length, 1);
  assert.deepEqual([...timeline[0].supplementLabels], ["Creatine", "Vitamin D"]);
  assert.equal(view.elements.get("supplementLogStatus").textContent, "Supplements logged");
  assert.ok(view.emitted.some(item => item.type === "fuelguard:supplement-events-changed"));
});

test("an unconfigured Daily action stays in Daily and offers explicit Supplement Settings navigation", async () => {
  const view = fixture();
  await view.api.load();
  await view.listeners.get("click")({ target: clickTarget("#graphLogSupplementButton") });
  assert.equal(view.settingsClicks(), 0);
  assert.equal(view.rowsByTable.fuel_supplement_events.length, 0);
  assert.equal(view.elements.get("supplementQuickLogSheet").hidden, false);
  assert.equal(view.elements.get("supplementQuickLogTitle").textContent, "Choose your supplements first");
  assert.equal(view.elements.get("supplementQuickLogContext").textContent, "Select the supplements you want the Daily Mode button to record.");

  await view.listeners.get("click")({ target: clickTarget("[data-open-supplement-settings]") });
  assert.equal(view.settingsClicks(), 1);
  assert.equal(view.shownCategory(), "supplements");
});
