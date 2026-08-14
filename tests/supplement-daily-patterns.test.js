const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "supplement-rhythm.js"), "utf8");

function fixture({ plans = [], events = [] } = {}) {
  const inserted = [];
  const emitted = [];
  const listeners = new Map();
  let settingsClicks = 0;
  let shownCategory = "";
  const elements = new Map();
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
  element("supplementQuickLogSheet", { hidden: true });
  element("supplementQuickChoices");
  element("supplementQuickLogTitle");
  element("supplementQuickLogContext");
  element("supplementQuickTakenAt");
  element("supplementQuickStatus");
  element("supplementQuickConfirm");
  element("graphLogSupplementButton");
  element("foodLogCooldownMessage");
  const quickTime = { hidden: false };
  const body = { classList: { add() {}, remove() {} } };
  const rowsByTable = {
    fuel_supplement_plans: plans,
    fuel_supplement_schedule_slots: [],
    fuel_supplement_events: events
  };
  const client = {
    from(table) {
      let operation = "select";
      let payload = null;
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        insert(rows) { operation = "insert"; payload = Array.isArray(rows) ? rows : [rows]; return builder; },
        then(resolve, reject) {
          const result = operation === "insert"
            ? { data: payload.map(row => ({ ...row, created_at: row.taken_at })), error: null }
            : { data: rowsByTable[table] || [], error: null };
          if (operation === "insert") inserted.push(...result.data);
          return Promise.resolve(result).then(resolve, reject);
        }
      };
      return builder;
    }
  };
  const document = {
    hidden: false,
    body,
    checkedPlans: [],
    addEventListener(type, listener) { listeners.set(type, listener); },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      if (selector === ".supplement-quick-time") return quickTime;
      if (selector === '[data-open-screen="checklist"]') return { click() { settingsClicks += 1; } };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-supplement-quick-plan]:checked") return this.checkedPlans;
      return [];
    }
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
    addEventListener() {},
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
    crypto: { randomUUID: () => `a1600000-0000-4000-8000-${String(inserted.length + 1).padStart(12, "0")}` },
    globalThis: {}
  };
  context.globalThis.crypto = context.crypto;
  vm.runInNewContext(source, context, { filename: "supplement-rhythm.js" });
  return {
    api: window.FuelGuardSupplementRhythm,
    document,
    elements,
    emitted,
    inserted,
    listeners,
    settingsClicks: () => settingsClicks,
    shownCategory: () => shownCategory
  };
}

function clickTarget(selector) {
  return { closest(candidate) { return candidate === selector ? { dataset: {} } : null; } };
}

test("one configured supplement logs immediately with the current timestamp", async () => {
  const started = Date.now();
  const view = fixture({ plans: [{ id: "plan-1", user_id: "athlete-1", supplement_type: "creatine", label: "Creatine", active: true }] });
  await view.api.load();
  await view.api.openQuickLog();
  assert.equal(view.inserted.length, 1);
  assert.equal(view.inserted[0].user_id, "athlete-1");
  assert.equal(view.inserted[0].supplement_plan_id, "plan-1");
  assert.equal(view.inserted[0].event_status, "taken");
  assert.equal(view.inserted[0].source, "manual");
  assert.ok(new Date(view.inserted[0].taken_at).getTime() >= started);
  assert.equal(view.settingsClicks(), 0);
  assert.equal(view.api.eventsForDay(view.inserted[0].event_local_date)[0].supplementLabel, "Creatine");
  assert.ok(view.emitted.some(event => event.type === "fuelguard:supplement-events-changed"));
});

test("multiple supplements open an unselected lightweight picker and persist selected moments", async () => {
  const view = fixture({ plans: [
    { id: "plan-1", user_id: "athlete-1", supplement_type: "creatine", label: "Creatine", active: true },
    { id: "plan-2", user_id: "athlete-1", supplement_type: "vitamin_d", label: "Vitamin D", active: true }
  ] });
  await view.api.load();
  await view.api.openQuickLog();
  const choices = view.elements.get("supplementQuickChoices").innerHTML;
  assert.match(choices, /Creatine/);
  assert.match(choices, /Vitamin D/);
  assert.doesNotMatch(choices, / checked/);
  assert.equal(view.elements.get("supplementQuickLogSheet").hidden, false);
  assert.equal(view.inserted.length, 0);

  view.document.checkedPlans = [{ value: "plan-1" }, { value: "plan-2" }];
  await view.listeners.get("click")({ target: clickTarget("#supplementQuickConfirm") });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.inserted.length, 2);
  assert.equal(view.elements.get("supplementQuickLogSheet").hidden, true);
});

test("an unconfigured Daily action explains setup without automatically opening Settings", async () => {
  const view = fixture();
  await view.api.load();
  await view.api.openQuickLog();
  assert.equal(view.settingsClicks(), 0);
  assert.equal(view.elements.get("supplementQuickLogSheet").hidden, false);
  assert.match(view.elements.get("supplementQuickChoices").innerHTML, /No supplements configured yet/);

  await view.listeners.get("click")({ target: clickTarget("[data-open-supplement-settings]") });
  assert.equal(view.settingsClicks(), 1);
  assert.equal(view.shownCategory(), "supplements");
});
