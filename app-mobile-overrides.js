// Mobile-first Fuel Guard behavior overrides.
// This keeps the existing one-page app intact and layers the daily PWA flow on top.
(() => {
  const FOOD_LOG_COOLDOWN_MS = 60000;
  const RISK_GAP_THRESHOLD_MINUTES = 300;
  const PLANNING_BUFFER_MINUTES = 45;
  const FOOD_TYPE_LABELS = {
    meal: "Meal",
    snack: "Snack",
    takeout: "Takeout",
    hydration: "Hydration"
  };
  const FOOD_TYPE_IMPACT = {
    meal: 88,
    snack: 66,
    takeout: 76,
    hydration: 46
  };
  const FOOD_TYPE_BOOST = {
    meal: 42,
    snack: 26,
    takeout: 34,
    hydration: 10
  };
  const DAY_TYPE_OPTIONS = [
    { value: "training-work", label: "Training + work day" },
    { value: "double-training", label: "Double training day" },
    { value: "shift", label: "Shift day" },
    { value: "rest", label: "Rest day" },
    { value: "other", label: "Other" },
    { value: "standalone-training", label: "Standalone training" }
  ];
  const DAY_TYPE_LABELS = DAY_TYPE_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});

  let selectedArchiveKey = "";

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

  function normaliseFoodType(value) {
    const type = String(value || "meal").toLowerCase();
    return FOOD_TYPE_LABELS[type] ? type : "meal";
  }

  function selectedFoodLogType() {
    return normaliseFoodType(document.getElementById("foodLogType")?.value || "meal");
  }

  function isFoodLog(log) {
    return normaliseFoodType(log?.type) !== "hydration";
  }

  function fuelArchiveState() {
    const gap = fuelGapState();
    if (!gap.dayTypes || Array.isArray(gap.dayTypes)) gap.dayTypes = {};
    if (!gap.archive || Array.isArray(gap.archive)) gap.archive = {};
    return gap;
  }

  function dayTypeLabel(value) {
    if (!value) return "Not set";
    return DAY_TYPE_LABELS[value] || value;
  }

  function dayTypeForKey(key) {
    const gap = fuelArchiveState();
    return gap.dayTypes[key] || gap.archive[key]?.dayType || "";
  }

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  }

  function dateFromKey(key) {
    const date = new Date(`${key}T12:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function formatArchiveDateKey(key) {
    return dateFromKey(key).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function logsWithDates() {
    return fuelGapState().logs
      .map((log, index) => ({ ...log, index, date: fuelLogDate(log) }))
      .filter(log => log.date)
      .sort((a, b) => a.date - b.date);
  }

  function startOfLocalDay(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function endOfLocalDay(date = new Date()) {
    const end = startOfLocalDay(date);
    end.setDate(end.getDate() + 1);
    return end;
  }

  function sameLocalDay(a, b) {
    return todayKey(a) === todayKey(b);
  }

  function todaysAllLogs(now = new Date()) {
    const start = startOfLocalDay(now);
    const end = endOfLocalDay(now);
    return logsWithDates().filter(log => log.date >= start && log.date < end);
  }

  function todaysFoodLogsOnly(now = new Date()) {
    return todaysAllLogs(now).filter(isFoodLog);
  }

  function logsForDayKey(key) {
    return logsWithDates().filter(log => todayKey(log.date) === key);
  }

  function lastFoodLog() {
    return logsWithDates().filter(isFoodLog).sort((a, b) => b.date - a.date)[0] || null;
  }

  function minutesSinceLastFood(now = new Date()) {
    const last = lastFoodLog();
    if (!last) return Infinity;
    return Math.max(0, (now - last.date) / 60000);
  }

  function cooldownRemainingSeconds(now = Date.now()) {
    const cooldownUntil = Number(fuelGapState().cooldownUntil || 0);
    if (!Number.isFinite(cooldownUntil) || cooldownUntil <= now) return 0;
    return Math.ceil((cooldownUntil - now) / 1000);
  }

  function setFoodLogCooldown() {
    fuelGapState().cooldownUntil = Date.now() + FOOD_LOG_COOLDOWN_MS;
  }

  function clearFoodLogCooldown() {
    fuelGapState().cooldownUntil = 0;
  }

  function setDayTypeForKey(key, value) {
    const gap = fuelArchiveState();
    if (value) gap.dayTypes[key] = value;
    else delete gap.dayTypes[key];

    gap.logs.forEach(log => {
      const date = fuelLogDate(log);
      if (date && todayKey(date) === key) log.dayType = value || "";
    });

    storeArchiveForKey(key, { endedAt: gap.archive[key]?.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "") });
  }

  function gapStatusCopy(status, hasLog) {
    const copy = {
      green: {
        nextAction: "Next action: keep a quick food option available before the gap builds.",
        context: "Green means recently eaten / no immediate gap concern."
      },
      amber: {
        nextAction: "Next action: plan food soon. The food gap is building.",
        context: "Amber means the gap is building and food should be planned soon."
      },
      red: {
        nextAction: "Action needed soon. This is a long food gap; eat a quick available option within 30 minutes.",
        context: "Red means long gap or missed fuel window; action needed soon."
      }
    };

    if (!hasLog) {
      copy.red = {
        nextAction: "No food logged yet. Log food now or eat a quick available option.",
        context: "Gap risk stays red until Fuel Guard knows when you last ate."
      };
    }

    return copy[status];
  }

  function gapDurationText(minutes) {
    return Number.isFinite(minutes) ? duration(minutes) : "No food logged";
  }

  fuelGapSnapshot = function fuelGapSnapshotOverride(now = new Date()) {
    const last = lastFoodLog();
    const elapsedMinutes = minutesSinceLastFood(now);
    const status = fuelGapStatus(elapsedMinutes);
    const copy = gapStatusCopy(status, Boolean(last));

    return {
      lastFuelled: last ? formatClock(last.date) : "No food logged",
      timeSinceFuel: gapDurationText(elapsedMinutes),
      status,
      nextAction: copy.nextAction,
      statusContext: copy.context
    };
  };

  fuelDaySummary = function fuelDaySummaryOverride(now = new Date()) {
    const key = todayKey(now);
    const logs = todaysAllLogs(now);
    const foodLogs = logs.filter(isFoodLog);
    const hydrationLogs = logs.filter(log => !isFoodLog(log));
    const last = foodLogs[foodLogs.length - 1] || null;
    const end = fuelDayEndSnapshot(now);
    const dayType = dayTypeForKey(key);
    const foodLogText = `${foodLogs.length} food log${foodLogs.length === 1 ? "" : "s"}`;
    const hydrationText = hydrationLogs.length ? `, ${hydrationLogs.length} hydration log${hydrationLogs.length === 1 ? "" : "s"}` : "";
    const lastAte = last ? formatClock(last.date) : "No food logged";
    const dayTypeText = dayType ? ` Day type: ${dayTypeLabel(dayType)}.` : "";
    const endText = end.dayEnded
      ? `Day ended at ${end.endTime}. Fasting started.`
      : "Today's tracking is still open.";

    return {
      date: fuelTrackingDateLabel(now),
      fuelLogs: logs.length,
      foodLogs: foodLogs.length,
      hydrationLogs: hydrationLogs.length,
      lastFuelled: lastAte,
      dayEnded: end.dayEnded,
      endTime: end.endTime,
      dayType,
      message: `Today's food summary: ${foodLogText}${hydrationText}. Last ate: ${lastAte}.${dayTypeText} ${endText}`
    };
  };

  function latestTodayLogIndex(now = new Date()) {
    let latestIndex = -1;
    let latestDate = null;

    fuelGapState().logs.forEach((log, index) => {
      const date = fuelLogDate(log);
      if (!date || !sameLocalDay(date, now)) return;
      if (!latestDate || date > latestDate) {
        latestDate = date;
        latestIndex = index;
      }
    });

    return latestIndex;
  }

  function gapsFromFoodLogs(logs, referenceTime = new Date(), includeTrailing = false, trailingIsOngoing = false) {
    const sorted = [...logs].filter(isFoodLog).sort((a, b) => a.date - b.date);
    const gaps = [];

    for (let index = 1; index < sorted.length; index += 1) {
      const minutes = (sorted[index].date - sorted[index - 1].date) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        gaps.push({
          minutes,
          start: sorted[index - 1].date,
          end: sorted[index].date,
          ongoing: false
        });
      }
    }

    if (includeTrailing && sorted.length) {
      const last = sorted[sorted.length - 1];
      const minutes = (referenceTime - last.date) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        gaps.push({
          minutes,
          start: last.date,
          end: referenceTime,
          ongoing: trailingIsOngoing
        });
      }
    }

    return gaps;
  }

  function insightValue(minutes) {
    return minutes > 0 ? duration(minutes) : "Not enough data";
  }

  function minutesIntoDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  function timeWindowBucketForMinutes(minutes) {
    if (!Number.isFinite(minutes)) return "Needs more data";
    if (minutes < 660) return "morning";
    if (minutes < 840) return "11:00-14:00";
    if (minutes < 960) return "14:00-16:00";
    if (minutes < 1080) return "16:00-18:00";
    if (minutes < 1320) return "evening";
    return "late/overnight";
  }

  function analyseFuelDay(key, { now = new Date(), endedAt = "" } = {}) {
    const logs = logsForDayKey(key);
    const foodLogs = logs.filter(isFoodLog);
    const hydrationLogs = logs.filter(log => !isFoodLog(log));
    const endedDate = endedAt ? fuelLogDate(endedAt) : null;
    const isToday = key === todayKey(now);
    const fallbackReference = foodLogs[foodLogs.length - 1]?.date || logs[logs.length - 1]?.date || dateFromKey(key);
    const referenceTime = endedDate || (isToday ? now : fallbackReference);
    const includeTrailing = Boolean(endedDate) || isToday;
    const trailingIsOngoing = !endedDate && isToday;
    const gaps = gapsFromFoodLogs(foodLogs, referenceTime, includeTrailing, trailingIsOngoing);
    const completedGaps = gaps.filter(gap => !gap.ongoing);
    const riskyGaps = gaps.filter(gap => gap.minutes >= RISK_GAP_THRESHOLD_MINUTES);
    const completedRiskyGaps = completedGaps.filter(gap => gap.minutes >= RISK_GAP_THRESHOLD_MINUTES);
    const longestGap = gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : 0;
    const averageGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap.minutes, 0) / gaps.length : 0;
    const firstRisk = riskyGaps[0] || null;
    const dangerStart = firstRisk ? addMinutes(firstRisk.start, RISK_GAP_THRESHOLD_MINUTES) : null;
    const foodNeededBefore = dangerStart ? addMinutes(dangerStart, -PLANNING_BUFFER_MINUTES) : null;
    const dayType = dayTypeForKey(key);
    const reactive = completedRiskyGaps.length > 0 && completedRiskyGaps.length >= Math.ceil(Math.max(1, completedGaps.length) / 2);
    const contextLabel = dayTypeLabel(dayType);
    const dayWord = isToday ? "today" : "this day";
    const summary = [];

    if (!foodLogs.length) {
      summary.push("No food logs recorded for this day.");
      summary.push("More weekly data will make this pattern clearer.");
    } else if (!gaps.length) {
      summary.push(`Only one food log is available for ${dayWord}.`);
      summary.push("More food logs are needed before Fuel Guard can identify a danger window.");
    } else {
      summary.push(`Your longest fuel gap ${dayWord} was ${duration(longestGap)}.`);
      if (dangerStart) {
        summary.push(`Your danger window started around ${formatClock(dangerStart)}.`);
        summary.push(`You needed food available before ${formatClock(foodNeededBefore)}.`);
      } else {
        summary.push("No 5h danger window was detected from the available food logs.");
      }
      if (reactive) {
        summary.push("This looks like a reactive fuelling day rather than a planned fuelling day.");
      }
      if (["shift", "training-work", "double-training"].includes(dayType) && riskyGaps.length) {
        summary.push(`${contextLabel} context: long gaps on this day type need food available before the danger window.`);
      }
      if (foodLogs.length < 3 || !dangerStart) {
        summary.push("More weekly data will make this pattern clearer.");
      }
    }

    return {
      date: key,
      dateLabel: formatArchiveDateKey(key),
      dayType,
      dayTypeLabel: contextLabel,
      logs,
      foodLogs,
      hydrationLogs,
      gaps,
      longestGap,
      averageGap,
      riskyCount: riskyGaps.length,
      completedRiskyCount: completedRiskyGaps.length,
      dangerStart,
      dangerStartMinute: dangerStart ? minutesIntoDay(dangerStart) : null,
      dangerWindow: firstRisk && dangerStart ? `${formatClock(dangerStart)}-${formatClock(firstRisk.end)}` : "Not detected",
      foodNeededBefore,
      reactive,
      endedAt: endedDate ? endedDate.toISOString() : "",
      summary
    };
  }

  function buildDayArchiveEntry(key, options = {}) {
    const analysis = analyseFuelDay(key, options);
    return {
      date: key,
      dateLabel: analysis.dateLabel,
      dayType: analysis.dayType,
      dayTypeLabel: analysis.dayTypeLabel,
      endedAt: analysis.endedAt || options.endedAt || "",
      logs: analysis.logs.map(log => ({
        id: log.id || uid(),
        timestamp: log.date.toISOString(),
        type: normaliseFoodType(log.type),
        typeLabel: FOOD_TYPE_LABELS[normaliseFoodType(log.type)],
        note: log.note || ""
      })),
      stats: {
        longestGapMinutes: analysis.longestGap,
        longestGap: insightValue(analysis.longestGap),
        averageGapMinutes: analysis.averageGap,
        averageGap: insightValue(analysis.averageGap),
        riskyCount: analysis.riskyCount
      },
      dangerStartMinute: analysis.dangerStartMinute,
      dangerWindow: analysis.dangerWindow,
      reactive: analysis.reactive,
      analysis: analysis.summary
    };
  }

  function storeArchiveForKey(key, options = {}) {
    const gap = fuelArchiveState();
    const previous = gap.archive[key] || {};
    const endedAt = Object.prototype.hasOwnProperty.call(options, "endedAt")
      ? options.endedAt
      : previous.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "");
    const entry = buildDayArchiveEntry(key, { endedAt });
    gap.archive[key] = entry;
    return entry;
  }

  function archiveEntries() {
    const gap = fuelArchiveState();
    const keys = new Set([todayKey()]);
    Object.keys(gap.archive).forEach(key => keys.add(key));
    Object.keys(gap.dayTypes).forEach(key => keys.add(key));
    logsWithDates().forEach(log => keys.add(todayKey(log.date)));

    return [...keys]
      .sort()
      .reverse()
      .map(key => buildDayArchiveEntry(key, { endedAt: gap.archive[key]?.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "") }));
  }

  function dailyGapSummary(now = new Date()) {
    const logs = todaysFoodLogsOnly(now);
    const gaps = gapsFromFoodLogs(logs, now, true, true);
    const total = gaps.reduce((sum, gap) => sum + gap.minutes, 0);

    return {
      logs,
      gaps,
      longest: gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : 0,
      average: gaps.length ? total / gaps.length : 0,
      riskyCount: gaps.filter(gap => gap.minutes >= RISK_GAP_THRESHOLD_MINUTES).length
    };
  }

  function weeklyGapSummary(now = new Date()) {
    const cutoff = startOfLocalDay(now);
    cutoff.setDate(cutoff.getDate() - 6);
    const entries = archiveEntries().filter(entry => {
      const date = dateFromKey(entry.date);
      return date >= cutoff && date <= now && (entry.logs.length || entry.dayType);
    });
    const allLongest = entries.map(entry => entry.stats.longestGapMinutes).filter(value => value > 0);
    const riskyCount = entries.reduce((sum, entry) => sum + Number(entry.stats.riskyCount || 0), 0);
    const dangerCounts = {};
    const typeStats = {};

    entries.forEach(entry => {
      if (Number.isFinite(entry.dangerStartMinute)) {
        const bucket = timeWindowBucketForMinutes(entry.dangerStartMinute);
        dangerCounts[bucket] = (dangerCounts[bucket] || 0) + 1;
      }

      const type = entry.dayType || "not-set";
      const label = entry.dayType ? entry.dayTypeLabel : "Day type not set";
      if (!typeStats[type]) {
        typeStats[type] = { label, count: 0, riskyDays: 0, reactiveDays: 0, longestTotal: 0, averageTotal: 0, longestMax: 0 };
      }
      const stat = typeStats[type];
      stat.count += 1;
      stat.riskyDays += entry.stats.riskyCount > 0 ? 1 : 0;
      stat.reactiveDays += entry.reactive ? 1 : 0;
      stat.longestTotal += Number(entry.stats.longestGapMinutes || 0);
      stat.averageTotal += Number(entry.stats.averageGapMinutes || 0);
      stat.longestMax = Math.max(stat.longestMax, Number(entry.stats.longestGapMinutes || 0));
    });

    const topDanger = Object.entries(dangerCounts).sort((a, b) => b[1] - a[1])[0] || null;
    const typeList = Object.values(typeStats).filter(item => item.label !== "Day type not set");
    const riskType = [...typeList].sort((a, b) => b.riskyDays - a.riskyDays || b.longestMax - a.longestMax)[0] || null;
    const averageType = [...typeList].sort((a, b) => (b.averageTotal / Math.max(1, b.count)) - (a.averageTotal / Math.max(1, a.count)))[0] || null;
    const reactiveType = [...typeList].sort((a, b) => b.reactiveDays - a.reactiveDays || b.riskyDays - a.riskyDays)[0] || null;
    const repeatedDays = entries
      .filter(entry => Number(entry.stats.riskyCount || 0) >= 2)
      .map(entry => dateFromKey(entry.date).toLocaleDateString(undefined, { weekday: "short" }));

    return {
      entries,
      longest: allLongest.length ? Math.max(...allLongest) : 0,
      riskyCount,
      topWindow: topDanger,
      repeatedDays,
      typePatternText: riskType && riskType.riskyDays
        ? `Long gaps are showing most on ${riskType.label.toLowerCase()}.`
        : "Set day type for a few days to compare patterns.",
      dangerPatternText: topDanger && topDanger[1] >= 2
        ? `Danger window often appeared around ${topDanger[0]}.`
        : "More weekly data is needed for a common danger window.",
      reactivePatternText: reactiveType && reactiveType.reactiveDays
        ? `Food was logged late most often on ${reactiveType.label.toLowerCase()}.`
        : "Reactive fuelling pattern not clear yet.",
      longestAverageTypeText: averageType && averageType.averageTotal > 0
        ? `${averageType.label} has the longest average gaps so far.`
        : "Average gaps by day type need more data."
    };
  }

  function renderFuelGapInsights(now = new Date()) {
    const target = document.getElementById("fuelGapInsights");
    if (!target) return;

    const daily = dailyGapSummary(now);
    const weekly = weeklyGapSummary(now);
    const dayType = dayTypeForKey(todayKey(now));
    const riskyWindowText = weekly.topWindow && weekly.riskyCount >= 2
      ? `${weekly.topWindow[0]} (${weekly.topWindow[1]} day${weekly.topWindow[1] === 1 ? "" : "s"})`
      : "Needs more data";
    const repeatedDaysText = weekly.repeatedDays.length ? weekly.repeatedDays.join(", ") : "None yet";

    target.innerHTML = `
      <div class="fuel-gap-insight">
        <span>Longest gap today</span>
        <strong>${safeText(insightValue(daily.longest))}</strong>
        <small>${daily.logs.length ? "Tracks the biggest food gap so far." : "Log food to start today's pattern."}</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Average gap today</span>
        <strong>${safeText(insightValue(daily.average))}</strong>
        <small>Based on food logs, plus the current gap.</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Gaps over 5h today</span>
        <strong>${daily.riskyCount}</strong>
        <small>${daily.riskyCount ? "Long gaps are building risk." : "No 5h gaps logged today."}</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Day type</span>
        <strong>${safeText(dayTypeLabel(dayType))}</strong>
        <small>${safeText(weekly.typePatternText)}</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Weekly danger window</span>
        <strong>${safeText(riskyWindowText)}</strong>
        <small>${safeText(weekly.dangerPatternText)}</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Weekly pattern</span>
        <strong>${safeText(repeatedDaysText)}</strong>
        <small>${safeText(weekly.reactivePatternText)}</small>
      </div>
    `;
  }

  function renderDayTypeControls() {
    const select = document.getElementById("fuelDayType");
    const saved = document.getElementById("fuelDayTypeSaved");
    if (!select) return;

    const key = todayKey();
    const value = dayTypeForKey(key);
    if (select.value !== value) select.value = value;
    if (saved) {
      saved.textContent = value
        ? `Saved for today: ${dayTypeLabel(value)}. You can edit it.`
        : "Set once for today. You can edit it later.";
    }
  }

  function renderAnalysisList(items) {
    return `<ul class="fuel-analysis-list">${items.map(item => `<li>${safeText(item)}</li>`).join("")}</ul>`;
  }

  function renderFuelDayAnalysis() {
    const target = document.getElementById("fuelDayAnalysis");
    if (!target) return;

    const key = todayKey();
    const gap = fuelArchiveState();
    const end = fuelDayEndSnapshot();
    if (!end.dayEnded) {
      target.innerHTML = "";
      return;
    }

    const entry = gap.archive[key] || buildDayArchiveEntry(key, { endedAt: gap.dayEndedAt });
    target.innerHTML = `
      <p class="label">End-of-day analysis</p>
      ${renderAnalysisList(entry.analysis)}
    `;
  }

  function renderArchiveDetail(entry) {
    if (!entry) return `<p class="muted">No archive data available yet.</p>`;
    const foodLogs = entry.logs.filter(log => normaliseFoodType(log.type) !== "hydration");
    const allLogsHtml = entry.logs.length
      ? entry.logs.map(log => `
          <div class="row fuel-archive-log-row">
            <div>
              <div class="item-name">${formatClock(fuelLogDate(log.timestamp))} - ${safeText(log.typeLabel || FOOD_TYPE_LABELS[normaliseFoodType(log.type)])}</div>
              ${log.note ? `<div class="row-note">${safeText(log.note)}</div>` : ""}
            </div>
          </div>
        `).join("")
      : `<p class="muted">No fuel logs stored for this day.</p>`;

    return `
      <div class="fuel-archive-head">
        <div>
          <p class="label">${safeText(entry.dateLabel)}</p>
          <h3>${safeText(dayTypeLabel(entry.dayType))}</h3>
        </div>
        <span class="status-pill ${entry.stats.riskyCount ? "amber" : "green"}">${entry.stats.riskyCount ? "GAPS FOUND" : "STABLE"}</span>
      </div>
      <div class="fuel-archive-stats">
        <div><span>Food logs</span><strong>${foodLogs.length}</strong></div>
        <div><span>Longest gap</span><strong>${safeText(entry.stats.longestGap)}</strong></div>
        <div><span>Average gap</span><strong>${safeText(entry.stats.averageGap)}</strong></div>
        <div><span>Risky gaps</span><strong>${entry.stats.riskyCount}</strong></div>
        <div><span>Danger window</span><strong>${safeText(entry.dangerWindow)}</strong></div>
      </div>
      <div class="fuel-archive-section">
        <h4>Food log pattern</h4>
        <div class="list">${allLogsHtml}</div>
      </div>
      <div class="fuel-archive-section">
        <h4>Analysis summary</h4>
        ${renderAnalysisList(entry.analysis)}
      </div>
    `;
  }

  function renderFuelArchive() {
    const select = document.getElementById("fuelArchiveDate");
    const detail = document.getElementById("fuelArchiveDetail");
    const count = document.getElementById("fuelArchiveCount");
    if (!select || !detail) return;

    const entries = archiveEntries();
    if (!selectedArchiveKey || !entries.some(entry => entry.date === selectedArchiveKey)) {
      selectedArchiveKey = entries[0]?.date || todayKey();
    }

    select.innerHTML = entries.map(entry => `
      <option value="${safeText(entry.date)}">${safeText(entry.dateLabel)}${entry.dayType ? ` - ${safeText(entry.dayTypeLabel)}` : ""}</option>
    `).join("");
    select.value = selectedArchiveKey;
    if (count) count.textContent = `${entries.length} day${entries.length === 1 ? "" : "s"} stored`;

    detail.innerHTML = renderArchiveDetail(entries.find(entry => entry.date === selectedArchiveKey));
  }

  recordFuelled = function recordFuelledOverride(note = "") {
    if (fuelDayEndSnapshot().dayEnded) return;

    const remaining = cooldownRemainingSeconds();
    if (remaining > 0) {
      renderFuelGap();
      return;
    }

    const noteText = String(note || document.getElementById("foodLogNote")?.value || "").trim();
    const type = selectedFoodLogType();
    const typeLabel = FOOD_TYPE_LABELS[type];
    const key = todayKey();
    const dayType = dayTypeForKey(key);

    fuelGapState().logs.push({
      id: uid(),
      timestamp: new Date().toISOString(),
      label: `${typeLabel} logged`,
      note: noteText,
      type,
      dayType
    });
    setFoodLogCooldown();
    storeArchiveForKey(key);

    const noteField = document.getElementById("foodLogNote");
    if (noteField) noteField.value = "";

    state.completed.liveFuelStatus = true;
    recordFuelMomentum(
      "fuelLogged",
      type === "hydration" ? "Hydration logged. System updated." : "Food logged. System updated.",
      type === "hydration"
        ? "Hydration logged. Food gap tracking stays visible. +1 Fuel Momentum"
        : "Food logged. Your system is up to date. +1 Fuel Momentum",
      { dedupeDaily: false }
    );
    save();
    renderAll();
  };

  function undoLatestFoodLog() {
    const index = latestTodayLogIndex();
    if (index < 0) return;

    fuelGapState().logs.splice(index, 1);
    clearFoodLogCooldown();
    storeArchiveForKey(todayKey());
    state.completed.liveFuelStatus = todaysAllLogs().length > 0;
    addActivityEntry("foodLogUndo", "Latest food log undone.", { dedupeDaily: false });
    save();
    renderAll();
  }

  endFuelDayAndStartFasting = function endFuelDayAndStartFastingOverride() {
    const now = new Date();
    const key = todayKey(now);
    const gap = fuelArchiveState();
    gap.dayEndedDate = key;
    gap.dayEndedAt = now.toISOString();
    gap.fastingStartedAt = now.toISOString();
    const entry = storeArchiveForKey(key, { endedAt: now.toISOString() });
    addActivityEntry("fastingStarted", "Day ended. Fasting started. Daily analysis generated.", { dedupeDaily: true });
    if (entry.reactive) addActivityEntry("reactiveFuelDay", "Reactive fuelling pattern detected.", { dedupeDaily: true });
    save();
    renderAll();
  };

  continueFuelDayTracking = function continueFuelDayTrackingOverride() {
    const wasEnded = fuelDayEndSnapshot().dayEnded;
    const key = todayKey();
    const gap = fuelArchiveState();

    state.fuelGap = {
      ...gap,
      dayEndedDate: "",
      dayEndedAt: "",
      fastingStartedAt: ""
    };
    fuelArchiveState().archive[key] = buildDayArchiveEntry(key, { endedAt: "" });

    if (wasEnded) addActivityEntry("fuelTrackingContinued", "Continued today's fuel tracking.", { dedupeDaily: true });
    save();
    renderAll();
  };

  function decayFuelValue(value, minutes) {
    return clamp(value - Math.max(0, minutes) * 0.11, 8, 95);
  }

  function buildFuelCurve(now = new Date()) {
    const currentMinute = clamp(minutesIntoDay(now), 0, 1440);
    const logs = todaysAllLogs(now).filter(log => log.date <= now);
    const markers = [];
    const points = [];
    let value = 42;
    let lastMinute = 0;

    points.push({ minute: 0, value });

    logs.forEach(log => {
      const minute = clamp(minutesIntoDay(log.date), 0, currentMinute);
      value = decayFuelValue(value, minute - lastMinute);
      points.push({ minute, value });

      const type = normaliseFoodType(log.type);
      const impact = FOOD_TYPE_IMPACT[type];
      const boost = FOOD_TYPE_BOOST[type];
      value = clamp(Math.max(value + boost, impact), 8, 95);
      const spikeMinute = Math.min(1440, minute + 0.45);
      const marker = { minute: spikeMinute, value, type, log };
      markers.push(marker);
      points.push(marker);
      lastMinute = minute;
    });

    value = decayFuelValue(value, currentMinute - lastMinute);
    points.push({ minute: currentMinute, value, current: true });

    return { points, markers, currentMinute };
  }

  function pointColor(type) {
    return ({
      meal: "#2dff88",
      snack: "#20d6ff",
      takeout: "#ffb020",
      hydration: "#9fb7ff"
    })[normaliseFoodType(type)];
  }

  function traceSmoothPath(ctx, coordinates) {
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

  function drawFuelRhythmGraph(now = new Date()) {
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
    const { points, markers, currentMinute } = buildFuelCurve(now);

    function xForMinute(minute) {
      return padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    }

    function yForValue(value) {
      return padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight;
    }

    const coordinates = points.map(point => ({
      ...point,
      x: xForMinute(point.minute),
      y: yForValue(point.value)
    }));

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.beginPath();
    ctx.moveTo(padding.left, bottom);
    ctx.lineTo(cssWidth - padding.right, bottom);
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(245,255,248,.55)";
    [360, 720, 1080].forEach((minute, index) => {
      const label = ["6am", "12pm", "6pm"][index];
      const x = xForMinute(minute);
      ctx.fillText(label, x - 12, cssHeight - 11);
    });

    const currentX = xForMinute(currentMinute);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,255,248,.62)";
    ctx.fillText("Now", Math.min(currentX + 5, cssWidth - 42), padding.top + 12);

    if (coordinates.length > 1) {
      const fillGradient = ctx.createLinearGradient(0, padding.top, 0, bottom);
      fillGradient.addColorStop(0, "rgba(45,255,136,.22)");
      fillGradient.addColorStop(1, "rgba(32,214,255,.01)");
      ctx.fillStyle = fillGradient;
      ctx.beginPath();
      traceSmoothPath(ctx, coordinates);
      ctx.lineTo(coordinates[coordinates.length - 1].x, bottom);
      ctx.lineTo(coordinates[0].x, bottom);
      ctx.closePath();
      ctx.fill();

      const strokeGradient = ctx.createLinearGradient(padding.left, 0, cssWidth - padding.right, 0);
      strokeGradient.addColorStop(0, "#20d6ff");
      strokeGradient.addColorStop(.52, "#2dff88");
      strokeGradient.addColorStop(1, "#ffb020");
      ctx.strokeStyle = strokeGradient;
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      traceSmoothPath(ctx, coordinates);
      ctx.stroke();
    }

    markers.forEach(marker => {
      const x = xForMinute(marker.minute);
      const y = yForValue(marker.value);
      const color = pointColor(marker.type);
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(3,10,8,.86)";
      ctx.lineWidth = 2;

      if (marker.type === "takeout") {
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-5, -5, 10, 10);
        ctx.strokeRect(-5, -5, 10, 10);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, marker.type === "hydration" ? 4 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  renderFuelGap = function renderFuelGapOverride() {
    const snapshot = fuelGapSnapshot();
    const daySummary = fuelDaySummary();
    const cooldownSeconds = cooldownRemainingSeconds();

    const fuelLastFuelled = document.getElementById("fuelLastFuelled");
    if (fuelLastFuelled) fuelLastFuelled.textContent = snapshot.lastFuelled;

    const fuelTimeSince = document.getElementById("fuelTimeSince");
    if (fuelTimeSince) fuelTimeSince.textContent = snapshot.timeSinceFuel;

    const fuelGraphLastAte = document.getElementById("fuelGraphLastAte");
    if (fuelGraphLastAte) {
      fuelGraphLastAte.textContent = snapshot.lastFuelled === "No food logged"
        ? "Last ate: not logged yet"
        : `Last ate: ${snapshot.timeSinceFuel} ago`;
    }

    const fuelGapNextAction = document.getElementById("fuelGapNextAction");
    if (fuelGapNextAction) {
      fuelGapNextAction.textContent = snapshot.nextAction;
      fuelGapNextAction.className = `fuel-next-action ${snapshot.status}`;
    }

    const fuelStatusContext = document.getElementById("fuelStatusContext");
    if (fuelStatusContext) {
      fuelStatusContext.innerHTML = `
        <strong>Gap risk:</strong>
        <span class="status-pill ${snapshot.status}">${snapshot.status.toUpperCase()}</span>
        <span>${safeText(snapshot.statusContext)}</span>
      `;
    }

    ["fuelledButton", "graphLogFoodButton"].forEach(id => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = daySummary.dayEnded || cooldownSeconds > 0;
      button.textContent = "Log food";
    });

    const undoButton = document.getElementById("undoLatestFoodLog");
    if (undoButton) undoButton.disabled = latestTodayLogIndex() < 0;

    const cooldownMessage = document.getElementById("foodLogCooldownMessage");
    if (cooldownMessage) {
      cooldownMessage.textContent = cooldownSeconds > 0
        ? `Logged. You can log again in ${cooldownSeconds}s.`
        : "";
    }

    const endFuelDayButton = document.getElementById("endFuelDayButton");
    if (endFuelDayButton) endFuelDayButton.disabled = daySummary.dayEnded;

    const continueFuelDayButton = document.getElementById("continueFuelDayButton");
    if (continueFuelDayButton) continueFuelDayButton.disabled = !daySummary.dayEnded;

    const fuelDaySummaryEl = document.getElementById("fuelDaySummary");
    if (fuelDaySummaryEl) {
      fuelDaySummaryEl.innerHTML = `
        <p class="label">Daily fuelling summary</p>
        <p>${safeText(daySummary.message)}</p>
      `;
    }

    const fuelDailyLogDate = document.getElementById("fuelDailyLogDate");
    if (fuelDailyLogDate) fuelDailyLogDate.textContent = daySummary.date;

    const fuelDailyLog = document.getElementById("fuelDailyLog");
    if (fuelDailyLog) {
      const logs = todaysAllLogs();
      fuelDailyLog.innerHTML = logs.length
        ? logs.map(log => {
            const type = normaliseFoodType(log.type);
            const label = FOOD_TYPE_LABELS[type];
            return `
              <div class="row">
                <div>
                  <div class="item-name">${formatClock(log.date)} - ${safeText(label)} logged</div>
                  ${log.note ? `<div class="row-note">${safeText(log.note)}</div>` : ""}
                </div>
              </div>
            `;
          }).join("")
        : `<p class="muted fuel-daily-empty">No food logged today.</p>`;
    }

    renderDayTypeControls();
    renderFuelGapInsights();
    renderFuelDayAnalysis();
    renderFuelArchive();
    drawFuelRhythmGraph();
  };

  function renderDiaryFoodContext() {
    const target = document.getElementById("diaryLastFoodLogged");
    if (!target) return;

    const logs = todaysFoodLogsOnly();
    const last = logs[logs.length - 1] || null;
    target.innerHTML = last
      ? `<span class="label">Last food logged</span><strong>${formatClock(last.date)}</strong><small>${safeText(last.note || `${logs.length} food log${logs.length === 1 ? "" : "s"} today`)}</small>`
      : `<span class="label">Last food logged</span><strong>None today</strong><small>Use Log food on Today.</small>`;
  }

  const originalRenderNutritionBarriers = renderNutritionBarriers;
  renderNutritionBarriers = function renderNutritionBarriersOverride() {
    originalRenderNutritionBarriers();
    renderDiaryFoodContext();
  };

  const originalSwitchScreen = switchScreen;
  let activeMobileTab = "today";
  function mobileTabForScreen(screen) {
    return ({
      dashboard: "today",
      nutritionBarriers: "diary",
      fuelConfirmation: "forecast",
      logs: "activity",
      checklist: "setup"
    })[screen] || activeMobileTab;
  }

  switchScreen = function switchScreenOverride(screen, mobileTab) {
    activeMobileTab = mobileTab || mobileTabForScreen(screen);
    originalSwitchScreen(screen);

    document.querySelectorAll(".mobile-nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileTab === activeMobileTab);
    });

    const pageSubtitle = document.getElementById("pageSubtitle");
    if (pageSubtitle && screen === "dashboard") {
      pageSubtitle.textContent = "See when you last ate and log food fast.";
    }
  };

  document.querySelectorAll(".mobile-nav-item").forEach(button => {
    button.onclick = () => {
      switchScreen(button.dataset.mobileScreen, button.dataset.mobileTab);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    };
  });

  const undoLatestButton = document.getElementById("undoLatestFoodLog");
  if (undoLatestButton) undoLatestButton.addEventListener("click", undoLatestFoodLog);

  const foodLogType = document.getElementById("foodLogType");
  if (foodLogType) foodLogType.addEventListener("change", () => drawFuelRhythmGraph());

  const dayTypeSelect = document.getElementById("fuelDayType");
  if (dayTypeSelect) {
    dayTypeSelect.addEventListener("change", () => {
      setDayTypeForKey(todayKey(), dayTypeSelect.value);
      save();
      renderAll();
    });
  }

  const archiveSelect = document.getElementById("fuelArchiveDate");
  if (archiveSelect) {
    archiveSelect.addEventListener("change", () => {
      selectedArchiveKey = archiveSelect.value;
      renderFuelArchive();
    });
  }

  let graphResizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(graphResizeTimer);
    graphResizeTimer = window.setTimeout(() => drawFuelRhythmGraph(), 120);
  });

  renderAll();
  setInterval(renderFuelGap, 1000);
})();
