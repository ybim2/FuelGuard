(() => {
  "use strict";

  const PLANS = "fuel_supplement_plans";
  const SLOTS = "fuel_supplement_schedule_slots";
  const EVENTS = "fuel_supplement_events";
  const INSIGHT_MIN_EVENTS = 6;
  const CATALOGUE = Object.freeze([
    ["creatine", "Creatine"],
    ["iron", "Iron"],
    ["vitamin_c", "Vitamin C"],
    ["vitamin_d", "Vitamin D"],
    ["vitamin_b12", "Vitamin B12"],
    ["multivitamin", "Multivitamin"],
    ["magnesium", "Magnesium"],
    ["calcium", "Calcium"],
    ["zinc", "Zinc"],
    ["electrolytes", "Electrolytes"],
    ["omega_3", "Omega-3"],
    ["protein_supplement", "Protein supplement"]
  ]);
  let owner = "";
  let plans = [];
  let slots = [];
  let events = [];
  let message = "";
  let busy = false;
  let pendingSlotId = "";

  function cloud() { return window.fuelGuardCloud; }
  function domain() { return window.FuelGuardDomain; }
  function escape(value) { return domain()?.escapeHtml?.(value) || String(value ?? ""); }
  function uuid() { return globalThis.crypto?.randomUUID?.() || `supplement-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function localDateKey(value = new Date()) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
  function timezoneName() { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  function dayStart(value = new Date()) { const date = new Date(value); date.setHours(0, 0, 0, 0); return date; }
  function dayEnd(value = new Date()) { const date = dayStart(value); date.setDate(date.getDate() + 1); return date; }
  function activePlans() { return plans.filter(plan => plan.active); }
  function planFor(id) { return plans.find(plan => plan.id === id); }
  function scheduleFor(planId) { return slots.filter(slot => slot.supplement_plan_id === planId && slot.active); }
  function todayEvents(now = new Date()) { const start = dayStart(now); const end = dayEnd(now); return events.filter(event => new Date(event.taken_at) >= start && new Date(event.taken_at) < end); }
  function patternEvent(event) {
    const date = new Date(event?.taken_at || "");
    const plan = planFor(event?.supplement_plan_id);
    return {
      id: event?.id || "",
      date,
      takenAt: date,
      supplementPlanId: event?.supplement_plan_id || "",
      supplementLabel: plan?.label || typeLabel(plan) || "Supplement"
    };
  }
  function eventsForDay(key = localDateKey()) {
    return events
      .filter(event => event.event_status === "taken" && (event.event_local_date || localDateKey(event.taken_at)) === key)
      .map(patternEvent)
      .filter(event => !Number.isNaN(event.date.getTime()))
      .sort((left, right) => left.date - right.date);
  }
  function emitEventsChanged() {
    window.dispatchEvent?.(new CustomEvent("fuelguard:supplement-events-changed", {
      detail: { dateKey: localDateKey(), count: eventsForDay().length }
    }));
  }
  function typeLabel(planOrType) {
    const type = typeof planOrType === "string" ? planOrType : planOrType?.supplement_type;
    if (type === "custom") return planOrType?.custom_name || planOrType?.label || "Custom supplement";
    return CATALOGUE.find(item => item[0] === type)?.[1] || planOrType?.label || "Supplement";
  }
  function slotIsToday(slot, now = new Date()) { return !slot || (slot.days_of_week || []).includes(now.getDay()); }
  function timeLabel(value) { const [hour, minute] = String(value || "08:00").split(":"); const date = new Date(); date.setHours(Number(hour), Number(minute), 0, 0); return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function dateTimeLocal(value = new Date()) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  function daysLabel(days = []) { return days.length === 7 ? "Daily" : days.map(day => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", "); }
  function parseDays(value) { const lookup = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 }; return [...new Set(String(value || "").split(",").map(item => lookup[item.trim().toLowerCase()]).filter(Number.isInteger))].sort(); }
  function plannedFor(slot, now = new Date()) { if (!slot?.local_time) return null; const [hour, minute] = slot.local_time.split(":").map(Number); const date = new Date(now); date.setHours(hour, minute, 0, 0); return date.toISOString(); }
  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
  function context(at) {
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.(at) || { primary: "everyday", capturedAt: new Date().toISOString() };
    return { context_mode: snapshot.primary || "everyday", context_snapshot: snapshot };
  }
  function ironWindowConflict(plan, at = new Date()) {
    if (plan?.supplement_type !== "iron" || !plan.track_caffeine_separation) return false;
    const before = Number(plan.caffeine_separation_before_minutes || 0) * 60000;
    const after = Number(plan.caffeine_separation_after_minutes || 0) * 60000;
    const logs = typeof fuelGapState === "function" ? fuelGapState()?.logs || [] : [];
    return logs.some(log => {
      const date = domain()?.logDate?.(log) || new Date(log.timestamp || log.logged_at || "");
      const difference = at - date;
      return Number(log.caffeineMg || log.caffeine_mg || 0) > 0 && difference >= -after && difference <= before;
    });
  }

  function historyMarkup(rows) {
    return `<div class="supplement-history-list">${rows.map(event => `<article><div><strong>${escape(planFor(event.supplement_plan_id)?.label || "Supplement")}</strong><small>${escape(new Date(event.taken_at).toLocaleString())} · ${event.event_status === "skipped" ? "Not taken" : "Recorded"}</small></div><button class="secondary" type="button" data-supplement-undo="${escape(event.id)}">Undo</button></article>`).join("")}</div>`;
  }
  function consistencyMarkup(plan) {
    const today = dayStart();
    const days = Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(today); date.setDate(date.getDate() - (6 - offset));
      const key = localDateKey(date);
      const done = events.some(event => event.supplement_plan_id === plan.id && event.event_status === "taken" && (event.event_local_date || localDateKey(event.taken_at)) === key);
      return `<span class="${done ? "logged" : ""}" title="${escape(date.toLocaleDateString())}">${date.toLocaleDateString([], { weekday: "narrow" })}</span>`;
    });
    return `<div class="supplement-consistency" aria-label="${escape(plan.label)} seven-day recorded history">${days.join("")}</div>`;
  }
  function insightMarkup() {
    const taken = events.filter(event => event.event_status === "taken");
    if (taken.length < INSIGHT_MIN_EVENTS) return `<p class="muted">Timing patterns appear after ${INSIGHT_MIN_EVENTS} recorded supplement moments. Fuel Guard describes what was recorded, not effectiveness.</p>`;
    const recent = taken.filter(event => new Date(event.taken_at) >= new Date(Date.now() - 7 * 86400000));
    return `<div class="supplement-insight"><strong>Last 7 days</strong><p>${recent.length} recorded moment${recent.length === 1 ? "" : "s"}. This is a timing record, not health or performance advice.</p></div>`;
  }
  function renderManagement() {
    const target = document.getElementById("athleteSupplementManagement");
    if (!target) return;
    const selectedTypes = new Set(plans.filter(plan => plan.supplement_type !== "custom").map(plan => plan.supplement_type));
    target.innerHTML = `<div class="section-heading-row"><div><h2>Supplementation</h2><p class="muted">Choose supplements that are already part of your routine, then record when you take them. This is private timing support, not a recommendation or medical advice.</p></div></div><form id="supplementCatalogueForm" class="supplement-catalogue-form"><fieldset><legend>Your supplements</legend><div class="supplement-catalogue">${CATALOGUE.map(([type, label]) => `<label><input type="checkbox" name="supplementCatalogue" value="${type}" ${selectedTypes.has(type) ? "checked disabled" : ""}><span>${label}</span></label>`).join("")}</div></fieldset><label>Another supplement (optional)<input id="supplementCustomName" maxlength="80" placeholder="Add a name"></label><button class="primary" type="submit" ${busy ? "disabled" : ""}>Add selected supplements</button></form><div class="supplement-plan-list">${plans.length ? plans.map(plan => {
      const planSlots = scheduleFor(plan.id);
      return `<article><div><span>${plan.active ? "Selected" : "Paused"}</span><strong>${escape(plan.label)}</strong><small>${planSlots.length ? planSlots.map(slot => `${timeLabel(slot.local_time)} · ${daysLabel(slot.days_of_week)}`).join(" · ") : "No schedule set"}${planSlots.some(slot => slot.reminder_enabled) ? " · reminder on" : ""}</small>${consistencyMarkup(plan)}</div>${planSlots.length ? `<div class="supplement-slot-actions">${planSlots.map(slot => `<button class="secondary" type="button" data-supplement-edit-slot="${escape(slot.id)}">Edit ${escape(timeLabel(slot.local_time))}</button><button class="secondary" type="button" data-supplement-remove-slot="${escape(slot.id)}">Remove time</button>`).join("")}</div>` : ""}<div class="button-row"><button class="secondary" type="button" data-supplement-add-slot="${escape(plan.id)}">Add time</button>${planSlots.length ? `<button class="secondary" type="button" data-supplement-toggle-reminder="${escape(plan.id)}">${planSlots.some(slot => slot.reminder_enabled) ? "Reminders off" : "Reminders on"}</button>` : ""}<button class="secondary" type="button" data-supplement-toggle="${escape(plan.id)}">${plan.active ? "Pause" : "Resume"}</button><button class="secondary danger-secondary" type="button" data-supplement-delete-plan="${escape(plan.id)}">Delete</button></div></article>`;
    }).join("") : `<p class="muted">No supplements selected yet.</p>`}</div><section class="supplement-history"><h3>Private history</h3>${events.length ? historyMarkup(events.slice(0, 30)) : `<p class="muted">Nothing recorded yet.</p>`}</section>${insightMarkup()}<details class="supplement-data-actions"><summary>Supplement data and privacy</summary><p>Only you can access these records through the Athlete app. They are excluded from Coach access, organisations, points and sharing.</p><div class="button-row"><button class="secondary" type="button" data-supplement-export>Export JSON</button><button class="secondary danger-secondary" type="button" data-supplement-delete-all>Delete supplement data</button></div></details>${message ? `<p class="row-note" role="status">${escape(message)}</p>` : ""}`;
  }
  function render() { renderManagement(); window.FuelGuardContextLayer?.refresh?.(); window.FuelGuardAthleteRetention?.render?.(); }

  async function load() {
    const userId = String(cloud()?.user?.id || "");
    if (!userId || !cloud()?.client) { owner = ""; plans = []; slots = []; events = []; render(); emitEventsChanged(); return; }
    if (owner && owner !== userId) { plans = []; slots = []; events = []; }
    owner = userId;
    const [planResult, slotResult, eventResult] = await Promise.all([
      cloud().client.from(PLANS).select("*").eq("user_id", userId).order("created_at"),
      cloud().client.from(SLOTS).select("*").eq("user_id", userId).order("local_time"),
      cloud().client.from(EVENTS).select("*").eq("user_id", userId).order("taken_at", { ascending: false }).limit(200)
    ]);
    const error = planResult.error || slotResult.error || eventResult.error;
    if (error) { message = /does not exist|schema cache/i.test(error.message || "") ? "Supplementation is waiting for its release migration." : "Supplementation could not sync."; render(); return; }
    if (String(cloud()?.user?.id || "") !== userId) return;
    plans = planResult.data || [];
    slots = slotResult.data || [];
    events = eventResult.data || [];
    message = "";
    render();
    emitEventsChanged();
  }
  async function addSelected() {
    const types = [...document.querySelectorAll('input[name="supplementCatalogue"]:checked:not(:disabled)')].map(input => input.value);
    const custom = String(document.getElementById("supplementCustomName")?.value || "").trim();
    if (!types.length && !custom) throw new Error("Select at least one supplement or add a name.");
    const rows = types.map(type => ({ id: uuid(), user_id: owner, supplement_type: type, custom_name: null, label: typeLabel(type), active: true, track_caffeine_separation: false }))
      .concat(custom ? [{ id: uuid(), user_id: owner, supplement_type: "custom", custom_name: custom, label: custom, active: true, track_caffeine_separation: false }] : []);
    const { data, error } = await cloud().client.from(PLANS).insert(rows).select();
    if (error) throw error;
    plans.push(...(data || []));
    message = `${rows.length} supplement${rows.length === 1 ? "" : "s"} added.`;
  }
  function showQuickLogSheet() {
    const sheet = document.getElementById("supplementQuickLogSheet");
    if (!sheet) return;
    sheet.hidden = false;
    sheet.removeAttribute("inert");
    document.body.classList.add("supplement-sheet-open");
  }
  function setQuickLogControlsVisible(visible) {
    const time = document.querySelector(".supplement-quick-time");
    const confirm = document.getElementById("supplementQuickConfirm");
    if (time) time.hidden = !visible;
    if (confirm) confirm.hidden = !visible;
  }
  async function openQuickLog(planId = "", slotId = "") {
    if (owner !== String(cloud()?.user?.id || "")) await load();
    const available = activePlans();
    if (!available.length) {
      pendingSlotId = "";
      document.getElementById("supplementQuickChoices").innerHTML = `<div class="supplement-quick-empty"><strong>No supplements configured yet</strong><p>Add the supplements you already use in Settings, then this Daily action will record when you take them.</p><button class="secondary" type="button" data-open-supplement-settings>Set up supplements</button></div>`;
      document.getElementById("supplementQuickLogTitle").textContent = "Record supplements";
      document.getElementById("supplementQuickLogContext").textContent = "Supplement Settings is for configuration; Daily is where you record each moment.";
      document.getElementById("supplementQuickStatus").textContent = "";
      setQuickLogControlsVisible(false);
      showQuickLogSheet();
      return;
    }
    if (!planId && !slotId && available.length === 1) {
      await recordNow(available[0]);
      return;
    }
    pendingSlotId = slotId;
    document.getElementById("supplementQuickChoices").innerHTML = available.map(plan => `<label class="supplement-check"><input type="checkbox" data-supplement-quick-plan value="${escape(plan.id)}" ${plan.id === planId ? "checked" : ""}><span>${escape(plan.label)}</span></label>`).join("");
    document.getElementById("supplementQuickLogTitle").textContent = planId ? `Record ${planFor(planId)?.label || "supplement"}` : "Record supplements";
    document.getElementById("supplementQuickLogContext").textContent = "Select everything you took at this time. No amounts are requested.";
    document.getElementById("supplementQuickTakenAt").value = dateTimeLocal();
    document.getElementById("supplementQuickStatus").textContent = "";
    setQuickLogControlsVisible(true);
    showQuickLogSheet();
  }
  function closeQuickLog() {
    const sheet = document.getElementById("supplementQuickLogSheet");
    sheet.hidden = true;
    sheet.setAttribute("inert", "");
    document.body.classList.remove("supplement-sheet-open");
    pendingSlotId = "";
  }
  async function persistEvents(planIds, takenAt, slotId = "") {
    const requestOwner = String(owner || "");
    if (!requestOwner || requestOwner !== String(cloud()?.user?.id || "")) throw new Error("Your account changed. Try the supplement log again.");
    const selectedPlans = planIds.map(planFor).filter(Boolean);
    if (!selectedPlans.length) throw new Error("Select at least one supplement.");
    if (Number.isNaN(takenAt.getTime()) || takenAt > new Date(Date.now() + 5 * 60000)) throw new Error("Choose a valid time that is not in the future.");
    if (selectedPlans.some(plan => ironWindowConflict(plan, takenAt)) && !window.confirm("This time overlaps the personal caffeine timing window you set. Record it anyway?")) return 0;
    const atIso = takenAt.toISOString();
    const snapshot = context(takenAt);
    const rows = selectedPlans.map(plan => ({
      id: uuid(),
      user_id: requestOwner,
      supplement_plan_id: plan.id,
      schedule_slot_id: planIds.length === 1 && slotId ? slotId : null,
      event_status: "taken",
      taken_at: atIso,
      planned_for: planIds.length === 1 && slotId ? plannedFor(slots.find(slot => slot.id === slotId), takenAt) : null,
      source: "manual",
      idempotency_key: `manual:${plan.id}:${atIso}`,
      event_local_date: localDateKey(takenAt),
      timezone_name: timezoneName(),
      ...snapshot
    }));
    const { data, error } = await cloud().client.from(EVENTS).insert(rows).select();
    if (error) throw error;
    if (requestOwner !== String(cloud()?.user?.id || "")) {
      await load();
      throw new Error("Your account changed before the supplement log completed.");
    }
    events.unshift(...(data || []));
    message = `${rows.length} supplement${rows.length === 1 ? "" : "s"} recorded.`;
    emitEventsChanged();
    return rows.length;
  }
  async function recordNow(plan) {
    if (busy || !plan) return;
    const button = document.getElementById("graphLogSupplementButton");
    const status = document.getElementById("foodLogCooldownMessage");
    busy = true;
    button?.setAttribute("aria-busy", "true");
    if (button) button.disabled = true;
    if (status) status.textContent = `Recording ${plan.label}…`;
    try {
      const count = await persistEvents([plan.id], new Date());
      if (!count) { if (status) status.textContent = "Recording cancelled."; return; }
      render();
      if (status) status.textContent = `${plan.label} recorded just now.`;
      window.FuelGuardLoggingFeedback?.celebrate?.({ type: "supplement", message });
    } catch (error) {
      message = `Could not record: ${error.message}`;
      if (status) status.textContent = message;
      render();
    } finally {
      busy = false;
      button?.removeAttribute("aria-busy");
      if (button) button.disabled = false;
    }
  }
  async function recordSelected() {
    if (busy) return;
    const planIds = [...document.querySelectorAll("[data-supplement-quick-plan]:checked")].map(input => input.value);
    const takenAt = new Date(document.getElementById("supplementQuickTakenAt")?.value || Date.now());
    const status = document.getElementById("supplementQuickStatus");
    busy = true;
    status.textContent = "Recording…";
    try {
      const count = await persistEvents(planIds, takenAt, pendingSlotId);
      if (!count) { status.textContent = "Recording cancelled."; return; }
    } catch (error) {
      status.textContent = `Could not record: ${error.message}`;
      return;
    } finally {
      busy = false;
    }
    closeQuickLog();
    render();
    window.FuelGuardLoggingFeedback?.celebrate?.({ type: "supplement", message: message });
  }
  async function undo(eventId) {
    if (!owner || !isUuid(eventId)) return;
    const { error } = await cloud().client.from(EVENTS).delete().eq("id", eventId).eq("user_id", owner);
    if (error) { message = `Could not undo: ${error.message}`; render(); return; }
    events = events.filter(event => event.id !== eventId);
    message = "Supplement record removed.";
    emitEventsChanged();
    render();
  }
  async function addSlot(planId) {
    const time = window.prompt("Usual time (24-hour HH:MM)", "08:00");
    if (time === null) return;
    const daysInput = window.prompt("Days (for example Mon,Tue,Wed,Thu,Fri or Sun,Mon,Tue,Wed,Thu,Fri,Sat)", "Sun,Mon,Tue,Wed,Thu,Fri,Sat");
    if (daysInput === null) return;
    const days = parseDays(daysInput);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !days.length) { message = "Use a valid 24-hour time and at least one day."; render(); return; }
    const { data, error } = await cloud().client.from(SLOTS).insert({ id: uuid(), user_id: owner, supplement_plan_id: planId, local_time: time, days_of_week: days, active: true, reminder_enabled: false }).select().single();
    if (error) { message = error.message; render(); return; }
    slots.push(data);
    message = "Supplement timing added.";
    render();
  }
  async function editSlot(slotId) {
    const slot = slots.find(item => item.id === slotId);
    if (!slot) return;
    const time = window.prompt("Usual time (24-hour HH:MM)", String(slot.local_time || "08:00").slice(0, 5));
    if (time === null) return;
    const daysInput = window.prompt("Days", daysLabel(slot.days_of_week));
    if (daysInput === null) return;
    const days = parseDays(daysInput);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !days.length) { message = "Use a valid 24-hour time and at least one day."; render(); return; }
    const { data, error } = await cloud().client.from(SLOTS).update({ local_time: time, days_of_week: days }).eq("id", slotId).eq("user_id", owner).select().single();
    if (!error && data) slots = slots.map(item => item.id === slotId ? data : item);
    message = error ? error.message : "Supplement timing updated.";
    render();
  }
  async function deleteAll() {
    if (!window.confirm("Delete all of your private supplement records, schedules and selections?")) return;
    const eventResult = await cloud().client.from(EVENTS).delete().eq("user_id", owner);
    if (eventResult.error) { message = eventResult.error.message; render(); return; }
    const slotResult = await cloud().client.from(SLOTS).delete().eq("user_id", owner);
    if (slotResult.error) { message = slotResult.error.message; render(); return; }
    const planResult = await cloud().client.from(PLANS).delete().eq("user_id", owner);
    if (planResult.error) { message = planResult.error.message; render(); return; }
    plans = []; slots = []; events = []; message = "Supplement data deleted."; emitEventsChanged(); render();
  }
  function exportData() {
    const payload = JSON.stringify({ exportedAt: new Date().toISOString(), plans, scheduleSlots: slots, events }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `fuel-guard-supplementation-${localDateKey()}.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  function reminderPrompt(now = new Date()) {
    const today = todayEvents(now);
    return activePlans().flatMap(plan => scheduleFor(plan.id).map(slot => ({ plan, slot })))
      .find(({ plan, slot }) => slot.reminder_enabled && slotIsToday(slot, now) && new Date(plannedFor(slot, now)) <= now && !today.some(event => event.supplement_plan_id === plan.id && event.schedule_slot_id === slot.id)) || null;
  }
  function recoveryActionSummary() {
    const due = activePlans().flatMap(plan => scheduleFor(plan.id).filter(slot => slotIsToday(slot)).map(slot => ({ plan, slot })));
    const today = todayEvents();
    return { planned: due.length, taken: due.filter(({ plan, slot }) => today.some(event => event.event_status === "taken" && event.supplement_plan_id === plan.id && event.schedule_slot_id === slot.id)).length, dueLabel: reminderPrompt()?.plan?.label || "" };
  }

  document.addEventListener("submit", async event => {
    if (event.target.id !== "supplementCatalogueForm") return;
    event.preventDefault();
    if (busy) return;
    busy = true; message = ""; render();
    try { await addSelected(); } catch (error) { message = error.message || "Supplements could not be added."; }
    busy = false; render();
  });
  document.addEventListener("click", async event => {
    if (event.target.closest("#graphLogSupplementButton")) { await openQuickLog(); return; }
    if (event.target.closest("[data-open-supplement-settings]")) { closeQuickLog(); document.querySelector('[data-open-screen="checklist"]')?.click(); window.FuelGuardSettingsNavigation?.showCategory?.("supplements"); return; }
    const log = event.target.closest("[data-supplement-log]"); if (log) { openQuickLog(log.dataset.supplementLog, log.dataset.supplementSlot || ""); return; }
    if (event.target.closest("[data-supplement-cancel]")) { closeQuickLog(); return; }
    if (event.target.closest("#supplementQuickConfirm")) { recordSelected(); return; }
    const undoButton = event.target.closest("[data-supplement-undo]"); if (undoButton) { undo(undoButton.dataset.supplementUndo); return; }
    const add = event.target.closest("[data-supplement-add-slot]"); if (add) { addSlot(add.dataset.supplementAddSlot); return; }
    const edit = event.target.closest("[data-supplement-edit-slot]"); if (edit) { editSlot(edit.dataset.supplementEditSlot); return; }
    const remove = event.target.closest("[data-supplement-remove-slot]"); if (remove) { const result = await cloud().client.from(SLOTS).delete().eq("id", remove.dataset.supplementRemoveSlot).eq("user_id", owner); if (!result.error) slots = slots.filter(slot => slot.id !== remove.dataset.supplementRemoveSlot); message = result.error?.message || "Supplement timing removed."; render(); return; }
    const reminder = event.target.closest("[data-supplement-toggle-reminder]"); if (reminder) { const planSlots = scheduleFor(reminder.dataset.supplementToggleReminder); const enabled = !planSlots.some(slot => slot.reminder_enabled); const result = await cloud().client.from(SLOTS).update({ reminder_enabled: enabled }).eq("supplement_plan_id", reminder.dataset.supplementToggleReminder).eq("user_id", owner).select(); if (!result.error) slots = slots.map(slot => slot.supplement_plan_id === reminder.dataset.supplementToggleReminder ? { ...slot, reminder_enabled: enabled } : slot); message = result.error?.message || `Reminders ${enabled ? "enabled" : "disabled"}.`; render(); return; }
    const toggle = event.target.closest("[data-supplement-toggle]"); if (toggle) { const plan = planFor(toggle.dataset.supplementToggle); const result = await cloud().client.from(PLANS).update({ active: !plan.active }).eq("id", plan.id).eq("user_id", owner).select().single(); if (!result.error && result.data) plans = plans.map(item => item.id === plan.id ? result.data : item); message = result.error?.message || `${plan.label} ${plan.active ? "paused" : "resumed"}.`; render(); return; }
    const removePlan = event.target.closest("[data-supplement-delete-plan]"); if (removePlan && window.confirm("Delete this supplement selection and its private history?")) { const planId = removePlan.dataset.supplementDeletePlan; const eventResult = await cloud().client.from(EVENTS).delete().eq("supplement_plan_id", planId).eq("user_id", owner); const result = eventResult.error ? eventResult : await cloud().client.from(PLANS).delete().eq("id", planId).eq("user_id", owner); if (!result.error) { plans = plans.filter(plan => plan.id !== planId); slots = slots.filter(slot => slot.supplement_plan_id !== planId); events = events.filter(item => item.supplement_plan_id !== planId); emitEventsChanged(); } message = result.error?.message || "Supplement selection deleted."; render(); return; }
    if (event.target.closest("[data-supplement-export]")) exportData();
    if (event.target.closest("[data-supplement-delete-all]")) deleteAll();
  });
  window.addEventListener("fuelguard:auth-state", load);
  window.addEventListener("fuelguard:private-app-ready", load);
  window.addEventListener("fuelguard:cloud-status", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  document.addEventListener("DOMContentLoaded", load);

  window.FuelGuardSupplementRhythm = Object.freeze({
    load,
    render,
    openQuickLog,
    eventsForDay,
    reminderPrompt,
    recoveryActionSummary,
    _test: Object.freeze({ INSIGHT_MIN_EVENTS, catalogue: CATALOGUE, ironWindowConflict, localDateKey, slotIsToday, typeLabel, plannedFor, isUuid, parseDays, patternEvent })
  });
})();
