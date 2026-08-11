// Athlete-owned Reflection setup, observations and evidence report.
(() => {
  const METRICS_TABLE = "fuel_performance_metrics";
  const RESULTS_TABLE = "fuel_performance_results";
  const FEEDBACK_TABLE = "fuel_training_feedback";
  const TRAINING_TABLE = "fuel_training_mode_sessions";
  const GARMIN_TABLE = "garmin_activity_summaries";
  const METRIC_COLUMNS = "id,user_id,sport_type,preset_key,name,unit,measurement_type,direction,target_min,target_max,display_order,archived_at,created_at,updated_at";
  const RESULT_COLUMNS = "id,user_id,metric_id,observed_on,value,source,notes,created_at,updated_at";
  const FEEDBACK_COLUMNS = "id,user_id,training_mode_session_id,activity_source,activity_external_id,session_started_at,session_ended_at,energy_rating,session_completion,source,notes,created_at,updated_at";
  const TRAINING_COLUMNS = "id,user_id,title,session_type,status,started_at,ended_at,created_at,updated_at";
  const OUTCOME_GROUPS = {
    life: {
      label: "Fuelling & everyday life",
      description: "Energy, nutrition and everyday consistency — no sporting metric required.",
      outcomes: [
        { key: "life_nutrition_control", name: "Nutrition control", prompt: "Better control of my nutrition", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "life_eating_consistency", name: "Eating consistency", prompt: "More consistent eating", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "life_long_fuel_gaps", name: "Long gaps without fuel", prompt: "Fewer long gaps without fuel", unit: "hours", measurementType: "number", direction: "lower", sportType: "general", valueMin: 0 },
        { key: "life_daily_energy", name: "Afternoon energy", prompt: "Better energy through the day", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "life_energy_crashes", name: "Energy crashes", prompt: "Fewer crashes", unit: "days / week", measurementType: "number", direction: "lower", sportType: "general", valueMin: 0, valueMax: 7 },
        { key: "life_hydration", name: "Hydration consistency", prompt: "Better hydration", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "life_focus", name: "Mood & concentration", prompt: "Better mood or concentration", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "life_body_weight", name: "Body weight", prompt: "Maintaining or changing body weight", unit: "kg", measurementType: "number", direction: "target_range", sportType: "general", requiresTarget: true }
      ]
    },
    sport: {
      label: "What matters to your performance?",
      description: "Choose up to three areas. You do not need a PB, weight, pace or power number.",
      outcomes: [
        { key: "performance_5k", name: "5 km performance", prompt: "5 km performance", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "running", valueMin: 1, valueMax: 5 },
        { key: "performance_endurance", name: "Endurance", prompt: "Endurance", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 5 },
        { key: "performance_strength", name: "Strength", prompt: "Strength", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "strength", valueMin: 1, valueMax: 5 },
        { key: "performance_speed", name: "Speed", prompt: "Speed", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 5 },
        { key: "performance_recovery", name: "Recovery", prompt: "Recovery", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 5 },
        { key: "performance_consistency", name: "Training consistency", prompt: "Training consistency", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 5 },
        { key: "performance_match_fitness", name: "Match fitness", prompt: "Match fitness", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "team_sport", valueMin: 1, valueMax: 5 },
        { key: "performance_cycling", name: "Cycling", prompt: "Cycling", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "cycling", valueMin: 1, valueMax: 5 },
        { key: "performance_swim", name: "Swimming", prompt: "Swimming", unit: "/ 5", measurementType: "number", direction: "higher", sportType: "swimming", valueMin: 1, valueMax: 5 }
      ]
    }
  };

  let impactState = {
    userId: "",
    loading: false,
    loaded: false,
    saving: false,
    range: "six_weeks",
    metrics: [],
    results: [],
    feedback: [],
    trainingSessions: [],
    garminActivities: [],
    error: "",
    message: "",
    editor: null,
    view: "overview"
  };
  const promptedOnboardingUsers = new Set();

  function resetImpactIdentity(userId = "") {
    impactState = {
      ...impactState,
      userId: String(userId || ""),
      loading: false,
      loaded: false,
      saving: false,
      metrics: [],
      results: [],
      feedback: [],
      trainingSessions: [],
      garminActivities: [],
      error: "",
      message: "",
      editor: null,
      view: "overview"
    };
  }

  function domain() {
    return window.FuelGuardDomain;
  }

  function cloud() {
    return window.fuelGuardCloud;
  }

  function escape(value) {
    return domain()?.escapeHtml?.(value) || String(value ?? "");
  }

  function impactLoadErrorMessage(error) {
    const message = String(error?.message || error || "Could not load Reflection.");
    const missingImpactSchema = String(error?.code || "") === "PGRST205"
      || (/schema cache/i.test(message) && /fuel_performance_(metrics|results)|fuel_training_feedback/i.test(message));
    if (missingImpactSchema) {
      return "Reflection needs the current database release before it can load. The required private outcome tables are not available to the Data API; your existing Fuel Guard data is unaffected.";
    }
    return message;
  }

  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (typeof uid === "function") return uid();
    throw new Error("A secure record identifier is unavailable.");
  }

  function activeMetrics() {
    return impactState.metrics
      .filter(metric => !metric.archived_at)
      .sort((left, right) => left.display_order - right.display_order);
  }

  function metricById(id) {
    return impactState.metrics.find(metric => metric.id === id) || null;
  }

  function localLogs() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    return Array.isArray(gap?.logs) ? gap.logs : [];
  }

  function localTrainingSessions() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    return Array.isArray(gap?.trainingMode?.sessions) ? gap.trainingMode.sessions : [];
  }

  function targetSettings() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : {};
    return { maximumFuelGapMinutes: gap?.maximumFuelGapMinutes };
  }

  function onboardingStorageKey(userId) {
    return `fuelGuardImpactOnboarding:${String(userId || "")}`;
  }

  function onboardingDismissed(userId) {
    try {
      return window.localStorage.getItem(onboardingStorageKey(userId)) === "dismissed";
    } catch (_error) {
      return false;
    }
  }

  function genuinelyNewAthlete() {
    const user = cloud()?.user;
    const createdAt = new Date(user?.created_at || "").getTime();
    const age = Date.now() - createdAt;
    const noImpactData = !impactState.metrics.length && !impactState.results.length && !impactState.feedback.length;
    return Boolean(user?.id)
      && Number.isFinite(createdAt)
      && age >= 0
      && age <= 72 * 60 * 60 * 1000
      && noImpactData
      && localLogs().length === 0
      && !onboardingDismissed(user.id);
  }

  function promptNewAthleteOnce() {
    const userId = cloud()?.user?.id || "";
    if (!userId || !genuinelyNewAthlete()) return;
    const key = `${onboardingStorageKey(userId)}:prompted`;
    if (promptedOnboardingUsers.has(userId)) return;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "true");
    } catch (_error) {
      // The in-memory guard below still prevents repeat routing for this load.
    }
    promptedOnboardingUsers.add(userId);
    requestAnimationFrame(() => {
      if (cloud()?.user?.id === userId && typeof switchScreen === "function") switchScreen("impact");
    });
  }

  function athleteTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function completedSessionWorkouts() {
    const userId = cloud()?.user?.id || impactState.userId;
    const byId = new Map();
    [...impactState.trainingSessions, ...localTrainingSessions()].forEach(session => {
      const status = session.status;
      const startAt = session.started_at || session.startedAt;
      const endAt = session.ended_at || session.endedAt;
      if (status !== "completed" || !startAt || !endAt) return;
      byId.set(String(session.id), {
        id: session.id,
        athleteId: session.user_id || userId,
        source: "training_mode",
        type: session.session_type || session.sessionType || "training",
        title: session.title || "Training session",
        startAt,
        endAt,
        timeZone: athleteTimeZone()
      });
    });
    const garmin = impactState.garminActivities.map(activity => ({
      id: activity.id,
      athleteId: activity.user_id || userId,
      source: "garmin",
      sourceActivityId: activity.source_activity_id || "",
      type: activity.activity_type,
      title: activity.activity_type,
      startAt: activity.started_at,
      durationSeconds: activity.duration_seconds,
      timeZone: athleteTimeZone()
    }));
    return domain().normalizeWorkouts([...byId.values(), ...garmin]);
  }

  function currentReport() {
    return domain().buildAthleteImpactReport({
      metrics: impactState.metrics,
      results: impactState.results,
      logs: localLogs(),
      workouts: completedSessionWorkouts(),
      feedback: impactState.feedback,
      targets: targetSettings(),
      range: impactState.range,
      now: new Date(),
      timeZone: athleteTimeZone()
    });
  }

  function durationValue(seconds) {
    if (!Number.isFinite(Number(seconds))) return "—";
    const value = Math.max(0, Math.round(Number(seconds)));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = value % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function formatMetricValue(metric, value) {
    if (!Number.isFinite(Number(value))) return "—";
    if (metric?.measurement_type === "duration_seconds") return durationValue(value);
    const number = Number(value);
    const rendered = Number.isInteger(number) ? String(number) : String(Math.round(number * 100) / 100);
    return `${rendered}${metric?.unit ? ` ${metric.unit}` : ""}`;
  }

  function parseMetricValue(metric, raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    if (metric?.measurement_type !== "duration_seconds") {
      const number = Number(text);
      return Number.isFinite(number) ? number : null;
    }
    if (/^\d+(?::\d{1,2}){1,2}$/.test(text)) {
      const parts = text.split(":").map(Number);
      if (parts.some(part => !Number.isFinite(part)) || parts.slice(1).some(part => part >= 60)) return null;
      return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  function formatSignal(signal) {
    if (!Number.isFinite(signal.current) || !Number.isFinite(signal.baseline)) return "Not enough comparable data yet";
    const formatter = signal.unit === "minutes"
      ? value => domain().duration(Math.round(value))
      : signal.unit === "%"
        ? value => `${Math.round(value)}%`
        : signal.unit === "/week"
          ? value => `${Math.round(value * 10) / 10}/week`
          : value => `${Math.round(value * 10) / 10}${signal.unit ? ` ${signal.unit}` : ""}`;
    return `${formatter(signal.baseline)} → ${formatter(signal.current)}`;
  }

  function resultsForMetric(metricId) {
    return impactState.results
      .filter(result => String(result.metric_id) === String(metricId))
      .sort((left, right) => String(left.observed_on).localeCompare(String(right.observed_on)) || String(left.created_at || "").localeCompare(String(right.created_at || "")));
  }

  function resultBounds(metricId) {
    const results = resultsForMetric(metricId);
    return { results, baseline: results[0] || null, current: results.length > 1 ? results.at(-1) : null };
  }

  function dateLabel(value) {
    const parsed = new Date(`${String(value || "")}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? "Not recorded" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  function compactNumber(value) {
    const number = Math.round(Math.abs(Number(value)) * 100) / 100;
    return Number.isInteger(number) ? String(number) : String(number);
  }

  function distanceFromTarget(metric, value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    if (number < Number(metric.target_min)) return Number(metric.target_min) - number;
    if (number > Number(metric.target_max)) return number - Number(metric.target_max);
    return 0;
  }

  function comparisonChange(metric, baseline, current) {
    if (!baseline || !current) return { label: "Your baseline", tone: "building" };
    const before = Number(baseline.value);
    const now = Number(current.value);
    if (!Number.isFinite(before) || !Number.isFinite(now)) return { label: "Comparison unavailable", tone: "building" };
    if (metric.direction === "target_range") {
      const change = distanceFromTarget(metric, before) - distanceFromTarget(metric, now);
      if (change > 0) return { label: "Closer to your target range", tone: "improved" };
      if (change < 0) return { label: "Further from your target range", tone: "changed" };
      return { label: "No measured change yet", tone: "stable" };
    }
    const improvement = metric.direction === "lower" ? before - now : now - before;
    if (Math.abs(improvement) < 0.0001) return { label: subjectiveMetric(metric) ? "Holding steady" : "No measured change yet", tone: "stable" };
    if (metric.unit === "/ 5") {
      if (improvement > 0) return { label: `+${compactNumber(improvement)} since your baseline`, tone: "improved" };
      return { label: "Below your baseline", tone: "changed" };
    }
    if (metric.measurement_type === "duration_seconds") {
      return { label: `${durationValue(Math.abs(improvement))} ${improvement > 0 ? "faster" : "slower"} since baseline`, tone: improvement > 0 ? "improved" : "changed" };
    }
    const unit = metric.unit && metric.unit !== "/ 10" ? ` ${metric.unit}` : "";
    if (improvement > 0) return { label: `+${compactNumber(improvement)}${unit} since baseline`, tone: "improved" };
    return { label: `${compactNumber(Math.abs(now - before))}${unit} ${now > before ? "higher" : "lower"} since baseline`, tone: "changed" };
  }

  function reflectionMetricCategory(metric) {
    if (String(metric.preset_key || "").startsWith("life_")) return "Everyday life";
    if (String(metric.preset_key || "").startsWith("sport_") || !["general", "custom"].includes(metric.sport_type)) return "Sport & training";
    return "Personal outcome";
  }

  function subjectiveMetric(metric) {
    return metric?.measurement_type === "number" && ["/ 5", "/ 10"].includes(metric?.unit);
  }

  function ratingReadout(metric, value) {
    if (!subjectiveMetric(metric) || !Number.isFinite(Number(value))) return formatMetricValue(metric, value);
    const maximum = metric?.unit === "/ 5" ? 5 : 10;
    const rating = Math.max(1, Math.min(maximum, Math.round(Number(value))));
    return `<span class="reflection-rating-readout" aria-label="${rating} out of ${maximum}"><b>${rating}</b><small>/ ${maximum}</small></span>`;
  }

  function performanceAreaPhrase(name) {
    const phrase = String(name || "performance").trim();
    if (!phrase) return "performance";
    return /^[A-Z]/.test(phrase) ? `${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}` : phrase;
  }

  function comparisonCard(metric, { editorPreview = false, showManage = true } = {}) {
    const { baseline, current } = resultBounds(metric.id);
    const change = comparisonChange(metric, baseline, current);
    const days = baseline && current ? Math.max(0, Math.round((new Date(`${current.observed_on}T12:00:00`) - new Date(`${baseline.observed_on}T12:00:00`)) / 86400000)) : 0;
    return `
      <article class="reflection-comparison-card ${escape(change.tone)}" data-reflection-card="${escape(metric.id)}">
        <header>
          <div><span>Performance area</span><h3>${escape(metric.name)}</h3></div>
          ${editorPreview || !showManage ? "" : `<details class="reflection-card-menu"><summary aria-label="Manage ${escape(metric.name)}">•••</summary><div>
            ${current ? `<button type="button" data-reflection-edit="current" data-reflection-metric="${escape(metric.id)}">Edit latest check-in</button>` : ""}
            <button type="button" data-reflection-edit="baseline" data-reflection-metric="${escape(metric.id)}">Edit baseline</button>
            <button type="button" data-reflection-change-metric="${escape(metric.id)}">Change area</button>
            <button type="button" class="danger" data-reflection-delete="${escape(metric.id)}">Stop tracking</button>
          </div></details>`}
        </header>
        <div class="reflection-before-current">
          <div><span>Baseline</span><strong>${ratingReadout(metric, baseline?.value)}</strong><small>${dateLabel(baseline?.observed_on)}</small></div>
          <i aria-hidden="true">→</i>
          <div><span>Now</span><strong>${current ? ratingReadout(metric, current.value) : '<span class="reflection-rating-empty">—</span>'}</strong><small>${current ? dateLabel(current.observed_on) : "Future check-in"}</small></div>
        </div>
        ${current ? `<div class="reflection-change ${escape(change.tone)}">${escape(change.label)}</div>` : `<div class="reflection-baseline-status">Starting point recorded</div>`}
        ${current ? `<p>${days ? `${escape(days)} day${days === 1 ? "" : "s"} between reflections` : "Compared with your starting point."}</p>` : `<p>${baseline ? "A future check-in will build your comparison." : "Add a baseline to begin this reflection."}</p>`}
        ${!editorPreview && !baseline ? `<button type="button" class="secondary compact" data-reflection-edit="baseline" data-reflection-metric="${escape(metric.id)}">Add baseline</button>` : ""}
      </article>`;
  }

  function reflectionLifecycle(metrics = activeMetrics(), now = new Date(), resultRows = impactState.results) {
    const observations = metrics.map(metric => {
      const results = (Array.isArray(resultRows) ? resultRows : [])
        .filter(result => String(result.metric_id) === String(metric.id))
        .sort((left, right) => String(left.observed_on).localeCompare(String(right.observed_on)) || String(left.created_at || "").localeCompare(String(right.created_at || "")));
      return { metric, results, baseline: results[0] || null, current: results.length > 1 ? results.at(-1) : null };
    });
    const baselines = observations.map(item => item.baseline).filter(Boolean);
    const reviews = observations.flatMap(item => item.results.slice(1));
    const baselineReady = Boolean(metrics.length) && baselines.length === metrics.length;
    const baselineOn = baselines.map(item => item.observed_on).sort()[0] || "";
    const latestBaselineOn = baselines.map(item => item.observed_on).sort().at(-1) || "";
    const latestReviewOn = reviews.map(item => item.observed_on).sort().at(-1) || "";
    const anchor = latestReviewOn || latestBaselineOn;
    const dueOn = anchor ? domain().shiftDateKey(anchor, 14) : "";
    const today = domain().dateKey(now);
    return {
      observations,
      baselines,
      reviews,
      baselineReady,
      baselineOn,
      latestReviewOn,
      dueOn,
      reviewDue: Boolean(baselineReady && dueOn && today >= dueOn),
      comparisonCount: observations.filter(item => item.current).length
    };
  }

  function reflectionReviewPrompt() {
    const lifecycle = reflectionLifecycle();
    if (!lifecycle.reviewDue) return null;
    return {
      id: "reflection_review",
      occurrenceKey: `reflection-review:${lifecycle.dueOn}`,
      title: "Your Reflection check-in is ready",
      detail: "It has been around two weeks. Record where you are now using the same measures."
    };
  }

  function emptyStateMarkup() {
    return `
      <section class="reflection-empty-state" aria-labelledby="reflectionEmptyHeading">
        <span>Performance baseline</span>
        <h2 id="reflectionEmptyHeading">What matters to your performance?</h2>
        <p>Choose up to three areas that feel meaningful to you. No PB, pace or performance number is needed.</p>
        <button type="button" class="primary" data-reflection-open-chooser>Choose performance areas</button>
      </section>`;
  }

  function journeyMarkup(metrics) {
    return `<section class="reflection-page-section reflection-journey" aria-labelledby="reflectionJourneyHeading">
      <div class="reflection-section-heading"><div><span>Progress over time</span><h2 id="reflectionJourneyHeading">Your Journey</h2></div></div>
      <div class="reflection-journey-list">${metrics.map(metric => {
        const { results, baseline, current } = resultBounds(metric.id);
        const change = comparisonChange(metric, baseline, current);
        const checkInCount = Math.max(0, results.length - 1);
        return `<article class="${escape(change.tone)}"><div><h3>${escape(metric.name)}</h3><strong>${baseline ? `${escape(compactNumber(baseline.value))} <i aria-hidden="true">→</i> ${current ? escape(compactNumber(current.value)) : "—"}` : "Baseline not set"}</strong></div><p>${baseline ? `Started ${escape(dateLabel(baseline.observed_on).replace(/ \d{4}$/, ""))}` : "Choose a baseline to begin"}<span aria-hidden="true">·</span>${checkInCount ? `${checkInCount} check-in${checkInCount === 1 ? "" : "s"}` : baseline ? "Baseline set" : "No check-ins yet"}</p><small>${escape(current ? change.label : "Your starting point is saved")}</small></article>`;
      }).join("")}</div>
    </section>`;
  }

  function populatedStateMarkup(metrics) {
    const lifecycle = reflectionLifecycle(metrics);
    const missingBaseline = metrics.filter(metric => !resultBounds(metric.id).baseline);
    return `<section class="reflection-page-section reflection-performance-overview" aria-labelledby="reflectionPerformanceOverviewHeading">
      <div class="reflection-section-heading"><div><span>${lifecycle.comparisonCount ? "Baseline to now" : "Your starting point"}</span><h2 id="reflectionPerformanceOverviewHeading">Your Performance</h2></div><button type="button" class="text-button" data-reflection-open-chooser${metrics.length >= 3 ? " disabled" : ""}>Add area</button></div>
      <div class="reflection-area-chips" aria-label="Selected performance areas">${metrics.map(metric => `<span>${escape(metric.name)} <i aria-hidden="true">✓</i></span>`).join("")}</div>
      ${missingBaseline.length ? `<p class="reflection-empty-inline">Finish your baseline so every selected area has a starting point.</p><button type="button" class="primary reflection-review-action" data-reflection-complete-baseline>Complete baseline</button>` : `<button type="button" class="primary reflection-review-action" data-reflection-start-review>Check in</button>`}
      <div class="reflection-comparison-grid">${metrics.map(metric => comparisonCard(metric)).join("")}</div>
    </section>${journeyMarkup(metrics)}`;
  }

  function choiceMarkup() {
    const metrics = activeMetrics();
    const activeKeys = new Set(metrics.map(metric => metric.preset_key).filter(Boolean));
    const selectedKeys = new Set(impactState.editor?.selectedKeys || []);
    const customOutcomes = impactState.editor?.customOutcomes || [];
    const remaining = Math.max(0, 3 - metrics.length);
    const selectionCount = selectedKeys.size + customOutcomes.length;
    return `
      <div class="reflection-editor-intro"><span>Performance baseline</span><h2>What matters to your performance?</h2><p>Choose up to ${remaining || 3} area${remaining === 1 ? "" : "s"} that matter to you. You’ll rate each one on a simple 1–5 scale.</p></div>
      ${metrics.length ? `<div class="reflection-current-areas"><span>Already selected</span>${metrics.map(metric => `<strong>${escape(metric.name)} <i aria-hidden="true">✓</i></strong>`).join("")}</div>` : ""}
      ${Object.entries(OUTCOME_GROUPS).filter(([key]) => key === "sport").map(([key, group]) => `<section class="reflection-choice-group" aria-label="${escape(group.label)}"><div>${group.outcomes.map(outcome => {
        const selected = selectedKeys.has(outcome.key);
        const unavailable = activeKeys.has(outcome.key) || (!selected && selectionCount >= remaining);
        return `<button type="button" class="${selected ? "selected" : ""}" data-reflection-outcome="${escape(outcome.key)}" data-reflection-group="${escape(key)}" aria-pressed="${selected ? "true" : "false"}"${unavailable ? " disabled" : ""}><strong>${escape(outcome.prompt)}</strong><i aria-hidden="true">${selected ? "✓" : "+"}</i></button>`;
      }).join("")}</div></section>`).join("")}
      ${customOutcomes.length ? `<div class="reflection-custom-selections">${customOutcomes.map((outcome, index) => `<span>${escape(outcome.name)} <button type="button" data-reflection-remove-custom="${index}" aria-label="Remove ${escape(outcome.name)}">×</button></span>`).join("")}</div>` : ""}
      <button type="button" class="secondary reflection-custom-action" data-reflection-custom-outcome${selectionCount >= remaining ? " disabled" : ""}>+ Custom area</button>
      ${selectionCount ? `<button type="button" class="primary reflection-continue-action" data-reflection-save-selection>Continue to baseline</button>` : ""}
      ${metrics.length >= 3 ? `<p class="reflection-editor-note">You have three active performance areas. Use a card’s menu to change one while keeping its history.</p>` : ""}`;
  }

  function customMetricMarkup() {
    const preset = outcomeByKey(impactState.editor?.presetKey);
    return `
      <div class="reflection-editor-intro"><span>Custom performance area</span><h2>What matters to you?</h2><p>Use a short, natural label. It will use the same simple 1–5 satisfaction scale.</p></div>
      <div class="reflection-editor-form">
        <label>Performance area<input id="reflectionCustomName" type="text" maxlength="100" value="${escape(preset?.name || "")}" placeholder="e.g. Explosiveness or race confidence"></label>
      </div>
      <button type="button" class="primary" data-reflection-save-custom>Add area</button>`;
  }

  function ratingScaleMarkup(metric, value) {
    const selected = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    const maximum = metric?.unit === "/ 5" ? 5 : 10;
    const labels = maximum === 5 ? { 1: "Not satisfied", 3: "Okay", 5: "Very satisfied" } : {};
    return `<fieldset class="reflection-rating-scale"><legend class="visually-hidden">How satisfied are you currently with your ${escape(performanceAreaPhrase(metric.name))}?</legend><input id="reflectionEditorValue" type="hidden" value="${selected || ""}"><div role="group" aria-label="Satisfaction from 1 to ${maximum}">${Array.from({ length: maximum }, (_, index) => index + 1).map(rating => `<button type="button" class="${rating === selected ? "selected" : ""}" data-reflection-rating="${rating}" aria-label="${rating} out of ${maximum}${labels[rating] ? ` — ${labels[rating]}` : ""}" aria-pressed="${rating === selected ? "true" : "false"}"><strong>${rating}</strong><small>${labels[rating] || ""}</small></button>`).join("")}</div></fieldset>`;
  }

  function editorValueMarkup(metric, role) {
    const bounds = resultBounds(metric.id);
    const newObservation = role === "current" && impactState.editor?.newObservation;
    const existing = newObservation ? null : role === "baseline" ? bounds.baseline : bounds.current;
    const isBaseline = role === "baseline";
    const value = existing ? (metric.measurement_type === "duration_seconds" ? durationValue(existing.value) : existing.value) : "";
    return `
      <div class="reflection-editor-intro"><span>${isBaseline ? "Your baseline" : "Performance check-in"}</span><h2>${subjectiveMetric(metric) ? `How satisfied are you currently with your ${escape(performanceAreaPhrase(metric.name))}?` : isBaseline ? "Where are you currently?" : "How are things going now?"}</h2><p>${subjectiveMetric(metric) ? "Choose how this area feels today. No performance number is required." : `${escape(metric.name)} · recorded for today`}</p></div>
      <div class="reflection-editor-form">
        ${subjectiveMetric(metric) ? ratingScaleMarkup(metric, value) : `<label>${isBaseline ? "Baseline" : "Current"} value<input id="reflectionEditorValue" type="text" inputmode="decimal" value="${escape(value)}" placeholder="${metric.measurement_type === "duration_seconds" ? "mm:ss" : `Value ${escape(metric.unit)}`}"></label>`}
      </div>
      <button type="button" class="primary" data-reflection-save-value="${role}">${isBaseline ? Number(impactState.editor?.baselineIndex || 0) < Number(impactState.editor?.baselineMetricIds?.length || 1) - 1 ? "Save and continue" : "Save baseline" : Number(impactState.editor?.reviewIndex || 0) < Number(impactState.editor?.reviewMetricIds?.length || 1) - 1 ? "Save and continue" : "Save check-in"}</button>`;
  }

  function editorMarkup() {
    const editor = impactState.editor;
    if (!editor) return "";
    const metric = metricById(editor.metricId);
    let content = choiceMarkup();
    if (editor.step === "custom") content = customMetricMarkup();
    if ((editor.step === "baseline" || editor.step === "current") && metric) content = editorValueMarkup(metric, editor.step);
    if (editor.step === "complete" && metric) content = `<div class="reflection-editor-intro"><span>Check-in complete</span><h2>Your Reflection is up to date</h2><p>This records what changed over the same period; it does not claim what caused the change.</p></div>${comparisonCard(metric, { editorPreview: true })}<button type="button" class="primary" data-reflection-close>Done</button>`;
    return `<div class="reflection-editor-backdrop" data-reflection-close-backdrop><section class="reflection-editor" role="dialog" aria-modal="true" aria-label="Edit Reflection"><button type="button" class="reflection-editor-close" data-reflection-close aria-label="Close Reflection editor">×</button>${content}</section></div>`;
  }

  function render() {
    const target = document.getElementById("athleteImpactSurface");
    if (!target) return;
    const signedIn = Boolean(cloud()?.user?.id);
    if (!signedIn) {
      target.innerHTML = `
        <section class="reflection-hero"><span>Reflection</span><h1>Life first. Sport second.</h1><p>Log in to establish an Everyday baseline and keep separate private Performance outcomes.</p><button type="button" class="primary" data-open-screen="checklist">Open Profile &amp; Settings</button></section>
      `;
      return;
    }
    if (impactState.loading && !impactState.loaded) {
      target.innerHTML = `<section class="reflection-hero"><span>Reflection</span><h1>Loading your Reflection…</h1></section>`;
      return;
    }
    if (impactState.error) {
      target.innerHTML = `<section class="reflection-hero error"><span>Reflection</span><h1>Reflection data is unavailable</h1><p>${escape(impactState.error)}</p><button type="button" class="secondary" data-impact-refresh>Try again</button></section>`;
      return;
    }
    const metrics = activeMetrics();
    const performanceMarkup = `
      ${impactState.message ? `<div class="impact-status-message" role="status">${escape(impactState.message)}</div>` : ""}
      <header class="reflection-performance-heading"><span>Performance</span><h2>How is your performance feeling?</h2><p>Choose what matters to you and Fuel Guard will help you reflect on how that changes over time.</p></header>
      ${metrics.length ? populatedStateMarkup(metrics) : emptyStateMarkup()}
    `;
    target.innerHTML = `
      <header class="reflection-hero reflection-main-heading"><span>Reflection</span><h1>Life first. Sport second.</h1><p>See whether everyday organisation and energy are changing, then keep athletic performance outcomes separate.</p></header>
      <div id="athleteEverydayReflection" class="everyday-reflection-surface"></div>
      <section class="reflection-performance-shell">${performanceMarkup}</section>
      ${editorMarkup()}
    `;
    window.FuelGuardEverydayReflection?.render?.();
    window.FuelGuardAthleteRetention?.render?.();
  }

  async function load({ force = false } = {}) {
    const userId = cloud()?.user?.id || "";
    const client = cloud()?.client;
    if (!userId || !client?.from) {
      resetImpactIdentity();
      render();
      return;
    }
    if (impactState.userId !== userId) {
      resetImpactIdentity(userId);
      render();
    }
    if (impactState.loading || (!force && impactState.loaded && impactState.userId === userId)) return;
    impactState = { ...impactState, userId, loading: true, error: "", message: "" };
    render();
    try {
      const [metricResult, resultResult, feedbackResult, trainingResult, garminResult] = await Promise.all([
        client.from(METRICS_TABLE).select(METRIC_COLUMNS).eq("user_id", userId).order("display_order", { ascending: true }),
        client.from(RESULTS_TABLE).select(RESULT_COLUMNS).eq("user_id", userId).order("observed_on", { ascending: true }),
        client.from(FEEDBACK_TABLE).select(FEEDBACK_COLUMNS).eq("user_id", userId).order("session_ended_at", { ascending: false }),
        client.from(TRAINING_TABLE).select(TRAINING_COLUMNS).eq("user_id", userId).eq("status", "completed").order("ended_at", { ascending: false }).limit(1000),
        client.from(GARMIN_TABLE).select("id,user_id,source,source_activity_id,activity_type,started_at,duration_seconds").eq("user_id", userId).order("started_at", { ascending: false }).limit(1000)
      ]);
      if (impactState.userId !== userId) return;
      const failed = [metricResult, resultResult, feedbackResult, trainingResult, garminResult].find(result => result.error);
      if (failed) throw failed.error;
      const metrics = metricResult.data || [];
      impactState = {
        ...impactState,
        loading: false,
        loaded: true,
        metrics,
        results: resultResult.data || [],
        feedback: feedbackResult.data || [],
        trainingSessions: trainingResult.data || [],
        garminActivities: garminResult.data || [],
        error: ""
      };
      promptNewAthleteOnce();
    } catch (error) {
      if (impactState.userId !== userId) return;
      impactState = { ...impactState, loading: false, loaded: true, error: impactLoadErrorMessage(error) };
    }
    render();
  }

  async function saveSelectedMetrics(presets) {
    const user = cloud()?.user;
    const client = cloud()?.client;
    const metrics = activeMetrics();
    const selection = (Array.isArray(presets) ? presets : []).slice(0, Math.max(0, 3 - metrics.length));
    if (!user?.id || !client?.from || !selection.length || metrics.length >= 3 || impactState.saving) return [];
    impactState.saving = true;
    const savedMetrics = [];
    try {
      const occupied = new Set(metrics.map(metric => metric.display_order));
      for (const preset of selection) {
        const openSlot = [1, 2, 3].find(slot => !occupied.has(slot));
        if (!openSlot) break;
        occupied.add(openSlot);
        const row = {
          id: uuid(),
          user_id: user.id,
          sport_type: preset.sportType || "custom",
          preset_key: preset.key || null,
          name: preset.name,
          unit: preset.unit,
          measurement_type: preset.measurementType || "number",
          direction: preset.direction,
          target_min: preset.direction === "target_range" ? preset.targetMin : null,
          target_max: preset.direction === "target_range" ? preset.targetMax : null,
          display_order: openSlot
        };
        const result = await client.from(METRICS_TABLE).insert(row).select(METRIC_COLUMNS).single();
        if (result.error) throw result.error;
        impactState.metrics = [...impactState.metrics, result.data];
        savedMetrics.push(result.data);
      }
      const metricIds = savedMetrics.map(metric => metric.id);
      impactState.editor = metricIds.length ? { step: "baseline", metricId: metricIds[0], baselineMetricIds: metricIds, baselineIndex: 0 } : null;
      impactState.message = savedMetrics.length === 1 ? `${savedMetrics[0].name} is ready for its baseline.` : `${savedMetrics.length} performance areas selected. Add a baseline for each.`;
    } catch (error) {
      impactState.message = error?.message || "Could not save those performance areas.";
      if (savedMetrics.length) {
        const metricIds = savedMetrics.map(metric => metric.id);
        impactState.editor = { step: "baseline", metricId: metricIds[0], baselineMetricIds: metricIds, baselineIndex: 0 };
      }
    } finally {
      impactState.saving = false;
      render();
    }
    return savedMetrics;
  }

  async function saveMetric(preset) {
    const saved = await saveSelectedMetrics([preset]);
    return saved[0] || null;
  }

  async function archiveMetric(metricId, { openChooser = false, deleted = false } = {}) {
    const client = cloud()?.client;
    const userId = cloud()?.user?.id;
    if (!client?.from || !userId || impactState.saving) return;
    impactState.saving = true;
    try {
      const archivedAt = new Date().toISOString();
      const result = await client.from(METRICS_TABLE).update({ archived_at: archivedAt }).eq("id", metricId).eq("user_id", userId).select(METRIC_COLUMNS).single();
      if (result.error) throw result.error;
      impactState.metrics = impactState.metrics.map(metric => metric.id === metricId ? result.data : metric);
      impactState.editor = openChooser ? { step: "choose", selectedKeys: [], customOutcomes: [] } : null;
      impactState.message = deleted ? "Performance area stopped. Its private history is retained." : "Choose a replacement area. Existing history is retained.";
    } catch (error) {
      impactState.message = error?.message || "Could not change that metric.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  async function saveReflectionValue(role) {
    const client = cloud()?.client;
    const user = cloud()?.user;
    const editor = impactState.editor || {};
    const metric = metricById(editor.metricId);
    const existingBounds = resultBounds(metric?.id);
    const newObservation = role === "current" && editor.newObservation;
    const existing = newObservation ? null : role === "baseline" ? existingBounds.baseline : existingBounds.current;
    const observedOn = domain().validDateKey(existing?.observed_on || domain().dateKey(new Date()));
    const value = parseMetricValue(metric, document.getElementById("reflectionEditorValue")?.value);
    if (!client?.from || !user?.id || !metric || !observedOn || value === null) {
      impactState.message = metric?.measurement_type === "duration_seconds" ? "Enter a valid time such as 27:51." : subjectiveMetric(metric) ? `Choose a rating from 1 to ${metric.unit === "/ 5" ? 5 : 10}.` : "Enter a valid value.";
      render();
      return;
    }
    const preset = outcomeByKey(metric.preset_key);
    const valueMin = Number.isFinite(preset?.valueMin) ? preset.valueMin : metric.unit === "/ 5" ? 1 : null;
    const valueMax = Number.isFinite(preset?.valueMax) ? preset.valueMax : metric.unit === "/ 5" ? 5 : null;
    if ((Number.isFinite(valueMin) && value < valueMin) || (Number.isFinite(valueMax) && value > valueMax)) {
      impactState.message = Number.isFinite(valueMax)
        ? `Enter a value between ${valueMin} and ${valueMax}.`
        : `Enter a value of ${valueMin} or more.`;
      render();
      return;
    }
    if ((role === "baseline" && existingBounds.current && observedOn > existingBounds.current.observed_on)
      || (role === "current" && existingBounds.baseline && observedOn < existingBounds.baseline.observed_on)) {
      impactState.message = "The current result date must be on or after the baseline date.";
      render();
      return;
    }
    impactState.saving = true;
    try {
      const query = existing
        ? client.from(RESULTS_TABLE).update({ observed_on: observedOn, value }).eq("id", existing.id).eq("user_id", user.id).select(RESULT_COLUMNS).single()
        : client.from(RESULTS_TABLE).insert({ id: uuid(), user_id: user.id, metric_id: metric.id, observed_on: observedOn, value, source: "athlete_entry", notes: null }).select(RESULT_COLUMNS).single();
      const result = await query;
      if (result.error) throw result.error;
      impactState.results = existing
        ? impactState.results.map(item => item.id === existing.id ? result.data : item)
        : [...impactState.results, result.data];
      if (role === "baseline") {
        const nextIndex = Number(editor.baselineIndex || 0) + 1;
        const nextMetricId = editor.baselineMetricIds?.[nextIndex];
        impactState.editor = nextMetricId
          ? { step: "baseline", metricId: nextMetricId, baselineMetricIds: editor.baselineMetricIds, baselineIndex: nextIndex }
          : null;
        impactState.view = "overview";
        impactState.message = nextMetricId ? "Baseline saved. Continue with the next area." : "Performance baseline saved. A future check-in will build your comparison.";
      } else if (newObservation && Array.isArray(editor.reviewMetricIds)) {
        const nextIndex = Number(editor.reviewIndex || 0) + 1;
        const nextMetricId = editor.reviewMetricIds[nextIndex];
        impactState.editor = nextMetricId
          ? { step: "current", metricId: nextMetricId, newObservation: true, reviewMetricIds: editor.reviewMetricIds, reviewIndex: nextIndex }
          : { step: "complete", metricId: metric.id };
        impactState.message = nextMetricId ? "Check-in saved. Continue with the next outcome." : "Current check-in complete.";
      } else {
        impactState.editor = { step: "complete", metricId: metric.id };
        impactState.message = "Current check-in saved.";
      }
    } catch (error) {
      impactState.message = error?.message || "Could not save that Reflection value.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  function customOutcomeFromEditor() {
    const preset = outcomeByKey(impactState.editor?.presetKey);
    return {
      key: preset?.key || null,
      name: String(document.getElementById("reflectionCustomName")?.value || "").trim(),
      unit: "/ 5",
      measurementType: "number",
      direction: "higher",
      valueMin: 1,
      valueMax: 5,
      sportType: preset?.sportType || "custom"
    };
  }

  function outcomeByKey(key) {
    return Object.values(OUTCOME_GROUPS).flatMap(group => group.outcomes).find(outcome => outcome.key === key) || null;
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-reflection-start-review]")) {
      const metricIds = activeMetrics().filter(metric => resultBounds(metric.id).baseline).map(metric => metric.id);
      if (metricIds.length) {
        impactState.editor = { step: "current", metricId: metricIds[0], newObservation: true, reviewMetricIds: metricIds, reviewIndex: 0 };
        render();
      }
      return;
    }
    if (event.target.closest("[data-reflection-complete-baseline]")) {
      const metricIds = activeMetrics().filter(metric => !resultBounds(metric.id).baseline).map(metric => metric.id);
      if (metricIds.length) {
        impactState.editor = { step: "baseline", metricId: metricIds[0], baselineMetricIds: metricIds, baselineIndex: 0 };
        render();
      }
      return;
    }
    const ratingButton = event.target.closest("[data-reflection-rating]");
    if (ratingButton) {
      const value = String(ratingButton.dataset.reflectionRating || "");
      const input = document.getElementById("reflectionEditorValue");
      if (input) input.value = value;
      document.querySelectorAll("[data-reflection-rating]").forEach(button => {
        const selected = button === ratingButton;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
      return;
    }
    if (event.target.closest("[data-reflection-open-chooser]")) {
      impactState.editor = { step: "choose", selectedKeys: [], customOutcomes: [] };
      render();
      return;
    }
    if (event.target.closest("[data-reflection-custom-outcome]")) {
      impactState.editor = { ...impactState.editor, step: "custom" };
      render();
      return;
    }
    const outcomeButton = event.target.closest("[data-reflection-outcome]");
    if (outcomeButton) {
      const outcome = outcomeByKey(outcomeButton.dataset.reflectionOutcome);
      if (!outcome) return;
      const selectedKeys = new Set(impactState.editor?.selectedKeys || []);
      if (selectedKeys.has(outcome.key)) selectedKeys.delete(outcome.key);
      else selectedKeys.add(outcome.key);
      impactState.editor = { ...impactState.editor, step: "choose", selectedKeys: [...selectedKeys] };
      render();
      return;
    }
    if (event.target.closest("[data-reflection-save-custom]")) {
      const custom = customOutcomeFromEditor();
      if (!custom.name) {
        impactState.message = "Name the performance area you want to reflect on.";
        render();
      } else {
        impactState.editor = { ...impactState.editor, step: "choose", customOutcomes: [...(impactState.editor?.customOutcomes || []), custom] };
        impactState.message = "";
        render();
      }
      return;
    }
    const removeCustomButton = event.target.closest("[data-reflection-remove-custom]");
    if (removeCustomButton) {
      const customOutcomes = [...(impactState.editor?.customOutcomes || [])];
      customOutcomes.splice(Number(removeCustomButton.dataset.reflectionRemoveCustom), 1);
      impactState.editor = { ...impactState.editor, customOutcomes };
      render();
      return;
    }
    if (event.target.closest("[data-reflection-save-selection]")) {
      const presets = (impactState.editor?.selectedKeys || []).map(outcomeByKey).filter(Boolean);
      return saveSelectedMetrics([...presets, ...(impactState.editor?.customOutcomes || [])]);
    }
    const editButton = event.target.closest("[data-reflection-edit]");
    if (editButton) {
      impactState.editor = { step: editButton.dataset.reflectionEdit, metricId: editButton.dataset.reflectionMetric, newObservation: false };
      render();
      return;
    }
    const valueButton = event.target.closest("[data-reflection-save-value]");
    if (valueButton) return saveReflectionValue(valueButton.dataset.reflectionSaveValue);
    const changeButton = event.target.closest("[data-reflection-change-metric]");
    if (changeButton) return archiveMetric(changeButton.dataset.reflectionChangeMetric, { openChooser: true });
    const deleteButton = event.target.closest("[data-reflection-delete]");
    if (deleteButton) {
      if (window.confirm("Stop tracking this performance area? Its private history will be retained.")) return archiveMetric(deleteButton.dataset.reflectionDelete, { deleted: true });
      return;
    }
    if (event.target.closest("[data-reflection-close]") || event.target.matches("[data-reflection-close-backdrop]")) {
      impactState.editor = null;
      render();
      return;
    }
    if (event.target.closest("[data-impact-refresh]")) load({ force: true });
  });

  window.addEventListener("fuelguard:cloud-status", () => load());
  window.addEventListener("fuelguard:training-session-ended", event => {
    impactState.trainingSessions = [event.detail?.session, ...impactState.trainingSessions.filter(session => session.id !== event.detail?.session?.id)].filter(Boolean);
    load({ force: true });
  });
  window.addEventListener("fuelguard:training-completion-dismissed", () => {
    load({ force: true });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ force: true }); });
  document.addEventListener("DOMContentLoaded", () => load());
  requestAnimationFrame(() => load());

  window.AthleteImpact = {
    render,
    load,
    report: currentReport,
    reviewPrompt: reflectionReviewPrompt,
    _test: { parseMetricValue, formatMetricValue, durationValue, completedSessionWorkouts, impactLoadErrorMessage, resetImpactIdentity, genuinelyNewAthlete, resultBounds, comparisonChange, reflectionLifecycle, ratingScaleMarkup, performanceAreaPhrase, OUTCOME_GROUPS }
  };
})();
