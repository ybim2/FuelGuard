const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// Garmin tests retain deliberate Training context while Work remains schedule-inferred.

const auth = require("../lib/garmin-auth.js");
const garminLogHandler = require("../api/garmin/log.js");
const { garminTrainingHandler } = garminLogHandler;

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "server-only-secret",
  GARMIN_TOKEN_PEPPER: "test-pepper"
};

const USERS = {
  "user-token-a": { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com" },
  "user-token-b": { id: "22222222-2222-4222-8222-222222222222", email: "b@example.com" }
};

function withEnv(callback) {
  const previous = { ...process.env };
  process.env = { ...previous, ...BASE_ENV };
  return Promise.resolve(callback()).finally(() => {
    process.env = previous;
  });
}

function responseMock() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(value) {
      this.body = String(value || "");
      this.json = this.body ? JSON.parse(this.body) : null;
    }
  };
}

async function call(handler, { method = "POST", token = null, body = {}, query = {} } = {}) {
  const req = {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body,
    query
  };
  const res = responseMock();
  await handler(req, res);
  return res;
}

function okJson(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data)
  };
}

function emptyJson(status = 204) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => ""
  };
}

class FakeSupabase {
  constructor() {
    this.authSessions = [];
    this.deviceTokens = [];
    this.logs = [];
    this.trainingModeSessions = [];
    this.workModeSessions = [];
    this.trainingCommands = [];
    this.failTrainingCommand = false;
    this.nextAuth = 1;
    this.nextDevice = 1;
    this.nextLog = 1;
    this.nextTraining = 1;
    this.fetch = this.fetch.bind(this);
  }

  apiToken(options) {
    const authHeader = options?.headers?.Authorization || options?.headers?.authorization || "";
    return String(authHeader).replace(/^Bearer\s+/i, "");
  }

  parse(url) {
    return new URL(String(url));
  }

  body(options) {
    return options?.body ? JSON.parse(options.body) : {};
  }

  match(row, query) {
    for (const [key, raw] of query.entries()) {
      if (["select", "order", "limit"].includes(key)) continue;
      if (key === "or" && raw.includes("fuel_guard_checkin:")) {
        const notes = row.notes;
        if (notes !== null && notes !== undefined
          && (String(notes).startsWith("fuel_guard_checkin:") || String(notes).includes("fuel_guard_event:crash"))) return false;
        continue;
      }
      if (raw === "is.null") {
        if (row[key] !== null && row[key] !== undefined) return false;
        continue;
      }
      if (raw.startsWith("in.(") && raw.endsWith(")")) {
        const expected = raw.slice(4, -1).split(",");
        if (!expected.includes(String(row[key]))) return false;
        continue;
      }
      if (raw.startsWith("eq.")) {
        const expected = raw.slice(3);
        if (String(row[key]) !== expected) return false;
      }
    }
    return true;
  }

  filter(rows, query) {
    let next = rows.filter(row => this.match(row, query));
    const order = query.get("order") || "";
    if (order.startsWith("created_at.desc")) {
      next = next.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    }
    if (order.startsWith("started_at.desc")) {
      next = next.slice().sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")));
    }
    if (order.startsWith("logged_at.desc")) {
      next = next.slice().sort((a, b) => String(b.logged_at || "").localeCompare(String(a.logged_at || "")));
    }
    const limit = Number(query.get("limit") || 0);
    return limit ? next.slice(0, limit) : next;
  }

