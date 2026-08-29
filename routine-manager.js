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
    const result = new Date(date);
    const [hour, minute] = String(routine.time || "08:00").split(":").map(Number);
    result.setHours(Number.isFinite(hour) ? hour : 8, Number.isFinite(minute) ? minute : 0, 0, 0);
    return result;
  }
  function clock(date) { return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function escape(value) { return window.FuelGuardDomain?.escapeHtml?.(String(value ?? "")) || String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
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

  // Keep short gaps precise, but switch to human-scale days once a full day has passed.
  // app-state.js exposes duration() globally and its fuel-gap view model resolves it at render time.
  function formatElapsedDuration(minutes) {
    if (!Number.isFinite(minutes)) return "No limit";
    const safeMinutes = Math.max(0, Math.round(minutes));
    if (safeMinutes >= 1440) {
      const days = Math.floor(safeMinutes / 1440);
      return `${days} day${days === 1 ? "" : "s"}`;
    }
    return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}m`;
  }
  globalThis.duration = formatElapsedDuration;

  async function loadSupplementPlans() {
    if (!cloud()?.client || !userId()) { supplementPlans = []; return; }
    const { data, error } = await cloud().client
      .from("fuel_supplement_plans")
      .select("id,label,custom_name,supplement_type,active")
      .eq("user_id", userId())
      .eq("active", true)
      .order("created_at");
    if (!error) supplementPlans = data || [];
  }

  function ensureSurfaces() {
    const quick = document.querySelector(".beta-quick-actions-card");
    if (quick && !document.getElementById("fuelGuardRoutineToday")) {
      const card = document.createElement("section");
      card.id = "fuelGuardRoutineToday";
      card.className = "beta-rhythm-section-card fg-routine-card";
      card.setAttribute("aria-label", "Routines");
      quick.insertAdjacentElement("afterend", card);
    }

    const settings = document.getElementById("checklist");
    if (settings && !document.getElementById("fuelGuardRoutineSettings")) {
      const card = document.createElement("article");
      card.id = "fuelGuardRoutineSettings";
      card.className = "card fg-routine-settings";
      settings.appendChild(card);
    }

    if (!document.getElementById("fuelGuardRoutineSheet")) {
      document.body.insertAdjacentHTML("beforeend", `
        <section id="fuelGuardRoutineSheet" class="fg-routine-sheet" data-private-ui data-managed-visibility hidden inert aria-modal="true" role="dialog" aria-labelledby="fuelGuardRoutineSheetTitle">
          <button type="button" class="fg-routine-sheet-backdrop" data-routine-close aria-label="Close routine setup"></button>
          <article class="fg-routine-sheet-panel">
            <div class="fg-routine-sheet-handle" aria-hidden="true"></div>
            <header class="fg-routine-sheet-header">
              <div>
                <span class="fg-routine-eyebrow">Routines</span>
                <h2 id="fuelGuardRoutineSheetTitle">Make repeat moments one tap</h2>
                <p>Set the time once. Fuel Guard waits for you to confirm what actually happened.</p>
              </div>
              <button class="secondary fg-routine-close" type="button" data-routine-close aria-label="Close routine setup">×</button>
            </header>
            <div id="fuelGuardRoutineSheetBody"></div>
          </article>
        </section>`);
    }
  }

  function routineFormMarkup({ includeExisting = true } = {}) {
    const current = routines();
    return `
      <form id="fuelGuardRoutineForm" class="fg-routine-settings-form">
        <div class="fg-routine-form-grid">
          <label>Routine name<input name="name" type="text" maxlength="60" value="Morning routine" autocomplete="off" required></label>
          <label>Time<input name="time" type="time" value="05:30" required></label>
        </div>
        <fieldset>
          <legend>Days</legend>
          <div class="fg-routine-days">${DAY_NAMES.map((name, index) => `<label><input type="checkbox" name="day" value="${index}" ${index >= 1 && index <= 5 ? "checked" : ""}><span>${name}</span></label>`).join("")}</div>
        </fieldset>
        <fieldset>
          <legend>Ready to confirm</legend>
          <div class="fg-routine-supplements">
            <label class="fg-routine-choice"><input type="checkbox" name="coffee" value="1"><span><strong>Coffee</strong><small>Track it as part of the routine without counting it as a Fuel event.</small></span></label>
            ${supplementPlans.map(plan => `<label class="fg-routine-choice"><input type="checkbox" name="supplement" value="${escape(plan.id)}"><span><strong>${escape(plan.label || plan.custom_name || "Supplement")}</strong><small>Confirmed into Supplementation at the scheduled time.</small></span></label>`).join("") || `<div class="fg-routine-supplement-empty"><p>No supplements are selected yet.</p><button class="secondary" type="button" data-open-supplement-settings>Set up supplements</button></div>`}
          </div>
        </fieldset>
        <button class="primary fg-routine-save" type="submit" ${busy ? "disabled" : ""}>Add routine</button>
        <p class="fg-routine-note">Scheduling never records consumption. After the time passes, use <strong>Done</strong> or <strong>Skip today</strong>.</p>
      </form>
      ${includeExisting ? `<div class="fg-routine-existing">${current.length ? `<h3>Your routines</h3>${current.map(routine => `<article><div><strong>${escape(routine.name)}</strong><div class="fg-routine-meta">${escape(routine.time)} · ${escape(daysLabel(routine.days || []))}</div><div class="fg-routine-items">${escape(itemLabels(routine).join(" · "))}</div></div><button class="secondary" type="button" data-routine-delete="${escape(routine.id)}">Remove</button></article>`).join("")}` : ""}</div>` : ""}`;
  }

  function renderSheet() {
    const target = document.getElementById("fuelGuardRoutineSheetBody");
    if (target) target.innerHTML = routineFormMarkup({ includeExisting: true });
  }

  function openSheet() {
    ensureSurfaces();
    renderSheet();
    const sheet = document.getElementById("fuelGuardRoutineSheet");
    if (!sheet) return;
    sheet.hidden = false;
    sheet.removeAttribute("inert");
    document.body.classList.add("fg-routine-sheet-open");
    setTimeout(() => sheet.querySelector('input[name="name"]')?.focus(), 0);
  }

  function closeSheet() {
    const sheet = document.getElementById("fuelGuardRoutineSheet");
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute("inert", "");
    document.body.classList.remove("fg-routine-sheet-open");
  }

  function renderToday() {
    const target = document.getElementById("fuelGuardRoutineToday");
    if (!target) return;
    const now = new Date();
    const current = routines();

    if (!current.length) {
      target.hidden = false;
      target.innerHTML = `
        <div class="fg-routine-onboarding">
          <div class="fg-routine-onboarding-copy">
            <span class="fg-routine-eyebrow">Optional · Routines</span>
            <h3>Make the repetitive stuff one tap.</h3>
            <p>Leaving with coffee every weekday? Creatine at the same time? Set it once — Fuel Guard will ask you to confirm rather than making you log it from scratch.</p>
          </div>
          <button class="primary fg-routine-start" type="button" data-routine-open>Set up a routine</button>
        </div>`;
      return;
    }

    const due = current.filter(routine => dueToday(routine, now));
    target.hidden = false;
    target.innerHTML = `
      <div class="fg-routine-title-row">
        <div><span class="fg-routine-eyebrow">Routines</span><h3>Today</h3><p class="muted">Expected until you confirm it.</p></div>
        <button class="secondary fg-routine-manage" type="button" data-routine-open>Manage</button>
      </div>
      ${due.length ? `<div class="fg-routine-list">${due.map(routine => {
        const planned = scheduledDate(routine, now);
        const occurrence = occurrenceFor(routine, now);
        const labels = itemLabels(routine);
        const future = planned > now;
        const status = occurrence?.status === "confirmed" ? "Confirmed" : occurrence?.status === "skipped" ? "Skipped" : future ? "Expected" : "Confirm now";
        const statusClass = occurrence?.status || (future ? "expected" : "due");
        return `<article class="fg-routine-item ${escape(statusClass)}">
          <header><div><h4>${escape(routine.name || "Routine")}</h4><div class="fg-routine-meta">${escape(clock(planned))}</div></div><span class="fg-routine-status">${escape(status)}</span></header>
          <div class="fg-routine-items">${escape(labels.join(" · ") || "No items selected")}</div>
          ${occurrence ? `<p class="fg-routine-result">${occurrence.status === "confirmed" ? `Recorded for ${escape(clock(planned))}` : "Nothing recorded today"}</p>` : `<div class="fg-routine-actions"><button class="primary" type="button" data-routine-confirm="${escape(routine.id)}" ${future || !labels.length || busy ? "disabled" : ""}>Done</button><button class="secondary" type="button" data-routine-skip="${escape(routine.id)}" ${future || busy ? "disabled" : ""}>Skip today</button></div>`}
        </article>`;
      }).join("")}</div>` : `<div class="fg-routine-offday"><strong>No routines scheduled today.</strong><span>Your routines will appear here on the days you chose.</span></div>`}
      <p class="fg-routine-message" role="status" aria-live="polite">${escape(message)}</p>`;
  }

  function renderSettings() {
    const target = document.getElementById("fuelGuardRoutineSettings");
    if (!target) return;
    const current = routines();
    target.innerHTML = `
      <div class="fg-routine-settings-summary">
        <div><span class="fg-routine-eyebrow">Routines</span><h2>Recurring moments</h2><p class="muted">${current.length ? `${current.length} routine${current.length === 1 ? "" : "s"} set up. Manage them here or directly from Daily.` : "Set up recurring coffee or supplementation without auto-logging anything."}</p></div>
        <button class="primary" type="button" data-routine-open>${current.length ? "Manage routines" : "Set up a routine"}</button>
      </div>`;
  }

  async function recordSupplements(routine, planned) {
    const plans = activeSupplements(routine);
    if (!plans.length) return;
    if (!cloud()?.client || !userId()) throw new Error("Sign in to confirm this routine.");
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.(planned) || { primary: "everyday", capturedAt: new Date().toISOString() };
    const rows = plans.map(plan => ({
      id: uuid(),
      user_id: userId(),
      supplement_plan_id: plan.id,
      schedule_slot_id: null,
      event_status: "taken",
      taken_at: planned.toISOString(),
      planned_for: planned.toISOString(),
      source: "manual",
      idempotency_key: `routine:${routine.id}:${plan.id}:${dateKey(planned)}`,
      event_local_date: dateKey(planned),
      timezone_name: timezone,
      context_mode: snapshot.primary || "everyday",
      context_snapshot: snapshot
    }));
    const { error } = await cloud().client.from("fuel_supplement_events").insert(rows);
    if (error) throw error;
    await window.FuelGuardSupplementRhythm?.load?.();
  }

  async function confirmRoutine(id) {
    const routine = routines().find(item => item.id === id);
    if (!routine || busy) return;
    const now = new Date();
    const planned = scheduledDate(routine, now);
    if (planned > now) return;
    busy = true;
    message = "Confirming…";
    renderToday();
    try {
      await recordSupplements(routine, planned);
      const next = occurrences();
      next[occurrenceKey(routine, now)] = {
        status: "confirmed",
        plannedAt: planned.toISOString(),
        confirmedAt: new Date().toISOString(),
        coffee: Boolean(routine.coffee),
        supplementPlanIds: (routine.supplementPlanIds || []).slice()
      };
      saveOccurrences(next);
      message = `Confirmed for ${clock(planned)}.`;
      window.dispatchEvent(new CustomEvent("fuelguard:routines-changed", { detail: { routineId: id, status: "confirmed" } }));
    } catch (error) {
      message = `Could not confirm: ${error?.message || "try again"}`;
    } finally {
      busy = false;
      renderToday();
      renderSettings();
      renderSheet();
    }
  }

  function skipRoutine(id) {
    const routine = routines().find(item => item.id === id);
    if (!routine) return;
    const next = occurrences();
    next[occurrenceKey(routine)] = { status: "skipped", skippedAt: new Date().toISOString() };
    saveOccurrences(next);
    message = "Skipped today — nothing was logged.";
    renderToday();
  }

  function addRoutine(formElement) {
    const form = new FormData(formElement);
    const days = form.getAll("day").map(Number).filter(Number.isInteger);
    const supplementPlanIds = form.getAll("supplement").map(String);
    if (!days.length || (!form.get("coffee") && !supplementPlanIds.length)) {
      message = "Choose at least one day and one item.";
      const status = formElement.querySelector(".fg-routine-note");
      if (status) status.textContent = message;
      return;
    }
    const next = routines();
    next.push({
      id: uuid(),
      name: String(form.get("name") || "Routine").trim() || "Routine",
      time: String(form.get("time") || "08:00"),
      days,
      coffee: Boolean(form.get("coffee")),
      supplementPlanIds,
      enabled: true,
      createdAt: new Date().toISOString()
    });
    saveRoutines(next);
    message = "Routine added.";
    renderToday();
    renderSettings();
    renderSheet();
  }

  function bind() {
    document.addEventListener("submit", event => {
      if (event.target.id !== "fuelGuardRoutineForm") return;
      event.preventDefault();
      addRoutine(event.target);
    });

    document.addEventListener("click", event => {
      const open = event.target.closest("[data-routine-open]");
      if (open) { openSheet(); return; }
      const close = event.target.closest("[data-routine-close]");
      if (close) { closeSheet(); return; }
      const confirm = event.target.closest("[data-routine-confirm]");
      if (confirm) { confirmRoutine(confirm.dataset.routineConfirm); return; }
      const skip = event.target.closest("[data-routine-skip]");
      if (skip) { skipRoutine(skip.dataset.routineSkip); return; }
      const remove = event.target.closest("[data-routine-delete]");
      if (remove) {
        saveRoutines(routines().filter(item => item.id !== remove.dataset.routineDelete));
        message = "Routine removed.";
        renderSettings();
        renderToday();
        renderSheet();
        return;
      }
      if (event.target.closest("[data-open-supplement-settings]")) closeSheet();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !document.getElementById("fuelGuardRoutineSheet")?.hidden) closeSheet();
    });
  }

  async function init() {
    ensureSurfaces();
    await loadSupplementPlans();
    ensureSurfaces();
    renderSettings();
    renderToday();
    renderSheet();
  }

  bind();
  document.addEventListener("DOMContentLoaded", init);
  window.addEventListener("fuelguard:auth-state", init);
  window.addEventListener("fuelguard:supplement-events-changed", async () => {
    await loadSupplementPlans();
    renderSettings();
    renderToday();
    renderSheet();
  });
  window.addEventListener("focus", renderToday);
  window.FuelGuardRoutines = Object.freeze({ init, open: openSheet, render: () => { ensureSurfaces(); renderSettings(); renderToday(); renderSheet(); } });
})();
