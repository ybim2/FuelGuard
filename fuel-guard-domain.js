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

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfLocalWeek(date = new Date()) {
    const start = startOfLocalDay(dateKey(date));
    const day = start.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    return addDays(start, offset);
  }

  function endOfLocalDate(date = new Date()) {
    const end = startOfLocalDay(dateKey(date));
    end.setDate(end.getDate() + 1);
    end.setMilliseconds(end.getMilliseconds() - 1);
    return end;
  }

  function daysBetweenInclusive(start, end) {
    const first = startOfLocalDay(dateKey(start));
    const last = startOfLocalDay(dateKey(end));
    return Math.max(1, Math.round((last - first) / 86400000) + 1);
  }

  function periodPresetLabel(preset = "12_weeks") {
    if (preset === "4_weeks") return "4-Week Review";
    if (preset === "8_weeks") return "8-Week Review";
    if (preset === "season") return "Season Review";
    if (preset === "custom") return "Custom Review";
    return "12-Week Review";
  }

  function reviewPeriodRange({ preset = "12_weeks", now = new Date(), customStart, customEnd } = {}) {
    const end = endOfLocalDate(parseDate(customEnd) || now);
    let start;
    if (preset === "4_weeks") start = addDays(startOfLocalDay(dateKey(end)), -27);
    else if (preset === "8_weeks") start = addDays(startOfLocalDay(dateKey(end)), -55);
    else if (preset === "season") {
      start = startOfLocalDay(dateKey(end));
      start.setMonth(0, 1);
    } else if (preset === "custom") {
      start = startOfLocalDay(dateKey(parseDate(customStart) || end));
    } else {
      start = addDays(startOfLocalDay(dateKey(end)), -83);
    }
    if (start > end) {
      const swap = new Date(start);
      start.setTime(startOfLocalDay(dateKey(end)).getTime());
      end.setTime(endOfLocalDate(swap).getTime());
    }
    return {
      preset,
      label: periodPresetLabel(preset),
      start,
      end,
      startKey: dateKey(start),
      endKey: dateKey(end),
      totalDays: daysBetweenInclusive(start, end)
    };
  }

  function previousPeriodRange(period = reviewPeriodRange()) {
    const totalDays = Number(period.totalDays) || daysBetweenInclusive(period.start, period.end);
    const end = addDays(startOfLocalDay(period.startKey || dateKey(period.start)), -1);
    const start = addDays(startOfLocalDay(dateKey(end)), -(totalDays - 1));
    return {
      preset: period.preset,
      label: `Previous ${period.label || "Review"}`,
      start,
      end: endOfLocalDate(end),
      startKey: dateKey(start),
      endKey: dateKey(end),
      totalDays
    };
  }

  function formatDateShort(value) {
    const date = parseDate(value);
    if (!date) return "--";
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function formatDateRange(start, end) {
    return `${formatDateShort(start)} - ${formatDateShort(end)}`;
  }

  function logsInRange(logs = [], start, end) {
    const first = startOfLocalDay(dateKey(start));
    const last = endOfLocalDate(end);
    return logsWithDates(logs).filter(log => log.date >= first && log.date <= last);
  }

  function groupLogsByDay(logs = []) {
    return logsWithDates(logs).reduce((map, log) => {
      const key = dateKey(log.date);
      if (!map[key]) map[key] = [];
      map[key].push(log);
      return map;
    }, {});
  }

  function average(values = []) {
    const clean = values.filter(Number.isFinite);
    return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
  }

  function averageTimeLabel(minutes) {
    if (!Number.isFinite(minutes)) return "Not enough data";
    const date = startOfLocalDay();
    date.setMinutes(Math.round(minutes));
    return formatClock(date);
  }

  function formatHoursLabel(minutes) {
    return Number.isFinite(minutes) ? duration(minutes) : "Not enough data";
  }

  function hourWindowLabel(startMinute, endMinute) {
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) return "Not enough data";
    const startHour = clamp(Math.floor(startMinute / 60), 0, 23);
    const endHour = clamp(Math.ceil(endMinute / 60), 1, 24);
    return `${String(startHour).padStart(2, "0")}:00-${String(endHour).padStart(2, "0")}:00`;
  }

  function fuelGapsForDay(dayLogs = []) {
    const fuel = logsWithDates(dayLogs).filter(isFuelLog).sort((a, b) => a.date - b.date);
    const gaps = [];
    for (let index = 1; index < fuel.length; index += 1) {
      const start = fuel[index - 1].date;
      const end = fuel[index].date;
      const minutes = (end - start) / 60000;
      if (Number.isFinite(minutes) && minutes > 0) {
        gaps.push({
          start,
          end,
          startMinute: minutesIntoDay(start),
          endMinute: minutesIntoDay(end),
          minutes
        });
      }
    }
    return gaps;
  }

  function commonWindowFromIntervals(intervals = [], { minimumCount = 2 } = {}) {
    const counts = new Map();
    intervals
      .filter(interval => Number.isFinite(interval.startMinute) && Number.isFinite(interval.endMinute))
      .forEach(interval => {
        const startHour = clamp(Math.floor(interval.startMinute / 60), 0, 23);
        const endHour = clamp(Math.ceil(interval.endMinute / 60), startHour + 1, 24);
        const key = String(startHour);
        const entry = counts.get(key) || { startMinute: startHour * 60, endMinuteTotal: 0, count: 0 };
        entry.count += 1;
        entry.endMinuteTotal += endHour * 60;
        counts.set(key, entry);
      });
    const best = [...counts.values()].map(entry => ({
      startMinute: entry.startMinute,
      endMinute: entry.endMinuteTotal / entry.count,
      count: entry.count
    })).sort((a, b) => b.count - a.count || a.startMinute - b.startMinute)[0];
    if (!best || best.count < minimumCount) return null;
    return { ...best, label: hourWindowLabel(best.startMinute, best.endMinute) };
  }

  function commonEventWindow(logs = [], predicate = isFuelLog, { bucketHours = 2, minimumCount = 1 } = {}) {
    const counts = new Map();
    logsWithDates(logs).filter(predicate).forEach(log => {
      const minute = minutesIntoDay(log.date);
      if (!Number.isFinite(minute)) return;
      const startHour = clamp(Math.floor(minute / 60 / bucketHours) * bucketHours, 0, 23);
      const endHour = clamp(startHour + bucketHours, 1, 24);
      const key = `${startHour}-${endHour}`;
      const entry = counts.get(key) || { startMinute: startHour * 60, endMinute: endHour * 60, count: 0 };
      entry.count += 1;
      counts.set(key, entry);
    });
    const best = [...counts.values()].sort((a, b) => b.count - a.count || a.startMinute - b.startMinute)[0];
    if (!best || best.count < minimumCount) return null;
    return { ...best, label: hourWindowLabel(best.startMinute, best.endMinute) };
  }

  function dayContext(dayLogs = []) {
    const context = contextForLogs(dayLogs);
    const day = String(context.dayType || "").toLowerCase();
    const session = String(context.trainingSession || "").toLowerCase();
    if (/competition/.test(day)) return "Competition";
    if (/travel|travelling/.test(day)) return "Travel";
    if (session && !/no[_\s-]?training|none|not set/.test(session)) return "Training";
    if (/work|working|shift/.test(day)) return "Shift";
    return "Normal";
  }

  function summarisePeriod({ logs = [], targets = {}, period = reviewPeriodRange() } = {}) {
    const rangeLogs = logsInRange(logs, period.start, period.end);
    const byDay = groupLogsByDay(rangeLogs);
    const goal = maximumFuelGapMinutes(targets);
    const daySummaries = Object.entries(byDay).map(([key, dayLogs]) => {
      const normalized = logsWithDates(dayLogs);
      const fuel = normalized.filter(isFuelLog);
      const hydration = normalized.filter(isHydrationLog);
      const sleepy = normalized.filter(isSleepyLog);
      const gaps = fuelGapsForDay(normalized);
      const exceededGaps = gaps.filter(gap => gap.minutes > goal);
      return {
        key,
        logs: normalized,
        fuel,
        hydration,
        sleepy,
        gaps,
        exceededGaps,
        hasMetrics: gaps.length > 0,
        withinTarget: gaps.length > 0 && exceededGaps.length === 0,
        context: dayContext(normalized),
        firstFuel: fuel[0] || null,
        finalFuel: fuel[fuel.length - 1] || null
      };
    }).sort((a, b) => a.key.localeCompare(b.key));
    const metricDays = daySummaries.filter(day => day.hasMetrics);
    const activeDays = daySummaries.filter(day => day.logs.length);
    const allGaps = daySummaries.flatMap(day => day.gaps.map(gap => ({ ...gap, key: day.key, context: day.context })));
    const exceededGaps = allGaps.filter(gap => gap.minutes > goal);
    const sleepyLogs = rangeLogs.filter(isSleepyLog);
    const fuelLogs = rangeLogs.filter(isFuelLog);
    const hydrationLogs = rangeLogs.filter(isHydrationLog);
    const sleepyAfterLongGap = sleepyLogs.filter(sleepy => {
      const sameDayFuel = fuelLogs
        .filter(log => dateKey(log.date) === dateKey(sleepy.date) && log.date <= sleepy.date)
        .sort((a, b) => b.date - a.date)[0];
      return sameDayFuel && (sleepy.date - sameDayFuel.date) / 60000 > goal;
    });
    const contextMap = new Map();
    daySummaries.forEach(day => {
      if (!day.hasMetrics) return;
      const entry = contextMap.get(day.context) || { label: day.context, metricDays: 0, withinTargetDays: 0, exceededDays: 0 };
      entry.metricDays += 1;
      if (day.withinTarget) entry.withinTargetDays += 1;
      if (day.exceededGaps.length) entry.exceededDays += 1;
      contextMap.set(day.context, entry);
    });
    const contexts = [...contextMap.values()]
      .filter(entry => entry.metricDays >= 2)
      .map(entry => ({
        ...entry,
        adherencePct: Math.round((entry.withinTargetDays / entry.metricDays) * 100)
      }))
      .sort((a, b) => b.metricDays - a.metricDays || a.label.localeCompare(b.label));
    return {
      period,
      targetMinutes: goal,
      logs: rangeLogs,
      fuelLogs,
      hydrationLogs,
      sleepyLogs,
      daySummaries,
      activeDays,
      metricDays,
      allGaps,
      exceededGaps,
      coverage: {
        totalDays: period.totalDays,
        loggedDays: activeDays.length,
        loggedPct: Math.round((activeDays.length / period.totalDays) * 100),
        metricDays: metricDays.length,
        limited: activeDays.length < Math.ceil(period.totalDays * .4)
      },
      consistency: {
        avgFuelLogsPerActiveDay: activeDays.length ? fuelLogs.length / activeDays.length : null,
        avgHydrationLogsPerActiveDay: activeDays.length ? hydrationLogs.length / activeDays.length : null,
        daysWithinTarget: metricDays.filter(day => day.withinTarget).length,
        daysExceedingTarget: metricDays.filter(day => day.exceededGaps.length).length,
        targetAdherencePct: metricDays.length ? Math.round((metricDays.filter(day => day.withinTarget).length / metricDays.length) * 100) : null
      },
      fuelling: {
        averageFirstFuelMinutes: average(daySummaries.map(day => day.firstFuel ? minutesIntoDay(day.firstFuel.date) : NaN)),
        averageFinalFuelMinutes: average(daySummaries.map(day => day.finalFuel ? minutesIntoDay(day.finalFuel.date) : NaN)),
        averageGapMinutes: average(allGaps.map(gap => gap.minutes)),
        longestGapMinutes: allGaps.length ? Math.max(...allGaps.map(gap => gap.minutes)) : null,
        gapsExceedingTarget: exceededGaps.length,
        commonGapWindow: commonWindowFromIntervals(exceededGaps.length >= 2 ? exceededGaps : allGaps, { minimumCount: 2 }),
        commonFuellingWindow: commonEventWindow(fuelLogs, isFuelLog, { minimumCount: 2 })
      },
      sleepy: {
        total: sleepyLogs.length,
        averagePerActiveWeek: period.totalDays ? sleepyLogs.length / Math.max(1, period.totalDays / 7) : 0,
        commonWindow: commonEventWindow(sleepyLogs, isSleepyLog, { minimumCount: 2 }),
        afterLongGapCount: sleepyAfterLongGap.length,
        afterLongGapPct: sleepyLogs.length ? Math.round((sleepyAfterLongGap.length / sleepyLogs.length) * 100) : null,
        targetMinutes: goal
      },
      contexts
    };
  }

  function compareNumbers(current, previous, { higherIsBetter = true, threshold = 0 } = {}) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return { trendLabel: "Not enough data", difference: null, direction: "unknown" };
    const raw = current - previous;
    if (Math.abs(raw) < threshold) return { trendLabel: "Stable", difference: raw, direction: "stable" };
    const improved = higherIsBetter ? raw > 0 : raw < 0;
    return { trendLabel: improved ? "Improved" : "Declined", difference: raw, direction: improved ? "improved" : "declined" };
  }

  function buildPreviousComparison(current, previous) {
    return [
      {
        id: "target_adherence",
        label: "Days within target",
        current: current.consistency.targetAdherencePct,
        previous: previous.consistency.targetAdherencePct,
        unit: "%",
        ...compareNumbers(current.consistency.targetAdherencePct, previous.consistency.targetAdherencePct, { higherIsBetter: true, threshold: 5 })
      },
      {
        id: "average_gap",
        label: "Average fuel gap",
        current: current.fuelling.averageGapMinutes,
        previous: previous.fuelling.averageGapMinutes,
        unit: "minutes",
        ...compareNumbers(current.fuelling.averageGapMinutes, previous.fuelling.averageGapMinutes, { higherIsBetter: false, threshold: 15 })
      },
      {
        id: "sleepy_events",
        label: "Sleepy events",
        current: current.sleepy.total,
        previous: previous.sleepy.total,
        unit: "events",
        ...compareNumbers(current.sleepy.total, previous.sleepy.total, { higherIsBetter: false, threshold: 1 })
      },
      {
        id: "coverage",
        label: "Logging coverage",
        current: current.coverage.loggedPct,
        previous: previous.coverage.loggedPct,
        unit: "%",
        ...compareNumbers(current.coverage.loggedPct, previous.coverage.loggedPct, { higherIsBetter: true, threshold: 5 })
      }
    ];
  }

  function executiveSummary(periodSummary, comparison = []) {
    const points = [];
    points.push(`${periodSummary.coverage.loggedDays} of ${periodSummary.coverage.totalDays} days included Fuel Guard logging.`);
    if (Number.isFinite(periodSummary.consistency.targetAdherencePct)) {
      points.push(`Fuel-gap target was met on ${periodSummary.consistency.targetAdherencePct}% of days with enough fuel logs to calculate gaps.`);
    }
    if (periodSummary.fuelling.commonGapWindow) {
      points.push(`${periodSummary.fuelling.commonGapWindow.label} was the most common meaningful fuel-gap window.`);
    }
    const avgGap = comparison.find(item => item.id === "average_gap");
    if (avgGap && avgGap.direction !== "unknown") {
      points.push(`Average fuel-gap duration ${avgGap.direction === "improved" ? "improved" : avgGap.direction === "declined" ? "increased" : "stayed broadly stable"} compared with the previous period.`);
    }
    if (periodSummary.sleepy.total) {
      const sleepyWindow = periodSummary.sleepy.commonWindow?.label ? `, most often around ${periodSummary.sleepy.commonWindow.label}` : "";
      points.push(`${periodSummary.sleepy.total} Sleepy event${periodSummary.sleepy.total === 1 ? " was" : "s were"} recorded${sleepyWindow}.`);
    }
    if (periodSummary.contexts[0]) {
      const lowest = [...periodSummary.contexts].sort((a, b) => a.adherencePct - b.adherencePct)[0];
      points.push(`${lowest.label} days had the lowest fuel-gap target adherence among contexts with enough data.`);
    }
    return points.slice(0, 5);
  }

  function weeklyReportSeries(periodSummary) {
    const weeks = new Map();
    periodSummary.daySummaries.forEach(day => {
      const start = startOfLocalWeek(dateFromKey(day.key));
      const key = dateKey(start);
      const entry = weeks.get(key) || { key, label: formatDateShort(start), metricDays: 0, withinTargetDays: 0, gapMinutes: [], sleepyEvents: 0 };
      if (day.hasMetrics) {
        entry.metricDays += 1;
        if (day.withinTarget) entry.withinTargetDays += 1;
        entry.gapMinutes.push(...day.gaps.map(gap => gap.minutes));
      }
      entry.sleepyEvents += day.sleepy.length;
      weeks.set(key, entry);
    });
    return [...weeks.values()].map(week => ({
      ...week,
      adherencePct: week.metricDays ? Math.round((week.withinTargetDays / week.metricDays) * 100) : null,
      averageGapMinutes: average(week.gapMinutes),
      sleepyEvents: week.sleepyEvents
    }));
  }

  function buildAthleteReviewReport({ athlete = {}, coach = {}, organisationName = "", logs = [], targets = {}, period = reviewPeriodRange(), previousLogs = [], interventions = [], coachNotes = "", generatedAt = new Date() } = {}) {
    const previousPeriod = previousPeriodRange(period);
    const currentSummary = summarisePeriod({ logs, targets, period });
    const previousSummary = summarisePeriod({ logs: previousLogs.length ? previousLogs : logs, targets, period: previousPeriod });
    const comparison = buildPreviousComparison(currentSummary, previousSummary);
    return {
      title: `${period.label} - ${athlete.displayName || athlete.email || "Athlete"}`,
      athleteName: athlete.displayName || athlete.email || "Athlete",
      athleteId: athlete.userId || athlete.user_id || athlete.id || "",
      coachName: coach.displayName || coach.display_name || coach.email || "Coach",
      coachId: coach.userId || coach.user_id || coach.id || "",
      organisationName: organisationName || "",
      generatedAt: (parseDate(generatedAt) || new Date()).toISOString(),
      period: {
        ...period,
        display: formatDateRange(period.start, period.end)
      },
      previousPeriod: {
        ...previousPeriod,
        display: formatDateRange(previousPeriod.start, previousPeriod.end)
      },
      executiveSummary: executiveSummary(currentSummary, comparison),
      coverage: currentSummary.coverage,
      consistency: currentSummary.consistency,
      fuelling: currentSummary.fuelling,
      sleepy: currentSummary.sleepy,
      contexts: currentSummary.contexts,
      comparison,
      weekly: weeklyReportSeries(currentSummary),
      interventions: interventions || [],
      coachNotes: String(coachNotes || "").trim()
    };
  }

  function interventionComparison({ intervention = {}, logs = [], targets = {}, weeks = 4 } = {}) {
    const interventionDate = parseDate(intervention.intervention_date || intervention.interventionDate || intervention.created_at);
    if (!interventionDate) return null;
    const beforeEnd = addDays(startOfLocalDay(dateKey(interventionDate)), -1);
    const beforeStart = addDays(beforeEnd, -(weeks * 7 - 1));
    const afterStart = startOfLocalDay(dateKey(interventionDate));
    const afterEnd = addDays(afterStart, weeks * 7 - 1);
    const before = summarisePeriod({ logs, targets, period: { start: beforeStart, end: endOfLocalDate(beforeEnd), startKey: dateKey(beforeStart), endKey: dateKey(beforeEnd), totalDays: weeks * 7 } });
    const after = summarisePeriod({ logs, targets, period: { start: afterStart, end: endOfLocalDate(afterEnd), startKey: dateKey(afterStart), endKey: dateKey(afterEnd), totalDays: weeks * 7 } });
    if (!before.metricDays.length || !after.metricDays.length) {
      return {
        label: "Not enough before/after data yet.",
        beforePct: before.consistency.targetAdherencePct,
        afterPct: after.consistency.targetAdherencePct,
        direction: "unknown"
      };
    }
    const comparison = compareNumbers(after.consistency.daysExceedingTarget / after.metricDays.length, before.consistency.daysExceedingTarget / before.metricDays.length, { higherIsBetter: false, threshold: .05 });
    return {
      label: comparison.direction === "improved"
        ? "Excessive fuel-gap rate was lower after this intervention."
        : comparison.direction === "declined"
          ? "Excessive fuel-gap rate was higher after this intervention."
          : "Excessive fuel-gap rate was broadly stable after this intervention.",
      beforePct: before.consistency.targetAdherencePct,
      afterPct: after.consistency.targetAdherencePct,
      direction: comparison.direction
    };
  }

  return {
    CHECKIN_NOTE_PREFIX,
    SLEEPY_CHECKIN_TYPE,
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
    formatDateRange,
    logsInRange,
    fuelGapsForDay,
    commonWindowFromIntervals,
    commonEventWindow,
    summarisePeriod,
    buildAthleteReviewReport,
    interventionComparison
  };
});
