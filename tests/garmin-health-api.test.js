const assert = require("node:assert/strict");
const test = require("node:test");

const auth = require("../lib/garmin-auth.js");
const health = require("../lib/garmin-health.js");

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "server-only-secret",
  GARMIN_TOKEN_PEPPER: "test-pepper",
  FUEL_GUARD_TEST_NOW: "2026-08-06T23:00:00.000Z"
};

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEVICE_TOKEN = "device-token-test";

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

async function call(handler, { method = "POST", token = DEVICE_TOKEN, body = {} } = {}) {
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

class FakeSupabase {
  constructor() {
    this.deviceTokens = [{
      id: "device-1",
      user_id: USER_ID,
      app_id: "quick_log",
      token_hash: auth._test.hmacHex(DEVICE_TOKEN, process.env, "device"),
      token_prefix: "device-t",
      revoked_at: null,
      last_used_at: null
    }];
    this.tables = {
      fuel_logs: [],
      garmin_device_capabilities: [],
      garmin_heart_rate_samples: [],
      garmin_stress_samples: [],
      garmin_body_battery_samples: [],
      garmin_profile_snapshots: [],
      garmin_activity_summaries: [],
      garmin_daily_features: [],
      garmin_weekly_features: [],
      garmin_daily_checkins: []
    };
    this.nextId = 1;
    this.fetch = this.fetch.bind(this);
  }

  parse(url) {
    return new URL(String(url));
  }

  body(options) {
    return options?.body ? JSON.parse(options.body) : {};
  }

  rowValue(row, key) {
    return row[key];
  }

  matchTerm(row, key, raw) {
    if (["select", "order", "limit"].includes(key)) return true;
    if (raw === "is.null") return this.rowValue(row, key) === null || this.rowValue(row, key) === undefined;
    if (raw.startsWith("eq.")) return String(this.rowValue(row, key)) === raw.slice(3);
    if (raw.startsWith("gte.")) return String(this.rowValue(row, key)) >= raw.slice(4);
    if (raw.startsWith("lte.")) return String(this.rowValue(row, key)) <= raw.slice(4);
    return true;
  }

  match(row, query) {
    for (const key of new Set(Array.from(query.keys()))) {
      for (const raw of query.getAll(key)) {
        if (!this.matchTerm(row, key, raw)) return false;
      }
    }
    return true;
  }

  filter(rows, query) {
    let next = rows.filter(row => this.match(row, query));
    const order = query.get("order") || "";
    if (order.includes(".desc")) {
      const field = order.split(".")[0];
      next = next.slice().sort((a, b) => String(b[field] || "").localeCompare(String(a[field] || "")));
    }
    const limit = Number(query.get("limit") || 0);
    return limit ? next.slice(0, limit) : next;
  }

  tableForPath(path) {
    const table = path.replace(/^\/rest\/v1\//, "");
    if (table === "garmin_device_tokens") return this.deviceTokens;
    return this.tables[table];
  }

  uniqueMatch(table, body) {
    if (table === "garmin_heart_rate_samples" || table === "garmin_stress_samples" || table === "garmin_body_battery_samples" || table === "garmin_profile_snapshots") {
      return row => row.user_id === body.user_id && row.source === body.source && row.device_id === body.device_id && row.observed_at === body.observed_at;
    }
    if (table === "garmin_activity_summaries") {
      if (body.source_activity_id) {
        return row => row.user_id === body.user_id && row.source === body.source && row.device_id === body.device_id && row.source_activity_id === body.source_activity_id;
      }
      return row => row.user_id === body.user_id && row.source === body.source && row.device_id === body.device_id && row.started_at === body.started_at && row.activity_type === body.activity_type;
    }
    if (table === "garmin_device_capabilities") {
      return row => row.user_id === body.user_id && row.source === body.source && row.device_id === body.device_id;
    }
    if (table === "garmin_daily_features") {
      return row => row.user_id === body.user_id && row.source === body.source && row.local_date === body.local_date;
    }
    if (table === "garmin_weekly_features") {
      return row => row.user_id === body.user_id && row.source === body.source && row.week_start_date === body.week_start_date;
    }
    if (table === "garmin_daily_checkins") {
      return row => row.user_id === body.user_id && row.local_date === body.local_date;
    }
    return () => false;
  }

  async fetch(url, options = {}) {
    const parsed = this.parse(url);
    const path = parsed.pathname;
    const method = String(options.method || "GET").toUpperCase();

    if (path === "/auth/v1/user") {
      const bearer = String(options.headers?.Authorization || "").replace(/^Bearer\s+/i, "");
      return bearer === "user-token" ? okJson({ id: USER_ID, email: "a@example.com" }) : okJson({ error: "invalid" }, 401);
    }

    const rows = this.tableForPath(path);
    if (!rows) throw new Error(`Unhandled fake Supabase request: ${method} ${path}`);

    if (method === "GET") return okJson(this.filter(rows, parsed.searchParams));
    if (method === "PATCH") {
      const patch = this.body(options);
      const matches = rows.filter(row => this.match(row, parsed.searchParams));
      matches.forEach(row => Object.assign(row, patch));
      return okJson(matches);
    }
    if (method === "POST") {
      const table = path.replace(/^\/rest\/v1\//, "");
      const body = this.body(options);
      const duplicate = rows.find(this.uniqueMatch(table, body));
      if (duplicate) return okJson({ code: "23505", message: "duplicate key value violates unique constraint" }, 409);
      const row = { id: `${table}-${this.nextId++}`, created_at: new Date().toISOString(), ...body };
      rows.push(row);
      return okJson([row], 201);
    }
    throw new Error(`Unhandled fake Supabase request: ${method} ${path}`);
  }
}

async function withFake(callback) {
  const previousEnv = { ...process.env };
  const previousFetch = global.fetch;
  process.env = { ...previousEnv, ...BASE_ENV };
  const fake = new FakeSupabase();
  global.fetch = fake.fetch;
  try {
    return await callback(fake);
  } finally {
    global.fetch = previousFetch;
    process.env = previousEnv;
  }
}

function healthPayload() {
  return {
    schema_version: 1,
    snapshot_external_id: "fg-health-fr255-1",
    device_id: "fr255",
    collected_at: "2026-08-06T10:00:00.000Z",
    timezone: "Europe/London",
    capabilities: {
      sensor_history: true,
      heart_rate_history: true,
      stress_history: true,
      body_battery_history: true,
      user_profile: true,
      activity_history: true
    },
    heart_rate_samples: [
      { observed_at: "2026-08-06T08:00:00.000Z", value_bpm: 62 },
      { observed_at: "2026-08-06T09:00:00.000Z", value_bpm: 68 }
    ],
    stress_samples: [
      { observed_at: "2026-08-06T13:00:00.000Z", value: 34 },
      { observed_at: "2026-08-06T14:00:00.000Z", value: null, status: "rest" },
      { observed_at: "2026-08-06T15:00:00.000Z", value: 400 }
    ],
    body_battery_samples: [
      { observed_at: "2026-08-06T07:00:00.000Z", value: 77 },
      { observed_at: "2026-08-06T19:00:00.000Z", value: 43 }
    ],
    profile_snapshot: {
      observed_at: "2026-08-06T10:00:00.000Z",
      resting_heart_rate: 52,
      average_resting_heart_rate: 54
    },
    activity_summaries: [
      { source_activity_id: "act-1", activity_type: "running", started_at: "2026-08-06T17:00:00.000Z", duration_seconds: 1800, distance_metres: 5000 }
    ]
  };
}

test("Garmin health ingestion validates, stores and dedupes opt-in local samples", async () => {
  await withFake(async fake => {
    fake.tables.fuel_logs.push(
      { id: "log-1", user_id: USER_ID, logged_at: "2026-08-06T07:30:00.000Z", type: "fuel", source: "garmin" },
      { id: "log-2", user_id: USER_ID, logged_at: "2026-08-06T13:00:00.000Z", type: "fuel", source: "garmin" }
    );

    const first = await call(health.garminHealthHandler, { body: { ...healthPayload(), user_id: "attacker-user-id" } });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json.result, "ok");
    assert.equal(first.json.sections.heart_rate_samples.accepted, 2);
    assert.equal(first.json.sections.stress_samples.accepted, 2);
    assert.equal(first.json.sections.stress_samples.invalid, 1);
    assert.equal(first.json.sections.body_battery_samples.accepted, 2);
    assert.equal(first.json.sections.profile_snapshots.accepted, 1);
    assert.equal(first.json.sections.activity_summaries.accepted, 1);
    assert.equal(fake.tables.garmin_heart_rate_samples.length, 2);
    assert.equal(fake.tables.garmin_heart_rate_samples.every(row => row.user_id === USER_ID), true);
    assert.equal(fake.tables.garmin_stress_samples.length, 2);
    assert.equal(fake.tables.garmin_stress_samples.some(row => row.value === null && row.sample_status === "rest"), true);

    const second = await call(health.garminHealthHandler, { body: healthPayload() });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json.sections.heart_rate_samples.duplicate, 2);
    assert.equal(second.json.sections.activity_summaries.duplicate, 1);
    assert.equal(fake.tables.garmin_heart_rate_samples.length, 2);
    assert.equal(fake.tables.garmin_activity_summaries.length, 1);
    assert.equal(fake.tables.garmin_daily_features.length, 1);
    assert.equal(fake.tables.garmin_weekly_features.length, 1);
    assert.equal(fake.tables.garmin_weekly_features[0].week_start_date, "2026-08-03");
    assert.equal(fake.tables.garmin_weekly_features[0].total_fuel_events, 2);
    assert.equal(fake.tables.garmin_daily_features[0].fuel_debt_minutes, 90);
    assert.equal(fake.tables.garmin_daily_features[0].workouts_missing_pre_fuel, 0);
    assert.equal(fake.tables.garmin_daily_features[0].workouts_missing_post_fuel, 1);
    assert.equal(fake.tables.garmin_weekly_features[0].workouts_missing_pre_fuel, 0);
  });
});

test("Garmin health ingestion rejects missing and revoked device tokens before writes", async () => {
  await withFake(async fake => {
    const missing = await call(health.garminHealthHandler, { token: null, body: healthPayload() });
    assert.equal(missing.statusCode, 401);
    assert.equal(fake.tables.garmin_heart_rate_samples.length, 0);

    fake.deviceTokens[0].revoked_at = "2026-08-06T11:00:00.000Z";
    const revoked = await call(health.garminHealthHandler, { body: healthPayload() });
    assert.equal(revoked.statusCode, 401);
    assert.equal(fake.tables.garmin_heart_rate_samples.length, 0);
  });
});

test("Garmin health ingestion rejects unsupported envelope and oversized future data", async () => {
  await withFake(async () => {
    const invalidSchema = await call(health.garminHealthHandler, { body: { ...healthPayload(), schema_version: 2 } });
    assert.equal(invalidSchema.statusCode, 400);
    assert.match(invalidSchema.json.message, /schema_version/);

    const future = await call(health.garminHealthHandler, { body: { ...healthPayload(), collected_at: "2026-08-07T10:00:00.000Z" } });
    assert.equal(future.statusCode, 400);
    assert.match(future.json.message, /collected_at/);

    const oversized = await call(health.garminHealthHandler, {
      body: JSON.stringify({ ...healthPayload(), filler: "x".repeat(70 * 1024) })
    });
    assert.equal(oversized.statusCode, 413);
  });
});

test("Garmin patterns require repeated evidence and use cautious wording", () => {
  assert.deepEqual(health._test.buildGarminPatternInsights([
    { local_date: "2026-08-01", longest_fuel_gap_minutes: 360, afternoon_median_stress: 60 }
  ]), []);

  const repeated = [
    ["2026-08-01", 360, 62],
    ["2026-08-02", 330, 58],
    ["2026-08-03", 320, 61],
    ["2026-08-04", 180, 35],
    ["2026-08-05", 160, 38],
    ["2026-08-06", 150, 36]
  ].map(([local_date, longest_fuel_gap_minutes, afternoon_median_stress]) => ({
    local_date,
    longest_fuel_gap_minutes,
    afternoon_median_stress
  }));
  const insights = health._test.buildGarminPatternInsights(repeated);
  assert.equal(insights.length, 1);
  assert.match(insights[0].text, /trend/);
  assert.match(insights[0].limitation, /association, not a medical conclusion/);
});

test("Garmin weekly feature assignment uses Monday-start local weeks", () => {
  assert.equal(health._test.weekStartDateKey("2026-08-03"), "2026-08-03");
  assert.equal(health._test.weekStartDateKey("2026-08-09"), "2026-08-03");
  assert.equal(health._test.weekStartDateKey("2026-08-10"), "2026-08-10");
});

test("Garmin patterns include repeated pre-training fuel signals", () => {
  const rows = Array.from({ length: 5 }, (_item, index) => ({
    local_date: `2026-08-0${index + 1}`,
    activity_count: 1,
    workouts_missing_pre_fuel: 1,
    workouts_missing_post_fuel: 0,
    longest_fuel_gap_minutes: 180
  }));
  const insights = health._test.buildGarminPatternInsights(rows);
  assert.equal(insights.some(insight => insight.id === "pre-training-fuel"), true);
  assert.equal(insights.some(insight => /caused|proves|made you/i.test(insight.text)), false);
});

test("Garmin patterns response includes the latest device capabilities", async () => {
  await withFake(async fake => {
    fake.tables.garmin_device_capabilities.push({
      user_id: USER_ID,
      device_id: "fr255",
      source: health._test.SOURCE,
      collected_at: "2026-08-06T10:00:00.000Z",
      capabilities: {
        heart_rate_history: true,
        stress_history: true,
        body_battery_history: false,
        activity_history: true,
        resting_heart_rate: true
      }
    });
    fake.tables.garmin_daily_features.push({
      user_id: USER_ID,
      local_date: "2026-08-05",
      source: health._test.SOURCE,
      morning_median_heart_rate: 52,
      afternoon_median_stress: 41,
      body_battery_daytime_change: -18,
      activity_count: 1
    });

    const response = await call(health.garminPatternsHandler, { method: "GET", token: "user-token" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json.capabilities.device_id, "fr255");
    assert.equal(response.json.capabilities.capabilities.heart_rate_history, true);
    assert.equal(response.json.capabilities.capabilities.body_battery_history, false);
    assert.equal(response.json.features_count, 1);
    assert.equal(response.json.features.length, 1);
    assert.equal(response.json.features[0].local_date, "2026-08-05");
  });
});

test("daily subjective check-in validation accepts only 1-5 ratings", () => {
  const valid = health._test.validateCheckinPayload({
    local_date: "2026-08-06",
    energy: 3,
    mood: 4,
    soreness: 2,
    hunger_appetite: 3,
    perceived_recovery: 4
  });
  assert.equal(valid.error, undefined);

  const invalid = health._test.validateCheckinPayload({
    local_date: "2026-08-06",
    energy: 6,
    mood: 4,
    soreness: 2,
    hunger_appetite: 3,
    perceived_recovery: 4
  });
  assert.match(invalid.error, /1 to 5/);

  const decimal = health._test.validateCheckinPayload({
    local_date: "2026-08-06",
    energy: 3.4,
    mood: 4,
    soreness: 2,
    hunger_appetite: 3,
    perceived_recovery: 4
  });
  assert.match(decimal.error, /whole numbers/);
});
