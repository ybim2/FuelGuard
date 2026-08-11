// Athlete-owned Work Mode sessions reuse the canonical Fuel Guard log timeline.
(() => {
  "use strict";

  const TABLE = "fuel_work_mode_sessions";
  const COLUMNS = "id,user_id,title,status,started_at,ended_at,created_at,updated_at";
  let syncing = false;
  let timer = 0;
  let statusMessage = "";

  function domain() {
    return window.FuelGuardDomain;
  }

  function cloud() {
    return window.fuelGuardCloud;
  }

  function gapState() {
    return typeof fuelGapState === "function" ? fuelGapState() : null;
  }

  function state() {
    const gap = gapState();
    if (!gap) return null;
    if (!gap.workMode || typeof gap.workMode !== "object" || Array.isArray(gap.workMode)) {
      gap.workMode = { ownerUserId: "", activeSession: null, sessions: [], lastSyncedAt: "", lastError: "" };
    }
    if (!Array.isArray(gap.workMode.sessions)) gap.workMode.sessions = [];
    if (typeof gap.workMode.ownerUserId !== "string") gap.workMode.ownerUserId = "";
    return gap.workMode;
  }

  function escape(value) {
    return domain()?.escapeHtml?.(value) || String(value ?? "");
  }

  function persist() {
    if (typeof save === "function") save();
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (typeof uid === "function") return uid();
    throw new Error("A secure Work Mode identifier is unavailable.");
  }

  function sessionFromRow(row) {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title || "Work period",
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dirty: false
    };
  }

  function sessionRow(session, userId) {
    return {
      id: session.id,
      user_id: userId,
      title: String(session.title || "Work period").trim().slice(0, 120) || "Work period",
      status: session.status,
      started_at: session.startedAt,
      ended_at: session.endedAt || null,
      updated_at: session.updatedAt || new Date().toISOString()
    };
  }

  function resetForIdentity(userId = "") {
    const work = state();
    if (!work) return;
    const previousOwner = work.ownerUserId;
    if (previousOwner && previousOwner !== String(userId || "")) {
      logs().forEach(log => {
        log.workModeSessionId = "";
        if (Object.hasOwn(log, "work_mode_session_id")) log.work_mode_session_id = null;
      });
    }
    work.ownerUserId = String(userId || "");
    work.activeSession = null;
    work.sessions = [];
    work.lastSyncedAt = "";
    work.lastError = "";
    statusMessage = "";
    persist();
  }

  function claimIdentity(userId) {
    const work = state();
    const next = String(userId || "");
    if (!work || !next) return;
    if (work.ownerUserId && work.ownerUserId !== next) {
      resetForIdentity(next);
      return;
    }
    if (!work.ownerUserId) {
      work.ownerUserId = next;
      work.sessions.forEach(session => { session.userId = next; session.dirty = true; });
      if (work.activeSession) work.activeSession.userId = next;
      persist();
    }
  }

  function activeSession() {
    return state()?.activeSession || null;
  }

  function activeSessionConflict(error) {
    return String(error?.code || "") === "23505"
      && /fuel_work_mode_sessions_one_active_idx|duplicate key/i.test(String(error?.message || ""));
  }

  function sessionContains(session, at) {
    const time = new Date(at).getTime();
    const start = new Date(session?.startedAt || session?.started_at || "").getTime();
    const endValue = session?.endedAt || session?.ended_at;
    const end = endValue ? new Date(endValue).getTime() : Infinity;
    return Number.isFinite(time) && Number.isFinite(start) && time >= start && time <= end;
  }

  function contextForEvent(at = new Date()) {
    const work = state();
    const session = work?.sessions.find(item => sessionContains(item, at)) || null;
    return session ? { workModeSessionId: session.id } : {};
  }

  function logs() {
    return Array.isArray(gapState()?.logs) ? gapState().logs : [];
  }

  function durationText(minutes) {
    const value = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(value / 60);
    const remainder = value % 60;
    return hours ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
  }

  function differenceText(value, noun) {
    const rounded = Math.round(Number(value) * 10) / 10;
    if (!Number.isFinite(rounded) || Math.abs(rounded) < 0.1) return `${noun} matched the recent average.`;
    return `${Math.abs(rounded)} ${noun} ${rounded > 0 ? "above" : "below"} the recent average.`;
  }

  function summaryMarkup(session) {
    const summary = domain().workSessionSummary({ session, sessions: state()?.sessions || [], logs: logs(), now: new Date() });
    const comparison = summary.comparison
      ? `<p class="work-mode-comparison">Compared with ${summary.comparison.sampleCount} recent work periods: ${escape(differenceText(summary.comparison.fuelDifference, "Fuel moment"))} ${escape(differenceText(summary.comparison.hydrationDifference, "Hydration moment"))}</p>`
      : `<p class="work-mode-comparison">Complete at least three earlier work periods to unlock a valid comparison.</p>`;
    return `
      <div class="work-mode-summary-grid">
        <span><small>Duration</small><strong>${escape(durationText(summary.durationMinutes))}</strong></span>
        <span><small>Fuel</small><strong>${summary.fuelCount}</strong></span>
        <span><small>Hydration</small><strong>${summary.hydrationCount}</strong></span>
        <span><small>Sleepy</small><strong>${summary.sleepyCount}</strong></span>
      </div>
      <div class="work-mode-gap-row">
        <span>Longest Fuel gap <strong>${Number.isFinite(summary.longestFuelGapMinutes) ? escape(domain().duration(summary.longestFuelGapMinutes)) : "Needs two Fuel logs"}</strong></span>
        <span>Longest Hydration gap <strong>${Number.isFinite(summary.longestHydrationGapMinutes) ? escape(domain().duration(summary.longestHydrationGapMinutes)) : "Needs two Hydration logs"}</strong></span>
      </div>
      ${summary.sleepyTimes.length ? `<p class="work-mode-sleepy">Sleepy recorded at ${summary.sleepyTimes.map(escape).join(" · ")}.</p>` : `<p class="work-mode-sleepy">No Sleepy events were recorded in this work period.</p>`}
      ${comparison}
    `;
  }

  function render() {
    const target = document.getElementById("athleteWorkMode");
    if (!target || !domain()) return;
    const work = state();
    const active = activeSession();
    const completed = work.sessions
      .filter(session => session.status === "completed" && session.endedAt)
      .sort((left, right) => new Date(right.endedAt) - new Date(left.endedAt));
    if (timer) clearInterval(timer);
    if (active) {
      const renderDuration = () => durationText((Date.now() - new Date(active.startedAt).getTime()) / 60000);
      target.innerHTML = `
        <article class="work-mode-card active">
          <div class="work-mode-heading"><div><span>Work Mode active</span><h3>Fuelling this work period</h3></div><strong data-work-duration>${escape(renderDuration())}</strong></div>
          <p>Fuel, Hydrate and Sleepy stay in Daily and are also linked to this work period. Training Mode can run at the same time; each context remains explicit.</p>
          <button type="button" class="secondary" data-work-mode-end>End Work Day</button>
          ${statusMessage ? `<small role="status">${escape(statusMessage)}</small>` : ""}
        </article>`;
      timer = setInterval(() => {
        const duration = target.querySelector("[data-work-duration]");
        if (duration) duration.textContent = renderDuration();
      }, 30000);
      return;
    }
    target.innerHTML = `
      <article class="work-mode-card">
        <div class="work-mode-heading"><div><span>Work Mode</span><h3>How are you fuelling while working?</h3></div></div>
        <p>Start a work period without changing normal Fuel Guard logging. This is fuelling context, not productivity or time tracking.</p>
        <button type="button" class="secondary" data-work-mode-start>Start Work Mode</button>
        ${statusMessage ? `<small role="status">${escape(statusMessage)}</small>` : ""}
        ${completed.length ? `<details class="work-mode-latest"><summary>Latest work summary</summary>${summaryMarkup(completed[0])}</details>` : ""}
      </article>`;
  }

  async function syncSession(session) {
    const userId = cloud()?.user?.id;
    const client = cloud()?.client;
    if (!userId || !client?.from || !session) return { status: "local" };
    claimIdentity(userId);
    const result = await client.from(TABLE).upsert(sessionRow(session, userId), { onConflict: "id" }).select(COLUMNS).single();
    if (result.error) throw result.error;
    const remote = sessionFromRow(result.data);
    const work = state();
    work.sessions = work.sessions.map(item => item.id === remote.id ? remote : item);
    work.activeSession = remote.status === "active" ? remote : work.sessions.find(item => item.status === "active") || null;
    persist();
    return { status: "synced", session: remote };
  }

  async function start() {
    const work = state();
    if (!work || work.activeSession) return;
    if (navigator.onLine !== false && cloud()?.user?.id && cloud()?.client?.from) {
      await syncCloud();
      if (activeSession()) {
        statusMessage = "Work Mode is already active on this account.";
        render();
        return;
      }
    }
    const now = new Date().toISOString();
    const session = { id: uuid(), userId: cloud()?.user?.id || "", title: "Work period", status: "active", startedAt: now, endedAt: null, createdAt: now, updatedAt: now, dirty: true };
    work.sessions.unshift(session);
    work.activeSession = session;
    statusMessage = navigator.onLine === false ? "Work Mode started here. Cloud sync will follow when online." : "Work Mode started.";
    persist();
    render();
    try {
      await syncSession(session);
      statusMessage = "Work Mode active and synced.";
    } catch (error) {
      work.lastError = error?.message || "Work Mode sync failed.";
      statusMessage = "Work Mode is active here; cloud sync needs attention.";
    }
    render();
  }

  async function end() {
    const work = state();
    const active = work?.activeSession;
    if (!active) return;
    const endedAt = new Date().toISOString();
    active.status = "completed";
    active.endedAt = endedAt;
    active.updatedAt = endedAt;
    active.dirty = true;
    work.activeSession = null;
    statusMessage = "Work period complete.";
    persist();
    render();
    try {
      await syncSession(active);
      statusMessage = "Work period complete and synced.";
    } catch (error) {
      work.lastError = error?.message || "Work Mode sync failed.";
      statusMessage = "Work period ended here; cloud sync needs attention.";
    }
    window.dispatchEvent(new CustomEvent("fuelguard:work-session-ended", { detail: { session: active } }));
    render();
  }

  async function syncCloud() {
    if (syncing) return;
    const userId = cloud()?.user?.id;
    const client = cloud()?.client;
    if (!userId || !client?.from) {
      if (!userId && state()?.ownerUserId) resetForIdentity("");
      render();
      return;
    }
    claimIdentity(userId);
    syncing = true;
    try {
      const work = state();
      for (const session of work.sessions.filter(item => item.dirty)) {
        try {
          await syncSession(session);
        } catch (error) {
          if (!activeSessionConflict(error) || session.status !== "active") throw error;
          work.sessions = work.sessions.filter(item => item.id !== session.id);
          if (work.activeSession?.id === session.id) work.activeSession = null;
        }
      }
      const result = await client.from(TABLE).select(COLUMNS).eq("user_id", userId).order("started_at", { ascending: false }).limit(50);
      if (result.error) throw result.error;
      if (cloud()?.user?.id !== userId) return;
      const remote = (result.data || []).map(sessionFromRow);
      const byId = new Map(remote.map(item => [item.id, item]));
      work.sessions.filter(item => item.dirty).forEach(item => { if (!byId.has(item.id)) byId.set(item.id, item); });
      work.sessions = [...byId.values()].sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
      work.activeSession = work.sessions.find(item => item.status === "active") || null;
      work.lastSyncedAt = new Date().toISOString();
      work.lastError = "";
      persist();
    } catch (error) {
      state().lastError = error?.message || "Work Mode sync failed.";
    } finally {
      syncing = false;
      render();
    }
  }

  async function ensureSessionSyncedForLog(log) {
    const sessionId = String(log?.workModeSessionId || log?.work_mode_session_id || "");
    if (!sessionId) return;
    const session = state()?.sessions.find(item => item.id === sessionId);
    const userId = cloud()?.user?.id || "";
    if (!session || (session.userId && userId && session.userId !== userId)) {
      log.workModeSessionId = "";
      if (Object.hasOwn(log, "work_mode_session_id")) log.work_mode_session_id = null;
      persist();
      return;
    }
    if (session?.dirty) await syncSession(session);
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-work-mode-start]")) return start();
    if (event.target.closest("[data-work-mode-end]")) return end();
  });
  window.addEventListener("fuelguard:cloud-status", () => syncCloud());
  window.addEventListener("online", () => syncCloud());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncCloud(); });
  document.addEventListener("DOMContentLoaded", render);
  requestAnimationFrame(render);

  window.FuelGuardWorkMode = Object.freeze({
    render,
    start,
    end,
    activeSession,
    contextForEvent,
    syncCloud,
    ensureSessionSyncedForLog,
    _test: Object.freeze({ sessionContains, sessionFromRow, durationText, differenceText, activeSessionConflict })
  });
})();
