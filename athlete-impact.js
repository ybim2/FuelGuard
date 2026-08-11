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
      label: "Sport & training",
      description: "Choose a training or performance outcome only if it matters to you.",
      outcomes: [
        { key: "sport_training_energy", name: "Training energy", prompt: "Better training energy", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "sport_recovery", name: "Recovery quality", prompt: "Better recovery", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "running_5k", name: "5K time", prompt: "Faster running or race times", unit: "time", measurementType: "duration_seconds", direction: "lower", sportType: "running" },
        { key: "strength_max", name: "Maximum strength test", prompt: "Improved strength", unit: "kg", measurementType: "number", direction: "higher", sportType: "strength" },
        { key: "sport_endurance", name: "Endurance", prompt: "Improved endurance", unit: "/ 10", measurementType: "number", direction: "higher", sportType: "general", valueMin: 1, valueMax: 10 },
        { key: "football_yoyo", name: "Yo-Yo test", prompt: "Improved fitness test performance", unit: "level", measurementType: "number", direction: "higher", sportType: "football" }
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
    if (!baseline || !current) return { label: "Add a current result", tone: "building" };
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
    if (Math.abs(improvement) < 0.0001) return { label: "No measured change yet", tone: "stable" };
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
    return metric?.measurement_type === "number" && metric?.unit === "/ 10";
  }

  function ratingReadout(metric, value) {
    if (!subjectiveMetric(metric) || !Number.isFinite(Number(value))) return formatMetricValue(metric, value);
    const rating = Math.max(1, Math.min(10, Math.round(Number(value))));
    return `<span class="reflection-rating-readout" aria-label="${rating} out of 10"><i aria-hidden="true">${"★".repeat(rating)}${"☆".repeat(10 - rating)}</i><b>${rating}/10</b></span>`;
  }

  function comparisonCard(metric, { editorPreview = false, showManage = true } = {}) {
    const { baseline, current } = resultBounds(metric.id);
    const change = comparisonChange(metric, baseline, current);
    const days = baseline && current ? Math.max(0, Math.round((new Date(`${current.observed_on}T12:00:00`) - new Date(`${baseline.observed_on}T12:00:00`)) / 86400000)) : 0;
    return `
      <article class="reflection-comparison-card ${escape(change.tone)}" data-reflection-card="${escape(metric.id)}">
        <header>
          <div><span>${escape(reflectionMetricCategory(metric))}</span><h3>${escape(metric.name)}</h3></div>
          ${editorPreview || !showManage ? "" : `<details class="reflection-card-menu"><summary aria-label="Manage ${escape(metric.name)}">•••</summary><div>
            ${current ? `<button type="button" data-reflection-edit="current" data-reflection-metric="${escape(metric.id)}">Edit latest check-in</button>` : ""}
            <button type="button" data-reflection-edit="baseline" data-reflection-metric="${escape(metric.id)}">Edit baseline</button>
            <button type="button" data-reflection-edit="dates" data-reflection-metric="${escape(metric.id)}">Change dates</button>
            <button type="button" data-reflection-change-metric="${escape(metric.id)}">Change metric</button>
            <button type="button" class="danger" data-reflection-delete="${escape(metric.id)}">Delete reflection</button>
          </div></details>`}
        </header>
        <div class="reflection-before-current">
          <div><span>Baseline</span><strong>${ratingReadout(metric, baseline?.value)}</strong><small>${dateLabel(baseline?.observed_on)}</small></div>
          <i aria-hidden="true">→</i>
          <div><span>Current</span><strong>${ratingReadout(metric, current?.value)}</strong><small>${dateLabel(current?.observed_on)}</small></div>
        </div>
        ${current ? `<div class="reflection-change ${escape(change.tone)}">${escape(change.label)}</div>` : `<div class="reflection-baseline-status">Starting point recorded</div>`}
        ${days ? `<p>${escape(days)} day${days === 1 ? "" : "s"} between observations</p>` : `<p>${baseline ? "A later check-in will create a comparison." : "Add a baseline to begin this reflection."}</p>`}
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

  function progressMarkup(metrics, { heading = "Changes over time" } = {}) {
    return `
      <section class="reflection-page-section" aria-labelledby="reflectionProgressHeading">
        <div class="reflection-section-heading"><div><span>Entered by you</span><h2 id="reflectionProgressHeading">${escape(heading)}</h2></div><small>Baseline → current check-in</small></div>
        <div class="reflection-comparison-grid">${metrics.map(metric => comparisonCard(metric)).join("")}</div>
      </section>`;
  }

  function evidenceMarkup(report) {
    const available = report.signals.behavior.filter(signal => Number.isFinite(signal.baseline) && Number.isFinite(signal.current));
    return `
      <section class="reflection-page-section reflection-evidence" aria-labelledby="reflectionEvidenceHeading">
        <div class="reflection-section-heading"><div><span>Fuel Guard evidence</span><h2 id="reflectionEvidenceHeading">Changes in your fuelling behaviour</h2></div><small>Calculated from recorded activity</small></div>
        ${available.length ? `<div class="reflection-evidence-list">${available.map(signal => `<article class="${escape(signal.direction)}"><strong>${escape(signal.label)}</strong><span>${escape(formatSignal(signal))}</span><small>${signal.direction === "improved" ? "Moving in a positive direction" : signal.direction === "declined" ? "Worth noticing" : "Broadly stable"}</small></article>`).join("")}</div>` : `<p class="reflection-empty-inline">Keep using Daily and Training Mode. Fuel Guard will show behavioural comparisons when there is enough recorded evidence.</p>`}
        <p class="reflection-causation-note">These changes happened during the same period as your reflections. They do not show that Fuel Guard or fuelling caused an external outcome.</p>
      </section>`;
  }

  function emptyStateMarkup() {
    return `
      <section class="reflection-empty-state" aria-labelledby="reflectionEmptyHeading">
        <span>Your starting point</span>
        <h2 id="reflectionEmptyHeading">Start your Performance Reflection</h2>
        <p>Choose an athletic outcome that matters to you, then record a performance-specific baseline.</p>
        <button type="button" class="primary" data-reflection-open-chooser>Set performance baseline</button>
      </section>`;
  }

  function historyMarkup(metrics) {
    return `<section class="reflection-page-section reflection-history"><div class="reflection-section-heading"><div><span>Private history</span><h2>All check-ins</h2></div><small>Owner-only records</small></div><div class="reflection-history-list">${metrics.map(metric => `<article><h3>${escape(metric.name)}</h3>${resultsForMetric(metric.id).slice().reverse().map((result, index, all) => `<div><span>${index === all.length - 1 ? "Baseline" : "Check-in"}</span><strong>${ratingReadout(metric, result.value)}</strong><small>${dateLabel(result.observed_on)}</small></div>`).join("") || "<p>No observations yet.</p>"}</article>`).join("")}</div></section>`;
  }

  function overviewCards(metrics, report, lifecycle) {
    const behaviourSignals = report.signals.behavior.filter(signal => Number.isFinite(signal.baseline) && Number.isFinite(signal.current)).length;
    const sportCount = metrics.filter(metric => reflectionMetricCategory(metric) === "Sport & training").length;
    const lifeCount = metrics.filter(metric => reflectionMetricCategory(metric) === "Everyday life").length;
    const cards = [
      ["baseline", "Your baseline", `${lifecycle.baselines.length} of ${metrics.length} recorded`, "The starting point you entered"],
      ["current", "Current check-in", lifecycle.reviewDue ? "Ready now" : lifecycle.latestReviewOn ? dateLabel(lifecycle.latestReviewOn) : `Due around ${dateLabel(lifecycle.dueOn)}`, lifecycle.reviewDue ? "Use the same measures" : "Your next reflection"],
      ["performance", "Performance", `${sportCount} outcome${sportCount === 1 ? "" : "s"}`, "Sport and training measures"],
      ["everyday", "Earlier personal outcomes", `${lifeCount} outcome${lifeCount === 1 ? "" : "s"}`, "Existing records remain preserved"],
      ["behaviour", "Fuelling behaviour", behaviourSignals ? `${behaviourSignals} comparison${behaviourSignals === 1 ? "" : "s"}` : "Building evidence", "Calculated from recorded activity"],
      ["changes", "Changes over time", lifecycle.comparisonCount ? `${lifecycle.comparisonCount} outcome${lifecycle.comparisonCount === 1 ? "" : "s"}` : "After your next check-in", "Baseline and later observations"]
    ];
    return `<section class="reflection-page-section reflection-dashboard" aria-labelledby="reflectionJourneyHeading"><div class="reflection-section-heading"><div><span>Your journey</span><h2 id="reflectionJourneyHeading">A clear view of what you recorded</h2></div></div><div class="reflection-journey-summary"><span><small>Baseline</small><strong>${escape(dateLabel(lifecycle.baselineOn))}</strong></span><span><small>Latest review</small><strong>${lifecycle.latestReviewOn ? escape(dateLabel(lifecycle.latestReviewOn)) : "Not yet"}</strong></span><span><small>Next review</small><strong>${lifecycle.reviewDue ? "Ready now" : escape(dateLabel(lifecycle.dueOn))}</strong></span><span><small>Outcomes</small><strong>${metrics.length}</strong></span></div><div class="reflection-dashboard-rail" aria-label="Reflection sections">${cards.map(([view, label, value, detail]) => `<button type="button" class="reflection-dashboard-card" data-reflection-view="${view}"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(detail)}</small><i aria-hidden="true">→</i></button>`).join("")}</div></section>`;
  }

  function detailMarkup(view, metrics, report, lifecycle) {
    const back = `<button type="button" class="reflection-detail-back" data-reflection-view="overview">← Your journey</button>`;
    if (view === "baseline") return `${back}${progressMarkup(metrics, { heading: "Your baseline" })}`;
    if (view === "current") return `${back}<section class="reflection-page-section"><div class="reflection-section-heading"><div><span>Current check-in</span><h2>${lifecycle.reviewDue ? "Ready when you are" : "Your next check-in"}</h2></div></div><p class="reflection-empty-inline">${lifecycle.reviewDue ? "Record where you are now using the same measures as your baseline." : `Your next check-in is due around ${dateLabel(lifecycle.dueOn)}. This gives the comparison enough separation to be useful.`}</p>${lifecycle.reviewDue ? `<button type="button" class="primary reflection-review-action" data-reflection-start-review>Start current check-in</button>` : ""}</section>${lifecycle.latestReviewOn ? progressMarkup(metrics, { heading: "Latest check-in" }) : ""}`;
    if (view === "performance") {
      const selected = metrics.filter(metric => reflectionMetricCategory(metric) === "Sport & training");
      return `${back}${selected.length ? progressMarkup(selected, { heading: "Performance" }) : `<section class="reflection-page-section"><h2>Performance</h2><p class="reflection-empty-inline">No sport or training outcome is active.</p></section>`}`;
    }
    if (view === "everyday") {
      const selected = metrics.filter(metric => reflectionMetricCategory(metric) === "Everyday life");
      return `${back}${selected.length ? progressMarkup(selected, { heading: "Earlier personal outcomes" }) : `<section class="reflection-page-section"><h2>Earlier personal outcomes</h2><p class="reflection-empty-inline">No earlier personal outcome is active. Use the Everyday baseline above for new life-impact reflections.</p></section>`}`;
    }
    if (view === "behaviour") return `${back}${evidenceMarkup(report)}`;
    if (view === "changes") return `${back}${lifecycle.comparisonCount ? progressMarkup(metrics) : `<section class="reflection-page-section"><h2>Changes over time</h2><p class="reflection-empty-inline">Your baseline is set. Changes will appear only after a later check-in.</p></section>`}${historyMarkup(metrics)}`;
    return "";
  }

  function populatedStateMarkup(metrics, report) {
    const lifecycle = reflectionLifecycle(metrics);
    if (impactState.view !== "overview") return detailMarkup(impactState.view, metrics, report, lifecycle);
    return `${overviewCards(metrics, report, lifecycle)}<section class="reflection-page-section reflection-outcome-summary"><div class="reflection-section-heading"><div><span>Your baseline</span><h2>Tracked outcomes</h2></div><button type="button" class="text-button" data-reflection-open-chooser${metrics.length >= 3 ? " disabled" : ""}>Add outcome</button></div><div class="reflection-goal-list">${metrics.map(metric => `<span>${escape(metric.name)}</span>`).join("")}</div>${!lifecycle.baselineReady ? `<p class="reflection-empty-inline">Complete the starting point for each selected outcome before the first review.</p>` : `<p class="reflection-baseline-note">Baseline recorded ${escape(dateLabel(lifecycle.baselineOn))}. ${lifecycle.reviewDue ? "Your current check-in is ready." : `Next check-in around ${escape(dateLabel(lifecycle.dueOn))}.`}</p>`}</section>`;
  }

  function choiceMarkup() {
    const metrics = activeMetrics();
    const activeKeys = new Set(metrics.map(metric => metric.preset_key).filter(Boolean));
    return `
      <div class="reflection-editor-intro"><span>Performance starting point</span><h2>Choose what matters</h2><p>Choose a sport or training outcome that is meaningful and repeatable for you. You can track up to three.</p></div>
      ${Object.entries(OUTCOME_GROUPS).filter(([key]) => key === "sport").map(([key, group]) => `<section class="reflection-choice-group"><div><h3>${escape(group.label)}</h3><p>${escape(group.description)}</p></div><div>${group.outcomes.map(outcome => `<button type="button" data-reflection-outcome="${escape(outcome.key)}" data-reflection-group="${escape(key)}"${metrics.length >= 3 || activeKeys.has(outcome.key) ? " disabled" : ""}><strong>${escape(outcome.prompt)}</strong><span>${escape(outcome.name)} · ${escape(outcome.unit)}</span></button>`).join("")}</div></section>`).join("")}
      <button type="button" class="secondary reflection-custom-action" data-reflection-custom-outcome${metrics.length >= 3 ? " disabled" : ""}>Create a custom outcome</button>
      ${metrics.length >= 3 ? `<p class="reflection-editor-note">You already have three active reflections. Use a card’s menu to change or delete one.</p>` : ""}`;
  }

  function customMetricMarkup() {
    const preset = outcomeByKey(impactState.editor?.presetKey);
    const direction = preset?.direction || "higher";
    return `
      <div class="reflection-editor-intro"><span>Your starting point</span><h2>${preset?.requiresTarget ? "Set your target range" : "Create your outcome"}</h2><p>${preset?.requiresTarget ? "Define the range that represents your own intention; Fuel Guard will not assume whether higher or lower is better." : "Use a measure that is meaningful and repeatable for you."}</p></div>
      <div class="reflection-editor-form two-column">
        <label>Outcome name<input id="reflectionCustomName" type="text" maxlength="100" value="${escape(preset?.name || "")}" placeholder="e.g. Body weight"></label>
        <label>Unit<input id="reflectionCustomUnit" type="text" maxlength="24" value="${escape(preset?.unit || "")}" placeholder="e.g. kg, / 10, sec"></label>
        <label>Result format<select id="reflectionCustomMeasurement"><option value="number"${preset?.measurementType === "duration_seconds" ? "" : " selected"}>Number</option><option value="duration_seconds"${preset?.measurementType === "duration_seconds" ? " selected" : ""}>Time (mm:ss or h:mm:ss)</option></select></label>
        <label>Better means<select id="reflectionCustomDirection"><option value="higher"${direction === "higher" ? " selected" : ""}>Higher</option><option value="lower"${direction === "lower" ? " selected" : ""}>Lower</option><option value="target_range"${direction === "target_range" ? " selected" : ""}>Within a target range</option></select></label>
        <label data-reflection-target${direction === "target_range" ? "" : " hidden"}>Target minimum<input id="reflectionCustomTargetMin" type="number" step="any" inputmode="decimal"></label>
        <label data-reflection-target${direction === "target_range" ? "" : " hidden"}>Target maximum<input id="reflectionCustomTargetMax" type="number" step="any" inputmode="decimal"></label>
      </div>
      <button type="button" class="primary" data-reflection-save-custom>Continue to baseline</button>`;
  }

  function ratingScaleMarkup(metric, value) {
    const selected = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    return `<fieldset class="reflection-rating-scale"><legend>${escape(metric.name)}</legend><input id="reflectionEditorValue" type="hidden" value="${selected || ""}"><div role="group" aria-label="Rate ${escape(metric.name)} from 1 to 10">${Array.from({ length: 10 }, (_, index) => index + 1).map(rating => `<button type="button" class="${rating <= selected ? "selected" : ""}" data-reflection-rating="${rating}" aria-label="${rating} out of 10" aria-pressed="${rating === selected ? "true" : "false"}"><span aria-hidden="true">★</span><small>${rating}</small></button>`).join("")}</div><p>Tap one position. 1 is lowest; 10 is highest.</p></fieldset>`;
  }

  function editorValueMarkup(metric, role) {
    const bounds = resultBounds(metric.id);
    const newObservation = role === "current" && impactState.editor?.newObservation;
    const existing = newObservation ? null : role === "baseline" ? bounds.baseline : bounds.current;
    const isBaseline = role === "baseline";
    const value = existing ? (metric.measurement_type === "duration_seconds" ? durationValue(existing.value) : existing.value) : "";
    return `
      <div class="reflection-editor-intro"><span>${isBaseline ? "Your starting point" : "Current check-in"}</span><h2>${isBaseline ? "Where are you currently?" : "How are things going now?"}</h2><p>${escape(metric.name)} · ${escape(metric.unit)} · recorded for today</p></div>
      <div class="reflection-editor-form">
        ${subjectiveMetric(metric) ? ratingScaleMarkup(metric, value) : `<label>${isBaseline ? "Baseline" : "Current"} value<input id="reflectionEditorValue" type="text" inputmode="decimal" value="${escape(value)}" placeholder="${metric.measurement_type === "duration_seconds" ? "mm:ss" : `Value ${escape(metric.unit)}`}"></label>`}
      </div>
      <button type="button" class="primary" data-reflection-save-value="${role}">${isBaseline ? "Save starting point" : impactState.editor?.reviewMetricIds?.length ? "Save and continue" : "Save current check-in"}</button>`;
  }

  function datesMarkup(metric) {
    const { baseline, current } = resultBounds(metric.id);
    return `
      <div class="reflection-editor-intro"><span>Edit reflection</span><h2>Change dates</h2><p>${escape(metric.name)}</p></div>
      <div class="reflection-editor-form">
        <label>Baseline date<input id="reflectionBaselineDate" type="date" value="${escape(baseline?.observed_on || "")}"${baseline ? "" : " disabled"}></label>
        <label>Current date<input id="reflectionCurrentDate" type="date" value="${escape(current?.observed_on || "")}"${current ? "" : " disabled"}></label>
      </div>
      <button type="button" class="primary" data-reflection-save-dates>Save dates</button>`;
  }

  function editorMarkup() {
    const editor = impactState.editor;
    if (!editor) return "";
    const metric = metricById(editor.metricId);
    let content = choiceMarkup();
    if (editor.step === "custom") content = customMetricMarkup();
    if ((editor.step === "baseline" || editor.step === "current") && metric) content = editorValueMarkup(metric, editor.step);
    if (editor.step === "dates" && metric) content = datesMarkup(metric);
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
    const report = currentReport();
    const lifecycle = reflectionLifecycle(metrics);
    const hasComparison = lifecycle.comparisonCount > 0;
    const performanceMarkup = `
      ${impactState.message ? `<div class="impact-status-message" role="status">${escape(impactState.message)}</div>` : ""}
      <header class="reflection-performance-heading"><span>PERFORMANCE</span><h2>${!metrics.length ? "Is anything changing in the outcomes you care about?" : hasComparison ? "Your performance comparison" : "Your performance baseline is set"}</h2><p>${!metrics.length ? "Choose a sport or training outcome only when it matters to you." : hasComparison ? "Compare your baseline and check-ins without turning association into a claim of cause." : "Keep using Fuel Guard normally. We’ll invite you to check in again in around two weeks."}</p></header>
      ${metrics.length ? populatedStateMarkup(metrics, report) : emptyStateMarkup()}
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

  async function saveMetric(preset) {
    const user = cloud()?.user;
    const client = cloud()?.client;
    const metrics = activeMetrics();
    if (!user?.id || !client?.from || metrics.length >= 3 || impactState.saving) return null;
    const openSlot = [1, 2, 3].find(slot => !metrics.some(metric => metric.display_order === slot));
    if (!openSlot) return null;
    impactState.saving = true;
    let savedMetric = null;
    try {
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
      savedMetric = result.data;
      impactState.editor = { step: "baseline", metricId: result.data.id };
      impactState.message = `${preset.name} added to your Reflection.`;
    } catch (error) {
      impactState.message = error?.message || "Could not save that metric.";
    } finally {
      impactState.saving = false;
      render();
    }
    return savedMetric;
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
      impactState.editor = openChooser ? { step: "choose" } : null;
      impactState.message = deleted ? "Reflection removed. Its private result history is retained." : "Choose a replacement outcome. Existing result history is retained.";
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
      impactState.message = metric?.measurement_type === "duration_seconds" ? "Enter a valid time such as 27:51." : subjectiveMetric(metric) ? "Choose a rating from 1 to 10." : "Enter a valid value.";
      render();
      return;
    }
    const preset = outcomeByKey(metric.preset_key);
    if ((Number.isFinite(preset?.valueMin) && value < preset.valueMin) || (Number.isFinite(preset?.valueMax) && value > preset.valueMax)) {
      impactState.message = Number.isFinite(preset?.valueMax)
        ? `Enter a value between ${preset.valueMin} and ${preset.valueMax}.`
        : `Enter a value of ${preset.valueMin} or more.`;
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
        impactState.editor = null;
        impactState.view = "overview";
        impactState.message = "Starting point saved. Your next check-in will appear in around two weeks.";
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

  async function saveReflectionDates() {
    const client = cloud()?.client;
    const user = cloud()?.user;
    const metric = metricById(impactState.editor?.metricId);
    const bounds = resultBounds(metric?.id);
    const baselineDate = bounds.baseline ? domain().validDateKey(document.getElementById("reflectionBaselineDate")?.value) : null;
    const currentDate = bounds.current ? domain().validDateKey(document.getElementById("reflectionCurrentDate")?.value) : null;
    if (!client?.from || !user?.id || !metric || (bounds.baseline && !baselineDate) || (bounds.current && !currentDate)) {
      impactState.message = "Choose valid dates for the recorded values.";
      render();
      return;
    }
    if (baselineDate && currentDate && currentDate < baselineDate) {
      impactState.message = "The current result date must be on or after the baseline date.";
      render();
      return;
    }
    impactState.saving = true;
    try {
      const updates = [];
      if (bounds.baseline) updates.push(client.from(RESULTS_TABLE).update({ observed_on: baselineDate }).eq("id", bounds.baseline.id).eq("user_id", user.id).select(RESULT_COLUMNS).single());
      if (bounds.current) updates.push(client.from(RESULTS_TABLE).update({ observed_on: currentDate }).eq("id", bounds.current.id).eq("user_id", user.id).select(RESULT_COLUMNS).single());
      const results = await Promise.all(updates);
      const failed = results.find(result => result.error);
      if (failed) throw failed.error;
      const updated = new Map(results.map(result => [result.data.id, result.data]));
      impactState.results = impactState.results.map(item => updated.get(item.id) || item);
      impactState.editor = null;
      impactState.message = "Reflection dates updated.";
    } catch (error) {
      impactState.message = error?.message || "Could not update those dates.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  function customOutcomeFromEditor() {
    const preset = outcomeByKey(impactState.editor?.presetKey);
    const direction = document.getElementById("reflectionCustomDirection")?.value || "higher";
    const targetMinText = String(document.getElementById("reflectionCustomTargetMin")?.value || "").trim();
    const targetMaxText = String(document.getElementById("reflectionCustomTargetMax")?.value || "").trim();
    return {
      key: preset?.key || null,
      name: String(document.getElementById("reflectionCustomName")?.value || "").trim(),
      unit: String(document.getElementById("reflectionCustomUnit")?.value || "").trim(),
      measurementType: document.getElementById("reflectionCustomMeasurement")?.value || "number",
      direction,
      targetMin: targetMinText ? Number(targetMinText) : NaN,
      targetMax: targetMaxText ? Number(targetMaxText) : NaN,
      sportType: preset?.sportType || "custom"
    };
  }

  function outcomeByKey(key) {
    return Object.values(OUTCOME_GROUPS).flatMap(group => group.outcomes).find(outcome => outcome.key === key) || null;
  }

  document.addEventListener("click", event => {
    const viewButton = event.target.closest("[data-reflection-view]");
    if (viewButton) {
      impactState.view = viewButton.dataset.reflectionView || "overview";
      render();
      return;
    }
    if (event.target.closest("[data-reflection-start-review]")) {
      const metricIds = activeMetrics().filter(metric => resultBounds(metric.id).baseline).map(metric => metric.id);
      if (metricIds.length) {
        impactState.editor = { step: "current", metricId: metricIds[0], newObservation: true, reviewMetricIds: metricIds, reviewIndex: 0 };
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
        const selected = Number(button.dataset.reflectionRating) <= Number(value);
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", button === ratingButton ? "true" : "false");
      });
      return;
    }
    if (event.target.closest("[data-reflection-open-chooser]")) {
      impactState.editor = { step: "choose" };
      render();
      return;
    }
    if (event.target.closest("[data-reflection-custom-outcome]")) {
      impactState.editor = { step: "custom" };
      render();
      return;
    }
    const outcomeButton = event.target.closest("[data-reflection-outcome]");
    if (outcomeButton) {
      const outcome = outcomeByKey(outcomeButton.dataset.reflectionOutcome);
      if (outcome?.requiresTarget) {
        impactState.editor = { step: "custom", presetKey: outcome.key };
        render();
      } else if (outcome) saveMetric(outcome);
      return;
    }
    if (event.target.closest("[data-reflection-save-custom]")) {
      const custom = customOutcomeFromEditor();
      if (!custom.name || !custom.unit || (custom.direction === "target_range" && (!Number.isFinite(custom.targetMin) || !Number.isFinite(custom.targetMax) || custom.targetMin > custom.targetMax))) {
        impactState.message = "Complete the outcome name, unit and any target range.";
        render();
      } else saveMetric(custom);
      return;
    }
    const editButton = event.target.closest("[data-reflection-edit]");
    if (editButton) {
      impactState.editor = { step: editButton.dataset.reflectionEdit, metricId: editButton.dataset.reflectionMetric, newObservation: false };
      render();
      return;
    }
    const valueButton = event.target.closest("[data-reflection-save-value]");
    if (valueButton) return saveReflectionValue(valueButton.dataset.reflectionSaveValue);
    if (event.target.closest("[data-reflection-save-dates]")) return saveReflectionDates();
    const changeButton = event.target.closest("[data-reflection-change-metric]");
    if (changeButton) return archiveMetric(changeButton.dataset.reflectionChangeMetric, { openChooser: true });
    const deleteButton = event.target.closest("[data-reflection-delete]");
    if (deleteButton) {
      if (window.confirm("Remove this Reflection? Its private result history will be retained.")) return archiveMetric(deleteButton.dataset.reflectionDelete, { deleted: true });
      return;
    }
    if (event.target.closest("[data-reflection-close]") || event.target.matches("[data-reflection-close-backdrop]")) {
      impactState.editor = null;
      render();
      return;
    }
    if (event.target.closest("[data-impact-refresh]")) load({ force: true });
  });

  document.addEventListener("change", event => {
    if (event.target.id === "reflectionCustomDirection") {
      document.querySelectorAll("[data-reflection-target]").forEach(field => { field.hidden = event.target.value !== "target_range"; });
    }
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
    _test: { parseMetricValue, formatMetricValue, durationValue, completedSessionWorkouts, impactLoadErrorMessage, resetImpactIdentity, genuinelyNewAthlete, resultBounds, comparisonChange, reflectionLifecycle, ratingScaleMarkup, OUTCOME_GROUPS }
  };
})();
