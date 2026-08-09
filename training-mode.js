// Dedicated endurance Training Mode for the canonical Athlete PWA.
(() => {
  const PRESETS_TABLE = "fuel_training_mode_presets";
  const SESSIONS_TABLE = "fuel_training_mode_sessions";
  const SESSION_COLUMNS = "id,user_id,title,session_type,status,started_at,ended_at,fuel_preset_id,hydration_preset_id,fuel_carbs_g,fuel_fluid_ml,fuel_sodium_mg,fuel_caffeine_mg,hydration_carbs_g,hydration_fluid_ml,hydration_sodium_mg,hydration_caffeine_mg,plan_carbs_g_per_hour,plan_fluid_ml_per_hour,plan_sodium_mg_per_hour,plan_caffeine_mg_per_hour,created_at,updated_at";
  const PRESET_COLUMNS = "id,user_id,event_type,name,carbs_g,fluid_ml,sodium_mg,caffeine_mg,is_default,updated_at";
  const QUANTITIES = [
    { field: "carbsG", label: "Carbohydrate", short: "Carbs", unit: "g" },
    { field: "fluidMl", label: "Fluid", short: "Fluid", unit: "ml" },
    { field: "sodiumMg", label: "Sodium", short: "Sodium", unit: "mg" },
    { field: "caffeineMg", label: "Caffeine", short: "Caffeine", unit: "mg" }
  ];
  let cloudBusy = false;
  let statusMessage = "";
  let durationTimer = 0;

  function domain() {
    return window.FuelGuardDomain;
  }

  function state() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    if (!gap) return null;
    if (!gap.trainingMode || typeof gap.trainingMode !== "object" || Array.isArray(gap.trainingMode)) {
      gap.trainingMode = {
        presets: {
          fuel: { id: "", carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 },
          hydration: { id: "", carbsG: 10, fluidMl: 200, sodiumMg: 250, caffeineMg: 0 }
        },
        plan: { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 },
        activeSession: null,
        sessions: [],
        lastSyncedAt: "",
        lastError: ""
      };
    }
    if (!Array.isArray(gap.trainingMode.sessions)) gap.trainingMode.sessions = [];
    return gap.trainingMode;
  }

  function logs() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    return Array.isArray(gap?.logs) ? gap.logs : [];
  }

  function uuid() {
    if (typeof uid === "function") return uid();
    return crypto.randomUUID();
  }

  function escape(value) {
    return domain()?.escapeHtml?.(value) || String(value || "");
  }

  function persist() {
    if (typeof save === "function") save();
  }

  function preset(type) {
    return state()?.presets?.[type] || {};
  }

  function ensurePreset(type) {
    const training = state();
    if (!training.presets || typeof training.presets !== "object") training.presets = {};
    if (!training.presets[type] || typeof training.presets[type] !== "object") training.presets[type] = {};
    const defaults = type === "fuel"
      ? { carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 }
      : { carbsG: 10, fluidMl: 200, sodiumMg: 250, caffeineMg: 0 };
    training.presets[type] = { id: "", dirty: false, ...defaults, ...training.presets[type] };
    if (!training.presets[type].id) training.presets[type].id = uuid();
    return training.presets[type];
  }

  function activeSession() {
    const active = state()?.activeSession;
    return active?.status === "active" && !active.endedAt ? active : null;
  }

  function contextForEvent(type, at = new Date()) {
    const active = activeSession();
    const eventTime = new Date(at);
    if (!active || Number.isNaN(eventTime.getTime()) || eventTime < new Date(active.startedAt)) return null;
    return domain()?.trainingEventContext?.(active, type) || null;
  }

  function quantityInputs(type, values = preset(type)) {
    return QUANTITIES.map(item => `
      <label>${escape(item.short)} <span>${item.unit}</span>
        <input type="number" min="0" max="${domain()?.TRAINING_QUANTITY_LIMITS?.[item.field] || 10000}" step="1" inputmode="numeric" value="${Number(values[item.field] || 0)}" data-training-preset="${type}" data-training-field="${item.field}">
      </label>
    `).join("");
  }

  function planInputs(plan = state()?.plan || {}) {
    return QUANTITIES.map(item => `
      <label>${escape(item.short)} <span>${item.unit}/hour</span>
        <input type="number" min="0" max="${domain()?.TRAINING_QUANTITY_LIMITS?.[item.field] || 10000}" step="1" inputmode="numeric" value="${Number(plan[item.field] || 0)}" data-training-plan="${item.field}">
      </label>
    `).join("");
  }

  function setupMarkup() {
    ensurePreset("fuel");
    ensurePreset("hydration");
    const training = state();
    return `
      <section class="training-mode-hero setup">
        <p>Endurance session</p>
        <h1>Training Mode</h1>
        <span>Configure once, then log Fuel and Hydrate with one tap during training.</span>
      </section>
      <section class="training-mode-section training-mode-session-setup">
        <div class="training-mode-heading">
          <div><span>Session</span><h2>Set up your training</h2></div>
          <small>Daily Log remains quantity-free.</small>
        </div>
        <div class="training-mode-session-fields">
          <label>Session name<input id="trainingModeTitle" type="text" maxlength="120" value="Training session" placeholder="Long ride"></label>
          <label>Activity<select id="trainingModeType">
            <option value="bike">Bike</option><option value="run">Run</option><option value="swim">Swim</option>
            <option value="brick">Brick</option><option value="triathlon">Triathlon</option><option value="race">Race</option><option value="other">Other</option>
          </select></label>
        </div>
      </section>
      <section class="training-mode-section">
        <div class="training-mode-heading"><div><span>One-tap preset</span><h2>Fuel action</h2></div><small>Applied to each Training Fuel event.</small></div>
        <div class="training-mode-quantity-grid">${quantityInputs("fuel")}</div>
      </section>
      <section class="training-mode-section">
        <div class="training-mode-heading"><div><span>One-tap preset</span><h2>Hydrate action</h2></div><small>Drinks may include carbohydrate and sodium.</small></div>
        <div class="training-mode-quantity-grid">${quantityInputs("hydration")}</div>
      </section>
      <details class="training-mode-section training-mode-plan">
        <summary>Your optional plan</summary>
        <p>Choose your own planned rates. Fuel Guard tracks execution; it does not prescribe a strategy.</p>
        <div class="training-mode-quantity-grid">${planInputs(training.plan)}</div>
      </details>
      <section class="training-mode-start-panel">
        <p>${escape(statusMessage || "Starting Training Mode is explicit. No quantities are added to ordinary Daily Mode logs.")}</p>
        <button class="primary training-mode-start" type="button" data-training-start>Start Training Mode</button>
      </section>
      ${completedSessionsMarkup()}
    `;
  }

  function durationText(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds || 0)));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return [hours, minutes, secs].map(value => String(value).padStart(2, "0")).join(":");
  }

  function unitValue(value, unit) {
    const number = Number(value || 0);
    return `${Number.isInteger(number) ? number.toLocaleString("en-GB") : number.toFixed(1)}${unit}`;
  }

  function sessionSummary(session, now = new Date()) {
    return domain().trainingSessionIntakeSummary({ session, logs: logs(), now });
  }

  function intakeCards(summary, session) {
    const progress = domain().trainingPlanProgress(summary, session.plan || {});
    return QUANTITIES.map(item => {
      const total = summary.totals[item.field];
      const rate = summary.perHour[item.field];
      const plan = progress[item.field];
      const planCopy = plan.plannedRate > 0
        ? `<small class="${plan.state}">${unitValue(plan.expected, item.unit)} planned by now · ${plan.state === "on_plan" ? "on plan" : `${unitValue(Math.abs(plan.difference), item.unit)} ${plan.state === "behind" ? "behind plan" : "ahead of plan"}`}</small>`
        : `<small>No planned rate set.</small>`;
      const expectedMax = Math.max(Number(plan.expected || 0), Number(total || 0), 1);
      const width = Math.min(100, Math.round((Number(total || 0) / expectedMax) * 100));
      return `
        <article class="training-mode-intake-card">
          <span>${escape(item.label)}</span>
          <strong>${unitValue(total, item.unit)} <em>· ${unitValue(rate, item.unit)}/h</em></strong>
          <div class="training-mode-progress" aria-hidden="true"><i style="width:${width}%"></i></div>
          ${planCopy}
        </article>
      `;
    }).join("");
  }

  function eventTimeline(session, summary) {
    const duration = Math.max(1, summary.durationSeconds);
    const events = summary.logs.slice().sort((a, b) => new Date(a.timestamp || a.logged_at) - new Date(b.timestamp || b.logged_at));
    const markers = events.map(log => {
      const seconds = Math.max(0, (new Date(log.timestamp || log.logged_at) - new Date(session.startedAt)) / 1000);
      const left = Math.min(100, Math.max(0, (seconds / duration) * 100));
      const hydration = String(log.type) === "hydration";
      return `<i class="${hydration ? "hydration" : "fuel"}" style="left:${left}%" title="${hydration ? "Hydrate" : "Fuel"} ${escape(domain().formatClock(new Date(log.timestamp || log.logged_at)))}"></i>`;
    }).join("");
    const latestFuel = events.filter(domain().isFuelLog).at(-1);
    const latestHydration = events.filter(domain().isHydrationLog).at(-1);
    const gap = latest => latest ? durationText((Date.now() - new Date(latest.timestamp || latest.logged_at)) / 1000) : "Not logged";
    return `
      <section class="training-mode-timeline" aria-label="Training event timeline">
        <div class="training-mode-timeline-track">${markers}</div>
        <div class="training-mode-timeline-labels"><span>Start</span><span>Now</span></div>
        <div class="training-mode-gap-row"><span>Fuel gap <strong>${gap(latestFuel)}</strong></span><span>Hydration gap <strong>${gap(latestHydration)}</strong></span></div>
      </section>
    `;
  }

  function activeMarkup(session) {
    const summary = sessionSummary(session);
    return `
      <section class="training-mode-hero active" aria-live="polite">
        <p>TRAINING · <span data-training-duration>${durationText(summary.durationSeconds)}</span></p>
        <h1>${escape(session.title)}</h1>
        <span>${escape(String(session.sessionType || "training").replace(/_/g, " "))} · Training Mode active</span>
      </section>
      ${eventTimeline(session, summary)}
      <section class="training-mode-live-actions" aria-label="Training quick actions">
        <button class="training-mode-action fuel" type="button" data-training-log="fuel"><strong>Fuel</strong><span>${presetSummary(session, "fuel")}</span></button>
        <button class="training-mode-action hydration" type="button" data-training-log="hydration"><strong>Hydrate</strong><span>${presetSummary(session, "hydration")}</span></button>
      </section>
      <section class="training-mode-section">
        <div class="training-mode-heading"><div><span>Session intake</span><h2>Actual vs your plan</h2></div><button class="secondary" type="button" data-training-refresh>Refresh</button></div>
        <div class="training-mode-intake-grid">${intakeCards(summary, session)}</div>
      </section>
      <section class="training-mode-end-panel">
        <p>${escape(statusMessage || "Ending the session is explicit. Your summary will remain available for review.")}</p>
        <button class="secondary training-mode-end" type="button" data-training-end>End Training Mode</button>
      </section>
    `;
  }

  function presetSummary(session, type) {
    const context = domain().trainingEventContext(session, type);
    return QUANTITIES.filter(item => context[item.field] > 0).map(item => `${context[item.field]}${item.unit} ${item.short.toLowerCase()}`).join(" · ");
  }

  function prePostMarkup(session) {
    const workout = {
      id: session.id,
      athleteId: window.fuelGuardCloud?.user?.id || "",
      startAt: session.startedAt,
      endAt: session.endedAt,
      source: "training_mode",
      type: session.sessionType
    };
    const context = domain().getWorkoutFuelContext(workout, logs());
    return `<div class="training-mode-review-context"><span>Before <strong>${context.hasPreviousFuel ? `${domain().duration(context.preFuelGapMinutes)} since fuel` : "No prior fuel"}</strong></span><span>After <strong>${context.hasPostFuel ? `${domain().duration(context.postFuelGapMinutes)} to fuel` : "No post-session fuel yet"}</strong></span></div>`;
  }

  function completedSessionsMarkup() {
    const sessions = (state()?.sessions || []).filter(item => item.status === "completed" && item.endedAt).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 6);
    if (!sessions.length) return "";
    return `
      <section class="training-mode-section training-mode-review-list">
        <div class="training-mode-heading"><div><span>History</span><h2>Recent Training Mode sessions</h2></div></div>
        ${sessions.map(session => {
          const summary = sessionSummary(session, new Date(session.endedAt));
          return `<article class="training-mode-review-card">
            <div><span>${new Date(session.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span><h3>${escape(session.title)}</h3><small>${durationText(summary.durationSeconds)} · ${summary.eventCount} events</small></div>
            <div class="training-mode-review-totals">${QUANTITIES.map(item => `<span>${item.short}<strong>${unitValue(summary.totals[item.field], item.unit)}</strong><small>${unitValue(summary.perHour[item.field], item.unit)}/h</small></span>`).join("")}</div>
            ${prePostMarkup(session)}
          </article>`;
        }).join("")}
      </section>
    `;
  }

  function render() {
    const target = document.getElementById("trainingModeSurface");
    if (!target || !domain()) return;
    const active = activeSession();
    target.innerHTML = active ? activeMarkup(active) : setupMarkup();
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = active ? setInterval(() => {
      const duration = document.querySelector("[data-training-duration]");
      if (duration) duration.textContent = durationText((Date.now() - new Date(active.startedAt)) / 1000);
    }, 1000) : 0;
  }

  function readNumber(selector) {
    const value = Number(document.querySelector(selector)?.value || 0);
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  function collectPreset(type) {
    const next = { ...ensurePreset(type), dirty: true };
    QUANTITIES.forEach(item => { next[item.field] = readNumber(`[data-training-preset="${type}"][data-training-field="${item.field}"]`); });
    return next;
  }

  function collectPlan() {
    const next = {};
    QUANTITIES.forEach(item => { next[item.field] = readNumber(`[data-training-plan="${item.field}"]`); });
    return next;
  }

  async function startSession() {
    const training = state();
    const fuel = collectPreset("fuel");
    const hydration = collectPreset("hydration");
    const fuelValidation = domain().validateTrainingPreset(fuel);
    const hydrationValidation = domain().validateTrainingPreset(hydration);
    if (!fuelValidation.valid || !hydrationValidation.valid) {
      statusMessage = [...fuelValidation.errors, ...hydrationValidation.errors][0] || "Check your presets.";
      render();
      return;
    }
    if (!window.confirm("Start Training Mode with these one-tap presets?")) return;
    training.presets.fuel = { ...fuel, ...fuelValidation.preset };
    training.presets.hydration = { ...hydration, ...hydrationValidation.preset };
    training.plan = collectPlan();
    const startedAt = new Date().toISOString();
    const session = {
      id: uuid(),
      title: String(document.getElementById("trainingModeTitle")?.value || "Training session").trim().slice(0, 120) || "Training session",
      sessionType: document.getElementById("trainingModeType")?.value || "bike",
      status: "active",
      startedAt,
      endedAt: null,
      fuelPresetId: fuel.id,
      hydrationPresetId: hydration.id,
      fuelCarbsG: fuel.carbsG,
      fuelFluidMl: fuel.fluidMl,
      fuelSodiumMg: fuel.sodiumMg,
      fuelCaffeineMg: fuel.caffeineMg,
      hydrationCarbsG: hydration.carbsG,
      hydrationFluidMl: hydration.fluidMl,
      hydrationSodiumMg: hydration.sodiumMg,
      hydrationCaffeineMg: hydration.caffeineMg,
      plan: { ...training.plan },
      createdAt: startedAt,
      updatedAt: startedAt
    };
    training.activeSession = session;
    training.sessions = [session, ...training.sessions.filter(item => item.id !== session.id)];
    statusMessage = "Training Mode active.";
    persist();
    render();
    await syncCloud();
  }

  async function endSession() {
    const training = state();
    const active = activeSession();
    if (!active || !window.confirm("End Training Mode and save this session summary?")) return;
    const endedAt = new Date().toISOString();
    active.status = "completed";
    active.endedAt = endedAt;
    active.updatedAt = endedAt;
    training.sessions = training.sessions.map(item => item.id === active.id ? { ...active } : item);
    training.activeSession = null;
    statusMessage = "Training Mode ended. Session summary saved.";
    persist();
    render();
    await syncCloud();
  }

  function presetRow(type, currentUser) {
    const value = ensurePreset(type);
    return {
      id: value.id,
      user_id: currentUser.id,
      event_type: type,
      name: type === "fuel" ? "Fuel" : "Hydrate",
      carbs_g: value.carbsG,
      fluid_ml: value.fluidMl,
      sodium_mg: value.sodiumMg,
      caffeine_mg: value.caffeineMg,
      is_default: true,
      updated_at: new Date().toISOString()
    };
  }

  function sessionRow(session, currentUser) {
    return {
      id: session.id,
      user_id: currentUser.id,
      title: session.title,
      session_type: session.sessionType,
      status: session.status,
      started_at: session.startedAt,
      ended_at: session.endedAt || null,
      fuel_preset_id: session.fuelPresetId,
      hydration_preset_id: session.hydrationPresetId,
      fuel_carbs_g: session.fuelCarbsG,
      fuel_fluid_ml: session.fuelFluidMl,
      fuel_sodium_mg: session.fuelSodiumMg,
      fuel_caffeine_mg: session.fuelCaffeineMg,
      hydration_carbs_g: session.hydrationCarbsG,
      hydration_fluid_ml: session.hydrationFluidMl,
      hydration_sodium_mg: session.hydrationSodiumMg,
      hydration_caffeine_mg: session.hydrationCaffeineMg,
      plan_carbs_g_per_hour: session.plan?.carbsG || 0,
      plan_fluid_ml_per_hour: session.plan?.fluidMl || 0,
      plan_sodium_mg_per_hour: session.plan?.sodiumMg || 0,
      plan_caffeine_mg_per_hour: session.plan?.caffeineMg || 0,
      updated_at: session.updatedAt || new Date().toISOString()
    };
  }

  function sessionFromRow(row) {
    return {
      id: row.id,
      title: row.title,
      sessionType: row.session_type,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      fuelPresetId: row.fuel_preset_id,
      hydrationPresetId: row.hydration_preset_id,
      fuelCarbsG: row.fuel_carbs_g,
      fuelFluidMl: row.fuel_fluid_ml,
      fuelSodiumMg: row.fuel_sodium_mg,
      fuelCaffeineMg: row.fuel_caffeine_mg,
      hydrationCarbsG: row.hydration_carbs_g,
      hydrationFluidMl: row.hydration_fluid_ml,
      hydrationSodiumMg: row.hydration_sodium_mg,
      hydrationCaffeineMg: row.hydration_caffeine_mg,
      plan: {
        carbsG: row.plan_carbs_g_per_hour,
        fluidMl: row.plan_fluid_ml_per_hour,
        sodiumMg: row.plan_sodium_mg_per_hour,
        caffeineMg: row.plan_caffeine_mg_per_hour
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function presetFromRow(row) {
    return {
      id: row.id,
      carbsG: row.carbs_g,
      fluidMl: row.fluid_ml,
      sodiumMg: row.sodium_mg,
      caffeineMg: row.caffeine_mg,
      dirty: false,
      updatedAt: row.updated_at
    };
  }

  async function syncCloud({ refreshLogs = false } = {}) {
    if (cloudBusy) return;
    const cloud = window.fuelGuardCloud;
    const currentUser = cloud?.user;
    const client = cloud?.client;
    if (!currentUser?.id || !client?.from) return;
    cloudBusy = true;
    try {
      const training = state();
      const [presetResult, sessionResult] = await Promise.all([
        client.from(PRESETS_TABLE).select(PRESET_COLUMNS).eq("user_id", currentUser.id).eq("is_default", true),
        client.from(SESSIONS_TABLE).select(SESSION_COLUMNS).eq("user_id", currentUser.id).order("started_at", { ascending: false }).limit(20)
      ]);
      if (presetResult.error) throw presetResult.error;
      if (sessionResult.error) throw sessionResult.error;
      (presetResult.data || []).forEach(row => {
        const local = ensurePreset(row.event_type);
        if (!local.dirty) training.presets[row.event_type] = presetFromRow(row);
        else if (local.id !== row.id) {
          const oldId = local.id;
          local.id = row.id;
          training.sessions.forEach(session => {
            if (session[`${row.event_type}PresetId`] === oldId) session[`${row.event_type}PresetId`] = row.id;
          });
          if (training.activeSession?.[`${row.event_type}PresetId`] === oldId) training.activeSession[`${row.event_type}PresetId`] = row.id;
        }
      });
      ensurePreset("fuel");
      ensurePreset("hydration");
      const presetUpsert = await client.from(PRESETS_TABLE).upsert([
        presetRow("fuel", currentUser),
        presetRow("hydration", currentUser)
      ], { onConflict: "id" });
      if (presetUpsert.error) throw presetUpsert.error;
      training.presets.fuel.dirty = false;
      training.presets.hydration.dirty = false;

      const remoteSessions = (sessionResult.data || []).map(sessionFromRow);
      const remoteActive = remoteSessions.find(item => item.status === "active");
      if (remoteActive && training.activeSession && remoteActive.id !== training.activeSession.id) {
        training.lastError = "A different Training Mode session was already active in the cloud. That session was restored.";
        training.sessions = training.sessions.filter(item => item.status !== "active" || item.id === remoteActive.id);
        training.sessions.unshift(remoteActive);
        training.activeSession = remoteActive;
      }
      const reconciledById = new Map(remoteSessions.map(item => [item.id, item]));
      training.sessions.forEach(local => {
        const remote = reconciledById.get(local.id);
        const localUpdated = new Date(local.updatedAt || local.createdAt || 0).getTime();
        const remoteUpdated = new Date(remote?.updatedAt || remote?.createdAt || 0).getTime();
        if (!remote || localUpdated > remoteUpdated) reconciledById.set(local.id, local);
      });
      training.sessions = [...reconciledById.values()];
      if (remoteActive) {
        training.sessions = training.sessions.filter(item => item.status !== "active" || item.id === remoteActive.id);
        training.activeSession = remoteActive;
      } else {
        training.activeSession = training.sessions.find(item => item.status === "active") || null;
      }
      const localRows = training.sessions.map(item => sessionRow(item, currentUser));
      if (localRows.length) {
        const sessionUpsert = await client.from(SESSIONS_TABLE).upsert(localRows, { onConflict: "id" });
        if (sessionUpsert.error) throw sessionUpsert.error;
      }
      const refreshed = await client.from(SESSIONS_TABLE).select(SESSION_COLUMNS).eq("user_id", currentUser.id).order("started_at", { ascending: false }).limit(20);
      if (refreshed.error) throw refreshed.error;
      const cloudSessions = (refreshed.data || []).map(sessionFromRow);
      const localById = new Map(training.sessions.map(item => [item.id, item]));
      cloudSessions.forEach(item => localById.set(item.id, item));
      training.sessions = [...localById.values()].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
      training.activeSession = training.sessions.find(item => item.status === "active") || null;
      training.lastSyncedAt = new Date().toISOString();
      training.lastError = "";
      statusMessage = "Training Mode synced.";
      persist();
      if (refreshLogs) await window.fuelGuardCloud?.syncNow?.();
    } catch (error) {
      const training = state();
      training.lastError = error?.message || "Training Mode sync failed.";
      statusMessage = `Saved on this device. ${training.lastError}`;
      persist();
    } finally {
      cloudBusy = false;
      render();
    }
  }

  document.addEventListener("click", async event => {
    if (event.target.closest("[data-training-start]")) return startSession();
    if (event.target.closest("[data-training-end]")) return endSession();
    const logButton = event.target.closest("[data-training-log]");
    if (logButton) {
      const result = await window.recordTrainingModeEvent?.(logButton.dataset.trainingLog);
      statusMessage = result?.status === "error" ? "Training event saved here; cloud sync needs attention." : "Training event logged.";
      render();
      return;
    }
    if (event.target.closest("[data-training-refresh]")) {
      statusMessage = "Refreshing Training Mode…";
      render();
      return syncCloud({ refreshLogs: true });
    }
  });

  window.addEventListener("fuelguard:cloud-status", () => syncCloud());
  window.addEventListener("online", () => syncCloud({ refreshLogs: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncCloud({ refreshLogs: true });
  });
  document.addEventListener("DOMContentLoaded", render);
  requestAnimationFrame(render);

  window.FuelGuardTrainingMode = {
    render,
    syncCloud,
    contextForEvent,
    activeSession,
    _test: { sessionFromRow, presetFromRow, durationText }
  };
})();