  async fetch(url, options = {}) {
    const parsed = this.parse(url);
    const path = parsed.pathname;
    const method = String(options.method || "GET").toUpperCase();

    if (path === "/auth/v1/user") {
      const user = USERS[this.apiToken(options)];
      return user ? okJson(user) : okJson({ error: "invalid" }, 401);
    }

    if (path === "/rest/v1/garmin_auth_sessions") {
      if (method === "POST") {
        const row = {
          id: `auth-${this.nextAuth++}`,
          created_at: new Date(1700000000000 + this.nextAuth * 1000).toISOString(),
          ...this.body(options)
        };
        this.authSessions.push(row);
        return okJson([row], 201);
      }
      if (method === "GET") {
        return okJson(this.filter(this.authSessions, parsed.searchParams));
      }
      if (method === "PATCH") {
        const patch = this.body(options);
        const rows = this.authSessions.filter(row => this.match(row, parsed.searchParams));
        rows.forEach(row => Object.assign(row, patch));
        return okJson(rows);
      }
    }

    if (path === "/rest/v1/garmin_device_tokens") {
      if (method === "POST") {
        const row = {
          id: `device-${this.nextDevice++}`,
          created_at: new Date(1700000100000 + this.nextDevice * 1000).toISOString(),
          revoked_at: null,
          last_used_at: null,
          ...this.body(options)
        };
        this.deviceTokens.push(row);
        return okJson([row], 201);
      }
      if (method === "GET") {
        return okJson(this.filter(this.deviceTokens, parsed.searchParams));
      }
      if (method === "PATCH") {
        const patch = this.body(options);
        const rows = this.deviceTokens.filter(row => this.match(row, parsed.searchParams));
        rows.forEach(row => Object.assign(row, patch));
        return okJson(rows);
      }
    }

    if (path === "/rest/v1/fuel_logs") {
      if (method === "POST") {
        const body = this.body(options);
        const duplicate = this.logs.find(row => row.user_id === body.user_id && row.source === body.source && row.external_event_id === body.external_event_id);
        if (duplicate) {
          return okJson({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
        }
        const row = { id: `log-${this.nextLog++}`, created_at: new Date().toISOString(), ...body };
        this.logs.push(row);
        return okJson([row], 201);
      }
      if (method === "GET") {
        return okJson(this.filter(this.logs, parsed.searchParams));
      }
      if (method === "DELETE") {
        const rows = this.logs.filter(row => this.match(row, parsed.searchParams));
        this.logs = this.logs.filter(row => !rows.includes(row));
        return emptyJson();
      }
    }

    if (path === "/rest/v1/fuel_training_mode_sessions" && method === "GET") {
      return okJson(this.filter(this.trainingModeSessions, parsed.searchParams));
    }

    if (path === "/rest/v1/fuel_work_mode_sessions" && method === "GET") {
      return okJson(this.filter(this.workModeSessions, parsed.searchParams));
    }

    if (path === "/rest/v1/rpc/fuel_garmin_training_command" && method === "POST") {
      if (this.failTrainingCommand) return okJson({ error: "temporary" }, 503);
      const body = this.body(options);
      const device = this.deviceTokens.find(row => row.id === body.p_device_token_id
        && row.user_id === body.p_user_id && !row.revoked_at);
      if (!device) return okJson({ error: "forbidden" }, 403);
      const duplicate = this.trainingCommands.find(row => row.device_token_id === device.id
        && row.external_action_id === body.p_external_action_id);
      if (duplicate) return okJson({ ...duplicate.response, duplicate: true });
      let session = this.trainingModeSessions.find(row => row.user_id === device.user_id && row.status === "active") || null;
      let result;
      if (body.p_action === "start") {
        if (session) result = "already_active";
        else {
          session = {
            id: `training-${this.nextTraining++}`,
            user_id: device.user_id,
            title: "Garmin training",
            session_type: "training",
            status: "active",
            started_at: body.p_occurred_at,
            ended_at: null,
            fuel_preset_id: "preset-fuel",
            hydration_preset_id: "preset-hydration",
            fuel_carbs_g: 30,
            fuel_fluid_ml: 0,
            fuel_sodium_mg: 0,
            fuel_caffeine_mg: 0,
            hydration_carbs_g: 0,
            hydration_fluid_ml: 200,
            hydration_sodium_mg: 250,
            hydration_caffeine_mg: 40
          };
          this.trainingModeSessions.push(session);
          result = "started";
        }
      } else if (session) {
        session.status = "completed";
        session.ended_at = body.p_occurred_at;
        result = "ended";
      } else result = "no_active";
      const response = {
        result,
        duplicate: false,
        active: result === "started" || result === "already_active",
        session_id: session?.id || null,
        started_at: session?.started_at || null,
        ended_at: session?.ended_at || null
      };
      this.trainingCommands.push({
        device_token_id: device.id,
        user_id: device.user_id,
        external_action_id: body.p_external_action_id,
        action: body.p_action,
        response
      });
      return okJson(response);
    }

    throw new Error(`Unhandled fake Supabase request: ${method} ${path}`);
  }

  insertExpiredApproved({ appId = "quick_log", state = "expired-state", code = "expired-code", userId = USERS["user-token-a"].id } = {}) {
    const row = {
      id: `auth-${this.nextAuth++}`,
      app_id: appId,
      state_hash: auth._test.hmacHex(state, process.env, "state"),
      authorization_code_hash: auth._test.hmacHex(code, process.env, "code"),
      user_id: userId,
      status: "approved",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T00:05:00.000Z"
    };
    this.authSessions.push(row);
    return { state, code, row };
  }
}

async function withFake(callback) {
  return withEnv(async () => {
    const fake = new FakeSupabase();
    const previousFetch = global.fetch;
    global.fetch = fake.fetch;
    try {
      return await callback(fake);
    } finally {
      global.fetch = previousFetch;
    }
  });
}

const VALID_EVENT = {
  external_event_id: "fr255-1000-1",
  logged_at: "2026-07-18T08:15:00.000Z",
  type: "fuel",
  device_id: "fr255"
};

async function pairDevice(fake, { appId = "quick_log", state = "state-a", userToken = "user-token-a" } = {}) {
  const approve = await call(auth.approveAuthHandler, { token: userToken, body: { app_id: appId, state, user_id: USERS["user-token-b"].id } });
  assert.equal(approve.statusCode, 201);
  const redirect = new URL(approve.json.redirect_url);
  const code = redirect.searchParams.get("code");
  assert.ok(code);
  const exchange = await call(auth.exchangeAuthHandler, { body: { app_id: appId, state, authorization_code: code } });
  assert.equal(exchange.statusCode, 200);
  assert.equal(exchange.json.result, "ok");
  assert.ok(exchange.json.device_token);
  return { deviceToken: exchange.json.device_token, tokenPrefix: exchange.json.token_prefix, code, state };
}

test("Garmin approval requires a valid Supabase user session", async () => withFake(async () => {
  const res = await call(auth.approveAuthHandler, { body: { app_id: "quick_log", state: "state-a" } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error, "supabase_session_required");
}));

test("Garmin user_id cannot be forged and logs map to the approving user", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  const res = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });

  assert.equal(res.statusCode, 201);
  assert.equal(fake.logs.length, 1);
  assert.equal(fake.logs[0].user_id, USERS["user-token-a"].id);
  assert.equal(fake.logs[0].source, "garmin");
  assert.equal(fake.logs[0].type, "fuel");
  assert.equal(fake.logs[0].training_mode_session_id, undefined);
  assert.equal(fake.logs[0].carbs_g, undefined);
}));

