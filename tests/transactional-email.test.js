const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { invitationEmailHandler, _test } = require("../lib/transactional-email.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const ENTITY_ID = "10000000-1000-4000-8000-100000000001";
const ACTOR_ID = "20000000-2000-4000-8000-200000000002";
const ATHLETE_ID = "30000000-3000-4000-8000-300000000003";
const ORGANISATION_ID = "40000000-4000-4000-8000-400000000004";
const COACH_ID = "50000000-5000-4000-8000-500000000005";
const env = {
  SUPABASE_URL: "https://fuel-guard.test",
  SUPABASE_SECRET_KEY: "server-secret",
  RESEND_API_KEY: "resend-secret",
  FUEL_GUARD_EMAIL_FROM: "Fuel Guard <noreply@fuelguardapp.com>",
  FUEL_GUARD_APP_URL: "https://fuelguardapp.com"
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function responseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); }
  };
}

function request(body, token = "caller-token") {
  return { method: "POST", headers: { authorization: `Bearer ${token}` }, body };
}

test("Coach invitation email re-derives recipient and authorisation before calling Resend", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID, email: "coach@example.test" });
    if (String(url).includes("/rest/v1/fuel_coach_athletes?")) return json([{ id: ENTITY_ID, coach_id: ACTOR_ID, athlete_id: ATHLETE_ID, status: "pending", coach_label: "Coach Jo", updated_at: "2026-08-09T12:00:00Z" }]);
    if (String(url).endsWith(`/auth/v1/admin/users/${ATHLETE_ID}`)) return json({ id: ATHLETE_ID, email: "athlete@example.test" });
    if (String(url) === "https://api.resend.com/emails") return json({ id: "resend-message-1" });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const response = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "coach_athlete", entity_id: ENTITY_ID, recipient: "attacker@example.test" }), response, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { result: "sent", message_id: "resend-message-1" });
  const relationshipUrl = calls.find(call => call.url.includes("fuel_coach_athletes")).url;
  assert.match(relationshipUrl, new RegExp(`coach_id=eq\\.${ACTOR_ID}`));
  assert.match(relationshipUrl, /status=eq\.pending/);
  const resend = calls.find(call => call.url === "https://api.resend.com/emails");
  const payload = JSON.parse(resend.options.body);
  assert.deepEqual(payload.to, ["athlete@example.test"]);
  assert.equal(payload.from, "Fuel Guard <noreply@fuelguardapp.com>");
  assert.match(payload.text, /Open Fuel Guard: https:\/\/fuelguardapp\.com\//);
  assert.equal(payload.subject, "New Fuel Guard coach connection request");
  assert.doesNotMatch(resend.options.body, /attacker@example\.test/);
  assert.match(resend.options.headers["Idempotency-Key"], /^fuel-guard-invitation-[0-9a-f]{32}$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer caller-token");
  assert.equal(calls[0].options.headers.apikey, "server-secret");
});

test("Coach approval and decline emails require the athlete-owned completed transition", async () => {
  for (const scenario of [
    { kind: "coach_approved", status: "active", subject: "Your Fuel Guard connection was approved", messageId: "resend-approved" },
    { kind: "coach_declined", status: "declined", subject: "Fuel Guard connection request declined", messageId: "resend-declined" }
  ]) {
    const calls = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID, email: "athlete@example.test" });
      if (String(url).includes("/rest/v1/fuel_coach_athletes?")) return json([{
        id: ENTITY_ID,
        coach_id: COACH_ID,
        athlete_id: ACTOR_ID,
        status: scenario.status,
        athlete_label: "Athlete Sam",
        accepted_at: scenario.status === "active" ? "2026-08-09T12:10:00Z" : null,
        updated_at: "2026-08-09T12:10:00Z"
      }]);
      if (String(url).endsWith(`/auth/v1/admin/users/${COACH_ID}`)) return json({ id: COACH_ID, email: "coach@example.test" });
      if (String(url) === "https://api.resend.com/emails") return json({ id: scenario.messageId });
      throw new Error(`Unexpected URL: ${url}`);
    };
    try {
      for (let index = 0; index < 2; index += 1) {
        const response = responseCapture();
        await invitationEmailHandler(request({ kind: scenario.kind, entity_id: ENTITY_ID, recipient: "attacker@example.test" }), response, env);
        assert.equal(response.statusCode, 200);
      }
    } finally {
      global.fetch = originalFetch;
    }
    const relationshipUrl = calls.find(call => call.url.includes("fuel_coach_athletes")).url;
    assert.match(relationshipUrl, new RegExp(`athlete_id=eq\\.${ACTOR_ID}`));
    assert.match(relationshipUrl, new RegExp(`status=eq\\.${scenario.status}`));
    const resendCalls = calls.filter(call => call.url === "https://api.resend.com/emails");
    assert.equal(resendCalls.length, 2);
    assert.equal(resendCalls[0].options.headers["Idempotency-Key"], resendCalls[1].options.headers["Idempotency-Key"]);
    const resend = resendCalls[0];
    const payload = JSON.parse(resend.options.body);
    assert.deepEqual(payload.to, ["coach@example.test"]);
    assert.equal(payload.subject, scenario.subject);
    assert.doesNotMatch(resend.options.body, /attacker@example\.test/);
    assert.match(resend.options.headers["Idempotency-Key"], /^fuel-guard-invitation-[0-9a-f]{32}$/);
  }
});

