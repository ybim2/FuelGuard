(() => {
  "use strict";
  const TABLE = "fuel_recovery_focus_sessions";
  const MAX_MS = 24 * 60 * 60 * 1000;
  let rows = [];
  let owner = "";
  let offeredTrainingSession = null;
  let message = "";
  function cloud() { return window.fuelGuardCloud; }
  function training() { return window.FuelGuardTrainingMode; }
  function work() { return window.FuelGuardWorkMode; }
  function escape(value) { return window.FuelGuardDomain?.escapeHtml?.(value) || String(value ?? ""); }
  function uuid() { return globalThis.crypto?.randomUUID?.() || `recovery-${Date.now()}`; }
  function active(now = new Date()) { return rows.find(row => row.status === "active" && new Date(row.expires_at) > now) || null; }
  function primaryContext(at = new Date()) { return training()?.activeSession?.() ? "training" : work()?.isDuringWork?.(at) ? "work" : "everyday"; }
  function contextSnapshot(at = new Date()) {
    const trainingSession = training()?.activeSession?.();
    const recovery = active();
    return { primary: primaryContext(at), trainingSessionId: trainingSession?.id || null, workInferred: !trainingSession && Boolean(work()?.isDuringWork?.(at)), recoveryFocusId: recovery?.id || null, capturedAt: new Date().toISOString() };
  }
  function recoverySummary(recovery = active()) {
    const trainingState = typeof fuelGapState === "function" ? fuelGapState()?.trainingMode : null;
    const sessions = Array.isArray(trainingState?.sessions) ? trainingState.sessions : [];
    const source = recovery ? sessions.find(session => session.id === recovery.source_training_session_id) : sessions.find(session => session.status === "completed" && session.endedAt);
    if (!source?.endedAt) return null;
    const ended = new Date(source.endedAt); const logs = typeof fuelGapState === "function" ? fuelGapState()?.logs || [] : [];
    const after = logs.filter(log => (window.FuelGuardDomain?.logDate?.(log) || new Date(log.timestamp || log.logged_at || "")) >= ended);
    return { source, ended, minutes: Math.max(0,Math.floor((Date.now()-ended)/60000)), fuel: after.some(log=>window.FuelGuardDomain?.isFuelLog?.(log)), hydration: after.some(log=>window.FuelGuardDomain?.isHydrationLog?.(log)) };
  }
  function renderRecovery() {
    const target = document.getElementById("athleteRecoveryFocus");
    if (!target) return;
    const recovery = active();
    const supplement = window.FuelGuardSupplementRhythm?.recoveryActionSummary?.() || { planned: 0, taken: 0, dueLabel: "" };
    if (recovery) {
      const remaining = Math.max(0, Math.ceil((new Date(recovery.expires_at) - Date.now()) / 3600000)); const summary=recoverySummary(recovery);
      target.innerHTML = `<article class="recovery-focus-card"><span>Recovery Focus</span><h3>Post-training context is active</h3><div class="recovery-action-row"><b>${summary?.minutes || 0}m since training</b><b>${summary?.fuel ? "Post-training fuel logged" : "Post-training fuel not logged"}</b><b>${summary?.hydration ? "Fluids logged" : "Fluids not logged"}</b>${supplement.planned ? `<b>${supplement.taken} of ${supplement.planned} planned supplement moments logged</b>` : ""}</div><p>Recovery-supporting actions remain records of behaviour, not a recovery score. This technical focus expires within ${remaining} hour${remaining === 1 ? "" : "s"}.</p><button class="secondary" type="button" data-recovery-end>End Recovery Focus</button>${message ? `<small>${escape(message)}</small>` : ""}</article>`;
    } else if (offeredTrainingSession) {
      target.innerHTML = `<article class="recovery-focus-card offer"><span>Training complete</span><h3>Keep recovery visible?</h3><p>Recovery Focus is optional and starts only if you choose it.</p><div class="button-row"><button class="secondary" type="button" data-recovery-start>Start Recovery Focus</button><button class="secondary" type="button" data-recovery-dismiss>Not now</button></div></article>`;
    } else { const summary=recoverySummary(); target.innerHTML=summary&&summary.minutes<=1440?`<article class="recovery-layer-strip"><span>Recovery layer</span><b>${summary.minutes}m since training</b><b>${summary.fuel?"Post-training fuel logged":"Post-training fuel not logged"}</b><b>${summary.hydration?"Fluids logged":"Fluids not logged"}</b>${supplement.dueLabel?`<b>${escape(supplement.dueLabel)} due</b>`:""}</article>`:""; }
  }
  function render() { renderRecovery(); }
  async function load() {
    const userId = String(cloud()?.user?.id || "");
    if (!userId || !cloud()?.client) { owner = ""; rows = []; offeredTrainingSession = null; render(); return; }
    if (owner && owner !== userId) { rows = []; offeredTrainingSession = null; }
    owner = userId;
    const { data, error } = await cloud().client.from(TABLE).select("id,user_id,source_training_session_id,status,started_at,ended_at,expires_at,end_reason").eq("user_id", userId).order("started_at", { ascending: false }).limit(30);
    if (error) { message = /does not exist|schema cache/i.test(error.message || "") ? "Recovery Focus is waiting for its release migration." : "Recovery Focus could not sync."; render(); return; }
    if (cloud()?.user?.id !== userId) return;
    rows = data || [];
    const stale = rows.find(row => row.status === "active" && new Date(row.expires_at) <= new Date());
    if (stale) await end("expired", stale);
    if (training()?.activeSession?.() && active()) await end("new_training");
    render();
  }
  async function start() {
    const user = cloud()?.user; const session = offeredTrainingSession;
    if (!user?.id || !session?.id) return;
    const now = new Date();
    const { data, error } = await cloud().client.from(TABLE).insert({ id: uuid(), user_id: user.id, source_training_session_id: session.id, status: "active", started_at: now.toISOString(), expires_at: new Date(now.getTime() + MAX_MS).toISOString() }).select().single();
    if (error) { message = `Recovery Focus could not start: ${error.message}`; render(); return; }
    rows.unshift(data); offeredTrainingSession = null; message = "Recovery Focus started."; render();
  }
  async function end(reason = "manual", selected = active()) {
    const row = selected || rows.find(item => item.status === "active");
    if (!row || !cloud()?.client) return;
    const { data, error } = await cloud().client.from(TABLE).update({ status: reason === "expired" ? "expired" : "completed", ended_at: new Date().toISOString(), end_reason: reason }).eq("id", row.id).eq("user_id", owner).select().single();
    if (!error && data) rows = rows.map(item => item.id === data.id ? data : item);
    message = error ? "Recovery Focus could not sync." : "Recovery Focus ended."; render();
  }
  document.addEventListener("click", event => {
    if (event.target.closest("[data-recovery-start]")) start();
    if (event.target.closest("[data-recovery-end]")) end("manual");
    if (event.target.closest("[data-recovery-dismiss]")) { offeredTrainingSession = null; render(); }
  });
  window.addEventListener("fuelguard:training-session-ended", event => { offeredTrainingSession = event.detail?.session || null; render(); });
  window.addEventListener("fuelguard:training-session-started", () => { if (active()) end("new_training"); offeredTrainingSession = null; render(); });
  window.addEventListener("fuelguard:work-pattern-updated", render);
  window.addEventListener("fuelguard:cloud-status", render);
  window.addEventListener("fuelguard:auth-state", () => load());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  document.addEventListener("DOMContentLoaded", () => load());
  window.FuelGuardContextLayer = Object.freeze({ primaryContext, contextSnapshot, activeRecovery: active, exportRows: () => rows.map(row=>({...row})), load, refresh: render, _test: Object.freeze({ MAX_MS, recoverySummary }) });
})();