test("Garmin Fuel uses the active Training Mode Fuel preset only inside the session", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.trainingModeSessions.push({
    id: "session-a",
    user_id: USERS["user-token-a"].id,
    status: "active",
    started_at: "2026-07-18T08:00:00.000Z",
    ended_at: null,
    fuel_preset_id: "preset-fuel",
    hydration_preset_id: "preset-hydration",
    fuel_carbs_g: 30,
    fuel_fluid_ml: 0,
    fuel_sodium_mg: 0,
    fuel_caffeine_mg: 0,
    hydration_carbs_g: 10,
    hydration_fluid_ml: 200,
    hydration_sodium_mg: 250,
    hydration_caffeine_mg: 0
  });
  const res = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });
  assert.equal(res.statusCode, 201);
  assert.equal(fake.logs[0].training_mode_session_id, "session-a");
  assert.equal(fake.logs[0].training_mode_preset_id, "preset-fuel");
  assert.deepEqual(
    [fake.logs[0].carbs_g, fake.logs[0].fluid_ml, fake.logs[0].sodium_mg, fake.logs[0].caffeine_mg],
    [30, 0, 0, 0]
  );
}));

test("Garmin events keep Training context while Work is inferred later from the event timestamp", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.workModeSessions.push({
    id: "work-a",
    user_id: USERS["user-token-a"].id,
    status: "active",
    started_at: "2026-07-18T08:00:00.000Z",
    ended_at: null
  });
  fake.trainingModeSessions.push({
    id: "training-a",
    user_id: USERS["user-token-a"].id,
    status: "active",
    started_at: "2026-07-18T08:00:00.000Z",
    ended_at: null,
    fuel_preset_id: "preset-fuel",
    hydration_preset_id: "preset-hydration",
    fuel_carbs_g: 30,
    fuel_fluid_ml: 0,
    fuel_sodium_mg: 0,
    fuel_caffeine_mg: 0
  });
  const res = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });
  assert.equal(res.statusCode, 201);
  assert.equal(fake.logs[0].work_mode_session_id, undefined);
  assert.equal(fake.logs[0].training_mode_session_id, "training-a");
  assert.equal(fake.logs[0].carbs_g, 30);
}));

