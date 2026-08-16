const crypto = require("node:crypto");

// Garmin persists deliberate Training context; scheduled Work context is inferred at read time.

const TYPE_SLEEPY = "sleepy";
const ALLOWED_TYPES = new Set(["fuel", "hydration", "fuel_hydration", TYPE_SLEEPY]);
const ALLOWED_APPS = new Set(["quick_log", "activity_logger"]);
const MAX_ID_LENGTH = 160;
const MAX_DEVICE_LENGTH = 80;
const MAX_APP_LENGTH = 32;
const MAX_STATE_LENGTH = 192;
const GARMIN_DEVICE_NOTE_PREFIX = "fuel_guard_garmin_device:";
const CHECKIN_NOTE_PREFIX = "fuel_guard_checkin:";
const AUTH_CODE_TTL_SECONDS = 10 * 60;

function jsonResponse(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function methodNotAllowed(response, methods) {
  response.setHeader("Allow", methods.join(", "));
  return jsonResponse(response, 405, { error: "method_not_allowed" });
}

function getHeader(request, name) {
  const headers = request.headers || {};
  const lower = name.toLowerCase();
  return headers[name] || headers[lower] || "";
}

function bearerToken(request) {
  const header = String(getHeader(request, "authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function boundedString(value, maxLength) {
  const text = String(value || "").trim();
  return text && text.length <= maxLength ? text : "";
}

function normalizeAppId(value) {
  const appId = boundedString(value, MAX_APP_LENGTH);
  return ALLOWED_APPS.has(appId) ? appId : "";
}

function parseTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString("utf8") || "{}");
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object." };
  }

  const externalEventId = boundedString(payload.external_event_id, MAX_ID_LENGTH);
  if (!externalEventId) return { error: "external_event_id must be a non-empty bounded string." };

  const loggedAt = parseTimestamp(payload.logged_at);
  if (!loggedAt) return { error: "logged_at must be a valid timestamp." };

  const type = String(payload.type || "").trim().toLowerCase();
  if (!ALLOWED_TYPES.has(type)) return { error: "type must be fuel, hydration, fuel_hydration or sleepy." };

  const deviceId = boundedString(payload.device_id, MAX_DEVICE_LENGTH);
  if (!deviceId) return { error: "device_id must be a non-empty bounded string." };

  return {
    value: {
      external_event_id: externalEventId,
      logged_at: loggedAt.toISOString(),
      type,
      device_id: deviceId
    }
  };
}

function validateTrainingCommandPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object." };
  }
  const action = String(payload.action || "").trim().toLowerCase();
  if (!new Set(["start", "end"]).has(action)) {
    return { error: "action must be start or end." };
  }
  const externalActionId = boundedString(payload.external_action_id || payload.external_event_id, MAX_ID_LENGTH);
  if (!externalActionId) {
    return { error: "external_action_id must be a non-empty bounded string." };
  }
  const occurredAt = parseTimestamp(payload.occurred_at || payload.logged_at);
  if (!occurredAt) {
    return { error: "occurred_at must be a valid timestamp." };
  }
  return {
    value: {
      action,
      external_action_id: externalActionId,
      occurred_at: occurredAt.toISOString()
    }
  };
}

function supabaseBaseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function envReady(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY && env.GARMIN_TOKEN_PEPPER);
}

function supabaseEnvReady(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

async function supabaseRequest(path, options, env) {
  const url = `${supabaseBaseUrl(env)}${path}`;
  const secret = env.SUPABASE_SECRET_KEY || "";
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      ...(options.headers || {})
    }
  });
  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { response, data };
}

function hmacHex(value, env, purpose = "device") {
  return crypto.createHmac("sha256", String(env.GARMIN_TOKEN_PEPPER || ""))
    .update(`${purpose}:`)
    .update(String(value || ""))
    .digest("hex");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function expiresAt(seconds = AUTH_CODE_TTL_SECONDS) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isExpired(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time <= Date.now();
}

function duplicateSupabaseError(result) {
  const status = result?.response?.status;
  const code = result?.data?.code;
  const message = String(result?.data?.message || result?.data?.details || "").toLowerCase();
  return status === 409 || code === "23505" || message.includes("duplicate");
}

async function getUserFromBearer(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const result = await supabaseRequest("/auth/v1/user", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  }, env);
  if (!result.response.ok || !result.data?.id) return null;
  return { id: result.data.id, email: result.data.email || "" };
}

