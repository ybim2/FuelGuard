const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

process.env.TZ = "Europe/London";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INCIDENT_ROWS = [
  ["11111111-1111-4111-8111-111111111111", "2026-08-08T09:53:00.000Z", "fuel", "garmin", "garmin-1053-fuel"],
  ["22222222-2222-4222-8222-222222222222", "2026-08-08T09:53:00.000Z", "hydration", "garmin", "garmin-1053-hydration"],
  ["33333333-3333-4333-8333-333333333333", "2026-08-08T12:21:00.000Z", "fuel", "garmin", "garmin-1321-fuel"],
  ["44444444-4444-4444-8444-444444444444", "2026-08-08T14:39:00.000Z", "hydration", "garmin", "garmin-1539-hydration"],
  ["55555555-5555-4555-8555-555555555555", "2026-08-08T16:02:00.000Z", "hydration", "garmin", "garmin-1702-hydration"]
].map(([id, loggedAt, type, source, externalEventId]) => ({
  id,
  user_id: USER_ID,
  logged_at: loggedAt,
  type,
  source,
  external_event_id: externalEventId,
  day_type: "work",
  training_session: "none",
  notes: null,
  created_at: loggedAt
}));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class FakeQuery {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.operation = "select";
    this.payload = null;
    this.filters = [];
    this.inFilter = null;
    this.orderColumn = "";
  }

  select() {
    return this;
  }

  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }

  in(column, values) {
    this.inFilter = [column, values];
    return this;
  }

  order(column) {
    this.orderColumn = column;
    return this;
  }

  upsert(payload) {
    this.operation = "upsert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  insert(payload) {
    this.operation = "insert";
    this.payload = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  maybeSingle() {
    return this.execute().then(result => ({ ...result, data: result.data?.[0] || null }));
  }

  single() {
    return this.maybeSingle();
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }

  async execute() {
    if (this.table !== "fuel_logs") return { data: [], error: null };
    if (this.database.failNextRead && this.operation === "select") {
      this.database.failNextRead = false;
      return { data: null, error: new Error("simulated read failure") };
    }
    if (this.database.failNextWrite && ["upsert", "insert"].includes(this.operation)) {
      this.database.failNextWrite = false;
      return { data: null, error: new Error("simulated write failure") };
    }

    if (this.operation === "delete") {
      this.database.rows = this.database.rows.filter(row => !this.matches(row));
      return { data: [], error: null };
    }

    if (["upsert", "insert"].includes(this.operation)) {
      const saved = this.payload.map(input => {
        const row = {
          ...clone(input),
          id: input.id || this.database.nextId(),
          created_at: input.created_at || input.logged_at
        };
        const duplicate = this.database.rows.find(existing => existing.id === row.id
          || (row.external_event_id && existing.user_id === row.user_id && existing.source === row.source && existing.external_event_id === row.external_event_id));
        if (duplicate) Object.assign(duplicate, row);
        else this.database.rows.push(row);
        return clone(duplicate || row);
      });
      return { data: saved, error: null };
    }

    let rows = this.database.rows.filter(row => this.matches(row));
    if (this.orderColumn) rows.sort((a, b) => String(a[this.orderColumn] || "").localeCompare(String(b[this.orderColumn] || "")));
    return { data: clone(rows), error: null };
  }

  matches(row) {
    const equal = this.filters.every(([column, value]) => row[column] === value);
    const inside = !this.inFilter || this.inFilter[1].includes(row[this.inFilter[0]]);
    return equal && inside;
  }
}

function createDatabase(rows = []) {
  let sequence = 100;
  return {
    rows: clone(rows),
    failNextRead: false,
    failNextWrite: false,
    nextId() {
      sequence += 1;
      return `99999999-9999-4999-8999-${String(sequence).padStart(12, "0")}`;
    }
  };
}