test("Garmin Hydrate preserves mixed Training Mode carbohydrate fluid and sodium quantities", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.trainingModeSessions.push({
    id: "session-hydration",
    user_id: USERS["user-token-a"].id,
    status: "completed",
    started_at: "2026-07-18T08:00:00.000Z",
    ended_at: "2026-07-18T09:00:00.000Z",
    fuel_preset_id: "preset-fuel",
    hydration_preset_id: "preset-hydration",
    fuel_carbs_g: 30,
    fuel_fluid_ml: 0,
    fuel_sodium_mg: 0,
    fuel_caffeine_mg: 0,
    hydration_carbs_g: 10,
    hydration_fluid_ml: 200,
    hydration_sodium_mg: 250,
    hydration_caffeine_mg: 0
  });
  const event = { ...VALID_EVENT, type: "hydration", external_event_id: "hydrate-1", logged_at: "2026-07-18T08:30:00.000Z" };
  const res = await call(auth.garminLogHandler, { token: paired.deviceToken, body: event });
  assert.equal(res.statusCode, 201);
  assert.equal(fake.logs[0].training_mode_preset_id, "preset-hydration");
  assert.deepEqual(
    [fake.logs[0].carbs_g, fake.logs[0].fluid_ml, fake.logs[0].sodium_mg, fake.logs[0].caffeine_mg],
    [10, 200, 250, 0]
  );
}));

test("Garmin starts Training Mode atomically and duplicate start retries reuse the session", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  const command = {
    action: "start",
    external_action_id: "garmin-training-start-1",
    occurred_at: "2026-07-18T08:00:00.000Z",
    user_id: USERS["user-token-b"].id
  };
  const first = await call(garminTrainingHandler, { token: paired.deviceToken, body: command });
  const retry = await call(garminTrainingHandler, { token: paired.deviceToken, body: command });

  assert.equal(first.statusCode, 200);
  assert.equal(first.json.result, "started");
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json.duplicate, true);
  assert.equal(retry.json.session_id, first.json.session_id);
  assert.equal(fake.trainingModeSessions.length, 1);
  assert.equal(fake.trainingModeSessions[0].user_id, USERS["user-token-a"].id);
  assert.equal(fake.trainingCommands.length, 1);
}));

test("Garmin start respects an existing PWA session and status exposes only the paired athlete", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.trainingModeSessions.push({
    id: "pwa-session",
    user_id: USERS["user-token-a"].id,
    title: "PWA ride",
    session_type: "bike",
    status: "active",
    started_at: "2026-07-18T07:55:00.000Z",
    ended_at: null
  });
  fake.trainingModeSessions.push({
    id: "other-athlete-session",
    user_id: USERS["user-token-b"].id,
    title: "Private run",
    session_type: "run",
    status: "active",
    started_at: "2026-07-18T07:50:00.000Z",
    ended_at: null
  });
  const start = await call(garminTrainingHandler, {
    token: paired.deviceToken,
    body: { action: "start", external_action_id: "start-existing", occurred_at: "2026-07-18T08:00:00.000Z" }
  });
  const status = await call(garminTrainingHandler, { method: "GET", token: paired.deviceToken });

  assert.equal(start.json.result, "already_active");
  assert.equal(start.json.session_id, "pwa-session");
  assert.equal(fake.trainingModeSessions.length, 2);
  assert.equal(status.statusCode, 200);
  assert.equal(status.json.active, true);
  assert.equal(status.json.session.id, "pwa-session");
  assert.doesNotMatch(JSON.stringify(status.json), /Private run|other-athlete-session/);
}));

