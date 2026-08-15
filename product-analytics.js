(function attachFuelGuardProductAnalytics(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardProductAnalytics = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardProductAnalytics(root) {
  "use strict";

  const FIRST_TOUCH_KEY = "fuelGuardProductAnalytics:firstTouch";
  const ACCOUNT_CREATED_KEY = "fuelGuardProductAnalytics:accountCreatedPending";
  const SESSION_KEY = "fuelGuardProductAnalytics:sessionId";
  const ALLOWED_METADATA = new Set([
    "source",
    "mode",
    "screen",
    "failure_category",
    "connection_type",
    "entry_method",
    "environment",
    "count"
  ]);
  const VIEW_EVENTS = Object.freeze({
    dashboard: "daily_mode_viewed",
    analytics: "analytics_viewed",
    checklist: "settings_viewed"
  });
  const FAILURE_EVENTS = Object.freeze({
    fuel: "fuel_log_failed",
    hydration: "fuel_log_failed",
    sleepy: "fuel_log_failed",
    supplement: "supplement_log_failed",
    training_start: "training_start_failed",
    training_complete: "training_complete_failed",
    garmin: "garmin_connection_failed"
  });
  let activeUserId = "";
  let inFlightAttribution = false;

  function storage(kind) {
    try {
      return kind === "session" ? root?.sessionStorage : root?.localStorage;
    } catch (_error) {
      return null;
    }
  }

  function uuid() {
    if (typeof root?.crypto?.randomUUID === "function") return root.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function sessionId() {
    const sessionStorage = storage("session");
    const existing = sessionStorage?.getItem?.(SESSION_KEY) || "";
    if (/^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const created = uuid();
    try { sessionStorage?.setItem?.(SESSION_KEY, created); } catch (_error) {}
    return created;
  }

  function appVersion() {
    return String(root?.FUEL_GUARD_BUILD?.canonicalApp || "unknown").slice(0, 120);
  }

  function platform() {
    const agent = String(root?.navigator?.userAgent || "");
    const standalone = Boolean(root?.matchMedia?.("(display-mode: standalone)")?.matches || root?.navigator?.standalone);
    if (standalone && /iPad|iPhone|iPod/i.test(agent)) return "ios_pwa";
    if (standalone && /Android/i.test(agent)) return "android_pwa";
    return standalone ? "pwa" : "web";
  }

  function timezoneName() {
    try {
      return String(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC").slice(0, 100);
    } catch (_error) {
      return "UTC";
    }
  }

  function environment() {
    const hostname = String(root?.location?.hostname || "").toLowerCase();
    return hostname === "fuelguardapp.com" || hostname === "www.fuelguardapp.com" ? "production" : "preview";
  }

  function cleanValue(value, maximum = 200) {
    const cleaned = String(value || "").trim().slice(0, maximum);
    return cleaned || "";
  }

  function safeMetadata(input = {}) {
    const metadata = {};
    Object.entries(input || {}).forEach(([key, value]) => {
      if (!ALLOWED_METADATA.has(key) || value == null) return;
      if (!["string", "number", "boolean"].includes(typeof value)) return;
      metadata[key] = typeof value === "string" ? value.slice(0, 160) : value;
    });
    metadata.environment = environment();
    return metadata;
  }

  function failureCategory(error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (/network|failed to fetch|load failed|offline|timeout/.test(message)) return "network";
    if (/row.level|permission|42501|unauthori[sz]ed|jwt|session/.test(message)) return "authorization";
    if (/schema cache|pgrst|database|postgres|constraint|duplicate/.test(message)) return "database";
    if (/configuration|configured|missing/.test(message)) return "configuration";
    return "unknown";
  }

  function userId() {
    return String(root?.fuelGuardCloud?.user?.id || "");
  }

  async function track(eventName, { metadata = {}, dedupeKey = "" } = {}) {
    const cloud = root?.fuelGuardCloud;
    const requestUserId = userId();
    if (!requestUserId || !cloud?.client?.rpc) return { status: "skipped", reason: "not_authenticated" };
    try {
      const { data, error } = await cloud.client.rpc("fuel_track_product_event", {
        p_event_name: eventName,
        p_platform: platform(),
        p_app_version: appVersion(),
        p_session_id: sessionId(),
        p_timezone_name: timezoneName(),
        p_dedupe_key: cleanValue(dedupeKey, 200) || null,
        p_metadata: safeMetadata(metadata)
      });
      if (error) throw error;
      if (requestUserId !== userId()) return { status: "stale" };
      return { status: "recorded", id: data || "" };
    } catch (error) {
      return { status: "error", category: failureCategory(error) };
    }
  }

  function trackFailure(action, error, { dedupeKey = "", metadata = {} } = {}) {
    const eventName = FAILURE_EVENTS[action];
    if (!eventName) return Promise.resolve({ status: "skipped", reason: "unsupported_action" });
    return track(eventName, {
      dedupeKey,
      metadata: { ...metadata, failure_category: failureCategory(error) }
    });
  }

  function readFirstTouch() {
    try {
      return JSON.parse(storage("local")?.getItem?.(FIRST_TOUCH_KEY) || "null");
    } catch (_error) {
      return null;
    }
  }

  function captureFirstTouch() {
    if (readFirstTouch()) return readFirstTouch();
    let params;
    try { params = new URLSearchParams(root?.location?.search || ""); } catch (_error) { return null; }
    const attribution = {
      source: cleanValue(params.get("utm_source"), 120),
      medium: cleanValue(params.get("utm_medium"), 120),
      campaign: cleanValue(params.get("utm_campaign"), 160),
      creator: cleanValue(params.get("utm_creator") || params.get("creator"), 160),
      content: cleanValue(params.get("utm_content"), 200),
      landingVariant: cleanValue(params.get("landing_variant"), 120)
    };
    if (!Object.values(attribution).some(Boolean)) return null;
    try { storage("local")?.setItem?.(FIRST_TOUCH_KEY, JSON.stringify(attribution)); } catch (_error) {}
    return attribution;
  }

  async function persistFirstTouch() {
    if (inFlightAttribution) return false;
    const attribution = readFirstTouch();
    const cloud = root?.fuelGuardCloud;
    const requestUserId = userId();
    if (!attribution || !requestUserId || !cloud?.client?.rpc) return false;
    inFlightAttribution = true;
    try {
      const { error } = await cloud.client.rpc("fuel_capture_first_touch_attribution", {
        p_source: attribution.source || null,
        p_medium: attribution.medium || null,
        p_campaign: attribution.campaign || null,
        p_creator: attribution.creator || null,
        p_content: attribution.content || null,
        p_landing_variant: attribution.landingVariant || null
      });
      const persisted = !error && requestUserId === userId();
      if (persisted) storage("local")?.removeItem?.(FIRST_TOUCH_KEY);
      return persisted;
    } catch (_error) {
      return false;
    } finally {
      inFlightAttribution = false;
    }
  }

  function activeScreen() {
    return String(root?.document?.querySelector?.(".screen.active")?.id || "dashboard");
  }

  function trackScreen(screen) {
    const normalized = String(screen || "");
    const eventName = VIEW_EVENTS[normalized];
    if (!eventName) return Promise.resolve({ status: "skipped" });
    return track(eventName, {
      dedupeKey: `session:${sessionId()}:view:${eventName}`,
      metadata: { screen: normalized }
    });
  }

  async function appReady(event) {
    const nextUserId = String(event?.detail?.userId || userId());
    if (!nextUserId || nextUserId !== userId()) return;
    activeUserId = nextUserId;
    await Promise.all([
      track("app_open", { dedupeKey: `session:${sessionId()}:app_open` }),
      track("session_started", { dedupeKey: `session:${sessionId()}:started` }),
      trackScreen(activeScreen()),
      persistFirstTouch()
    ]);
    if (storage("local")?.getItem?.(ACCOUNT_CREATED_KEY) === nextUserId) {
      const result = await track("account_created", { dedupeKey: "account_created" });
      if (result.status === "recorded") storage("local")?.removeItem?.(ACCOUNT_CREATED_KEY);
    }
  }

  function markAccountCreatedPending(userIdValue) {
    const accountId = cleanValue(userIdValue, 100);
    if (!accountId) return false;
    try { storage("local")?.setItem?.(ACCOUNT_CREATED_KEY, accountId); } catch (_error) { return false; }
    return true;
  }

  function bind() {
    captureFirstTouch();
    root?.addEventListener?.("fuelguard:private-app-ready", event => { void appReady(event); });
    root?.addEventListener?.("fuelguard:auth-state", event => {
      const nextUserId = String(event?.detail?.user?.id || "");
      if (!nextUserId) activeUserId = "";
      else if (activeUserId && activeUserId !== nextUserId) activeUserId = nextUserId;
    });
    root?.addEventListener?.("fuelguard:screen-viewed", event => { void trackScreen(event?.detail?.screen); });
    root?.addEventListener?.("fuelguard:onboarding-started", () => {
      void track("onboarding_started", { dedupeKey: "onboarding_started" });
    });
    root?.addEventListener?.("fuelguard:profile-name-ready", () => {
      void track("onboarding_completed", { dedupeKey: "onboarding_completed" });
    });
    root?.addEventListener?.("fuelguard:logging-confirmed", event => {
      const type = String(event?.detail?.type || "fuel");
      const eventName = type === "hydration"
        ? "hydration_logged"
        : type === "sleepy"
          ? "sleepy_logged"
          : "fuel_logged";
      const logId = cleanValue(event?.detail?.logId, 100);
      void track(eventName, {
        dedupeKey: logId ? `fuel_logs:${logId}:${eventName}` : "",
        metadata: { source: "daily_mode" }
      });
    });
    root?.addEventListener?.("fuelguard:supplement-logged", event => {
      const ids = Array.isArray(event?.detail?.eventIds) ? event.detail.eventIds.map(String).sort() : [];
      void track("supplement_logged", {
        dedupeKey: ids.length ? `fuel_supplement_events:${ids.join(",")}` : "",
        metadata: { source: "daily_mode", count: Number(event?.detail?.count || ids.length || 1) }
      });
    });
    root?.addEventListener?.("fuelguard:training-session-synced", event => {
      const phase = event?.detail?.phase === "completed" ? "completed" : "started";
      const id = cleanValue(event?.detail?.sessionId, 100);
      void track(phase === "completed" ? "training_completed" : "training_started", {
        dedupeKey: id ? `fuel_training_mode_sessions:${id}:${phase}` : "",
        metadata: { source: event?.detail?.source || "athlete" }
      });
    });
    root?.addEventListener?.("fuelguard:work-pattern-updated", () => {
      void track("work_pattern_configured", { dedupeKey: `work_pattern:${new Date().toISOString().slice(0, 10)}` });
    });
    root?.addEventListener?.("fuelguard:garmin-devices", event => {
      if (event?.detail?.status === "ready" && event?.detail?.quickLogConnected) {
        void track("garmin_connected", { dedupeKey: "garmin_connected", metadata: { connection_type: "quick_log" } });
      } else if (event?.detail?.status === "error") {
        void trackFailure("garmin", new Error("Garmin connection status failed"), {
          dedupeKey: `session:${sessionId()}:garmin_connection_failed`
        });
      }
    });
    root?.addEventListener?.("pagehide", () => {
      void track("session_ended", { dedupeKey: `session:${sessionId()}:ended` });
    });
  }

  bind();

  return Object.freeze({
    track,
    trackFailure,
    trackScreen,
    markAccountCreatedPending,
    captureFirstTouch,
    persistFirstTouch,
    _test: Object.freeze({
      safeMetadata,
      failureCategory,
      platform,
      environment,
      sessionId,
      viewEvents: VIEW_EVENTS,
      failureEvents: FAILURE_EVENTS
    })
  });
});
