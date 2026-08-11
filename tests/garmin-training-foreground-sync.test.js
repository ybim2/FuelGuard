const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "training-mode.js"), "utf8");

function row(id, status, updatedAt, extra = {}) {
  return {
    id,
    user_id: "athlete-a",
    title: "Garmin training",
    session_type: "other",
    status,
    started_at: "2026-08-11T10:00:00.000Z",
    ended_at: status === "completed" ? "2026-08-11T11:00:00.000Z" : null,
    created_at: "2026-08-11T10:00:00.000Z",
    updated_at: updatedAt,
    ...extra
  };
}

function session(id, status, updatedAt, extra = {}) {
  return {
    id,
    title: "Training",
    sessionType: "other",
    status,
    startedAt: "2026-08-11T10:00:00.000Z",
    endedAt: status === "completed" ? "2026-08-11T11:00:00.000Z" : null,
    createdAt: "2026-08-11T10:00:00.000Z",
    updatedAt,
    dirty: false,
    ...extra
  };
}

function clientFor(resultFactory) {
  return {
    from(table) {
      assert.equal(table, "fuel_training_mode_sessions");
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        limit() { return resultFactory(); }
      };
      return query;
    }
  };
}

function loadTraining({ rows = [], training = null, userId = "athlete-a", client = null } = {}) {
  const events = [];
  let saves = 0;
  let syncs = 0;
  const trainingState = training || {
    presets: {},
    plan: {},
    estimatedDurationMinutes: 60,
    activeSession: null,
    sessions: [],
    ownerUserId: userId,
    lastSyncedAt: "",
    lastError: ""
  };
  const gap = { trainingMode: trainingState, logs: [] };
  const document = {
    hidden: false,
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; }
  };
  const cloudClient = client || clientFor(() => Promise.resolve({ data: rows, error: null }));
  const window = {
    FuelGuardDomain: { escapeHtml: value => String(value || "") },
    fuelGuardCloud: {
      user: { id: userId },
      client: cloudClient,
      async syncNow() { syncs += 1; }
    },
    addEventListener() {},
    dispatchEvent(event) { events.push(event); },
    confirm() { return true; }
  };
  class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const sandbox = {
    window,
    document,
    navigator: { onLine: true },
    CustomEvent,
    console,
    Date,
    Intl,
    Map,
    Set,
    Object,
    Array,
    Promise,
    crypto: { randomUUID: () => "10000000-1000-4000-8000-100000000001" },
    fuelGapState: () => gap,
    save: () => { saves += 1; },
    requestAnimationFrame: () => 1,
    setInterval: () => 1,
    clearInterval() {}
  };
  vm.runInNewContext(source, sandbox, { filename: "training-mode.js" });
  return {
    api: window.FuelGuardTrainingMode,
    cloud: window.fuelGuardCloud,
    events,
    gap,
    get saves() { return saves; },
    get syncs() { return syncs; }
  };
}

test("canonical Garmin start becomes the Athlete active session without a reload", async () => {
  const loaded = loadTraining({ rows: [row("garmin-start", "active", "2026-08-11T10:00:01.000Z")] });
  const result = await loaded.api.refreshCanonicalSessions();

  assert.equal(result.status, "synced");
  assert.equal(result.transition, "started");
  assert.equal(loaded.api.activeSession().id, "garmin-start");
  assert.equal(loaded.api._test.statusMessage(), "Training Mode started from Garmin.");
  assert.equal(loaded.syncs, 1);
});

test("canonical Garmin stop exits Athlete Training Mode and notifies completion once", async () => {
  const active = session("garmin-stop", "active", "2026-08-11T10:00:01.000Z");
  const training = {
    presets: {}, plan: {}, estimatedDurationMinutes: 60,
    activeSession: active, sessions: [active], ownerUserId: "athlete-a", lastSyncedAt: "", lastError: ""
  };
  const loaded = loadTraining({ rows: [row("garmin-stop", "completed", "2026-08-11T11:00:01.000Z")], training });

  const first = await loaded.api.refreshCanonicalSessions();
  const second = await loaded.api.refreshCanonicalSessions();

  assert.equal(first.transition, "ended");
  assert.equal(second.transition, "none");
  assert.equal(loaded.api.activeSession(), null);
  assert.equal(loaded.api._test.statusMessage(), "Training Mode ended from Garmin.");
  assert.equal(loaded.events.filter(event => event.type === "fuelguard:training-session-ended").length, 1);
});

test("canonical reconciliation preserves newer local intent but never resurrects over a newer Garmin result", () => {
  const loaded = loadTraining();
  const reconcile = loaded.api._test.reconcileCanonicalSessions;
  const pendingLocalEnd = session("same", "completed", "2026-08-11T11:00:02.000Z", { dirty: true });
  const olderRemoteActive = loaded.api._test.sessionFromRow(row("same", "active", "2026-08-11T11:00:01.000Z"));
  const localWins = reconcile([pendingLocalEnd], [olderRemoteActive]);
  assert.equal(localWins.activeSession, null);
  assert.equal(localWins.sessions[0].status, "completed");

  const staleLocalActive = session("same", "active", "2026-08-11T11:00:01.000Z", { dirty: true });
  const newerRemoteEnd = loaded.api._test.sessionFromRow(row("same", "completed", "2026-08-11T11:00:03.000Z"));
  const remoteWins = reconcile([staleLocalActive], [newerRemoteEnd]);
  assert.equal(remoteWins.activeSession, null);
  assert.equal(remoteWins.sessions[0].status, "completed");
  assert.equal(remoteWins.sessions[0].dirty, false);
});

test("a different canonical active session replaces conflicting local state", () => {
  const loaded = loadTraining();
  const local = session("local-active", "active", "2026-08-11T10:00:05.000Z", { dirty: true });
  const remote = loaded.api._test.sessionFromRow(row("garmin-active", "active", "2026-08-11T10:00:04.000Z"));
  const result = loaded.api._test.reconcileCanonicalSessions([local], [remote]);

  assert.equal(result.conflictingLocalActive, true);
  assert.equal(result.activeSession.id, "garmin-active");
  assert.equal(result.sessions.some(item => item.id === "local-active"), false);
});

test("an account switch discards an in-flight session read from the previous athlete", async () => {
  let resolveRead;
  const read = new Promise(resolve => { resolveRead = resolve; });
  const clientA = clientFor(() => read);
  const loaded = loadTraining({ client: clientA });
  const pending = loaded.api.refreshCanonicalSessions();
  loaded.cloud.user = { id: "athlete-b" };
  loaded.cloud.client = clientFor(() => Promise.resolve({ data: [], error: null }));
  resolveRead({ data: [row("private-athlete-a", "active", "2026-08-11T10:00:01.000Z")], error: null });

  const result = await pending;
  assert.equal(result.status, "stale");
  assert.equal(loaded.api.activeSession(), null);
  assert.equal(loaded.gap.trainingMode.sessions.length, 0);
});

test("foreground refresh is bounded to visible online authenticated Athlete pages", () => {
  const loaded = loadTraining();
  assert.equal(loaded.api._test.foregroundRefreshEligible(), true);
  loaded.cloud.user = null;
  assert.equal(loaded.api._test.foregroundRefreshEligible(), false);
});
