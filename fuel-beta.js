// Fuel Guard canonical mobile PWA layer.
// Focuses the app on real fuel and hydration logging, history, and settings.
(() => {
  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };
  const FOOD_LOG_COOLDOWN_MS = 60000;
  const DAY_TYPE_OPTIONS = [
    { value: "training-work", label: "Training + work day" },
    { value: "training", label: "Training day" },
    { value: "race", label: "Competition/Race Day" },
    { value: "work", label: "Working Day" },
    { value: "shift", label: "Shift day" },
    { value: "rest", label: "Rest day" }
  ];
  const TRAINING_SESSION_OPTIONS = [
    { value: "", label: "Not set" },
    { value: "run", label: "Run" },
    { value: "bike", label: "Bike" },
    { value: "swim", label: "Swim" },
    { value: "strength", label: "Strength" },
    { value: "brick", label: "Brick" },
    { value: "rest", label: "Rest day / no training" }
  ];
  const TRAINING_SESSION_LABELS = TRAINING_SESSION_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const GRAPH_MODES = new Set(["fuel", "hydration", "combined"]);
  const DAY_TYPE_LABELS = DAY_TYPE_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {
    "double-training": "Training day",
    "standalone-training": "Training day",
    other: "Other"
  });

  let selectedHistoryKey = "";
  let selectedTrainingFilter = "all";

  function safeText(value) {
    if (typeof escapeHtml === "function") return escapeHtml(value || "");
    return String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function betaState() {
    const gap = fuelGapState();
    if (!gap.dayTypes || Array.isArray(gap.dayTypes)) gap.dayTypes = {};
    if (!gap.trainingSessions || Array.isArray(gap.trainingSessions)) gap.trainingSessions = {};
    if (!gap.archive || Array.isArray(gap.archive)) gap.archive = {};
    if (!gap.thresholds || typeof gap.thresholds !== "object") gap.thresholds = { ...DEFAULT_THRESHOLDS };
    gap.thresholds.greenMinutes = Number(gap.thresholds.greenMinutes || DEFAULT_THRESHOLDS.greenMinutes);
    gap.thresholds.redMinutes = Number(gap.thresholds.redMinutes || DEFAULT_THRESHOLDS.redMinutes);
    if (gap.thresholds.redMinutes <= gap.thresholds.greenMinutes) gap.thresholds.redMinutes = gap.thresholds.greenMinutes + 60;
    if (!GRAPH_MODES.has(gap.graphMode)) gap.graphMode = "combined";
    return gap;
  }

  function thresholds() {
    return betaState().thresholds;
  }

  fuelGapStatus = function fuelGapStatusBeta(minutes) {
    const limits = thresholds();
    if (!Number.isFinite(minutes)) return "red";
    if (minutes < limits.greenMinutes) return "green";
    if (minutes < limits.redMinutes) return "amber";
    return "red";
  };

  function dateKey(date = new Date()) {
    return typeof todayKey === "function" ? todayKey(date) : date.toISOString().slice(0, 10);
  }

  function dateFromKey(key) {
    const date = new Date(`${key}T12:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function formatDateKey(key) {
    return dateFromKey(key).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function startOfDay(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function minutesIntoDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  function clockFromMinutes(minutes) {
    const date = startOfDay();
    date.setMinutes(Math.round(minutes));
    return formatClock(date);
  }

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  }

  function logDate(log) {
    return fuelLogDate(log);
  }

  function logType(log) {
    const type = String(log?.type || "fuel").toLowerCase();
    return type === "hydration" ? "hydration" : "fuel";
  }

  function isFuelLog(log) {
    return logType(log) === "fuel";
  }

  function logsWithDates() {
    return betaState().logs
      .map((log, index) => ({ ...log, index, date: logDate(log) }))
      .filter(log => log.date)
      .sort((a, b) => a.date - b.date);
  }

  function logsForDay(key) {
    return logsWithDates().filter(log => dateKey(log.date) === key);
  }

  function fuelLogsForDay(key) {
    return logsForDay(key).filter(isFuelLog);
  }

  function todayLogs(now = new Date()) {
    return logsForDay(dateKey(now));
  }

  function todayFuelLogs(now = new Date()) {
    return todayLogs(now).filter(isFuelLog);
  }

  function lastFuelLog() {
    return logsWithDates().filter(isFuelLog).sort((a, b) => b.date - a.date)[0] || null;
  }

  function minutesSinceLastFuel(now = new Date()) {
    const last = lastFuelLog();
    return last ? Math.max(0, (now - last.date) / 60000) : Infinity;
  }

  function dayTypeLabel(value) {
    return value ? (DAY_TYPE_LABELS[value] || value) : "Not set";
  }

  function trainingSessionLabel(value) {
    return value ? (TRAINING_SESSION_LABELS[value] || value) : "Not set";
  }

  function dayTypeForKey(key) {
    const gap = betaState();
    return gap.dayTypes[key] || gap.archive[key]?.dayType || "";
  }

  function trainingSessionForKey(key) {
    const gap = betaState();
    return gap.trainingSessions[key] || gap.archive[key]?.trainingSession || "";
  }

  function isTrainingSession(value) {
    return ["run", "bike", "swim", "strength", "brick"].includes(String(value || ""));
  }

  function isTrainingDayValue(dayType, session = "") {
    return isTrainingSession(session) || ["training", "training-work", "race", "double-training", "standalone-training"].includes(String(dayType || ""));
  }

  function setDayType(key, value) {
    const gap = betaState();
    if (value) gap.dayTypes[key] = value;
    else delete gap.dayTypes[key];

    gap.logs.forEach(log => {
      const date = logDate(log);
      if (date && dateKey(date) === key) log.dayType = value || "";
    });

    storeArchive(key, { endedAt: gap.archive[key]?.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "") });
  }

  function setTrainingSession(key, value) {
    const gap = betaState();
    if (value) gap.trainingSessions[key] = value;
    else delete gap.trainingSessions[key];

    gap.logs.forEach(log => {
      const date = logDate(log);
      if (date && dateKey(date) === key) log.trainingSession = value || "";
    });

    storeArchive(key, { endedAt: gap.archive[key]?.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "") });
  }

  function graphMode() {
    return GRAPH_MODES.has(betaState().graphMode) ? betaState().graphMode : "combined";
  }

  function cooldownRemainingSeconds(now = Date.now()) {
    const cooldownUntil = Number(betaState().cooldownUntil || 0);
    return cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  }

  function setCooldown() {
    betaState().cooldownUntil = Date.now() + FOOD_LOG_COOLDOWN_MS;
  }

  function clearCooldown() {
    betaState().cooldownUntil = 0;
  }

  function gapsFromFuelLogs(logs, referenceTime = new Date(), includeTrailing = false, trailingIsOngoing = false) {
    const sorted = [...logs].filter(isFuelLog).sort((a, b) => a.date - b.date);
    const gaps = [];
    for (let index = 1; index < sorted.length; index += 1) {
      const minutes = (sorted[index].date - sorted[index - 1].date) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        gaps.push({ minutes, start: sorted[index - 1].date, end: sorted[index].date, ongoing: false });
      }
    }
    if (includeTrailing && sorted.length) {
      const last = sorted[sorted.length - 1];
      const minutes = (referenceTime - last.date) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        gaps.push({ minutes, start: last.date, end: referenceTime, ongoing: trailingIsOngoing });
      }
    }
    return gaps;
  }

  function durationText(minutes) {
    return Number.isFinite(minutes) && minutes > 0 ? duration(minutes) : "Not enough data";
  }

  function riskLimit() {
    return thresholds().redMinutes;
  }

  function analyseDay(key, { now = new Date(), endedAt = "" } = {}) {
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(log => !isFuelLog(log));
    const endedDate = endedAt ? logDate(endedAt) : null;
    const isToday = key === dateKey(now);
    const reference = endedDate || (isToday ? now : fuelLogs[fuelLogs.length - 1]?.date || logs[logs.length - 1]?.date || dateFromKey(key));
    const gaps = gapsFromFuelLogs(fuelLogs, reference, Boolean(endedDate) || isToday, !endedDate && isToday);
    const completedGaps = gaps.filter(gap => !gap.ongoing);
    const highRiskGaps = gaps.filter(gap => gap.minutes >= riskLimit());
    const completedHighRiskGaps = completedGaps.filter(gap => gap.minutes >= riskLimit());
    const longest = gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : 0;
    const average = gaps.length ? gaps.reduce((sum, gap) => sum + gap.minutes, 0) / gaps.length : 0;
    const firstHighRiskGap = highRiskGaps[0] || null;
    const highRiskStart = firstHighRiskGap ? addMinutes(firstHighRiskGap.start, riskLimit()) : null;
    const reactive = completedHighRiskGaps.length > 0 && completedHighRiskGaps.length >= Math.ceil(Math.max(1, completedGaps.length) / 2);
    const firstFuel = fuelLogs[0] || null;
    const lastFuel = fuelLogs[fuelLogs.length - 1] || null;
    const dayType = dayTypeForKey(key);
    const trainingSession = trainingSessionForKey(key);
    const summary = [];

    if (!fuelLogs.length) {
      summary.push("No fuel logs recorded for this day.");
      summary.push("Log a few more days to see your High Risk gap pattern.");
    } else if (!gaps.length) {
      summary.push("Only one fuel log is available for this day.");
      summary.push("More fuel logs are needed before Fuel Guard can calculate gaps.");
    } else {
      summary.push(`Your longest fuel gap was ${duration(longest)}.`);
      if (firstHighRiskGap && highRiskStart) {
        summary.push(`Your first High Risk gap began around ${formatClock(highRiskStart)}.`);
        summary.push(`That logged gap ended at ${formatClock(firstHighRiskGap.end)}.`);
      } else {
        summary.push("No High Risk fuel gap was logged from the available fuel logs.");
      }
      if (reactive) summary.push("This looks like a reactive fuelling day rather than a planned fuelling day.");
      if (isTrainingDayValue(dayType, trainingSession) && highRiskGaps.length) {
        summary.push(`${trainingSessionLabel(trainingSession)} context: high-output days need reliable fuel access before gaps turn High Risk.`);
      }
      if (fuelLogs.length < 3 || !firstHighRiskGap) summary.push("More weekly data will make this pattern clearer.");
    }

    return {
      date: key,
      dateLabel: formatDateKey(key),
      dayType,
      dayTypeLabel: dayTypeLabel(dayType),
      trainingSession,
      trainingSessionLabel: trainingSessionLabel(trainingSession),
      logs,
      fuelLogs,
      hydrationLogs,
      firstFuelTime: firstFuel ? formatClock(firstFuel.date) : "Not logged",
      lastFuelTime: lastFuel ? formatClock(lastFuel.date) : "Not logged",
      firstFuelMinute: firstFuel ? minutesIntoDay(firstFuel.date) : null,
      lastFuelMinute: lastFuel ? minutesIntoDay(lastFuel.date) : null,
      fuelLogCount: fuelLogs.length,
      hydrationLogCount: hydrationLogs.length,
      gaps,
      longestGapMinutes: longest,
      averageGapMinutes: average,
      longGapCount: highRiskGaps.length,
      highRiskGapCount: highRiskGaps.length,
      highRiskStartMinute: highRiskStart ? minutesIntoDay(highRiskStart) : null,
      highRiskEndMinute: firstHighRiskGap ? minutesIntoDay(firstHighRiskGap.end) : null,
      highRiskWindow: firstHighRiskGap && highRiskStart ? `${formatClock(highRiskStart)}-${formatClock(firstHighRiskGap.end)}` : "Not detected",
      reactive,
      endedAt: endedDate ? endedDate.toISOString() : "",
      summary
    };
  }

  function buildArchiveEntry(key, options = {}) {
    const gap = betaState();
    const previous = gap.archive[key] || {};
    const endedAt = Object.prototype.hasOwnProperty.call(options, "endedAt")
      ? options.endedAt
      : previous.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "");
    const analysis = analyseDay(key, { endedAt });

    return {
      date: key,
      dateLabel: analysis.dateLabel,
      dayType: analysis.dayType,
      dayTypeLabel: analysis.dayTypeLabel,
      trainingSession: analysis.trainingSession,
      trainingSessionLabel: analysis.trainingSessionLabel,
      endedAt: analysis.endedAt || endedAt || "",
      firstFuelMinute: analysis.firstFuelMinute,
      lastFuelMinute: analysis.lastFuelMinute,
      firstFuelTime: analysis.firstFuelTime,
      lastFuelTime: analysis.lastFuelTime,
      fuelLogCount: analysis.fuelLogCount,
      hydrationLogCount: analysis.hydrationLogCount,
      logs: analysis.logs.map(log => ({
        id: log.id || uid(),
        timestamp: log.date.toISOString(),
        type: logType(log),
        typeLabel: logType(log) === "hydration" ? "Hydration" : "Fuel",
        dayType: log.dayType || analysis.dayType,
        trainingSession: log.trainingSession || analysis.trainingSession,
        note: log.note || ""
      })),
      longestGapMinutes: analysis.longestGapMinutes,
      averageGapMinutes: analysis.averageGapMinutes,
      longGapCount: analysis.longGapCount,
      highRiskGapCount: analysis.highRiskGapCount,
      longestGap: durationText(analysis.longestGapMinutes),
      averageGap: durationText(analysis.averageGapMinutes),
      highRiskStartMinute: analysis.highRiskStartMinute,
      highRiskEndMinute: analysis.highRiskEndMinute,
      highRiskWindow: analysis.highRiskWindow,
      reactive: analysis.reactive,
      analysis: analysis.summary
    };
  }

  function storeArchive(key, options = {}) {
    const gap = betaState();
    const entry = buildArchiveEntry(key, options);
    gap.archive[key] = entry;
    return entry;
  }

  function archiveEntries() {
    const gap = betaState();
    const keys = new Set([dateKey()]);
    Object.keys(gap.archive || {}).forEach(key => keys.add(key));
    Object.keys(gap.dayTypes || {}).forEach(key => keys.add(key));
    logsWithDates().forEach(log => keys.add(dateKey(log.date)));
    return [...keys].sort().reverse().map(key => buildArchiveEntry(key));
  }

  function weeklySummary() {
    const cutoff = startOfDay();
    cutoff.setDate(cutoff.getDate() - 6);
    const entries = archiveEntries().filter(entry => dateFromKey(entry.date) >= cutoff && (entry.fuelLogCount || entry.dayType));
    const longEntries = entries.filter(entry => entry.longGapCount > 0);
    const highRiskWindowCounts = {};
    const typeStats = {};

    entries.forEach(entry => {
      if (Number.isFinite(entry.highRiskStartMinute)) {
        const bucket = timeWindowBucket(entry.highRiskStartMinute);
        highRiskWindowCounts[bucket] = (highRiskWindowCounts[bucket] || 0) + 1;
      }
      if (!entry.dayType) return;
      if (!typeStats[entry.dayType]) {
        typeStats[entry.dayType] = { label: entry.dayTypeLabel, days: 0, longDays: 0, reactiveDays: 0, averageTotal: 0 };
      }
      const stat = typeStats[entry.dayType];
      stat.days += 1;
      stat.longDays += entry.longGapCount ? 1 : 0;
      stat.reactiveDays += entry.reactive ? 1 : 0;
      stat.averageTotal += Number(entry.averageGapMinutes || 0);
    });

    const topWindow = Object.entries(highRiskWindowCounts).sort((a, b) => b[1] - a[1])[0] || null;
    const typeList = Object.values(typeStats);
    const riskType = [...typeList].sort((a, b) => b.longDays - a.longDays || b.averageTotal - a.averageTotal)[0] || null;
    const averageType = [...typeList].sort((a, b) => (b.averageTotal / Math.max(1, b.days)) - (a.averageTotal / Math.max(1, a.days)))[0] || null;

    return {
      entries,
      longEntries,
      topWindow,
      riskType,
      averageType,
      totalLogs: entries.reduce((sum, entry) => sum + entry.fuelLogCount, 0),
      longestGap: entries.length ? Math.max(...entries.map(entry => Number(entry.longestGapMinutes || 0))) : 0
    };
  }

  function timeWindowBucket(minutes) {
    if (!Number.isFinite(minutes)) return "Needs more data";
    if (minutes < 660) return "morning";
    if (minutes < 840) return "11:00-14:00";
    if (minutes < 960) return "14:00-16:00";
    if (minutes < 1080) return "16:00-18:00";
    if (minutes < 1320) return "evening";
    return "late/overnight";
  }

  fuelGapSnapshot = function fuelGapSnapshotBeta(now = new Date()) {
    const last = lastFuelLog();
    const minutes = minutesSinceLastFuel(now);
    const status = fuelGapStatus(minutes);
    const statusText = status === "green"
      ? "Fuel gap is currently under control."
      : status === "amber"
        ? "Fuel gap is building. Plan fuel soon."
        : "High Risk fuel gap. Get fuel available now.";

    return {
      lastFuelled: last ? formatClock(last.date) : "No fuel logged",
      timeSinceFuel: Number.isFinite(minutes) ? duration(minutes) : "No fuel logged",
      minutesSinceFuel: minutes,
      status,
      nextAction: statusText,
      statusContext: statusText
    };
  };

  fuelDaySummary = function fuelDaySummaryBeta(now = new Date()) {
    const key = dateKey(now);
    const logs = todayLogs(now);
    const fuelLogs = logs.filter(isFuelLog);
    const last = fuelLogs[fuelLogs.length - 1] || null;
    const end = fuelDayEndSnapshot(now);
    const dayType = dayTypeForKey(key);
    return {
      date: typeof fuelTrackingDateLabel === "function" ? fuelTrackingDateLabel(now) : formatDateKey(key),
      fuelLogs: fuelLogs.length,
      lastFuelled: last ? formatClock(last.date) : "No fuel logged",
      dayEnded: end.dayEnded,
      endTime: end.endTime,
      dayType,
      message: `${fuelLogs.length} fuel log${fuelLogs.length === 1 ? "" : "s"}. Last fuel: ${last ? formatClock(last.date) : "No fuel logged"}. Day type: ${dayTypeLabel(dayType)}. ${end.dayEnded ? `Day ended at ${end.endTime}.` : "Tracking is open."}`
    };
  };

  function recordRhythmLog(type = "fuel") {
    if (fuelDayEndSnapshot().dayEnded) return;
    const isHydration = type === "hydration";
    if (!isHydration && cooldownRemainingSeconds() > 0) {
      renderFuelGap();
      return;
    }

    const key = dateKey();
    betaState().logs.push({
      id: uid(),
      timestamp: new Date().toISOString(),
      label: isHydration ? "Hydration logged" : "Fuelled",
      type: isHydration ? "hydration" : "fuel",
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key)
    });
    if (!isHydration) setCooldown();
    storeArchive(key);
    state.completed.liveFuelStatus = true;
    if (typeof recordFuelMomentum === "function") {
      recordFuelMomentum(
        isHydration ? "hydrationLogged" : "fuelLogged",
        isHydration ? "Hydration logged. Rhythm graph updated." : "Fuel logged. Gap tracker updated.",
        isHydration ? "Hydration logged. Fuel rhythm comparison updated. +1 Fuel Momentum" : "Fuel logged. Your fuel rhythm is up to date. +1 Fuel Momentum",
        { dedupeDaily: false }
      );
    } else if (typeof addActivityEntry === "function") {
      addActivityEntry(isHydration ? "hydrationLogged" : "fuelLogged", isHydration ? "Hydration logged. Rhythm graph updated." : "Fuel logged. Gap tracker updated.", { dedupeDaily: false });
    }
    save();
    renderAll();
  }

  recordFuelled = function recordFuelledBeta() {
    recordRhythmLog("fuel");
  };

  function recordHydration() {
    recordRhythmLog("hydration");
  }

  function undoLatestRhythmLog() {
    const key = dateKey();
    let latestIndex = -1;
    let latestDate = null;
    let latestType = "fuel";
    betaState().logs.forEach((log, index) => {
      const date = logDate(log);
      if (!date || dateKey(date) !== key) return;
      if (!latestDate || date > latestDate) {
        latestDate = date;
        latestIndex = index;
        latestType = logType(log);
      }
    });
    if (latestIndex < 0) return;
    betaState().logs.splice(latestIndex, 1);
    if (latestType === "fuel") clearCooldown();
    storeArchive(key);
    addActivityEntry("fuelLogUndo", "Latest rhythm log undone.", { dedupeDaily: false });
    save();
    renderAll();
  }

  endFuelDayAndStartFasting = function endFuelDayAndStartFastingBeta() {
    const now = new Date();
    const key = dateKey(now);
    const gap = betaState();
    gap.dayEndedDate = key;
    gap.dayEndedAt = now.toISOString();
    gap.fastingStartedAt = now.toISOString();
    const entry = storeArchive(key, { endedAt: now.toISOString() });
    addActivityEntry("fastingStarted", "Day ended. Fuel gap summary saved.", { dedupeDaily: true });
    if (entry.reactive) addActivityEntry("reactiveFuelDay", "Reactive fuelling pattern detected.", { dedupeDaily: true });
    save();
    renderAll();
  };

  continueFuelDayTracking = function continueFuelDayTrackingBeta() {
    const key = dateKey();
    const wasEnded = fuelDayEndSnapshot().dayEnded;
    const gap = betaState();
    gap.dayEndedDate = "";
    gap.dayEndedAt = "";
    gap.fastingStartedAt = "";
    storeArchive(key, { endedAt: "" });
    if (wasEnded) addActivityEntry("fuelTrackingContinued", "Continued today's fuel tracking.", { dedupeDaily: true });
    save();
    renderAll();
  };

  function renderGraphModeControls() {
    const mode = graphMode();
    document.querySelectorAll("[data-graph-mode]").forEach(button => {
      button.classList.toggle("active", button.dataset.graphMode === mode);
    });
  }

  function renderGapInsights(snapshot) {
    const target = document.getElementById("fuelGapInsights");
    if (!target) return;
    const analysis = analyseDay(dateKey());
    target.innerHTML = `
      <div class="fuel-gap-insight"><span>Time since last fuel</span><strong>${safeText(snapshot.timeSinceFuel)}</strong><small>Core beta signal.</small></div>
      <div class="fuel-gap-insight"><span>Current gap risk</span><strong>${safeText(snapshot.status.toUpperCase())}</strong><small>Green under ${thresholds().greenMinutes}m. Red at ${thresholds().redMinutes}m.</small></div>
      <div class="fuel-gap-insight"><span>Longest gap today</span><strong>${safeText(durationText(analysis.longestGapMinutes))}</strong><small>${analysis.fuelLogCount ? "Today’s biggest fuel gap." : "Tap I fuelled to start."}</small></div>
      <div class="fuel-gap-insight"><span>High Risk gaps today</span><strong>${analysis.highRiskGapCount}</strong><small>Gaps at or over red threshold.</small></div>
      <div class="fuel-gap-insight"><span>Fuel logs today</span><strong>${analysis.fuelLogCount}</strong><small>Real logged fuel points.</small></div>
      <div class="fuel-gap-insight"><span>Hydration logs today</span><strong>${analysis.hydrationLogCount}</strong><small>Real logged hydration points.</small></div>
    `;
  }

  function renderDayTypeControls() {
    const key = dateKey();
    const dayTypeSelect = document.getElementById("fuelDayType");
    const sessionSelect = document.getElementById("fuelTrainingSession");
    const dayType = dayTypeForKey(key);
    const session = trainingSessionForKey(key);
    if (dayTypeSelect && dayTypeSelect.value !== dayType) dayTypeSelect.value = dayType;
    if (sessionSelect && sessionSelect.value !== session) sessionSelect.value = session;
    const saved = document.getElementById("fuelDayTypeSaved");
    if (saved) {
      const dayText = dayType ? dayTypeLabel(dayType) : "day type not set";
      const sessionText = session ? trainingSessionLabel(session) : "session not set";
      saved.textContent = `Saved: ${dayText}; ${sessionText}.`;
    }
  }

  function renderSettings() {
    const green = document.getElementById("greenThresholdMinutes");
    const red = document.getElementById("redThresholdMinutes");
    if (green) green.value = thresholds().greenMinutes;
    if (red) red.value = thresholds().redMinutes;
    state.account = { email: "", status: "", ...(state.account || {}) };
    const email = document.getElementById("accountEmail");
    const status = document.getElementById("accountSetupStatus");
    if (email && document.activeElement !== email) email.value = state.account.email || "";
    if (status) status.textContent = state.account.status || "Not logged in yet. Cloud sync backend is planned.";
  }

  function renderAnalysisList(items) {
    return `<ul class="fuel-analysis-list">${items.map(item => `<li>${safeText(item)}</li>`).join("")}</ul>`;
  }

  function renderDayAnalysis() {
    const target = document.getElementById("fuelDayAnalysis");
    if (!target) return;
    if (!fuelDayEndSnapshot().dayEnded) {
      target.innerHTML = "";
      return;
    }
    const entry = betaState().archive[dateKey()] || buildArchiveEntry(dateKey());
    target.innerHTML = `<p class="label">Daily summary</p>${renderAnalysisList(entry.analysis)}`;
  }

  function renderDailyLog() {
    const dateEl = document.getElementById("fuelDailyLogDate");
    if (dateEl) dateEl.textContent = typeof fuelTrackingDateLabel === "function" ? fuelTrackingDateLabel() : formatDateKey(dateKey());
    const target = document.getElementById("fuelDailyLog");
    if (!target) return;
    const logs = todayLogs();
    target.innerHTML = logs.length
      ? logs.map(log => `<div class="row"><div><div class="item-name">${formatClock(log.date)} - ${logType(log) === "hydration" ? "Hydration" : "Fuel"} logged</div></div></div>`).join("")
      : `<p class="muted fuel-daily-empty">No fuel or hydration logged today.</p>`;
  }

  function renderArchiveDetail(entry) {
    if (!entry) return `<p class="muted">No daily summaries yet.</p>`;
    const logsHtml = entry.logs.length
      ? entry.logs.map(log => `<div class="row fuel-archive-log-row"><div><div class="item-name">${formatClock(logDate(log.timestamp))} - ${safeText(log.typeLabel || "Fuel")}</div>${log.note ? `<div class="row-note">${safeText(log.note)}</div>` : ""}</div></div>`).join("")
      : `<p class="muted">No logs stored for this day.</p>`;
    const heading = [dayTypeLabel(entry.dayType), entry.trainingSession ? trainingSessionLabel(entry.trainingSession) : ""]
      .filter(Boolean)
      .join(" - ");

    return `
      <div class="fuel-archive-head"><div><p class="label">${safeText(entry.dateLabel)}</p><h3>${safeText(heading || "Day type not set")}</h3></div><span class="status-pill ${entry.highRiskGapCount ? "amber" : "green"}">${entry.highRiskGapCount ? "HIGH RISK GAPS" : "STABLE"}</span></div>
      <div class="fuel-archive-stats">
        <div><span>First fuel</span><strong>${safeText(entry.firstFuelTime)}</strong></div>
        <div><span>Last fuel</span><strong>${safeText(entry.lastFuelTime)}</strong></div>
        <div><span>Fuel logs</span><strong>${entry.fuelLogCount}</strong></div>
        <div><span>Hydration logs</span><strong>${entry.hydrationLogCount || 0}</strong></div>
        <div><span>Longest gap</span><strong>${safeText(entry.longestGap)}</strong></div>
        <div><span>Average gap</span><strong>${safeText(entry.averageGap)}</strong></div>
        <div><span>High Risk gaps</span><strong>${entry.highRiskGapCount || 0}</strong></div>
      </div>
      <div class="fuel-archive-section"><h4>Fuel log times</h4><div class="list">${logsHtml}</div></div>
      <div class="fuel-archive-section"><h4>Logged behaviour notes</h4>${renderAnalysisList(entry.analysis)}</div>
    `;
  }

  function loggedHistoryEntries() {
    return archiveEntries()
      .filter(entry => Number(entry.fuelLogCount || 0) > 0 || Number(entry.hydrationLogCount || 0) > 0 || (entry.logs || []).length > 0)
      .sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));
  }

  function entryMatchesTrainingFilter(entry, filter) {
    if (filter === "all") return true;
    const isTraining = isTrainingDayValue(entry.dayType, entry.trainingSession);
    if (filter === "training-days") return isTraining;
    if (filter === "non-training-days") return !isTraining;
    if (filter === "rest") return entry.trainingSession === "rest" || entry.dayType === "rest";
    return entry.trainingSession === filter;
  }

  function averageValue(values) {
    const finite = values.filter(value => Number.isFinite(value));
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }

  function averageClock(values) {
    const average = averageValue(values);
    if (!Number.isFinite(average)) return "Not enough data";
    const date = startOfDay();
    date.setMinutes(Math.round(average));
    return formatClock(date);
  }

  function averageNumber(values, digits = 1) {
    const average = averageValue(values);
    return Number.isFinite(average) ? average.toFixed(digits) : "0.0";
  }

  function trainingFilterLabel(filter) {
    if (filter === "all") return "All stored days";
    if (filter === "training-days") return "Training days";
    if (filter === "non-training-days") return "Non-training days";
    return trainingSessionLabel(filter);
  }

  function renderAverageMetric(label, value, note) {
    return `<div class="fuel-gap-insight"><span>${safeText(label)}</span><strong>${safeText(value)}</strong><small>${safeText(note)}</small></div>`;
  }

  function renderPatternGraph(title, entries, valueForEntry, metaForEntry, { max = null, tone = "green" } = {}) {
    if (!entries.length) return "";
    const values = entries.map(valueForEntry).filter(value => Number.isFinite(value));
    const maxValue = Number.isFinite(max) ? max : Math.max(...values, 1);
    const rows = entries.map(entry => {
      const raw = valueForEntry(entry);
      const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      const width = maxValue > 0 && Number.isFinite(raw) ? Math.max(4, Math.min(100, Math.round((value / maxValue) * 100))) : 0;
      return `
        <div class="beta-history-bar-row">
          <div class="beta-history-bar-label"><span>${safeText(entry.dateLabel || entry.date)}</span><small>${safeText(metaForEntry(entry))}</small></div>
          <div class="beta-history-bar-track"><i class="${tone}" style="width:${width}%"></i></div>
        </div>
      `;
    }).join("");
    return `<section class="beta-history-chart"><h3>${safeText(title)}</h3>${rows}</section>`;
  }

  function renderHistoryAverages() {
    const summaryTarget = document.getElementById("fuelAveragesSummary");
    const graphTarget = document.getElementById("fuelAveragePatternGraphs");
    if (!summaryTarget || !graphTarget) return;

    const allEntries = loggedHistoryEntries();
    const filteredEntries = allEntries.filter(entry => entryMatchesTrainingFilter(entry, selectedTrainingFilter));
    if (!allEntries.length) {
      summaryTarget.innerHTML = `<p class="muted beta-history-empty">No logged days yet. Log fuel for a few days and averages will appear here.</p>`;
      graphTarget.innerHTML = "";
      return;
    }
    if (!filteredEntries.length) {
      summaryTarget.innerHTML = `<p class="muted beta-history-empty">No logged days match ${safeText(trainingFilterLabel(selectedTrainingFilter))} yet.</p>`;
      graphTarget.innerHTML = "";
      return;
    }

    summaryTarget.innerHTML = [
      renderAverageMetric("Average daily first fuel time", averageClock(filteredEntries.map(entry => entry.firstFuelMinute)), `${filteredEntries.length} logged day${filteredEntries.length === 1 ? "" : "s"}`),
      renderAverageMetric("Average daily last fuel time", averageClock(filteredEntries.map(entry => entry.lastFuelMinute)), trainingFilterLabel(selectedTrainingFilter)),
      renderAverageMetric("Average number of fuel logs per day", averageNumber(filteredEntries.map(entry => Number(entry.fuelLogCount || 0))), "Real logged fuel points"),
      renderAverageMetric("Average number of High Risk gaps per day", averageNumber(filteredEntries.map(entry => Number(entry.highRiskGapCount || 0))), "Based on current red threshold"),
      renderAverageMetric("Average longest fuel gap per day", durationText(averageValue(filteredEntries.map(entry => Number(entry.longestGapMinutes || 0))) || 0), "Average of each day's longest gap")
    ].join("");

    const maxGap = Math.max(...filteredEntries.map(entry => Number(entry.longestGapMinutes || 0)), 1);
    const maxRisk = Math.max(...filteredEntries.map(entry => Number(entry.highRiskGapCount || 0)), 1);
    graphTarget.innerHTML = [
      renderPatternGraph("First fuel time by day", filteredEntries, entry => entry.firstFuelMinute, entry => entry.firstFuelTime, { max: 1440, tone: "blue" }),
      renderPatternGraph("Last fuel time by day", filteredEntries, entry => entry.lastFuelMinute, entry => entry.lastFuelTime, { max: 1440, tone: "green" }),
      renderPatternGraph("Longest fuel gap by day", filteredEntries, entry => Number(entry.longestGapMinutes || 0), entry => durationText(Number(entry.longestGapMinutes || 0)), { max: maxGap, tone: "amber" }),
      renderPatternGraph("High Risk gap count by day", filteredEntries, entry => Number(entry.highRiskGapCount || 0), entry => `${entry.highRiskGapCount || 0} High Risk gap${Number(entry.highRiskGapCount || 0) === 1 ? "" : "s"}`, { max: maxRisk, tone: "red" })
    ].join("");
  }

  function renderHistory() {
    const summary = document.getElementById("fuelHistorySummary");
    const weekly = weeklySummary();
    if (summary) {
      summary.innerHTML = `
        <div class="fuel-gap-insight"><span>Days stored</span><strong>${weekly.entries.length}</strong><small>Local daily summaries.</small></div>
        <div class="fuel-gap-insight"><span>Fuel logs this week</span><strong>${weekly.totalLogs}</strong><small>One-tap fuel records.</small></div>
        <div class="fuel-gap-insight"><span>Longest weekly gap</span><strong>${safeText(durationText(weekly.longestGap))}</strong><small>Largest stored gap in the last 7 days.</small></div>
        <div class="fuel-gap-insight"><span>Repeated High Risk window</span><strong>${safeText(weekly.topWindow ? weekly.topWindow[0] : "Building")}</strong><small>${safeText(weekly.topWindow ? "Common High Risk gap window." : "Needs more daily summaries.")}</small></div>
        <div class="fuel-gap-insight"><span>Day type pattern</span><strong>${safeText(weekly.riskType ? weekly.riskType.label : "Building")}</strong><small>${safeText(weekly.riskType ? "Longest gaps cluster here." : "Tag day type to compare patterns.")}</small></div>
        <div class="fuel-gap-insight"><span>Average gap pattern</span><strong>${safeText(weekly.averageType ? weekly.averageType.label : "Building")}</strong><small>${safeText(weekly.averageType ? "Highest average gaps so far." : "Needs more history.")}</small></div>
      `;
    }
    renderHistoryAverages();

    const entries = archiveEntries();
    const select = document.getElementById("fuelHistoryArchiveDate");
    const count = document.getElementById("fuelHistoryCount");
    const detail = document.getElementById("fuelHistoryArchiveDetail");
    if (!select || !detail) return;
    if (!selectedHistoryKey || !entries.some(entry => entry.date === selectedHistoryKey)) selectedHistoryKey = entries[0]?.date || dateKey();
    select.innerHTML = entries.map(entry => {
      const labels = [entry.dayType ? entry.dayTypeLabel : "", entry.trainingSession ? entry.trainingSessionLabel : ""].filter(Boolean);
      return `<option value="${safeText(entry.date)}">${safeText(entry.dateLabel)}${labels.length ? ` - ${safeText(labels.join(" / "))}` : ""}</option>`;
    }).join("");
    select.value = selectedHistoryKey;
    if (count) count.textContent = `${loggedHistoryEntries().length} logged day${loggedHistoryEntries().length === 1 ? "" : "s"} stored`;
    detail.innerHTML = renderArchiveDetail(entries.find(entry => entry.date === selectedHistoryKey));
  }

  function drawBetaGraph(now = new Date()) {
    const canvas = document.getElementById("fuelRhythmGraph");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(rect.width || canvas.width));
    const cssHeight = Math.max(180, Math.round(rect.height || canvas.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const padding = { left: 34, right: 18, top: 18, bottom: 31 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const selectedMode = graphMode();
    const logs = todayLogs(now).filter(log => log.date <= now);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(log => !isFuelLog(log));
    const series = [];
    if (selectedMode === "fuel" || selectedMode === "combined") {
      series.push({ label: "Fuel", color: "#2dff88", logs: fuelLogs });
    }
    if (selectedMode === "hydration" || selectedMode === "combined") {
      series.push({ label: "Hydration", color: "#9fb7ff", logs: hydrationLogs });
    }
    const maxCount = Math.max(2, ...series.map(item => item.logs.length));
    const yForCount = count => bottom - (clamp(count, 0, maxCount) / maxCount) * plotHeight;

    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, bottom);
    ctx.moveTo(padding.left, bottom);
    ctx.lineTo(cssWidth - padding.right, bottom);
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(245,255,248,.55)";
    [360, 720, 1080].forEach((minute, index) => {
      ctx.fillText(["6am", "12pm", "6pm"][index], xForMinute(minute) - 12, cssHeight - 11);
    });
    ctx.fillText("logs", 6, padding.top + 4);
    ctx.fillText(String(maxCount), 11, yForCount(maxCount) + 4);
    ctx.fillText("0", 18, bottom + 4);

    const plotted = series.some(item => item.logs.length);
    if (!plotted) {
      ctx.fillStyle = "rgba(245,255,248,.62)";
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      const empty = selectedMode === "hydration" ? "No hydration logs yet." : selectedMode === "fuel" ? "No fuel logs yet." : "No fuel or hydration logs yet.";
      ctx.fillText(empty, padding.left + 12, padding.top + plotHeight / 2);
    }

    series.forEach((item, seriesIndex) => {
      const coordinates = item.logs.map((log, index) => ({
        log,
        x: xForMinute(minutesIntoDay(log.date)),
        y: yForCount(index + 1)
      }));
      if (coordinates.length > 1) {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        coordinates.forEach((point, index) => {
          if (index === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
      }
      coordinates.forEach(point => {
        ctx.fillStyle = item.color;
        ctx.strokeStyle = "rgba(3,10,8,.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, item.label === "Hydration" ? 4.5 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.fillStyle = item.color;
      ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(item.label, padding.left + seriesIndex * 82, padding.top + 12);
    });

    const currentX = xForMinute(minutesIntoDay(now));
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,255,248,.62)";
    ctx.fillText("Now", Math.min(currentX + 5, cssWidth - 42), padding.top + 27);
  }
  renderFuelGap = function renderFuelGapBeta() {
    const snapshot = fuelGapSnapshot();
    const summary = fuelDaySummary();
    const cooldown = cooldownRemainingSeconds();

    const badge = document.getElementById("fuelGraphLastAte");
    if (badge) badge.textContent = snapshot.lastFuelled === "No fuel logged" ? "Last fuel: not logged yet" : `Last fuel: ${snapshot.timeSinceFuel} ago`;

    const next = document.getElementById("fuelGapNextAction");
    if (next) {
      next.textContent = snapshot.nextAction;
      next.className = `fuel-next-action ${snapshot.status}`;
    }

    const context = document.getElementById("fuelStatusContext");
    if (context) {
      context.innerHTML = `<strong>Current gap:</strong><span class="status-pill ${snapshot.status}">${snapshot.status.toUpperCase()}</span><span>${safeText(snapshot.statusContext)}</span>`;
    }

    const button = document.getElementById("graphLogFoodButton");
    if (button) {
      button.textContent = "Log food";
      button.disabled = summary.dayEnded || cooldown > 0;
    }

    const hydrationButton = document.getElementById("graphLogHydrationButton");
    if (hydrationButton) hydrationButton.disabled = summary.dayEnded;

    const undo = document.getElementById("undoLatestFoodLog");
    if (undo) undo.disabled = !todayLogs().length;

    const cooldownEl = document.getElementById("foodLogCooldownMessage");
    if (cooldownEl) cooldownEl.textContent = cooldown > 0 ? `Logged. You can fuel again in ${cooldown}s.` : "";

    const endButton = document.getElementById("endFuelDayButton");
    if (endButton) endButton.disabled = summary.dayEnded;
    const continueButton = document.getElementById("continueFuelDayButton");
    if (continueButton) continueButton.disabled = !summary.dayEnded;

    const daySummary = document.getElementById("fuelDaySummary");
    if (daySummary) daySummary.innerHTML = `<p class="label">Today</p><p>${safeText(summary.message)}</p>`;

    renderGraphModeControls();
    renderGapInsights(snapshot);
    renderDayTypeControls();
    renderSettings();
    renderDayAnalysis();
    renderDailyLog();
    renderHistory();
    drawBetaGraph();
  };

  const baseSwitchScreen = switchScreen;
  switchScreen = function switchScreenBeta(screen) {
    const target = ["dashboard", "logs", "checklist"].includes(screen) ? screen : "dashboard";
    baseSwitchScreen(target);
    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.screen === target);
    });
    document.querySelectorAll(".mobile-nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileScreen === target);
    });
    const titles = {
      dashboard: ["Live Fuel Rhythm", "Track your fuel rhythm and spot fuelling gaps before you crash."],
      logs: ["Insights / History", "Review daily summaries and High Risk gap patterns."],
      checklist: ["Settings", "Adjust beta gap thresholds and reset test data."]
    };
    const title = document.getElementById("pageTitle");
    const subtitle = document.getElementById("pageSubtitle");
    if (title) title.textContent = titles[target][0];
    if (subtitle) subtitle.textContent = titles[target][1];
  };

  function saveThresholdSettings() {
    const green = Number(document.getElementById("greenThresholdMinutes")?.value || DEFAULT_THRESHOLDS.greenMinutes);
    const red = Number(document.getElementById("redThresholdMinutes")?.value || DEFAULT_THRESHOLDS.redMinutes);
    const gap = betaState();
    gap.thresholds.greenMinutes = clamp(green, 60, 360);
    gap.thresholds.redMinutes = clamp(Math.max(red, gap.thresholds.greenMinutes + 30), 120, 720);
    document.getElementById("fuelSettingsStatus").textContent = "Thresholds saved.";
    storeArchive(dateKey());
    save();
    renderAll();
  }

  function clearBetaData() {
    if (!window.confirm("Clear fuel beta logs, summaries, day types and thresholds?")) return;
    const gap = betaState();
    gap.logs = [];
    gap.archive = {};
    gap.dayTypes = {};
    gap.trainingSessions = {};
    gap.graphMode = "combined";
    gap.thresholds = { ...DEFAULT_THRESHOLDS };
    gap.dayEndedDate = "";
    gap.dayEndedAt = "";
    gap.fastingStartedAt = "";
    gap.cooldownUntil = 0;
    document.getElementById("fuelSettingsStatus").textContent = "Fuel beta data cleared.";
    save();
    renderAll();
  }

  document.querySelectorAll(".mobile-nav-item").forEach(button => {
    button.onclick = () => {
      switchScreen(button.dataset.mobileScreen);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    };
  });

  document.getElementById("undoLatestFoodLog")?.addEventListener("click", undoLatestRhythmLog);
  document.getElementById("graphLogHydrationButton")?.addEventListener("click", recordHydration);
  document.getElementById("fuelDayType")?.addEventListener("change", event => {
    setDayType(dateKey(), event.target.value);
    save();
    renderAll();
  });
  document.getElementById("fuelTrainingSession")?.addEventListener("change", event => {
    setTrainingSession(dateKey(), event.target.value);
    save();
    renderAll();
  });
  document.getElementById("fuelGraphModeControls")?.addEventListener("click", event => {
    const button = event.target.closest("[data-graph-mode]");
    if (!button) return;
    betaState().graphMode = GRAPH_MODES.has(button.dataset.graphMode) ? button.dataset.graphMode : "combined";
    save();
    renderFuelGap();
  });
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", event => {
    selectedHistoryKey = event.target.value;
    renderHistory();
  });
  document.getElementById("trainingInsightFilter")?.addEventListener("change", event => {
    selectedTrainingFilter = event.target.value || "all";
    renderHistoryAverages();
  });
  document.getElementById("saveFuelThresholds")?.addEventListener("click", saveThresholdSettings);
  document.getElementById("clearFuelBetaData")?.addEventListener("click", clearBetaData);
  document.getElementById("accountSetupButton")?.addEventListener("click", () => {
    state.account = { email: "", status: "", ...(state.account || {}) };
    const email = document.getElementById("accountEmail")?.value.trim() || "";
    state.account.email = email;
    state.account.status = email
      ? `Account setup ready for ${email}. Cloud sync backend not connected yet.`
      : "Enter an email to set up or log in when cloud sync is connected.";
    save();
    renderSettings();
  });

  window.addEventListener("resize", () => drawBetaGraph());

  renderAll();
  renderFuelGap();
  setInterval(renderFuelGap, 1000);
})();