test("Garmin status returns the paired athlete's latest canonical Fuel event for the glance", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.logs.push(
    {
      id: "fuel-a",
      user_id: USERS["user-token-a"].id,
      type: "fuel",
      notes: null,
      logged_at: "2026-08-15T08:20:00.000Z"
    },
    {
      id: "sleepy-a",
      user_id: USERS["user-token-a"].id,
      type: "fuel",
      notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}',
      logged_at: "2026-08-15T09:30:00.000Z"
    },
    {
      id: "hydration-a",
      user_id: USERS["user-token-a"].id,
      type: "hydration",
      notes: null,
      logged_at: "2026-08-15T09:45:00.000Z"
    },
    {
      id: "fuel-b",
      user_id: USERS["user-token-b"].id,
      type: "fuel",
      notes: null,
      logged_at: "2026-08-15T10:00:00.000Z"
    }
  );

  const status = await call(garminTrainingHandler, { method: "GET", token: paired.deviceToken });

  assert.equal(status.statusCode, 200);
  assert.equal(status.json.fuel_status.last_fuel_at, "2026-08-15T08:20:00.000Z");
  assert.equal(status.json.fuel_status.last_fuel_at_seconds, 1786782000);
  assert.ok(Number.isInteger(status.json.fuel_status.synced_at_seconds));
  assert.doesNotMatch(JSON.stringify(status.json), /sleepy-a|hydration-a|fuel-b/);
}));

test("Garmin status reports a fresh explicit no-Fuel state without exposing another athlete", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.logs.push({
    id: "fuel-b-only",
    user_id: USERS["user-token-b"].id,
    type: "fuel",
    notes: null,
    logged_at: "2026-08-15T10:00:00.000Z"
  });

  const status = await call(garminTrainingHandler, { method: "GET", token: paired.deviceToken });

  assert.equal(status.statusCode, 200);
  assert.equal(status.json.fuel_status.last_fuel_at, null);
  assert.equal(status.json.fuel_status.last_fuel_at_seconds, null);
  assert.ok(Number.isInteger(status.json.fuel_status.synced_at_seconds));
}));

test("Garmin ends Training Mode idempotently and a status refresh observes the closed session", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  const start = await call(garminTrainingHandler, {
    token: paired.deviceToken,
    body: { action: "start", external_action_id: "start-for-end", occurred_at: "2026-07-18T08:00:00.000Z" }
  });
  assert.equal(start.json.result, "started");
  const command = { action: "end", external_action_id: "end-1", occurred_at: "2026-07-18T09:00:00.000Z" };
  const first = await call(garminTrainingHandler, { token: paired.deviceToken, body: command });
  const retry = await call(garminTrainingHandler, { token: paired.deviceToken, body: command });
  const status = await call(garminTrainingHandler, { method: "GET", token: paired.deviceToken });

  assert.equal(first.json.result, "ended");
  assert.equal(retry.json.result, "ended");
  assert.equal(retry.json.duplicate, true);
  assert.equal(fake.trainingModeSessions[0].status, "completed");
  assert.equal(status.json.active, false);
  assert.equal(status.json.session, null);
}));

test("Garmin Training Mode command can retry after a temporary server failure", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  const command = { action: "start", external_action_id: "retry-after-failure", occurred_at: "2026-07-18T08:00:00.000Z" };
  fake.failTrainingCommand = true;
  const failed = await call(garminTrainingHandler, { token: paired.deviceToken, body: command });
  fake.failTrainingCommand = false;
  const retried = await call(garminTrainingHandler, { token: paired.deviceToken, body: command });

  assert.equal(failed.statusCode, 500);
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.json.result, "started");
  assert.equal(fake.trainingModeSessions.length, 1);
}));