function createHarness({ database = createDatabase(), gap = null, configured = true, online = true } = {}) {
  const state = gap || {
    logs: [],
    demandBlocks: [],
    workBreaks: [],
    targets: {},
    cloud: {
      pendingDeleteIds: [],
      pendingDemandDeleteIds: [],
      pendingWorkBreakDeleteIds: [],
      lastSyncedAt: "",
      lastError: ""
    }
  };
  let saveCount = 0;
  let renderCount = 0;
  const listeners = new Map();
  const client = {
    auth: {
      async getSession() {
        return { data: { session: { access_token: "test-session", user: { id: USER_ID, email: "test@example.com" } } }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      }
    },
    from(table) {
      return new FakeQuery(database, table);
    }
  };
  const document = {
    title: "Fuel Guard",
    hidden: false,
    addEventListener(type, callback) {
      listeners.set(`document:${type}`, callback);
    }
  };
  const navigator = { onLine: online };
  const window = {
    FUEL_GUARD_SUPABASE_CONFIG: configured ? { url: "https://example.supabase.co", anonKey: "public-test-key" } : {},
    supabase: configured ? { createClient: () => client } : undefined,
    addEventListener(type, callback) {
      listeners.set(`window:${type}`, callback);
    },
    dispatchEvent() {},
    location: { origin: "https://fuel-guard.example", pathname: "/", search: "", hash: "" },
    history: { replaceState() {} }
  };
  const context = {
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    },
    URLSearchParams,
    console,
    document,
    navigator,
    requestAnimationFrame() {},
    window,
    fuelGapState: () => state,
    fuelLogDate(log) {
      const date = new Date(log?.timestamp || log?.logged_at || log?.created_at || "");
      return Number.isNaN(date.getTime()) ? null : date;
    },
    todayKey(date = new Date()) {
      const local = new Date(date);
      return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
    },
    save() {
      saveCount += 1;
    },
    renderAll() {
      renderCount += 1;
    }
  };
  context.globalThis = context;
  window.window = window;
  window.document = document;
  window.navigator = navigator;
  window.requestAnimationFrame = context.requestAnimationFrame;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "fuel-supabase.js"), "utf8"), context, { filename: "fuel-supabase.js" });
  return {
    cloud: window.fuelGuardCloud,
    database,
    state,
    configure() {
      window.FUEL_GUARD_SUPABASE_CONFIG = { url: "https://example.supabase.co", anonKey: "public-test-key" };
      window.supabase = { createClient: () => client };
    },
    setOnline(value) {
      navigator.onLine = value;
    },
    get saveCount() {
      return saveCount;
    },
    get renderCount() {
      return renderCount;
    }
  };
}

function pendingManual(id, timestamp = "2026-08-08T17:15:00.000Z") {
  return {
    id,
    localId: id,
    timestamp,
    type: "fuel",
    source: "manual",
    dayType: "work",
    trainingSession: "none",
    syncStatus: "pending"
  };
}

test("incident fixture retries initialization and restores five cloud logs before preserving a sixth manual log", async () => {
  const database = createDatabase(INCIDENT_ROWS);
  const app = createHarness({ database, configured: false });

  assert.equal((await app.cloud.init()).status, "not_ready");
  assert.equal(app.state.logs.length, 0);

  app.configure();
  const initialSync = await app.cloud.init();
  assert.equal(initialSync.status, "synced");
  assert.equal(app.state.logs.length, 5);
  assert.equal(app.state.logs.map(log => log.source).join(","), "garmin,garmin,garmin,garmin,garmin");

  const manual = pendingManual("66666666-6666-4666-8666-666666666666");
  app.state.logs.push(manual);
  const write = await app.cloud.saveLog(manual);
  assert.equal(write.status, "synced");
  assert.equal(write.persisted, true);
  assert.equal(app.database.rows.length, 6);
  assert.equal(app.state.logs.length, 6);
  assert.equal(app.state.logs.filter(log => log.source === "garmin").length, 5);
  assert.equal(app.state.logs.filter(log => log.source === "manual").length, 1);

  const reopened = createHarness({ database });
  await reopened.cloud.init();
  assert.equal(reopened.state.logs.length, 6);
  assert.equal(reopened.state.logs.filter(log => log.source === "garmin").length, 5);
  assert.equal(reopened.state.logs.filter(log => log.source === "manual").length, 1);
});

