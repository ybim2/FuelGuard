// Dedicated endurance Training Mode for the canonical Athlete PWA.
(() => {
  const PRESETS_TABLE = "fuel_training_mode_presets";
  const SESSIONS_TABLE = "fuel_training_mode_sessions";
  const SESSION_COLUMNS = "id,user_id,title,session_type,status,started_at,ended_at,fuel_preset_id,hydration_preset_id,fuel_carbs_g,fuel_fluid_ml,fuel_sodium_mg,fuel_caffeine_mg,hydration_carbs_g,hydration_fluid_ml,hydration_sodium_mg,hydration_caffeine_mg,fuel_interval_minutes,hydration_interval_minutes,plan_source,estimated_duration_minutes,plan_carbs_g_per_hour,plan_fluid_ml_per_hour,plan_sodium_mg_per_hour,plan_caffeine_mg_per_hour,created_at,updated_at";
  const PRESET_COLUMNS = "id,user_id,event_type,name,carbs_g,fluid_ml,sodium_mg,caffeine_mg,intended_interval_minutes,is_default,updated_at";
  const FOREGROUND_SESSION_REFRESH_MS = 5000;
  const BONK_RISK_MINUTES = 90;
  const QUANTITIES = [
    { field: "carbsG", label: "Carbohydrate", short: "Carbs", unit: "g" },
    { field: "fluidMl", label: "Fluid", short: "Fluid", unit: "ml" },
    { field: "sodiumMg", label: "Sodium", short: "Sodium", unit: "mg" },
    { field: "caffeineMg", label: "Caffeine", short: "Caffeine", unit: "mg" }
  ];
  let cloudBusy = false;
  let foregroundReadBusy = false;
  let foregroundReadGeneration = 0;
  let foregroundSessionTimer = 0;
  let lastExternalEndNotification = "";
  let statusMessage = "";
  let durationTimer = 0;
  let completionMoment = null;
  let completionTimer = 0;

  function domain() {
    return window.FuelGuardDomain;
  }

  function state() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    if (!gap) return null;
    if (!gap.trainingMode || typeof gap.trainingMode !== "object" || Array.isArray(gap.trainingMode)) {
      gap.trainingMode = {
        presets: {
          fuel: { id: "", carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0, intervalMinutes: 30 },
          hydration: { id: "", carbsG: 0, fluidMl: 200, sodiumMg: 250, caffeineMg: 0, intervalMinutes: 20 }
        },
        plan: { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 },
        estimatedDurationMinutes: 60,
        bonkRisk: { sessionId: "", anchorAt: "", alertedForAnchor: "", active: false },
        activeSession: null,
        sessions: [],
        ownerUserId: "",
        lastSyncedAt: "",
        lastError: ""
      };
    }
    if (!Array.isArray(gap.trainingMode.sessions)) gap.trainingMode.sessions = [];
    if (!gap.trainingMode.bonkRisk || typeof gap.trainingMode.bonkRisk !== "object" || Array.isArray(gap.trainingMode.bonkRisk)) {
      gap.trainingMode.bonkRisk = { sessionId: "", anchorAt: "", alertedForAnchor: "", active: false };
    }
    if (typeof gap.trainingMode.ownerUserId !== "string") gap.trainingMode.ownerUserId = "";
    return gap.trainingMode;
  }

  function resetTrainingIdentity(userId) {
    const training = state();
    const nextUserId = String(userId || "");
    if (!training || !nextUserId) return;
    training.ownerUserId = nextUserId;
    training.presets = {
      fuel: { id: "", carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0, intervalMinutes: 30 },
      hydration: { id: "", carbsG: 0, fluidMl: 200, sodiumMg: 250, caffeineMg: 0, intervalMinutes: 20 }
    };
    training.plan = { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 };
    training.estimatedDurationMinutes = 60;
    training.bonkRisk = { sessionId: "", anchorAt: "", alertedForAnchor: "", active: false };
    training.activeSession = null;
    training.sessions = [];
    training.lastSyncedAt = "";
    training.lastError = "";
    foregroundReadGeneration += 1;
    lastExternalEndNotification = "";
    statusMessage = "";
    completionMoment = null;
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = 0;
    persist();
  }

  function claimTrainingIdentity(userId) {
    const training = state();
    const nextUserId = String(userId || "");
    if (!training || !nextUserId || training.ownerUserId === nextUserId) return "same";
    if (!training.ownerUserId) {
      training.ownerUserId = nextUserId;
      persist();
      return "claimed";
    }
    resetTrainingIdentity(nextUserId);
    return "switched";
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
      ? { carbsG: 30, fluidMl: 0, sodiumMg: 0, caffeineMg: 0, intervalMinutes: 30 }
      : { carbsG: 0, fluidMl: 200, sodiumMg: 250, caffeineMg: 0, intervalMinutes: 20 };
    training.presets[type] = { id: "", dirty: false, ...defaults, ...training.presets[type] };
    if (type === "fuel") {
      training.presets[type].fluidMl = 0;
      training.presets[type].sodiumMg = 0;
    } else {
      training.presets[type].carbsG = 0;
    }
    if (!training.presets[type].id) training.presets[type].id = uuid();
    return training.presets[type];
  }

  function normalizeCanonicalCaffeine() {
    const training = state();
    const fuel = training?.presets?.fuel;
    const hydration = training?.presets?.hydration;
    if (!fuel || !hydration) return;
    const legacyFuelCaffeine = Math.max(0, Number(fuel.caffeineMg) || 0);
    if (legacyFuelCaffeine > 0 && !(Number(hydration.caffeineMg) > 0)) {
      hydration.caffeineMg = legacyFuelCaffeine;
      hydration.dirty = true;
    }
    if (legacyFuelCaffeine > 0) fuel.dirty = true;
    fuel.caffeineMg = 0;
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

  function bonkRiskModel({ session, logRows = [], now = new Date(), thresholdMinutes = BONK_RISK_MINUTES } = {}) {
    const startedAt = domain()?.parseDate?.(session?.startedAt || session?.started_at);
    const reference = domain()?.parseDate?.(now) || new Date();
    if (!session?.id || !startedAt || reference < startedAt) return { active: false, sessionId: "", anchorAt: "", elapsedMinutes: 0 };
    const latestFuel = (Array.isArray(logRows) ? logRows : [])
      .map(log => ({ log, at: domain()?.logDate?.(log) }))
      .filter(item => item.at && item.at >= startedAt && item.at <= reference)
      .filter(item => domain()?.isFuelLog?.(item.log))
      .filter(item => String(domain()?.trainingLogSessionId?.(item.log) || "") === String(session.id))
      .sort((left, right) => left.at - right.at)
      .at(-1);
    const anchor = latestFuel?.at || startedAt;
    const elapsedMilliseconds = Math.max(0, reference - anchor);
    const elapsedMinutes = Math.floor(elapsedMilliseconds / 60000);
    return {
      active: elapsedMilliseconds > Number(thresholdMinutes) * 60000,
      sessionId: String(session.id),
      anchorAt: anchor.toISOString(),
      elapsedMinutes,
      hasFuelLog: Boolean(latestFuel)
    };
  }

  function syncBonkRisk(session, now = new Date()) {
    const training = state();
    if (!training) return { active: false, changed: false, newlyTriggered: false };
    const previous = { ...training.bonkRisk };
    if (!session) {
      training.bonkRisk = { sessionId: "", anchorAt: "", alertedForAnchor: "", active: false };
    } else {
      const model = bonkRiskModel({ session, logRows: logs(), now });
      const sameSession = previous.sessionId === model.sessionId;
      const sameAnchor = sameSession && previous.anchorAt === model.anchorAt;
      const newlyTriggered = model.active && (!sameAnchor || previous.alertedForAnchor !== model.anchorAt);
      training.bonkRisk = {
        sessionId: model.sessionId,
        anchorAt: model.anchorAt,
        alertedForAnchor: newlyTriggered ? model.anchorAt : sameAnchor ? previous.alertedForAnchor : "",
        active: model.active
      };
      const changed = JSON.stringify(previous) !== JSON.stringify(training.bonkRisk);
      if (changed) persist();
      return { ...model, changed, newlyTriggered };
    }
    const changed = JSON.stringify(previous) !== JSON.stringify(training.bonkRisk);
    if (changed) persist();
    return { active: false, changed, newlyTriggered: false };
  }

  function bonkRiskMarkup(risk) {
    if (!risk?.active) return "";
    return `<section class="training-mode-bonk-risk" role="${risk.newlyTriggered ? "alert" : "status"}" aria-live="${risk.newlyTriggered ? "assertive" : "off"}">
      <div aria-hidden="true">!</div><span><strong>Bonk Risk</strong><small>You’ve been training for more than 90 minutes without logging fuel.</small></span>
    </section>`;
  }

  function quantityInput(type, item, values = preset(type), label = item.short) {
    return `
      <label>${escape(label)} <span>${item.unit}</span>
        <input type="number" min="0" max="${domain()?.TRAINING_QUANTITY_LIMITS?.[item.field] || 10000}" step="1" inputmode="numeric" value="${Number(values[item.field] || 0)}" data-training-preset="${type}" data-training-field="${item.field}">
      </label>
    `;
  }

  function actionInputs(type, labels = {}) {
    const fields = type === "fuel" ? ["carbsG"] : ["fluidMl", "sodiumMg", "caffeineMg"];
    return fields.map(field => quantityInput(type, QUANTITIES.find(item => item.field === field), preset(type), labels[field])).join("");
  }

  function intervalInput(type, value) {
    return `<label>${type === "fuel" ? "Fuel" : "Hydrate"} every <span>minutes</span>
      <input type="number" min="5" max="360" step="5" inputmode="numeric" value="${Number(value || (type === "fuel" ? 30 : 20))}" data-training-interval="${type}">
    </label>`;
  }

  function scheduledTeamSessionsMarkup() {
    const now = new Date();
    const sessions = (Array.isArray(window.fuelGuardCloud?.teamSessions) ? window.fuelGuardCloud.teamSessions : [])
      .filter(session => session.status === "scheduled" && new Date(session.ends_at) >= now)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
      .slice(0, 3);
    if (!sessions.length) return "";
    return `
      <section class="training-mode-section training-mode-team-schedule" aria-label="Upcoming team sessions">
        <div class="training-mode-heading"><div><span>Shared team context</span><h2>Upcoming sessions</h2></div><small>Scheduled by your coach; logging stays unchanged.</small></div>
        <div class="training-mode-team-session-list">
          ${sessions.map(session => {
            const zone = session.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
            return `<article><div><span>${escape(session.team_name || "Team")}</span><strong>${escape(session.session_name || String(session.session_type || "Session").replace(/^./, value => value.toUpperCase()))}</strong></div><time>${escape(session.session_date)} · ${escape(domain().formatClockInTimeZone(session.starts_at, zone))}–${escape(domain().formatClockInTimeZone(session.ends_at, zone))}</time>${session.location ? `<small>${escape(session.location)}</small>` : ""}</article>`;
          }).join("")}
        </div>
      </section>
    `;
  }

  function estimatedDurationMinutes({ readForm = false } = {}) {
    const fallback = Math.min(1440, Math.max(15, Number(state()?.estimatedDurationMinutes) || 60));
    if (!readForm) return fallback;
    const presetValue = document.getElementById("trainingEstimatedDuration")?.value || "60";
    const raw = presetValue === "custom" ? readNumber("#trainingEstimatedDurationCustom") : Number(presetValue);
    return Math.min(1440, Math.max(15, raw || fallback));
  }

  function estimatedDurationMarkup() {
    const minutes = estimatedDurationMinutes();
    const presets = new Set([30, 60, 90, 120, 180]);
    const selected = presets.has(minutes) ? String(minutes) : "custom";
    return `
      <div class="training-mode-duration-fields">
        <label>Expected duration <span>planned, not actual</span>
          <select id="trainingEstimatedDuration">
            <option value="30"${selected === "30" ? " selected" : ""}>30m</option>
            <option value="60"${selected === "60" ? " selected" : ""}>1h</option>
            <option value="90"${selected === "90" ? " selected" : ""}>1h 30m</option>
            <option value="120"${selected === "120" ? " selected" : ""}>2h</option>
            <option value="180"${selected === "180" ? " selected" : ""}>3h</option>
            <option value="custom"${selected === "custom" ? " selected" : ""}>Custom</option>
          </select>
        </label>
        <label data-training-custom-duration${selected === "custom" ? "" : " hidden"}>Custom duration <span>minutes</span>
          <input id="trainingEstimatedDurationCustom" type="number" min="15" max="1440" step="5" inputmode="numeric" value="${minutes}">
        </label>
      </div>
    `;
  }

  function setupPlan({ readForm = false } = {}) {
    const training = state();
    const fuel = readForm ? collectPreset("fuel") : ensurePreset("fuel");
    const hydration = readForm ? collectPreset("hydration") : ensurePreset("hydration");
    const fuelIntervalMinutes = readForm ? readNumber('[data-training-interval="fuel"]') : fuel.intervalMinutes;
    const hydrationIntervalMinutes = readForm ? readNumber('[data-training-interval="hydration"]') : hydration.intervalMinutes;
    return domain().trainingHourlyPlan({
      fuelPreset: fuel,
      hydrationPreset: hydration,
      fuelIntervalMinutes,
      hydrationIntervalMinutes
    });
  }

  function derivedPlanMarkup(plan) {
    const plannedSession = domain().trainingPlannedSessionTotals(plan.effective, estimatedDurationMinutes({ readForm: Boolean(document.getElementById("trainingEstimatedDuration")) }));
    const planned = plannedSession.totals;
    return `
      <div class="training-mode-derived-plan-heading">
        <strong>Planned hourly guide</strong>
        <span>Fuel every ${plan.intervals.fuel} min · Hydrate every ${plan.intervals.hydration} min</span>
      </div>
      <div class="training-mode-derived-plan-grid">
        ${QUANTITIES.map(item => `<span>${escape(item.short)}<strong>${domain().wholeMeasurement(plan.effective[item.field], `${item.unit}/h`)}</strong></span>`).join("")}
      </div>
      <div class="training-mode-session-plan">
        <span>Planned for ${escape(domain().duration(plannedSession.estimatedDurationMinutes))}</span>
        <strong>Approx. session fuel: ${domain().wholeMeasurement(planned.carbsG, "g")} carbs</strong>
        <small>${domain().wholeMeasurement(planned.fluidMl, "ml")} fluid · ${domain().wholeMeasurement(planned.sodiumMg, "mg")} sodium${planned.caffeineMg ? ` · ${domain().wholeMeasurement(planned.caffeineMg, "mg")} caffeine` : ""}</small>
      </div>
    `;
  }

  function renderDerivedPlanPreview() {
    const target = document.getElementById("trainingDerivedPlan");
    if (!target) return;
    target.innerHTML = derivedPlanMarkup(setupPlan({ readForm: true }));
    const custom = document.querySelector("[data-training-custom-duration]");
    if (custom) custom.hidden = document.getElementById("trainingEstimatedDuration")?.value !== "custom";
  }

  function persistEstimatedDuration() {
    const training = state();
    if (!training) return;
    training.estimatedDurationMinutes = estimatedDurationMinutes({ readForm: true });
    persist();
    renderDerivedPlanPreview();
  }

  function setupMarkup() {
    ensurePreset("fuel");
    ensurePreset("hydration");
    normalizeCanonicalCaffeine();
    const training = state();
    return `
      <section class="training-mode-hero setup">
        <p>Endurance session</p>
        <h1>Training Mode</h1>
        <span>Configure once, then log Fuel and Hydrate with one tap during training.</span>
      </section>
      ${scheduledTeamSessionsMarkup()}
      <section class="training-mode-section training-mode-session-setup">
        <div class="training-mode-heading">
          <div><span>Session</span><h2>Set up your training</h2></div>
          <small>Daily Mode remains quantity-free.</small>
        </div>
        <div class="training-mode-session-fields">
          <label>Session name<input id="trainingModeTitle" type="text" maxlength="120" value="Training session" placeholder="Long ride"></label>
          <label>Activity<select id="trainingModeType">
            <option value="bike">Bike</option><option value="run">Run</option><option value="swim">Swim</option>
            <option value="brick">Brick</option><option value="triathlon">Triathlon</option><option value="race">Race</option><option value="other">Other</option>
          </select></label>
        </div>
        ${estimatedDurationMarkup()}
      </section>
      <section class="training-mode-section training-mode-fuel-card">
        <div class="training-mode-heading"><div><span>One-tap presets</span><h2>Fuel</h2></div><small>Garmin Fuel records carbs. Garmin Hydrate records fluid, sodium and caffeine.</small></div>
        <div class="training-mode-action-inputs fuel-plan">
          ${actionInputs("fuel", { carbsG: "Carbs (Fuel)" })}
          ${actionInputs("hydration", { fluidMl: "Fluid (Hydrate)", sodiumMg: "Sodium (Hydrate)", caffeineMg: "Caffeine (Hydrate)" })}
        </div>
      </section>
      <section class="training-mode-section training-mode-strategy">
        <div class="training-mode-heading"><div><span>Timing strategy</span><h2>How often do you intend to fuel?</h2></div><small>Fuel Guard derives your hourly plan.</small></div>
        <div class="training-mode-interval-grid">${intervalInput("fuel", training.presets.fuel.intervalMinutes)}${intervalInput("hydration", training.presets.hydration.intervalMinutes)}</div>
        <div id="trainingDerivedPlan" class="training-mode-derived-plan">${derivedPlanMarkup(setupPlan())}</div>
      </section>
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
    return domain().wholeMeasurement(value, unit);
  }

  function compactNumber(value, decimals = 0) {
    const rounded = Number(Number(value || 0).toFixed(decimals));
    return Number.isFinite(rounded) ? String(rounded) : "0";
  }

  function trainingValue(value, item, { perHour = false } = {}) {
    if (!Number.isFinite(Number(value))) return "";
    const amount = Math.max(0, Number(value));
    let display = "";
    if (item.field === "fluidMl" && amount >= 1000) {
      display = `${compactNumber(amount / 1000, 1)}L`;
    } else if (item.field === "carbsG" && amount >= 1000) {
      display = `${compactNumber(amount / 1000, 1)}kg`;
    } else {
      display = `${compactNumber(amount, amount < 10 && amount % 1 ? 1 : 0)}${item.unit}`;
    }
    return `${display}${perHour ? "/h" : ""}`;
  }

  function sessionSummary(session, now = new Date()) {
    return domain().trainingSessionIntakeSummary({ session, logs: logs(), now });
  }

  function completedSessionMetrics(session) {
    if (typeof domain()?.trainingCompletionSummary === "function") {
      return domain().trainingCompletionSummary({
        session,
        logs: logs(),
        now: new Date(session.endedAt || session.ended_at)
      });
    }
    const startedAt = new Date(session.startedAt || session.started_at || 0);
    const endedAt = new Date(session.endedAt || session.ended_at || Date.now());
    return {
      durationSeconds: Number.isNaN(startedAt.getTime()) ? 0 : Math.max(0, Math.round((endedAt - startedAt) / 1000)),
      fuelEventCount: 0,
      hydrationEventCount: 0,
      totals: { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 }
    };
  }

  function trainingCompletionMarkup(moment) {
    const summary = moment.summary;
    const eventCopy = `${summary.fuelEventCount} fuel log${summary.fuelEventCount === 1 ? "" : "s"} · ${summary.hydrationEventCount} hydration log${summary.hydrationEventCount === 1 ? "" : "s"}`;
    const totals = [
      ["Carbohydrate", summary.totals.carbsG, "g"],
      ["Fluid", summary.totals.fluidMl, "ml"],
      ["Sodium", summary.totals.sodiumMg, "mg"],
      ["Caffeine", summary.totals.caffeineMg, "mg"]
    ].filter(([, value]) => Number(value) > 0);
    return `
      <section class="training-completion-moment" role="status" aria-live="assertive">
        <div class="training-completion-mark" aria-hidden="true">✓</div>
        <span>${moment.source === "garmin" ? "Synced from Garmin" : "Session saved"}</span>
        <h1>Training complete</h1>
        <strong>${escape(domain().duration(Math.round(summary.durationSeconds / 60)))}</strong>
        <p>${escape(eventCopy)}</p>
        ${totals.length ? `<div class="training-completion-totals">${totals.map(([label, value, unit]) => `<span><small>${escape(label)}</small><b>${escape(`${Math.round(Number(value))}${unit}`)}</b></span>`).join("")}</div>` : ""}
        <button class="primary" type="button" data-training-completion-dismiss>Continue</button>
      </section>
    `;
  }

  function showTrainingCompletion(session, { source = "athlete" } = {}) {
    if (!session?.id) return;
    completionMoment = { sessionId: session.id, session: { ...session }, source, summary: completedSessionMetrics(session) };
    if (typeof switchScreen === "function") switchScreen("training");
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = typeof setTimeout === "function" ? setTimeout(() => {
      dismissTrainingCompletion();
    }, 5500) : 0;
  }

  function dismissTrainingCompletion() {
    const completed = completionMoment?.session || null;
    completionMoment = null;
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = 0;
    render();
    if (completed) window.dispatchEvent(new CustomEvent("fuelguard:training-completion-dismissed", { detail: { session: completed } }));
  }

  function intakeCards(summary, session) {
    return QUANTITIES.map(item => {
      const total = summary.totals[item.field];
      const plannedRate = Math.max(0, Number(session.plan?.[item.field] || 0));
      return `
        <article class="training-mode-intake-card">
          <span>${escape(item.label)}</span>
          <strong>${unitValue(total, item.unit)}</strong>
          <small>${plannedRate ? `${unitValue(plannedRate, item.unit)}/h planned` : "No planned intake"}</small>
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

  function activeMarkup(session, risk = syncBonkRisk(session)) {
    const summary = sessionSummary(session);
    return `
      <section class="training-mode-hero active" aria-live="polite">
        <p>TRAINING · <span data-training-duration>${durationText(summary.durationSeconds)}</span></p>
        <h1>${escape(session.title)}</h1>
        <span>${escape(String(session.sessionType || "training").replace(/_/g, " "))} · Training Mode active</span>
      </section>
      ${scheduledTeamSessionsMarkup()}
      ${bonkRiskMarkup(risk)}
      ${eventTimeline(session, summary)}
      <section class="training-mode-live-actions" aria-label="Training quick actions">
        <button class="training-mode-action fuel" type="button" data-training-log="fuel"><strong>Fuel</strong><span>${presetSummary(session, "fuel")}</span></button>
        <button class="training-mode-action hydration" type="button" data-training-log="hydration"><strong>Hydrate</strong><span>${presetSummary(session, "hydration")}</span></button>
      </section>
      ${activeInsightsMarkup(session)}
      <section class="training-mode-section">
        <div class="training-mode-heading"><div><span>Session stats</span><h2>Recorded intake</h2></div><button class="secondary" type="button" data-training-refresh>Refresh</button></div>
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
    const fields = type === "fuel" ? ["carbsG"] : ["fluidMl", "sodiumMg", "caffeineMg"];
    return fields.map(field => QUANTITIES.find(item => item.field === field)).filter(item => context[item.field] > 0).map(item => `${unitValue(context[item.field], item.unit)} ${item.short.toLowerCase()}`).join(" · ");
  }

  function activeInsightsMarkup(session) {
    const result = domain().activeTrainingSessionInsights({ session, logs: logs(), now: new Date() });
    return `
      <section class="training-mode-section training-mode-live-insights" aria-label="Useful Training Mode insights">
        <div class="training-mode-heading"><div><span>Useful now</span><h2>Live session insights</h2></div><small>Interpretation from recorded session evidence.</small></div>
        <div class="training-mode-live-insight-grid">
          ${result.insights.map(insight => `<article class="${escape(insight.tone || "neutral")}"><span>${escape(insight.label)}</span><strong>${escape(insight.value)}</strong><small>${escape(insight.detail)}</small></article>`).join("")}
        </div>
      </section>
    `;
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
    return `<div class="training-mode-review-context"><span>Before session <strong>${context.hasPreviousFuel ? `${domain().duration(context.preFuelGapMinutes)} before session` : "No prior Fuel recorded"}</strong></span><span>After session <strong>${context.hasPostFuel ? `${domain().duration(context.postFuelGapMinutes)} to first recorded Fuel` : "No post-training Fuel has been recorded yet"}</strong></span></div>`;
  }

  function completedSessionsMarkup() {
    const sessions = (state()?.sessions || []).filter(item => item.status === "completed" && item.endedAt).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 6);
    if (!sessions.length) return "";
    const recent = domain().completedTrainingSessionAverages({ sessions, logs: logs(), limit: 6 });
    const averageItems = [
      { label: "Average carbs per session", value: Number.isFinite(recent.averages.carbsGPerSession) ? trainingValue(recent.averages.carbsGPerSession, QUANTITIES[0]) : "" },
      { label: "Average carbs/hour per session", value: Number.isFinite(recent.averages.carbsGPerHour) ? trainingValue(recent.averages.carbsGPerHour, QUANTITIES[0], { perHour: true }) : "" },
      { label: "Average fluid per session", value: Number.isFinite(recent.averages.fluidMlPerSession) ? trainingValue(recent.averages.fluidMlPerSession, QUANTITIES[1]) : "" },
      { label: "Average session duration", value: Number.isFinite(recent.averages.durationSeconds) ? domain().duration(Math.round(recent.averages.durationSeconds / 60)) : "" }
    ].filter(item => item.value);
    return `
      ${averageItems.length ? `<section class="training-mode-section training-mode-recent-summary">
        <div class="training-mode-heading"><div><span>Completed sessions</span><h2>Recent Training Summary</h2></div><small>Simple averages from valid completed sessions only.</small></div>
        <div class="training-mode-summary-grid">${averageItems.map(item => `<article><span>${escape(item.label)}</span><strong>${escape(item.value)}</strong></article>`).join("")}</div>
      </section>` : ""}
      <section class="training-mode-section training-mode-review-list">
        <div class="training-mode-heading"><div><span>History</span><h2>Recent Training Mode sessions</h2></div></div>
        ${sessions.map(session => {
          const summary = completedSessionMetrics(session);
          const rateNote = summary.coverageMessage || "Actual rates require at least 15 minutes and a logged Training event.";
          const startedAt = new Date(session.startedAt);
          const endedAt = new Date(session.endedAt);
          const actualCarbs = trainingValue(summary.totals.carbsG, QUANTITIES[0]);
          const plannedCarbs = summary.planned ? trainingValue(summary.planned.totals.carbsG, QUANTITIES[0]) : "Not set";
          return `<article class="training-mode-review-card">
            <div class="training-mode-review-copy"><span>${startedAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span><h3>${escape(session.title)}</h3><small class="training-mode-review-time">${escape(domain().formatClock(startedAt))}–${escape(domain().formatClock(endedAt))}</small><small class="training-mode-review-actual">Actual ${escape(actualCarbs)} <b aria-hidden="true">•</b> Planned ${escape(plannedCarbs)}</small><small class="training-mode-review-events">${summary.fuelEventCount} Fuel <b aria-hidden="true">•</b> ${summary.hydrationEventCount} Hydration</small>${summary.validLoggedIntake ? "" : `<small class="training-mode-rate-note">${escape(rateNote)}</small>`}</div>
            <div class="training-mode-review-totals">${QUANTITIES.map(item => {
              const plannedRate = Math.max(0, Number(session.plan?.[item.field] || 0));
              const actualRate = summary.actualPerHour[item.field];
              return `<span>${escape(item.short)}<strong>${escape(trainingValue(summary.totals[item.field], item))} logged</strong>${Number.isFinite(actualRate) ? `<small>Actual rate<strong>${escape(trainingValue(actualRate, item, { perHour: true }))}</strong></small>` : ""}${plannedRate > 0 ? `<small>Planned rate<strong>${escape(trainingValue(plannedRate, item, { perHour: true }))}</strong></small>` : ""}</span>`;
            }).join("")}</div>
            ${prePostMarkup(session)}
          </article>`;
        }).join("")}
      </section>
    `;
  }

  function render({ bonkRisk = null } = {}) {
    const target = document.getElementById("trainingModeSurface");
    if (!target || !domain()) return;
    const active = activeSession();
    const risk = bonkRisk || syncBonkRisk(active);
    target.innerHTML = active ? activeMarkup(active, risk) : completionMoment ? trainingCompletionMarkup(completionMoment) : setupMarkup();
    if (durationTimer) clearInterval(durationTimer);
    durationTimer = active ? setInterval(() => {
      const duration = document.querySelector("[data-training-duration]");
      if (duration) duration.textContent = durationText((Date.now() - new Date(active.startedAt)) / 1000);
      const latestRisk = syncBonkRisk(active);
      if (latestRisk.newlyTriggered || latestRisk.active !== risk.active || latestRisk.anchorAt !== risk.anchorAt) render({ bonkRisk: latestRisk });
    }, 1000) : 0;
  }

  function readNumber(selector) {
    const value = Number(document.querySelector(selector)?.value || 0);
    return Number.isFinite(value) ? Math.round(value) : 0;
  }

  function collectPreset(type) {
    const next = { ...ensurePreset(type), dirty: true };
    QUANTITIES.forEach(item => { next[item.field] = readNumber(`[data-training-preset="${type}"][data-training-field="${item.field}"]`); });
    next.intervalMinutes = Math.min(360, Math.max(5, readNumber(`[data-training-interval="${type}"]`) || (type === "fuel" ? 30 : 20)));
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
    completionMoment = null;
    if (completionTimer) clearTimeout(completionTimer);
    completionTimer = 0;
    training.presets.fuel = { ...fuel, ...fuelValidation.preset };
    training.presets.hydration = { ...hydration, ...hydrationValidation.preset };
    const planned = setupPlan({ readForm: true });
    training.plan = { ...planned.effective };
    training.estimatedDurationMinutes = estimatedDurationMinutes({ readForm: true });
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
      fuelIntervalMinutes: planned.intervals.fuel,
      hydrationIntervalMinutes: planned.intervals.hydration,
      planSource: "derived",
      estimatedDurationMinutes: training.estimatedDurationMinutes,
      plan: { ...planned.effective },
      createdAt: startedAt,
      updatedAt: startedAt,
      dirty: true
    };
    training.activeSession = session;
    training.bonkRisk = { sessionId: session.id, anchorAt: startedAt, alertedForAnchor: "", active: false };
    training.sessions = [session, ...training.sessions.filter(item => item.id !== session.id)];
    statusMessage = "Training Mode active.";
    persist();
    render();
    window.dispatchEvent(new CustomEvent("fuelguard:training-session-started", { detail: { session: { ...session } } }));
    const syncResult = await syncCloud();
    if (syncResult?.status === "synced") {
      window.dispatchEvent(new CustomEvent("fuelguard:training-session-synced", {
        detail: { sessionId: session.id, phase: "started", source: "athlete" }
      }));
    } else if (syncResult?.status === "error") {
      void window.FuelGuardProductAnalytics?.trackFailure?.("training_start", syncResult.error);
    }
  }

  async function endSession() {
    const training = state();
    const active = activeSession();
    if (!active || !window.confirm("End Training Mode and save this session summary?")) return;
    const endedAt = new Date().toISOString();
    active.status = "completed";
    active.endedAt = endedAt;
    active.updatedAt = endedAt;
    active.dirty = true;
    training.sessions = training.sessions.map(item => item.id === active.id ? { ...active } : item);
    training.activeSession = null;
    training.bonkRisk = { sessionId: "", anchorAt: "", alertedForAnchor: "", active: false };
    statusMessage = "Training complete. Session summary saved.";
    showTrainingCompletion(active);
    persist();
    render();
    const syncResult = await syncCloud();
    if (syncResult?.status === "synced") {
      window.dispatchEvent(new CustomEvent("fuelguard:training-session-synced", {
        detail: { sessionId: active.id, phase: "completed", source: "athlete" }
      }));
    } else if (syncResult?.status === "error") {
      void window.FuelGuardProductAnalytics?.trackFailure?.("training_complete", syncResult.error);
    }
    window.dispatchEvent(new CustomEvent("fuelguard:training-session-ended", { detail: { session: { ...active }, deferNavigation: true } }));
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
      intended_interval_minutes: value.intervalMinutes,
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
      fuel_interval_minutes: session.fuelIntervalMinutes || 30,
      hydration_interval_minutes: session.hydrationIntervalMinutes || 20,
      plan_source: "derived",
      estimated_duration_minutes: session.estimatedDurationMinutes || 60,
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
      fuelIntervalMinutes: row.fuel_interval_minutes || 30,
      hydrationIntervalMinutes: row.hydration_interval_minutes || 20,
      planSource: row.plan_source || "derived",
      estimatedDurationMinutes: row.estimated_duration_minutes || 60,
      plan: {
        carbsG: row.plan_carbs_g_per_hour,
        fluidMl: row.plan_fluid_ml_per_hour,
        sodiumMg: row.plan_sodium_mg_per_hour,
        caffeineMg: row.plan_caffeine_mg_per_hour
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dirty: false
    };
  }

  function sessionIsDirty(session) {
    return Boolean(session) && session.dirty !== false;
  }

  function sessionFingerprint(session) {
    if (!session) return "";
    return [session.id, session.status, session.startedAt, session.endedAt || "", session.updatedAt || ""].join("|");
  }

  function reconcileCanonicalSessions(localSessions = [], remoteSessions = []) {
    const local = Array.isArray(localSessions) ? localSessions.filter(item => item?.id) : [];
    const remote = Array.isArray(remoteSessions) ? remoteSessions.filter(item => item?.id).map(item => ({ ...item, dirty: false })) : [];
    const remoteActive = remote.find(item => item.status === "active" && !item.endedAt) || null;
    const byId = new Map(remote.map(item => [item.id, item]));
    let conflictingLocalActive = false;

    local.forEach(item => {
      if (remoteActive && item.status === "active" && !item.endedAt && item.id !== remoteActive.id) {
        conflictingLocalActive = true;
        return;
      }
      const canonical = byId.get(item.id);
      if (!canonical) {
        byId.set(item.id, item);
      } else if (sessionIsDirty(item)) {
        const localUpdated = new Date(item.updatedAt || item.createdAt || 0).getTime();
        const canonicalUpdated = new Date(canonical.updatedAt || canonical.createdAt || 0).getTime();
        if (localUpdated > canonicalUpdated) byId.set(item.id, item);
      }
    });

    let sessions = [...byId.values()].sort((left, right) => new Date(right.startedAt || 0) - new Date(left.startedAt || 0));
    let activeSession = null;
    if (remoteActive) {
      const reconciledRemoteActive = byId.get(remoteActive.id);
      if (reconciledRemoteActive?.status === "active" && !reconciledRemoteActive.endedAt) activeSession = reconciledRemoteActive;
    }
    if (!activeSession) activeSession = sessions.find(item => item.status === "active" && !item.endedAt) || null;
    if (activeSession) sessions = sessions.filter(item => item.status !== "active" || item.id === activeSession.id);

    return { sessions, activeSession, remoteActive, conflictingLocalActive };
  }

  function cloudIdentityMatches(userId, client) {
    return window.fuelGuardCloud?.user?.id === userId && window.fuelGuardCloud?.client === client;
  }

  function applyCanonicalSessions(remoteSessions, { announceExternal = false } = {}) {
    const training = state();
    if (!training) return { changed: false, transition: "none" };
    const previousActive = activeSession();
    const before = sessionFingerprint(previousActive);
    const reconciled = reconcileCanonicalSessions(training.sessions, remoteSessions);
    training.sessions = reconciled.sessions;
    training.activeSession = reconciled.activeSession;
    const after = sessionFingerprint(training.activeSession);
    let transition = "none";

    if (!previousActive && training.activeSession) {
      transition = "started";
      if (announceExternal) statusMessage = "Training Mode started from Garmin.";
      if (announceExternal) {
        window.dispatchEvent(new CustomEvent("fuelguard:training-session-started", { detail: { session: { ...training.activeSession }, source: "garmin" } }));
        window.dispatchEvent(new CustomEvent("fuelguard:training-session-synced", {
          detail: { sessionId: training.activeSession.id, phase: "started", source: "garmin" }
        }));
      }
    } else if (previousActive && (!training.activeSession || training.activeSession.id !== previousActive.id)) {
      transition = "ended";
      const completed = training.sessions.find(item => item.id === previousActive.id && item.status === "completed") || { ...previousActive, status: "completed" };
      if (announceExternal) statusMessage = training.activeSession ? "Training Mode changed from Garmin." : "Training Mode ended from Garmin.";
      if (announceExternal && lastExternalEndNotification !== previousActive.id) {
        lastExternalEndNotification = previousActive.id;
        showTrainingCompletion(completed, { source: "garmin" });
        window.dispatchEvent(new CustomEvent("fuelguard:training-session-synced", {
          detail: { sessionId: completed.id, phase: "completed", source: "garmin" }
        }));
        window.dispatchEvent(new CustomEvent("fuelguard:training-session-ended", { detail: { session: { ...completed }, deferNavigation: true } }));
      }
    }

    return { changed: before !== after || reconciled.conflictingLocalActive, transition, ...reconciled };
  }

  function presetFromRow(row) {
    return {
      id: row.id,
      carbsG: row.carbs_g,
      fluidMl: row.fluid_ml,
      sodiumMg: row.sodium_mg,
      caffeineMg: row.caffeine_mg,
      intervalMinutes: row.intended_interval_minutes || (row.event_type === "fuel" ? 30 : 20),
      dirty: false,
      updatedAt: row.updated_at
    };
  }

  async function syncCloud({ refreshLogs = false } = {}) {
    if (cloudBusy) return { status: "busy" };
    const cloud = window.fuelGuardCloud;
    const currentUser = cloud?.user;
    const client = cloud?.client;
    if (!currentUser?.id || !client?.from) return { status: "pending" };
    const identityClaim = claimTrainingIdentity(currentUser.id);
    cloudBusy = true;
    try {
      const training = state();
      const [presetResult, sessionResult] = await Promise.all([
        client.from(PRESETS_TABLE).select(PRESET_COLUMNS).eq("user_id", currentUser.id).eq("is_default", true),
        client.from(SESSIONS_TABLE).select(SESSION_COLUMNS).eq("user_id", currentUser.id).order("started_at", { ascending: false }).limit(20)
      ]);
      if (!cloudIdentityMatches(currentUser.id, client)) return { status: "stale" };
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
      normalizeCanonicalCaffeine();
      const presetUpsert = await client.from(PRESETS_TABLE).upsert([
        presetRow("fuel", currentUser),
        presetRow("hydration", currentUser)
      ], { onConflict: "id" });
      if (!cloudIdentityMatches(currentUser.id, client)) return { status: "stale" };
      if (presetUpsert.error) throw presetUpsert.error;
      training.presets.fuel.dirty = false;
      training.presets.hydration.dirty = false;

      const remoteSessions = (sessionResult.data || []).map(sessionFromRow);
      const reconciled = reconcileCanonicalSessions(training.sessions, remoteSessions);
      if (reconciled.conflictingLocalActive) {
        training.lastError = "A different Training Mode session was already active in the cloud. That session was restored.";
      }
      training.sessions = reconciled.sessions;
      training.activeSession = reconciled.activeSession;
      const dirtySessions = training.sessions.filter(sessionIsDirty);
      const localRows = dirtySessions.map(item => sessionRow(item, currentUser));
      if (localRows.length) {
        const sessionUpsert = await client.from(SESSIONS_TABLE).upsert(localRows, { onConflict: "id" });
        if (!cloudIdentityMatches(currentUser.id, client)) return { status: "stale" };
        if (sessionUpsert.error) throw sessionUpsert.error;
        const persistedIds = new Set(dirtySessions.map(item => item.id));
        training.sessions.forEach(item => { if (persistedIds.has(item.id)) item.dirty = false; });
        if (training.activeSession && persistedIds.has(training.activeSession.id)) training.activeSession.dirty = false;
      }
      const refreshed = await client.from(SESSIONS_TABLE).select(SESSION_COLUMNS).eq("user_id", currentUser.id).order("started_at", { ascending: false }).limit(20);
      if (!cloudIdentityMatches(currentUser.id, client)) return { status: "stale" };
      if (refreshed.error) throw refreshed.error;
      const cloudSessions = (refreshed.data || []).map(sessionFromRow);
      const finalReconciliation = reconcileCanonicalSessions(training.sessions, cloudSessions);
      training.sessions = finalReconciliation.sessions;
      training.activeSession = finalReconciliation.activeSession;
      training.lastSyncedAt = new Date().toISOString();
      training.lastError = "";
      statusMessage = "Training Mode synced.";
      persist();
      if (refreshLogs) await window.fuelGuardCloud?.syncNow?.();
      return { status: "synced" };
    } catch (error) {
      if (identityClaim === "claimed" && /row-level security policy/i.test(error?.message || "")) {
        resetTrainingIdentity(currentUser.id);
        cloudBusy = false;
        return await syncCloud({ refreshLogs });
      }
      const training = state();
      training.lastError = error?.message || "Training Mode sync failed.";
      statusMessage = `Saved on this device. ${training.lastError}`;
      persist();
      return { status: "error", error };
    } finally {
      cloudBusy = false;
      render();
    }
  }

  function foregroundRefreshEligible() {
    return !document.hidden
      && navigator.onLine !== false
      && Boolean(window.fuelGuardCloud?.user?.id)
      && Boolean(window.fuelGuardCloud?.client?.from);
  }

  async function refreshCanonicalSessions({ refreshLogs = false } = {}) {
    if (cloudBusy || foregroundReadBusy || !foregroundRefreshEligible()) return { status: "skipped" };
    const currentUser = window.fuelGuardCloud.user;
    const client = window.fuelGuardCloud.client;
    claimTrainingIdentity(currentUser.id);
    const generation = ++foregroundReadGeneration;
    foregroundReadBusy = true;
    try {
      const result = await client.from(SESSIONS_TABLE).select(SESSION_COLUMNS).eq("user_id", currentUser.id).order("started_at", { ascending: false }).limit(20);
      if (generation !== foregroundReadGeneration || !cloudIdentityMatches(currentUser.id, client)) return { status: "stale" };
      if (result.error) throw result.error;
      const applied = applyCanonicalSessions((result.data || []).map(sessionFromRow), { announceExternal: true });
      const training = state();
      training.lastSyncedAt = new Date().toISOString();
      training.lastError = "";
      persist();
      if (applied.changed) {
        render();
        if (refreshLogs || applied.transition !== "none") await window.fuelGuardCloud?.syncNow?.();
      }
      return { status: "synced", ...applied };
    } catch (error) {
      if (generation === foregroundReadGeneration && cloudIdentityMatches(currentUser.id, client)) {
        state().lastError = error?.message || "Training Mode refresh failed.";
        persist();
      }
      return { status: "error", error };
    } finally {
      foregroundReadBusy = false;
    }
  }

  function startForegroundSessionRefresh() {
    if (foregroundSessionTimer) return;
    foregroundSessionTimer = setInterval(() => refreshCanonicalSessions(), FOREGROUND_SESSION_REFRESH_MS);
  }

  document.addEventListener("click", async event => {
    if (event.target.closest("[data-training-completion-dismiss]")) {
      dismissTrainingCompletion();
      return;
    }
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

  document.addEventListener("input", event => {
    if (event.target.closest("#trainingEstimatedDurationCustom")) {
      persistEstimatedDuration();
    } else if (event.target.closest("[data-training-preset], [data-training-interval]")) {
      renderDerivedPlanPreview();
    }
  });

  document.addEventListener("change", event => {
    if (event.target.closest("#trainingEstimatedDuration")) persistEstimatedDuration();
  });

  window.addEventListener("fuelguard:cloud-status", () => syncCloud());
  window.addEventListener("online", () => syncCloud({ refreshLogs: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      syncCloud({ refreshLogs: true });
      refreshCanonicalSessions({ refreshLogs: true });
    }
  });
  document.addEventListener("DOMContentLoaded", render);
  startForegroundSessionRefresh();
  requestAnimationFrame(render);

  window.FuelGuardTrainingMode = {
    render,
    syncCloud,
    refreshCanonicalSessions,
    contextForEvent,
    activeSession,
    _test: { sessionFromRow, presetFromRow, durationText, estimatedDurationMinutes, reconcileCanonicalSessions, foregroundRefreshEligible, sessionFingerprint, bonkRiskModel, syncBonkRisk, statusMessage: () => statusMessage }
  };
})();
