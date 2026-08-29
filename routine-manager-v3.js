(() => {
  "use strict";
  if (window.FuelGuardRoutinesV3) { window.FuelGuardRoutinesV3.init?.(); return; }

  const ROUTINES_KEY = "fuel_guard_routines_v1";
  const OCCURRENCES_KEY = "fuel_guard_routine_occurrences_v1";
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const LOOKBACK_DAYS = 7;
  const CATALOGUE = [
    ["creatine","Creatine"],["protein_supplement","Protein powder"],["iron","Iron"],["vitamin_d","Vitamin D"],
    ["vitamin_c","Vitamin C"],["vitamin_b12","Vitamin B12"],["multivitamin","Multivitamin"],["magnesium","Magnesium"],
    ["zinc","Zinc"],["calcium","Calcium"],["omega_3","Omega-3 / Fish oil"],["electrolytes","Electrolytes"],
    ["caffeine","Caffeine","custom"],["collagen","Collagen","custom"],["folic_acid","Folic acid","custom"],
    ["probiotics","Probiotics","custom"],["beta_alanine","Beta-alanine","custom"],["nitrate_beetroot","Nitrate / Beetroot","custom"],
    ["carbohydrate_supplement","Carbohydrate supplement","custom"],["recovery_drink","Recovery drink","custom"]
  ];

  let plans = [];
  let busy = false;
  let statusMessage = "";
  let initialised = false;

  const cloud = () => window.fuelGuardCloud || null;
  const userId = () => String(cloud()?.user?.id || "");
  const makeId = () => globalThis.crypto?.randomUUID?.() || `routine-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const esc = value => window.FuelGuardDomain?.escapeHtml?.(String(value ?? "")) || String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const routines = () => read(ROUTINES_KEY, []).filter(r => r?.id);
  const occurrences = () => read(OCCURRENCES_KEY, {});
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const occurrenceKey = (routine, date) => `${dateKey(date)}:${routine.id}`;
  const plannedAt = (routine, date = new Date()) => { const d = new Date(date); const [h,m] = String(routine.time || "08:00").split(":").map(Number); d.setHours(h || 0, m || 0, 0, 0); return d; };
  const dueOn = (routine, date) => routine.enabled !== false && (routine.days || []).includes(date.getDay());
  const timeText = date => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayText = date => date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
  const planLabel = plan => plan?.label || plan?.custom_name || "Supplement";
  const catalogueKey = plan => plan?.supplement_type !== "custom" ? plan?.supplement_type : (CATALOGUE.find(item => item[2] === "custom" && item[1].toLowerCase() === String(plan?.custom_name || plan?.label || "").toLowerCase())?.[0] || "");
  const activePlans = routine => plans.filter(plan => (routine.supplementPlanIds || []).includes(plan.id));
  const daysLabel = days => days?.length === 7 ? "Daily" : (days || []).map(i => DAYS[i]).join(", ");
  const modeLabel = routine => routine.scope === "training" ? "Training Mode" : "Daily Mode";
  const gapState = () => typeof window.fuelGapState === "function" ? window.fuelGapState() : null;
  const trainingActive = () => Boolean(gapState()?.trainingMode?.activeSession);

  function itemLabels(routine) {
    const labels = [];
    if (routine.meal) labels.push(routine.mealLabel || "Meal / fuel");
    if (routine.hydration) labels.push("Hydration");
    if (routine.coffee) labels.push("Coffee");
    const supplementLabels = activePlans(routine).map(planLabel);
    if (supplementLabels.length) labels.push(...supplementLabels);
    else if (Array.isArray(routine.supplementLabels)) labels.push(...routine.supplementLabels);
    return [...new Set(labels)];
  }

  async function loadPlans() {
    if (!cloud()?.client || !userId()) { plans = []; return; }
    const { data, error } = await cloud().client.from("fuel_supplement_plans")
      .select("id,label,custom_name,supplement_type,active").eq("user_id", userId()).eq("active", true).order("created_at");
    if (!error) plans = data || [];
  }

  async function ensurePlans(keys) {
    if (!keys.length) return [];
    if (!cloud()?.client || !userId()) throw new Error("Sign in to save supplement routines.");
    const selected = [];
    for (const key of keys) {
      let plan = plans.find(p => catalogueKey(p) === key);
      if (!plan) {
        const item = CATALOGUE.find(c => c[0] === key);
        if (!item) continue;
        const type = item[2] || item[0];
        const row = { id: makeId(), user_id: userId(), supplement_type: type, custom_name: type === "custom" ? item[1] : null, label: item[1], active: true, track_caffeine_separation: false };
        const { data, error } = await cloud().client.from("fuel_supplement_plans").insert(row).select().single();
        if (error) throw error;
        plan = data; plans.push(plan);
      }
      selected.push(plan);
    }
    return selected;
  }

  function ensureSurfaces() {
    const todayStatus = document.getElementById("fuelTodayStatus");
    const quickActions = document.querySelector(".beta-quick-actions-card");
    if (!document.getElementById("fuelGuardRoutineToday") && (todayStatus || quickActions)) {
      const card = document.createElement("section");
      card.id = "fuelGuardRoutineToday";
      card.className = "beta-rhythm-section-card fg-routine-card";
      card.setAttribute("aria-label", "Routines");
      if (todayStatus) todayStatus.insertAdjacentElement("afterend", card);
      else quickActions.insertAdjacentElement("beforebegin", card);
    } else if (todayStatus && document.getElementById("fuelGuardRoutineToday")?.previousElementSibling !== todayStatus) {
      todayStatus.insertAdjacentElement("afterend", document.getElementById("fuelGuardRoutineToday"));
    }
    const settings = document.getElementById("checklist");
    if (settings && !document.getElementById("fuelGuardRoutineSettings")) {
      const card = document.createElement("article"); card.id = "fuelGuardRoutineSettings"; card.className = "card fg-routine-settings"; settings.appendChild(card);
    }
    if (!document.getElementById("fuelGuardRoutineSheet")) {
      document.body.insertAdjacentHTML("beforeend", `<section id="fuelGuardRoutineSheet" class="fg-routine-sheet" data-private-ui data-managed-visibility hidden inert aria-modal="true" role="dialog"><button class="fg-routine-sheet-backdrop" type="button" data-routine-close aria-label="Close"></button><article class="fg-routine-sheet-panel"><div class="fg-routine-sheet-handle"></div><header class="fg-routine-sheet-header"><div><span class="fg-routine-eyebrow">Routines first</span><h2>Plan what repeats</h2><p>Set the expected time once. Fuel Guard only records it after you confirm.</p></div><button class="secondary fg-routine-close" type="button" data-routine-close aria-label="Close">×</button></header><div id="fuelGuardRoutineSheetBody"></div></article></section>`);
    }
  }

  function formMarkup() {
    const existing = routines();
    const available = new Set(plans.map(catalogueKey).filter(Boolean));
    return `<form id="fuelGuardRoutineForm" class="fg-routine-settings-form">
      <div class="fg-routine-step"><span>1</span><div><strong>When?</strong><small>Name the routine, choose its time and repeat days.</small></div></div>
      <div class="fg-routine-form-grid"><label>Routine name<input name="name" type="text" value="Morning routine" maxlength="60" required></label><label>Time<input name="time" type="time" value="05:30" required></label></div>
      <fieldset><legend>Repeat days</legend><div class="fg-routine-days">${DAYS.map((d,i) => `<label><input type="checkbox" name="day" value="${i}" ${i > 0 && i < 6 ? "checked" : ""}><span>${d}</span></label>`).join("")}</div></fieldset>
      <fieldset><legend>Where should it apply?</legend><div class="fg-routine-mode"><label><input type="radio" name="scope" value="daily" checked><span>Daily Mode</span></label><label><input type="radio" name="scope" value="training"><span>Training Mode</span></label></div></fieldset>
      <div class="fg-routine-step"><span>2</span><div><strong>What should be expected?</strong><small>Meal and hydration can now be planned alongside coffee and supplements.</small></div></div>
      <fieldset><legend>Fuel + hydration</legend><div class="fg-routine-kind-grid">
        <label class="fg-routine-choice"><input type="checkbox" name="meal"><span><strong>Meal / fuel</strong><small>Creates a planned fuel moment; confirms only when you say it happened.</small></span></label>
        <label class="fg-routine-choice"><input type="checkbox" name="hydration"><span><strong>Hydration</strong><small>Creates a planned hydration moment; confirms only when you say it happened.</small></span></label>
        <label class="fg-routine-choice"><input type="checkbox" name="coffee"><span><strong>Coffee</strong><small>Routine confirmation only; not disguised as a fuel event.</small></span></label>
      </div></fieldset>
      <fieldset><legend>Supplements</legend><div class="fg-routine-supplements">${CATALOGUE.map(item => `<label class="fg-routine-choice"><input type="checkbox" name="supplementKey" value="${esc(item[0])}"><span><strong>${esc(item[1])}</strong><small>${available.has(item[0]) ? "Already available in Fuel Guard · " : ""}Select to include.</small></span></label>`).join("")}</div></fieldset>
      <div class="fg-routine-step"><span>3</span><div><strong>Save once, confirm later</strong><small>Planned moments appear in Today’s Patterns immediately. They are not counted as consumed until confirmed.</small></div></div>
      <button class="primary fg-routine-save" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save routine"}</button>
      <p class="fg-routine-note">Training routines only become confirmable while Training Mode is active. Missed questions stay available for 7 days.</p>
    </form>${existing.length ? `<div class="fg-routine-existing"><h3>Saved routines</h3>${existing.map(r => `<article><div><strong>${esc(r.name)}</strong><div class="fg-routine-saved-grid"><div class="fg-routine-saved-cell"><span>Time</span><strong>${esc(r.time)}</strong></div><div class="fg-routine-saved-cell"><span>Mode</span><strong>${esc(modeLabel(r))}</strong></div><div class="fg-routine-saved-cell"><span>Days</span><strong>${esc(daysLabel(r.days))}</strong></div></div><div class="fg-routine-items-scroll"><div class="fg-routine-items">${itemLabels(r).map(x => `<span class="fg-routine-plan-tag">${esc(x)}</span>`).join("") || "Nothing"}</div></div></div><button class="secondary" type="button" data-routine-delete="${esc(r.id)}">Remove</button></article>`).join("")}</div>` : ""}`;
  }

  function renderSheet() { const body = document.getElementById("fuelGuardRoutineSheetBody"); if (body) body.innerHTML = formMarkup(); }
  function openSheet() { ensureSurfaces(); renderSheet(); const sheet = document.getElementById("fuelGuardRoutineSheet"); if (!sheet) return; sheet.hidden = false; sheet.removeAttribute("inert"); document.body.classList.add("fg-routine-sheet-open"); }
  function closeSheet() { const sheet = document.getElementById("fuelGuardRoutineSheet"); if (!sheet) return; sheet.hidden = true; sheet.setAttribute("inert", ""); document.body.classList.remove("fg-routine-sheet-open"); }

  function missed(now = new Date()) {
    const out = []; const all = occurrences();
    for (let n = 1; n <= LOOKBACK_DAYS; n++) {
      const date = new Date(now); date.setDate(date.getDate() - n);
      for (const routine of routines()) {
        const planned = plannedAt(routine, date);
        if (dueOn(routine, date) && planned < now && !all[occurrenceKey(routine, date)]) out.push({ routine, planned });
      }
    }
    return out.sort((a,b) => b.planned - a.planned);
  }

  function routineCard(routine, planned, occurrence, isMissed = false) {
    const future = planned > new Date();
    const trainingBlocked = routine.scope === "training" && !trainingActive();
    const status = occurrence?.status === "confirmed" ? "Confirmed" : occurrence?.status === "skipped" ? "Skipped" : trainingBlocked ? "Start Training Mode" : isMissed ? "Missed · answer now" : future ? "Expected" : "Confirm now";
    return `<article class="fg-routine-item ${occurrence?.status || (isMissed ? "missed" : future ? "expected" : "due")}"><header><div><h4>${esc(routine.name)}</h4><div class="fg-routine-meta">${isMissed ? `${esc(dayText(planned))} · ` : ""}${esc(timeText(planned))} · ${esc(modeLabel(routine))}</div></div><span class="fg-routine-status">${esc(status)}</span></header><div class="fg-routine-items-scroll"><div class="fg-routine-items">${itemLabels(routine).map(x => `<span class="fg-routine-plan-tag">${esc(x)}</span>`).join("") || "No items"}</div></div>${occurrence ? `<p class="fg-routine-result">${occurrence.status === "confirmed" ? `Recorded for ${esc(timeText(planned))}` : "Nothing recorded"}</p>` : `<div class="fg-routine-actions"><button class="primary" data-routine-confirm="${esc(routine.id)}" data-routine-date="${esc(planned.toISOString())}" ${future || busy || trainingBlocked ? "disabled" : ""}>Yes, done</button><button class="secondary" data-routine-skip="${esc(routine.id)}" data-routine-date="${esc(planned.toISOString())}" ${future || busy ? "disabled" : ""}>No, skipped</button></div>`}</article>`;
  }

  function renderToday() {
    ensureSurfaces();
    const target = document.getElementById("fuelGuardRoutineToday"); if (!target) return;
    const now = new Date(); const saved = routines(); target.hidden = false;
    if (!saved.length) {
      target.innerHTML = `<div class="fg-routine-onboarding"><div><span class="fg-routine-eyebrow">Routines</span><h3>Plan the things that repeat.</h3><p>Meals, hydration, coffee and supplements can live here. Manual logging stays below for everything else.</p></div><button class="primary fg-routine-start" data-routine-open>Set up my routine</button></div>`;
      return;
    }
    const due = saved.filter(r => dueOn(r, now)); const missedItems = missed(now); const all = occurrences();
    target.innerHTML = `<div class="fg-routine-title-row"><div><span class="fg-routine-eyebrow">Routines</span><h3>Today’s plan</h3><p>Planned first; manual logging below.</p></div><button class="secondary" data-routine-open>Manage</button></div>${missedItems.length ? `<div class="fg-routine-missed-heading">Still needs an answer</div><div class="fg-routine-list">${missedItems.map(x => routineCard(x.routine, x.planned, null, true)).join("")}</div>` : ""}${due.length ? `<div class="fg-routine-list">${due.map(r => routineCard(r, plannedAt(r, now), all[occurrenceKey(r, now)])).join("")}</div>` : `<div class="fg-routine-offday"><strong>No routine due today.</strong><span>Use manual logging below if something happens outside your routine.</span></div>`}<p class="fg-routine-message">${esc(statusMessage)}</p>`;
  }

  function renderSettings() {
    const target = document.getElementById("fuelGuardRoutineSettings");
    if (target) target.innerHTML = `<div class="fg-routine-settings-summary"><div><span class="fg-routine-eyebrow">Routines</span><h2>Recurring moments</h2><p>Daily is the primary place to manage routines.</p></div><button class="primary" data-routine-open>Manage routines</button></div>`;
  }

  async function recordSupplements(routine, planned) {
    const selected = activePlans(routine); if (!selected.length) return;
    if (!cloud()?.client || !userId()) throw new Error("Sign in to confirm supplement routines.");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.(planned) || { primary: routine.scope === "training" ? "training" : "everyday", capturedAt: new Date().toISOString() };
    const rows = selected.map(plan => ({ id: makeId(), user_id: userId(), supplement_plan_id: plan.id, schedule_slot_id: null, event_status: "taken", taken_at: planned.toISOString(), planned_for: planned.toISOString(), source: "routine", idempotency_key: `routine:${routine.id}:${plan.id}:${dateKey(planned)}`, event_local_date: dateKey(planned), timezone_name: timezone, context_mode: snapshot.primary || "everyday", context_snapshot: snapshot }));
    const { error } = await cloud().client.from("fuel_supplement_events").insert(rows); if (error) throw error;
    await window.FuelGuardSupplementRhythm?.load?.();
  }

  function recordFuelHydration(routine, planned) {
    if (!routine.meal && !routine.hydration) return;
    const gap = gapState(); if (!gap) throw new Error("Fuel Guard could not access Daily logs.");
    gap.logs = Array.isArray(gap.logs) ? gap.logs : [];
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.(planned) || {};
    const sessionId = snapshot.trainingSessionId || gap.trainingMode?.activeSession?.id || "";
    const base = { id: makeId(), timestamp: planned.toISOString(), logged_at: planned.toISOString(), source: "routine", dayType: "", trainingModeSessionId: routine.scope === "training" ? sessionId : "", notes: `fuel_guard_routine:${routine.id}` };
    if (routine.meal) gap.logs.push({ ...base, id: makeId(), type: "fuel", logType: "fuel", label: routine.mealLabel || "Planned meal" });
    if (routine.hydration) gap.logs.push({ ...base, id: makeId(), type: "hydration", logType: "hydration", label: "Planned hydration" });
    if (typeof window.save === "function") window.save();
    if (typeof window.renderAll === "function") window.renderAll();
    else if (typeof window.renderFuelGap === "function") window.renderFuelGap();
  }

  async function confirm(routineId, iso) {
    const routine = routines().find(r => r.id === routineId); const planned = new Date(iso);
    if (!routine || busy || planned > new Date()) return;
    if (routine.scope === "training" && !trainingActive()) { statusMessage = "Start Training Mode before confirming this routine."; renderToday(); return; }
    busy = true; renderToday();
    try {
      recordFuelHydration(routine, planned); await recordSupplements(routine, planned);
      const all = occurrences(); all[occurrenceKey(routine, planned)] = { status: "confirmed", plannedAt: planned.toISOString(), confirmedAt: new Date().toISOString(), scope: routine.scope || "daily", meal: !!routine.meal, hydration: !!routine.hydration, coffee: !!routine.coffee, supplementPlanIds: [...(routine.supplementPlanIds || [])] }; write(OCCURRENCES_KEY, all);
      statusMessage = `Confirmed for ${timeText(planned)}.`;
      emitChanged();
    } catch (error) { statusMessage = `Could not confirm: ${error?.message || "try again"}`; }
    finally { busy = false; renderToday(); renderSheet(); }
  }

  function skip(routineId, iso) {
    const routine = routines().find(r => r.id === routineId); const planned = new Date(iso); if (!routine) return;
    const all = occurrences(); all[occurrenceKey(routine, planned)] = { status: "skipped", plannedAt: planned.toISOString(), answeredAt: new Date().toISOString() }; write(OCCURRENCES_KEY, all);
    statusMessage = "Skipped. Nothing recorded."; emitChanged(); renderToday();
  }

  function plannedItemsForDay(key = dateKey()) {
    const date = new Date(`${key}T12:00:00`); if (Number.isNaN(date.getTime())) return [];
    const all = occurrences(); const items = [];
    routines().filter(r => dueOn(r, date)).forEach(routine => {
      const planned = plannedAt(routine, date); const occurrence = all[occurrenceKey(routine, date)];
      const common = { routineId: routine.id, routineName: routine.name, scope: routine.scope || "daily", plannedAt: planned.toISOString(), date: planned, status: occurrence?.status || "planned" };
      if (routine.meal) items.push({ ...common, type: "fuel", label: routine.mealLabel || "Meal / fuel" });
      if (routine.hydration) items.push({ ...common, type: "hydration", label: "Hydration" });
      if (routine.coffee) items.push({ ...common, type: "coffee", label: "Coffee" });
      const active = activePlans(routine); const labels = active.length ? active.map(planLabel) : (routine.supplementLabels || []);
      labels.forEach(label => items.push({ ...common, type: "supplement", label }));
    });
    return items.sort((a,b) => a.date - b.date);
  }

  function emitChanged() {
    window.dispatchEvent(new CustomEvent("fuelguard:routines-changed", { detail: { dateKey: dateKey(), planned: plannedItemsForDay().length } }));
  }

  async function saveRoutine(form) {
    const data = new FormData(form); const days = data.getAll("day").map(Number).filter(Number.isInteger);
    const name = String(data.get("name") || "Routine").trim(); const time = String(data.get("time") || ""); const scope = data.get("scope") === "training" ? "training" : "daily";
    const keys = data.getAll("supplementKey").map(String);
    if (!name || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !days.length) throw new Error("Add a name, valid time and at least one day.");
    if (!data.get("meal") && !data.get("hydration") && !data.get("coffee") && !keys.length) throw new Error("Choose at least one item to plan.");
    busy = true; renderSheet();
    try {
      const selected = await ensurePlans(keys);
      const routine = { id: makeId(), name, time, days, scope, meal: Boolean(data.get("meal")), hydration: Boolean(data.get("hydration")), coffee: Boolean(data.get("coffee")), supplementPlanIds: selected.map(p => p.id), supplementLabels: selected.map(planLabel), enabled: true, createdAt: new Date().toISOString() };
      const next = [...routines(), routine]; write(ROUTINES_KEY, next); statusMessage = "Routine saved."; emitChanged();
    } finally { busy = false; renderToday(); renderSettings(); renderSheet(); }
  }

  function removeRoutine(id) { write(ROUTINES_KEY, routines().filter(r => r.id !== id)); statusMessage = "Routine removed."; emitChanged(); renderToday(); renderSheet(); }

  function bind() {
    document.addEventListener("click", event => {
      if (event.target.closest("[data-routine-open]")) { openSheet(); return; }
      if (event.target.closest("[data-routine-close]")) { closeSheet(); return; }
      const confirmButton = event.target.closest("[data-routine-confirm]"); if (confirmButton) { void confirm(confirmButton.dataset.routineConfirm, confirmButton.dataset.routineDate); return; }
      const skipButton = event.target.closest("[data-routine-skip]"); if (skipButton) { skip(skipButton.dataset.routineSkip, skipButton.dataset.routineDate); return; }
      const remove = event.target.closest("[data-routine-delete]"); if (remove) { removeRoutine(remove.dataset.routineDelete); return; }
    });
    document.addEventListener("submit", event => { if (event.target.id !== "fuelGuardRoutineForm") return; event.preventDefault(); void saveRoutine(event.target).catch(error => { statusMessage = error?.message || "Routine could not be saved."; busy = false; renderSheet(); renderToday(); }); });
    window.addEventListener("fuelguard:auth-state", () => void refresh());
    window.addEventListener("fuelguard:private-app-ready", () => void refresh());
    window.addEventListener("fuelguard:cloud-status", () => void refresh());
    window.addEventListener("fuelguard:training-mode-changed", renderToday);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  }

  async function refresh() { ensureSurfaces(); await loadPlans(); renderToday(); renderSettings(); emitChanged(); }
  function init() { if (!initialised) { initialised = true; bind(); } void refresh(); }

  window.FuelGuardRoutines = Object.freeze({ init, refresh, open: openSheet, plannedItemsForDay, routines });
  window.FuelGuardRoutinesV3 = window.FuelGuardRoutines;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
