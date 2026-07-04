// Fuel Guard canonical mobile PWA layer.
// Focuses the app on real fuel and hydration logging, history, and settings.
(() => {
  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };
  const FOOD_LOG_COOLDOWN_MS = 60000;
  const DAY_TYPE_OPTIONS = [
    { value: "competition", label: "Competition Day" },
    { value: "travel", label: "Travelling Day" },
    { value: "work", label: "Working Day" },
    { value: "holiday", label: "Holiday" }
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
  const LEGACY_DAY_TYPE_MAP = {
    "competition/race day": "competition",
    "race": "competition",
    "shift": "work",
    "shift day": "work",
    "training + work day": "work",
    "training-work": "work",
    "work day": "work",
    "working day": "work",
    "travelling day": "travel",
    "traveling day": "travel",
    "travel": "travel",
    "holiday": "holiday",
    "competition day": "competition",
    "training": "",
    "training day": "",
    "rest": "",
    "rest day": "",
    "double-training": "",
    "standalone-training": ""
  };
  const DAY_TYPE_LABELS = DAY_TYPE_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {
    "training-work": "Working Day",
    training: "Not set",
    race: "Competition Day",
    shift: "Working Day",
    rest: "Not set",
    "double-training": "Not set",
    "standalone-training": "Not set",
    other: "Other"
  });

  let selectedHistoryKey = "";
  let selectedTrainingFilter = "all";
  let accountBusy = false;

  function urlRequestsPasswordRecovery() {
    return new URLSearchParams(window.location.search).get("auth") === "recovery"
      || /(?:^|[&#?])(?:type|auth)=recovery(?:$|[&#=])/.test(window.location.hash || "");
  }

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

  function normalizeDayType(value) {
    const key = String(value || "").trim().toLowerCase();
    if (!key) return "";
    return Object.prototype.hasOwnProperty.call(LEGACY_DAY_TYPE_MAP, key)
      ? LEGACY_DAY_TYPE_MAP[key]
      : DAY_TYPE_OPTIONS.some(option => option.value === value)
        ? value
        : "";
  }

  function normalizeStoredDayTypes(gap) {
    if (!gap || typeof gap !== "object") return;
    Object.keys(gap.dayTypes || {}).forEach(key => {
      const next = normalizeDayType(gap.dayTypes[key]);
      if (next) gap.dayTypes[key] = next;
      else delete gap.dayTypes[key];
    });
    Object.values(gap.archive || {}).forEach(entry => {
      if (!entry || typeof entry !== "object") return;
      entry.dayType = normalizeDayType(entry.dayType);
      entry.dayTypeLabel = entry.dayType ? DAY_TYPE_LABELS[entry.dayType] || entry.dayType : "Not set";
    });
    (gap.logs || []).forEach(log => {
      if (!log || typeof log !== "object") return;
      log.dayType = normalizeDayType(log.dayType);
    });
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
    normalizeStoredDayTypes(gap);
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
    if (type === "hydration") return "hydration";
    if (type === "fuel_hydration") return "fuel_hydration";
    return "fuel";
  }

  function isFuelLog(log) {
    const type = logType(log);
    return type === "fuel" || type === "fuel_hydration";
  }

  function isHydrationLog(log) {
    const type = logType(log);
    return type === "hydration" || type === "fuel_hydration";
  }

  function logTypeLabel(log) {
    const type = logType(log);
    if (type === "hydration") return "Hydration";
    if (type === "fuel_hydration") return "Fuel + Hydration";
    return "Fuel";
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
    return normalizeDayType(gap.dayTypes[key] || gap.archive[key]?.dayType || "");
  }

  function trainingSessionForKey(key) {
    const gap = betaState();
    return gap.trainingSessions[key] || gap.archive[key]?.trainingSession || "";
  }

  function isTrainingSession(value) {
    return ["run", "bike", "swim", "strength", "brick"].includes(String(value || ""));
  }

  function isTrainingDayValue(dayType, session = "") {
    return isTrainingSession(session);
  }

  function setDayType(key, value) {
    const gap = betaState();
    const nextValue = normalizeDayType(value);
    if (nextValue) gap.dayTypes[key] = nextValue;
    else delete gap.dayTypes[key];

    gap.logs.forEach(log => {
      const date = logDate(log);
      if (date && dateKey(date) === key) log.dayType = nextValue || "";
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
    const hydrationLogs = logs.filter(isHydrationLog);
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
        typeLabel: logTypeLabel(log),
        dayType: log.dayType || analysis.dayType,
        trainingSession: log.trainingSession || analysis.trainingSession,
        note: log.note || ""
      })),
      gapMinutes: analysis.gaps.map(gap => Math.max(0, Math.round(gap.minutes))).filter(Number.isFinite),
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

  function recordRhythmLog(type = "fuel", options = {}) {
    if (fuelDayEndSnapshot().dayEnded) return;
    const normalizedType = ["fuel", "hydration", "fuel_hydration"].includes(type) ? type : "fuel";
    const includesFuel = normalizedType === "fuel" || normalizedType === "fuel_hydration";
    const label = normalizedType === "hydration"
      ? "Hydration logged"
      : normalizedType === "fuel_hydration"
        ? "Fuel + hydration logged"
        : "Fuelled";
    if (includesFuel && cooldownRemainingSeconds() > 0) {
      renderFuelGap();
      return;
    }

    const key = dateKey();
    const log = {
      id: uid(),
      timestamp: new Date().toISOString(),
      label,
      type: normalizedType,
      source: options.source || "manual",
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key),
      syncStatus: "pending"
    };
    betaState().logs.push(log);
    if (includesFuel) setCooldown();
    storeArchive(key);
    state.completed.liveFuelStatus = true;
    if (typeof recordFuelMomentum === "function") {
      recordFuelMomentum(
        normalizedType === "hydration" ? "hydrationLogged" : "fuelLogged",
        normalizedType === "hydration" ? "Hydration logged. Rhythm graph updated." : "Fuel logged. Gap tracker updated.",
        normalizedType === "hydration" ? "Hydration logged. Fuel rhythm comparison updated. +1 Fuel Momentum" : "Fuel logged. Your fuel rhythm is up to date. +1 Fuel Momentum",
        { dedupeDaily: false }
      );
    } else if (typeof addActivityEntry === "function") {
      addActivityEntry(normalizedType === "hydration" ? "hydrationLogged" : "fuelLogged", normalizedType === "hydration" ? "Hydration logged. Rhythm graph updated." : "Fuel logged. Gap tracker updated.", { dedupeDaily: false });
    }
    save();
    renderAll();
    window.fuelGuardCloud?.saveLog(log);
  }

  recordFuelled = function recordFuelledBeta(options = {}) {
    recordRhythmLog("fuel", options);
  };

  function recordHydration() {
    recordRhythmLog("hydration", { source: "manual" });
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
    const removed = betaState().logs.splice(latestIndex, 1)[0];
    if (latestType === "fuel" || latestType === "fuel_hydration") clearCooldown();
    storeArchive(key);
    addActivityEntry("fuelLogUndo", "Latest rhythm log undone.", { dedupeDaily: false });
    save();
    renderAll();
    window.fuelGuardCloud?.deleteLog(removed);
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
      <div class="fuel-gap-insight"><span>Longest gap today</span><strong>${safeText(durationText(analysis.longestGapMinutes))}</strong><small>${analysis.fuelLogCount ? "Today’s biggest fuel gap." : "Tap Log Fuel to start."}</small></div>
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
    const buildInfo = window.FUEL_GUARD_BUILD || {};
    const canonical = document.getElementById("canonicalAppVersion");
    const buildMarker = document.getElementById("buildVersionMarker");
    const currentBuild = document.getElementById("appUpdateCurrentBuild");
    const updateStatus = document.getElementById("appUpdateStatus");
    const canonicalText = `Canonical app: ${buildInfo.canonicalApp || "mobile-pwa-v7-password-reset"}`;
    const buildText = buildInfo.buildVersion || "unknown build";
    if (canonical) canonical.textContent = canonicalText;
    if (buildMarker) buildMarker.textContent = `Build version: ${buildText}`;
    if (currentBuild) currentBuild.textContent = buildText;
    if (updateStatus && !updateStatus.dataset.userMessage) {
      updateStatus.textContent = "Update status: ready. User logs are stored separately and will not be cleared.";
    }
    state.account = { email: "", status: "", ...(state.account || {}) };
    const cloud = window.fuelGuardCloud?.accountView?.() || null;
    const recovering = Boolean(cloud?.recovering);
    const loggedOut = document.getElementById("accountLoggedOut");
    const recoveryPanel = document.getElementById("accountRecoveryPanel");
    const loggedIn = document.getElementById("accountLoggedIn");
    const email = document.getElementById("accountEmail");
    const password = document.getElementById("accountPassword");
    const newPassword = document.getElementById("accountNewPassword");
    const confirmPassword = document.getElementById("accountConfirmPassword");
    const status = document.getElementById("accountSetupStatus");
    const userEmail = document.getElementById("accountUserEmail");
    const cloudStatus = document.getElementById("accountCloudStatus");
    const signIn = document.getElementById("accountSignInButton");
    const signUp = document.getElementById("accountSignUpButton");
    const forgot = document.getElementById("accountForgotPasswordButton");
    const signOut = document.getElementById("accountSignOutButton");
    const sync = document.getElementById("accountSyncButton");
    const updatePassword = document.getElementById("accountUpdatePasswordButton");
    const cancelRecovery = document.getElementById("accountCancelRecoveryButton");
    if (loggedOut) loggedOut.hidden = recovering || Boolean(cloud?.signedIn);
    if (recoveryPanel) recoveryPanel.hidden = !recovering;
    if (loggedIn) loggedIn.hidden = recovering || !cloud?.signedIn;
    if (email && document.activeElement !== email) email.value = cloud?.email || state.account.email || "";
    if (password && (cloud?.signedIn || recovering) && document.activeElement !== password) password.value = "";
    if (newPassword && !recovering && document.activeElement !== newPassword) newPassword.value = "";
    if (confirmPassword && !recovering && document.activeElement !== confirmPassword) confirmPassword.value = "";
    if (userEmail) userEmail.textContent = cloud?.email || "Signed in";
    if (cloudStatus) {
      const pending = cloud?.pending ? `${cloud.pending} pending local change${cloud.pending === 1 ? "" : "s"}` : "All available logs synced";
      cloudStatus.textContent = accountBusy ? "Working..." : pending;
    }
    if (signIn) signIn.disabled = accountBusy || recovering || !cloud?.configured || cloud?.signedIn;
    if (signUp) signUp.disabled = accountBusy || recovering || !cloud?.configured || cloud?.signedIn;
    if (forgot) forgot.disabled = accountBusy || recovering || !cloud?.configured || cloud?.signedIn;
    if (signOut) signOut.disabled = accountBusy || recovering || !cloud?.signedIn;
    if (sync) sync.disabled = accountBusy || recovering || !cloud?.signedIn;
    if (updatePassword) updatePassword.disabled = accountBusy || !recovering || !cloud?.configured;
    if (cancelRecovery) cancelRecovery.disabled = accountBusy || !recovering;
    if (status) {
      const pending = cloud?.pending ? ` ${cloud.pending} pending local change${cloud.pending === 1 ? "" : "s"}.` : "";
      status.setAttribute("aria-busy", accountBusy ? "true" : "false");
      status.textContent = state.account.status
        ? state.account.status
        : cloud?.status
          ? `${cloud.status}${pending}`
        : "Cloud sync needs Supabase public URL/key configuration.";
    }
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
      ? logs.map(log => `<div class="row"><div><div class="item-name">${formatClock(log.date)} - ${logTypeLabel(log)} logged</div></div></div>`).join("")
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
    if (filter === "rest") return entry.trainingSession === "rest";
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

  function compactDuration(minutes) {
    if (!Number.isFinite(minutes)) return "Not enough data";
    const rounded = Math.max(0, Math.round(Math.abs(minutes)));
    if (rounded < 60) return `${rounded}m`;
    const hours = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function allGapMinutes(entries) {
    return entries
      .flatMap(entry => Array.isArray(entry.gapMinutes) ? entry.gapMinutes : [])
      .map(Number)
      .filter(value => Number.isFinite(value) && value >= 0);
  }

  function gapBucket(minutes) {
    if (!Number.isFinite(minutes)) return null;
    if (minutes < 60) return { label: "0-1 hours", order: 0 };
    if (minutes < 120) return { label: "1-2 hours", order: 1 };
    if (minutes < 180) return { label: "2-3 hours", order: 2 };
    if (minutes < 240) return { label: "3-4 hours", order: 3 };
    return { label: "4+ hours", order: 4 };
  }

  function mostCommonFuelGap(entries) {
    const counts = {};
    const orders = {};
    allGapMinutes(entries).forEach(minutes => {
      const bucket = gapBucket(minutes);
      if (!bucket) return;
      counts[bucket.label] = (counts[bucket.label] || 0) + 1;
      orders[bucket.label] = bucket.order;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1] || orders[a[0]] - orders[b[0]])[0];
    return top ? { label: top[0], count: top[1] } : { label: "Not enough data", count: 0 };
  }

  function averageBetweenFuelLogs(entries) {
    return averageValue(allGapMinutes(entries));
  }

  function standardDeviation(values) {
    const finite = values.filter(value => Number.isFinite(value));
    if (finite.length < 2) return null;
    const average = averageValue(finite);
    const variance = finite.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / finite.length;
    return Math.sqrt(variance);
  }

  function comparisonWindows(entries) {
    const sorted = [...entries].sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));
    return {
      recent: sorted.slice(-7),
      previous: sorted.slice(Math.max(0, sorted.length - 14), Math.max(0, sorted.length - 7))
    };
  }

  function renderAverageMetric(label, value, note) {
    return `<div class="fuel-gap-insight"><span>${safeText(label)}</span><strong>${safeText(value)}</strong><small>${safeText(note)}</small></div>`;
  }

  function renderTrendMetric(label, value, note, tone = "neutral") {
    return `<div class="fuel-gap-insight beta-trend-card ${tone}"><span>${safeText(label)}</span><strong>${safeText(value)}</strong><small>${safeText(note)}</small></div>`;
  }

  function timeTrend(recentValue, previousValue, earlierCopy, laterCopy, steadyCopy) {
    if (!Number.isFinite(recentValue)) return { value: "Not enough data", note: "Log more fuel times to compare." };
    if (!Number.isFinite(previousValue)) return { value: steadyCopy, note: "Needs previous logged days for comparison." };
    const diff = recentValue - previousValue;
    if (Math.abs(diff) < 15) return { value: steadyCopy, note: "Within 15m of the previous period." };
    return diff < 0
      ? { value: earlierCopy, note: `${compactDuration(diff)} earlier than previous 7 logged days.` }
      : { value: laterCopy, note: `${compactDuration(diff)} later than previous 7 logged days.` };
  }

  function numberTrend(recentValue, previousValue, lowerCopy, higherCopy, steadyCopy, { threshold = 0.15, lowerIsBetter = true, suffix = "" } = {}) {
    if (!Number.isFinite(recentValue)) return { value: "Not enough data", note: "Log more days to compare." };
    if (!Number.isFinite(previousValue)) return { value: steadyCopy, note: "Needs previous logged days for comparison." };
    const diff = recentValue - previousValue;
    if (Math.abs(diff) < threshold) return { value: steadyCopy, note: "Close to the previous period." };
    const change = `${Math.abs(diff).toFixed(Math.abs(diff) < 1 ? 1 : 0)}${suffix}`;
    const improving = lowerIsBetter ? diff < 0 : diff > 0;
    return diff < 0
      ? { value: lowerCopy, note: `${change} lower than previous 7 logged days.`, tone: improving ? "good" : "watch" }
      : { value: higherCopy, note: `${change} higher than previous 7 logged days.`, tone: improving ? "good" : "watch" };
  }

  function renderHabitChangeSection(entries) {
    const { recent, previous } = comparisonWindows(entries);
    const recentCommon = mostCommonFuelGap(recent);
    const previousCommon = mostCommonFuelGap(previous);
    const recentGapMinutes = allGapMinutes(recent);
    const previousGapMinutes = allGapMinutes(previous);

    if (recent.length < 2) {
      return `
        <section class="beta-habit-trends">
          <div class="beta-habit-heading"><h3>Habit change</h3><span>Recent days versus earlier logged days</span></div>
          <p class="muted beta-history-empty">Log at least two days to start seeing habit changes.</p>
        </section>
      `;
    }

    const firstFuel = timeTrend(
      averageValue(recent.map(entry => entry.firstFuelMinute)),
      averageValue(previous.map(entry => entry.firstFuelMinute)),
      "First fuel is getting earlier",
      "First fuel is getting later",
      "First fuel is staying similar"
    );
    const lastFuel = timeTrend(
      averageValue(recent.map(entry => entry.lastFuelMinute)),
      averageValue(previous.map(entry => entry.lastFuelMinute)),
      "Last fuel is getting earlier",
      "Last fuel is getting later",
      "Last fuel is staying similar"
    );
    const fuelLogs = numberTrend(
      averageValue(recent.map(entry => Number(entry.fuelLogCount || 0))),
      averageValue(previous.map(entry => Number(entry.fuelLogCount || 0))),
      "Fuel logs per day are decreasing",
      "Fuel logs per day are increasing",
      "Fuel logs per day are steady",
      { lowerIsBetter: false, suffix: "/day" }
    );
    const longestGaps = numberTrend(
      averageValue(recent.map(entry => Number(entry.longestGapMinutes || 0))),
      averageValue(previous.map(entry => Number(entry.longestGapMinutes || 0))),
      "Longest gaps are reducing",
      "Longest gaps are increasing",
      "Longest gaps are steady",
      { threshold: 15, suffix: "m" }
    );
    const highRiskGaps = numberTrend(
      averageValue(recent.map(entry => Number(entry.highRiskGapCount || 0))),
      averageValue(previous.map(entry => Number(entry.highRiskGapCount || 0))),
      "High Risk gaps are reducing",
      "High Risk gaps are increasing",
      "High Risk gaps are steady",
      { threshold: 0.25, suffix: "/day" }
    );
    const averageGap = numberTrend(
      averageBetweenFuelLogs(recent),
      averageBetweenFuelLogs(previous),
      "Average time between fuel logs is reducing",
      "Average time between fuel logs is increasing",
      "Average time between fuel logs is steady",
      { threshold: 15, suffix: "m" }
    );
    const recentConsistency = standardDeviation(recentGapMinutes);
    const previousConsistency = standardDeviation(previousGapMinutes);
    const consistency = numberTrend(
      recentConsistency,
      previousConsistency,
      "Fuel rhythm is becoming more consistent",
      "Fuel rhythm is becoming less consistent",
      "Fuel rhythm is staying consistent",
      { threshold: 15, suffix: "m" }
    );
    const commonCopy = previousCommon.count
      ? recentCommon.label === previousCommon.label
        ? "Most common fuel gap is steady"
        : "Most common fuel gap has shifted"
      : "Most common fuel gap is building";
    const commonNote = previousCommon.count
      ? `Recent: ${recentCommon.label}; previous: ${previousCommon.label}.`
      : `Recent ${recent.length} logged day${recent.length === 1 ? "" : "s"} only.`;

    return `
      <section class="beta-habit-trends">
        <div class="beta-habit-heading"><h3>Habit change</h3><span>Recent ${recent.length} logged day${recent.length === 1 ? "" : "s"} versus previous ${previous.length || 0}</span></div>
        <div class="fuel-gap-insights beta-habit-grid">
          ${renderTrendMetric("First fuel time", firstFuel.value, firstFuel.note)}
          ${renderTrendMetric("Last fuel time", lastFuel.value, lastFuel.note)}
          ${renderTrendMetric("Fuel logs per day", fuelLogs.value, fuelLogs.note, fuelLogs.tone)}
          ${renderTrendMetric("Longest fuel gap", longestGaps.value, longestGaps.note, longestGaps.tone)}
          ${renderTrendMetric("High Risk gaps", highRiskGaps.value, highRiskGaps.note, highRiskGaps.tone)}
          ${renderTrendMetric("Average time between fuel logs", averageGap.value, averageGap.note, averageGap.tone)}
          ${renderTrendMetric("Most common fuel gap", commonCopy, commonNote)}
          ${renderTrendMetric("Rhythm consistency", consistency.value, consistency.note, consistency.tone)}
        </div>
      </section>
    `;
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
    const habitTarget = document.getElementById("fuelHabitChangeSummary");
    const graphTarget = document.getElementById("fuelAveragePatternGraphs");
    if (!summaryTarget || !graphTarget) return;

    const allEntries = loggedHistoryEntries();
    const filteredEntries = allEntries.filter(entry => entryMatchesTrainingFilter(entry, selectedTrainingFilter));
    if (!allEntries.length) {
      summaryTarget.innerHTML = `<p class="muted beta-history-empty">No logged days yet. Log fuel for a few days and averages will appear here.</p>`;
      if (habitTarget) habitTarget.innerHTML = "";
      graphTarget.innerHTML = "";
      return;
    }
    if (!filteredEntries.length) {
      summaryTarget.innerHTML = `<p class="muted beta-history-empty">No logged days match ${safeText(trainingFilterLabel(selectedTrainingFilter))} yet.</p>`;
      if (habitTarget) habitTarget.innerHTML = "";
      graphTarget.innerHTML = "";
      return;
    }

    const commonGap = mostCommonFuelGap(filteredEntries);
    summaryTarget.innerHTML = `<div class="fuel-gap-insights beta-average-grid">${[
      renderAverageMetric("Average daily first fuel time", averageClock(filteredEntries.map(entry => entry.firstFuelMinute)), `${filteredEntries.length} logged day${filteredEntries.length === 1 ? "" : "s"}`),
      renderAverageMetric("Average daily last fuel time", averageClock(filteredEntries.map(entry => entry.lastFuelMinute)), trainingFilterLabel(selectedTrainingFilter)),
      renderAverageMetric("Average number of fuel logs per day", averageNumber(filteredEntries.map(entry => Number(entry.fuelLogCount || 0))), "Real logged fuel points"),
      renderAverageMetric("Average number of High Risk gaps per day", averageNumber(filteredEntries.map(entry => Number(entry.highRiskGapCount || 0))), "Based on current red threshold"),
      renderAverageMetric("Average longest fuel gap per day", durationText(averageValue(filteredEntries.map(entry => Number(entry.longestGapMinutes || 0))) || 0), "Average of each day's longest gap"),
      renderAverageMetric("Most common fuel gap", commonGap.label, commonGap.count ? `${commonGap.count} logged gap${commonGap.count === 1 ? "" : "s"} in this bucket` : "Needs more fuel gaps")
    ].join("")}</div>`;
    if (habitTarget) habitTarget.innerHTML = renderHabitChangeSection(filteredEntries);

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

    const padding = { left: 40, right: 22, top: 36, bottom: 38 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const selectedMode = graphMode();
    const logs = todayLogs(now).filter(log => log.date <= now);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
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
    [0, 360, 720, 1080, 1440].forEach(minute => {
      const x = xForMinute(minute);
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, bottom);
    });
    ctx.moveTo(padding.left, bottom);
    ctx.lineTo(cssWidth - padding.right, bottom);
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(245,255,248,.55)";
    ctx.textAlign = "center";
    [
      [0, "00:00"],
      [360, "06:00"],
      [720, "12:00"],
      [1080, "18:00"],
      [1440, "24:00"]
    ].forEach(([minute, label]) => {
      ctx.fillText(label, xForMinute(minute), cssHeight - 12);
    });
    ctx.textAlign = "left";
    ctx.fillText("logs", 6, padding.top + 4);
    ctx.fillText(String(maxCount), 11, yForCount(maxCount) + 4);
    ctx.fillText("0", 18, bottom + 4);

    const labelY = 20;
    const labelGap = Math.min(142, Math.max(96, plotWidth * 0.24));
    series.forEach((item, index) => {
      const labelX = series.length === 1
        ? cssWidth / 2
        : cssWidth / 2 + (index - (series.length - 1) / 2) * labelGap;
      ctx.fillStyle = item.color;
      ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(item.label, labelX, labelY);
    });

    const plotted = series.some(item => item.logs.length);
    if (!plotted) {
      ctx.fillStyle = "rgba(245,255,248,.62)";
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      const empty = selectedMode === "hydration" ? "No hydration logs yet." : selectedMode === "fuel" ? "No fuel logs yet." : "No fuel or hydration logs yet.";
      ctx.textAlign = "center";
      ctx.fillText(empty, padding.left + plotWidth / 2, padding.top + plotHeight / 2);
    }

    series.forEach(item => {
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
    });

    const currentX = xForMinute(minutesIntoDay(now));
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,255,248,.62)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Now", clamp(currentX, padding.left + 18, cssWidth - padding.right - 18), labelY);
    ctx.textAlign = "left";
  }
  renderFuelGap = function renderFuelGapBeta() {
    const snapshot = fuelGapSnapshot();
    const summary = fuelDaySummary();
    const cooldown = cooldownRemainingSeconds();
    const dashboardActive = document.getElementById("dashboard")?.classList.contains("active");
    const historyActive = document.getElementById("logs")?.classList.contains("active");
    const settingsActive = document.getElementById("checklist")?.classList.contains("active");

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
      button.textContent = "Log Fuel";
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
    if (dashboardActive) {
      renderGapInsights(snapshot);
      renderDayTypeControls();
      renderDayAnalysis();
      renderDailyLog();
      drawBetaGraph();
    }
    if (settingsActive) renderSettings();
    if (historyActive) renderHistory();
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
    if (target === "logs") renderHistory();
    if (target === "checklist") renderSettings();
    if (target === "dashboard") requestAnimationFrame(() => drawBetaGraph());
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

  async function clearBetaData() {
    if (!window.confirm("Clear fuel beta logs, summaries, day types and thresholds?")) return;
    const settingsStatus = document.getElementById("fuelSettingsStatus");
    let clearStatus = "Fuel beta data cleared.";
    try {
      await window.fuelGuardCloud?.clearCloudLogs();
    } catch (error) {
      clearStatus = `Local data cleared. Cloud clear will retry: ${error?.message || "unknown error"}`;
    }
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
    if (settingsStatus) settingsStatus.textContent = clearStatus;
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
    const key = dateKey();
    setDayType(key, event.target.value);
    save();
    renderAll();
    window.fuelGuardCloud?.syncLogsForDay(key);
  });
  document.getElementById("fuelTrainingSession")?.addEventListener("change", event => {
    const key = dateKey();
    setTrainingSession(key, event.target.value);
    save();
    renderAll();
    window.fuelGuardCloud?.syncLogsForDay(key);
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
  window.addEventListener("fuelguard:pwa-update-status", event => {
    const status = document.getElementById("appUpdateStatus");
    if (!status) return;
    status.dataset.userMessage = "true";
    status.textContent = event.detail?.message || "Update status changed.";
  });
  window.addEventListener("fuelguard:cloud-status", () => {
    if (document.getElementById("checklist")?.classList.contains("active")) renderSettings();
  });
  document.getElementById("checkAppUpdateButton")?.addEventListener("click", async () => {
    const status = document.getElementById("appUpdateStatus");
    if (status) {
      status.dataset.userMessage = "true";
      status.textContent = "Update status: checking for update...";
    }
    if (window.fuelGuardPwaUpdates?.checkForUpdate) {
      await window.fuelGuardPwaUpdates.checkForUpdate();
      return;
    }
    if (status) status.textContent = "Update status: update checker is not ready in this browser.";
  });
  function accountCredentials() {
    state.account = { email: "", status: "", ...(state.account || {}) };
    const email = document.getElementById("accountEmail")?.value.trim() || "";
    const password = document.getElementById("accountPassword")?.value || "";
    state.account.email = email;
    save();
    return { email, password };
  }

  function setAccountStatus(message) {
    state.account = { email: "", status: "", ...(state.account || {}), status: message };
    const status = document.getElementById("accountSetupStatus");
    if (status) status.textContent = message;
    save();
    renderSettings();
  }

  function clearAccountStatus() {
    state.account = { email: "", status: "", ...(state.account || {}), status: "" };
    save();
  }

  function recoveryPasswords() {
    return {
      password: document.getElementById("accountNewPassword")?.value || "",
      confirmation: document.getElementById("accountConfirmPassword")?.value || ""
    };
  }

  document.getElementById("accountSignInButton")?.addEventListener("click", async () => {
    const { email, password } = accountCredentials();
    if (!email || !password) {
      setAccountStatus("Enter email and password to sign in.");
      return;
    }
    try {
      accountBusy = true;
      setAccountStatus("Signing in...");
      await window.fuelGuardCloud?.signIn(email, password);
      clearAccountStatus();
    } catch (error) {
      setAccountStatus(`Sign in failed: ${error?.message || "unknown error"}`);
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountSignUpButton")?.addEventListener("click", async () => {
    const { email, password } = accountCredentials();
    if (!email || !password) {
      setAccountStatus("Enter email and password to create an account.");
      return;
    }
    try {
      accountBusy = true;
      setAccountStatus("Creating account...");
      await window.fuelGuardCloud?.signUp(email, password);
      clearAccountStatus();
    } catch (error) {
      setAccountStatus(`Account creation failed: ${error?.message || "unknown error"}`);
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountForgotPasswordButton")?.addEventListener("click", async () => {
    const { email } = accountCredentials();
    if (!email) {
      setAccountStatus("Enter your email address to reset your password.");
      return;
    }
    try {
      accountBusy = true;
      setAccountStatus("Sending password reset email...");
      await window.fuelGuardCloud?.sendPasswordReset(email);
      clearAccountStatus();
    } catch (error) {
      setAccountStatus(`Password reset failed: ${error?.message || "unknown error"}`);
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountSignOutButton")?.addEventListener("click", async () => {
    try {
      accountBusy = true;
      setAccountStatus("Signing out...");
      await window.fuelGuardCloud?.signOut();
      clearAccountStatus();
    } catch (error) {
      setAccountStatus(`Sign out failed: ${error?.message || "unknown error"}`);
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountUpdatePasswordButton")?.addEventListener("click", async () => {
    const { password, confirmation } = recoveryPasswords();
    if (!password || !confirmation) {
      setAccountStatus("Enter and confirm your new password.");
      return;
    }
    if (password !== confirmation) {
      setAccountStatus("New passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setAccountStatus("Password must be at least 6 characters.");
      return;
    }
    try {
      accountBusy = true;
      setAccountStatus("Updating password...");
      await window.fuelGuardCloud?.updatePassword(password);
      const newPassword = document.getElementById("accountNewPassword");
      const confirmPassword = document.getElementById("accountConfirmPassword");
      if (newPassword) newPassword.value = "";
      if (confirmPassword) confirmPassword.value = "";
      clearAccountStatus();
    } catch (error) {
      setAccountStatus(`Password update failed: ${error?.message || "unknown error"}`);
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountCancelRecoveryButton")?.addEventListener("click", () => {
    window.fuelGuardCloud?.cancelPasswordRecovery();
    const newPassword = document.getElementById("accountNewPassword");
    const confirmPassword = document.getElementById("accountConfirmPassword");
    if (newPassword) newPassword.value = "";
    if (confirmPassword) confirmPassword.value = "";
    clearAccountStatus();
    renderSettings();
  });
  document.getElementById("accountSyncButton")?.addEventListener("click", async () => {
    try {
      accountBusy = true;
      setAccountStatus("Syncing...");
      await window.fuelGuardCloud?.syncNow();
      clearAccountStatus();
    } catch (error) {
      setAccountStatus(`Sync failed: ${error?.message || "unknown error"}`);
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  window.addEventListener("fuelguard:password-recovery", event => {
    if (event.detail?.active) switchScreen("checklist");
    else if (document.getElementById("checklist")?.classList.contains("active")) renderSettings();
  });

  if (urlRequestsPasswordRecovery()) {
    requestAnimationFrame(() => switchScreen("checklist"));
  }

  let graphResizeQueued = false;
  window.addEventListener("resize", () => {
    if (graphResizeQueued) return;
    graphResizeQueued = true;
    requestAnimationFrame(() => {
      graphResizeQueued = false;
      if (document.getElementById("dashboard")?.classList.contains("active")) drawBetaGraph();
    });
  });

  function scheduleFuelGuardTick() {
    const delay = cooldownRemainingSeconds() > 0 ? 1000 : 30000;
    window.setTimeout(() => {
      renderFuelGap();
      scheduleFuelGuardTick();
    }, delay);
  }

  renderAll();
  scheduleFuelGuardTick();
})();
