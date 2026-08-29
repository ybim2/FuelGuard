(() => {
  "use strict";

  const ROUTINES_KEY = "fuel_guard_routines_v1";
  const OCCURRENCES_KEY = "fuel_guard_routine_occurrences_v1";
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let supplementPlans = [];
  let message = "";
  let busy = false;

  function cloud() { return window.fuelGuardCloud || null; }
  function userId() { return String(cloud()?.user?.id || ""); }
  function uuid() { return globalThis.crypto?.randomUUID?.() || `routine-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function read(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key) || "null"); return value ?? fallback; }
    catch { return fallback; }
  }
  function write(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function routines() { return read(ROUTINES_KEY, []).filter(item => item && item.id); }
  function saveRoutines(value) { write(ROUTINES_KEY, value); }
  function occurrences() { return read(OCCURRENCES_KEY, {}); }
  function saveOccurrences(value) { write(OCCURRENCES_KEY, value); }
  function dateKey(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function scheduledDate(routine, date = new Date()) {
    const result = new Date(date); const [hour, minute] = String(routine.time || "08:00").split(":").map(Number);
    result.setHours(Number.isFinite(hour) ? hour : 8, Number.isFinite(minute) ? minute : 0, 0, 0); return result;
  }
  function clock(date) { return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function escape(value) { return window.FuelGuardDomain?.escapeHtml?.(String(value ?? "")) || String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function occurrenceKey(routine, date = new Date()) { return `${dateKey(date)}:${routine.id}`; }
  function occurrenceFor(routine, date = new Date()) { return occurrences()[occurrenceKey(routine, date)] || null; }
  function dueToday(routine, now = new Date()) { return routine.enabled !== false && (routine.days || []).includes(now.getDay()); }
  function activeSupplements(routine) { return supplementPlans.filter(plan => (routine.supplementPlanIds || []).includes(plan.id)); }
  function itemLabels(routine) {
    const labels = [];
    if (routine.coffee) labels.push("Coffee");
    activeSupplements(routine).forEach(plan => labels.push(plan.label || plan.custom_name || "Supplement"));
    return labels;
  }
  function daysLabel(days = []) { return days.length === 7 ? "Daily" : days.map(day => DAY_NAMES[day]).join(", "); }

  async function loadSupplementPlans() {
    if (!cloud()?.client || !userId()) { supplementPlans = []; return; }
    const { data, error } = await cloud().client.from("fuel_supplement_plans").select("id,label,custom_name,supplement_type,active").eq("user_id", userId()).eq("active", true).order("created_at");
    if (!error) supplementPlans = data || [];
  }

  function ensureSurfaces() {
    const quick = document.querySelector(".beta-quick-actions-card");
    if (quick && !document.getElementById("fuelGuardRoutineToday")) {
      const card = document.createElement("section");
      card.id = "fuelGuardRoutineToday";
      card.className = "beta-rhythm-section-card fg-routine-card";
      card.setAttribute("aria-label", "Today's routines");
      quick.insertAdjacentElement("afterend", card);
    }
    const settings = document.getElementById("checklist");
    if (settings && !document.getElementById("fuelGuardRoutineSettings")) {
      const card = document.createElement("article");
      card.id = "fuelGuardRoutineSettings";
      card.className = "card fg-routine-settings";
      settings.appendChild(card);
    }
  }

  function renderToday() {
    const target = document.getElementById("fuelGuardRoutineToday"); if (!target) return;
    const now = new Date(); const due = routines().filter(routine => dueToday(routine, now));
    if (!due.length) { target.hidden = true; target.innerHTML = ""; return; }
    target.hidden = false;
    target.innerHTML = `<div class="section-heading-row"><div><h3>Today's routines</h3><p class="muted">Scheduled means expected. Nothing is logged until you confirm it.</p></div></div><div class="fg-routine-list">${due.map(routine => {
      const planned = scheduledDate(routine, now); const occurrence = occurrenceFor(routine, now); const labels = itemLabels(routine); const future = planned > now;
      const status = occurrence?.status === "confirmed" ? "Confirmed" : occurrence?.status === "skipped" ? "Skipped" : future ? "Expected" : "Waiting for confirmation";
      return `<article class="fg-routine-item"><header><div><h4>${escape(routine.name || "Routine")}</h4><div class="fg-routine-meta">${escape(clock(planned))} · ${escape(daysLabel(routine.days || []))}</div></div><span class="fg-routine-status">${escape(status)}</span></header><div class="fg-routine-items">${escape(labels.join(" · ") || "No items selected")}</div>${occurrence ? "" : `<div class="fg-routine-actions"><button class="primary" type="button" data-routine-confirm="${escape(routine.id)}" ${future || !labels.length || busy ? "disabled" : ""}>Done</button><button class="secondary" type="button" data-routine-skip="${escape(routine.id)}" ${future || busy ? "disabled" : ""}>Skip today</button></div>`}</article>`;
    }).join("")}</div><p class="fg-routine-message" role="status">${escape(message)}</p>`;
  }

  function renderSettings() {
    const target = document.getElementById("fuelGuardRoutineSettings"); if (!target) return;
    const current = routines();
    target.innerHTML = `<div class="section-heading-row"><div><h2>Routines</h2><p class="muted">Prepare recurring coffee and supplement moments without pretending they happened. Confirm once from Daily when they actually do.</p></div></div><form id="fuelGuardRoutineForm" class="fg-routine-settings-form"><label>Routine name<input name="name" type="text" maxlength="60" value="Morning routine" required></label><label>Time<input name="time" type="time" value="05:30" required></label><fieldset><legend>Days</legend><div class="fg-routine-days">${DAY_NAMES.map((name, index) => `<label><input type="checkbox" name="day" value="${index}" ${index >= 1 && index <= 5 ? "checked" : ""}>${name}</label>`).join("")}</div></fieldset><fieldset><legend>What should be ready to confirm?</legend><div class="fg-routine-supplements"><label><input type="checkbox" name="coffee" value="1">Coffee</label>${supplementPlans.map(plan => `<label><input type="checkbox" name="supplement" value="${escape(plan.id)}">${escape(plan.label || plan.custom_name || "Supplement")}</label>`).join("") || `<p class="fg-routine-note">No supplements selected in Supplementation yet. Add them there first, then return here.</p>`}</div></fieldset><button class="primary" type="submit" ${busy ? "disabled" : ""}>Add routine</button><p class="fg-routine-note">A scheduled routine is only an expectation. “Done” records the planned time; “Skip today” records nothing.</p></form><div class="fg-routine-existing">${current.length ? current.map(routine => `<article><header><div><strong>${escape(routine.name)}</strong><div class="fg-routine-meta">${escape(routine.time)} · ${escape(daysLabel(routine.days || []))}</div><div class="fg-routine-items">${escape(itemLabels(routine).join(" · "))}</div></div><button class="secondary" type="button" data-routine-delete="${escape(routine.id)}">Remove</button></header></article>`).join("") : `<p class="fg-routine-empty">No routines yet.</p>`}</div>`;
  }

  async function recordCoffee(routine, planned) {
    if (!cloud()?.client || !userId()) throw new Error("Sign in to confirm this routine.");
    const row = { id: uuid(), user_id: userId(), logged_at: planned.toISOString(), type: "fuel", source: "manual", notes: `fuel_guard_routine:coffee:${routine.id}` };
    const { error } = await cloud().client.from("fuel_logs").insert(row); if (error) throw error;
  }

  async function recordSupplements(routine, planned) {
    const plans = activeSupplements(routine); if (!plans.length) return;
    if (!cloud()?.client || !userId()) throw new Error("Sign in to confirm this routine.");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.(planned) || { primary: "everyday", capturedAt: new Date().toISOString() };
    const rows = plans.map(plan => ({ id: uuid(), user_id: userId(), supplement_plan_id: plan.id, schedule_slot_id: null, event_status: "taken", taken_at: planned.toISOString(), planned_for: planned.toISOString(), source: "manual", idempotency_key: `routine:${routine.id}:${plan.id}:${dateKey(planned)}`, event_local_date: dateKey(planned), timezone_name: timezone, context_mode: snapshot.primary || "everyday", context_snapshot: snapshot }));
    const { error } = await cloud().client.from("fuel_supplement_events").insert(rows); if (error) throw error;
    await window.FuelGuardSupplementRhythm?.load?.();
  }

  async function confirmRoutine(id) {
    const routine = routines().find(item => item.id === id); if (!routine || busy) return;
    const now = new Date(); const planned = scheduledDate(routine, now); if (planned > now) return;
    busy = true; message = "Confirming…"; renderToday();
    try {
      if (routine.coffee) await recordCoffee(routine, planned);
      await recordSupplements(routine, planned);
      const next = occurrences(); next[occurrenceKey(routine, now)] = { status: "confirmed", plannedAt: planned.toISOString(), confirmedAt: new Date().toISOString() }; saveOccurrences(next);
      message = `Confirmed for ${clock(planned)}.`;
      window.dispatchEvent(new CustomEvent("fuelguard:routines-changed", { detail: { routineId: id, status: "confirmed" } }));
    } catch (error) { message = `Could not confirm: ${error?.message || "try again"}`; }
    finally { busy = false; renderToday(); renderSettings(); }
  }

  function skipRoutine(id) {
    const routine = routines().find(item => item.id === id); if (!routine) return;
    const next = occurrences(); next[occurrenceKey(routine)] = { status: "skipped", skippedAt: new Date().toISOString() }; saveOccurrences(next); message = "Skipped today — nothing was logged."; renderToday();
  }

  function bind() {
    document.addEventListener("submit", event => {
      if (event.target.id !== "fuelGuardRoutineForm") return;
      event.preventDefault(); const form = new FormData(event.target); const days = form.getAll("day").map(Number).filter(Number.isInteger); const supplementPlanIds = form.getAll("supplement").map(String);
      if (!days.length || (!form.get("coffee") && !supplementPlanIds.length)) { message = "Choose at least one day and one item."; renderToday(); return; }
      const next = routines(); next.push({ id: uuid(), name: String(form.get("name") || "Routine").trim() || "Routine", time: String(form.get("time") || "08:00"), days, coffee: Boolean(form.get("coffee")), supplementPlanIds, enabled: true, createdAt: new Date().toISOString() }); saveRoutines(next); message = "Routine added."; renderSettings(); renderToday();
    });
    document.addEventListener("click", event => {
      const confirm = event.target.closest("[data-routine-confirm]"); if (confirm) { confirmRoutine(confirm.dataset.routineConfirm); return; }
      const skip = event.target.closest("[data-routine-skip]"); if (skip) { skipRoutine(skip.dataset.routineSkip); return; }
      const remove = event.target.closest("[data-routine-delete]"); if (remove) { saveRoutines(routines().filter(item => item.id !== remove.dataset.routineDelete)); message = "Routine removed."; renderSettings(); renderToday(); }
    });
  }

  async function init() { ensureSurfaces(); await loadSupplementPlans(); ensureSurfaces(); renderSettings(); renderToday(); }
  bind();
  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("fuelguard:auth-state", init);
  window.addEventListener("fuelguard:supplement-events-changed", async () => { await loadSupplementPlans(); renderSettings(); renderToday(); });
  window.addEventListener("focus", renderToday);
  window.FuelGuardRoutines = Object.freeze({ init, render: () => { ensureSurfaces(); renderSettings(); renderToday(); } });
})();
