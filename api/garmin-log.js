const crypto = require("node:crypto");

const ALLOWED_TYPES = new Set(["fuel", "hydration", "fuel_hydration"]);
const MAX_ID_LENGTH = 160;
const MAX_DEVICE_LENGTH = 80;
const GARMIN_DEVICE_NOTE_PREFIX = "fuel_guard_garmin_device:";

function jsonResponse(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
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

function parseTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function readBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    return JSON.parse(request.body.toString("utf8"));
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
  if (!ALLOWED_TYPES.has(type)) return { error: "type must be fuel, hydration or fuel_hydration." };

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

function supabaseBaseUrl(env) {
  return String(env.SUPABASE_URL || "").replace(/\/+$/, "");
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

function duplicateSupabaseError(result) {
  const status = result?.response?.status;
  const code = result?.data?.code;
  const message = String(result?.data?.message || result?.data?.details || "").toLowerCase();
  return status === 409 || code === "23505" || message.includes("duplicate");
}

async function findExistingGarminLog(event, env) {
  const params = new URLSearchParams({
    select: "id,external_event_id",
    user_id: `eq.${env.GARMIN_BETA_USER_ID}`,
    source: "eq.garmin",
    external_event_id: `eq.${event.external_event_id}`,
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/fuel_logs?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  }, env);
  if (!result.response.ok) throw new Error("Supabase duplicate lookup failed.");
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function insertGarminLog(event, env) {
  const row = {
    user_id: env.GARMIN_BETA_USER_ID,
    logged_at: event.logged_at,
    type: event.type,
    source: "garmin",
    external_event_id: event.external_event_id,
    notes: `${GARMIN_DEVICE_NOTE_PREFIX}${event.device_id}`
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
    const existing = await findExistingGarminLog(event, env);
    return { statusCode: 200, body: { result: "duplicate", id: existing?.id || null, external_event_id: event.external_event_id } };
  }

  throw new Error("Supabase insert failed.");
}

function envReady(env) {
  return Boolean(env.GARMIN_BETA_TOKEN && env.GARMIN_BETA_USER_ID && env.SUPABASE_URL && env.SUPABASE_SECRET_KEY);
}

async function garminLogHandler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return jsonResponse(response, 405, { error: "method_not_allowed" });
  }

  const env = process.env || {};
  if (!envReady(env)) {
    return jsonResponse(response, 500, { error: "server_not_configured" });
  }

  if (!safeEqual(bearerToken(request), env.GARMIN_BETA_TOKEN)) {
    return jsonResponse(response, 401, { error: "unauthorized" });
  }

  let payload;
  try {
    payload = await readBody(request);
  } catch {
    return jsonResponse(response, 400, { error: "invalid_json" });
  }

  const validation = validatePayload(payload);
  if (validation.error) {
    return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
  }

  try {
    const result = await insertGarminLog(validation.value, env);
    return jsonResponse(response, result.statusCode, result.body);
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

module.exports = garminLogHandler;
module.exports._test = {
  GARMIN_DEVICE_NOTE_PREFIX,
  validatePayload,
  safeEqual,
  bearerToken,
  insertGarminLog
};
