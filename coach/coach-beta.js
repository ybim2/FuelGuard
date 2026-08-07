// Fuel Guard Coach Beta. Read-only coach views over explicitly shared athlete data.
(() => {
  const domain = window.FuelGuardDomain;
  const TABLES = {
    profiles: "fuel_user_profiles",
    relationships: "fuel_coach_athletes",
    logs: "fuel_logs",
    targets: "fuel_targets",
    reports: "fuel_coach_reports",
    interventions: "fuel_coach_interventions"
  };
  const PATTERN_TYPES = [
    { id: "fuel", label: "Fuel", empty: "No fuel logged today", noun: "fuel log" },
    { id: "hydration", label: "Hydration", empty: "No hydration logged today", noun: "hydration log" },
    { id: "sleepy", label: "Sleepy", empty: "No Sleepy events logged today", noun: "Sleepy event" }
  ];
  const BUCKETS = [
    { label: "06:00", start: 6, end: 9 },
    { label: "09:00", start: 9, end: 12 },
    { label: "12:00", start: 12, end: 15 },
    { label: "15:00", start: 15, end: 18 },
    { label: "18:00", start: 18, end: 21 },
    { label: "21:00", start: 21, end: 24 }
  ];
  const COACH_SIGNUP_EMAIL_KEY = "fuel_guard_coach_signup_email";

  const state = {
    client: null,
    session: null,
    profile: null,
    relationships: [],
    athleteProfiles: [],
    logs: [],
    targets: [],
    reports: [],
    interventions: [],
    roster: [],
    currentTab: "dashboard",
    selectedAthleteId: "",
    selectedReportAthleteId: "",
    reportPeriod: "12_weeks",
    generatedReport: null,
    selectedPattern: "fuel",
    search: "",
    busy: false,
    authBusyAction: "",
    coachAccessBlocked: false,
    status: ""
  };

  function $(id) {
    return document.getElementById(id);
  }

  function safe(value) {
    return domain.escapeHtml(value);
  }

  function configured() {
    const config = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    return Boolean(config.url && config.anonKey && window.supabase?.createClient);
  }

  function coachUser() {
    return state.session?.user || null;
  }

  function isCoachEnabled(profile = state.profile) {
    const role = String(profile?.role || "").toLowerCase();
    return Boolean(profile?.coach_enabled) || role === "coach";
  }

  function setStatus(message) {
    state.status = message || "";
    const target = $("coachGlobalStatus");
    if (target) target.textContent = state.status;
    const authStatus = $("coachAuthStatus");
    if (authStatus && !authStatus.hidden) authStatus.textContent = state.status;
    const accessStatus = $("coachAccessStatus");
    if (accessStatus && !accessStatus.hidden) accessStatus.textContent = state.status;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Something went wrong.");
    if (/invalid login credentials/i.test(message)) return "Those login details did not work. Check the email and password, then try again.";
    if (/email not confirmed|confirm/i.test(message)) return "Please confirm your email address before logging in.";
    if (/failed to fetch|network|load failed/i.test(message)) return "Could not reach Supabase. Check your connection and try again.";
    if (/supabase public url|anon key|configuration/i.test(message)) return "Coach Beta needs Supabase public URL/key configuration.";
    if (/fuel_user_profiles|fuel_coach_athletes|fuel_coach_reports|fuel_coach_interventions|maximum_fuel_gap_minutes|does not exist|schema cache/i.test(message)) {
      return "Coach sharing is still warming up. Refresh and try again in a moment.";
    }
    return message;
  }

  function rememberCoachSignup(email) {
    try {
      window.localStorage?.setItem(COACH_SIGNUP_EMAIL_KEY, String(email || "").toLowerCase());
    } catch (_error) {}
  }

  function consumeCoachSignup(user) {
    try {
      const saved = window.localStorage?.getItem(COACH_SIGNUP_EMAIL_KEY) || "";
      const matches = saved && String(user?.email || "").toLowerCase() === saved;
      if (matches) window.localStorage?.removeItem(COACH_SIGNUP_EMAIL_KEY);
      return matches;
    } catch (_error) {
      return false;
    }
  }

  function profileName(profile, relation) {
    return relation?.athlete_label || profile?.display_name || `Athlete ${String(relation?.athlete_id || profile?.user_id || "").slice(0, 8)}`;
  }

  function athleteRows() {
    const profileById = new Map(state.athleteProfiles.map(profile => [profile.user_id, profile]));
    return state.relationships
      .filter(relation => relation.status === "active")
      .map(relation => {
        const profile = profileById.get(relation.athlete_id) || {};
        return {
          userId: relation.athlete_id,
          displayName: profileName(profile, relation),
          relationId: relation.id,
          relationStatus: relation.status,
          profile
        };
      });
  }

  function targetsByUser() {
    return state.targets.reduce((map, row) => {
      map[row.user_id] = {
        dailyFuelLogs: row.daily_fuel_logs,
        dailyHydrationLogs: row.daily_hydration_logs,
        maximumFuelGapMinutes: row.maximum_fuel_gap_minutes
      };
      return map;
    }, {});
  }

  function rebuildRoster() {
    state.roster = domain.buildCoachRoster({
      athletes: athleteRows(),
      logs: state.logs,
      targetsByUser: targetsByUser(),
      now: new Date()
    });
    if (!state.selectedAthleteId && state.roster[0]) state.selectedAthleteId = state.roster[0].athlete.userId;
  }

  function currentStatusCopy(item) {
    if (!item.lastFuel) return "No fuel logged today yet.";
    if (item.beyondFuelGapMinutes !== null) return `${domain.duration(item.beyondFuelGapMinutes)} beyond target`;
    if (item.remainingFuelGapMinutes !== null) return `${domain.duration(item.remainingFuelGapMinutes)} until target`;
    return "Fuel timing visible";
  }

  function flagTone(flag) {
    if (!flag) return "steady";
    if (flag.id === "gap_exceeded") return "critical";
    if (flag.id === "gap_approaching") return "warning";
    return "steady";
  }

  function rosterRow(item, { compact = false } = {}) {
    const topFlag = item.flags[0] || null;
    const tone = topFlag ? flagTone(topFlag) : "steady";
    const id = safe(item.athlete.userId);
    return `
      <article class="coach-roster-row ${safe(tone)}">
        <div>
          <div class="coach-athlete-title">
            <strong>${safe(item.athlete.displayName)}</strong>
            <span class="coach-status-chip ${safe(item.status)}">${safe(item.statusLabel)}</span>
          </div>
          <div class="coach-row-meta">
            <span>${safe(currentStatusCopy(item))}</span>
            <span>${safe(item.fuelLogs.length)} fuel</span>
            <span>${safe(item.hydrationLogs.length)} hydration</span>
            <span>${safe(item.sleepyLogs.length)} Sleepy</span>
          </div>
          ${topFlag ? `<p class="coach-note">${safe(topFlag.detail)}</p>` : compact ? "" : `<p class="coach-note">No attention flag right now.</p>`}
        </div>
        <button type="button" data-open-athlete="${id}">View</button>
      </article>
    `;
  }

  function renderNeedsAttention() {
    const target = $("coachNeedsAttention");
    if (!target) return;
    const flagged = state.roster.filter(item => item.flags.length);
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading">
          <span class="coach-icon">!</span>
          <div>
            <h2>Needs Attention</h2>
            <p>Behavioural timing signals from athletes who have shared Fuel Guard logs with you.</p>
          </div>
        </div>
        <div class="coach-alert-list">
          ${flagged.length ? flagged.map(item => {
            const flag = item.flags[0];
            const tone = flagTone(flag);
            return `
              <article class="coach-alert-row ${safe(tone)}">
                <div class="coach-athlete-title">
                  <strong>${safe(item.athlete.displayName)}</strong>
                  <span class="coach-chip">${safe(flag.label)}</span>
                </div>
                <p>${safe(flag.detail)}</p>
                <div class="coach-mini-metrics">
                  <span>Status: ${safe(item.statusLabel)}</span>
                  <span>Last fuel: ${safe(item.lastFuel ? `${domain.duration(item.minutesSinceFuel)} ago` : "No fuel today")}</span>
                  <span>Sleepy: ${safe(item.sleepyLogs.length)}</span>
                </div>
              </article>
            `;
          }).join("") : `<div class="coach-empty">No athletes need attention right now.</div>`}
        </div>
      </section>
    `;
  }

  function renderRoster() {
    const target = $("coachRoster");
    if (!target) return;
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Roster</h2>
            <p>Sorted by current urgency: gap exceeded, approaching, repeated Sleepy events, then steady.</p>
          </div>
        </div>
        <div class="coach-list">
          ${state.roster.length ? state.roster.map(item => rosterRow(item, { compact: true })).join("") : `<div class="coach-empty">No active athlete sharing relationships yet.</div>`}
        </div>
      </section>
    `;
  }

  function renderAthleteList() {
    const target = $("coachAthleteList");
    if (!target) return;
    const query = state.search.trim().toLowerCase();
    const rows = state.roster.filter(item => {
      if (!query) return true;
      return `${item.athlete.displayName} ${item.athlete.userId}`.toLowerCase().includes(query);
    });
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-list">
          ${rows.length ? rows.map(item => rosterRow(item)).join("") : `<div class="coach-empty">No assigned athlete matches that search.</div>`}
        </div>
      </section>
    `;
  }

  function selectedAthleteStatus() {
    return state.roster.find(item => item.athlete.userId === state.selectedAthleteId) || state.roster[0] || null;
  }

  function eventIcon(log) {
    if (domain.isSleepyLog(log)) return "S";
    if (domain.isHydrationLog(log) && !domain.isFuelLog(log)) return "H";
    return "F";
  }

  function renderTimeline(logs) {
    const items = domain.logsWithDates(logs)
      .filter(log => domain.isFuelLog(log) || domain.isHydrationLog(log) || domain.isSleepyLog(log))
      .sort((a, b) => a.date - b.date);
    if (!items.length) return `<div class="coach-empty">No Fuel, Hydration, or Sleepy logs today.</div>`;
    return `
      <div class="coach-event-timeline" role="list">
        ${items.map(log => {
          const displayType = domain.isSleepyLog(log) ? "sleepy" : domain.isHydrationLog(log) && !domain.isFuelLog(log) ? "hydration" : "fuel";
          return `
            <article class="coach-event-row ${safe(displayType)}" role="listitem">
              <span class="coach-timeline-dot" aria-hidden="true">${safe(eventIcon(log))}</span>
              <div>
                <strong>${safe(domain.logTypeLabel(log))}</strong>
                <p class="coach-note">${safe(log.source === "garmin" ? "Garmin" : log.source === "csv_import" ? "Imported" : "Manual")}</p>
              </div>
              <time>${safe(domain.formatClock(log.date))}</time>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function patternDefinition() {
    return PATTERN_TYPES.find(type => type.id === state.selectedPattern) || PATTERN_TYPES[0];
  }

  function patternLogs(item) {
    const type = patternDefinition().id;
    return item.logs
      .filter(log => {
        if (type === "hydration") return domain.isHydrationLog(log);
        if (type === "sleepy") return domain.isSleepyLog(log);
        return domain.isFuelLog(log);
      })
      .map(log => ({ ...log, minute: domain.minutesIntoDay(log.date) }))
      .filter(log => Number.isFinite(log.minute))
      .sort((a, b) => a.minute - b.minute);
  }

  function patternBuckets(logs) {
    return BUCKETS.map(bucket => {
      const start = bucket.start * 60;
      const end = bucket.end * 60;
      const bucketLogs = logs.filter(log => log.minute >= start && log.minute < end);
      return {
        ...bucket,
        count: bucketLogs.length,
        times: bucketLogs.map(log => domain.formatClock(log.date))
      };
    });
  }

  function ticks(maxValue) {
    const max = Math.max(1, Math.ceil(Number(maxValue) || 0));
    const step = Math.max(1, Math.ceil(max / 3));
    const values = [];
    for (let value = 0; value <= max; value += step) values.push(value);
    if (values[values.length - 1] !== max) values.push(max);
    return values;
  }

  function renderPatternChart(item) {
    const pattern = patternDefinition();
    const logs = patternLogs(item);
    const buckets = patternBuckets(logs);
    const yTicks = ticks(Math.max(...buckets.map(bucket => bucket.count), 1));
    const yMax = yTicks[yTicks.length - 1] || 1;
    const width = 520;
    const height = 230;
    const padding = { top: 18, right: 18, bottom: 46, left: 42 };
    const bottom = height - padding.bottom;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = bottom - padding.top;
    const slot = plotWidth / buckets.length;
    const barWidth = Math.min(38, Math.max(20, slot * .52));
    const yFor = value => bottom - (Math.max(0, value) / yMax) * plotHeight;
    return `
      <div class="coach-pattern-chart" role="img" aria-label="${safe(pattern.label)} logs by time of day">
        <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${bottom}" x2="${width - padding.right}" y2="${bottom}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${bottom}"></line>
          ${yTicks.map(tick => {
            const y = yFor(tick);
            return `
              <line class="grid" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line>
              <text x="${padding.left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end">${safe(String(tick))}</text>
            `;
          }).join("")}
          ${buckets.map((bucket, index) => {
            const x = padding.left + slot * index + slot / 2;
            const barHeight = bucket.count ? Math.max(4, bottom - yFor(bucket.count)) : 0;
            const y = bottom - barHeight;
            const title = bucket.count
              ? `${bucket.label}: ${bucket.count} ${bucket.count === 1 ? pattern.noun : `${pattern.noun}s`} (${bucket.times.join(", ")})`
              : `${bucket.label}: 0`;
            return `
              <rect class="bar ${safe(pattern.id)}" x="${(x - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="8">
                <title>${safe(title)}</title>
              </rect>
              <text x="${x.toFixed(1)}" y="${height - 22}" text-anchor="middle">${safe(bucket.label)}</text>
            `;
          }).join("")}
        </svg>
        <p class="coach-note">${logs.length ? `${logs.length} ${logs.length === 1 ? pattern.noun : `${pattern.noun}s`} today.` : pattern.empty}</p>
      </div>
    `;
  }

  function recordsForAthlete(records, item) {
    const athleteId = String(item?.athlete?.userId || "");
    return (records || [])
      .filter(record => String(record.athlete_id || "") === athleteId)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }

  function nextActionText(item) {
    if (item.beyondFuelGapMinutes !== null) return "Check in and plan a gentle fuel moment before the next long gap.";
    if (item.flags.some(flag => flag.id === "sleepy_cluster")) return "Ask whether Sleepy events are clustering around a particular work, training, or rest window.";
    if (item.remainingFuelGapMinutes !== null) return "Support the athlete to fuel before the current gap reaches their target.";
    return "Keep observing the shared rhythm and agree the next practical support step.";
  }

  function round1(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  }

  function pct(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : "Not enough data";
  }

  function metricNumber(value, suffix = "") {
    return Number.isFinite(value) ? `${round1(value)}${suffix}` : "Not enough data";
  }

  function reportPeriodFromControls() {
    return domain.reviewPeriodRange({
      preset: $("coachReportPeriod")?.value || state.reportPeriod,
      customStart: $("coachReportStart")?.value,
      customEnd: $("coachReportEnd")?.value,
      now: new Date()
    });
  }

  function selectedReportAthlete() {
    const id = state.selectedReportAthleteId || state.selectedAthleteId || state.roster[0]?.athlete.userId || "";
    return state.roster.find(item => item.athlete.userId === id) || state.roster[0] || null;
  }

  function reportPayload(report) {
    return {
      coverage: report.coverage,
      consistency: report.consistency,
      fuelling: {
        averageFirstFuel: timeFromMinutes(report.fuelling.averageFirstFuelMinutes),
        averageFinalFuel: timeFromMinutes(report.fuelling.averageFinalFuelMinutes),
        averageGapMinutes: report.fuelling.averageGapMinutes,
        longestGapMinutes: report.fuelling.longestGapMinutes,
        gapsExceedingTarget: report.fuelling.gapsExceedingTarget,
        commonGapWindow: report.fuelling.commonGapWindow?.label || null,
        commonFuellingWindow: report.fuelling.commonFuellingWindow?.label || null
      },
      sleepy: report.sleepy,
      contexts: report.contexts,
      executiveSummary: report.executiveSummary,
      comparison: report.comparison,
      weekly: report.weekly
    };
  }

  function reportMetricRows(report) {
    return [
      ["Logging coverage", `${report.coverage.loggedDays} / ${report.coverage.totalDays} days`, pct(report.coverage.loggedPct)],
      ["Fuel logs / active day", metricNumber(report.consistency.avgFuelLogsPerActiveDay), "Average"],
      ["Hydration logs / active day", metricNumber(report.consistency.avgHydrationLogsPerActiveDay), "Average"],
      ["Days within gap target", pct(report.consistency.targetAdherencePct), `${report.consistency.daysExceedingTarget} days exceeded`],
      ["Average first fuel", timeFromMinutes(report.fuelling.averageFirstFuelMinutes), "Period average"],
      ["Average final fuel", timeFromMinutes(report.fuelling.averageFinalFuelMinutes), "Period average"],
      ["Average fuel gap", domain.duration(report.fuelling.averageGapMinutes), "Between fuel logs"],
      ["Longest fuel gap", domain.duration(report.fuelling.longestGapMinutes), "Longest meaningful gap"],
      ["Most common gap window", report.fuelling.commonGapWindow?.label || "Not enough gap data yet.", "Recurring gap"],
      ["Most common fuelling window", report.fuelling.commonFuellingWindow?.label || "Not enough log data yet.", "Recurring fuel time"],
      ["Sleepy events", String(report.sleepy.total), `${metricNumber(report.sleepy.averagePerActiveWeek, " / week")}`],
      ["Most common Sleepy window", report.sleepy.commonWindow?.label || "Not enough Sleepy data yet.", "Recurring Sleepy time"],
      ["Sleepy after long gap", report.sleepy.total ? `${report.sleepy.afterLongGapCount} / ${report.sleepy.total}` : "No Sleepy events", `>${domain.duration(report.sleepy.targetMinutes || 0)} target gap`]
    ];
  }

  function timeFromMinutes(minutes) {
    if (!Number.isFinite(minutes)) return "Not enough data";
    const date = domain.startOfLocalDay();
    date.setMinutes(Math.round(minutes));
    return domain.formatClock(date);
  }

  function reportTrendClass(direction) {
    if (direction === "improved") return "improved";
    if (direction === "declined") return "declined";
    return "stable";
  }

  function comparisonValue(item, value) {
    if (!Number.isFinite(value)) return "Not enough data";
    if (item.unit === "%") return `${Math.round(value)}%`;
    if (item.unit === "minutes") return domain.duration(value);
    return String(Math.round(value));
  }

  function comparisonDelta(item) {
    if (!Number.isFinite(item.difference)) return "";
    if (item.unit === "minutes") return `${item.difference > 0 ? "+" : ""}${domain.duration(Math.abs(item.difference))}`;
    if (item.unit === "%") return `${item.difference > 0 ? "+" : ""}${Math.round(item.difference)} percentage points`;
    return `${item.difference > 0 ? "+" : ""}${Math.round(item.difference)}`;
  }

  function renderMiniTrendChart(report) {
    const width = 620;
    const height = 220;
    const padding = { top: 20, right: 18, bottom: 42, left: 48 };
    const weekly = report.weekly || [];
    if (!weekly.length) return `<div class="coach-empty">Not enough weekly data to chart yet.</div>`;
    const gapValues = weekly.map(point => point.averageGapMinutes).filter(Number.isFinite);
    const maxGap = Math.max(60, ...gapValues, report.sleepy.total || 0);
    const xFor = index => padding.left + (weekly.length === 1 ? 0 : index * ((width - padding.left - padding.right) / (weekly.length - 1)));
    const yForGap = value => height - padding.bottom - (Math.max(0, value) / maxGap) * (height - padding.top - padding.bottom);
    const path = weekly.map((point, index) => Number.isFinite(point.averageGapMinutes) ? `${index ? "L" : "M"} ${xFor(index).toFixed(1)} ${yForGap(point.averageGapMinutes).toFixed(1)}` : "").filter(Boolean).join(" ");
    return `
      <div class="coach-report-chart" role="img" aria-label="Weekly average fuel gap trend">
        <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}"></line>
          <text class="axis-title" x="${padding.left}" y="14">Average fuel gap</text>
          <path class="trend-line" d="${safe(path)}"></path>
          ${weekly.map((point, index) => Number.isFinite(point.averageGapMinutes) ? `
            <circle class="trend-point" cx="${xFor(index).toFixed(1)}" cy="${yForGap(point.averageGapMinutes).toFixed(1)}" r="5">
              <title>${safe(`${point.label}: ${domain.duration(point.averageGapMinutes)}`)}</title>
            </circle>
            <text x="${xFor(index).toFixed(1)}" y="${height - 17}" text-anchor="middle">${safe(point.label.replace(/ .*$/, ""))}</text>
          ` : "").join("")}
        </svg>
      </div>
    `;
  }

  function renderReport(report) {
    if (!report) return `<section class="coach-card"><div class="coach-empty">Generate a review to preview structured report sections.</div></section>`;
    return `
      <section class="coach-report-document coach-card" data-report-document>
        <div class="coach-report-header">
          <div>
            <p class="coach-kicker">Athlete Review</p>
            <h2>${safe(report.title)}</h2>
            <p>${safe(report.period.display)}</p>
          </div>
          <div class="coach-report-meta">
            <span>Coach: ${safe(report.coachName)}</span>
            <span>Team: ${safe(report.organisationName || "Not set")}</span>
            <span>Generated: ${safe(domain.formatClock(report.generatedAt))} · ${safe(domain.dateKey(report.generatedAt))}</span>
          </div>
        </div>

        <section class="coach-report-section">
          <h3>Executive Summary</h3>
          <ul class="coach-report-list">
            ${report.executiveSummary.map(point => `<li>${safe(point)}</li>`).join("")}
          </ul>
        </section>

        <section class="coach-report-section">
          <h3>Data Coverage</h3>
          <div class="coach-detail-grid">
            <article class="coach-metric"><span>Total days</span><strong>${safe(report.coverage.totalDays)}</strong></article>
            <article class="coach-metric"><span>Logged days</span><strong>${safe(report.coverage.loggedDays)}</strong></article>
            <article class="coach-metric"><span>Coverage</span><strong>${safe(pct(report.coverage.loggedPct))}</strong></article>
            <article class="coach-metric"><span>Gap metric days</span><strong>${safe(report.coverage.metricDays)}</strong></article>
          </div>
          ${report.coverage.limited ? `<p class="coach-limited-note">Limited data coverage - interpret this period cautiously.</p>` : ""}
        </section>

        <section class="coach-report-section">
          <h3>Consistency and Fuelling Behaviour</h3>
          <div class="coach-report-table">
            ${reportMetricRows(report).map(row => `
              <div class="coach-report-row">
                <span>${safe(row[0])}</span>
                <strong>${safe(row[1])}</strong>
                <em>${safe(row[2])}</em>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="coach-report-section">
          <h3>Sleepy Patterns</h3>
          <p>${safe(report.sleepy.total ? `${report.sleepy.total} Sleepy event${report.sleepy.total === 1 ? " was" : "s were"} recorded in this period.` : "No Sleepy events were recorded in this period.")}</p>
          <p>${safe(report.sleepy.commonWindow ? `Most common Sleepy window: ${report.sleepy.commonWindow.label}.` : "Not enough Sleepy data to identify a recurring window yet.")}</p>
          ${report.sleepy.total ? `<p>${safe(`${report.sleepy.afterLongGapCount} of ${report.sleepy.total} Sleepy events occurred following fuel gaps longer than ${domain.duration(report.sleepy.targetMinutes || 0)}.`)}</p>` : ""}
          <p class="coach-note">Sleepy logs are observational markers. Fuel Guard does not infer a medical cause.</p>
        </section>

        <section class="coach-report-section">
          <h3>Context</h3>
          ${report.contexts.length ? `
            <div class="coach-context-bars">
              ${report.contexts.map(context => `
                <div class="coach-context-bar">
                  <span>${safe(context.label)}</span>
                  <div><i style="width:${safe(context.adherencePct)}%"></i></div>
                  <strong>${safe(context.adherencePct)}%</strong>
                </div>
              `).join("")}
            </div>
          ` : `<div class="coach-empty compact">Not enough context-specific data yet.</div>`}
        </section>

        <section class="coach-report-section">
          <h3>Previous Period Comparison</h3>
          <p class="coach-note">Current ${safe(report.period.display)} compared with ${safe(report.previousPeriod.display)}.</p>
          <div class="coach-comparison-grid">
            ${report.comparison.map(item => `
              <article class="coach-comparison-card ${safe(reportTrendClass(item.direction))}">
                <span>${safe(item.label)}</span>
                <strong>${safe(comparisonValue(item, item.current))}</strong>
                <p>Previous: ${safe(comparisonValue(item, item.previous))}</p>
                <em>${safe(item.trendLabel || "Not enough data")}</em>
                <small>${safe(comparisonDelta(item))}</small>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="coach-report-section">
          <h3>Report Trends</h3>
          ${renderMiniTrendChart(report)}
        </section>

        <section class="coach-report-section">
          <h3>Coach Observations</h3>
          <p>${safe(report.coachNotes || "No coach observations added yet.")}</p>
        </section>

        <section class="coach-report-section">
          <h3>Interventions</h3>
          ${renderInterventionList(report.interventions, report)}
        </section>

        <div class="coach-button-row coach-export-actions">
          <button class="secondary" type="button" data-export-report-pdf>Export PDF</button>
          <button class="secondary" type="button" data-export-report-csv>Export CSV</button>
        </div>
      </section>
    `;
  }

  function renderInterventionList(interventions = [], report = null) {
    if (!interventions.length) return `<div class="coach-empty compact">No interventions recorded for this athlete yet.</div>`;
    return `
      <div class="coach-intervention-timeline">
        ${interventions.map(intervention => {
          const comparison = report ? domain.interventionComparison({
            intervention,
            logs: report.sourceLogs || [],
            targets: { maximumFuelGapMinutes: report.sleepy?.targetMinutes || report.targetMinutes }
          }) : null;
          return `
            <details class="coach-intervention-item">
              <summary>
                <span>${safe(intervention.intervention_date || domain.dateKey(intervention.created_at))}</span>
                <strong>${safe(intervention.category || "Intervention")}</strong>
                <em>${safe(intervention.status || "active")}</em>
              </summary>
              <p><strong>Observation:</strong> ${safe(intervention.observation || intervention.notes || "Not recorded")}</p>
              <p><strong>Action:</strong> ${safe(intervention.action_text || "Not recorded")}</p>
              ${intervention.review_date ? `<p><strong>Review date:</strong> ${safe(intervention.review_date)}</p>` : ""}
              ${comparison ? `<p class="coach-note">${safe(comparison.label)}</p>` : ""}
            </details>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderReportPreview() {
    const target = $("coachReportPreview");
    if (!target) return;
    target.innerHTML = renderReport(state.generatedReport);
  }

  function renderReportControls() {
    const select = $("coachReportAthlete");
    if (select) {
      const current = state.selectedReportAthleteId || state.selectedAthleteId || state.roster[0]?.athlete.userId || "";
      select.innerHTML = state.roster.length
        ? state.roster.map(item => `<option value="${safe(item.athlete.userId)}"${item.athlete.userId === current ? " selected" : ""}>${safe(item.athlete.displayName)}</option>`).join("")
        : `<option value="">No assigned athletes</option>`;
      if (current) {
        select.value = current;
        state.selectedReportAthleteId = current;
      }
    }
    const today = domain.dateKey(new Date());
    if ($("coachReportEnd") && !$("coachReportEnd").value) $("coachReportEnd").value = today;
    if ($("coachInterventionDate") && !$("coachInterventionDate").value) $("coachInterventionDate").value = today;
    renderReportPreview();
  }

  function renderCoachActions(item) {
    const reports = recordsForAthlete(state.reports, item);
    const interventions = recordsForAthlete(state.interventions, item);
    const latestReport = reports[0];
    const openInterventions = interventions.filter(record => record.status === "active" || record.status === "open");
    return `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Coach Actions</h2>
            <p>Create read-only follow-up records from this athlete's shared timing data.</p>
          </div>
        </div>
        <div class="coach-action-grid">
          <article class="coach-action-panel">
            <strong>Athlete Review Report</strong>
            <p class="coach-note">${safe(latestReport ? latestReport.summary : "No structured review report generated for this athlete yet.")}</p>
            <button class="secondary" type="button" data-open-report-builder="${safe(item.athlete.userId)}">Generate review</button>
          </article>
          <article class="coach-action-panel">
            <strong>Intervention</strong>
            <p class="coach-note">${safe(openInterventions[0]?.action_text || nextActionText(item))}</p>
            <button class="secondary" type="button" data-open-intervention-builder="${safe(item.athlete.userId)}">Record intervention</button>
          </article>
        </div>
      </section>
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Coach Interventions</h2>
            <p>Simple timeline of practical support steps logged by this coach.</p>
          </div>
        </div>
        ${renderInterventionList(interventions)}
      </section>
    `;
  }

  function renderAthleteDetail() {
    const target = $("coachAthleteDetail");
    if (!target) return;
    const item = selectedAthleteStatus();
    if (!item) {
      target.innerHTML = `<section class="coach-card"><div class="coach-empty">Select an assigned athlete to review today's shared logs.</div></section>`;
      return;
    }
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>${safe(item.athlete.displayName)}</h2>
            <p>Read-only view for ${safe(domain.dateKey(new Date()))}. Coaches cannot edit or fabricate logs.</p>
          </div>
        </div>
        <div class="coach-detail-grid">
          <article class="coach-metric">
            <span>Current Status</span>
            <strong>${safe(item.statusLabel)}</strong>
          </article>
          <article class="coach-metric">
            <span>Last fuel</span>
            <strong>${safe(item.lastFuel ? `${domain.duration(item.minutesSinceFuel)} ago` : "No fuel today")}</strong>
          </article>
          <article class="coach-metric">
            <span>Fuel-gap target</span>
            <strong>${safe(item.beyondFuelGapMinutes !== null ? `${domain.duration(item.beyondFuelGapMinutes)} beyond` : item.remainingFuelGapMinutes !== null ? `${domain.duration(item.remainingFuelGapMinutes)} left` : `${domain.duration(item.maximumFuelGapMinutes)} target`)}</strong>
          </article>
          <article class="coach-metric">
            <span>Last hydration</span>
            <strong>${safe(item.lastHydration ? `${domain.duration(item.minutesSinceHydration)} ago` : "No hydration today")}</strong>
          </article>
        </div>
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Today</h2>
            <p>Timing and frequency only. No calories, weight, or medical interpretation.</p>
          </div>
        </div>
        <div class="coach-count-grid">
          <article class="coach-metric"><span>Fuel</span><strong>${safe(item.fuelLogs.length)}</strong></article>
          <article class="coach-metric"><span>Hydration</span><strong>${safe(item.hydrationLogs.length)}</strong></article>
          <article class="coach-metric"><span>Sleepy</span><strong>${safe(item.sleepyLogs.length)}</strong></article>
          <article class="coach-metric"><span>Source mix</span><strong>${safe(sourceSummary(item.logs))}</strong></article>
        </div>
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Timeline</h2>
            <p>Chronological Fuel, Hydration, and Sleepy events shared by the athlete.</p>
          </div>
        </div>
        ${renderTimeline(item.logs)}
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Today's Patterns</h2>
            <p>Switch between event types to see when they happened today.</p>
          </div>
        </div>
        <nav class="coach-pattern-tabs" aria-label="Pattern type">
          ${PATTERN_TYPES.map(type => `
            <button class="${state.selectedPattern === type.id ? "active" : ""}" type="button" data-coach-pattern="${safe(type.id)}" aria-pressed="${state.selectedPattern === type.id ? "true" : "false"}">${safe(type.label)}</button>
          `).join("")}
        </nav>
        ${renderPatternChart(item)}
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Context</h2>
            <p>Context comes from shared day labels and Garmin-derived records when available.</p>
          </div>
        </div>
        <div class="coach-context-grid">
          <article class="coach-metric"><span>Day</span><strong>${safe(item.context.dayTypeLabel)}</strong></article>
          <article class="coach-metric"><span>Session</span><strong>${safe(item.context.trainingSessionLabel)}</strong></article>
          <article class="coach-metric"><span>Garmin logs</span><strong>${safe(item.logs.filter(log => log.source === "garmin").length)}</strong></article>
          <article class="coach-metric"><span>Flags</span><strong>${safe(item.flags.length ? item.flags.map(flag => flag.label).join(", ") : "None")}</strong></article>
        </div>
      </section>

      ${renderCoachActions(item)}
    `;
  }

  function sourceSummary(logs) {
    const garmin = logs.filter(log => log.source === "garmin").length;
    const manual = logs.length - garmin;
    if (garmin && manual) return "Mixed";
    if (garmin) return "Garmin";
    return manual ? "Manual" : "None";
  }

  function renderRelationships() {
    const target = $("coachRelationshipList");
    if (!target) return;
    target.innerHTML = state.relationships.length
      ? state.relationships.map(relation => `
        <article class="coach-relationship-row">
          <div>
            <strong>${safe(relation.athlete_label || `Athlete ${String(relation.athlete_id).slice(0, 8)}`)}</strong>
            <p class="coach-note">${safe(relation.athlete_id)}</p>
          </div>
          <div class="coach-row-meta">
            <span>Status: ${safe(relation.status)}</span>
            <span>${relation.status === "active" ? "Sharing active" : relation.status === "pending" ? "Waiting for athlete approval" : "Revoked"}</span>
          </div>
          <div class="coach-button-row">
            <button class="secondary" type="button" data-revoke-relationship="${safe(relation.id)}">Remove</button>
          </div>
        </article>
      `).join("")
      : `<div class="coach-empty">No relationships yet. Add an athlete user ID to request sharing.</div>`;
  }

  function renderSettings() {
    const user = coachUser();
    const displayName = $("coachDisplayName");
    const userId = $("coachUserId");
    if (displayName && document.activeElement !== displayName) displayName.value = state.profile?.display_name || "";
    if (userId) userId.value = user?.id || "";
    renderRelationships();
  }

  function renderAuth() {
    const authPanel = $("coachAuthPanel");
    const accessPanel = $("coachAccessPanel");
    const appShell = $("coachAppShell");
    const signedIn = Boolean(coachUser());
    const coachReady = signedIn && isCoachEnabled();
    if (authPanel) authPanel.hidden = signedIn;
    if (accessPanel) accessPanel.hidden = !signedIn || coachReady || !state.coachAccessBlocked;
    if (appShell) appShell.hidden = !coachReady;
  }

  function renderTabs() {
    document.querySelectorAll("[data-coach-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.coachTab === state.currentTab);
    });
    document.querySelectorAll(".coach-panel").forEach(panel => {
      panel.classList.toggle("active", panel.id === `coach${state.currentTab[0].toUpperCase()}${state.currentTab.slice(1)}Panel`);
    });
  }

  function render() {
    renderAuth();
    renderTabs();
    renderNeedsAttention();
    renderRoster();
    renderAthleteList();
    renderAthleteDetail();
    renderReportControls();
    renderSettings();
  }

  async function ensureCoachProfile({ enableCoach = false } = {}) {
    const user = coachUser();
    if (!state.client || !user) return;

    const { data: profile, error: profileError } = await state.client
      .from(TABLES.profiles)
      .select("user_id,role,coach_enabled,display_name,created_at,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (!profile) {
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .upsert({
          user_id: user.id,
          role: "athlete",
          coach_enabled: Boolean(enableCoach),
          display_name: user.email || "Coach",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })
        .select("user_id,role,coach_enabled,display_name,created_at,updated_at")
        .single();
      if (error) throw error;
      state.profile = data;
    } else {
      state.profile = profile;
    }

    if (enableCoach && !isCoachEnabled()) {
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .update({ coach_enabled: true, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select("user_id,role,coach_enabled,display_name,created_at,updated_at")
        .single();
      if (error) throw error;
      state.profile = data;
    }

    return state.profile;
  }

  async function loadCoachData({ enableCoach = false } = {}) {
    const user = coachUser();
    if (!state.client || !user) return;
    setStatus("Loading coach data...");
    state.coachAccessBlocked = false;

    await ensureCoachProfile({ enableCoach });

    if (!isCoachEnabled()) {
      state.coachAccessBlocked = true;
      state.relationships = [];
      state.athleteProfiles = [];
      state.logs = [];
      state.targets = [];
      state.reports = [];
      state.interventions = [];
      state.roster = [];
      setStatus("Coach Beta is not enabled for this account yet.");
      render();
      return;
    }

    const { data: relationships, error: relationshipError } = await state.client
      .from(TABLES.relationships)
      .select("id,coach_id,athlete_id,status,athlete_label,created_at,accepted_at,revoked_at")
      .eq("coach_id", user.id)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false });
    if (relationshipError) throw relationshipError;
    state.relationships = relationships || [];

    const athleteIds = state.relationships.filter(relation => relation.status === "active").map(relation => relation.athlete_id);
    state.athleteProfiles = [];
    state.logs = [];
    state.targets = [];
    state.reports = [];
    state.interventions = [];

    if (athleteIds.length) {
      const { data: profiles, error: profilesError } = await state.client
        .from(TABLES.profiles)
        .select("user_id,role,coach_enabled,display_name,created_at,updated_at")
        .in("user_id", athleteIds);
      if (profilesError) throw profilesError;
      state.athleteProfiles = profiles || [];

      const start = domain.startOfLocalDay().toISOString();
      const end = domain.endOfLocalDay().toISOString();
      const { data: logs, error: logsError } = await state.client
        .from(TABLES.logs)
        .select("id,user_id,logged_at,type,source,external_event_id,day_type,training_session,notes,created_at")
        .in("user_id", athleteIds)
        .gte("logged_at", start)
        .lt("logged_at", end)
        .order("logged_at", { ascending: true });
      if (logsError) throw logsError;
      state.logs = (logs || []).map(domain.normalizeLog).filter(Boolean);

      const { data: targets, error: targetsError } = await state.client
        .from(TABLES.targets)
        .select("user_id,daily_fuel_logs,daily_hydration_logs,maximum_fuel_gap_minutes,updated_at")
        .in("user_id", athleteIds);
      if (targetsError && /maximum_fuel_gap_minutes|schema cache|does not exist/i.test(targetsError.message || "")) {
        const legacy = await state.client
          .from(TABLES.targets)
          .select("user_id,daily_fuel_logs,daily_hydration_logs,updated_at")
          .in("user_id", athleteIds);
        if (legacy.error) throw legacy.error;
        state.targets = legacy.data || [];
      } else if (targetsError) {
        throw targetsError;
      } else {
        state.targets = targets || [];
      }

      const { data: reports, error: reportsError } = await state.client
        .from(TABLES.reports)
        .select("*")
        .eq("coach_id", user.id)
        .in("athlete_id", athleteIds)
        .order("created_at", { ascending: false });
      if (reportsError) throw reportsError;
      state.reports = reports || [];

      const { data: interventions, error: interventionsError } = await state.client
        .from(TABLES.interventions)
        .select("*")
        .eq("coach_id", user.id)
        .in("athlete_id", athleteIds)
        .order("created_at", { ascending: false });
      if (interventionsError) throw interventionsError;
      state.interventions = interventions || [];
    }

    rebuildRoster();
    setStatus(`Loaded ${state.roster.length} active athlete${state.roster.length === 1 ? "" : "s"}.`);
    render();
  }

  async function withBusy(button, callback) {
    if (state.busy) return;
    state.busy = true;
    state.authBusyAction = button?.id || "";
    const originalText = button?.textContent || "";
    if (button) button.disabled = true;
    if (button?.id === "coachSignInButton") button.textContent = "Signing in...";
    if (button?.id === "coachSignUpButton") button.textContent = "Creating...";
    if (button?.id === "coachForgotPasswordButton") button.textContent = "Sending...";
    if (button?.id === "coachEnableAccessButton") button.textContent = "Enabling...";
    try {
      await callback();
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      state.busy = false;
      state.authBusyAction = "";
      if (button) button.disabled = false;
      if (button && originalText) button.textContent = originalText;
    }
  }

  async function signIn() {
    await withBusy($("coachSignInButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      const password = $("coachPassword")?.value || "";
      if (!email || !password) throw new Error("Enter an email and password.");
      setStatus("Signing in...");
      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data?.session?.access_token || !data?.user?.id) throw new Error("Supabase signed in, but no session was created.");
      state.session = data.session;
      render();
      await loadCoachData();
    });
  }

  async function signUp() {
    await withBusy($("coachSignUpButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      const password = $("coachPassword")?.value || "";
      if (!email || !password) throw new Error("Enter an email and password.");
      setStatus("Creating coach account...");
      rememberCoachSignup(email);
      const { data, error } = await state.client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/coach/` }
      });
      if (error) throw error;
      state.session = data.session || state.session;
      setStatus(data.session ? "Coach account created." : "Confirmation email sent. Check your inbox.");
      if (data.session) await loadCoachData({ enableCoach: true });
    });
  }

  async function forgotPassword() {
    await withBusy($("coachForgotPasswordButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      if (!email) throw new Error("Enter your email before requesting a password reset.");
      const { error } = await state.client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/coach/`
      });
      if (error) throw error;
      setStatus("Password reset email sent. Check your inbox before requesting another one.");
    });
  }

  async function enableCoachAccess() {
    await withBusy($("coachEnableAccessButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      setStatus("Enabling Coach Beta for this account...");
      await ensureCoachProfile({ enableCoach: true });
      state.coachAccessBlocked = false;
      await loadCoachData();
    });
  }

  async function signOut() {
    await state.client?.auth.signOut();
    state.session = null;
    state.profile = null;
    state.coachAccessBlocked = false;
    state.relationships = [];
    state.athleteProfiles = [];
    state.logs = [];
    state.targets = [];
    state.reports = [];
    state.interventions = [];
    state.roster = [];
    setStatus("Signed out.");
    render();
  }

  async function saveProfile() {
    await withBusy($("coachSaveProfileButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const displayName = $("coachDisplayName")?.value?.trim() || user.email || "Coach";
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .upsert({
          user_id: user.id,
          role: state.profile?.role || "athlete",
          coach_enabled: isCoachEnabled(),
          display_name: displayName,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })
        .select("user_id,role,coach_enabled,display_name,created_at,updated_at")
        .single();
      if (error) throw error;
      state.profile = data;
      setStatus("Coach profile saved.");
      renderSettings();
    });
  }

  async function requestSharing() {
    await withBusy($("coachInviteButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const athleteId = $("coachInviteAthleteId")?.value?.trim();
      const label = $("coachInviteAthleteLabel")?.value?.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(athleteId || "")) {
        throw new Error("Enter a valid athlete Supabase user ID.");
      }
      const row = {
        coach_id: user.id,
        athlete_id: athleteId,
        status: "pending",
        athlete_label: label || null,
        updated_at: new Date().toISOString()
      };
      const { error } = await state.client
        .from(TABLES.relationships)
        .upsert(row, { onConflict: "coach_id,athlete_id" });
      if (error) throw error;
      $("coachInviteAthleteId").value = "";
      $("coachInviteAthleteLabel").value = "";
      setStatus("Sharing requested. Athlete data stays private until they approve.");
      await loadCoachData();
    });
  }

  async function revokeRelationship(id) {
    await withBusy(null, async () => {
      const { error } = await state.client
        .from(TABLES.relationships)
        .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setStatus("Relationship removed.");
      await loadCoachData();
    });
  }

  function targetForAthlete(athleteId) {
    return targetsByUser()[athleteId] || {};
  }

  async function fetchAthleteLogs(athleteId, start, end) {
    const { data, error } = await state.client
      .from(TABLES.logs)
      .select("id,user_id,logged_at,type,source,external_event_id,day_type,training_session,notes,created_at")
      .eq("user_id", athleteId)
      .gte("logged_at", domain.startOfLocalDay(domain.dateKey(start)).toISOString())
      .lte("logged_at", domain.endOfLocalDay(domain.dateKey(end)).toISOString())
      .order("logged_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(domain.normalizeLog).filter(Boolean);
  }

  async function generateReport() {
    await withBusy(null, async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const item = selectedReportAthlete();
      if (!item) throw new Error("Select an assigned athlete first.");
      const period = reportPeriodFromControls();
      const previous = domain.previousPeriodRange(period);
      const currentLogs = await fetchAthleteLogs(item.athlete.userId, period.start, period.end);
      const previousLogs = await fetchAthleteLogs(item.athlete.userId, previous.start, previous.end);
      const interventions = recordsForAthlete(state.interventions, item);
      const report = domain.buildAthleteReviewReport({
        athlete: item.athlete,
        coach: { ...state.profile, email: user.email, id: user.id },
        organisationName: $("coachOrganisationName")?.value?.trim() || "",
        logs: currentLogs,
        previousLogs,
        targets: targetForAthlete(item.athlete.userId),
        period,
        interventions,
        coachNotes: $("coachReportNotes")?.value || "",
        generatedAt: new Date()
      });
      report.sourceLogs = currentLogs.concat(previousLogs);
      const now = new Date().toISOString();
      const { data, error } = await state.client
        .from(TABLES.reports)
        .insert({
          coach_id: user.id,
          athlete_id: item.athlete.userId,
          report_date: domain.dateKey(new Date()),
          period_start: report.period.startKey,
          period_end: report.period.endKey,
          period_type: report.period.preset,
          title: report.title,
          summary: report.executiveSummary.join(" "),
          coach_notes: report.coachNotes || null,
          organisation_name: report.organisationName || null,
          metrics: reportPayload(report),
          previous_metrics: {
            period: report.previousPeriod,
            comparison: report.comparison
          },
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single();
      if (error) throw error;
      if (data) state.reports = [data, ...state.reports.filter(row => row.id !== data.id)];
      state.generatedReport = report;
      setStatus("Athlete review report generated.");
      renderReportPreview();
      await loadCoachData();
    });
  }

  async function createIntervention() {
    await withBusy(null, async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const item = selectedReportAthlete();
      if (!item) throw new Error("Select an assigned athlete first.");
      const now = new Date().toISOString();
      const observation = $("coachInterventionObservation")?.value?.trim() || nextActionText(item);
      const action = $("coachInterventionAction")?.value?.trim() || "Agree one practical support step and review the next logging pattern.";
      const { data, error } = await state.client
        .from(TABLES.interventions)
        .insert({
          coach_id: user.id,
          athlete_id: item.athlete.userId,
          status: "active",
          category: $("coachInterventionCategory")?.value || "fuelling_routine",
          observation,
          action_text: action,
          target_window: item.beyondFuelGapMinutes !== null ? "current gap" : "next support window",
          intervention_date: $("coachInterventionDate")?.value || domain.dateKey(new Date()),
          review_date: $("coachInterventionReviewDate")?.value || null,
          notes: "Created from Coach Beta athlete review.",
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single();
      if (error) throw error;
      if (data) state.interventions = [data, ...state.interventions.filter(row => row.id !== data.id)];
      setStatus("Intervention created.");
      if ($("coachInterventionObservation")) $("coachInterventionObservation").value = "";
      if ($("coachInterventionAction")) $("coachInterventionAction").value = "";
      await loadCoachData();
    });
  }

  function openReportBuilder(athleteId) {
    state.selectedReportAthleteId = athleteId || state.selectedReportAthleteId;
    state.currentTab = "reports";
    render();
    $("coachReportNotes")?.focus();
  }

  function openInterventionBuilder(athleteId) {
    state.selectedReportAthleteId = athleteId || state.selectedReportAthleteId;
    state.currentTab = "reports";
    render();
    $("coachInterventionObservation")?.focus();
  }

  function reportCsv(report) {
    const rows = [
      ["section", "metric", "value", "detail"],
      ["header", "athlete", report.athleteName, report.period.display],
      ["header", "coach", report.coachName, report.organisationName || ""],
      ["coverage", "total_days", report.coverage.totalDays, ""],
      ["coverage", "logged_days", report.coverage.loggedDays, ""],
      ["coverage", "coverage_percent", report.coverage.loggedPct, ""],
      ["coverage", "gap_metric_days", report.coverage.metricDays, ""],
      ["consistency", "fuel_logs_per_active_day", round1(report.consistency.avgFuelLogsPerActiveDay), ""],
      ["consistency", "hydration_logs_per_active_day", round1(report.consistency.avgHydrationLogsPerActiveDay), ""],
      ["consistency", "days_within_gap_target_percent", report.consistency.targetAdherencePct, ""],
      ["fuelling", "average_first_fuel", timeFromMinutes(report.fuelling.averageFirstFuelMinutes), ""],
      ["fuelling", "average_final_fuel", timeFromMinutes(report.fuelling.averageFinalFuelMinutes), ""],
      ["fuelling", "average_gap_minutes", round1(report.fuelling.averageGapMinutes), ""],
      ["fuelling", "longest_gap_minutes", round1(report.fuelling.longestGapMinutes), ""],
      ["fuelling", "most_common_gap_window", report.fuelling.commonGapWindow?.label || "", ""],
      ["fuelling", "most_common_fuelling_window", report.fuelling.commonFuellingWindow?.label || "", ""],
      ["sleepy", "sleepy_events", report.sleepy.total, ""],
      ["sleepy", "sleepy_events_per_active_week", round1(report.sleepy.averagePerActiveWeek), ""],
      ["sleepy", "most_common_sleepy_window", report.sleepy.commonWindow?.label || "", ""],
      ["sleepy", "sleepy_after_long_gap", report.sleepy.afterLongGapCount, `${report.sleepy.afterLongGapPct || 0}%`]
    ];
    report.contexts.forEach(context => rows.push(["context", context.label, `${context.adherencePct}%`, `${context.metricDays} metric days`]));
    report.comparison.forEach(item => rows.push(["comparison", item.label, item.trendLabel, comparisonDelta(item)]));
    report.executiveSummary.forEach((point, index) => rows.push(["executive_summary", `point_${index + 1}`, point, ""]));
    if (report.coachNotes) rows.push(["coach_observations", "notes", report.coachNotes, ""]);
    report.interventions.forEach(intervention => {
      rows.push(["intervention", intervention.category || "intervention", intervention.action_text || "", intervention.observation || intervention.notes || ""]);
    });
    return rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportReportCsv() {
    const report = state.generatedReport;
    if (!report) {
      setStatus("Generate a review before exporting.");
      return;
    }
    const filename = `fuel-guard-athlete-review-${report.period.startKey}-${report.period.endKey}.csv`;
    downloadBlob(new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" }), filename);
    setStatus("Report CSV exported.");
  }

  function exportReportPdf() {
    const report = state.generatedReport;
    if (!report) {
      setStatus("Generate a review before exporting.");
      return;
    }
    const printable = window.open("", "_blank");
    if (!printable) {
      setStatus("Allow pop-ups to export the report PDF.");
      return;
    }
    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${safe(report.title)}</title>
        <style>
          body { margin: 0; padding: 32px; color: #102019; font-family: Arial, sans-serif; background: #fffdf7; }
          h1, h2, h3 { margin: 0 0 10px; color: #102019; }
          h1 { font-size: 28px; }
          h2 { margin-top: 26px; font-size: 18px; border-bottom: 1px solid #d8d0c2; padding-bottom: 6px; }
          p, li, td, th { font-size: 12px; line-height: 1.45; }
          .brand { display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: #d99024; color: #07130f; font-weight: 900; margin-bottom: 16px; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin: 12px 0 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { text-align: left; border-bottom: 1px solid #e4ded1; padding: 7px 4px; }
          ul { padding-left: 18px; }
          .note { color: #667085; }
          @media print { body { background: #fff; } }
        </style>
      </head>
      <body>
        <div class="brand">FG</div>
        <h1>${safe(report.title)}</h1>
        <p>${safe(report.period.display)}</p>
        <div class="meta">
          <span>Coach: ${safe(report.coachName)}</span>
          <span>Team: ${safe(report.organisationName || "Not set")}</span>
          <span>Athlete: ${safe(report.athleteName)}</span>
          <span>Generated: ${safe(domain.dateKey(report.generatedAt))}</span>
          <span>Logging coverage: ${safe(`${report.coverage.loggedDays} / ${report.coverage.totalDays} days`)}</span>
          <span>Gap metric days: ${safe(report.coverage.metricDays)}</span>
        </div>
        <h2>Executive Summary</h2>
        <ul>${report.executiveSummary.map(point => `<li>${safe(point)}</li>`).join("")}</ul>
        <h2>Consistency and Fuelling Behaviour</h2>
        <table><tbody>${reportMetricRows(report).map(row => `<tr><th>${safe(row[0])}</th><td>${safe(row[1])}</td><td>${safe(row[2])}</td></tr>`).join("")}</tbody></table>
        <h2>Sleepy Patterns</h2>
        <p>${safe(report.sleepy.total ? `${report.sleepy.total} Sleepy event${report.sleepy.total === 1 ? " was" : "s were"} recorded in this period.` : "No Sleepy events were recorded in this period.")}</p>
        <p>${safe(report.sleepy.commonWindow ? `Most common Sleepy window: ${report.sleepy.commonWindow.label}.` : "Not enough Sleepy data to identify a recurring window yet.")}</p>
        ${report.sleepy.total ? `<p>${safe(`${report.sleepy.afterLongGapCount} of ${report.sleepy.total} Sleepy events occurred following fuel gaps longer than ${domain.duration(report.sleepy.targetMinutes || 0)}.`)}</p>` : ""}
        <p class="note">Sleepy logs are observational markers. Fuel Guard does not infer a medical cause.</p>
        <h2>Context</h2>
        ${report.contexts.length ? `<table><tbody>${report.contexts.map(context => `<tr><th>${safe(context.label)}</th><td>${safe(context.adherencePct)}% within target</td><td>${safe(context.metricDays)} metric days</td></tr>`).join("")}</tbody></table>` : `<p>Not enough context-specific data yet.</p>`}
        <h2>Previous Period Comparison</h2>
        <table><tbody>${report.comparison.map(item => `<tr><th>${safe(item.label)}</th><td>Current: ${safe(comparisonValue(item, item.current))}</td><td>Previous: ${safe(comparisonValue(item, item.previous))}</td><td>${safe(item.trendLabel || "Not enough data")}</td></tr>`).join("")}</tbody></table>
        <h2>Coach Observations</h2>
        <p>${safe(report.coachNotes || "No coach observations added yet.")}</p>
        <h2>Interventions</h2>
        ${report.interventions.length ? `<table><tbody>${report.interventions.map(intervention => `<tr><th>${safe(intervention.intervention_date || domain.dateKey(intervention.created_at))}</th><td>${safe(intervention.category || "Intervention")}</td><td>${safe(intervention.action_text || "")}</td></tr>`).join("")}</tbody></table>` : `<p>No interventions recorded for this athlete yet.</p>`}
      </body>
      </html>
    `;
    printable.document.open();
    printable.document.write(html);
    printable.document.close();
    printable.focus();
    printable.print();
    setStatus("Report PDF export opened.");
  }

  async function init() {
    if (!domain) {
      setStatus("Coach Beta could not load Fuel Guard analytics helpers.");
      return;
    }
    if (!configured()) {
      setStatus("Coach Beta needs Supabase public URL/key configuration.");
      renderAuth();
      return;
    }

    const config = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    state.client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });

    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      if (session?.user) {
        const enableCoach = consumeCoachSignup(session.user);
        loadCoachData({ enableCoach }).catch(error => {
          setStatus(friendlyError(error));
          render();
        });
      }
      else render();
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) {
      setStatus(error.message);
      render();
      return;
    }
    state.session = data.session;
    if (state.session?.user) {
      const enableCoach = consumeCoachSignup(state.session.user);
      await loadCoachData({ enableCoach }).catch(error => {
        setStatus(friendlyError(error));
        render();
      });
    } else {
      setStatus("Sign in to open Coach Beta.");
      render();
    }
  }

  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-coach-tab]");
    if (tab) {
      state.currentTab = tab.dataset.coachTab;
      renderTabs();
      return;
    }

    const openAthlete = event.target.closest("[data-open-athlete]");
    if (openAthlete) {
      state.selectedAthleteId = openAthlete.dataset.openAthlete;
      state.currentTab = "athletes";
      render();
      return;
    }

    const pattern = event.target.closest("[data-coach-pattern]");
    if (pattern) {
      state.selectedPattern = pattern.dataset.coachPattern;
      renderAthleteDetail();
      return;
    }

    const revoke = event.target.closest("[data-revoke-relationship]");
    if (revoke) {
      revokeRelationship(revoke.dataset.revokeRelationship);
      return;
    }

    const reportBuilder = event.target.closest("[data-open-report-builder]");
    if (reportBuilder) {
      openReportBuilder(reportBuilder.dataset.openReportBuilder);
      return;
    }

    const interventionBuilder = event.target.closest("[data-open-intervention-builder]");
    if (interventionBuilder) {
      openInterventionBuilder(interventionBuilder.dataset.openInterventionBuilder);
      return;
    }

    if (event.target.closest("[data-export-report-pdf]")) {
      exportReportPdf();
      return;
    }

    if (event.target.closest("[data-export-report-csv]")) {
      exportReportCsv();
    }
  });

  $("coachSignInButton")?.addEventListener("click", signIn);
  $("coachSignUpButton")?.addEventListener("click", signUp);
  $("coachForgotPasswordButton")?.addEventListener("click", forgotPassword);
  $("coachEnableAccessButton")?.addEventListener("click", enableCoachAccess);
  $("coachAccessSignOutButton")?.addEventListener("click", signOut);
  $("coachSignOutButton")?.addEventListener("click", signOut);
  $("coachSaveProfileButton")?.addEventListener("click", saveProfile);
  $("coachInviteButton")?.addEventListener("click", requestSharing);
  $("coachGenerateReviewButton")?.addEventListener("click", generateReport);
  $("coachCreateInterventionButton")?.addEventListener("click", createIntervention);
  $("coachReportAthlete")?.addEventListener("change", event => {
    state.selectedReportAthleteId = event.target.value || "";
    state.generatedReport = null;
    renderReportPreview();
  });
  $("coachReportPeriod")?.addEventListener("change", event => {
    state.reportPeriod = event.target.value || "12_weeks";
    state.generatedReport = null;
    renderReportPreview();
  });
  $("coachAthleteSearch")?.addEventListener("input", event => {
    state.search = event.target.value || "";
    renderAthleteList();
  });

  document.addEventListener("DOMContentLoaded", init);
})();
