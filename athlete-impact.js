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
    editor: null
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
      editor: null
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
      return { label: `${durationValue(Math.abs(improvement))} ${improvement > 0 ? "faster" : "slower"}`, tone: improvement > 0 ? "improved" : "changed" };
    }
    const unit = metric.unit && metric.unit !== "/ 10" ? ` ${metric.unit}` : "";
    if (improvement > 0) return { label: `+${compactNumber(improvement)}${unit} improvement`, tone: "improved" };
    return { label: `${compactNumber(Math.abs(now - before))}${unit} ${now > before ? "higher" : "lower"}`, tone: "changed" };
  }

  function reflectionMetricCategory(metric) {
    if (String(metric.preset_key || "").startsWith("life_")) return "Everyday life";
    if (String(metric.preset_key || "").startsWith("sport_") || !["general", "custom"].includes(metric.sport_type)) return "Sport & training";
    return "Personal outcome";
  }

  function comparisonCard(metric, { editorPreview = false } = {}) {
    const { baseline, current } = resultBounds(metric.id);
    const change = comparisonChange(metric, baseline, current);
    const days = baseline && current ? Math.max(0, Math.round((new Date(`${current.observed_on}T12:00:00`) - new Date(`${baseline.observed_on}T12:00:00`)) / 86400000)) : 0;
    return `
      <article class="reflection-comparison-card ${escape(change.tone)}" data-reflection-card="${escape(metric.id)}">
        <header>
          <div><span>${escape(reflectionMetricCategory(metric))}</span><h3>${escape(metric.name)}</h3></div>
          ${editorPreview ? "" : `<details class="reflection-card-menu"><summary aria-label="Edit ${escape(metric.name)}">•••</summary><div>
            <button type="button" data-reflection-edit="current" data-reflection-metric="${escape(metric.id)}">Update current result</button>
            <button type="button" data-reflection-edit="baseline" data-reflection-metric="${escape(metric.id)}">Edit baseline</button>
            <button type="button" data-reflection-edit="dates" data-reflection-metric="${escape(metric.id)}">Change dates</button>
            <button type="button" data-reflection-change-metric="${escape(metric.id)}">Change metric</button>
            <button type="button" class="danger" data-reflection-delete="${escape(metric.id)}">Delete reflection</button>
          </div></details>`}
        </header>
        <div class="reflection-before-current">
          <div><span>Baseline</span><strong>${formatMetricValue(metric, baseline?.value)}</strong><small>${dateLabel(baseline?.observed_on)}</small></div>
          <i aria-hidden="true">→</i>
          <div><span>Current</span><strong>${formatMetricValue(metric, current?.value)}</strong><small>${dateLabel(current?.observed_on)}</small></div>
        </div>
        <div class="reflection-change ${escape(change.tone)}">${escape(change.label)}</div>
        ${days ? `<p>${escape(days)} day${days === 1 ? "" : "s"} using Fuel Guard</p>` : `<p>${baseline ? "Add where you are now to complete this reflection." : "Add a baseline to begin this reflection."}</p>`}
        ${!editorPreview && !current ? `<button type="button" class="secondary compact" data-reflection-edit="${baseline ? "current" : "baseline"}" data-reflection-metric="${escape(metric.id)}">${baseline ? "Add current result" : "Add baseline"}</button>` : ""}
      </article>`;
  }

  function goalsMarkup(metrics) {
    return `
      <section class="reflection-page-section reflection-goals" aria-labelledby="reflectionGoalsHeading">
        <div class="reflection-section-heading"><div><span>Your goals</span><h2 id="reflectionGoalsHeading">What matters to you</h2></div><button type="button" class="text-button" data-reflection-open-chooser>Edit goals</button></div>
        <div class="reflection-goal-list">${metrics.map(metric => `<span>${escape(metric.name)}</span>`).join("")}</div>
      </section>`;
  }

  function progressMarkup(metrics) {
    return `
      <section class="reflection-page-section" aria-labelledby="reflectionProgressHeading">
        <div class="reflection-section-heading"><div><span>Your progress</span><h2 id="reflectionProgressHeading">Baseline to current</h2></div><small>Entered by you</small></div>
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
        <span>Start your Reflection</span>
        <h2 id="reflectionEmptyHeading">What does better performance look like for you?</h2>
        <p>Start with something you actually care about — your energy, fuelling, training or performance.</p>
        <button type="button" class="primary" data-reflection-open-chooser>Choose what I want to improve</button>
      </section>`;
  }

  function choiceMarkup() {
    const metrics = activeMetrics();
    const activeKeys = new Set(metrics.map(metric => metric.preset_key).filter(Boolean));
    return `
      <div class="reflection-editor-intro"><span>Step 1 of 4</span><h2>Choose what matters</h2><p>Fuel Guard can help you reflect on changes in everyday fuelling, energy and training. Choose only the things that matter to you.</p></div>
      ${Object.entries(OUTCOME_GROUPS).map(([key, group]) => `<section class="reflection-choice-group"><div><h3>${escape(group.label)}</h3><p>${escape(group.description)}</p></div><div>${group.outcomes.map(outcome => `<button type="button" data-reflection-outcome="${escape(outcome.key)}" data-reflection-group="${escape(key)}"${metrics.length >= 3 || activeKeys.has(outcome.key) ? " disabled" : ""}><strong>${escape(outcome.prompt)}</strong><span>${escape(outcome.name)} · ${escape(outcome.unit)}</span></button>`).join("")}</div></section>`).join("")}
      <button type="button" class="secondary reflection-custom-action" data-reflection-custom-outcome${metrics.length >= 3 ? " disabled" : ""}>Create a custom outcome</button>
      ${metrics.length >= 3 ? `<p class="reflection-editor-note">You already have three active reflections. Use a card’s menu to change or delete one.</p>` : ""}`;
  }

  function customMetricMarkup() {
    const preset = outcomeByKey(impactState.editor?.presetKey);
    const direction = preset?.direction || "higher";
    return `
      <div class="reflection-editor-intro"><span>Step 1 of 4</span><h2>${preset?.requiresTarget ? "Set your target range" : "Create your outcome"}</h2><p>${preset?.requiresTarget ? "Define the range that represents your own intention; Fuel Guard will not assume whether higher or lower is better." : "Use a measure that is meaningful and repeatable for you."}</p></div>
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

  function editorValueMarkup(metric, role) {
    const bounds = resultBounds(metric.id);
    const existing = role === "baseline" ? bounds.baseline : bounds.current;
    const isBaseline = role === "baseline";
    const defaultDate = existing?.observed_on || (isBaseline ? domain().dateKey(cloud()?.user?.created_at || new Date()) : domain().dateKey(new Date()));
    return `
      <div class="reflection-editor-intro"><span>Step ${isBaseline ? "2" : "3"} of 4</span><h2>${isBaseline ? "Where were you when you started?" : "Where are you now?"}</h2><p>${escape(metric.name)} · ${escape(metric.unit)}</p></div>
      <div class="reflection-editor-form">
        <label>${isBaseline ? "Baseline" : "Current"} value<input id="reflectionEditorValue" type="text" inputmode="decimal" value="${existing ? escape(metric.measurement_type === "duration_seconds" ? durationValue(existing.value) : existing.value) : ""}" placeholder="${metric.measurement_type === "duration_seconds" ? "mm:ss" : `Value ${escape(metric.unit)}`}"></label>
        <label>Date<input id="reflectionEditorDate" type="date" value="${escape(defaultDate)}"></label>
      </div>
      <button type="button" class="primary" data-reflection-save-value="${role}">${isBaseline ? "Continue to current result" : "Generate comparison"}</button>`;
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
    if (editor.step === "complete" && metric) content = `<div class="reflection-editor-intro"><span>Step 4 of 4</span><h2>Your comparison</h2><p>Your Reflection is ready.</p></div>${comparisonCard(metric, { editorPreview: true })}<button type="button" class="primary" data-reflection-close>Done</button>`;
    return `<div class="reflection-editor-backdrop" data-reflection-close-backdrop><section class="reflection-editor" role="dialog" aria-modal="true" aria-label="Edit Reflection"><button type="button" class="reflection-editor-close" data-reflection-close aria-label="Close Reflection editor">×</button>${content}</section></div>`;
  }

  function render() {
    const target = document.getElementById("athleteImpactSurface");
    if (!target) return;
    const signedIn = Boolean(cloud()?.user?.id);
    if (!signedIn) {
      target.innerHTML = `
        <section class="reflection-hero"><span>Reflection</span><h1>See what has changed for you</h1><p>Log in to choose outcomes, record a baseline and keep your private Reflection history.</p><button type="button" class="primary" data-open-screen="checklist">Open Profile &amp; Settings</button></section>
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
    target.innerHTML = `
      ${impactState.message ? `<div class="impact-status-message" role="status">${escape(impactState.message)}</div>` : ""}
      <header class="reflection-hero"><span>Reflection</span><h1>Since using Fuel Guard, what has changed for you?</h1><p>See how your fuelling habits and the things that matter to you have changed over time.</p></header>
      ${metrics.length ? `${goalsMarkup(metrics)}${progressMarkup(metrics)}${evidenceMarkup(report)}<section class="reflection-add"><button type="button" class="secondary" data-reflection-open-chooser${metrics.length >= 3 ? " disabled" : ""}>Add another reflection</button>${metrics.length >= 3 ? "<small>Three active reflections · use a card menu to make a change.</small>" : ""}</section>` : emptyStateMarkup()}
      ${editorMarkup()}
    `;
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
    const metric = metricById(impactState.editor?.metricId);
    const observedOn = domain().validDateKey(document.getElementById("reflectionEditorDate")?.value);
    const value = parseMetricValue(metric, document.getElementById("reflectionEditorValue")?.value);
    if (!client?.from || !user?.id || !metric || !observedOn || value === null) {
      impactState.message = metric?.measurement_type === "duration_seconds" ? "Enter a valid time such as 27:51." : "Enter a valid dated value.";
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
    const existingBounds = resultBounds(metric.id);
    if ((role === "baseline" && existingBounds.current && observedOn > existingBounds.current.observed_on)
      || (role === "current" && existingBounds.baseline && observedOn < existingBounds.baseline.observed_on)) {
      impactState.message = "The current result date must be on or after the baseline date.";
      render();
      return;
    }
    impactState.saving = true;
    try {
      const bounds = resultBounds(metric.id);
      const existing = role === "baseline" ? bounds.baseline : bounds.current;
      const query = existing
        ? client.from(RESULTS_TABLE).update({ observed_on: observedOn, value }).eq("id", existing.id).eq("user_id", user.id).select(RESULT_COLUMNS).single()
        : client.from(RESULTS_TABLE).insert({ id: uuid(), user_id: user.id, metric_id: metric.id, observed_on: observedOn, value, source: "athlete_entry", notes: null }).select(RESULT_COLUMNS).single();
      const result = await query;
      if (result.error) throw result.error;
      impactState.results = existing
        ? impactState.results.map(item => item.id === existing.id ? result.data : item)
        : [...impactState.results, result.data];
      impactState.editor = role === "baseline" ? { step: "current", metricId: metric.id } : { step: "complete", metricId: metric.id };
      impactState.message = `${role === "baseline" ? "Baseline" : "Current result"} saved.`;
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
      impactState.editor = { step: editButton.dataset.reflectionEdit, metricId: editButton.dataset.reflectionMetric };
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
    _test: { parseMetricValue, formatMetricValue, durationValue, completedSessionWorkouts, impactLoadErrorMessage, resetImpactIdentity, genuinelyNewAthlete, resultBounds, comparisonChange, OUTCOME_GROUPS }
  };
})();
