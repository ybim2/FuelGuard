(() => {
  "use strict";
  if (window.FuelGuardRoutinesV2) { window.FuelGuardRoutinesV2.init?.(); return; }

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
  const itemLabels = routine => [...(routine.coffee ? ["Coffee"] : []), ...activePlans(routine).map(planLabel)];
  const daysLabel = days => days?.length === 7 ? "Daily" : (days || []).map(i => DAYS[i]).join(", ");

  async function loadPlans() {
    if (!cloud()?.client || !userId()) { plans = []; return; }
    const { data, error } = await cloud().client.from("fuel_supplement_plans")
      .select("id,label,custom_name,supplement_type,active")
      .eq("user_id", userId()).eq("active", true).order("created_at");
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
        plan = data;
        plans.push(plan);
      }
      selected.push(plan);
    }
    return selected;
  }

  function ensureSurfaces() {
    const quickActions = document.querySelector(".beta-quick-actions-card");
    if (quickActions && !document.getElementById("fuelGuardRoutineToday")) {
      const card = document.createElement("section");
      card.id = "fuelGuardRoutineToday";
      card.className = "beta-rhythm-section-card fg-routine-card";
      card.setAttribute("aria-label", "Routines");
      quickActions.insertAdjacentElement("beforebegin", card);
    }
    const settings = document.getElementById("checklist");
    if (settings && !document.getElementById("fuelGuardRoutineSettings")) {
      const card = document.createElement("article");
      card.id = "fuelGuardRoutineSettings";
      card.className = "card fg-routine-settings";
      settings.appendChild(card);
    }
    if (!document.getElementById("fuelGuardRoutineSheet")) {
      document.body.insertAdjacentHTML("beforeend", `<section id="fuelGuardRoutineSheet" class="fg-routine-sheet" data-private-ui data-managed-visibility hidden inert aria-modal="true" role="dialog"><button class="fg-routine-sheet-backdrop" type="button" data-routine-close aria-label="Close"></button><article class="fg-routine-sheet-panel"><div class="fg-routine-sheet-handle"></div><header class="fg-routine-sheet-header"><div><span class="fg-routine-eyebrow">Routines first</span><h2>Set up what repeats</h2><p>Choose coffee or supplements here. You do not need to visit Settings first.</p></div><button class="secondary fg-routine-close" type="button" data-routine-close aria-label="Close">×</button></header><div id="fuelGuardRoutineSheetBody"></div></article></section>`);
    }
  }

  function formMarkup() {
    const selected = new Set(plans.map(catalogueKey).filter(Boolean));
    const existing = routines();
    return `<form id="fuelGuardRoutineForm" class="fg-routine-settings-form">
      <div class="fg-routine-step"><span>1</span><div><strong>When does it happen?</strong><small>Name the routine, choose its time and repeat days.</small></div></div>
      <div class="fg-routine-form-grid"><label>Routine name<input name="name" type="text" value="Morning routine" maxlength="60" required></label><label>Time<input name="time" type="time" value="05:30" required></label></div>
      <fieldset><legend>Repeat days</legend><div class="fg-routine-days">${DAYS.map((d,i) => `<label><input type="checkbox" name="day" value="${i}" ${i > 0 && i < 6 ? "checked" : ""}><span>${d}</span></label>`).join("")}</div></fieldset>
      <div class="fg-routine-step"><span>2</span><div><strong>What happens in this routine?</strong><small>Select supplements directly here.</small></div></div>
      <fieldset><legend>Items to confirm</legend><div class="fg-routine-supplements"><label class="fg-routine-choice"><input type="checkbox" name="coffee"><span><strong>Coffee</strong><small>Routine confirmation only — not counted as Fuel.</small></span></label>${CATALOGUE.map(item => `<label class="fg-routine-choice"><input type="checkbox" name="supplementKey" value="${esc(item[0])}"><span><strong>${esc(item[1])}</strong><small>${selected.has(item[0]) ? "Already available in Fuel Guard · " : ""}Select to include.</small></span></label>`).join("")}</div></fieldset>
      <div class="fg-routine-step"><span>3</span><div><strong>Save once, confirm later</strong><small>The schedule creates an expectation, not a fake log.</small></div></div>
      <button class="primary fg-routine-save" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save routine"}</button>
      <p class="fg-routine-note">After the scheduled time: Yes, done confirms it; No, skipped records nothing. Missed questions stay available for 7 days.</p>
    </form>${existing.length ? `<div class="fg-routine-existing"><h3>Saved routines</h3>${existing.map(r => `<article><div><strong>${esc(r.name)}</strong><div class="fg-routine-saved-grid"><div class="fg-routine-saved-cell"><span>Time</span><strong>${esc(r.time)}</strong></div><div class="fg-routine-saved-cell"><span>Days</span><strong>${esc(daysLabel(r.days))}</strong></div><div class="fg-routine-saved-cell"><span>Confirms</span><strong>${esc(itemLabels(r).join(" · ") || "Nothing")}</strong></div></div></div><button class="secondary" type="button" data-routine-delete="${esc(r.id)}">Remove</button></article>`).join("")}</div>` : ""}`;
  }

  function renderSheet() { const body = document.getElementById("fuelGuardRoutineSheetBody"); if (body) body.innerHTML = formMarkup(); }
  function openSheet() { ensureSurfaces(); renderSheet(); const sheet = document.getElementById("fuelGuardRoutineSheet"); if (!sheet) return; sheet.hidden = false; sheet.removeAttribute("inert"); document.body.classList.add("fg-routine-sheet-open"); }
  function closeSheet() { const sheet = document.getElementById("fuelGuardRoutineSheet"); if (!sheet) return; sheet.hidden = true; sheet.setAttribute("inert", ""); document.body.classList.remove("fg-routine-sheet-open"); }

  function missed(now = new Date()) {
    const out = [];
    const all = occurrences();
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
    const status = occurrence?.status === "confirmed" ? "Confirmed" : occurrence?.status === "skipped" ? "Skipped" : isMissed ? "Missed · answer now" : future ? "Expected" : "Confirm now";
    return `<article class="fg-routine-item ${occurrence?.status || (isMissed ? "missed" : future ? "expected" : "due")}"><header><div><h4>${esc(routine.name)}</h4><div class="fg-routine-meta">${isMissed ? `${esc(dayText(planned))} · ` : ""}${esc(timeText(planned))}</div></div><span class="fg-routine-status">${esc(status)}</span></header><div class="fg-routine-items">${esc(itemLabels(routine).join(" · ") || "No items")}</div>${occurrence ? `<p class="fg-routine-result">${occurrence.status === "confirmed" ? `Recorded for ${esc(timeText(planned))}` : "Nothing recorded"}</p>` : `<div class="fg-routine-actions"><button class="primary" data-routine-confirm="${esc(routine.id)}" data-routine-date="${esc(planned.toISOString())}" ${future || busy ? "disabled" : ""}>Yes, done</button><button class="secondary" data-routine-skip="${esc(routine.id)}" data-routine-date="${esc(planned.toISOString())}" ${future || busy ? "disabled" : ""}>No, skipped</button></div>`}</article>`;
  }

  function renderToday() {
    const target = document.getElementById("fuelGuardRoutineToday");
    if (!target) return;
    const now = new Date();
    const saved = routines();
    target.hidden = false;
    if (!saved.length) {
      target.innerHTML = `<div class="fg-routine-onboarding"><div><span class="fg-routine-eyebrow">Start here · Routines</span><h3>Set up the things you repeat.</h3><p>Coffee every morning? Creatine and multivitamin on weekdays? Build that first, then use manual logging below for anything extra.</p></div><button class="primary fg-routine-start" data-routine-open>Set up my routine</button></div>`;
      return;
    }
    const due = saved.filter(r => dueOn(r, now));
    const missedItems = missed(now);
    const all = occurrences();
    target.innerHTML = `<div class="fg-routine-title-row"><div><span class="fg-routine-eyebrow">Start here · Routines</span><h3>Your routine</h3><p>Confirm the repeat stuff first. Manual logging is just below for anything extra.</p></div><button class="secondary" data-routine-open>Manage</button></div>${missedItems.length ? `<div class="fg-routine-missed-heading">Still needs an answer</div><div class="fg-routine-list">${missedItems.map(x => routineCard(x.routine, x.planned, null, true)).join("")}</div>` : ""}${due.length ? `<div class="fg-routine-list">${due.map(r => routineCard(r, plannedAt(r, now), all[occurrenceKey(r, now)])).join("")}</div>` : `<div class="fg-routine-offday"><strong>No routine due today.</strong><span>Use manual logging below if something happens outside your routine.</span></div>`}<p class="fg-routine-message">${esc(statusMessage)}</p>`;
  }

  function renderSettings() {
    const target = document.getElementById("fuelGuardRoutineSettings");
    if (target) target.innerHTML = `<div class="fg-routine-settings-summary"><div><span class="fg-routine-eyebrow">Routines</span><h2>Recurring moments</h2><p>Routines are managed from Daily first. Settings remains a secondary route.</p></div><button class="primary" data-routine-open>Manage routines</button></div>`;
  }

  async function recordSupplements(routine, planned) {
    const selected = activePlans(routine);
    if (!selected.length) return;
    if (!cloud()?.client || !userId()) throw new Error("Sign in to confirm supplement routines.");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.(planned) || { primary: "everyday", capturedAt: new Date().toISOString() };
    const rows = selected.map(plan => ({ id: makeId(), user_id: userId(), supplement_plan_id: plan.id, schedule_slot_id: null, event_status: "taken", taken_at: planned.toISOString(), planned_for: planned.toISOString(), source: "manual", idempotency_key: `routine:${routine.id}:${plan.id}:${dateKey(planned)}`, event_local_date: dateKey(planned), timezone_name: timezone, context_mode: snapshot.primary || "everyday", context_snapshot: snapshot }));
    const { error } = await cloud().client.from("fuel_supplement_events").insert(rows);
    if (error) throw error;
    await window.FuelGuardSupplementRhythm?.load?.();
  }

  async function confirmRoutine(routineId, iso) {
    const routine = routines().find(r => r.id === routineId);
    const planned = new Date(iso);
    if (!routine || busy || planned > new Date()) return;
    busy = true; renderToday();
    try {
      await recordSupplements(routine, planned);
      const all = occurrences();
      all[occurrenceKey(routine, planned)] = { status: "confirmed", plannedAt: planned.toISOString(), confirmedAt: new Date().toISOString(), coffee: !!routine.coffee, supplementPlanIds: [...(routine.supplementPlanIds || [])] };
      write(OCCURRENCES_KEY, all);
      statusMessage = `Confirmed for ${timeText(planned)}.`;
    } catch (error) { statusMessage = `Could not confirm: ${error?.message || "try again"}`; }
    finally { busy = false; renderToday(); }
  }

  function skipRoutine(routineId, iso) {
    const routine = routines().find(r => r.id === routineId);
    const planned = new Date(iso);
    if (!routine || planned > new Date()) return;
    const all = occurrences();
    all[occurrenceKey(routine, planned)] = { status: "skipped", plannedAt: planned.toISOString(), skippedAt: new Date().toISOString() };
    write(OCCURRENCES_KEY, all);
    statusMessage = "Skipped — nothing recorded.";
    renderToday();
  }

  async function submitRoutine(form) {
    if (busy) return;
    const data = new FormData(form);
    const days = data.getAll("day").map(Number).filter(Number.isInteger);
    const supplementKeys = data.getAll("supplementKey").map(String);
    if (!days.length) { statusMessage = "Choose at least one repeat day."; renderSheet(); return; }
    if (!data.get("coffee") && !supplementKeys.length) { statusMessage = "Choose coffee or at least one supplement."; renderSheet(); return; }
    busy = true; renderSheet();
    try {
      const selectedPlans = await ensurePlans(supplementKeys);
      const next = routines();
      next.push({ id: makeId(), name: String(data.get("name") || "Routine").trim() || "Routine", time: String(data.get("time") || "08:00"), days, coffee: data.get("coffee") === "on", supplementPlanIds: selectedPlans.map(p => p.id), enabled: true, createdAt: new Date().toISOString() });
      write(ROUTINES_KEY, next);
      statusMessage = "Routine saved.";
      closeSheet();
      renderToday();
      renderSettings();
    } catch (error) { statusMessage = `Could not save routine: ${error?.message || "try again"}`; renderSheet(); }
    finally { busy = false; }
  }

  function bindEvents() {
    if (document.documentElement.dataset.fgRoutineV2Bound === "1") return;
    document.documentElement.dataset.fgRoutineV2Bound = "1";
    document.addEventListener("click", event => {
      const open = event.target.closest("[data-routine-open]"); if (open) { openSheet(); return; }
      if (event.target.closest("[data-routine-close]")) { closeSheet(); return; }
      const confirm = event.target.closest("[data-routine-confirm]"); if (confirm) { confirmRoutine(confirm.dataset.routineConfirm, confirm.dataset.routineDate); return; }
      const skip = event.target.closest("[data-routine-skip]"); if (skip) { skipRoutine(skip.dataset.routineSkip, skip.dataset.routineDate); return; }
      const remove = event.target.closest("[data-routine-delete]"); if (remove) { write(ROUTINES_KEY, routines().filter(r => r.id !== remove.dataset.routineDelete)); renderSheet(); renderToday(); return; }
    });
    document.addEventListener("submit", event => { if (event.target?.id === "fuelGuardRoutineForm") { event.preventDefault(); submitRoutine(event.target); } });
  }

  async function init() {
    ensureSurfaces();
    bindEvents();
    await loadPlans();
    ensureSurfaces();
    renderToday();
    renderSettings();
    initialised = true;
  }

  window.FuelGuardRoutinesV2 = { init, open: openSheet, render: renderToday, get initialised() { return initialised; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true }); else init();
})();
