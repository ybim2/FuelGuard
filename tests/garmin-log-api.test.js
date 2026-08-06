const assert = require("node:assert/strict");
const test = require("node:test");

const handler = require("../api/garmin-log.js");

const BASE_ENV = {
  GARMIN_BETA_TOKEN: "beta-token",
  GARMIN_BETA_USER_ID: "11111111-1111-4111-8111-111111111111",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "secret-key"
};

function withEnv(callback) {
  const previous = { ...process.env };
  Object.assign(process.env, BASE_ENV);
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

async function runRequest({ method = "POST", token = "beta-token", body = {}, fetchImpl = null } = {}) {
  const previousFetch = global.fetch;
  global.fetch = fetchImpl || (async () => ({
    ok: true,
    status: 201,
    text: async () => JSON.stringify([{ id: "row-1", external_event_id: body.external_event_id }])
  }));
  const req = {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body
  };
  const res = responseMock();
  try {
    await handler(req, res);
    return res;
  } finally {
    global.fetch = previousFetch;
  }
}

const VALID_EVENT = {
  external_event_id: "fr255-1000-1",
  logged_at: "2026-07-18T08:15:00.000Z",
  type: "fuel",
  device_id: "fr255"
};

test("Garmin endpoint returns 405 for GET", async () => withEnv(async () => {
  const res = await runRequest({ method: "GET" });
  assert.equal(res.statusCode, 405);
  assert.equal(res.json.error, "method_not_allowed");
}));

test("Garmin endpoint returns 401 for missing token", async () => withEnv(async () => {
  const res = await runRequest({ token: null });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error, "unauthorized");
}));

test("Garmin endpoint returns 401 for incorrect token", async () => withEnv(async () => {
  const res = await runRequest({ token: "wrong-token" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error, "unauthorized");
}));

test("Garmin endpoint rejects malformed JSON", async () => withEnv(async () => {
  const res = await runRequest({ body: "{" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json.error, "invalid_json");
}));

test("Garmin endpoint rejects invalid timestamp", async () => withEnv(async () => {
  const res = await runRequest({ body: { ...VALID_EVENT, logged_at: "not-a-date" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.message, /logged_at/);
}));

test("Garmin endpoint rejects invalid type", async () => withEnv(async () => {
  const res = await runRequest({ body: { ...VALID_EVENT, type: "snack" } });
  assert.equal(res.statusCode, 400);
  assert.match(res.json.message, /type/);
}));

test("Garmin endpoint inserts a fuel row", async () => withEnv(async () => {
  const requests = [];
  const res = await runRequest({
    body: VALID_EVENT,
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify([{ id: "fuel-row" }])
      };
    }
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json.result, "ok");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.user_id, BASE_ENV.GARMIN_BETA_USER_ID);
  assert.equal(requests[0].body.source, "garmin");
  assert.equal(requests[0].body.type, "fuel");
  assert.equal(requests[0].body.external_event_id, VALID_EVENT.external_event_id);
  assert.equal(requests[0].body.notes, "fuel_guard_garmin_device:fr255");
}));

test("Garmin endpoint inserts a hydration row", async () => withEnv(async () => {
  const requests = [];
  const res = await runRequest({
    body: { ...VALID_EVENT, external_event_id: "fr255-1001-2", type: "hydration" },
    fetchImpl: async (_url, options) => {
      requests.push({ body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify([{ id: "hydration-row" }])
      };
    }
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json.result, "ok");
  assert.equal(requests[0].body.type, "hydration");
}));

test("Garmin endpoint inserts a fuel plus hydration row", async () => withEnv(async () => {
  const requests = [];
  const res = await runRequest({
    body: { ...VALID_EVENT, external_event_id: "fr255-1002-3", type: "fuel_hydration" },
    fetchImpl: async (_url, options) => {
      requests.push({ body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify([{ id: "fuel-hydration-row" }])
      };
    }
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.json.result, "ok");
  assert.equal(requests[0].body.type, "fuel_hydration");
}));

test("Garmin endpoint treats duplicate external_event_id as success", async () => withEnv(async () => {
  const requests = [];
  const res = await runRequest({
    body: VALID_EVENT,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === "POST") {
        return {
          ok: false,
          status: 409,
          text: async () => JSON.stringify({ code: "23505", message: "duplicate key value violates unique constraint" })
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([{ id: "existing-row", external_event_id: VALID_EVENT.external_event_id }])
      };
    }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.result, "duplicate");
  assert.equal(requests.length, 2);
  assert.equal(requests.filter(request => request.options.method === "POST").length, 1);
}));

test("Garmin endpoint does not include secrets or bearer token in responses", async () => withEnv(async () => {
  const res = await runRequest({ body: VALID_EVENT });
  assert.equal(res.statusCode, 201);
  assert.doesNotMatch(res.body, /beta-token/);
  assert.doesNotMatch(res.body, /secret-key/);
}));
