import crypto from "node:crypto";

const baseUrl = (process.env.FUEL_GUARD_E2E_BASE_URL || "https://fuel-guard-iota.vercel.app").replace(/\/+$/, "");
const supabaseUrl = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseSecret = process.env.SUPABASE_SECRET_KEY || "";
const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

if (![
  requireEnv("SUPABASE_URL", supabaseUrl),
  requireEnv("SUPABASE_SECRET_KEY", supabaseSecret),
  requireEnv("SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_ANON_KEY", supabaseAnon)
].every(Boolean)) {
  process.exit();
}

const runId = crypto.randomUUID();
const email = `fuelguard-garmin-${runId}@example.invalid`;
const password = crypto.randomBytes(24).toString("base64url");
const state = crypto.randomBytes(24).toString("hex");
const externalEventId = `fg-zero-secret-e2e-${runId}`;
let userId = null;
let deviceToken = null;
let testPassed = false;

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { response, data };
}

async function supabase(path, options = {}) {
  return request(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      ...(options.headers || {})
    }
  });
}

async function cleanup() {
  try {
    if (userId) {
      await supabase(`/rest/v1/fuel_logs?user_id=eq.${encodeURIComponent(userId)}&source=eq.garmin`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await supabase(`/rest/v1/garmin_device_tokens?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await supabase(`/rest/v1/garmin_auth_sessions?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await request(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: { apikey: supabaseSecret, Authorization: `Bearer ${supabaseSecret}` }
      });
    }
  } catch (error) {
    console.error(`Cleanup warning: ${error?.message || "unknown cleanup error"}`);
  }
}

try {
  const create = await request(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: supabaseSecret,
      Authorization: `Bearer ${supabaseSecret}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password, email_confirm: true })
  });
  if (!create.response.ok || !create.data?.id) throw new Error(`temporary user create failed: ${create.response.status}`);
  userId = create.data.id;

  const signin = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseAnon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const accessToken = signin.data?.access_token;
  if (!signin.response.ok || !accessToken) throw new Error(`temporary user sign-in failed: ${signin.response.status}`);

  const approve = await request(`${baseUrl}/api/garmin/auth/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ app_id: "quick_log", state })
  });
  if (!approve.response.ok || !approve.data?.redirect_url) throw new Error(`approve failed: ${approve.response.status}`);
  const redirect = new URL(approve.data.redirect_url);
  const code = redirect.searchParams.get("code");
  if (!code || redirect.searchParams.get("state") !== state) throw new Error("approval redirect did not return code and matching state");

  const exchange = await request(`${baseUrl}/api/garmin/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: "quick_log", state, authorization_code: code })
  });
  deviceToken = exchange.data?.device_token;
  if (!exchange.response.ok || !deviceToken) throw new Error(`exchange failed: ${exchange.response.status}`);

  const event = {
    external_event_id: externalEventId,
    logged_at: new Date().toISOString(),
    type: "fuel",
    device_id: "fr255"
  };
  const first = await request(`${baseUrl}/api/garmin/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify(event)
  });
  if (!(first.response.status === 200 || first.response.status === 201)) throw new Error(`first log failed: ${first.response.status}`);

  const duplicate = await request(`${baseUrl}/api/garmin/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify(event)
  });
  if (duplicate.response.status !== 200 || duplicate.data?.result !== "duplicate") throw new Error(`duplicate log failed: ${duplicate.response.status}`);

  const verify = await supabase(`/rest/v1/fuel_logs?select=id,user_id,type,source,external_event_id&user_id=eq.${encodeURIComponent(userId)}&source=eq.garmin&external_event_id=eq.${encodeURIComponent(externalEventId)}`);
  if (!verify.response.ok || !Array.isArray(verify.data) || verify.data.length !== 1) throw new Error("exactly-one-row verification failed");
  if (verify.data[0].user_id !== userId || verify.data[0].type !== "fuel" || verify.data[0].source !== "garmin") throw new Error("verified row has incorrect ownership or type/source");

  const revoke = await request(`${baseUrl}/api/garmin/devices/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({})
  });
  if (!revoke.response.ok) throw new Error(`revoke failed: ${revoke.response.status}`);

  const revoked = await request(`${baseUrl}/api/garmin/log`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ ...event, external_event_id: `${externalEventId}-revoked` })
  });
  if (revoked.response.status !== 401) throw new Error(`revoked token did not return 401: ${revoked.response.status}`);

  testPassed = true;
  console.log(`Zero-secret Garmin e2e passed against ${baseUrl}`);
} finally {
  await cleanup();
  if (!testPassed) process.exitCode = 1;
}