test("reconciliation keeps legitimate same-time events and dedupes only stable cloud or external identities", () => {
  const app = createHarness({ configured: false });
  const duplicateContent = {
    ...INCIDENT_ROWS[0],
    id: "77777777-7777-4777-8777-777777777777",
    external_event_id: "garmin-separate-button-press"
  };
  const duplicateRetry = {
    ...INCIDENT_ROWS[0],
    id: INCIDENT_ROWS[0].id
  };

  const separate = app.cloud._test.reconcileLogTimeline([INCIDENT_ROWS[0], duplicateContent], []);
  assert.equal(separate.logs.length, 2, "separate stable identities must not be collapsed by timestamp/type/content");

  const sameExternalIdButDistinctPersistedRows = app.cloud._test.reconcileLogTimeline([
    INCIDENT_ROWS[0],
    { ...INCIDENT_ROWS[0], id: "88888888-8888-4888-8888-888888888888" }
  ], []);
  assert.equal(sameExternalIdButDistinctPersistedRows.logs.length, 2, "every distinct database UUID returned by Supabase must remain visible");

  const retry = app.cloud._test.reconcileLogTimeline([INCIDENT_ROWS[0], duplicateRetry], []);
  assert.equal(retry.logs.length, 1, "the same persisted cloud UUID remains idempotent");
});

test("PWA update reconciliation preserves cloud Garmin, cloud manual, and one pending local event exactly once", async () => {
  const cloudManual = {
    ...INCIDENT_ROWS[2],
    id: "99999999-9999-4999-8999-999999999991",
    source: "manual",
    external_event_id: null,
    logged_at: "2026-08-07T18:00:00.000Z"
  };
  const pending = pendingManual("99999999-9999-4999-8999-999999999992", "2026-08-08T18:00:00.000Z");
  const database = createDatabase([INCIDENT_ROWS[0], cloudManual]);
  const app = createHarness({ database, gap: {
    logs: [pending],
    demandBlocks: [],
    workBreaks: [],
    targets: {},
    cloud: { pendingDeleteIds: [], pendingDemandDeleteIds: [], pendingWorkBreakDeleteIds: [] }
  } });

  await app.cloud.init();
  assert.equal(app.database.rows.length, 3);
  assert.equal(app.state.logs.length, 3);
  assert.equal(app.state.logs.filter(log => log.source === "garmin").length, 1);
  assert.equal(app.state.logs.filter(log => log.source === "manual").length, 2);

  await app.cloud.syncNow();
  assert.equal(app.database.rows.length, 3, "a second update/retry must not duplicate the pending event");
  assert.equal(app.state.logs.length, 3);
});

