(() => {
  "use strict";
  const PLANS = "fuel_supplement_plans";
  const SLOTS = "fuel_supplement_schedule_slots";
  const EVENTS = "fuel_supplement_events";
  const INSIGHT_MIN_EVENTS = 6;
  let owner = "";
  let plans = [];
  let slots = [];
  let events = [];
  let message = "";
  let busy = false;
  let pendingPlanId = "";
  let pendingSlotId = "";

  function cloud() { return window.fuelGuardCloud; }
  function domain() { return window.FuelGuardDomain; }
  function escape(value) { return domain()?.escapeHtml?.(value) || String(value ?? ""); }
  function uuid() { return globalThis.crypto?.randomUUID?.() || `supplement-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function localDateKey(value = new Date()) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
  function dayStart(value = new Date()) { const date = new Date(value); date.setHours(0,0,0,0); return date; }
  function dayEnd(value = new Date()) { const date = dayStart(value); date.setDate(date.getDate()+1); return date; }
  function planFor(id) { return plans.find(plan => plan.id === id); }
  function activePlans() { return plans.filter(plan => plan.active); }
  function todayEvents() { const start = dayStart(); const end = dayEnd(); return events.filter(event => new Date(event.taken_at) >= start && new Date(event.taken_at) < end); }
  function latestFuelLog() {
    const now = new Date();
    const logs = typeof fuelGapState === "function" ? fuelGapState()?.logs || [] : [];
    return logs.map(log => ({ log, at: domain()?.logDate?.(log) || new Date(log.timestamp || log.logged_at || "") }))
      .filter(item => !Number.isNaN(item.at.getTime()) && item.at >= dayStart() && item.at <= now && now - item.at <= 2 * 60 * 60 * 1000 && domain()?.isFuelLog?.(item.log))
      .sort((a,b) => b.at-a.at)[0]?.log || null;
  }
  function context() {
    const snapshot = window.FuelGuardContextLayer?.contextSnapshot?.() || { primary: "everyday", capturedAt: new Date().toISOString() };
    return {
      context_mode: snapshot.primary || "everyday",
      context_snapshot: snapshot
    };
  }
  function typeLabel(plan) { return plan?.supplement_type === "custom" ? plan.custom_name : ({ iron: "Iron", creatine: "Creatine", vitamin_c: "Vitamin C" })[plan?.supplement_type] || plan?.label || "Supplement"; }
  function eventForToday(planId, slotId = null) { return todayEvents().find(event => event.supplement_plan_id === planId && (event.schedule_slot_id || null) === (slotId || null)); }
  function scheduleFor(planId) { return slots.find(slot => slot.supplement_plan_id === planId); }
  function slotIsToday(slot, now = new Date()) { return !slot || (slot.days_of_week || []).includes(now.getDay()); }
  function timeLabel(value) { const [hour, minute] = String(value || "08:00").split(":"); const date = new Date(); date.setHours(Number(hour), Number(minute), 0, 0); return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function dateTimeLocal(value = new Date()) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset()*60000).toISOString().slice(0,16); }
  function daysLabel(days = []) { return days.length === 7 ? "Daily" : days.map(day => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][day]).join(", "); }
  function parseDays(value) { const lookup={sun:0,sunday:0,mon:1,monday:1,tue:2,tues:2,tuesday:2,wed:3,wednesday:3,thu:4,thur:4,thurs:4,thursday:4,fri:5,friday:5,sat:6,saturday:6}; return [...new Set(String(value||"").split(",").map(item=>lookup[item.trim().toLowerCase()]).filter(Number.isInteger))].sort(); }
  function plannedFor(slot, now = new Date()) { if (!slot?.local_time) return null; const [hour,minute] = slot.local_time.split(":").map(Number); const date = new Date(now); date.setHours(hour,minute,0,0); return date.toISOString(); }
  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "")); }
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
  function renderDaily() {
    const target = document.getElementById("athleteSupplementRhythm");
    if (!target) return;
    if (!cloud()?.user?.id) { target.innerHTML = ""; return; }
    const due = activePlans().flatMap(plan => {
      const planSlots = slots.filter(slot => slot.supplement_plan_id === plan.id && slot.active);
      return planSlots.length ? planSlots.filter(slot => slotIsToday(slot)).map(slot => ({ plan, slot })) : [{ plan, slot: null }];
    });
    target.innerHTML = `<div class="section-heading-row"><div><h3>Supplement Rhythm</h3><p class="muted">Private timing support. Supplements do not earn points or appear in Coach sharing.</p></div><button type="button" class="secondary supplement-manage-button" data-open-supplement-settings>Manage</button></div>
      ${due.length ? `<div class="supplement-today-list">${due.map(({ plan, slot }) => {
        const event = eventForToday(plan.id, slot?.id || null);
        const dueMinutes = slot?.local_time ? slot.local_time.split(":").slice(0,2).reduce((total,value,index)=>total+Number(value)*(index?1:60),0) : null;
        const now = new Date(); const currentMinutes = now.getHours()*60+now.getMinutes();
        const stateLabel = event ? event.event_status === "skipped" ? "Not taken today" : `Recorded ${new Date(event.taken_at).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}` : dueMinutes == null ? "As needed · not logged" : dueMinutes > currentMinutes ? "Due later" : "Due now · not logged";
        return `<article class="supplement-today-item ${event ? "complete" : ""}"><div><span>${slot?.local_time ? escape(timeLabel(slot.local_time)) : "As needed"}</span><strong>${escape(plan.label || typeLabel(plan))}</strong><small>${escape(stateLabel)}</small></div>${event ? `<div class="supplement-today-actions">${!slot && event.event_status === "taken" ? `<button class="primary" type="button" data-supplement-log="${escape(plan.id)}" data-supplement-slot="">Log another</button>` : ""}<button class="secondary" type="button" data-supplement-undo="${escape(event.id)}">Undo</button></div>` : `<div class="supplement-today-actions"><button class="primary" type="button" data-supplement-log="${escape(plan.id)}" data-supplement-slot="${escape(slot?.id || "")}">Taken</button><button class="secondary" type="button" data-supplement-skip="${escape(plan.id)}" data-supplement-slot="${escape(slot?.id || "")}">Not today</button></div>`}</article>`;
      }).join("")}</div>` : `<p class="muted">No active Supplement Rhythm plan for today. Add one in Settings if it supports your existing routine.</p>`}
      ${message ? `<p class="row-note" role="status">${escape(message)}</p>` : ""}`;
  }
  function insightMarkup() {
    const taken = events.filter(event => event.event_status === "taken");
    if (taken.length < INSIGHT_MIN_EVENTS) return `<p class="muted">Patterns appear after ${INSIGHT_MIN_EVENTS} recorded supplement moments. Fuel Guard will describe timing only, not effectiveness.</p>`;
    const recent = taken.filter(event => new Date(event.taken_at) >= new Date(Date.now()-7*86400000)); const associated = recent.filter(event => event.linked_fuel_event_id).length;
    return `<div class="supplement-insight"><strong>Last 7 days</strong><p>${recent.length} recorded moment${recent.length === 1 ? "" : "s"} · ${associated} associated with a Fuel event. This describes recorded timing only, not effectiveness.</p></div>`;
  }
  function consistencyMarkup(plan) {
    const today = dayStart();
    const days = Array.from({length:7},(_,offset)=>{ const date=new Date(today); date.setDate(date.getDate()-(6-offset)); const key=localDateKey(date); const done=events.some(event=>event.supplement_plan_id===plan.id&&event.event_status==="taken"&&localDateKey(event.taken_at)===key); return `<span class="${done?"logged":""}" title="${escape(date.toLocaleDateString())}">${date.toLocaleDateString([], {weekday:"narrow"})}</span>`; });
    return `<div class="supplement-consistency" aria-label="${escape(plan.label)} seven-day recorded history">${days.join("")}</div>`;
  }
  function renderManagement() {
    const target = document.getElementById("athleteSupplementManagement");
    if (!target) return;
    target.innerHTML = `<div class="section-heading-row"><div><h2>Supplement Rhythm</h2><p class="muted">Keep a private schedule for supplements you already choose to use. Fuel Guard does not prescribe doses or make medical claims.</p></div></div>
      <form id="supplementPlanForm" class="supplement-plan-form">
        <label>Supplement<select id="supplementPlanType"><option value="creatine">Creatine</option><option value="iron">Iron</option><option value="vitamin_c">Vitamin C</option><option value="custom">Custom</option></select></label>
        <label>Name<input id="supplementPlanName" maxlength="80" placeholder="e.g. Creatine" required></label>
        <label class="supplement-check"><input id="supplementPlanAsNeeded" type="checkbox"><span>As needed (no planned time)</span></label>
        <label id="supplementPlanTimeLabel">Usual time<input id="supplementPlanTime" type="time" value="08:00"></label>
        <fieldset><legend>Days</legend><div class="supplement-day-grid">${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((label,index)=>`<label><input type="checkbox" data-supplement-day="${index}" checked><span>${label}</span></label>`).join("")}</div></fieldset>
        <label>Routine context (optional)<select id="supplementRoutineSource"><option value="">Prefer not to add</option><option value="clinician">A clinician</option><option value="dietitian">A dietitian</option><option value="coach">A coach</option><option value="self_selected">My own routine</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></label>
        <label class="supplement-check"><input id="supplementReminderEnabled" type="checkbox"><span>Show a generic in-app reminder when due</span></label>
        <fieldset id="supplementIronSettings" hidden><legend>Optional personal timing preference</legend><p>Fuel Guard tracks a routine you have chosen or received from a qualified professional. It does not diagnose iron deficiency or recommend a dose.</p><label class="supplement-check"><input id="supplementIronWindowEnabled" type="checkbox"><span>Track separation from caffeine</span></label><label>Before (minutes)<input id="supplementIronBeforeMinutes" type="number" min="0" max="360" value="0"></label><label>After (minutes)<input id="supplementIronAfterMinutes" type="number" min="0" max="360" value="0"></label><p class="row-note">Only take iron according to instructions provided with your supplement or by a qualified professional. These windows are your own preference.</p></fieldset>
        <button class="primary" type="submit">Add plan</button>
      </form>
      <div class="supplement-plan-list">${plans.length ? plans.map(plan => {
        const slot = scheduleFor(plan.id);
        const planSlots = slots.filter(item => item.supplement_plan_id === plan.id && item.active);
        return `<article><div><span>${plan.active ? "Active" : "Paused"}</span><strong>${escape(plan.label)}</strong><small>${planSlots.length ? planSlots.map(item => `${timeLabel(item.local_time)} · ${daysLabel(item.days_of_week)}`).join(" · ") : "As needed"}${planSlots.some(item=>item.reminder_enabled) ? " · reminder on" : ""}</small>${consistencyMarkup(plan)}</div>${planSlots.length ? `<div class="supplement-slot-actions">${planSlots.map(item=>`<button class="secondary" type="button" data-supplement-edit-slot="${escape(item.id)}">Edit ${escape(timeLabel(item.local_time))}</button><button class="secondary" type="button" data-supplement-remove-slot="${escape(item.id)}" aria-label="Remove ${escape(timeLabel(item.local_time))} schedule">Remove</button>`).join("")}</div>` : ""}<div class="button-row"><button class="secondary" type="button" data-supplement-edit-plan="${escape(plan.id)}">Edit name</button><button class="secondary" type="button" data-supplement-add-slot="${escape(plan.id)}">Add time</button>${planSlots.length ? `<button class="secondary" type="button" data-supplement-toggle-reminder="${escape(plan.id)}">${planSlots.some(item=>item.reminder_enabled) ? "Reminders off" : "Reminders on"}</button>` : ""}<button class="secondary" type="button" data-supplement-toggle="${escape(plan.id)}">${plan.active ? "Pause" : "Resume"}</button><button class="secondary danger-secondary" type="button" data-supplement-delete-plan="${escape(plan.id)}">Delete</button></div></article>`;
      }).join("") : `<p class="muted">No Supplement Rhythm plans yet.</p>`}</div>
      <section class="supplement-history"><h3>Private history</h3>${events.length ? historyMarkup(events.slice(0,20)) : `<p class="muted">Nothing recorded yet.</p>`}${events.length > 20 ? `<details><summary>View longer history</summary>${historyMarkup(events.slice(20))}</details>` : ""}</section>
      ${insightMarkup()}
      <details class="supplement-data-actions"><summary>Supplement data and privacy</summary><p>Only you can access these records through the Athlete app. They are excluded from Coach access, organisations, points and sharing.</p><div class="button-row"><button class="secondary" type="button" data-supplement-export>Export JSON</button><button class="secondary danger-secondary" type="button" data-supplement-delete-all>Delete supplement data</button></div></details>
      ${message ? `<p class="row-note" role="status">${escape(message)}</p>` : ""}`;
  }
  function render() { renderDaily(); renderManagement(); window.FuelGuardContextLayer?.refresh?.(); window.FuelGuardAthleteRetention?.render?.(); }
  async function load() {
    const userId = String(cloud()?.user?.id || "");
    if (!userId || !cloud()?.client) { owner = ""; plans = []; slots = []; events = []; render(); return; }
    if (owner && owner !== userId) { plans = []; slots = []; events = []; }
    owner = userId;
    const [planResult, slotResult, eventResult] = await Promise.all([
      cloud().client.from(PLANS).select("*").eq("user_id", userId).order("created_at"),
      cloud().client.from(SLOTS).select("*").eq("user_id", userId).order("local_time"),
      cloud().client.from(EVENTS).select("*").eq("user_id", userId).order("taken_at", { ascending: false }).limit(200)
    ]);
    const error = planResult.error || slotResult.error || eventResult.error;
    if (error) { message = /does not exist|schema cache/i.test(error.message || "") ? "Supplement Rhythm is waiting for its release migration." : "Supplement Rhythm could not sync."; render(); return; }
    if (cloud()?.user?.id !== userId) return;
    plans = planResult.data || []; slots = slotResult.data || []; events = eventResult.data || []; message = ""; render();
  }
  async function addPlan() {
    const type = document.getElementById("supplementPlanType")?.value || "custom";
    const label = String(document.getElementById("supplementPlanName")?.value || "").trim();
    const asNeeded = Boolean(document.getElementById("supplementPlanAsNeeded")?.checked);
    const time = document.getElementById("supplementPlanTime")?.value || "08:00";
    const days = asNeeded ? [] : [...document.querySelectorAll("[data-supplement-day]:checked")].map(input => Number(input.dataset.supplementDay));
    if (!label) throw new Error("Add a short plan name.");
    if (!asNeeded && !days.length) throw new Error("Choose at least one day or use As needed.");
    const plan = { id: uuid(), user_id: owner, supplement_type: type, custom_name: type === "custom" ? label : null, label, routine_source: document.getElementById("supplementRoutineSource")?.value || null, active: true, track_caffeine_separation: type === "iron" && Boolean(document.getElementById("supplementIronWindowEnabled")?.checked), caffeine_separation_before_minutes: null, caffeine_separation_after_minutes: null };
    if (plan.track_caffeine_separation) { plan.caffeine_separation_before_minutes = Number(document.getElementById("supplementIronBeforeMinutes")?.value || 0); plan.caffeine_separation_after_minutes = Number(document.getElementById("supplementIronAfterMinutes")?.value || 0); }
    if (plan.track_caffeine_separation && plan.caffeine_separation_before_minutes + plan.caffeine_separation_after_minutes <= 0) throw new Error("Add the caffeine separation window you personally follow, or turn this option off.");
    const { data, error } = await cloud().client.from(PLANS).insert(plan).select().single();
    if (error) throw error;
    plans.push(data);
    if (!asNeeded) {
      const slot = { id: uuid(), user_id: owner, supplement_plan_id: data.id, local_time: time, days_of_week: days, active: true, reminder_enabled: Boolean(document.getElementById("supplementReminderEnabled")?.checked) };
      const slotResult = await cloud().client.from(SLOTS).insert(slot).select().single();
      if (slotResult.error) { await cloud().client.from(PLANS).delete().eq("id", data.id).eq("user_id", owner); plans=plans.filter(item=>item.id!==data.id); throw slotResult.error; }
      slots.push(slotResult.data);
    }
    message = "Supplement Rhythm plan added."; render();
  }
  function openQuickLog(planId, slotId = "") {
    const plan = planFor(planId); if (!plan) return;
    pendingPlanId = planId;
    pendingSlotId = slotId;
    const sheet = document.getElementById("supplementQuickLogSheet"); const fuel = latestFuelLog();
    document.getElementById("supplementQuickLogTitle").textContent = `Record ${plan.label}`;
    document.getElementById("supplementQuickLogContext").textContent = `Current context: ${window.FuelGuardContextLayer?.primaryContext?.() || "everyday"}. Nothing changes mode.`;
    const association = document.getElementById("supplementQuickFuelAssociation"); association.hidden = !fuel;
    document.getElementById("supplementQuickFuelLabel").textContent = fuel ? `Link this to your ${new Date(domain().logDate(fuel)).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})} Fuel entry?` : "Link nearby Fuel event";
    document.getElementById("supplementQuickLinkFuel").checked = Boolean(fuel);
    document.getElementById("supplementQuickWithFood").checked = false;
    document.getElementById("supplementQuickTakenAt").value = dateTimeLocal();
    sheet.hidden = false; sheet.removeAttribute("inert");
  }
  function closeQuickLog() { const sheet=document.getElementById("supplementQuickLogSheet"); sheet.hidden=true; sheet.setAttribute("inert",""); pendingPlanId=""; pendingSlotId=""; }
  async function recordPlan(planId, slotId, status = "taken", associated = latestFuelLog()) {
    const plan = planFor(planId); if (!plan || busy) return;
    if (status === "taken" && ironWindowConflict(plan) && !window.confirm("This overlaps the personal caffeine timing window you set. Record it anyway?")) return;
    busy = true; const confirmButton = document.getElementById("supplementQuickConfirm"); if (confirmButton) confirmButton.disabled = true; message = status === "skipped" ? "Updating today…" : "Recording supplement…"; render();
    const slot = slots.find(item => item.id === slotId && item.supplement_plan_id === planId) || null; const chosenAt = status === "taken" ? document.getElementById("supplementQuickTakenAt")?.value : ""; const at = chosenAt ? new Date(chosenAt) : new Date(); const snapshot = context();
    if (Number.isNaN(at.getTime())) { busy=false; if(confirmButton)confirmButton.disabled=false; message="Choose a valid local date and time."; render(); return; }
    const fuelId = associated?.cloudId || associated?.id || null;
    const row = { id: uuid(), user_id: owner, supplement_plan_id: planId, schedule_slot_id: slot?.id || null, event_status: status, taken_at: at.toISOString(), planned_for: plannedFor(slot, at), source: "manual", idempotency_key: slot ? `schedule:${slot.id}:${localDateKey(at)}` : status === "skipped" ? `skip:${planId}:${localDateKey(at)}` : `manual:${planId}:${at.toISOString()}:${uuid()}`, with_food: status === "taken" && Boolean(document.getElementById("supplementQuickWithFood")?.checked), linked_fuel_event_id: status === "taken" && document.getElementById("supplementQuickLinkFuel")?.checked && isUuid(fuelId) ? fuelId : null, context_mode: snapshot.context_mode, recovery_focus_id: window.FuelGuardContextLayer?.activeRecovery?.()?.id || null, context_snapshot: snapshot.context_snapshot };
    const { data, error } = await cloud().client.from(EVENTS).insert(row).select().single();
    busy = false; if (confirmButton) confirmButton.disabled = false;
    if (error) message = /duplicate/i.test(error.message || "") ? "Already recorded." : `Supplement could not be recorded: ${error.message}`;
    else { events.unshift(data); message = status === "skipped" ? `${plan.label} marked not taken today.` : `${plan.label} recorded.`; if (status === "taken") closeQuickLog(); }
    render();
  }
  function logPlan(planId, associated = latestFuelLog()) { return recordPlan(planId, pendingSlotId, "taken", associated); }
  function historyMarkup(rows) { return rows.map(event => `<article><div><strong>${escape(planFor(event.supplement_plan_id)?.label || "Deleted plan")}</strong><small>${escape(new Date(event.taken_at).toLocaleString())} · ${escape(event.context_mode)}${event.event_status === "skipped" ? " · not taken" : event.with_food ? " · with food" : ""}</small></div><div class="button-row">${event.linked_fuel_event_id ? `<button class="secondary" type="button" data-supplement-unlink-fuel="${escape(event.id)}">Remove fuel link</button>` : ""}<button class="secondary" type="button" data-supplement-edit="${escape(event.id)}">Edit time</button><button class="secondary" type="button" data-supplement-undo="${escape(event.id)}">Undo</button></div></article>`).join(""); }
  async function removeEvent(id) { const result = await cloud().client.from(EVENTS).delete().eq("id", id).eq("user_id", owner); if (result.error) message = result.error.message; else { events = events.filter(event => event.id !== id); message = "Supplement record undone."; } render(); }
  async function editEvent(id) {
    const event = events.find(item => item.id === id); if (!event) return;
    const current = new Date(event.taken_at); const local = new Date(current.getTime() - current.getTimezoneOffset()*60000).toISOString().slice(0,16);
    const value = window.prompt("Edit the recorded local date and time (YYYY-MM-DDTHH:MM)", local); if (!value) return;
    const date = new Date(value); if (Number.isNaN(date.getTime())) { message = "Enter a valid date and time."; render(); return; }
    const result = await cloud().client.from(EVENTS).update({ taken_at: date.toISOString() }).eq("id", id).eq("user_id", owner).select().single();
    if (result.error) message = result.error.message; else { events = events.map(item => item.id === id ? result.data : item).sort((a,b) => new Date(b.taken_at)-new Date(a.taken_at)); message = "Supplement time updated."; } render();
  }
  async function unlinkFuel(id) { const result=await cloud().client.from(EVENTS).update({linked_fuel_event_id:null,with_food:false}).eq("id",id).eq("user_id",owner).select().single(); if(result.error)message=result.error.message;else{events=events.map(item=>item.id===id?result.data:item);message="Fuel association removed.";}render(); }
  async function editPlan(id) { const plan=planFor(id); if(!plan)return; const label=window.prompt("Plan name",plan.label); if(!label?.trim())return; const result=await cloud().client.from(PLANS).update({label:label.trim(),custom_name:plan.supplement_type==="custom"?label.trim():null}).eq("id",id).eq("user_id",owner).select().single(); if(result.error)message=result.error.message;else{plans=plans.map(item=>item.id===id?result.data:item);message="Plan updated.";}render(); }
  function reminderPrompt(now = new Date()) {
    const currentMinutes = now.getHours()*60+now.getMinutes();
    const due = activePlans().find(plan => {
      const slot = slots.find(item => item.supplement_plan_id === plan.id && item.active && item.reminder_enabled && slotIsToday(item, now) && !eventForToday(plan.id, item.id));
      if (!slot) return false; const [hour,minute] = slot.local_time.split(":").map(Number); return currentMinutes >= hour*60+minute;
    });
    return due ? { id: "supplement_reminder", occurrenceKey: `supplement:${due.id}:${localDateKey(now)}`, title: "Supplement reminder", detail: "A scheduled Fuel Guard routine is due." } : null;
  }
  function recoveryActionSummary(now = new Date()) { const planned=activePlans().flatMap(plan=>slots.filter(slot=>slot.supplement_plan_id===plan.id&&slot.active&&slotIsToday(slot,now)).map(slot=>({plan,slot}))); const taken=planned.filter(({plan,slot})=>eventForToday(plan.id,slot.id)?.event_status==="taken"); const due=planned.find(({plan,slot})=>{const [hour,minute]=slot.local_time.split(":").map(Number);return now.getHours()*60+now.getMinutes()>=hour*60+minute&&!eventForToday(plan.id,slot.id);}); return {planned:planned.length,taken:taken.length,dueLabel:due?.plan?.label||""}; }
  function exportData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), plans, scheduleSlots: slots, events, recoveryFocusSessions: window.FuelGuardContextLayer?.exportRows?.() || [] }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `fuel-guard-supplement-rhythm-${localDateKey()}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function deleteAll() {
    if (!window.confirm("Delete all Supplement Rhythm plans, schedules and event history? This cannot be undone.")) return;
    const eventDelete = await cloud().client.from(EVENTS).delete().eq("user_id", owner); if (eventDelete.error) { message = eventDelete.error.message; render(); return; }
    await cloud().client.from(SLOTS).delete().eq("user_id", owner); const planDelete = await cloud().client.from(PLANS).delete().eq("user_id", owner);
    if (planDelete.error) message = planDelete.error.message; else { plans=[]; slots=[]; events=[]; message="Supplement data deleted."; } render();
  }
  document.addEventListener("submit", event => { if (event.target.id !== "supplementPlanForm") return; event.preventDefault(); addPlan().catch(error => { message = error.message; render(); }); });
  document.addEventListener("change", event => { if (event.target.id === "supplementPlanType") { const fieldset = document.getElementById("supplementIronSettings"); if (fieldset) fieldset.hidden = event.target.value !== "iron"; } if(event.target.id === "supplementPlanAsNeeded"){ const label=document.getElementById("supplementPlanTimeLabel"); if(label) label.hidden=event.target.checked; } });
  document.addEventListener("click", async event => {
    const log = event.target.closest("[data-supplement-log]"); if (log) return openQuickLog(log.dataset.supplementLog, log.dataset.supplementSlot || "");
    const skip = event.target.closest("[data-supplement-skip]"); if (skip) return recordPlan(skip.dataset.supplementSkip, skip.dataset.supplementSlot || "", "skipped", null);
    if (event.target.closest("#supplementQuickConfirm")) return logPlan(pendingPlanId);
    if (event.target.closest("[data-supplement-cancel]")) return closeQuickLog();
    const undo = event.target.closest("[data-supplement-undo]"); if (undo) return removeEvent(undo.dataset.supplementUndo);
    const edit = event.target.closest("[data-supplement-edit]"); if (edit) return editEvent(edit.dataset.supplementEdit);
    const unlink = event.target.closest("[data-supplement-unlink-fuel]"); if (unlink) return unlinkFuel(unlink.dataset.supplementUnlinkFuel);
    const editPlanButton = event.target.closest("[data-supplement-edit-plan]"); if(editPlanButton) return editPlan(editPlanButton.dataset.supplementEditPlan);
    const editSlotButton = event.target.closest("[data-supplement-edit-slot]"); if(editSlotButton) { const slot=slots.find(item=>item.id===editSlotButton.dataset.supplementEditSlot); if(!slot)return; const time=window.prompt("Local time (HH:MM)",String(slot.local_time).slice(0,5)); if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||"")){message="Use a 24-hour time such as 18:00.";render();return;} const dayText=window.prompt("Days, separated by commas (for example Mon, Wed, Fri)",daysLabel(slot.days_of_week)); if(dayText===null)return; const days=parseDays(dayText); if(!days.length){message="Choose at least one valid day.";render();return;} const result=await cloud().client.from(SLOTS).update({local_time:time,days_of_week:days}).eq("id",slot.id).eq("user_id",owner).select().single(); if(result.error)message=result.error.message;else{slots=slots.map(item=>item.id===slot.id?result.data:item);message="Schedule updated.";}render();return; }
    const removeSlotButton = event.target.closest("[data-supplement-remove-slot]"); if(removeSlotButton&&window.confirm("Remove this planned time? Existing event history is retained.")){const slotId=removeSlotButton.dataset.supplementRemoveSlot;const result=await cloud().client.from(SLOTS).update({active:false,reminder_enabled:false}).eq("id",slotId).eq("user_id",owner).select().single();if(result.error)message=result.error.message;else{slots=slots.map(item=>item.id===slotId?result.data:item);message="Planned time removed.";}render();return;}
    const toggle = event.target.closest("[data-supplement-toggle]"); if (toggle) { const plan=planFor(toggle.dataset.supplementToggle); const result=await cloud().client.from(PLANS).update({active:!plan.active}).eq("id",plan.id).eq("user_id",owner).select().single(); if(!result.error) plans=plans.map(item=>item.id===plan.id?result.data:item); render(); return; }
    const reminder = event.target.closest("[data-supplement-toggle-reminder]"); if (reminder) { const planId=reminder.dataset.supplementToggleReminder; const planSlots=slots.filter(item=>item.supplement_plan_id===planId); const enabled=!planSlots.some(item=>item.reminder_enabled); const result=await cloud().client.from(SLOTS).update({reminder_enabled:enabled}).eq("supplement_plan_id",planId).eq("user_id",owner).select(); if(result.error)message=result.error.message;else{slots=slots.map(item=>item.supplement_plan_id===planId?{...item,reminder_enabled:enabled}:item);message=`Reminders ${enabled?"enabled":"disabled"}.`;}render();return; }
    const addSlot = event.target.closest("[data-supplement-add-slot]"); if (addSlot) { const time=window.prompt("Add another local time (HH:MM)","18:00"); if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time||"")){message="Use a 24-hour time such as 18:00.";render();return;} const result=await cloud().client.from(SLOTS).insert({id:uuid(),user_id:owner,supplement_plan_id:addSlot.dataset.supplementAddSlot,local_time:time,days_of_week:[0,1,2,3,4,5,6],active:true,reminder_enabled:false}).select().single(); if(result.error)message=result.error.message;else{slots.push(result.data);message="Schedule time added.";}render();return; }
    const remove = event.target.closest("[data-supplement-delete-plan]"); if (remove && window.confirm("Delete this plan and its private event history? This cannot be undone.")) { const planId=remove.dataset.supplementDeletePlan; const eventResult=await cloud().client.from(EVENTS).delete().eq("supplement_plan_id",planId).eq("user_id",owner); if(eventResult.error){message=eventResult.error.message;render();return;} const slotResult=await cloud().client.from(SLOTS).delete().eq("supplement_plan_id",planId).eq("user_id",owner); if(slotResult.error){message=slotResult.error.message;render();return;} const result=await cloud().client.from(PLANS).delete().eq("id",planId).eq("user_id",owner); message=result.error?result.error.message:"Plan and history deleted."; if(!result.error){plans=plans.filter(item=>item.id!==planId);slots=slots.filter(item=>item.supplement_plan_id!==planId);events=events.filter(item=>item.supplement_plan_id!==planId);} render(); return; }
    if (event.target.closest("[data-open-supplement-settings]")) { document.querySelector('[data-open-screen="checklist"]')?.click(); window.FuelGuardSettingsNavigation?.showCategory?.("supplements"); }
    if (event.target.closest("[data-supplement-export]")) exportData();
    if (event.target.closest("[data-supplement-delete-all]")) deleteAll();
  });
  window.addEventListener("fuelguard:auth-state", () => load());
  window.addEventListener("fuelguard:private-app-ready", () => load());
  window.addEventListener("fuelguard:cloud-status", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  document.addEventListener("DOMContentLoaded", () => load());
  window.FuelGuardSupplementRhythm = Object.freeze({ load, render, reminderPrompt, recoveryActionSummary, _test: Object.freeze({ INSIGHT_MIN_EVENTS, ironWindowConflict, localDateKey, slotIsToday, typeLabel, plannedFor, isUuid, parseDays }) });
})();