test("Organisation invitation derives the athlete email and organisation name from authorised rows", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID });
    if (String(url).includes("fuel_organisation_athlete_shares")) return json([{ id: ENTITY_ID, organisation_id: ORGANISATION_ID, athlete_id: ATHLETE_ID, status: "invited", invited_by: ACTOR_ID, updated_at: "2026-08-09T12:00:00Z" }]);
    if (String(url).endsWith(`/auth/v1/admin/users/${ATHLETE_ID}`)) return json({ id: ATHLETE_ID, email: "athlete@example.test" });
    if (String(url).includes("fuel_organisations")) return json([{ id: ORGANISATION_ID, name: "Example Squad" }]);
    if (String(url) === "https://api.resend.com/emails") return json({ id: "resend-message-2" });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const response = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "organisation_athlete", entity_id: ENTITY_ID }), response, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(response.statusCode, 200);
  const shareUrl = calls.find(call => call.url.includes("fuel_organisation_athlete_shares")).url;
  assert.match(shareUrl, new RegExp(`invited_by=eq\\.${ACTOR_ID}`));
  const payload = JSON.parse(calls.find(call => call.url === "https://api.resend.com/emails").options.body);
  assert.match(payload.text, /Example Squad/);
  assert.match(payload.text, /No athlete data is shared until you review and accept/);
});

test("Organisation staff email requires the exact active membership created by the caller", async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID });
    if (String(url).includes("fuel_organisation_members")) return json([{ id: "50000000-5000-4000-8000-500000000005", organisation_id: ORGANISATION_ID, user_id: ATHLETE_ID, role: "staff", status: "active", invited_by: ACTOR_ID, updated_at: "2026-08-09T12:00:00Z" }]);
    if (String(url).endsWith(`/auth/v1/admin/users/${ATHLETE_ID}`)) return json({ id: ATHLETE_ID, email: "staff@example.test" });
    if (String(url).includes("fuel_organisations")) return json([{ id: ORGANISATION_ID, name: "Example Squad" }]);
    if (String(url) === "https://api.resend.com/emails") return json({ id: "resend-message-3" });
    throw new Error(`Unexpected URL: ${url}`);
  };
  const response = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "organisation_staff", entity_id: ATHLETE_ID, context_id: ORGANISATION_ID }), response, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(response.statusCode, 200);
  const membershipUrl = calls.find(call => call.url.includes("fuel_organisation_members")).url;
  assert.match(membershipUrl, new RegExp(`organisation_id=eq\\.${ORGANISATION_ID}`));
  assert.match(membershipUrl, new RegExp(`user_id=eq\\.${ATHLETE_ID}`));
  assert.match(membershipUrl, new RegExp(`invited_by=eq\\.${ACTOR_ID}`));
  const payload = JSON.parse(calls.find(call => call.url === "https://api.resend.com/emails").options.body);
  assert.deepEqual(payload.to, ["staff@example.test"]);
  assert.match(payload.text, /Membership alone does not provide athlete-data access/);
});

test("A direct-ID attack cannot send an invitation the caller does not own", async () => {
  let resendCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID });
    if (String(url).includes("fuel_coach_athletes")) return json([]);
    if (String(url) === "https://api.resend.com/emails") resendCalled = true;
    return json({}, 404);
  };
  const response = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "coach_athlete", entity_id: ENTITY_ID }), response, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "invitation_not_found");
  assert.equal(resendCalled, false);
});

test("A direct-ID attack cannot send a Coach decision notification", async () => {
  let resendCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID });
    if (String(url).includes("fuel_coach_athletes")) return json([]);
    if (String(url) === "https://api.resend.com/emails") resendCalled = true;
    return json({}, 404);
  };
  const response = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "coach_approved", entity_id: ENTITY_ID }), response, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error, "invitation_not_found");
  assert.equal(resendCalled, false);
});