test("Garmin Hydrate after watch-started Training Mode attributes fluid sodium and canonical caffeine once", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  await call(garminTrainingHandler, {
    token: paired.deviceToken,
    body: { action: "start", external_action_id: "start-hydration", occurred_at: "2026-07-18T08:00:00.000Z" }
  });
  const event = { ...VALID_EVENT, type: "hydration", external_event_id: "watch-hydration", logged_at: "2026-07-18T08:20:00.000Z" };
  const first = await call(auth.garminLogHandler, { token: paired.deviceToken, body: event });
  const retry = await call(auth.garminLogHandler, { token: paired.deviceToken, body: event });

  assert.equal(first.statusCode, 201);
  assert.equal(retry.json.result, "duplicate");
  assert.equal(fake.logs.length, 1);
  assert.deepEqual(
    [fake.logs[0].fluid_ml, fake.logs[0].sodium_mg, fake.logs[0].caffeine_mg],
    [200, 250, 40]
  );
}));

test("Garmin Training Mode endpoint rejects invalid commands and unpaired devices", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  const invalid = await call(garminTrainingHandler, {
    token: paired.deviceToken,
    body: { action: "restart", external_action_id: "invalid", occurred_at: "2026-07-18T08:00:00.000Z" }
  });
  const unpaired = await call(garminTrainingHandler, {
    token: "not-a-device-token",
    body: { action: "start", external_action_id: "unpaired", occurred_at: "2026-07-18T08:00:00.000Z" }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(unpaired.statusCode, 401);
  assert.equal(fake.trainingModeSessions.length, 0);
}));

test("Garmin events after Training Mode ends remain ordinary quantity-free timing logs", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  fake.trainingModeSessions.push({
    id: "ended-session",
    user_id: USERS["user-token-a"].id,
    status: "completed",
    started_at: "2026-07-18T06:00:00.000Z",
    ended_at: "2026-07-18T07:00:00.000Z",
    fuel_preset_id: "preset-fuel",
    hydration_preset_id: "preset-hydration",
    fuel_carbs_g: 30,
    fuel_fluid_ml: 0,
    fuel_sodium_mg: 0,
    fuel_caffeine_mg: 0,
    hydration_carbs_g: 0,
    hydration_fluid_ml: 250,
    hydration_sodium_mg: 0,
    hydration_caffeine_mg: 0
  });
  const res = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });
  assert.equal(res.statusCode, 201);
  assert.equal(fake.logs[0].training_mode_session_id, undefined);
  assert.equal(fake.logs[0].carbs_g, undefined);
}));

test("Garmin Sleepy logs persist as the canonical PWA Sleepy check-in", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake, { userToken: "user-token-a" });
  const event = {
    ...VALID_EVENT,
    external_event_id: "fr255-sleepy-1",
    type: "sleepy"
  };
  const first = await call(auth.garminLogHandler, { token: paired.deviceToken, body: event });
  const second = await call(auth.garminLogHandler, { token: paired.deviceToken, body: event });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json.result, "duplicate");
  assert.equal(fake.logs.length, 1);
  assert.equal(fake.logs[0].user_id, USERS["user-token-a"].id);
  assert.equal(fake.logs[0].source, "garmin");
  assert.equal(fake.logs[0].type, "fuel");
  assert.match(fake.logs[0].notes, /^fuel_guard_checkin:/);
  assert.match(fake.logs[0].notes, /"checkinType":"sleepy"/);
  assert.match(fake.logs[0].notes, /"arousalLevel":"sleepy"/);
}));

test("Garmin exchange rejects returned state mismatches", async () => withFake(async () => {
  const approve = await call(auth.approveAuthHandler, { token: "user-token-a", body: { app_id: "quick_log", state: "state-good" } });
  const code = new URL(approve.json.redirect_url).searchParams.get("code");
  const res = await call(auth.exchangeAuthHandler, { body: { app_id: "quick_log", state: "state-bad", authorization_code: code } });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error, "authorization_invalid");
}));

