// Shared Fuel Guard behavioural helpers for athlete and coach-facing views.
(function attachFuelGuardDomain(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FuelGuardDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardDomain() {
  const CHECKIN_NOTE_PREFIX = "fuel_guard_checkin:";
  const CRASH_NOTE = "fuel_guard_event:crash";
  const SLEEPY_CHECKIN_TYPE = "sleepy";
  const DEFAULT_MAXIMUM_FUEL_GAP_MINUTES = 180;
  const APPROACHING_WINDOW_MINUTES = 30;
  const CRASH_BUFFER_MINUTES = 40;
  const DEFAULT_NUDGE_MESSAGE = "Quick Fuel Guard check-in — remember to log when you next fuel.";

  function clamp(number, min, max) {
    return Math.min(max, Math.max(min, number));
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function parseDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const text = String(value || "").trim();
    if (!text) return null;
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) return direct;
    const normalized = text
      .replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/, "$1T$2")
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
      .replace(/([+-]\d{2})$/, "$1:00");
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function logDate(log) {
    if (!log || typeof log !== "object" || log instanceof Date) return parseDate(log);
    for (const value of [
      log.date,
      log.timestamp,
      log.logged_at,
      log.loggedAt,
      log.time,
      log.created_at,
      log.createdAt
    ]) {
      const parsed = parseDate(value);
      if (parsed) return parsed;
    }
    return null;
  }

  function dateKey(date = new Date()) {
    const parsed = parseDate(date) || new Date();
    return [
      parsed.getFullYear(),
      String(parsed.getMonth() + 1).padStart(2, "0"),
      String(parsed.getDate()).padStart(2, "0")
    ].join("-");
  }

  function dateFromKey(key) {
    const date = new Date(`${key}T12:00:00`);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  function startOfLocalDay(key = dateKey()) {
    const date = dateFromKey(key);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function endOfLocalDay(key = dateKey()) {
    const date = startOfLocalDay(key);
    date.setDate(date.getDate() + 1);
    return date;
  }

  function minutesIntoDay(date) {
    const parsed = parseDate(date);
    if (!parsed) return NaN;
    return parsed.getHours() * 60 + parsed.getMinutes();
  }

  function formatClock(value) {
    const date = parseDate(value);
    if (!date) return "--";
    const hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const suffix = hours >= 12 ? "PM" : "AM";
    return `${hours % 12 || 12}:${minutes} ${suffix}`;
  }

  function duration(minutes) {
    if (!Number.isFinite(minutes)) return "No data";
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const mins = safeMinutes % 60;
    if (!hours) return `${mins}m`;
    return `${hours}h ${String(mins).padStart(2, "0")}m`;
  }

  function parseCheckinNote(value) {
    const text = String(value || "");
    const index = text.indexOf(CHECKIN_NOTE_PREFIX);
    if (index < 0) return null;
    const raw = text.slice(index + CHECKIN_NOTE_PREFIX.length).trim();
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function checkinPayload(log) {
    if (log?.checkin && typeof log.checkin === "object" && !Array.isArray(log.checkin)) return log.checkin;
    return parseCheckinNote(log?.note || log?.notes || "") || null;
  }

  function logType(log) {
    const type = String(log?.type || "fuel").toLowerCase();
    if (type === "sleepy") return "sleepy";
    if (checkinPayload(log)) return "checkin";
    if (type === "checkin") return "checkin";
    if (type === "hydration") return "hydration";
    if (type === "fuel_hydration") return "fuel_hydration";
    if (type === "crash" || String(log?.note || log?.notes || "").includes(CRASH_NOTE)) return "crash";
    return "fuel";
  }

  function isSleepyLog(log) {
    const type = String(log?.type || "").toLowerCase();
    const payload = checkinPayload(log);
    return type === "sleepy" || String(payload?.checkinType || "").toLowerCase() === SLEEPY_CHECKIN_TYPE;
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
    if (isSleepyLog(log)) return "Sleepy";
    const type = logType(log);
    if (type === "hydration") return "Hydration";
    if (type === "fuel_hydration") return "Fuel + hydration";
    if (type === "checkin") return "Check-in";
    if (type === "crash") return "Low energy";
    return "Fuel";
  }

  function normalizeLog(row) {
    const date = logDate(row);
    if (!date) return null;
    const notes = row?.notes || row?.note || "";
    const checkin = checkinPayload({ ...row, note: notes });
    const type = checkin ? "checkin" : logType(row);
    return {
      id: row?.id || "",
      userId: row?.user_id || row?.userId || "",
      timestamp: date.toISOString(),
      date,
      type,
      logType: type,
      source: String(row?.source || "manual").toLowerCase(),
      dayType: row?.day_type || row?.dayType || "",
      trainingSession: row?.training_session || row?.trainingSession || "",
      notes,
      checkin,
      externalEventId: row?.external_event_id || row?.externalEventId || ""
    };
  }

  function logsWithDates(logs = []) {
    return (Array.isArray(logs) ? logs : [])
      .map(normalizeLog)
      .filter(Boolean)
      .sort((a, b) => a.date - b.date);
  }

  function logsForDay(logs = [], key = dateKey()) {
    return logsWithDates(logs).filter(log => dateKey(log.date) === key);
  }

  function maximumFuelGapMinutes(targets = {}) {
    const value = Number(
      targets.maximumFuelGapMinutes ??
      targets.maximum_fuel_gap_minutes ??
      targets.maximum_fuel_gap ??
      targets.maxFuelGapMinutes
    );
    return Number.isFinite(value)
      ? clamp(Math.round(value), 120, 240)
      : DEFAULT_MAXIMUM_FUEL_GAP_MINUTES;
  }

  function fuelGapStatus(minutes, targets = {}) {
    const goal = maximumFuelGapMinutes(targets);
    if (!Number.isFinite(minutes)) return "none";
    if (minutes < Math.max(30, goal - APPROACHING_WINDOW_MINUTES)) return "green";
    if (minutes < goal) return "amber";
    if (minutes < goal + CRASH_BUFFER_MINUTES) return "red";
    return "crash";
  }

  function statusLabel(status) {
    if (status === "green") return "Steady";
    if (status === "amber") return "Eat soon";
    if (status === "red") return "Eat now";
    if (status === "crash") return "Recovery needed";
    return "Ready to log";
  }

  function latestLog(logs, predicate) {
    return logsWithDates(logs).filter(predicate).sort((a, b) => b.date - a.date)[0] || null;
  }

  function contextForLogs(logs = []) {
    const normalized = logsWithDates(logs);
    const dayType = normalized.find(log => log.dayType)?.dayType || "";
    const trainingSession = normalized.find(log => log.trainingSession)?.trainingSession || "";
    return {
      dayType,
      trainingSession,
      dayTypeLabel: dayType ? dayType.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()) : "Normal",
      trainingSessionLabel: trainingSession ? trainingSession.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()) : "Not set"
    };
  }

  function coachDailyStatus({ athlete = {}, logs = [], targets = {}, now = new Date(), key = dateKey(now) } = {}) {
    const dayLogs = logsForDay(logs, key);
    const fuelLogs = dayLogs.filter(isFuelLog);
    const hydrationLogs = dayLogs.filter(isHydrationLog);
    const sleepyLogs = dayLogs.filter(isSleepyLog);
    const lastFuel = latestLog(dayLogs, isFuelLog);
    const lastHydration = latestLog(dayLogs, isHydrationLog);
    const goal = maximumFuelGapMinutes(targets);
    const minutesSinceFuel = lastFuel ? Math.max(0, (parseDate(now) - lastFuel.date) / 60000) : Infinity;
    const minutesSinceHydration = lastHydration ? Math.max(0, (parseDate(now) - lastHydration.date) / 60000) : Infinity;
    const status = fuelGapStatus(minutesSinceFuel, targets);
    const flags = [];

    if (lastFuel && minutesSinceFuel >= goal) {
      flags.push({
        id: "gap_exceeded",
        label: "Gap exceeded",
        detail: `Fuel gap exceeded by ${duration(minutesSinceFuel - goal)}`,
        priority: status === "crash" ? 110 : 100
      });
    } else if (lastFuel && goal - minutesSinceFuel <= APPROACHING_WINDOW_MINUTES) {
      flags.push({
        id: "gap_approaching",
        label: "Gap approaching",
        detail: `${duration(goal - minutesSinceFuel)} until fuel-gap target`,
        priority: 80
      });
    }

    if (sleepyLogs.length >= 2) {
      flags.push({
        id: "sleepy_cluster",
        label: "Repeated Sleepy events",
        detail: `${sleepyLogs.length} Sleepy events today`,
        priority: 65
      });
    }

    const localNow = parseDate(now) || new Date();
    const isToday = key === dateKey(localNow);
    const dailyFuelTarget = Number(targets.dailyFuelLogs ?? targets.daily_fuel_logs);
    if (isToday && !fuelLogs.length && localNow.getHours() >= 12) {
      flags.push({
        id: "low_fuelling_activity",
        label: "Low fuelling activity",
        detail: "No fuel logs today yet",
        priority: 45
      });
    } else if (isToday && Number.isFinite(dailyFuelTarget) && dailyFuelTarget > 0 && localNow.getHours() >= 15 && fuelLogs.length < Math.ceil(dailyFuelTarget / 2)) {
      flags.push({
        id: "low_fuelling_activity",
        label: "Low fuelling activity",
        detail: `${fuelLogs.length} of ${dailyFuelTarget} fuel logs so far`,
        priority: 45
      });
    }

    const urgency = flags.reduce((top, flag) => Math.max(top, flag.priority), 0);
    return {
      athlete,
      key,
      logs: dayLogs,
      fuelLogs,
      hydrationLogs,
      sleepyLogs,
      lastFuel,
      lastHydration,
      minutesSinceFuel,
      minutesSinceHydration,
      status,
      statusLabel: statusLabel(status),
      maximumFuelGapMinutes: goal,
      remainingFuelGapMinutes: lastFuel && minutesSinceFuel < goal ? goal - minutesSinceFuel : null,
      beyondFuelGapMinutes: lastFuel && minutesSinceFuel >= goal ? minutesSinceFuel - goal : null,
      flags,
      urgency,
      context: contextForLogs(dayLogs)
    };
  }

  function buildCoachRoster({ athletes = [], logs = [], targetsByUser = {}, now = new Date(), key = dateKey(now) } = {}) {
    return athletes
      .map(athlete => coachDailyStatus({
        athlete,
        logs: logs.filter(log => String(log.userId || log.user_id || "") === String(athlete.userId || athlete.user_id || athlete.id || "")),
        targets: targetsByUser[athlete.userId || athlete.user_id || athlete.id] || {},
        now,
        key
      }))
      .sort((a, b) => b.urgency - a.urgency || String(a.athlete.displayName || a.athlete.email || "").localeCompare(String(b.athlete.displayName || b.athlete.email || "")));
  }

  function addDays(date, amount) {
    const result = startOfLocalDay(dateKey(date));
    result.setDate(result.getDate() + Number(amount || 0));
    return result;
  }

  function daysInclusive(start, end) {
    const startDate = startOfLocalDay(dateKey(start));
    const endDate = startOfLocalDay(dateKey(end));
    return Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);
  }

  function periodDisplay(start, end) {
    const format = value => (parseDate(value) || new Date()).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
    return `${format(start)} – ${format(end)}`;
  }

  function reviewPeriodRange({ preset = "12_weeks", customStart = "", customEnd = "", now = new Date() } = {}) {
    let end = startOfLocalDay(customEnd || dateKey(now));
    const lengths = { "4_weeks": 28, "8_weeks": 56, "12_weeks": 84, season: 84 };
    const normalizedPreset = preset === "custom" ? "custom" : lengths[preset] ? preset : "12_weeks";
    let start;
    if (normalizedPreset === "custom" && customStart) {
      start = startOfLocalDay(customStart);
    } else {
      start = addDays(end, -(lengths[normalizedPreset] || 84) + 1);
    }
    if (start > end) [start, end] = [end, start];
    return {
      preset: normalizedPreset,
      start,
      end,
      startKey: dateKey(start),
      endKey: dateKey(end),
      days: daysInclusive(start, end),
      display: periodDisplay(start, end)
    };
  }

  function previousPeriodRange(period = {}) {
    const days = Number(period.days) || daysInclusive(period.start, period.end);
    const end = addDays(period.start || new Date(), -1);
    const start = addDays(end, -days + 1);
    return {
      preset: period.preset || "custom",
      start,
      end,
      startKey: dateKey(start),
      endKey: dateKey(end),
      days,
      display: periodDisplay(start, end)
    };
  }

  function logsInPeriod(logs = [], period = {}) {
    const startKey = period.startKey || dateKey(period.start);
    const endKey = period.endKey || dateKey(period.end);
    return logsWithDates(logs).filter(log => {
      const key = dateKey(log.date);
      return key >= startKey && key <= endKey;
    });
  }

  function groupLogsByDay(logs = []) {
    return logsWithDates(logs).reduce((map, log) => {
      const key = dateKey(log.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(log);
      return map;
    }, new Map());
  }

  function average(values = []) {
    const finite = values.filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }

  function roundPercent(numerator, denominator) {
    return denominator ? Math.round((numerator / denominator) * 100) : null;
  }

  function dayFuelGaps(logs = []) {
    const fuelLogs = logsWithDates(logs).filter(isFuelLog);
    return fuelLogs.slice(1).map((log, index) => ({
      start: fuelLogs[index].date,
      end: log.date,
      minutes: (log.date - fuelLogs[index].date) / 60000
    })).filter(gap => Number.isFinite(gap.minutes) && gap.minutes >= 0);
  }

  function mostCommonBucket(items, definitions, minuteFor, labelFor) {
    const buckets = definitions.map(definition => ({ ...definition, count: 0 }));
    items.forEach(item => {
      const minute = minuteFor(item);
      const bucket = buckets.find(candidate => minute >= candidate.start && minute < candidate.end);
      if (bucket) bucket.count += 1;
    });
    const winner = buckets.sort((a, b) => b.count - a.count || a.start - b.start)[0];
    return winner?.count ? { ...winner, label: labelFor(winner) } : null;
  }

  function commonFuelWindow(fuelLogs) {
    const definitions = [];
    for (let hour = 0; hour < 24; hour += 2) definitions.push({ start: hour * 60, end: (hour + 2) * 60 });
    return mostCommonBucket(
      fuelLogs,
      definitions,
      log => minutesIntoDay(log.date),
      bucket => `${String(bucket.start / 60).padStart(2, "0")}:00-${String(bucket.end / 60).padStart(2, "0")}:00`
    );
  }

  function commonGapWindow(gaps) {
    const definitions = [
      { start: 0, end: 8 * 60 },
      { start: 8 * 60, end: 10 * 60 },
      { start: 10 * 60, end: 13 * 60 },
      { start: 13 * 60, end: 18 * 60 },
      { start: 18 * 60, end: 22 * 60 },
      { start: 22 * 60, end: 24 * 60 }
    ];
    return mostCommonBucket(
      gaps,
      definitions,
      gap => minutesIntoDay(gap.start),
      bucket => `${String(bucket.start / 60).padStart(2, "0")}:00-${String(bucket.end / 60).padStart(2, "0")}:00`
    );
  }

  function commonSleepyWindow(sleepyLogs) {
    const definitions = [];
    for (let hour = 0; hour < 24; hour += 2) definitions.push({ start: hour * 60, end: (hour + 2) * 60 });
    return mostCommonBucket(
      sleepyLogs,
      definitions,
      log => minutesIntoDay(log.date),
      bucket => `${String(bucket.start / 60).padStart(2, "0")}:00-${String(bucket.end / 60).padStart(2, "0")}:00`
    );
  }

  function contextLabel(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("work") || normalized.includes("shift")) return "Shift";
    if (normalized.includes("competition") || normalized.includes("race")) return "Competition";
    if (normalized.includes("holiday") || normalized.includes("travel")) return "Travel";
    if (normalized.includes("training")) return "Training";
    return value ? String(value).replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()) : "Normal";
  }

  function periodMetrics(logs = [], period = {}, targets = {}) {
    const sourceLogs = logsInPeriod(logs, period);
    const byDay = groupLogsByDay(sourceLogs);
    const goal = maximumFuelGapMinutes(targets);
    const dayRows = Array.from(byDay.entries()).map(([key, dayLogs]) => {
      const fuelLogs = dayLogs.filter(isFuelLog);
      const hydrationLogs = dayLogs.filter(isHydrationLog);
      const sleepyLogs = dayLogs.filter(isSleepyLog);
      const gaps = dayFuelGaps(dayLogs);
      const longestGap = gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : null;
      return { key, dayLogs, fuelLogs, hydrationLogs, sleepyLogs, gaps, longestGap };
    });
    const metricDays = dayRows.filter(day => day.gaps.length);
    const gaps = dayRows.flatMap(day => day.gaps);
    const fuelLogs = dayRows.flatMap(day => day.fuelLogs);
    const hydrationLogs = dayRows.flatMap(day => day.hydrationLogs);
    const sleepyLogs = dayRows.flatMap(day => day.sleepyLogs);
    const exceedingGaps = gaps.filter(gap => gap.minutes > goal);
    const daysExceedingTarget = metricDays.filter(day => day.longestGap > goal).length;
    const afterLongGapCount = sleepyLogs.filter(sleepy => {
      const sameDayFuel = fuelLogs.filter(fuel => dateKey(fuel.date) === dateKey(sleepy.date) && fuel.date < sleepy.date);
      const prior = sameDayFuel.sort((a, b) => b.date - a.date)[0];
      return prior && (sleepy.date - prior.date) / 60000 > goal;
    }).length;
    const totalDays = Number(period.days) || daysInclusive(period.start, period.end);
    const loggedDays = dayRows.length;
    const activeWeeks = Math.max(1, loggedDays / 7);
    const contextMap = new Map();
    metricDays.forEach(day => {
      const raw = day.dayLogs.find(log => log.dayType)?.dayType || "Normal";
      const label = contextLabel(raw);
      if (!contextMap.has(label)) contextMap.set(label, { label, metricDays: 0, withinTargetDays: 0 });
      const context = contextMap.get(label);
      context.metricDays += 1;
      if (day.longestGap <= goal) context.withinTargetDays += 1;
    });
    const contexts = Array.from(contextMap.values())
      .map(context => ({ ...context, adherencePct: roundPercent(context.withinTargetDays, context.metricDays) }))
      .sort((a, b) => b.metricDays - a.metricDays || a.label.localeCompare(b.label));
    return {
      sourceLogs,
      goal,
      coverage: {
        totalDays,
        loggedDays,
        metricDays: metricDays.length,
        loggedPct: roundPercent(loggedDays, totalDays),
        limited: loggedDays < Math.min(4, totalDays) || metricDays.length < 2
      },
      consistency: {
        avgFuelLogsPerActiveDay: average(dayRows.filter(day => day.fuelLogs.length).map(day => day.fuelLogs.length)),
        avgHydrationLogsPerActiveDay: average(dayRows.filter(day => day.hydrationLogs.length).map(day => day.hydrationLogs.length)),
        daysExceedingTarget,
        targetAdherencePct: roundPercent(metricDays.length - daysExceedingTarget, metricDays.length)
      },
      fuelling: {
        averageFirstFuelMinutes: average(dayRows.filter(day => day.fuelLogs.length).map(day => minutesIntoDay(day.fuelLogs[0].date))),
        averageFinalFuelMinutes: average(dayRows.filter(day => day.fuelLogs.length).map(day => minutesIntoDay(day.fuelLogs[day.fuelLogs.length - 1].date))),
        averageGapMinutes: average(gaps.map(gap => gap.minutes)),
        longestGapMinutes: gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : null,
        gapsExceedingTarget: exceedingGaps.length,
        commonGapWindow: commonGapWindow(exceedingGaps.length ? exceedingGaps : gaps),
        commonFuellingWindow: commonFuelWindow(fuelLogs)
      },
      sleepy: {
        total: sleepyLogs.length,
        averagePerActiveWeek: sleepyLogs.length / activeWeeks,
        commonWindow: commonSleepyWindow(sleepyLogs),
        afterLongGapCount,
        afterLongGapPct: roundPercent(afterLongGapCount, sleepyLogs.length),
        targetMinutes: goal
      },
      contexts,
      dayRows,
      gaps
    };
  }

  function comparisonMetric(id, label, current, previous, unit, higherIsBetter = false) {
    const comparable = Number.isFinite(current) && Number.isFinite(previous);
    const difference = comparable ? current - previous : null;
    let direction = "unknown";
    if (comparable) {
      if (Math.abs(difference) < (unit === "minutes" ? 10 : 1)) direction = "stable";
      else if ((difference > 0) === higherIsBetter) direction = "improved";
      else direction = "declined";
    }
    return {
      id, label, current, previous, unit, difference, direction,
      trendLabel: direction === "improved" ? "Improved" : direction === "declined" ? "Moved away from target" : direction === "stable" ? "Stable" : "Not enough data"
    };
  }

  function weeklyMetrics(logs, period, targets) {
    const rows = [];
    for (let start = startOfLocalDay(period.startKey); start <= startOfLocalDay(period.endKey); start = addDays(start, 7)) {
      const end = addDays(start, 6) > period.end ? startOfLocalDay(period.endKey) : addDays(start, 6);
      const week = { start, end, startKey: dateKey(start), endKey: dateKey(end), days: daysInclusive(start, end) };
      const metrics = periodMetrics(logs, week, targets);
      rows.push({
        label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        averageGapMinutes: metrics.fuelling.averageGapMinutes,
        loggingCoveragePct: metrics.coverage.loggedPct,
        sleepyEvents: metrics.sleepy.total
      });
    }
    return rows;
  }

  function buildAthleteReviewReport({ athlete = {}, coach = {}, organisationName = "", logs = [], previousLogs = [], targets = {}, period, interventions = [], coachNotes = "", generatedAt = new Date() } = {}) {
    const activePeriod = period || reviewPeriodRange({ now: generatedAt });
    const previousPeriod = previousPeriodRange(activePeriod);
    const current = periodMetrics(logs, activePeriod, targets);
    const previous = periodMetrics(previousLogs, previousPeriod, targets);
    const comparison = [
      comparisonMetric("target_adherence", "Days within gap target", current.consistency.targetAdherencePct, previous.consistency.targetAdherencePct, "%", true),
      comparisonMetric("average_gap", "Average fuel gap", current.fuelling.averageGapMinutes, previous.fuelling.averageGapMinutes, "minutes", false),
      comparisonMetric("logging_coverage", "Logging coverage", current.coverage.loggedPct, previous.coverage.loggedPct, "%", true),
      comparisonMetric("sleepy_events", "Sleepy events", current.sleepy.total, previous.sleepy.total, "events", false)
    ];
    const executiveSummary = [];
    if (Number.isFinite(current.consistency.targetAdherencePct)) {
      executiveSummary.push(`Fuel-gap target was met on ${current.consistency.targetAdherencePct}% of days with enough fuel logs to measure a gap.`);
    } else {
      executiveSummary.push("Not enough days had multiple fuel logs to measure target adherence.");
    }
    executiveSummary.push(`Logging coverage was ${current.coverage.loggedDays} of ${current.coverage.totalDays} days (${current.coverage.loggedPct ?? 0}%).`);
    executiveSummary.push(current.sleepy.total
      ? `${current.sleepy.total} Sleepy event${current.sleepy.total === 1 ? " was" : "s were"} logged; this is an observational pattern only.`
      : "No Sleepy events were logged in this period.");
    return {
      title: `${athlete.displayName || "Athlete"} Review`,
      athleteName: athlete.displayName || "Athlete",
      coachName: coach.display_name || coach.displayName || coach.email || "Coach",
      organisationName,
      generatedAt,
      period: activePeriod,
      previousPeriod,
      coverage: current.coverage,
      consistency: current.consistency,
      fuelling: current.fuelling,
      sleepy: current.sleepy,
      contexts: current.contexts,
      executiveSummary,
      comparison,
      weekly: weeklyMetrics(logs, activePeriod, targets),
      interventions,
      coachNotes,
      targetMinutes: current.goal,
      sourceLogs: current.sourceLogs.concat(previous.sourceLogs)
    };
  }

  function interventionComparison({ intervention = {}, logs = [], targets = {}, weeks, now = new Date() } = {}) {
    const interventionDate = startOfLocalDay(intervention.intervention_date || intervention.created_at || dateKey(now));
    const windowDays = Number(intervention.review_window_days) || (Number(weeks) || 4) * 7;
    const beforePeriod = {
      start: addDays(interventionDate, -windowDays),
      end: addDays(interventionDate, -1)
    };
    beforePeriod.startKey = dateKey(beforePeriod.start);
    beforePeriod.endKey = dateKey(beforePeriod.end);
    beforePeriod.days = windowDays;
    beforePeriod.display = periodDisplay(beforePeriod.start, beforePeriod.end);
    const afterPeriod = {
      start: interventionDate,
      end: addDays(interventionDate, windowDays - 1)
    };
    afterPeriod.startKey = dateKey(afterPeriod.start);
    afterPeriod.endKey = dateKey(afterPeriod.end);
    afterPeriod.days = windowDays;
    afterPeriod.display = periodDisplay(afterPeriod.start, afterPeriod.end);
    const before = periodMetrics(logs, beforePeriod, targets);
    const after = periodMetrics(logs, afterPeriod, targets);
    const enoughData = before.coverage.metricDays >= 1 && after.coverage.metricDays >= 1;
    let direction = "insufficient";
    let label = "Not enough comparable fuel-gap data in the equivalent before and after periods yet.";
    if (enoughData && Number.isFinite(before.fuelling.averageGapMinutes) && Number.isFinite(after.fuelling.averageGapMinutes)) {
      const difference = after.fuelling.averageGapMinutes - before.fuelling.averageGapMinutes;
      direction = Math.abs(difference) < 10 ? "stable" : difference < 0 ? "improved" : "declined";
      label = `Average fuel gap was ${duration(before.fuelling.averageGapMinutes)} before and ${duration(after.fuelling.averageGapMinutes)} after; it was ${direction === "improved" ? "lower" : direction === "declined" ? "higher" : "similar"} after this intervention. This comparison is observational and does not establish cause.`;
    }
    return {
      direction,
      label,
      enoughData,
      windowDays,
      beforePeriod,
      afterPeriod,
      before: {
        averageGapMinutes: before.fuelling.averageGapMinutes,
        longestGapMinutes: before.fuelling.longestGapMinutes,
        targetAdherencePct: before.consistency.targetAdherencePct,
        gapsExceedingTarget: before.fuelling.gapsExceedingTarget,
        loggingCoveragePct: before.coverage.loggedPct,
        sleepyEvents: before.sleepy.total,
        loggedDays: before.coverage.loggedDays,
        metricDays: before.coverage.metricDays
      },
      after: {
        averageGapMinutes: after.fuelling.averageGapMinutes,
        longestGapMinutes: after.fuelling.longestGapMinutes,
        targetAdherencePct: after.consistency.targetAdherencePct,
        gapsExceedingTarget: after.fuelling.gapsExceedingTarget,
        loggingCoveragePct: after.coverage.loggedPct,
        sleepyEvents: after.sleepy.total,
        loggedDays: after.coverage.loggedDays,
        metricDays: after.coverage.metricDays
      }
    };
  }

  function wholeDaysSince(value, now = new Date()) {
    const date = parseDate(value);
    if (!date) return null;
    return Math.max(0, Math.floor((startOfLocalDay(dateKey(now)) - startOfLocalDay(dateKey(date))) / 86400000));
  }

  function buildTeamDataHealth({ athletes = [], rows = [], now = new Date() } = {}) {
    const byAthlete = new Map((rows || []).map(row => [String(row.athlete_id || row.athleteId || ""), row]));
    const items = athletes.map(athlete => {
      const athleteId = String(athlete.userId || athlete.user_id || athlete.id || "");
      const row = byAthlete.get(athleteId) || {};
      const lastLogAt = row.last_log_at || row.lastLogAt || null;
      const daysSinceLog = wholeDaysSince(lastLogAt, now);
      const garminStatus = row.garmin_connection_status || row.garminConnectionStatus || "not_connected";
      let id = "reporting_normally";
      let label = "Reporting normally";
      let detail = lastLogAt ? `Last log ${formatClock(lastLogAt)} today` : "Logging status unavailable";
      let priority = 0;
      if (garminStatus === "connection_revoked") {
        id = "garmin_reconnect";
        label = "Garmin needs reconnecting";
        detail = row.garmin_revoked_at ? `Connection revoked ${dateKey(row.garmin_revoked_at)}` : "Garmin connection revoked";
        priority = 75;
      } else if (!lastLogAt) {
        id = "insufficient_data";
        label = "Insufficient data";
        detail = "No shared Fuel Guard logs yet";
        priority = 30;
      } else if (daysSinceLog >= 3) {
        id = "prolonged_absence";
        label = `No logs for ${daysSinceLog} days`;
        detail = `Last log ${dateKey(lastLogAt)}`;
        priority = 70;
      } else if (daysSinceLog >= 1) {
        id = "no_logs_today";
        label = "No logs today";
        detail = daysSinceLog === 1 ? "Last logged yesterday" : `Last logged ${daysSinceLog} days ago`;
        priority = 50;
      }
      return {
        athlete,
        athleteId,
        id,
        label,
        detail,
        priority,
        daysSinceLog,
        lastLogAt,
        lastGarminLogAt: row.last_garmin_log_at || null,
        garminConnectionStatus: garminStatus,
        garminConnectedAt: row.garmin_connected_at || null,
        garminLastUsedAt: row.garmin_last_used_at || null,
        garminRevokedAt: row.garmin_revoked_at || null
      };
    });
    const summary = {
      total: items.length,
      reportingNormally: items.filter(item => item.id === "reporting_normally").length,
      noLogsToday: items.filter(item => item.id === "no_logs_today").length,
      prolongedAbsence: items.filter(item => item.id === "prolonged_absence").length,
      insufficientData: items.filter(item => item.id === "insufficient_data").length,
      garminReconnect: items.filter(item => item.id === "garmin_reconnect").length
    };
    return { items, summary };
  }

  function occurrenceToken(value) {
    return String(value || "unknown").replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 100);
  }

  function attentionItem({ athlete, type, category, label, detail, priority, occurrenceKey, canNudge = false, interventionId = null }) {
    return {
      athlete,
      athleteId: String(athlete?.userId || athlete?.user_id || athlete?.id || ""),
      type,
      category,
      label,
      detail,
      priority,
      occurrenceKey,
      canNudge,
      interventionId
    };
  }

  function buildCoachAttentionItems({ roster = [], dataHealth = { items: [] }, interventions = [], actions = [], now = new Date(), includeResolved = false } = {}) {
    const key = dateKey(now);
    const generated = new Map();
    const healthByAthlete = new Map((dataHealth.items || []).map(item => [String(item.athleteId || ""), item]));
    const add = item => {
      const dedupeKey = `${item.athleteId}:${item.occurrenceKey}`;
      const existing = generated.get(dedupeKey);
      if (!existing || item.priority > existing.priority) generated.set(dedupeKey, item);
    };
    roster.forEach(status => {
      const athlete = status.athlete;
      status.flags.forEach(flag => {
        if (flag.id === "low_fuelling_activity") {
          const health = healthByAthlete.get(String(athlete.userId || athlete.user_id || athlete.id || ""));
          if (health && health.id !== "reporting_normally") return;
          add(attentionItem({
            athlete,
            type: "no_logs_today",
            category: "not_logging",
            label: "Not logging fuel",
            detail: flag.detail,
            priority: flag.priority,
            occurrenceKey: `no_logs_today:${key}`,
            canNudge: true
          }));
          return;
        }
        const type = flag.id === "sleepy_cluster" ? "repeated_sleepy" : flag.id;
        const latestTrigger = type === "repeated_sleepy"
          ? status.sleepyLogs[status.sleepyLogs.length - 1]
          : status.lastFuel;
        const trigger = latestTrigger?.id || latestTrigger?.externalEventId || latestTrigger?.timestamp || key;
        const target = type.startsWith("gap_") ? `:${status.maximumFuelGapMinutes}` : "";
        add(attentionItem({
          athlete,
          type,
          category: type === "gap_approaching" ? "approaching_gap" : type === "repeated_sleepy" ? "repeated_sleepy" : "need_attention",
          label: flag.label,
          detail: flag.detail,
          priority: flag.priority,
          occurrenceKey: `${type}:${key}:${occurrenceToken(trigger)}${target}`,
          canNudge: true
        }));
      });
    });
    (dataHealth.items || []).forEach(health => {
      if (health.id === "reporting_normally") return;
      const athlete = health.athlete;
      const occurrenceKey = health.id === "garmin_reconnect"
        ? `garmin_reconnect:${occurrenceToken(health.garminRevokedAt || "revoked")}`
        : `${health.id}:${key}:${occurrenceToken(health.lastLogAt || "never")}`;
      add(attentionItem({
        athlete,
        type: health.id,
        category: health.id === "garmin_reconnect" ? "need_attention" : "not_logging",
        label: health.label,
        detail: health.detail,
        priority: health.priority,
        occurrenceKey,
        canNudge: health.id !== "garmin_reconnect"
      }));
    });
    const rosterByAthlete = new Map(roster.map(item => [String(item.athlete.userId || item.athlete.id || ""), item.athlete]));
    (interventions || []).forEach(intervention => {
      const due = intervention.status === "review_due" || (intervention.status === "active" && String(intervention.review_date || "") <= key);
      if (!due) return;
      const athlete = rosterByAthlete.get(String(intervention.athlete_id || ""));
      if (!athlete) return;
      add(attentionItem({
        athlete,
        type: "intervention_review_due",
        category: "need_attention",
        label: "Intervention review due",
        detail: intervention.action_text || intervention.observation || "Open the intervention review.",
        priority: 90,
        occurrenceKey: `intervention_review_due:${occurrenceToken(intervention.id)}:${occurrenceToken(intervention.review_date)}`,
        interventionId: intervention.id
      }));
    });
    const actionByKey = new Map((actions || []).map(action => [String(action.occurrence_key || action.occurrenceKey || ""), action]));
    return Array.from(generated.values())
      .map(item => ({ ...item, disposition: actionByKey.get(item.occurrenceKey)?.status || "open" }))
      .filter(item => includeResolved || item.disposition === "open")
      .sort((a, b) => b.priority - a.priority || String(a.athlete?.displayName || "").localeCompare(String(b.athlete?.displayName || "")));
  }

  function attentionSummary(items = []) {
    return {
      needAttention: items.filter(item => item.category === "need_attention").length,
      approachingGap: items.filter(item => item.category === "approaching_gap").length,
      repeatedSleepy: items.filter(item => item.category === "repeated_sleepy").length,
      notLogging: items.filter(item => item.category === "not_logging").length,
      total: items.length
    };
  }

  return {
    CHECKIN_NOTE_PREFIX,
    SLEEPY_CHECKIN_TYPE,
    DEFAULT_NUDGE_MESSAGE,
    escapeHtml,
    parseDate,
    logDate,
    dateKey,
    startOfLocalDay,
    endOfLocalDay,
    minutesIntoDay,
    formatClock,
    duration,
    parseCheckinNote,
    checkinPayload,
    logType,
    logTypeLabel,
    isFuelLog,
    isHydrationLog,
    isSleepyLog,
    normalizeLog,
    logsWithDates,
    logsForDay,
    latestLog,
    maximumFuelGapMinutes,
    fuelGapStatus,
    statusLabel,
    coachDailyStatus,
    buildCoachRoster,
    reviewPeriodRange,
    previousPeriodRange,
    periodMetrics,
    buildAthleteReviewReport,
    interventionComparison,
    buildTeamDataHealth,
    buildCoachAttentionItems,
    attentionSummary
  };
});
