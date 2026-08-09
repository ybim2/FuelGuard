const crypto = require("node:crypto");
const {
  getUserFromBearer,
  jsonResponse,
  methodNotAllowed,
  readBody,
  supabaseRequest
} = require("./garmin-auth.js");

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITATION_KINDS = new Set([
  "coach_athlete",
  "coach_approved",
  "coach_declined",
  "organisation_athlete",
  "organisation_staff"
]);

function emailEnvReady(env = process.env) {
  return Boolean(
    env.SUPABASE_URL
    && env.SUPABASE_SECRET_KEY
    && env.RESEND_API_KEY
    && env.FUEL_GUARD_EMAIL_FROM
    && env.FUEL_GUARD_APP_URL
  );
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>'"]/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function cleanLabel(value, fallback) {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return (text && text.length <= 120 ? text : "") || fallback;
}

function appUrl(env) {
  try {
    const url = new URL(String(env.FUEL_GUARD_APP_URL || ""));
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

async function singleRow(path, env) {
  const result = await supabaseRequest(path, { method: "GET", headers: { Accept: "application/json" } }, env);
  if (!result.response.ok) throw new Error("database_lookup_failed");
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function authUser(userId, env) {
  const result = await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok || !result.data?.email) throw new Error("recipient_not_found");
  return result.data;
}

async function coachAthleteInvitation(entityId, actor, env) {
  const query = new URLSearchParams({
    id: `eq.${entityId}`,
    coach_id: `eq.${actor.id}`,
    status: "eq.pending",
    select: "id,coach_id,athlete_id,status,coach_label,updated_at",
    limit: "1"
  });
  const relationship = await singleRow(`/rest/v1/fuel_coach_athletes?${query}`, env);
  if (!relationship) throw new Error("invitation_not_authorised");
  const recipient = await authUser(relationship.athlete_id, env);
  const coachLabel = cleanLabel(relationship.coach_label, "Your coach");
  return {
    recipient: recipient.email,
    subject: "New Fuel Guard coach connection request",
    heading: "A coach has requested a Fuel Guard connection",
    intro: `${coachLabel} has asked to connect with your Fuel Guard athlete account.`,
    detail: "Sign in to Fuel Guard to approve or decline the request. Your data stays private until you approve it.",
    idempotencyEntity: `${relationship.id}:pending:${relationship.updated_at || ""}`
  };
}

async function coachRelationshipDecision(entityId, actor, status, env) {
  const query = new URLSearchParams({
    id: `eq.${entityId}`,
    athlete_id: `eq.${actor.id}`,
    status: `eq.${status}`,
    select: "id,coach_id,athlete_id,status,athlete_label,accepted_at,updated_at",
    limit: "1"
  });
  const relationship = await singleRow(`/rest/v1/fuel_coach_athletes?${query}`, env);
  if (!relationship) throw new Error("invitation_not_authorised");
  const recipient = await authUser(relationship.coach_id, env);
  const athleteLabel = cleanLabel(relationship.athlete_label, "The athlete");
  const approved = status === "active";
  return {
    recipient: recipient.email,
    subject: approved ? "Your Fuel Guard connection was approved" : "Fuel Guard connection request declined",
    heading: approved ? "Your Fuel Guard coach connection was approved" : "Your Fuel Guard coach connection was declined",
    intro: approved
      ? `${athleteLabel} approved your Fuel Guard coach connection request.`
      : `${athleteLabel} declined your Fuel Guard coach connection request.`,
    detail: approved
      ? "You can now open Fuel Guard Coach to use the access the athlete approved."
      : "No athlete data was shared, and the declined request grants no access.",
    footer: approved
      ? "Coach access remains controlled by the athlete and can be revoked in Fuel Guard."
      : "The declined request grants no access.",
    idempotencyEntity: `${relationship.id}:${status}:${approved ? relationship.accepted_at || relationship.updated_at || "" : relationship.updated_at || ""}`
  };
}

async function organisationAthleteInvitation(entityId, actor, env) {
  const query = new URLSearchParams({
    id: `eq.${entityId}`,
    invited_by: `eq.${actor.id}`,
    status: "eq.invited",
    select: "id,organisation_id,athlete_id,status,invited_by,updated_at",
    limit: "1"
  });
  const share = await singleRow(`/rest/v1/fuel_organisation_athlete_shares?${query}`, env);
  if (!share) throw new Error("invitation_not_authorised");
  const organisationQuery = new URLSearchParams({ id: `eq.${share.organisation_id}`, select: "id,name", limit: "1" });
  const [recipient, organisation] = await Promise.all([
    authUser(share.athlete_id, env),
    singleRow(`/rest/v1/fuel_organisations?${organisationQuery}`, env)
  ]);
  const organisationName = cleanLabel(organisation?.name, "a Fuel Guard organisation");
  return {
    recipient: recipient.email,
    subject: "Fuel Guard organisation sharing invitation",
    heading: "You have a Fuel Guard sharing invitation",
    intro: `${organisationName} has invited you to share your Fuel Guard athlete data.`,
    detail: "No athlete data is shared until you review and accept the invitation in Fuel Guard.",
    idempotencyEntity: share.id
  };
}

async function organisationStaffNotification(entityId, organisationId, actor, env) {
  if (!UUID_RE.test(organisationId)) throw new Error("invalid_invitation_context");
  const query = new URLSearchParams({
    organisation_id: `eq.${organisationId}`,
    user_id: `eq.${entityId}`,
    invited_by: `eq.${actor.id}`,
    status: "eq.active",
    select: "id,organisation_id,user_id,role,status,invited_by,updated_at",
    limit: "1"
  });
  const membership = await singleRow(`/rest/v1/fuel_organisation_members?${query}`, env);
  if (!membership) throw new Error("invitation_not_authorised");
  const organisationQuery = new URLSearchParams({ id: `eq.${membership.organisation_id}`, select: "id,name", limit: "1" });
  const [recipient, organisation] = await Promise.all([
    authUser(membership.user_id, env),
    singleRow(`/rest/v1/fuel_organisations?${organisationQuery}`, env)
  ]);
  const organisationName = cleanLabel(organisation?.name, "a Fuel Guard organisation");
  return {
    recipient: recipient.email,
    subject: "Fuel Guard staff access added",
    heading: "You have been added to a Fuel Guard organisation",
    intro: `${organisationName} has added your Fuel Guard account as ${cleanLabel(membership.role, "staff")}.`,
    detail: "Organisation capabilities and scopes control what you can access. Membership alone does not provide athlete-data access.",
    idempotencyEntity: membership.id
  };
}

async function authorisedInvitation(kind, entityId, contextId, actor, env) {
  if (kind === "coach_athlete") return coachAthleteInvitation(entityId, actor, env);
  if (kind === "coach_approved") return coachRelationshipDecision(entityId, actor, "active", env);
  if (kind === "coach_declined") return coachRelationshipDecision(entityId, actor, "declined", env);
  if (kind === "organisation_athlete") return organisationAthleteInvitation(entityId, actor, env);
  if (kind === "organisation_staff") return organisationStaffNotification(entityId, contextId, actor, env);
  throw new Error("invalid_invitation_kind");
}

function emailMarkup(invitation, url) {
  const safeUrl = escapeHtml(url);
  const footer = invitation.footer || "If you were not expecting this, you can ignore it. The invitation does not grant access by itself.";
  return `<!doctype html><html><body style="margin:0;background:#f4f7f5;font-family:Arial,sans-serif;color:#101820"><main style="max-width:560px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border:1px solid #dfe7e2;border-radius:18px;padding:28px"><p style="margin:0 0 10px;color:#1c6f49;font-weight:700">Fuel Guard</p><h1 style="margin:0 0 16px;font-size:24px">${escapeHtml(invitation.heading)}</h1><p style="line-height:1.6">${escapeHtml(invitation.intro)}</p><p style="line-height:1.6">${escapeHtml(invitation.detail)}</p><p style="margin:24px 0"><a href="${safeUrl}" style="display:inline-block;background:#101820;color:#fff;text-decoration:none;border-radius:12px;padding:13px 18px;font-weight:700">Open Fuel Guard</a></p><p style="margin:0;color:#65736d;font-size:13px;line-height:1.5">${escapeHtml(footer)}</p></section></main></body></html>`;
}

function emailText(invitation, url) {
  const footer = invitation.footer || "If you were not expecting this, you can ignore it. The invitation does not grant access by itself.";
  return `Fuel Guard\n\n${invitation.heading}\n\n${invitation.intro}\n\n${invitation.detail}\n\nOpen Fuel Guard: ${url}\n\n${footer}`;
}

function idempotencyKey(kind, entityId) {
  const digest = crypto.createHash("sha256").update(`${kind}:${entityId}`).digest("hex").slice(0, 32);
  return `fuel-guard-invitation-${digest}`;
}

async function sendWithResend(invitation, kind, entityId, env, fetchImpl = fetch) {
  const url = appUrl(env);
  if (!url) throw new Error("email_configuration_invalid");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let result;
  try {
    result = await fetchImpl(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey(kind, invitation.idempotencyEntity || entityId)
      },
      body: JSON.stringify({
        from: env.FUEL_GUARD_EMAIL_FROM,
        to: [invitation.recipient],
        subject: invitation.subject,
        html: emailMarkup(invitation, url),
        text: emailText(invitation, url)
      }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
  let data = null;
  try { data = await result.json(); } catch { data = null; }
  if (!result.ok || !data?.id) throw new Error(`resend_delivery_failed:${result.status}`);
  return data.id;
}

function publicError(error) {
  const code = String(error?.message || error || "");
  if (code === "invitation_not_authorised") return { status: 404, error: "invitation_not_found", message: "The invitation is unavailable or you are not authorised to send it." };
  if (code === "recipient_not_found") return { status: 409, error: "recipient_unavailable", message: "The invitation recipient does not have a deliverable account email." };
  return { status: 502, error: "email_delivery_failed", message: "The Fuel Guard change remains saved, but its email could not be delivered." };
}

async function invitationEmailHandler(request, response, env = process.env, dependencies = {}) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  if (!emailEnvReady(env)) return jsonResponse(response, 503, { error: "email_not_configured", message: "Transactional email is not configured in this environment." });
  const actor = await getUserFromBearer(request, env);
  if (!actor) return jsonResponse(response, 401, { error: "unauthorised", message: "Sign in before sending an invitation email." });
  let body;
  try { body = await readBody(request); } catch { return jsonResponse(response, 400, { error: "invalid_body", message: "Provide a valid JSON body." }); }
  const kind = String(body?.kind || "");
  const entityId = String(body?.entity_id || "");
  const contextId = String(body?.context_id || "");
  if (!INVITATION_KINDS.has(kind) || !UUID_RE.test(entityId) || (kind === "organisation_staff" && !UUID_RE.test(contextId))) {
    return jsonResponse(response, 400, { error: "invalid_invitation", message: "Provide a supported invitation kind and record ID." });
  }
  try {
    const invitation = await authorisedInvitation(kind, entityId, contextId, actor, env);
    const messageId = await sendWithResend(invitation, kind, entityId, env, dependencies.fetch || fetch);
    console.info("Fuel Guard transactional email sent", { kind, entityId, contextId: contextId || undefined, actorId: actor.id, messageId });
    return jsonResponse(response, 200, { result: "sent", message_id: messageId });
  } catch (error) {
    const safe = publicError(error);
    console.error("Fuel Guard transactional email failed", { kind, entityId, contextId: contextId || undefined, actorId: actor.id, error: String(error?.message || error) });
    return jsonResponse(response, safe.status, { error: safe.error, message: safe.message });
  }
}

module.exports = {
  invitationEmailHandler,
  _test: {
    INVITATION_KINDS,
    appUrl,
    authorisedInvitation,
    emailEnvReady,
    emailMarkup,
    emailText,
    idempotencyKey,
    sendWithResend
  }
};
