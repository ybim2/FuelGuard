// Athlete-owned Performance Impact setup, observations and evidence report.
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
  const RANGE_LABELS = {
    six_weeks: "Last 6 weeks",
    twelve_weeks: "Last 12 weeks",
    since_first_evidence: "Since first evidence"
  };
  const SPORT_LABELS = {
    running: "Running",
    cycling: "Cycling",
    swimming: "Swimming",
    triathlon: "Triathlon",
    football: "Football",
    team_sport: "Team sport",
    strength: "Strength / power",
    general: "General",
    custom: "Other"
  };
  const PRESETS = {
    running: [
      { key: "running_5k", name: "5K time", unit: "time", measurementType: "duration_seconds", direction: "lower" },
      { key: "running_10k", name: "10K time", unit: "time", measurementType: "duration_seconds", direction: "lower" },
      { key: "bleep_test", name: "Bleep test", unit: "level", measurementType: "number", direction: "higher" }
    ],
    cycling: [
      { key: "cycling_ftp", name: "Cycling FTP", unit: "W", measurementType: "number", direction: "higher" },
      { key: "cycling_20m_power", name: "20-minute power", unit: "W", measurementType: "number", direction: "higher" },
      { key: "cycling_tt_time", name: "Time-trial time", unit: "time", measurementType: "duration_seconds", direction: "lower" }
    ],
    swimming: [
      { key: "swim_css", name: "Critical swim speed", unit: "time / 100m", measurementType: "duration_seconds", direction: "lower" },
      { key: "swim_400m", name: "400 m time", unit: "time", measurementType: "duration_seconds", direction: "lower" },
      { key: "swim_1500m", name: "1500 m time", unit: "time", measurementType: "duration_seconds", direction: "lower" }
    ],
    triathlon: [
      { key: "triathlon_5k", name: "5K time", unit: "time", measurementType: "duration_seconds", direction: "lower" },
      { key: "triathlon_ftp", name: "Cycling FTP", unit: "W", measurementType: "number", direction: "higher" },
      { key: "triathlon_css", name: "Swim CSS", unit: "time / 100m", measurementType: "duration_seconds", direction: "lower" }
    ],
    football: [
      { key: "football_10m", name: "10 m sprint", unit: "sec", measurementType: "number", direction: "lower" },
      { key: "football_40yd", name: "40-yard sprint", unit: "sec", measurementType: "number", direction: "lower" },
      { key: "football_yoyo", name: "Yo-Yo test", unit: "level", measurementType: "number", direction: "higher" }
    ],
    team_sport: [
      { key: "team_10m", name: "10 m sprint", unit: "sec", measurementType: "number", direction: "lower" },
      { key: "team_broad_jump", name: "Broad jump", unit: "cm", measurementType: "number", direction: "higher" },
      { key: "team_yoyo", name: "Yo-Yo test", unit: "level", measurementType: "number", direction: "higher" }
    ],
    strength: [
      { key: "strength_broad_jump", name: "Broad jump", unit: "cm", measurementType: "number", direction: "higher" },
      { key: "strength_vertical_jump", name: "Vertical jump", unit: "cm", measurementType: "number", direction: "higher" },
      { key: "strength_max", name: "Maximum strength test", unit: "kg", measurementType: "number", direction: "higher" }
    ],
    general: [],
    custom: []
  };

  let impactState = {
    userId: "",
    loading: false,
    loaded: false,
    saving: false,
    range: "six_weeks",
    sport: "running",
    metrics: [],
    results: [],
    feedback: [],
    trainingSessions: [],
    garminActivities: [],
    error: "",
    message: ""
  };

  function domain() {
    return window.FuelGuardDomain;
  }

  function cloud() {
    return window.fuelGuardCloud;
  }

  function escape(value) {
    return domain()?.escapeHtml?.(value) || String(value ?? "");
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

  function directionMark(direction) {
    if (direction === "improved") return "↑";
    if (direction === "declined") return "↓";
    if (direction === "stable") return "→";
    return "";
  }

  function statusTone(id) {
    if (["strong_positive", "positive", "strong_improvement", "improving"].includes(id)) return "positive";
    if (["negative", "declining"].includes(id)) return "negative";
    if (["mixed"].includes(id)) return "mixed";
    return "neutral";
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

  function sparkline(metric, results) {
    const values = results.map(result => Number(result.value)).filter(Number.isFinite);
    if (values.length < 2) return `<div class="impact-sparkline-empty">Add another dated result to start the trend.</div>`;
    const width = 280;
    const height = 72;
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const spread = maximum - minimum || 1;
    const points = values.map((value, index) => {
      const x = 8 + index * ((width - 16) / Math.max(1, values.length - 1));
      const y = 8 + (maximum - value) / spread * (height - 16);
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    }).join(" ");
    return `<svg class="impact-sparkline" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escape(metric.name)} result trend"><polyline points="${points}" fill="none" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function outcomeCard(outcome) {
    const metric = outcome.metric;
    const metricResults = impactState.results
      .filter(result => result.metric_id === metric.id)
      .sort((left, right) => left.observed_on.localeCompare(right.observed_on));
    return `
      <article class="impact-outcome-card ${escape(outcome.direction)}">
        <div class="impact-outcome-heading">
          <div><span>${escape(metric.unit)}</span><h3>${escape(metric.name)}</h3></div>
          <strong>${escape(directionMark(outcome.direction))}</strong>
        </div>
        <div class="impact-before-now">
          <div><span>Baseline</span><strong>${formatMetricValue(metric, outcome.baseline?.numericValue)}</strong><small>${escape(outcome.baseline?.observedKey || "Building")}</small></div>
          <i aria-hidden="true">→</i>
          <div><span>Current</span><strong>${formatMetricValue(metric, outcome.current?.numericValue)}</strong><small>${escape(outcome.current?.observedKey || "Not recorded")}</small></div>
        </div>
        ${sparkline(metric, metricResults)}
        <p>${outcome.sufficient
          ? `${escape(outcome.sampleCount)} athlete-entered results · ${escape(outcome.separationDays)} days from baseline to current.`
          : `${escape(outcome.sampleCount)} athlete-entered result${outcome.sampleCount === 1 ? "" : "s"}. Two results at least 14 days apart are required.`}</p>
      </article>
    `;
  }

  function componentCard(label, component, detail) {
    return `
      <article class="impact-component ${statusTone(component.id)}">
        <span>${escape(label)}</span>
        <strong>${escape(component.label)} ${component.id === "improving" || component.id === "strong_improvement" ? "↑" : component.id === "declining" ? "↓" : ""}</strong>
        <small>${escape(detail)}</small>
      </article>
    `;
  }

  function signalsMarkup(signals) {
    return signals.map(signal => `
      <div class="impact-signal-row ${escape(signal.direction)}">
        <div><strong>${escape(signal.label)}</strong><span>${escape(formatSignal(signal))}</span></div>
        <small>${signal.direction === "insufficient" ? "Insufficient sample" : `${escape(signal.direction)} ${escape(directionMark(signal.direction))}`}</small>
      </div>
    `).join("");
  }

  function reportMarkup(report) {
    const outcomeCount = report.outcomes.filter(outcome => outcome.sufficient).length;
    return `
      <section class="impact-hero ${statusTone(report.overall.id)}">
        <div class="impact-eyebrow">Your Fuel Guard Impact</div>
        <h1>${escape(report.overall.label)}</h1>
        <p>${escape(report.summary)}</p>
        <div class="impact-evidence-line">Based on ${report.evidence.days} days · ${report.evidence.workouts} recorded sessions · ${report.evidence.feedback} feedback responses · ${report.evidence.performanceResults} performance tests</div>
      </section>

      <section class="impact-section">
        <div class="impact-section-heading"><div><span>Visible evidence</span><h2>What is moving?</h2></div></div>
        <div class="impact-component-grid">
          ${componentCard("Fuelling behaviour", report.components.behavior, `${report.components.behavior.eligible} eligible signals`)}
          ${componentCard("Training experience", report.components.trainingExperience, `${report.baseline.feedbackCount + report.current.feedbackCount} feedback responses in comparison windows`)}
          ${componentCard("Performance outcomes", report.components.performanceOutcomes, `${outcomeCount} of ${report.outcomes.length} outcomes comparable`)}
        </div>
        <p class="impact-claims-note">This is observational evidence. Fuel Guard reports changes that occurred during the same period; it does not claim that fuelling caused a performance outcome.</p>
      </section>

      <section class="impact-section">
        <div class="impact-section-heading">
          <div><span>Primary outcomes</span><h2>Baseline to current</h2></div>
          <small>${escape(report.outcomes.length)} of 3 selected</small>
        </div>
        <div class="impact-outcome-grid">${report.outcomes.length ? report.outcomes.map(outcomeCard).join("") : `<p class="impact-empty">Choose a performance outcome below to establish what better performance means for you.</p>`}</div>
      </section>

      <section class="impact-section">
        <div class="impact-section-heading impact-report-heading">
          <div><span>Comparison report</span><h2>${escape(RANGE_LABELS[impactState.range])}</h2><small>${escape(report.period.display)}</small></div>
          <label class="impact-range-label">Period<select id="impactRangeSelect">
            ${Object.entries(RANGE_LABELS).map(([value, label]) => `<option value="${value}"${impactState.range === value ? " selected" : ""}>${escape(label)}</option>`).join("")}
          </select></label>
        </div>
        <div class="impact-window-labels"><span>Baseline · ${escape(report.period.baseline.display)}</span><span>Current · ${escape(report.period.current.display)}</span></div>
        <div class="impact-report-columns">
          <article><h3>Fuelling behaviour</h3>${signalsMarkup(report.signals.behavior)}</article>
          <article><h3>Training experience</h3>${signalsMarkup(report.signals.training)}</article>
        </div>
        <details class="impact-calculation-note">
          <summary>View calculation and sample rules</summary>
          <p>Fuel/Hydration coverage compares 14-day windows. Gap measures need five measurable days in each window. Pre/post-training and feedback measures need three completed sessions or responses in each window. Outcome results need two dates at least 14 days apart.</p>
        </details>
      </section>
    `;
  }

  function presetSetupMarkup() {
    const metrics = activeMetrics();
    const presets = PRESETS[impactState.sport] || [];
    const activeKeys = new Set(metrics.map(metric => metric.preset_key).filter(Boolean));
    return `
      <section class="impact-section impact-setup">
        <div class="impact-section-heading"><div><span>Set your direction</span><h2>What does better performance look like for you?</h2></div><small>${metrics.length}/3 selected</small></div>
        <label class="impact-sport-select">Sport<select id="impactSportSelect">
          ${Object.entries(SPORT_LABELS).map(([value, label]) => `<option value="${value}"${impactState.sport === value ? " selected" : ""}>${escape(label)}</option>`).join("")}
        </select></label>
        ${metrics.length ? `<div class="impact-selected-metrics">${metrics.map(metric => `<div><span>${escape(metric.name)} · ${escape(metric.unit)}</span><button type="button" class="secondary" data-impact-archive-metric="${escape(metric.id)}">Change</button></div>`).join("")}</div>` : ""}
        ${presets.length ? `<div class="impact-preset-grid">${presets.map(preset => `<button type="button" class="impact-preset" data-impact-preset="${escape(preset.key)}"${metrics.length >= 3 || activeKeys.has(preset.key) ? " disabled" : ""}><strong>${escape(preset.name)}</strong><span>${escape(preset.unit)} · ${preset.direction === "lower" ? "Lower is better" : "Higher is better"}</span></button>`).join("")}</div>` : `<p class="impact-empty">Add a custom metric that is meaningful to your sport.</p>`}
        <details class="impact-custom-metric"${presets.length ? "" : " open"}>
          <summary>+ Add custom performance metric</summary>
          <div class="impact-form-grid">
            <label>Metric name<input id="impactCustomName" type="text" maxlength="100" placeholder="e.g. 20 m sprint"></label>
            <label>Unit<input id="impactCustomUnit" type="text" maxlength="24" placeholder="e.g. sec, cm, kg"></label>
            <label>Result format<select id="impactCustomMeasurement"><option value="number">Number</option><option value="duration_seconds">Time (mm:ss or h:mm:ss)</option></select></label>
            <label>Better means<select id="impactCustomDirection"><option value="higher">Higher</option><option value="lower">Lower</option><option value="target_range">Within a target range</option></select></label>
            <label data-impact-target-field hidden>Target minimum<input id="impactCustomTargetMin" type="number" step="any" inputmode="decimal"></label>
            <label data-impact-target-field hidden>Target maximum<input id="impactCustomTargetMax" type="number" step="any" inputmode="decimal"></label>
          </div>
          <button type="button" class="secondary" data-impact-save-custom${metrics.length >= 3 ? " disabled" : ""}>Save custom metric</button>
        </details>
        <p class="impact-note">Changing a selected metric archives it; existing result history is retained.</p>
      </section>
    `;
  }

  function resultEntryMarkup() {
    const metrics = activeMetrics();
    if (!metrics.length) return "";
    return `
      <section class="impact-section">
        <div class="impact-section-heading"><div><span>Athlete entry</span><h2>Add a performance result</h2></div><small>Source: Athlete entry</small></div>
        <div class="impact-form-grid">
          <label>Performance outcome<select id="impactResultMetric">${metrics.map(metric => `<option value="${escape(metric.id)}">${escape(metric.name)}</option>`).join("")}</select></label>
          <label>Date<input id="impactResultDate" type="date" value="${escape(domain().dateKey(new Date()))}"></label>
          <label>Result<input id="impactResultValue" type="text" inputmode="decimal" placeholder="Number or mm:ss"></label>
          <label>Notes (optional)<input id="impactResultNotes" type="text" maxlength="500" placeholder="Test conditions or context"></label>
        </div>
        <button type="button" class="primary" data-impact-save-result>Save result</button>
      </section>
    `;
  }

  function historyMarkup() {
    const groups = impactState.metrics.map(metric => ({
      metric,
      results: impactState.results.filter(result => result.metric_id === metric.id).sort((left, right) => right.observed_on.localeCompare(left.observed_on))
    })).filter(group => group.results.length);
    if (!groups.length) return "";
    return `
      <section class="impact-section">
        <div class="impact-section-heading"><div><span>Outcome history</span><h2>Your recorded tests</h2></div></div>
        <div class="impact-history-list">${groups.map(group => `
          <details>
            <summary><span>${escape(group.metric.name)}${group.metric.archived_at ? " · Archived" : ""}</span><strong>${group.results.length} result${group.results.length === 1 ? "" : "s"}</strong></summary>
            ${group.results.map(result => `<div class="impact-history-row"><span>${escape(result.observed_on)}</span><strong>${formatMetricValue(group.metric, result.value)}</strong><small>Source: Athlete entry${result.notes ? ` · ${escape(result.notes)}` : ""}</small></div>`).join("")}
          </details>
        `).join("")}</div>
      </section>
    `;
  }

  function pendingFeedbackSession() {
    const feedbackSessionIds = new Set(impactState.feedback.map(item => String(item.training_mode_session_id || "")));
    return [...impactState.trainingSessions, ...localTrainingSessions()]
      .filter(session => session.status === "completed" && (session.ended_at || session.endedAt) && !feedbackSessionIds.has(String(session.id)))
      .sort((left, right) => new Date(right.ended_at || right.endedAt) - new Date(left.ended_at || left.endedAt))[0] || null;
  }

  function feedbackMarkup() {
    const session = pendingFeedbackSession();
    const count = impactState.feedback.length;
    if (!session) {
      return `
        <section class="impact-section impact-feedback-complete">
          <div class="impact-section-heading"><div><span>Training experience</span><h2>Post-training feedback</h2></div><small>${count} response${count === 1 ? "" : "s"}</small></div>
          <p class="impact-empty">Complete a Training Mode session to add a few-second energy and completion check-in.</p>
        </section>
      `;
    }
    return `
      <section class="impact-section impact-feedback" data-impact-feedback-session="${escape(session.id)}">
        <div class="impact-section-heading"><div><span>Optional · few seconds</span><h2>How did training feel?</h2><small>${escape(session.title || "Training session")} · ${escape(domain().dateKey(session.ended_at || session.endedAt))}</small></div></div>
        <div class="impact-feedback-group" role="group" aria-label="Training energy">
          <button type="button" data-impact-energy="strong">Strong</button>
          <button type="button" data-impact-energy="normal">Normal</button>
          <button type="button" data-impact-energy="low_energy">Low energy</button>
        </div>
        <div class="impact-feedback-question"><strong>Did you complete the session as planned?</strong></div>
        <div class="impact-feedback-group" role="group" aria-label="Session completion">
          <button type="button" data-impact-completion="yes">Yes</button>
          <button type="button" data-impact-completion="partially">Partially</button>
          <button type="button" data-impact-completion="no">No</button>
        </div>
        <button type="button" class="primary" data-impact-save-feedback disabled>Save feedback</button>
        <p class="impact-note">Source: Athlete entry. Optional feedback supports association analysis; it is not a medical assessment.</p>
      </section>
    `;
  }

  function render() {
    const target = document.getElementById("athleteImpactSurface");
    if (!target) return;
    const signedIn = Boolean(cloud()?.user?.id);
    if (!signedIn) {
      target.innerHTML = `
        <section class="impact-hero neutral"><div class="impact-eyebrow">Performance Impact</div><h1>Connect your evidence</h1><p>Log in to choose performance outcomes, keep result history and build a private Fuel Guard baseline.</p><button type="button" class="primary" data-open-screen="checklist">Open Profile &amp; Settings</button></section>
      `;
      return;
    }
    if (impactState.loading && !impactState.loaded) {
      target.innerHTML = `<section class="impact-hero neutral"><div class="impact-eyebrow">Performance Impact</div><h1>Loading your evidence…</h1></section>`;
      return;
    }
    if (impactState.error) {
      target.innerHTML = `<section class="impact-hero negative"><div class="impact-eyebrow">Performance Impact</div><h1>Impact data is unavailable</h1><p>${escape(impactState.error)}</p><button type="button" class="secondary" data-impact-refresh>Try again</button></section>`;
      return;
    }
    const report = currentReport();
    target.innerHTML = `
      ${impactState.message ? `<div class="impact-status-message" role="status">${escape(impactState.message)}</div>` : ""}
      ${reportMarkup(report)}
      ${feedbackMarkup()}
      ${resultEntryMarkup()}
      ${presetSetupMarkup()}
      ${historyMarkup()}
    `;
  }

  async function load({ force = false } = {}) {
    const userId = cloud()?.user?.id || "";
    const client = cloud()?.client;
    if (!userId || !client?.from) {
      impactState = { ...impactState, userId: "", loading: false, loaded: false, metrics: [], results: [], feedback: [], trainingSessions: [], garminActivities: [], error: "" };
      render();
      return;
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
        sport: metrics.find(metric => !metric.archived_at)?.sport_type || impactState.sport,
        error: ""
      };
    } catch (error) {
      impactState = { ...impactState, loading: false, loaded: true, error: error?.message || "Could not load Performance Impact." };
    }
    render();
  }

  async function saveMetric(preset) {
    const user = cloud()?.user;
    const client = cloud()?.client;
    const metrics = activeMetrics();
    if (!user?.id || !client?.from || metrics.length >= 3 || impactState.saving) return;
    const openSlot = [1, 2, 3].find(slot => !metrics.some(metric => metric.display_order === slot));
    if (!openSlot) return;
    impactState.saving = true;
    try {
      const row = {
        id: uuid(),
        user_id: user.id,
        sport_type: impactState.sport,
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
      impactState.message = `${preset.name} added as a primary outcome.`;
    } catch (error) {
      impactState.message = error?.message || "Could not save that metric.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  async function archiveMetric(metricId) {
    const client = cloud()?.client;
    const userId = cloud()?.user?.id;
    if (!client?.from || !userId || impactState.saving) return;
    impactState.saving = true;
    try {
      const archivedAt = new Date().toISOString();
      const result = await client.from(METRICS_TABLE).update({ archived_at: archivedAt }).eq("id", metricId).eq("user_id", userId).select(METRIC_COLUMNS).single();
      if (result.error) throw result.error;
      impactState.metrics = impactState.metrics.map(metric => metric.id === metricId ? result.data : metric);
      impactState.message = "Metric changed. Its result history remains available.";
    } catch (error) {
      impactState.message = error?.message || "Could not change that metric.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  async function saveResult() {
    const client = cloud()?.client;
    const user = cloud()?.user;
    const metric = metricById(document.getElementById("impactResultMetric")?.value);
    const observedOn = domain().validDateKey(document.getElementById("impactResultDate")?.value);
    const value = parseMetricValue(metric, document.getElementById("impactResultValue")?.value);
    const notes = String(document.getElementById("impactResultNotes")?.value || "").trim();
    if (!client?.from || !user?.id || !metric || !observedOn || value === null) {
      impactState.message = metric?.measurement_type === "duration_seconds" ? "Enter a valid result such as 27:51." : "Enter a valid dated result.";
      render();
      return;
    }
    impactState.saving = true;
    try {
      const row = { id: uuid(), user_id: user.id, metric_id: metric.id, observed_on: observedOn, value, source: "athlete_entry", notes: notes || null };
      const result = await client.from(RESULTS_TABLE).insert(row).select(RESULT_COLUMNS).single();
      if (result.error) throw result.error;
      impactState.results = [...impactState.results, result.data];
      impactState.message = `${metric.name} result saved.`;
    } catch (error) {
      impactState.message = error?.message || "Could not save that result.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  async function saveFeedback(button) {
    const section = button.closest("[data-impact-feedback-session]");
    const sessionId = section?.dataset.impactFeedbackSession;
    const session = [...impactState.trainingSessions, ...localTrainingSessions()].find(item => String(item.id) === String(sessionId));
    const energy = section?.querySelector("[data-impact-energy].selected")?.dataset.impactEnergy;
    const completion = section?.querySelector("[data-impact-completion].selected")?.dataset.impactCompletion;
    const client = cloud()?.client;
    const user = cloud()?.user;
    if (!session || !energy || !completion || !client?.from || !user?.id) return;
    impactState.saving = true;
    try {
      const row = {
        id: uuid(),
        user_id: user.id,
        training_mode_session_id: session.id,
        activity_source: "training_mode",
        activity_external_id: null,
        session_started_at: session.started_at || session.startedAt,
        session_ended_at: session.ended_at || session.endedAt,
        energy_rating: energy,
        session_completion: completion,
        source: "athlete_entry"
      };
      const result = await client.from(FEEDBACK_TABLE).insert(row).select(FEEDBACK_COLUMNS).single();
      if (result.error) throw result.error;
      impactState.feedback = [result.data, ...impactState.feedback];
      impactState.message = "Training feedback saved.";
    } catch (error) {
      impactState.message = error?.message || "Could not save training feedback.";
    } finally {
      impactState.saving = false;
      render();
    }
  }

  document.addEventListener("click", event => {
    const presetButton = event.target.closest("[data-impact-preset]");
    if (presetButton) {
      const preset = (PRESETS[impactState.sport] || []).find(item => item.key === presetButton.dataset.impactPreset);
      if (preset) saveMetric(preset);
      return;
    }
    const archiveButton = event.target.closest("[data-impact-archive-metric]");
    if (archiveButton) return archiveMetric(archiveButton.dataset.impactArchiveMetric);
    if (event.target.closest("[data-impact-save-custom]")) {
      const direction = document.getElementById("impactCustomDirection")?.value || "higher";
      const targetMinText = String(document.getElementById("impactCustomTargetMin")?.value || "").trim();
      const targetMaxText = String(document.getElementById("impactCustomTargetMax")?.value || "").trim();
      const targetMin = targetMinText ? Number(targetMinText) : NaN;
      const targetMax = targetMaxText ? Number(targetMaxText) : NaN;
      const custom = {
        key: null,
        name: String(document.getElementById("impactCustomName")?.value || "").trim(),
        unit: String(document.getElementById("impactCustomUnit")?.value || "").trim(),
        measurementType: document.getElementById("impactCustomMeasurement")?.value || "number",
        direction,
        targetMin,
        targetMax
      };
      if (!custom.name || !custom.unit || (direction === "target_range" && (!Number.isFinite(targetMin) || !Number.isFinite(targetMax) || targetMin > targetMax))) {
        impactState.message = "Complete the custom metric name, unit and any target range.";
        render();
      } else saveMetric(custom);
      return;
    }
    if (event.target.closest("[data-impact-save-result]")) return saveResult();
    const choice = event.target.closest("[data-impact-energy], [data-impact-completion]");
    if (choice) {
      const attribute = choice.dataset.impactEnergy ? "data-impact-energy" : "data-impact-completion";
      choice.closest(".impact-feedback")?.querySelectorAll(`[${attribute}]`).forEach(button => button.classList.toggle("selected", button === choice));
      const section = choice.closest(".impact-feedback");
      const saveButton = section?.querySelector("[data-impact-save-feedback]");
      if (saveButton) saveButton.disabled = !(section.querySelector("[data-impact-energy].selected") && section.querySelector("[data-impact-completion].selected"));
      return;
    }
    const feedbackButton = event.target.closest("[data-impact-save-feedback]");
    if (feedbackButton) return saveFeedback(feedbackButton);
    if (event.target.closest("[data-impact-refresh]")) load({ force: true });
  });

  document.addEventListener("change", event => {
    if (event.target.id === "impactSportSelect") {
      impactState.sport = event.target.value;
      render();
    }
    if (event.target.id === "impactRangeSelect") {
      impactState.range = event.target.value;
      render();
    }
    if (event.target.id === "impactCustomDirection") {
      document.querySelectorAll("[data-impact-target-field]").forEach(field => { field.hidden = event.target.value !== "target_range"; });
    }
  });

  window.addEventListener("fuelguard:cloud-status", () => load());
  window.addEventListener("fuelguard:training-session-ended", event => {
    impactState.trainingSessions = [event.detail?.session, ...impactState.trainingSessions.filter(session => session.id !== event.detail?.session?.id)].filter(Boolean);
    if (typeof switchScreen === "function") switchScreen("impact");
    load({ force: true });
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ force: true }); });
  document.addEventListener("DOMContentLoaded", () => load());
  requestAnimationFrame(() => load());

  window.AthleteImpact = {
    render,
    load,
    report: currentReport,
    _test: { parseMetricValue, formatMetricValue, durationValue, completedSessionWorkouts, PRESETS }
  };
})();
