const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const createCoachPlatform = require("../coach/coach-platform.js");
const rootDir = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(rootDir, file), "utf8");
}

function fakeDocument() {
  const dispatched = [];
  const hosts = new Map();
  const document = {
    dispatched,
    createElement() {
      const element = {
        className: "",
        dataset: {},
        children: [],
        parentNode: null,
        appendChild(child) {
          const previous = this.children.indexOf(child);
          if (previous >= 0) this.children.splice(previous, 1);
          child.parentNode = this;
          this.children.push(child);
          return child;
        },
        querySelector(selector) {
          const match = selector.match(/^\[data-coach-feature="([^"]+)"\]$/);
          return match ? this.children.find(child => child.dataset.coachFeature === match[1]) || null : null;
        },
        remove() {
          if (!this.parentNode) return;
          const index = this.parentNode.children.indexOf(this);
          if (index >= 0) this.parentNode.children.splice(index, 1);
          this.parentNode = null;
        }
      };
      element.ownerDocument = document;
      return element;
    },
    querySelector(selector) {
      const hostMatch = selector.match(/^\[data-coach-feature-host="([^"]+)"\]$/);
      if (hostMatch) return hosts.get(hostMatch[1]) || null;
      const featureMatch = selector.match(/^\[data-coach-feature="([^"]+)"\]$/);
      if (!featureMatch) return null;
      for (const host of hosts.values()) {
        const feature = host.querySelector(selector);
        if (feature) return feature;
      }
      return null;
    },
    dispatchEvent(event) {
      dispatched.push(event);
      return true;
    }
  };
  ["dashboard", "athletes", "reports", "settings"].forEach(name => hosts.set(name, document.createElement("div")));
  return { document, hosts };
}

function fakeRoot(document) {
  return {
    document,
    queueMicrotask() {},
    console: { error() {} },
    CustomEvent: class CustomEvent {
      constructor(type, options = {}) {
        this.type = type;
        this.detail = options.detail;
      }
    }
  };
}

function queryClient() {
  const calls = [];
  function builder() {
    const query = {
      then(resolve) {
        return Promise.resolve(resolve({ data: [{ id: "row-1" }], error: null }));
      }
    };
    ["select", "insert", "update", "upsert", "delete", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "overlaps", "order", "limit", "range", "single", "maybeSingle"].forEach(method => {
      query[method] = (...args) => {
        calls.push([method, ...args]);
        return query;
      };
    });
    return query;
  }
  return {
    calls,
    auth: { getSession() { throw new Error("The raw auth client must not be public."); } },
    from(table) {
      calls.push(["from", table]);
      return builder();
    },
    rpc(name, args, options) {
      calls.push(["rpc", name, args, options]);
      return Promise.resolve({ data: { ok: true }, error: null });
    }
  };
}

function connectedPlatform(overrides = {}) {
  const { document, hosts } = fakeDocument();
  const client = queryClient();
  const state = {
    client,
    session: {
      access_token: "secret-access-token",
      refresh_token: "secret-refresh-token",
      user: {
        id: "coach-1",
        email: "coach@example.com",
        user_metadata: { privateFlag: true }
      }
    },
    profile: { user_id: "coach-1", display_name: "Coach One", password: "never-public" },
    relationships: [{ id: "relation-1", coach_id: "coach-1", athlete_id: "athlete-1", status: "active" }],
    roster: [{ athlete: { userId: "athlete-1", displayName: "Athlete One" }, flags: [] }],
    athleteProfiles: [{ user_id: "athlete-1", display_name: "Athlete One" }],
    logs: [{ id: "log-1", userId: "athlete-1", type: "fuel" }],
    targets: [{ user_id: "athlete-1", maximum_fuel_gap_minutes: 180 }],
    reports: [{ id: "report-1", athlete_id: "athlete-1" }],
    interventions: [{ id: "intervention-1", athlete_id: "athlete-1" }],
    selectedAthleteId: "athlete-1",
    ...overrides.state
  };
  const instance = createCoachPlatform({ root: fakeRoot(document), document });
  let controller;
  const refreshCalls = [];
  const selectionCalls = [];
  controller = instance.bridge.connect({
    readState: () => state,
    getClient: () => client,
    refresh: async ({ reason }) => {
      refreshCalls.push(reason);
      controller.publishData(reason);
    },
    selectAthlete: async athleteId => {
      selectionCalls.push(athleteId);
      state.selectedAthleteId = athleteId;
      return true;
    }
  });
  return { ...instance, controller, state, client, document, hosts, refreshCalls, selectionCalls };
}

test("Coach platform exposes only frozen public state without auth credentials", () => {
  const { api } = connectedPlatform();
  const state = api.getState();

  assert.deepEqual(Object.keys(state), [
    "revision",
    "loaded",
    "coach",
    "coachProfile",
    "relationships",
    "roster",
    "athleteProfiles",
    "logs",
    "targets",
    "reports",
    "interventions",
    "selectedAthleteId"
  ]);
  assert.deepEqual(state.coach, { id: "coach-1", email: "coach@example.com" });
  assert.equal(state.session, undefined);
  assert.equal(state.client, undefined);
  assert.equal(state.coachProfile.password, undefined);
  assert.equal(api.auth, undefined);
  assert.equal(api.data.auth, undefined);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.roster), true);
  assert.throws(() => state.roster.push({}));
  assert.doesNotMatch(JSON.stringify({ api: Object.keys(api), state }), /secret-access-token|secret-refresh-token|never-public/);
});

test("Coach platform hides retained athlete data when no coach is authenticated", async () => {
  const { api, state } = connectedPlatform();
  state.session = null;

  assert.deepEqual(api.getState().roster, []);
  assert.deepEqual(api.getState().logs, []);
  assert.equal(api.getState().coach, null);
  await assert.rejects(api.data.select("fuel_logs"), /authentication is required/);
});