test("Garmin exchange rejects expired and denied sessions", async () => withFake(async (fake) => {
  const expired = fake.insertExpiredApproved();
  const expiredRes = await call(auth.exchangeAuthHandler, { body: { app_id: "quick_log", state: expired.state, authorization_code: expired.code } });
  assert.equal(expiredRes.statusCode, 401);
  assert.equal(expiredRes.json.error, "authorization_expired");

  const denied = await call(auth.denyAuthHandler, { body: { app_id: "activity_logger", state: "denied-state" } });
  assert.equal(denied.statusCode, 200);
  const approveDenied = await call(auth.approveAuthHandler, { token: "user-token-a", body: { app_id: "activity_logger", state: "denied-state" } });
  assert.equal(approveDenied.statusCode, 400);
  assert.equal(approveDenied.json.error, "authorization_denied");
}));

test("Garmin authorization code is one-use and exchange returns one device token", async () => withFake(async (fake) => {
  const approve = await call(auth.approveAuthHandler, { token: "user-token-a", body: { app_id: "quick_log", state: "one-use" } });
  const code = new URL(approve.json.redirect_url).searchParams.get("code");
  const first = await call(auth.exchangeAuthHandler, { body: { app_id: "quick_log", state: "one-use", authorization_code: code } });
  const second = await call(auth.exchangeAuthHandler, { body: { app_id: "quick_log", state: "one-use", authorization_code: code } });

  assert.equal(first.statusCode, 200);
  assert.ok(first.json.device_token);
  assert.equal(second.statusCode, 401);
  assert.equal(fake.deviceTokens.length, 1);
}));

test("Garmin raw device token is never stored in database", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  assert.equal(fake.deviceTokens.length, 1);
  assert.notEqual(fake.deviceTokens[0].token_hash, paired.deviceToken);
  assert.equal(fake.deviceTokens[0].token_hash, auth._test.hmacHex(paired.deviceToken, process.env, "device"));
  assert.equal(Object.prototype.hasOwnProperty.call(fake.deviceTokens[0], "device_token"), false);
}));

test("Garmin token hash validation succeeds, wrong tokens fail and revoked tokens fail", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const ok = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });
  assert.equal(ok.statusCode, 201);

  const wrong = await call(auth.garminLogHandler, { token: "wrong-device-token", body: { ...VALID_EVENT, external_event_id: "wrong" } });
  assert.equal(wrong.statusCode, 401);

  const revoke = await call(auth.revokeDeviceHandler, { token: paired.deviceToken, body: {} });
  assert.equal(revoke.statusCode, 200);
  const afterRevoke = await call(auth.garminLogHandler, { token: paired.deviceToken, body: { ...VALID_EVENT, external_event_id: "after-revoke" } });
  assert.equal(afterRevoke.statusCode, 401);
}));

test("Garmin duplicate external_event_id creates exactly one Supabase row", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const first = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });
  const second = await call(auth.garminLogHandler, { token: paired.deviceToken, body: VALID_EVENT });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(second.json.result, "duplicate");
  assert.equal(fake.logs.length, 1);
}));

test("Garmin connected devices are user-scoped and cannot be revoked by another user", async () => withFake(async (fake) => {
  const quick = await pairDevice(fake, { appId: "quick_log", state: "user-a", userToken: "user-token-a" });
  await pairDevice(fake, { appId: "activity_logger", state: "user-b", userToken: "user-token-b" });
  const logged = await call(auth.garminLogHandler, {
    token: quick.deviceToken,
    body: { ...VALID_EVENT, external_event_id: "onboarding-user-a" }
  });
  assert.equal(logged.statusCode, 201);
  const userA = await call(auth.devicesHandler, { method: "GET", token: "user-token-a" });
  const userB = await call(auth.devicesHandler, { method: "GET", token: "user-token-b" });
  assert.equal(userA.statusCode, 200);
  assert.equal(userB.statusCode, 200);
  assert.equal(userA.json.devices.length, 1);
  assert.equal(userB.json.devices.length, 1);
  assert.notEqual(userA.json.devices[0].id, userB.json.devices[0].id);
  assert.deepEqual(userA.json.onboarding, {
    quick_log_connected: true,
    first_watch_log_received: true,
    latest_watch_log_at: VALID_EVENT.logged_at,
    latest_watch_log_type: "fuel",
    completed: true
  });
  assert.deepEqual(userB.json.onboarding, {
    quick_log_connected: false,
    first_watch_log_received: false,
    latest_watch_log_at: null,
    latest_watch_log_type: null,
    completed: false
  });

  const forbidden = await call(auth.revokeDeviceHandler, { token: "user-token-b", body: { device_id: userA.json.devices[0].id } });
  assert.equal(forbidden.statusCode, 404);
  assert.equal(fake.deviceTokens.find(row => row.id === userA.json.devices[0].id).revoked_at, null);
}));

