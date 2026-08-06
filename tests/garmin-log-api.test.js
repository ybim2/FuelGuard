const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const legacyHandler = require("../api/garmin-log.js");
const auth = require("../api/garmin-auth.js");

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

async function call(handler, { method = "POST", token = null, body = {} } = {}) {
  const req = {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body
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
    this.nextAuth = 1;
    this.nextDevice = 1;
    this.nextLog = 1;
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
      if (raw === "is.null") {
        if (row[key] !== null && row[key] !== undefined) return false;
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
  await pairDevice(fake, { appId: "quick_log", state: "user-a", userToken: "user-token-a" });
  await pairDevice(fake, { appId: "activity_logger", state: "user-b", userToken: "user-token-b" });
  const userA = await call(auth.devicesHandler, { method: "GET", token: "user-token-a" });
  const userB = await call(auth.devicesHandler, { method: "GET", token: "user-token-b" });
  assert.equal(userA.statusCode, 200);
  assert.equal(userB.statusCode, 200);
  assert.equal(userA.json.devices.length, 1);
  assert.equal(userB.json.devices.length, 1);
  assert.notEqual(userA.json.devices[0].id, userB.json.devices[0].id);

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

test("Legacy /api/garmin-log route now uses zero-secret device auth", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const res = await call(legacyHandler, { token: paired.deviceToken, body: { ...VALID_EVENT, external_event_id: "legacy-route" } });
  assert.equal(res.statusCode, 201);
  assert.equal(legacyHandler._test.envReady({ GARMIN_BETA_TOKEN: "old", GARMIN_BETA_USER_ID: "old" }), false);
}));

test("Garmin endpoint validates payload shape and auth before writes", async () => withFake(async (fake) => {
  const paired = await pairDevice(fake);
  const invalidType = await call(auth.garminLogHandler, { token: paired.deviceToken, body: { ...VALID_EVENT, type: "snack" } });
  assert.equal(invalidType.statusCode, 400);
  assert.match(invalidType.json.message, /type/);
}));

test("Garmin backend source contains no shared beta-user fallback", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "api/garmin-auth.js"), "utf8") + fs.readFileSync(path.join(root, "api/garmin-log.js"), "utf8");
  assert.doesNotMatch(source, /GARMIN_BETA_TOKEN/);
  assert.doesNotMatch(source, /GARMIN_BETA_USER_ID/);
  assert.doesNotMatch(source, /VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(source, /GARMIN_TOKEN_PEPPER/);
});