test("Coach platform refresh hook emits loaded then refreshed events", async () => {
  const { api, controller, refreshCalls, document } = connectedPlatform();
  const loaded = [];
  const refreshed = [];
  api.on(api.events.DATA_LOADED, detail => loaded.push(detail));
  api.on(api.events.DATA_REFRESHED, detail => refreshed.push(detail));

  controller.publishData("initial-load");
  await api.refresh("feature-mutation");

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].reason, "initial-load");
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].reason, "feature-mutation");
  assert.deepEqual(refreshCalls, ["feature-mutation"]);
  assert.equal(refreshed[0].state.revision, 2);
  assert.deepEqual(document.dispatched.map(event => event.type), ["coach-data-loaded", "coach-data-refreshed"]);
});

test("Coach feature registration renders in deterministic order with public state", () => {
  const { api, controller, hosts } = connectedPlatform();
  const received = [];
  const removeLater = api.registerFeature({
    id: "later-feature",
    host: "dashboard",
    order: 200,
    render(context) { received.push(["later", context]); }
  });
  api.registerFeature({
    id: "earlier-feature",
    host: "dashboard",
    order: 100,
    render(context) { received.push(["earlier", context]); }
  });

  controller.renderFeatures();

  assert.deepEqual(hosts.get("dashboard").children.map(child => child.dataset.coachFeature), ["earlier-feature", "later-feature"]);
  assert.deepEqual(received.map(item => item[0]), ["earlier", "later"]);
  assert.equal(received[0][1].state.session, undefined);
  assert.equal(received[0][1].state.client, undefined);
  assert.equal(Object.isFrozen(received[0][1].state), true);
  assert.equal(received[0][1].platform, api);
  assert.throws(() => api.registerFeature({ id: "earlier-feature", host: "dashboard" }), /already registered/);
  removeLater();
  assert.deepEqual(hosts.get("dashboard").children.map(child => child.dataset.coachFeature), ["earlier-feature"]);
});

test("Coach athlete selection is limited to the authorized roster and emits safe events", async () => {
  const { api, state, selectionCalls } = connectedPlatform({
    state: {
      roster: [
        { athlete: { userId: "athlete-1", displayName: "Athlete One" }, flags: [] },
        { athlete: { userId: "athlete-2", displayName: "Athlete Two" }, flags: [] }
      ]
    }
  });
  const selectedEvents = [];
  api.on(api.events.ATHLETE_SELECTED, detail => selectedEvents.push(detail));

  assert.equal(await api.selectAthlete("athlete-2"), true);
  assert.equal(state.selectedAthleteId, "athlete-2");
  assert.deepEqual(selectionCalls, ["athlete-2"]);
  assert.equal(selectedEvents[0].athleteId, "athlete-2");
  assert.equal(selectedEvents[0].athlete.athlete.displayName, "Athlete Two");
  assert.equal(selectedEvents[0].state.session, undefined);
  assert.equal(await api.selectAthlete("not-authorized"), false);
  assert.equal(selectedEvents.length, 1);
});

test("Coach data facade executes RLS-backed operations without exposing the Supabase auth client", async () => {
  const { api, client } = connectedPlatform();

  const result = await api.data.select("fuel_logs", {
    columns: "id,user_id",
    filters: [{ column: "user_id", operator: "eq", value: "athlete-1" }],
    order: { column: "logged_at", ascending: false },
    limit: 10
  });
  const rpcResult = await api.data.rpc("fuel_coach_example", { athlete_id: "athlete-1" });

  assert.deepEqual(result.data, [{ id: "row-1" }]);
  assert.deepEqual(rpcResult.data, { ok: true });
  assert.deepEqual(client.calls.slice(0, 5).map(call => call[0]), ["from", "select", "eq", "order", "limit"]);
  assert.equal(api.data.auth, undefined);
  await assert.rejects(api.data.update("fuel_logs", { type: "fuel" }), /require at least one filter/);
  await assert.rejects(api.data.remove("fuel_logs"), /require at least one filter/);
});

test("Coach feature boundaries load after the core platform in deterministic order", () => {
  const html = read("coach/index.html");
  const core = read("coach/coach-beta.js");
  const scripts = [
    "coach-platform.js",
    "coach-beta.js",
    "coach-attention.js",
    "coach-intervention-workflow.js",
    "coach-team-intelligence.js",
    "coach-review-scheduling.js",
    "coach-team-structure.js",
    "coach-training-schedule.js"
  ];
  const positions = scripts.map(script => html.indexOf(`src="${script}?`));

  positions.forEach((position, index) => assert.notEqual(position, -1, `${scripts[index]} should be loaded`));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions);
  ["dashboard", "athletes", "reports", "settings"].forEach(host => {
    assert.match(html, new RegExp(`data-coach-feature-host="${host}"`));
  });
  assert.match(core, /FuelGuardCoachPlatformBridge\?\.connect/);
  assert.match(core, /delete window\.FuelGuardCoachPlatformBridge/);
  assert.match(core, /platformController\?\.publishData\(reason\)/);
  assert.match(core, /platformController\?\.athleteSelected/);
  assert.match(core, /loadCoachData\(\{ reason: "sharing-requested" \}\)/);
  assert.match(core, /loadCoachData\(\{ reason: "report-created" \}\)/);
  assert.match(core, /loadCoachData\(\{ reason: "intervention-created" \}\)/);
  assert.match(read("coach/coach-attention.js"), /id: "attention"[\s\S]*host: "dashboard"[\s\S]*order: 100/);
  assert.match(read("coach/coach-training-schedule.js"), /id: "training-schedule"[\s\S]*host: "athletes"[\s\S]*order: 600/);
});