function validateAuthRequestBody(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object." };
  }
  const appId = normalizeAppId(payload.app_id || payload.app);
  if (!appId) return { error: "app_id must be quick_log or activity_logger." };
  const state = boundedString(payload.state, MAX_STATE_LENGTH);
  if (!state) return { error: "state must be a non-empty bounded string." };
  return { value: { app_id: appId, state } };
}

function connectRedirect(params) {
  const query = new URLSearchParams(params);
  return `connectiq://oauth?${query.toString()}`;
}

async function insertAuthSession({ appId, stateHash, authorizationCodeHash = null, userId = null, status = "pending" }, env) {
  const row = {
    app_id: appId,
    state_hash: stateHash,
    authorization_code_hash: authorizationCodeHash,
    user_id: userId,
    status,
    expires_at: expiresAt(),
    approved_at: status === "approved" ? new Date().toISOString() : null
  };
  const result = await supabaseRequest("/rest/v1/garmin_auth_sessions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(row)
  }, env);
  if (!result.response.ok) throw new Error("auth_session_insert_failed");
  return Array.isArray(result.data) ? result.data[0] : result.data;
}

async function latestAuthSession(appId, stateHash, env) {
  const params = new URLSearchParams({
    select: "id,app_id,state_hash,user_id,status,expires_at,created_at",
    app_id: `eq.${appId}`,
    state_hash: `eq.${stateHash}`,
    order: "created_at.desc",
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/garmin_auth_sessions?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("auth_session_lookup_failed");
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function startAuthHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const validation = validateAuthRequestBody(payload);
  if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  const stateHash = hmacHex(validation.value.state, env, "state");
  try {
    const session = await insertAuthSession({ appId: validation.value.app_id, stateHash }, env);
    return jsonResponse(response, 201, { result: "pending", expires_at: session.expires_at });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function approveAuthHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const validation = validateAuthRequestBody(payload);
  if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  const user = await getUserFromBearer(request, env);
  if (!user) return jsonResponse(response, 401, { error: "supabase_session_required" });

  const { app_id: appId, state } = validation.value;
  const stateHash = hmacHex(state, env, "state");
  try {
    const latest = await latestAuthSession(appId, stateHash, env);
    if (latest?.status === "denied") return jsonResponse(response, 400, { error: "authorization_denied" });
    if (latest?.status === "exchanged") return jsonResponse(response, 400, { error: "authorization_already_used" });
    if (latest?.expires_at && isExpired(latest.expires_at)) return jsonResponse(response, 400, { error: "authorization_expired" });

    const authorizationCode = randomToken(24);
    const authorizationCodeHash = hmacHex(authorizationCode, env, "code");
    const session = await insertAuthSession({ appId, stateHash, authorizationCodeHash, userId: user.id, status: "approved" }, env);
    return jsonResponse(response, 201, {
      result: "approved",
      redirect_url: connectRedirect({ code: authorizationCode, state }),
      expires_at: session.expires_at
    });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function denyAuthHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const validation = validateAuthRequestBody(payload);
  if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  const { app_id: appId, state } = validation.value;
  try {
    await insertAuthSession({ appId, stateHash: hmacHex(state, env, "state"), status: "denied" }, env);
    return jsonResponse(response, 200, { result: "denied", redirect_url: connectRedirect({ error: "access_denied", state }) });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function exchangeAuthCode(appId, state, authorizationCode, env) {
  const stateHash = hmacHex(state, env, "state");
  const codeHash = hmacHex(authorizationCode, env, "code");
  const params = new URLSearchParams({
    select: "id,user_id,app_id,status,expires_at",
    app_id: `eq.${appId}`,
    state_hash: `eq.${stateHash}`,
    authorization_code_hash: `eq.${codeHash}`,
    status: "eq.approved",
    order: "created_at.desc",
    limit: "1"
  });
  const lookup = await supabaseRequest(`/rest/v1/garmin_auth_sessions?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!lookup.response.ok) throw new Error("authorization_lookup_failed");
  const session = Array.isArray(lookup.data) ? lookup.data[0] || null : null;
  if (!session) return { error: "authorization_invalid" };
  if (isExpired(session.expires_at)) return { error: "authorization_expired" };

  const update = await supabaseRequest(`/rest/v1/garmin_auth_sessions?id=eq.${encodeURIComponent(session.id)}&status=eq.approved`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({ status: "exchanged", exchanged_at: new Date().toISOString() })
  }, env);
  if (!update.response.ok || (Array.isArray(update.data) && update.data.length !== 1)) {
    return { error: "authorization_already_used" };
  }

  const deviceToken = randomToken(32);
  const tokenHash = hmacHex(deviceToken, env, "device");
  const tokenPrefix = deviceToken.slice(0, 8);
  const tokenInsert = await supabaseRequest("/rest/v1/garmin_device_tokens", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      user_id: session.user_id,
      app_id: appId,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      label: appId === "quick_log" ? "Quick Log" : "Activity Logger"
    })
  }, env);
  if (!tokenInsert.response.ok) throw new Error("device_token_insert_failed");

  return { deviceToken, tokenPrefix };
}

async function exchangeAuthHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const validation = validateAuthRequestBody(payload);
  if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  const authorizationCode = boundedString(payload.authorization_code || payload.code, MAX_STATE_LENGTH);
  if (!authorizationCode) return jsonResponse(response, 400, { error: "invalid_payload", message: "authorization_code must be provided." });
  try {
    const result = await exchangeAuthCode(validation.value.app_id, validation.value.state, authorizationCode, env);
    if (result.error) return jsonResponse(response, 401, { error: result.error });
    return jsonResponse(response, 200, {
      result: "ok",
      device_token: result.deviceToken,
      token_prefix: result.tokenPrefix
    });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function findDeviceToken(rawToken, env) {
  const tokenHash = hmacHex(rawToken, env, "device");
  const params = new URLSearchParams({
    select: "id,user_id,app_id,token_prefix,revoked_at",
    token_hash: `eq.${tokenHash}`,
    revoked_at: "is.null",
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/garmin_device_tokens?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("device_token_lookup_failed");
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function touchDeviceToken(tokenId, env) {
  await supabaseRequest(`/rest/v1/garmin_device_tokens?id=eq.${encodeURIComponent(tokenId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify({ last_used_at: new Date().toISOString() })
  }, env);
}

async function authenticatedDevice(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const device = await findDeviceToken(token, env);
  if (!device || device.revoked_at) return null;
  await touchDeviceToken(device.id, env);
  return device;
}

async function findExistingGarminLog(event, userId, env) {
  const params = new URLSearchParams({
    select: "id,external_event_id",
    user_id: `eq.${userId}`,
    source: "eq.garmin",
    external_event_id: `eq.${event.external_event_id}`,
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/fuel_logs?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("Supabase duplicate lookup failed.");
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function findTrainingModeSession(event, userId, env) {
  const params = new URLSearchParams({
    select: "id,user_id,status,started_at,ended_at,fuel_preset_id,hydration_preset_id,fuel_carbs_g,fuel_fluid_ml,fuel_sodium_mg,fuel_caffeine_mg,hydration_carbs_g,hydration_fluid_ml,hydration_sodium_mg,hydration_caffeine_mg",
    user_id: `eq.${userId}`,
    order: "started_at.desc",
    limit: "20"
  });
  const result = await supabaseRequest(`/rest/v1/fuel_training_mode_sessions?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) {
    // Deployment ordering safety: ordinary Garmin timing continues if the new
    // optional Training Mode table has not been migrated yet.
    if (result.response.status === 404 || result.data?.code === "PGRST205") return null;
    throw new Error("Training Mode lookup failed.");
  }
  const loggedAt = new Date(event.logged_at).getTime();
  return (Array.isArray(result.data) ? result.data : []).find(session => {
    const start = new Date(session.started_at).getTime();
    const end = session.ended_at ? new Date(session.ended_at).getTime() : Infinity;
    return Number.isFinite(start) && loggedAt >= start && loggedAt <= end;
  }) || null;
}

function trainingContextForGarminEvent(event, session) {
  if (!session) return {};
  const prefix = event.type === "hydration" ? "hydration" : "fuel";
  return {
    training_mode_session_id: session.id,
    training_mode_preset_id: session[`${prefix}_preset_id`],
    carbs_g: session[`${prefix}_carbs_g`],
    fluid_ml: session[`${prefix}_fluid_ml`],
    sodium_mg: session[`${prefix}_sodium_mg`],
    caffeine_mg: session[`${prefix}_caffeine_mg`]
  };
}

function sleepyCheckinNote() {
  return `${CHECKIN_NOTE_PREFIX}${JSON.stringify({
    version: 1,
    checkinType: TYPE_SLEEPY,
    context: "general_day",
    arousalLevel: TYPE_SLEEPY
  })}`;
}

function rowTypeForGarminEvent(event) {
  return event.type === TYPE_SLEEPY ? "fuel" : event.type;
}

function notesForGarminEvent(event) {
  return event.type === TYPE_SLEEPY
    ? sleepyCheckinNote()
    : `${GARMIN_DEVICE_NOTE_PREFIX}${event.device_id}`;
}

async function insertGarminLog(event, userId, env) {
  const trainingSession = await findTrainingModeSession(event, userId, env);
  const row = {
    user_id: userId,
    logged_at: event.logged_at,
    type: rowTypeForGarminEvent(event),
    source: "garmin",
    external_event_id: event.external_event_id,
    notes: notesForGarminEvent(event),
    ...trainingContextForGarminEvent(event, trainingSession)
  };

  const result = await supabaseRequest("/rest/v1/fuel_logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify(row)
  }, env);

  if (result.response.status === 201 || result.response.status === 200) {
    const rowData = Array.isArray(result.data) ? result.data[0] : result.data;
    return { statusCode: 201, body: { result: "ok", id: rowData?.id || null, external_event_id: event.external_event_id } };
  }

  if (duplicateSupabaseError(result)) {
    const existing = await findExistingGarminLog(event, userId, env);
    return { statusCode: 200, body: { result: "duplicate", id: existing?.id || null, external_event_id: event.external_event_id } };
  }

  throw new Error("Supabase insert failed.");
}

async function activeTrainingModeSession(userId, env) {
  const params = new URLSearchParams({
    select: "id,title,session_type,status,started_at,ended_at",
    user_id: `eq.${userId}`,
    status: "eq.active",
    order: "started_at.desc",
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/fuel_training_mode_sessions?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("Training Mode status lookup failed.");
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function latestFuelStatus(userId, env) {
  const params = new URLSearchParams({
    select: "logged_at,type,notes",
    user_id: `eq.${userId}`,
    type: "in.(fuel,fuel_hydration)",
    or: "(notes.is.null,and(notes.not.like.fuel_guard_checkin:*,notes.not.like.*fuel_guard_event:crash*))",
    order: "logged_at.desc",
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/fuel_logs?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("Fuel status lookup failed.");

  const row = Array.isArray(result.data) ? result.data[0] || null : null;
  const lastFuel = row ? parseTimestamp(row.logged_at) : null;
  return {
    last_fuel_at: lastFuel ? lastFuel.toISOString() : null,
    last_fuel_at_seconds: lastFuel ? Math.floor(lastFuel.getTime() / 1000) : null,
    synced_at_seconds: Math.floor(Date.now() / 1000)
  };
}

async function executeGarminTrainingCommand(command, device, env) {
  const result = await supabaseRequest("/rest/v1/rpc/fuel_garmin_training_command", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      p_device_token_id: device.id,
      p_user_id: device.user_id,
      p_action: command.action,
      p_external_action_id: command.external_action_id,
      p_occurred_at: command.occurred_at
    })
  }, env);
  if (!result.response.ok || !result.data || typeof result.data !== "object") {
    throw new Error("Garmin Training Mode command failed.");
  }
  return result.data;
}

async function garminTrainingHandler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let device;
  try { device = await authenticatedDevice(request, env); } catch { return jsonResponse(response, 500, { error: "server_error" }); }
  if (!device) return jsonResponse(response, 401, { error: "unauthorized" });

  if (request.method === "GET") {
    try {
      const [session, fuelStatus] = await Promise.all([
        activeTrainingModeSession(device.user_id, env),
        latestFuelStatus(device.user_id, env)
      ]);
      return jsonResponse(response, 200, {
        result: "ok",
        active: Boolean(session),
        session: session ? {
          id: session.id,
          title: session.title,
          session_type: session.session_type,
          started_at: session.started_at
        } : null,
        fuel_status: fuelStatus
      });
    } catch {
      return jsonResponse(response, 500, { error: "server_error" });
    }
  }

  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const validation = validateTrainingCommandPayload(payload);
  if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  try {
    const result = await executeGarminTrainingCommand(validation.value, device, env);
    return jsonResponse(response, 200, result);
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function garminLogHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let device;
  try { device = await authenticatedDevice(request, env); } catch { return jsonResponse(response, 500, { error: "server_error" }); }
  if (!device) return jsonResponse(response, 401, { error: "unauthorized" });

  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const validation = validatePayload(payload);
  if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  try {
    const result = await insertGarminLog(validation.value, device.user_id, env);
    return jsonResponse(response, result.statusCode, result.body);
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function devicesHandler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const env = process.env || {};
  if (!supabaseEnvReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  const user = await getUserFromBearer(request, env);
  if (!user) return jsonResponse(response, 401, { error: "supabase_session_required" });
  const params = new URLSearchParams({
    select: "id,app_id,token_prefix,label,created_at,last_used_at,revoked_at",
    user_id: `eq.${user.id}`,
    order: "created_at.desc"
  });
  const latestGarminLogParams = new URLSearchParams({
    select: "id,logged_at,type",
    user_id: `eq.${user.id}`,
    source: "eq.garmin",
    order: "logged_at.desc",
    limit: "1"
  });
  try {
    const [deviceResult, logResult] = await Promise.all([
      supabaseRequest(`/rest/v1/garmin_device_tokens?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      }, env),
      supabaseRequest(`/rest/v1/fuel_logs?${latestGarminLogParams.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      }, env)
    ]);
    if (!deviceResult.response.ok || !logResult.response.ok) throw new Error("devices_lookup_failed");
    const devices = Array.isArray(deviceResult.data) ? deviceResult.data : [];
    const latestGarminLog = Array.isArray(logResult.data) ? logResult.data[0] || null : null;
    const quickLogConnected = devices.some(device => device?.app_id === "quick_log" && !device?.revoked_at);
    return jsonResponse(response, 200, {
      devices,
      onboarding: {
        quick_log_connected: quickLogConnected,
        first_watch_log_received: Boolean(latestGarminLog?.id),
        latest_watch_log_at: latestGarminLog?.logged_at || null,
        latest_watch_log_type: latestGarminLog?.type || null,
        completed: quickLogConnected && Boolean(latestGarminLog?.id)
      }
    });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

async function revokeDeviceHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let payload;
  try { payload = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_json" }); }
  const now = new Date().toISOString();
  try {
    const user = await getUserFromBearer(request, env);
    if (user) {
      const deviceId = boundedString(payload.device_id || payload.id, 80);
      if (!deviceId) return jsonResponse(response, 400, { error: "invalid_payload", message: "device_id must be provided." });
      const result = await supabaseRequest(`/rest/v1/garmin_device_tokens?id=eq.${encodeURIComponent(deviceId)}&user_id=eq.${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Prefer: "return=representation"
        },
        body: JSON.stringify({ revoked_at: now })
      }, env);
      if (!result.response.ok) throw new Error("revoke_failed");
      const rows = Array.isArray(result.data) ? result.data : [];
      return jsonResponse(response, rows.length ? 200 : 404, rows.length ? { result: "revoked" } : { error: "not_found" });
    }

    const device = await findDeviceToken(bearerToken(request), env);
    if (!device) return jsonResponse(response, 401, { error: "unauthorized" });
    const result = await supabaseRequest(`/rest/v1/garmin_device_tokens?id=eq.${encodeURIComponent(device.id)}&revoked_at=is.null`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ revoked_at: now })
    }, env);
    if (!result.response.ok) throw new Error("revoke_failed");
    return jsonResponse(response, 200, { result: "revoked" });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

module.exports = {
  garminLogHandler,
  garminTrainingHandler,
  startAuthHandler,
  approveAuthHandler,
  denyAuthHandler,
  exchangeAuthHandler,
  devicesHandler,
  revokeDeviceHandler,
  authenticatedDevice,
  boundedString,
  duplicateSupabaseError,
  envReady,
  supabaseEnvReady,
  getUserFromBearer,
  jsonResponse,
  methodNotAllowed,
  parseTimestamp,
  readBody,
  supabaseRequest,
  _test: {
    ALLOWED_APPS,
    CHECKIN_NOTE_PREFIX,
    GARMIN_DEVICE_NOTE_PREFIX,
    TYPE_SLEEPY,
    validatePayload,
    validateTrainingCommandPayload,
    safeEqual,
    bearerToken,
    hmacHex,
    randomToken,
    envReady,
    supabaseEnvReady,
    getUserFromBearer,
    exchangeAuthCode,
    insertGarminLog,
    activeTrainingModeSession,
    latestFuelStatus,
    executeGarminTrainingCommand,
    notesForGarminEvent,
    rowTypeForGarminEvent,
    sleepyCheckinNote,
    findDeviceToken,
    findTrainingModeSession,
    trainingContextForGarminEvent,
    authenticatedDevice,
    boundedString,
    duplicateSupabaseError,
    jsonResponse,
    methodNotAllowed,
    parseTimestamp,
    readBody,
    supabaseRequest
  }
};