test("Garmin Quick Log and Activity Logger tokens are independently revocable", async () => withFake(async (fake) => {
  const quick = await pairDevice(fake, { appId: "quick_log", state: "quick" });
  const activity = await pairDevice(fake, { appId: "activity_logger", state: "activity" });
  const revokeQuick = await call(auth.revokeDeviceHandler, { token: quick.deviceToken, body: {} });
  assert.equal(revokeQuick.statusCode, 200);

  const quickResult = await call(auth.garminLogHandler, { token: quick.deviceToken, body: VALID_EVENT });
  const activityResult = await call(auth.garminLogHandler, { token: activity.deviceToken, body: { ...VALID_EVENT, external_event_id: "activity-ok" } });
  assert.equal(quickResult.statusCode, 401);
  assert.equal(activityResult.statusCode, 201);
  assert.equal(fake.deviceTokens.filter(row => row.revoked_at).length, 1);
}));

test("Canonical /api/garmin/log route uses zero-secret device auth", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const res = await call(garminLogHandler, { token: paired.deviceToken, body: { ...VALID_EVENT, external_event_id: "canonical-route" } });
  assert.equal(res.statusCode, 201);
  assert.equal(auth._test.envReady({ GARMIN_BETA_TOKEN: "old", GARMIN_BETA_USER_ID: "old" }), false);
}));

test("Legacy Garmin URLs are rewrites instead of extra serverless functions", () => {
  const root = path.join(__dirname, "..");
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.deepEqual(vercel.rewrites, [
    { source: "/api/garmin-log", destination: "/api/garmin/log" },
    { source: "/api/garmin-health", destination: "/api/garmin/health" },
    { source: "/api/garmin-auth", destination: "/api/garmin/auth/start" },
    { source: "/api/garmin/training", destination: "/api/garmin/log?fuel_guard_action=training" }
  ]);
  assert.equal(fs.existsSync(path.join(root, "api/garmin-log.js")), false);
  assert.equal(fs.existsSync(path.join(root, "api/garmin-auth.js")), false);
  assert.equal(fs.existsSync(path.join(root, "api/garmin-health.js")), false);
  assert.equal(fs.existsSync(path.join(root, "api/garmin/training.js")), false);
});

test("Garmin Training rewrite shares the canonical Garmin Serverless Function", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const res = await call(garminLogHandler, {
    token: paired.deviceToken,
    query: { fuel_guard_action: "training" },
    body: {
      action: "start",
      external_action_id: "shared-function-start",
      occurred_at: "2026-08-08T08:00:00.000Z"
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.result, "started");
}));

test("Garmin endpoint validates payload shape and auth before writes", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const invalidType = await call(auth.garminLogHandler, { token: paired.deviceToken, body: { ...VALID_EVENT, type: "snack" } });
  assert.equal(invalidType.statusCode, 400);
  assert.match(invalidType.json.message, /type/);
}));

test("Garmin backend source contains no shared beta-user fallback", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "lib/garmin-auth.js"), "utf8") + fs.readFileSync(path.join(root, "api/garmin/log.js"), "utf8");
  assert.doesNotMatch(source, /GARMIN_BETA_TOKEN/);
  assert.doesNotMatch(source, /GARMIN_BETA_USER_ID/);
  assert.doesNotMatch(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(source, /GARMIN_TOKEN_PEPPER/);
});