test("Unauthenticated and invalid requests never reach Resend", async () => {
  let resendCalled = false;
  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) return json({}, 401);
    if (String(url) === "https://api.resend.com/emails") resendCalled = true;
    return json({}, 404);
  };
  const unauthenticated = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "coach_athlete", entity_id: ENTITY_ID }, "bad-token"), unauthenticated, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(resendCalled, false);

  global.fetch = async url => {
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID });
    if (String(url) === "https://api.resend.com/emails") resendCalled = true;
    return json({}, 404);
  };
  const invalid = responseCapture();
  try {
    await invitationEmailHandler(request({ kind: "coach_athlete", entity_id: "not-an-athlete-id" }), invalid, env);
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(invalid.statusCode, 400);
  assert.equal(resendCalled, false);
});

test("Retrying the same Coach request reuses the provider idempotency key", async () => {
  const resendKeys = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/auth/v1/user")) return json({ id: ACTOR_ID });
    if (String(url).includes("fuel_coach_athletes")) return json([{ id: ENTITY_ID, coach_id: ACTOR_ID, athlete_id: ATHLETE_ID, status: "pending", coach_label: "Coach Jo", updated_at: "2026-08-09T12:00:00Z" }]);
    if (String(url).endsWith(`/auth/v1/admin/users/${ATHLETE_ID}`)) return json({ id: ATHLETE_ID, email: "athlete@example.test" });
    if (String(url) === "https://api.resend.com/emails") {
      resendKeys.push(options.headers["Idempotency-Key"]);
      return json({ id: "resend-deduplicated-request" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = responseCapture();
      await invitationEmailHandler(request({ kind: "coach_athlete", entity_id: ENTITY_ID }), response, env);
      assert.equal(response.statusCode, 200);
    }
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(resendKeys.length, 2);
  assert.equal(resendKeys[0], resendKeys[1]);
});

test("Email delivery fails closed when server-only configuration is absent", async () => {
  const response = responseCapture();
  await invitationEmailHandler(request({ kind: "coach_athlete", entity_id: ENTITY_ID }), response, {});
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, "email_not_configured");
});

test("Resend integration remains server-only and Auth continues to own account email", () => {
  const publicConfig = read("api/supabase-config.js");
  const sw = read("sw.js");
  const authClient = read("fuel-supabase.js");
  const coach = read("coach/coach-beta.js");
  const athlete = read("fuel-beta.js");
  const athleteHtml = read("index.html");
  const emailClient = read("transactional-email-client.js");
  const performance = read("performance/performance.js");
  assert.doesNotMatch(publicConfig, /RESEND|SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(sw, /RESEND_API_KEY|SUPABASE_SECRET_KEY/);
  assert.match(authClient, /auth\.signUp/);
  assert.match(authClient, /resetPasswordForEmail/);
  assert.match(coach, /kind: "coach_athlete"/);
  assert.match(athlete, /kind: notificationKind/);
  assert.match(athlete, /"coach_approved"/);
  assert.match(athlete, /"coach_declined"/);
  assert.match(athlete, /\.eq\("status", expectedStatus\)[\s\S]*\.select\("id,status,accepted_at,updated_at"\)[\s\S]*FuelGuardTransactionalEmail\.sendNotification/);
  assert.match(athlete, /relationship was updated, but its email could not be delivered/);
  const transitionStart = athlete.indexOf("async function updateCoachSharingRelationship");
  const relationshipUpdate = athlete.indexOf(".update(patch)", transitionStart);
  const decisionEmail = athlete.indexOf("FuelGuardTransactionalEmail.sendNotification", transitionStart);
  assert.ok(transitionStart >= 0 && relationshipUpdate > transitionStart && decisionEmail > relationshipUpdate);
  assert.match(athleteHtml, /transactional-email-client\.js\?v=mobile-pwa-v148-coach-settings-athlete-fix/);
  assert.match(emailClient, /sendInvitation: sendNotification/);
  assert.match(performance, /kind: "organisation_athlete"/);
  assert.match(performance, /kind: "organisation_staff"/);
  assert.match(read("docs/resend-transactional-email.md"), /Resend custom SMTP/);
  assert.equal(_test.idempotencyKey("coach_athlete", ENTITY_ID), _test.idempotencyKey("coach_athlete", ENTITY_ID));
  assert.notEqual(
    _test.idempotencyKey("coach_athlete", `${ENTITY_ID}:pending:one`),
    _test.idempotencyKey("coach_athlete", `${ENTITY_ID}:pending:two`)
  );
});
