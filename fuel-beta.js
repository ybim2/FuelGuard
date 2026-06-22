// Fuel Guard beta MVP layer.
// Keeps the old feature code available, but focuses the visible app on fuel logging and gap analysis.
(() => {
  const FLAGS = {
    ENABLE_NUTRITION_DIARY: false,
    ENABLE_FUEL_CONFIRMATION: false,
    ENABLE_PANTRY: false,
    ENABLE_SHOPPING_FORECAST: false
  };
  window.FUEL_GUARD_BETA_FLAGS = FLAGS;

  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };
  const FOOD_LOG_COOLDOWN_MS = 60000;
  const PREDICTION_MIN_SIMILAR_DAYS = 2;
  const PLANNING_BUFFER_MINUTES = 45;
  const DAY_TYPE_OPTIONS = [
    { value: "training-work", label: "Training + work day" },
    { value: "training", label: "Training day" },
    { value: "work", label: "Work day" },
    { value: "shift", label: "Shift day" },
    { value: "rest", label: "Rest day" }
  ];
  const DAY_TYPE_LABELS = DAY_TYPE_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {
    "double-training": "Training day",
    "standalone-training": "Training day",
    other: "Other"
  });

  let selectedHistoryKey = "";

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
    if (!gap.archive || Array.isArray(gap.archive)) gap.archive = {};
    if (!gap.thresholds || typeof gap.thresholds !== "object") gap.thresholds = { ...DEFAULT_THRESHOLDS };
    gap.thresholds.greenMinutes = Number(gap.thresholds.greenMinutes || DEFAULT_THRESHOLDS.greenMinutes);
    gap.thresholds.redMinutes = Number(gap.thresholds.redMinutes || DEFAULT_THRESHOLDS.redMinutes);
    if (gap.thresholds.redMinutes <= gap.thresholds.greenMinutes) gap.thresholds.redMinutes = gap.thresholds.greenMinutes + 60;
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

  function dayTypeForKey(key) {
    const gap = betaState();
    return gap.dayTypes[key] || gap.archive[key]?.dayType || "";
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
    const endedDate = endedAt ? logDate(endedAt) : null;
    const isToday = key === dateKey(now);
    const reference = endedDate || (isToday ? now : fuelLogs[fuelLogs.length - 1]?.date || logs[logs.length - 1]?.date || dateFromKey(key));
    const gaps = gapsFromFuelLogs(fuelLogs, reference, Boolean(endedDate) || isToday, !endedDate && isToday);
    const completedGaps = gaps.filter(gap => !gap.ongoing);
    const longGaps = gaps.filter(gap => gap.minutes >= riskLimit());
    const completedLongGaps = completedGaps.filter(gap => gap.minutes >= riskLimit());
    const longest = gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : 0;
    const average = gaps.length ? gaps.reduce((sum, gap) => sum + gap.minutes, 0) / gaps.length : 0;
    const firstLongGap = longGaps[0] || null;
    const dangerStart = firstLongGap ? addMinutes(firstLongGap.start, riskLimit()) : null;
    const fuelNeededBefore = dangerStart ? addMinutes(dangerStart, -PLANNING_BUFFER_MINUTES) : null;
    const reactive = completedLongGaps.length > 0 && completedLongGaps.length >= Math.ceil(Math.max(1, completedGaps.length) / 2);
    const firstFuel = fuelLogs[0] || null;
    const lastFuel = fuelLogs[fuelLogs.length - 1] || null;
    const dayType = dayTypeForKey(key);
    const summary = [];

    if (!fuelLogs.length) {
      summary.push("No fuel logs recorded for this day.");
      summary.push("Log a few more days to predict your danger window.");
    } else if (!gaps.length) {
      summary.push("Only one fuel log is available for this day.");
      summary.push("More fuel logs are needed before Fuel Guard can identify a danger window.");
    } else {
      summary.push(`Your longest fuel gap was ${duration(longest)}.`);
      if (firstLongGap && dangerStart) {
        summary.push(`Your danger window started around ${formatClock(dangerStart)}.`);
        summary.push(`You needed fuel available before ${formatClock(fuelNeededBefore)}.`);
      } else {
        summary.push("No red danger window was detected from the available fuel logs.");
      }
      if (reactive) summary.push("This looks like a reactive fuelling day rather than a planned fuelling day.");
      if (["shift", "training-work", "work"].includes(dayType) && longGaps.length) {
        summary.push(`${dayTypeLabel(dayType)} context: high-output days need reliable fuel access before the gap turns red.`);
      }
      if (fuelLogs.length < 3 || !firstLongGap) summary.push("More weekly data will make this pattern clearer.");
    }

    return {
      date: key,
      dateLabel: formatDateKey(key),
      dayType,
      dayTypeLabel: dayTypeLabel(dayType),
      logs,
      fuelLogs,
      firstFuelTime: firstFuel ? formatClock(firstFuel.date) : "Not logged",
      lastFuelTime: lastFuel ? formatClock(lastFuel.date) : "Not logged",
      fuelLogCount: fuelLogs.length,
      gaps,
      longestGapMinutes: longest,
      averageGapMinutes: average,
      longGapCount: longGaps.length,
      dangerStartMinute: dangerStart ? minutesIntoDay(dangerStart) : null,
      dangerEndMinute: firstLongGap ? minutesIntoDay(firstLongGap.end) : null,
      actualDangerWindow: firstLongGap && dangerStart ? `${formatClock(dangerStart)}-${formatClock(firstLongGap.end)}` : "Not detected",
      fuelNeededBefore: fuelNeededBefore ? formatClock(fuelNeededBefore) : "Not detected",
      reactive,
      endedAt: endedDate ? endedDate.toISOString() : "",
      summary
    };
  }

  function storedEntries() {
    return Object.values(betaState().archive || {}).filter(entry => entry && entry.date);
  }

  function predictedDangerWindowForKey(key = dateKey()) {
    const dayType = dayTypeForKey(key);
    if (!dayType) {
      return { available: false, reason: "Select a day type to build predictions." };
    }

    const similar = storedEntries().filter(entry => {
      return entry.date !== key && entry.dayType === dayType && Number.isFinite(entry.dangerStartMinute);
    });

    if (similar.length < PREDICTION_MIN_SIMILAR_DAYS) {
      return {
        available: false,
        reason: "Not enough history yet. Log a few more similar days to predict your danger window.",
        similarDays: similar.length
      };
    }

    const start = similar.reduce((sum, entry) => sum + entry.dangerStartMinute, 0) / similar.length;
    const end = similar.reduce((sum, entry) => {
      return sum + (Number.isFinite(entry.dangerEndMinute) ? entry.dangerEndMinute : entry.dangerStartMinute + 150);
    }, 0) / similar.length;
    const startRounded = Math.round(start / 15) * 15;
    const endRounded = Math.max(startRounded + 60, Math.round(end / 15) * 15);
    const fuelBefore = Math.max(0, startRounded - PLANNING_BUFFER_MINUTES);

    return {
      available: true,
      similarDays: similar.length,
      startMinute: startRounded,
      endMinute: endRounded,
      fuelBeforeMinute: fuelBefore,
      window: `${clockFromMinutes(startRounded)}-${clockFromMinutes(endRounded)}`,
      fuelBefore: clockFromMinutes(fuelBefore),
      message: `On similar ${dayTypeLabel(dayType).toLowerCase()}s, your fuel rhythm usually drops around this time.`
    };
  }

  function buildArchiveEntry(key, options = {}) {
    const gap = betaState();
    const previous = gap.archive[key] || {};
    const endedAt = Object.prototype.hasOwnProperty.call(options, "endedAt")
      ? options.endedAt
      : previous.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "");
    const analysis = analyseDay(key, { endedAt });
    const prediction = predictedDangerWindowForKey(key);

    return {
      date: key,
      dateLabel: analysis.dateLabel,
      dayType: analysis.dayType,
      dayTypeLabel: analysis.dayTypeLabel,
      endedAt: analysis.endedAt || endedAt || "",
      firstFuelTime: analysis.firstFuelTime,
      lastFuelTime: analysis.lastFuelTime,
      fuelLogCount: analysis.fuelLogCount,
      logs: analysis.logs.map(log => ({
        id: log.id || uid(),
        timestamp: log.date.toISOString(),
        type: logType(log),
        typeLabel: logType(log) === "hydration" ? "Hydration" : "Fuel",
        note: log.note || ""
      })),
      longestGapMinutes: analysis.longestGapMinutes,
      averageGapMinutes: analysis.averageGapMinutes,
      longGapCount: analysis.longGapCount,
      longestGap: durationText(analysis.longestGapMinutes),
      averageGap: durationText(analysis.averageGapMinutes),
      dangerStartMinute: analysis.dangerStartMinute,
      dangerEndMinute: analysis.dangerEndMinute,
      actualDangerWindow: analysis.actualDangerWindow,
      predictedDangerWindow: prediction.available ? prediction.window : "Not enough history yet",
      fuelNeededBefore: prediction.available ? prediction.fuelBefore : analysis.fuelNeededBefore,
      reactive: analysis.reactive,
      analysis: prediction.available
        ? [...analysis.summary, `On similar days, get fuel available before ${prediction.fuelBefore}.`]
        : analysis.summary
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
    const dangerCounts = {};
    const typeStats = {};

    entries.forEach(entry => {
      if (Number.isFinite(entry.dangerStartMinute)) {
        const bucket = timeWindowBucket(entry.dangerStartMinute);
        dangerCounts[bucket] = (dangerCounts[bucket] || 0) + 1;
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

    const topWindow = Object.entries(dangerCounts).sort((a, b) => b[1] - a[1])[0] || null;
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
    const prediction = predictedDangerWindowForKey(dateKey(now));
    const statusText = status === "green"
      ? "Fuel gap is currently under control."
      : status === "amber"
        ? "Fuel gap is building. Plan fuel soon."
        : "Fuel gap is red. Get fuel available now.";

    return {
      lastFuelled: last ? formatClock(last.date) : "No fuel logged",
      timeSinceFuel: Number.isFinite(minutes) ? duration(minutes) : "No fuel logged",
      minutesSinceFuel: minutes,
      status,
      nextAction: prediction.available
        ? `Predicted danger window: ${prediction.window}. Get fuel available before ${prediction.fuelBefore}.`
        : statusText,
      statusContext: statusText,
      prediction
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

  recordFuelled = function recordFuelledBeta() {
    if (fuelDayEndSnapshot().dayEnded) return;
    if (cooldownRemainingSeconds() > 0) {
      renderFuelGap();
      return;
    }

    const key = dateKey();
    betaState().logs.push({
      id: uid(),
      timestamp: new Date().toISOString(),
      label: "Fuelled",
      type: "fuel",
      dayType: dayTypeForKey(key)
    });
    setCooldown();
    storeArchive(key);
    state.completed.liveFuelStatus = true;
    if (typeof recordFuelMomentum === "function") {
      recordFuelMomentum("fuelLogged", "Fuel logged. Gap tracker updated.", "Fuel logged. Your fuel rhythm is up to date. +1 Fuel Momentum", { dedupeDaily: false });
    } else if (typeof addActivityEntry === "function") {
      addActivityEntry("fuelLogged", "Fuel logged. Gap tracker updated.", { dedupeDaily: false });
    }
    save();
    renderAll();
  };

  function undoLatestFuelLog() {
    const key = dateKey();
    let latestIndex = -1;
    let latestDate = null;
    betaState().logs.forEach((log, index) => {
      const date = logDate(log);
      if (!date || dateKey(date) !== key || !isFuelLog(log)) return;
      if (!latestDate || date > latestDate) {
        latestDate = date;
        latestIndex = index;
      }
    });
    if (latestIndex < 0) return;
    betaState().logs.splice(latestIndex, 1);
    clearCooldown();
    storeArchive(key);
    addActivityEntry("fuelLogUndo", "Latest fuel log undone.", { dedupeDaily: false });
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

  function renderPredictionPanel(snapshot) {
    const target = document.getElementById("fuelPredictionPanel");
    if (!target) return;
    const prediction = snapshot.prediction;
    target.innerHTML = prediction.available
      ? `<strong>Predicted danger window: ${safeText(prediction.window)}</strong><span>${safeText(prediction.message)}</span><small>Get fuel available before ${safeText(prediction.fuelBefore)}.</small>`
      : `<strong>Predicted danger window</strong><span>${safeText(prediction.reason)}</span>`;
  }

  function renderGapInsights(snapshot) {
    const target = document.getElementById("fuelGapInsights");
    if (!target) return;
    const analysis = analyseDay(dateKey());
    const weekly = weeklySummary();
    const prediction = snapshot.prediction;
    target.innerHTML = `
      <div class="fuel-gap-insight"><span>Time since last fuel</span><strong>${safeText(snapshot.timeSinceFuel)}</strong><small>Core beta signal.</small></div>
      <div class="fuel-gap-insight"><span>Current gap risk</span><strong>${safeText(snapshot.status.toUpperCase())}</strong><small>Green under ${thresholds().greenMinutes}m. Red at ${thresholds().redMinutes}m.</small></div>
      <div class="fuel-gap-insight"><span>Longest gap today</span><strong>${safeText(durationText(analysis.longestGapMinutes))}</strong><small>${analysis.fuelLogCount ? "Today’s biggest fuel gap." : "Tap I fuelled to start."}</small></div>
      <div class="fuel-gap-insight"><span>Long gaps today</span><strong>${analysis.longGapCount}</strong><small>Gaps at or over red threshold.</small></div>
      <div class="fuel-gap-insight"><span>Predicted danger window</span><strong>${safeText(prediction.available ? prediction.window : "Not enough history")}</strong><small>${safeText(prediction.available ? `Fuel before ${prediction.fuelBefore}.` : "Needs similar logged days.")}</small></div>
      <div class="fuel-gap-insight"><span>Weekly pattern</span><strong>${safeText(weekly.topWindow ? weekly.topWindow[0] : "Building")}</strong><small>${safeText(weekly.riskType ? `Long gaps most common on ${weekly.riskType.label.toLowerCase()}.` : "More day types needed.")}</small></div>
    `;
  }

  function renderDayTypeControls() {
    ["fuelDayType"].forEach(id => {
      const select = document.getElementById(id);
      if (select && select.value !== dayTypeForKey(dateKey())) select.value = dayTypeForKey(dateKey());
    });
    const saved = document.getElementById("fuelDayTypeSaved");
    if (saved) {
      const value = dayTypeForKey(dateKey());
      saved.textContent = value ? `Saved: ${dayTypeLabel(value)}. You can edit it.` : "Set once per day to improve predictions.";
    }
  }

  function renderSettings() {
    const green = document.getElementById("greenThresholdMinutes");
    const red = document.getElementById("redThresholdMinutes");
    if (green) green.value = thresholds().greenMinutes;
    if (red) red.value = thresholds().redMinutes;
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
    const logs = todayFuelLogs();
    target.innerHTML = logs.length
      ? logs.map(log => `<div class="row"><div><div class="item-name">${formatClock(log.date)} - Fuelled</div></div></div>`).join("")
      : `<p class="muted fuel-daily-empty">No fuel logged today.</p>`;
  }

  function renderArchiveDetail(entry) {
    if (!entry) return `<p class="muted">No daily summaries yet.</p>`;
    const logsHtml = entry.logs.length
      ? entry.logs.map(log => `<div class="row fuel-archive-log-row"><div><div class="item-name">${formatClock(logDate(log.timestamp))} - ${safeText(log.typeLabel || "Fuel")}</div>${log.note ? `<div class="row-note">${safeText(log.note)}</div>` : ""}</div></div>`).join("")
      : `<p class="muted">No fuel logs stored for this day.</p>`;

    return `
      <div class="fuel-archive-head"><div><p class="label">${safeText(entry.dateLabel)}</p><h3>${safeText(dayTypeLabel(entry.dayType))}</h3></div><span class="status-pill ${entry.longGapCount ? "amber" : "green"}">${entry.longGapCount ? "GAPS FOUND" : "STABLE"}</span></div>
      <div class="fuel-archive-stats">
        <div><span>First fuel</span><strong>${safeText(entry.firstFuelTime)}</strong></div>
        <div><span>Last fuel</span><strong>${safeText(entry.lastFuelTime)}</strong></div>
        <div><span>Fuel logs</span><strong>${entry.fuelLogCount}</strong></div>
        <div><span>Longest gap</span><strong>${safeText(entry.longestGap)}</strong></div>
        <div><span>Average gap</span><strong>${safeText(entry.averageGap)}</strong></div>
        <div><span>Long gaps</span><strong>${entry.longGapCount}</strong></div>
        <div><span>Predicted danger</span><strong>${safeText(entry.predictedDangerWindow)}</strong></div>
        <div><span>Actual danger</span><strong>${safeText(entry.actualDangerWindow)}</strong></div>
      </div>
      <div class="fuel-archive-section"><h4>Fuel log times</h4><div class="list">${logsHtml}</div></div>
      <div class="fuel-archive-section"><h4>End-of-day analysis</h4>${renderAnalysisList(entry.analysis)}</div>
    `;
  }

  function renderHistory() {
    const summary = document.getElementById("fuelHistorySummary");
    const weekly = weeklySummary();
    if (summary) {
      summary.innerHTML = `
        <div class="fuel-gap-insight"><span>Days stored</span><strong>${weekly.entries.length}</strong><small>Local daily summaries.</small></div>
        <div class="fuel-gap-insight"><span>Fuel logs this week</span><strong>${weekly.totalLogs}</strong><small>One-tap fuel records.</small></div>
        <div class="fuel-gap-insight"><span>Longest weekly gap</span><strong>${safeText(durationText(weekly.longestGap))}</strong><small>Largest stored gap in the last 7 days.</small></div>
        <div class="fuel-gap-insight"><span>Repeated danger window</span><strong>${safeText(weekly.topWindow ? weekly.topWindow[0] : "Building")}</strong><small>${safeText(weekly.topWindow ? "Common red-gap window." : "Needs more daily summaries.")}</small></div>
        <div class="fuel-gap-insight"><span>Day type pattern</span><strong>${safeText(weekly.riskType ? weekly.riskType.label : "Building")}</strong><small>${safeText(weekly.riskType ? "Longest gaps cluster here." : "Tag day type to compare patterns.")}</small></div>
        <div class="fuel-gap-insight"><span>Average gap pattern</span><strong>${safeText(weekly.averageType ? weekly.averageType.label : "Building")}</strong><small>${safeText(weekly.averageType ? "Highest average gaps so far." : "Needs more history.")}</small></div>
      `;
    }

    const entries = archiveEntries();
    const select = document.getElementById("fuelHistoryArchiveDate");
    const count = document.getElementById("fuelHistoryCount");
    const detail = document.getElementById("fuelHistoryArchiveDetail");
    if (!select || !detail) return;
    if (!selectedHistoryKey || !entries.some(entry => entry.date === selectedHistoryKey)) selectedHistoryKey = entries[0]?.date || dateKey();
    select.innerHTML = entries.map(entry => `<option value="${safeText(entry.date)}">${safeText(entry.dateLabel)}${entry.dayType ? ` - ${safeText(entry.dayTypeLabel)}` : ""}</option>`).join("");
    select.value = selectedHistoryKey;
    if (count) count.textContent = `${entries.length} day${entries.length === 1 ? "" : "s"} stored`;
    detail.innerHTML = renderArchiveDetail(entries.find(entry => entry.date === selectedHistoryKey));
  }

  function buildCurve(now = new Date()) {
    const logs = todayLogs(now).filter(log => log.date <= now);
    const currentMinute = clamp(minutesIntoDay(now), 0, 1440);
    const points = [{ minute: 0, value: 42 }];
    const markers = [];
    let value = 42;
    let lastMinute = 0;
    logs.forEach(log => {
      const minute = clamp(minutesIntoDay(log.date), 0, currentMinute);
      value = clamp(value - Math.max(0, minute - lastMinute) * 0.11, 8, 95);
      points.push({ minute, value });
      if (isFuelLog(log)) {
        value = clamp(Math.max(value + 42, 86), 8, 95);
        const marker = { minute: Math.min(1440, minute + .45), value, log };
        markers.push(marker);
        points.push(marker);
      }
      lastMinute = minute;
    });
    value = clamp(value - Math.max(0, currentMinute - lastMinute) * 0.11, 8, 95);
    points.push({ minute: currentMinute, value, current: true });
    return { points, markers, currentMinute };
  }

  function tracePath(ctx, coordinates) {
    if (!coordinates.length) return;
    ctx.moveTo(coordinates[0].x, coordinates[0].y);
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      const midX = (previous.x + current.x) / 2;
      const midY = (previous.y + current.y) / 2;
      ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
    }
    const last = coordinates[coordinates.length - 1];
    ctx.lineTo(last.x, last.y);
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
    const yForValue = value => padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight;
    const prediction = predictedDangerWindowForKey(dateKey(now));

    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, bottom);
    ctx.lineTo(cssWidth - padding.right, bottom);
    ctx.stroke();

    if (prediction.available) {
      const x = xForMinute(prediction.startMinute);
      const width = Math.max(8, xForMinute(prediction.endMinute) - x);
      ctx.fillStyle = "rgba(255,77,109,.11)";
      ctx.fillRect(x, padding.top, width, plotHeight);
      ctx.fillStyle = "rgba(255,180,190,.78)";
      ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText("Predicted danger", Math.min(x + 6, cssWidth - 116), padding.top + 13);
    }

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(245,255,248,.55)";
    [360, 720, 1080].forEach((minute, index) => {
      ctx.fillText(["6am", "12pm", "6pm"][index], xForMinute(minute) - 12, cssHeight - 11);
    });

    const { points, markers, currentMinute } = buildCurve(now);
    const coordinates = points.map(point => ({ ...point, x: xForMinute(point.minute), y: yForValue(point.value) }));
    if (coordinates.length > 1) {
      const fillGradient = ctx.createLinearGradient(0, padding.top, 0, bottom);
      fillGradient.addColorStop(0, "rgba(45,255,136,.22)");
      fillGradient.addColorStop(1, "rgba(32,214,255,.01)");
      ctx.fillStyle = fillGradient;
      ctx.beginPath();
      tracePath(ctx, coordinates);
      ctx.lineTo(coordinates[coordinates.length - 1].x, bottom);
      ctx.lineTo(coordinates[0].x, bottom);
      ctx.closePath();
      ctx.fill();

      const strokeGradient = ctx.createLinearGradient(padding.left, 0, cssWidth - padding.right, 0);
      strokeGradient.addColorStop(0, "#20d6ff");
      strokeGradient.addColorStop(.55, "#2dff88");
      strokeGradient.addColorStop(1, "#ffb020");
      ctx.strokeStyle = strokeGradient;
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      tracePath(ctx, coordinates);
      ctx.stroke();
    }

    markers.forEach(marker => {
      ctx.fillStyle = "#2dff88";
      ctx.strokeStyle = "rgba(3,10,8,.86)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(xForMinute(marker.minute), yForValue(marker.value), 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    const currentX = xForMinute(currentMinute);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,255,248,.62)";
    ctx.fillText("Now", Math.min(currentX + 5, cssWidth - 42), padding.top + 12);
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
      button.textContent = "I fuelled";
      button.disabled = summary.dayEnded || cooldown > 0;
    }

    const undo = document.getElementById("undoLatestFoodLog");
    if (undo) undo.disabled = !todayFuelLogs().length;

    const cooldownEl = document.getElementById("foodLogCooldownMessage");
    if (cooldownEl) cooldownEl.textContent = cooldown > 0 ? `Logged. You can fuel again in ${cooldown}s.` : "";

    const endButton = document.getElementById("endFuelDayButton");
    if (endButton) endButton.disabled = summary.dayEnded;
    const continueButton = document.getElementById("continueFuelDayButton");
    if (continueButton) continueButton.disabled = !summary.dayEnded;

    const daySummary = document.getElementById("fuelDaySummary");
    if (daySummary) daySummary.innerHTML = `<p class="label">Today</p><p>${safeText(summary.message)}</p>`;

    renderPredictionPanel(snapshot);
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
      logs: ["Insights / History", "Review daily summaries and repeated danger windows."],
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

  document.getElementById("undoLatestFoodLog")?.addEventListener("click", undoLatestFuelLog);
  document.getElementById("fuelDayType")?.addEventListener("change", event => {
    setDayType(dateKey(), event.target.value);
    save();
    renderAll();
  });
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", event => {
    selectedHistoryKey = event.target.value;
    renderHistory();
  });
  document.getElementById("saveFuelThresholds")?.addEventListener("click", saveThresholdSettings);
  document.getElementById("clearFuelBetaData")?.addEventListener("click", clearBetaData);

  window.addEventListener("resize", () => drawBetaGraph());

  renderAll();
  renderFuelGap();
  setInterval(renderFuelGap, 1000);
})();
