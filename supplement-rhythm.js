(() => {
  "use strict";

  const PLANS = "fuel_supplement_plans";
  const SLOTS = "fuel_supplement_schedule_slots";
  const EVENTS = "fuel_supplement_events";
  const CATALOGUE = Object.freeze([
    { key: "creatine", label: "Creatine" },
    { key: "protein_supplement", label: "Protein powder" },
    { key: "iron", label: "Iron" },
    { key: "vitamin_d", label: "Vitamin D" },
    { key: "vitamin_c", label: "Vitamin C" },
    { key: "vitamin_b12", label: "Vitamin B12" },
    { key: "multivitamin", label: "Multivitamin" },
    { key: "magnesium", label: "Magnesium" },
    { key: "zinc", label: "Zinc" },
    { key: "calcium", label: "Calcium" },
    { key: "omega_3", label: "Omega-3 / Fish oil" },
    { key: "electrolytes", label: "Electrolytes" },
    { key: "caffeine", label: "Caffeine", dbType: "custom" },
    { key: "collagen", label: "Collagen", dbType: "custom" },
    { key: "folic_acid", label: "Folic acid", dbType: "custom" },
    { key: "probiotics", label: "Probiotics", dbType: "custom" },
    { key: "beta_alanine", label: "Beta-alanine", dbType: "custom" },
    { key: "nitrate_beetroot", label: "Nitrate / Beetroot", dbType: "custom" },
    { key: "carbohydrate_supplement", label: "Carbohydrate supplement", dbType: "custom" },
    { key: "recovery_drink", label: "Recovery drink", dbType: "custom" }
  ]);
  let owner = "";
  let plans = [];
  let slots = [];
  let events = [];
  let message = "";
  let busy = false;
  let pendingSlotId = "";
  let selectionDraft = null;
  let selectionDirty = false;

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
  function normalizedName(value) { return String(value || "").trim().toLowerCase(); }
  function catalogueEntry(key) { return CATALOGUE.find(item => item.key === key); }
  function catalogueKeyForPlan(plan) {
    if (!plan) return "";
    if (plan.supplement_type !== "custom") return catalogueEntry(plan.supplement_type)?.key || `plan:${plan.id}`;
    const name = normalizedName(plan.custom_name || plan.label);
    return CATALOGUE.find(item => item.dbType === "custom" && normalizedName(item.label) === name)?.key || `plan:${plan.id}`;
  }
  function persistedSelectionKeys() { return new Set(activePlans().map(catalogueKeyForPlan).filter(Boolean)); }
  function sameSelection(left, right) { return left.size === right.size && [...left].every(value => right.has(value)); }
  function syncSelectionDraft({ force = false } = {}) {
    if (force || !(selectionDraft instanceof Set)) selectionDraft = persistedSelectionKeys();
    selectionDirty = !sameSelection(selectionDraft, persistedSelectionKeys());
  }
  function selectionRows() {
    const curated = CATALOGUE.map(item => ({ key: item.key, label: item.label }));
    const legacy = plans
      .filter(plan => catalogueKeyForPlan(plan).startsWith("plan:"))
      .map(plan => ({ key: `plan:${plan.id}`, label: plan.label || typeLabel(plan) }));
    return [...curated, ...legacy];
  }
  function rowForCatalogueEntry(entry) {
    const dbType = entry.dbType || entry.key;
    return {
      id: uuid(),
      user_id: owner,
      supplement_type: dbType,
      custom_name: dbType === "custom" ? entry.label : null,
      label: entry.label,
      active: true,
      track_caffeine_separation: false
    };
  }
  function scheduleFor(planId) {
    return slots
      .filter(slot => slot.supplement_plan_id === planId && slot.active)
      .sort((left, right) => String(left.local_time || "").localeCompare(String(right.local_time || "")));
  }
  function todayEvents(now = new Date()) { const start = dayStart(now); const end = dayEnd(now); return events.filter(event => new Date(event.taken_at) >= start && new Date(event.taken_at) < end); }
  function patternEvent(event) {
    const date = new Date(event?.taken_at || "");
    const plan = planFor(event?.supplement_plan_id);
    return {
      id: event?.id || "",
      date,
      takenAt: date,
      takenAtIso: event?.taken_at || date.toISOString(),
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
  function timelineEventsForDay(key = localDateKey()) {
    const groups = new Map();
    eventsForDay(key).forEach(event => {
      const groupKey = event.takenAtIso || event.date.toISOString();
      const group = groups.get(groupKey) || {
        id: `supplements:${groupKey}`,
        date: event.date,
        timelineType: "supplement",
        supplementLabels: []
      };
      if (!group.supplementLabels.includes(event.supplementLabel)) group.supplementLabels.push(event.supplementLabel);
      groups.set(groupKey, group);
    });
    return [...groups.values()].sort((left, right) => left.date - right.date);
  }
  function analyticsEvents() {
    return events
      .filter(event => event.event_status === "taken")
      .map(event => ({
        id: event.id || "",
        timestamp: event.taken_at || "",
        label: planFor(event.supplement_plan_id)?.label || typeLabel(planFor(event.supplement_plan_id)) || "Supplement",
        planId: event.supplement_plan_id || "",
        trainingSessionId: event.context_snapshot?.trainingSessionId || ""
      }));
  }
  function emitEventsChanged() {
    window.dispatchEvent?.(new CustomEvent("fuelguard:supplement-events-changed", {
      detail: { dateKey: localDateKey(), count: eventsForDay().length }
    }));
  }
  function typeLabel(planOrType) {
    const type = typeof planOrType === "string" ? planOrType : planOrType?.supplement_type;
    if (type === "custom") return planOrType?.custom_name || planOrType?.label || "Custom supplement";
    return CATALOGUE.find(item => item.key === type)?.label || planOrType?.label || "Supplement";
  }
  function slotIsToday(slot, now = new Date()) { return !slot || (slot.days_of_week || []).includes(now.getDay()); }
  function timeLabel(value) { const [hour, minute] = String(value || "08:00").split(":"); const date = new Date(); date.setHours(Number(hour), Number(minute), 0, 0); return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function dateTimeLocal(value = new Date()) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
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

  function planScheduleMarkup(plan) {
    const planSlots = scheduleFor(plan.id);
    const label = typeLabel(plan);
    const remindersEnabled = planSlots.some(slot => slot.reminder_enabled);
    const timeControls = planSlots.map(slot => {
      const time = timeLabel(slot.local_time);
      const days = daysLabel(slot.days_of_week);
      return `<span class="supplement-time-chip"><button class="supplement-time-edit" type="button" data-supplement-edit-slot="${escape(slot.id)}" aria-label="Edit ${escape(label)} at ${escape(time)}, ${escape(days)}"><strong>${escape(time)}</strong><small>${escape(days)}</small></button><button class="supplement-time-remove" type="button" data-supplement-remove-slot="${escape(slot.id)}" aria-label="Remove ${escape(label)} at ${escape(time)}">×</button></span>`;
    }).join("");
    return `<article class="supplement-plan-card"><header><strong>${escape(label)}</strong></header><div class="supplement-schedule-config"><span class="supplement-config-label">Scheduled times</span><div class="supplement-time-list">${timeControls || `<span class="supplement-no-times">No times set</span>`}<button class="secondary supplement-add-time" type="button" data-supplement-add-slot="${escape(plan.id)}">+ Add time</button></div></div><div class="supplement-reminder-row"><span><strong>Reminder</strong><small>${planSlots.length ? "For every scheduled time" : "Add a time to enable reminders"}</small></span><button class="supplement-reminder-switch" type="button" role="switch" aria-checked="${remindersEnabled}" data-supplement-toggle-reminder="${escape(plan.id)}" ${planSlots.length ? "" : "disabled"}><span>${remindersEnabled ? "On" : "Off"}</span><i aria-hidden="true"></i></button></div></article>`;
  }
  function renderManagement() {
    const target = document.getElementById("athleteSupplementManagement");
    if (!target) return;
    syncSelectionDraft();
    const trackedPlans = activePlans();
    target.innerHTML = `<div class="section-heading-row"><div><h2>Supplementation</h2><p class="muted">Choose supplements that are already part of your routine, then record when you take them from Daily. This is private timing support, not a recommendation or medical advice.</p></div></div><form id="supplementCatalogueForm" class="supplement-catalogue-form" aria-busy="${busy ? "true" : "false"}"><fieldset><legend>Supplements available in Daily</legend><p class="muted">Select the supplements you want ready for quick logging.</p><div class="supplement-catalogue" role="group" aria-label="Supplement selection">${selectionRows().map(row => {
      const selected = selectionDraft.has(row.key);
      return `<label class="${selected ? "selected" : ""}" data-supplement-selection-row><input type="checkbox" name="supplementSelection" value="${escape(row.key)}" ${selected ? "checked" : ""} ${busy ? "disabled" : ""}><span>${escape(row.label)}</span></label>`;
    }).join("")}</div></fieldset><button id="supplementSelectionSave" class="primary" type="submit" ${!selectionDirty || busy || !owner ? "disabled" : ""}>${busy ? "Saving…" : "Save supplement selection"}</button><p id="supplementSelectionStatus" class="row-note" role="status">${escape(message || (selectionDirty ? "Unsaved changes" : ""))}</p></form><div class="supplement-plan-list">${trackedPlans.length ? trackedPlans.map(planScheduleMarkup).join("") : `<p class="muted">No supplements selected yet.</p>`}</div><details class="supplement-data-actions"><summary>Supplement data and privacy</summary><p>Only you can access these records through the Athlete app. They are excluded from Coach access, organisations, points and sharing.</p><div class="button-row"><button class="secondary" type="button" data-supplement-export>Export JSON</button><button class="secondary danger-secondary" type="button" data-supplement-delete-all>Delete supplement data</button></div></details>`;
  }
  function render() { renderManagement(); window.FuelGuardContextLayer?.refresh?.(); window.FuelGuardAthleteRetention?.render?.(); }

  async function load() {
    const userId = String(cloud()?.user?.id || "");
    if (!userId || !cloud()?.client) { owner = ""; plans = []; slots = []; events = []; selectionDraft = null; selectionDirty = false; setDailyLogStatus(""); render(); emitEventsChanged(); return; }
    const preserveDraft = owner === userId && selectionDirty;
    if (owner && owner !== userId) { plans = []; slots = []; events = []; selectionDraft = null; selectionDirty = false; setDailyLogStatus(""); }
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
    syncSelectionDraft({ force: !preserveDraft });
    render();
    emitEventsChanged();
  }
  async function reloadPlansPreservingDraft(userId) {
    const result = await cloud().client.from(PLANS).select("*").eq("user_id", userId).order("created_at");
    if (!result.error && String(cloud()?.user?.id || "") === userId) plans = result.data || [];
  }
  async function saveSelection() {
    if (busy || !selectionDirty) return;
    const requestOwner = String(owner || "");
    const desired = new Set(selectionDraft || []);
    if (!requestOwner || requestOwner !== String(cloud()?.user?.id || "")) throw new Error("Your account changed. Reopen Supplement Settings and try again.");
    busy = true;
    message = "";
    renderManagement();
    try {
      for (const plan of [...plans]) {
        const shouldBeActive = desired.has(catalogueKeyForPlan(plan));
        if (Boolean(plan.active) === shouldBeActive) continue;
        const { data, error } = await cloud().client.from(PLANS).update({ active: shouldBeActive }).eq("id", plan.id).eq("user_id", requestOwner).select().single();
        if (error) throw error;
        if (data) plans = plans.map(item => item.id === plan.id ? data : item);
      }
      for (const key of desired) {
        if (plans.some(plan => catalogueKeyForPlan(plan) === key)) continue;
        const entry = catalogueEntry(key);
        if (!entry) continue;
        const { data, error } = await cloud().client.from(PLANS).insert(rowForCatalogueEntry(entry)).select().single();
        if (error) throw error;
        if (data) plans.push(data);
      }
      if (requestOwner !== String(cloud()?.user?.id || "")) throw new Error("Your account changed before the supplement selection finished saving.");
      syncSelectionDraft({ force: true });
      message = "Supplement selection saved";
    } catch (error) {
      await reloadPlansPreservingDraft(requestOwner);
      selectionDraft = desired;
      syncSelectionDraft();
      message = `Could not save the supplement selection. Your choices are still here. ${error.message || "Try again."}`;
    } finally {
      busy = false;
      renderManagement();
    }
  }
  function showQuickLogSheet() {
    const sheet = document.getElementById("supplementQuickLogSheet");
    if (!sheet) return;
    sheet.hidden = false;
    sheet.removeAttribute("inert");
    document.body.classList.add("supplement-sheet-open");
  }
  function showSetupPrompt() {
    const title = document.getElementById("supplementQuickLogTitle");
    const contextCopy = document.getElementById("supplementQuickLogContext");
    if (title) title.textContent = "Choose your supplements first";
    if (contextCopy) contextCopy.textContent = "Select the supplements you want the Daily Mode button to record.";
    showQuickLogSheet();
  }
  function setDailyLogStatus(value = "") {
    const status = document.getElementById("supplementLogStatus");
    if (status) status.textContent = value;
  }
  function setDailyLogButtonBusy(value) {
    const button = document.getElementById("graphLogSupplementButton");
    if (!button) return;
    button.disabled = Boolean(value);
    button.setAttribute("aria-busy", value ? "true" : "false");
    button.innerHTML = `<span>${value ? "Recording…" : "Supplementation"}</span>`;
  }
  async function openQuickLog(planId = "", slotId = "") {
    if (owner !== String(cloud()?.user?.id || "")) await load();
    const available = activePlans();
    if (!available.length) {
      pendingSlotId = "";
      showSetupPrompt();
      return 0;
    }
    if (busy) return 0;
    const selectedIds = planId && planFor(planId)?.active ? [planId] : available.map(plan => plan.id);
    busy = true;
    pendingSlotId = slotId;
    setDailyLogButtonBusy(true);
    setDailyLogStatus("Recording supplements…");
    try {
      const count = await persistEvents(selectedIds, new Date(), pendingSlotId, { confirmTimingConflict: false });
      if (!count) return 0;
      setDailyLogStatus(`${count === 1 ? "Supplement" : "Supplements"} logged`);
      render();
      window.FuelGuardLoggingFeedback?.celebrate?.({ type: "supplement", message: message });
      return count;
    } catch (error) {
      setDailyLogStatus(`Could not record supplements: ${error.message || "Try again."}`);
      void window.FuelGuardProductAnalytics?.trackFailure?.("supplement", error, {
        metadata: { source: "daily_mode" }
      });
      return 0;
    } finally {
      busy = false;
      pendingSlotId = "";
      setDailyLogButtonBusy(false);
      renderManagement();
    }
  }
  function closeQuickLog() {
    const sheet = document.getElementById("supplementQuickLogSheet");
    sheet.hidden = true;
    sheet.setAttribute("inert", "");
    document.body.classList.remove("supplement-sheet-open");
    pendingSlotId = "";
  }
  async function persistEvents(planIds, takenAt, slotId = "", { confirmTimingConflict = true } = {}) {
    const requestOwner = String(owner || "");
    if (!requestOwner || requestOwner !== String(cloud()?.user?.id || "")) throw new Error("Your account changed. Try the supplement log again.");
    const selectedPlans = planIds.map(planFor).filter(Boolean);
    if (!selectedPlans.length) throw new Error("Select at least one supplement.");
    if (Number.isNaN(takenAt.getTime()) || takenAt > new Date(Date.now() + 5 * 60000)) throw new Error("Choose a valid time that is not in the future.");
    if (confirmTimingConflict && selectedPlans.some(plan => ironWindowConflict(plan, takenAt)) && !window.confirm("This time overlaps the personal caffeine timing window you set. Record it anyway?")) return 0;
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
    window.dispatchEvent?.(new CustomEvent("fuelguard:supplement-logged", {
      detail: {
        eventIds: (data || []).map(event => event.id).filter(Boolean),
        count: rows.length,
        loggedAt: atIso
      }
    }));
    emitEventsChanged();
    return rows.length;
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
    const reminderEnabled = scheduleFor(planId).some(slot => slot.reminder_enabled);
    const { data, error } = await cloud().client.from(SLOTS).insert({ id: uuid(), user_id: owner, supplement_plan_id: planId, local_time: time, days_of_week: days, active: true, reminder_enabled: reminderEnabled }).select().single();
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
    if (busy || !selectionDirty) return;
    try { await saveSelection(); } catch (error) { message = error.message || "The supplement selection could not be saved."; renderManagement(); }
  });
  document.addEventListener("change", event => {
    const input = event.target.closest?.('input[name="supplementSelection"]');
    if (!input || busy) return;
    syncSelectionDraft();
    if (input.checked) selectionDraft.add(input.value);
    else selectionDraft.delete(input.value);
    selectionDirty = !sameSelection(selectionDraft, persistedSelectionKeys());
    message = "";
    input.closest("[data-supplement-selection-row]")?.classList.toggle("selected", input.checked);
    const button = document.getElementById("supplementSelectionSave");
    if (button) button.disabled = !selectionDirty;
    const status = document.getElementById("supplementSelectionStatus");
    if (status) status.textContent = selectionDirty ? "Unsaved changes" : "";
  });
  document.addEventListener("click", async event => {
    if (event.target.closest('[data-settings-category-open="supplements"]') && !selectionDirty) void load();
    if (event.target.closest("#graphLogSupplementButton")) { await openQuickLog(); return; }
    if (event.target.closest("[data-open-supplement-settings]")) { closeQuickLog(); document.querySelector('[data-open-screen="checklist"]')?.click(); window.FuelGuardSettingsNavigation?.showCategory?.("supplements"); if (!selectionDirty) await load(); return; }
    const log = event.target.closest("[data-supplement-log]"); if (log) { openQuickLog(log.dataset.supplementLog, log.dataset.supplementSlot || ""); return; }
    if (event.target.closest("[data-supplement-cancel]")) { closeQuickLog(); return; }
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
  window.addEventListener("beforeunload", event => { if (selectionDirty) { event.preventDefault(); event.returnValue = ""; } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  document.addEventListener("DOMContentLoaded", load);

  window.FuelGuardSupplementRhythm = Object.freeze({
    load,
    render,
    openQuickLog,
    eventsForDay,
    timelineEventsForDay,
    analyticsEvents,
    reminderPrompt,
    recoveryActionSummary,
    _test: Object.freeze({ catalogue: CATALOGUE, ironWindowConflict, localDateKey, slotIsToday, typeLabel, plannedFor, isUuid, parseDays, patternEvent })
  });
})();