test("failed manual writes remain explicit and retry without hiding cached cloud history", async () => {
  const database = createDatabase(INCIDENT_ROWS);
  const app = createHarness({ database });
  await app.cloud.init();
  const manual = pendingManual("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  app.state.logs.push(manual);
  database.failNextWrite = true;

  const failed = await app.cloud.saveLog(manual);
  assert.equal(failed.status, "error");
  assert.equal(failed.persisted, false);
  assert.equal(manual.syncStatus, "error");
  assert.equal(app.state.logs.length, 6);
  assert.equal(app.state.logs.filter(log => log.source === "garmin").length, 5);
  assert.equal(database.rows.length, 5);

  const retried = await app.cloud.syncNow();
  assert.equal(retried.status, "synced");
  assert.equal(database.rows.length, 6);
  assert.equal(app.state.logs.length, 6);
});

test("offline manual logs remain pending, then join cloud history once online", async () => {
  const database = createDatabase(INCIDENT_ROWS);
  const app = createHarness({ database, online: false });
  const manual = pendingManual("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  app.state.logs.push(manual);
  const offline = await app.cloud.saveLog(manual);
  assert.equal(offline.status, "pending");
  assert.equal(database.rows.length, 5);

  app.setOnline(true);
  await app.cloud.init();
  assert.equal(database.rows.length, 6);
  assert.equal(app.state.logs.length, 6);
  await app.cloud.syncNow();
  assert.equal(database.rows.length, 6);
});

test("Europe/London local-day filtering keeps BST midnight events on the intended day", () => {
  const context = {
    localStorage: { getItem: () => null, setItem() {} },
    console,
    Date,
    Math,
    JSON,
    globalThis: null
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app-state.js"), "utf8"), context, { filename: "app-state.js" });
  assert.equal(vm.runInContext('todayKey(new Date("2026-07-01T23:30:00.000Z"))', context), "2026-07-02");
  assert.equal(vm.runInContext('todayKey(new Date("2026-03-29T23:30:00.000Z"))', context), "2026-03-30");
  assert.equal(vm.runInContext('todayKey(new Date("2026-12-31T23:30:00.000Z"))', context), "2026-12-31");
});

test("Log status and timeline render from the unified state without source filtering", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fuel-beta.js"), "utf8");
  function body(name, nextName) {
    const start = source.indexOf(`function ${name}`);
    const end = source.indexOf(`\n  function ${nextName}`, start);
    assert.notEqual(start, -1, `${name} should exist`);
    assert.notEqual(end, -1, `${nextName} should follow ${name}`);
    return source.slice(start, end);
  }
  const dated = body("logsWithDates", "logsForDay");
  const daily = body("logsForDay", "fuelLogsForDay");
  const timeline = body("todayActualTimelineItems", "todaySuggestedTimelineItems");
  const status = body("renderCurrentFuellingStatus", "hydrationSuggestionForDay");

  assert.match(dated, /betaState\(\)\.logs/);
  assert.doesNotMatch(dated, /source\s*===|source\s*!==/);
  assert.match(daily, /logsWithDates\(\)/);
  assert.doesNotMatch(daily, /source\s*===|source\s*!==/);
  assert.match(timeline, /logsForDay\(key\)/);
  assert.doesNotMatch(timeline, /source\s*===|source\s*!==/);
  assert.match(status, /logsForDay\(key\)/);
});

test("service-worker update is atomic and never caches authenticated API responses or clears local logs", () => {
  const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
  const pwa = fs.readFileSync(path.join(__dirname, "..", "app-pwa.js"), "utf8");
  const index = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.match(sw, /mobile-pwa-v137-accepted-integration/);
  assert.match(sw, /cache\.addAll\(appShellRequests\(\)\)/);
  assert.match(sw, /new Request\([^\n]+\{ cache: "reload" \}\)/);
  assert.match(sw, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.doesNotMatch(sw, /localStorage|indexedDB|fuel_logs/);
  assert.match(pwa, /updateViaCache: "none"/);
  assert.match(index, /fuel-supabase\.js\?v=mobile-pwa-v137-accepted-integration/);
});

test("ordinary startup and synchronization do not issue fuel-log DELETE operations", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "fuel-supabase.js"), "utf8");
  const syncBody = source.slice(source.indexOf("async function syncNow"), source.indexOf("async function saveLog"));
  const saveBody = source.slice(source.indexOf("async function saveLog"), source.indexOf("function syncLogsForDay"));
  assert.doesNotMatch(syncBody, /\.from\(TABLE\)\s*\.delete\(\)/);
  assert.doesNotMatch(saveBody, /\.delete\(\)/);
  assert.match(source, /async function deleteLog/);
  assert.match(source, /async function clearCloudLogs/);
});
