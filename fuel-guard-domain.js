// Shared Fuel Guard behavioural helpers for athlete and coach-facing views.
(function attachFuelGuardDomain(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FuelGuardDomain = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardDomain() {
  const CHECKIN_NOTE_PREFIX = "fuel_guard_checkin:";
  const CRASH_NOTE = "fuel_guard_event:crash";
  const SLEEPY_CHECKIN_TYPE = "sleepy";
  const DEFAULT_NUDGE_MESSAGE = "Quick Fuel Guard check-in — remember to log when you next fuel.";
  const DEFAULT_MAXIMUM_FUEL_GAP_MINUTES = 180;
  const APPROACHING_WINDOW_MINUTES = 30;
  const CRASH_BUFFER_MINUTES = 40;
  const MIN_TEAM_PERCENT_DENOMINATOR = 5;
  const MIN_TEAM_PATTERN_EVENTS = 3;
  const MIN_TEAM_PATTERN_ATHLETES = 2;
  const MIN_COMPARISON_LOGGED_DAYS = 3;
  const MIN_COMPARISON_METRIC_DAYS = 2;
  const TIME_BANDS = [
    { id: "overnight", label: "00:00-06:00", start: 0, end: 360 },
    { id: "early_morning", label: "06:00-08:00", start: 360, end: 480 },
    { id: "morning", label: "08:00-10:00", start: 480, end: 600 },
    { id: "late_morning", label: "10:00-13:00", start: 600, end: 780 },
    { id: "early_afternoon", label: "13:00-16:00", start: 780, end: 960 },
    { id: "late_afternoon", label: "16:00-18:00", start: 960, end: 1080 },
    { id: "evening", label: "18:00-21:00", start: 1080, end: 1260 },
    { id: "late_evening", label: "21:00-24:00", start: 1260, end: 1440 }
  ];

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

  function formatClockInTimeZone(value, timeZone) {
    const date = parseDate(value);
    if (!date) return "--";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: resolvedTimeZone(timeZone),
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date).replace(/\s/g, " ").toUpperCase();
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

  function resolvedTimeZone(timeZone) {
    const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const candidate = String(timeZone || fallback);
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(new Date());
      return candidate;
    } catch {
      return fallback;
    }
  }

  function zonedDateParts(value, timeZone) {
    const date = parseDate(value);
    if (!date) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: resolvedTimeZone(timeZone),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = Number(part.value);
      return result;
    }, {});
    if (parts.hour === 24) parts.hour = 0;
    return parts;
  }

  function dateKeyInTimeZone(value = new Date(), timeZone) {
    const parts = zonedDateParts(value, timeZone);
    if (!parts) return "";
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function minutesIntoDayInTimeZone(value, timeZone) {
    const parts = zonedDateParts(value, timeZone);
    return parts ? parts.hour * 60 + parts.minute : NaN;
  }

  function validDateKey(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) return "";
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function shiftDateKey(value, days) {
    const key = validDateKey(value);
    if (!key) return "";
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }

  function daysBetweenKeys(startKey, endKey) {
    const start = validDateKey(startKey);
    const end = validDateKey(endKey);
    if (!start || !end || start > end) return 0;
    const [startYear, startMonth, startDay] = start.split("-").map(Number);
    const [endYear, endMonth, endDay] = end.split("-").map(Number);
    return Math.round((Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay)) / 86400000) + 1;
  }

  function dateKeysBetween(startKey, endKey) {
    const count = daysBetweenKeys(startKey, endKey);
    return Array.from({ length: count }, (_value, index) => shiftDateKey(startKey, index));
  }

  function periodDisplay(startKey, endKey) {
    const format = key => {
      const [year, month, day] = key.split("-").map(Number);
      return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
    };
    return `${format(startKey)} - ${format(endKey)}`;
  }

  function periodFromKeys(startKey, endKey, preset = "custom", timeZone) {
    const start = validDateKey(startKey);
    const end = validDateKey(endKey);
    if (!start || !end || start > end) throw new Error("A valid report period is required.");
    return {
      preset,
      startKey: start,
      endKey: end,
      start: dateFromKey(start),
      end: dateFromKey(end),
      totalDays: daysBetweenKeys(start, end),
      days: daysBetweenKeys(start, end),
      display: periodDisplay(start, end),
      timeZone: resolvedTimeZone(timeZone)
    };
  }

  function weeklyReportingPeriod({ now = new Date(), timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const todayKey = dateKeyInTimeZone(now, zone);
    const [year, month, day] = todayKey.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const daysSinceMonday = (weekday + 6) % 7;
    const currentMonday = shiftDateKey(todayKey, -daysSinceMonday);
    return periodFromKeys(shiftDateKey(currentMonday, -7), shiftDateKey(currentMonday, -1), "weekly", zone);
  }

  function reviewPeriodRange({ preset = "12_weeks", customStart, customEnd, now = new Date(), timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const todayKey = dateKeyInTimeZone(now, zone);
    if (preset === "custom") {
      const endKey = validDateKey(customEnd) || todayKey;
      const startKey = validDateKey(customStart) || endKey;
      return periodFromKeys(startKey <= endKey ? startKey : endKey, startKey <= endKey ? endKey : startKey, "custom", zone);
    }
    if (preset === "season") {
      return periodFromKeys(`${todayKey.slice(0, 4)}-01-01`, todayKey, "season", zone);
    }
    const weeks = Number(String(preset).match(/^(\d+)_weeks$/)?.[1]) || 12;
    return periodFromKeys(shiftDateKey(todayKey, -(weeks * 7 - 1)), todayKey, `${weeks}_weeks`, zone);
  }

  function previousPeriodRange(period) {
    const days = daysBetweenKeys(period?.startKey, period?.endKey);
    if (!days) throw new Error("A valid current period is required.");
    const endKey = shiftDateKey(period.startKey, -1);
    return periodFromKeys(shiftDateKey(endKey, -(days - 1)), endKey, period.preset || "custom", period.timeZone);
  }

  function zonedDateTimeToUtc(key, timeZone, hour = 0, minute = 0) {
    const validKey = validDateKey(key);
    if (!validKey) return null;
    const zone = resolvedTimeZone(timeZone);
    const [year, month, day] = validKey.split("-").map(Number);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    let guess = desired;
    for (let index = 0; index < 4; index += 1) {
      const parts = zonedDateParts(new Date(guess), zone);
      const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
      const adjustment = desired - represented;
      guess += adjustment;
      if (!adjustment) break;
    }
    return new Date(guess);
  }

  function periodQueryBounds(period, timeZone = period?.timeZone) {
    return {
      start: zonedDateTimeToUtc(period.startKey, timeZone),
      endExclusive: zonedDateTimeToUtc(shiftDateKey(period.endKey, 1), timeZone)
    };
  }

  function timeBandForMinutes(minutes) {
    if (!Number.isFinite(minutes)) return null;
    const normalized = ((Math.floor(minutes) % 1440) + 1440) % 1440;
    return TIME_BANDS.find(band => normalized >= band.start && normalized < band.end) || TIME_BANDS[0];
  }

  function gapWindow(gap) {
    const startBand = timeBandForMinutes(gap.startMinute);
    const endBand = timeBandForMinutes(gap.endMinute);
    if (!startBand || !endBand) return null;
    return {
      id: `${startBand.id}_${endBand.id}`,
      label: `${startBand.label.split("-")[0]}-${endBand.label.split("-")[1]}`,
      startBand,
      endBand
    };
  }

  function mostCommonWindow(items = [], windowForItem = item => item.window) {
    const groups = new Map();
    items.forEach(item => {
      const window = windowForItem(item);
      if (!window) return;
      const current = groups.get(window.id) || { ...window, count: 0, items: [] };
      current.count += 1;
      current.items.push(item);
      groups.set(window.id, current);
    });
    return [...groups.values()].sort((a, b) => b.count - a.count || a.startBand?.start - b.startBand?.start || a.label.localeCompare(b.label))[0] || null;
  }

  function contextLabel(value) {
    const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (!normalized) return "Normal";
    if (/travel|flight|away/.test(normalized)) return "Travel";
    if (/work|shift/.test(normalized)) return "Shift";
    if (/train|match|game|competition/.test(normalized)) return "Training";
    if (/rest|recovery|off/.test(normalized)) return "Rest";
    return normalized.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
  }

  function athleteIdFor(value) {
    return String(value?.userId || value?.user_id || value?.id || "");
  }

  function periodLogs(logs, period, timeZone) {
    const zone = resolvedTimeZone(timeZone || period?.timeZone);
    return logsWithDates(logs).filter(log => {
      const key = dateKeyInTimeZone(log.date, zone);
      return key >= period.startKey && key <= period.endKey;
    });
  }

  function athletePeriodMetrics({ athlete = {}, logs = [], targets = {}, period, timeZone, eligibleStartKey } = {}) {
    if (!period?.startKey || !period?.endKey) throw new Error("A report period is required.");
    const zone = resolvedTimeZone(timeZone || period.timeZone);
    const athleteId = athleteIdFor(athlete);
    const scopedLogs = periodLogs(logs, period, zone).filter(log => !athleteId || String(log.userId || "") === athleteId);
    const targetMinutes = maximumFuelGapMinutes(targets);
    const firstEligibleKey = validDateKey(eligibleStartKey) || validDateKey(athlete.sharingStartedKey) || (athlete.sharingStartedAt ? dateKeyInTimeZone(athlete.sharingStartedAt, zone) : period.startKey);
    const eligibilityStart = firstEligibleKey > period.startKey ? firstEligibleKey : period.startKey;
    const eligibleKeys = eligibilityStart <= period.endKey ? dateKeysBetween(eligibilityStart, period.endKey) : [];
    const byDay = new Map(eligibleKeys.map(key => [key, []]));
    scopedLogs.forEach(log => {
      const key = dateKeyInTimeZone(log.date, zone);
      if (byDay.has(key)) byDay.get(key).push(log);
    });

    const gaps = [];
    const days = eligibleKeys.map(key => {
      const dayLogs = (byDay.get(key) || []).sort((a, b) => a.date - b.date);
      const fuelLogs = dayLogs.filter(isFuelLog);
      const hydrationLogs = dayLogs.filter(isHydrationLog);
      const sleepyLogs = dayLogs.filter(isSleepyLog);
      const dayGaps = [];
      for (let index = 1; index < fuelLogs.length; index += 1) {
        const start = fuelLogs[index - 1];
        const end = fuelLogs[index];
        const minutes = (end.date - start.date) / 60000;
        if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1080) continue;
        const gap = {
          athleteId,
          key,
          start,
          end,
          minutes,
          startMinute: minutesIntoDayInTimeZone(start.date, zone),
          endMinute: minutesIntoDayInTimeZone(end.date, zone)
        };
        gap.window = gapWindow(gap);
        gap.exceededTarget = minutes > targetMinutes;
        dayGaps.push(gap);
        gaps.push(gap);
      }
      const metricDay = fuelLogs.length >= 2;
      const exceededTarget = metricDay && dayGaps.some(gap => gap.exceededTarget);
      const rawContext = dayLogs.find(log => log.dayType)?.dayType || dayLogs.find(log => log.trainingSession)?.trainingSession || "";
      return {
        key,
        logs: dayLogs,
        fuelLogs,
        hydrationLogs,
        sleepyLogs,
        logged: dayLogs.length > 0,
        metricDay,
        exceededTarget,
        withinTarget: metricDay ? !exceededTarget : null,
        gaps: dayGaps,
        context: contextLabel(rawContext),
        firstFuelMinute: fuelLogs[0] ? minutesIntoDayInTimeZone(fuelLogs[0].date, zone) : null,
        finalFuelMinute: fuelLogs.length ? minutesIntoDayInTimeZone(fuelLogs[fuelLogs.length - 1].date, zone) : null
      };
    });

    const loggedDays = days.filter(day => day.logged).length;
    const metricDays = days.filter(day => day.metricDay);
    const daysWithinTarget = metricDays.filter(day => day.withinTarget).length;
    const daysExceedingTarget = metricDays.length - daysWithinTarget;
    const fuelLogs = scopedLogs.filter(isFuelLog);
    const hydrationLogs = scopedLogs.filter(isHydrationLog);
    const sleepyLogs = scopedLogs.filter(isSleepyLog);
    const exceededGaps = gaps.filter(gap => gap.exceededTarget);
    const relevantGaps = exceededGaps.length ? exceededGaps : gaps;
    const commonGapWindow = mostCommonWindow(relevantGaps);
    const commonFuellingWindow = mostCommonWindow(fuelLogs.map(log => {
      const band = timeBandForMinutes(minutesIntoDayInTimeZone(log.date, zone));
      return { log, window: band ? { ...band, startBand: band, endBand: band } : null };
    }));
    const sleepyWindow = mostCommonWindow(sleepyLogs.map(log => {
      const band = timeBandForMinutes(minutesIntoDayInTimeZone(log.date, zone));
      return { log, window: band ? { ...band, startBand: band, endBand: band } : null };
    }));
    const sleepyAfterLongGap = sleepyLogs.filter(sleepyLog => {
      const sleepyKey = dateKeyInTimeZone(sleepyLog.date, zone);
      const priorFuel = fuelLogs.filter(log => dateKeyInTimeZone(log.date, zone) === sleepyKey && log.date < sleepyLog.date).sort((a, b) => b.date - a.date)[0];
      return priorFuel && (sleepyLog.date - priorFuel.date) / 60000 > targetMinutes;
    });
    const average = values => {
      const finite = values.filter(Number.isFinite);
      return finite.length ? finite.reduce((total, value) => total + value, 0) / finite.length : null;
    };
    const contexts = [...new Set(days.filter(day => day.metricDay).map(day => day.context))].map(label => {
      const contextDays = days.filter(day => day.metricDay && day.context === label);
      const within = contextDays.filter(day => day.withinTarget).length;
      return {
        label,
        metricDays: contextDays.length,
        daysWithinTarget: within,
        daysExceedingTarget: contextDays.length - within,
        adherencePct: contextDays.length ? Math.round(within / contextDays.length * 100) : null,
        athleteIds: athleteId ? [athleteId] : []
      };
    }).filter(context => context.metricDays >= 2).sort((a, b) => b.metricDays - a.metricDays || a.label.localeCompare(b.label));

    return {
      athlete,
      athleteId,
      period,
      timeZone: zone,
      targetMinutes,
      days,
      logs: scopedLogs,
      fuelLogs,
      hydrationLogs,
      sleepyLogs,
      gaps,
      exceededGaps,
      coverage: {
        totalDays: eligibleKeys.length,
        eligibleDays: eligibleKeys.length,
        loggedDays,
        loggedPct: eligibleKeys.length ? Math.round(loggedDays / eligibleKeys.length * 100) : null,
        metricDays: metricDays.length,
        limited: eligibleKeys.length < 3 || loggedDays < Math.min(3, eligibleKeys.length)
      },
      consistency: {
        avgFuelLogsPerActiveDay: loggedDays ? fuelLogs.length / loggedDays : null,
        avgHydrationLogsPerActiveDay: loggedDays ? hydrationLogs.length / loggedDays : null,
        daysWithinTarget,
        daysExceedingTarget,
        targetAdherencePct: metricDays.length ? Math.round(daysWithinTarget / metricDays.length * 100) : null
      },
      fuelling: {
        averageFirstFuelMinutes: average(days.map(day => day.firstFuelMinute)),
        averageFinalFuelMinutes: average(days.map(day => day.finalFuelMinute)),
        averageGapMinutes: average(gaps.map(gap => gap.minutes)),
        longestGapMinutes: gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : null,
        gapsExceedingTarget: exceededGaps.length,
        commonGapWindow,
        commonFuellingWindow
      },
      sleepy: {
        total: sleepyLogs.length,
        averagePerActiveWeek: loggedDays ? sleepyLogs.length / Math.max(1, Math.ceil(daysBetweenKeys(period.startKey, period.endKey) / 7)) : null,
        commonWindow: sleepyWindow,
        afterLongGapCount: sleepyAfterLongGap.length,
        afterLongGapPct: sleepyLogs.length ? Math.round(sleepyAfterLongGap.length / sleepyLogs.length * 100) : null,
        targetMinutes
      },
      contexts
    };
  }

  function compareMetric({ id, label, current, previous, unit = "", lowerIsBetter = false, threshold = 1 } = {}) {
    const enough = Number.isFinite(current) && Number.isFinite(previous);
    if (!enough) return { id, label, current, previous, unit, difference: null, direction: "insufficient", trendLabel: "Not enough data" };
    const difference = current - previous;
    let direction = "stable";
    if (Math.abs(difference) >= threshold) direction = lowerIsBetter ? (difference < 0 ? "improved" : "declined") : (difference > 0 ? "improved" : "declined");
    return { id, label, current, previous, unit, difference, direction, trendLabel: direction === "improved" ? "Improved" : direction === "declined" ? "Deteriorated" : "Stable" };
  }

  function athleteTrend(current, previous) {
    const enough = current.coverage.loggedDays >= MIN_COMPARISON_LOGGED_DAYS
      && previous.coverage.loggedDays >= MIN_COMPARISON_LOGGED_DAYS
      && current.coverage.metricDays >= MIN_COMPARISON_METRIC_DAYS
      && previous.coverage.metricDays >= MIN_COMPARISON_METRIC_DAYS;
    if (!enough) return { direction: "insufficient", label: "Not enough comparable data" };
    const adherenceChange = current.consistency.targetAdherencePct - previous.consistency.targetAdherencePct;
    if (Math.abs(adherenceChange) >= 15) {
      return {
        direction: adherenceChange > 0 ? "improved" : "deteriorated",
        label: `${Math.abs(Math.round(adherenceChange))} percentage-point ${adherenceChange > 0 ? "improvement" : "deterioration"} in target adherence`
      };
    }
    const gapChange = current.fuelling.averageGapMinutes - previous.fuelling.averageGapMinutes;
    if (Number.isFinite(gapChange) && Math.abs(gapChange) >= 30) {
      return {
        direction: gapChange < 0 ? "improved" : "deteriorated",
        label: `Average fuel gaps were ${duration(Math.abs(gapChange))} ${gapChange < 0 ? "shorter" : "longer"}`
      };
    }
    return { direction: "stable", label: "No material week-to-week change" };
  }

  function weeklyRollups(metrics) {
    const starts = [];
    for (let key = metrics.period.startKey; key <= metrics.period.endKey; key = shiftDateKey(key, 7)) starts.push(key);
    return starts.map(startKey => {
      const endKey = shiftDateKey(startKey, 6) < metrics.period.endKey ? shiftDateKey(startKey, 6) : metrics.period.endKey;
      const days = metrics.days.filter(day => day.key >= startKey && day.key <= endKey);
      const gaps = days.flatMap(day => day.gaps);
      return {
        startKey,
        endKey,
        label: periodDisplay(startKey, endKey),
        averageGapMinutes: gaps.length ? gaps.reduce((sum, gap) => sum + gap.minutes, 0) / gaps.length : null,
        sleepyEvents: days.reduce((sum, day) => sum + day.sleepyLogs.length, 0),
        loggedDays: days.filter(day => day.logged).length
      };
    });
  }

  function buildAthleteReviewReport({ athlete = {}, coach = {}, organisationName = "", logs = [], previousLogs = [], targets = {}, period, interventions = [], coachNotes = "", generatedAt = new Date(), timeZone } = {}) {
    const current = athletePeriodMetrics({ athlete, logs, targets, period, timeZone });
    const previousPeriod = previousPeriodRange(period);
    const previous = athletePeriodMetrics({ athlete, logs: previousLogs, targets, period: previousPeriod, timeZone });
    const comparison = [
      compareMetric({ id: "logging_coverage", label: "Logging coverage", current: current.coverage.loggedPct, previous: previous.coverage.loggedPct, unit: "%", threshold: 10 }),
      compareMetric({ id: "target_adherence", label: "Target adherence", current: current.consistency.targetAdherencePct, previous: previous.consistency.targetAdherencePct, unit: "%", threshold: 10 }),
      compareMetric({ id: "average_gap", label: "Average fuel gap", current: current.fuelling.averageGapMinutes, previous: previous.fuelling.averageGapMinutes, unit: "minutes", lowerIsBetter: true, threshold: 15 }),
      compareMetric({ id: "sleepy_events", label: "Sleepy events", current: current.sleepy.total, previous: previous.sleepy.total, unit: "events", lowerIsBetter: true, threshold: 2 })
    ];
    const executiveSummary = [];
    if (!current.coverage.totalDays || !current.coverage.loggedDays) {
      executiveSummary.push("No shared logs were available for this reporting period.");
    } else {
      executiveSummary.push(`Logging was present on ${current.coverage.loggedDays} of ${current.coverage.totalDays} days (${current.coverage.loggedPct}%).`);
    }
    if (current.coverage.metricDays) {
      executiveSummary.push(`Fuel-gap target was met on ${current.consistency.targetAdherencePct}% of ${current.coverage.metricDays} measurable days.`);
    } else {
      executiveSummary.push("Not enough days had two fuel logs to calculate gap-target adherence.");
    }
    if (current.fuelling.commonGapWindow && current.fuelling.commonGapWindow.count >= 2) {
      executiveSummary.push(`${current.fuelling.commonGapWindow.label} was the most repeated fuel-gap window (${current.fuelling.commonGapWindow.count} observed gaps).`);
    }
    if (current.sleepy.total) {
      executiveSummary.push(`${current.sleepy.total} Sleepy event${current.sleepy.total === 1 ? " was" : "s were"} logged; these are observational markers, not a medical interpretation.`);
    }
    return {
      title: `Athlete Review Report - ${athlete.displayName || athlete.email || "Fuel Guard Athlete"}`,
      athleteName: athlete.displayName || athlete.email || "Fuel Guard Athlete",
      coachName: coach.display_name || coach.displayName || coach.email || "Fuel Guard Coach",
      organisationName,
      generatedAt,
      period,
      previousPeriod,
      targetMinutes: current.targetMinutes,
      coverage: current.coverage,
      consistency: current.consistency,
      fuelling: current.fuelling,
      sleepy: current.sleepy,
      contexts: current.contexts,
      weekly: weeklyRollups(current),
      comparison,
      executiveSummary,
      interventions: (interventions || []).filter(intervention => {
        const key = validDateKey(intervention.intervention_date) || dateKeyInTimeZone(intervention.created_at, current.timeZone);
        return !key || (key >= period.startKey && key <= period.endKey);
      }),
      coachNotes: String(coachNotes || "").trim(),
      timeZone: current.timeZone,
      metrics: current
    };
  }

  function interventionComparison({ intervention = {}, logs = [], targets = {}, weeks = 4, timeZone } = {}) {
    const interventionKey = validDateKey(intervention.intervention_date) || dateKeyInTimeZone(intervention.created_at, timeZone);
    if (!interventionKey) return { direction: "insufficient", enoughData: false, label: "Not enough dated information to compare this intervention." };
    const days = Math.max(7, Number(intervention.review_window_days) || Number(weeks || 4) * 7);
    const beforePeriod = periodFromKeys(shiftDateKey(interventionKey, -days), shiftDateKey(interventionKey, -1), "intervention_before", timeZone);
    const afterPeriod = periodFromKeys(interventionKey, shiftDateKey(interventionKey, days - 1), "intervention_after", timeZone);
    const athlete = { userId: intervention.athlete_id || "" };
    const before = athletePeriodMetrics({ athlete, logs, targets, period: beforePeriod, timeZone });
    const after = athletePeriodMetrics({ athlete, logs, targets, period: afterPeriod, timeZone });
    if (!Number.isFinite(before.fuelling.averageGapMinutes) || !Number.isFinite(after.fuelling.averageGapMinutes)) {
      return {
        direction: "insufficient",
        enoughData: false,
        windowDays: days,
        beforePeriod,
        afterPeriod,
        before,
        after,
        label: "Not enough comparable fuel-gap data before and after this intervention."
      };
    }
    const difference = after.fuelling.averageGapMinutes - before.fuelling.averageGapMinutes;
    const direction = Math.abs(difference) < 15 ? "stable" : difference < 0 ? "improved" : "declined";
    const wording = direction === "stable" ? "similar before and after" : `${duration(Math.abs(difference))} ${difference < 0 ? "lower" : "higher"} after`;
    return {
      direction,
      enoughData: true,
      windowDays: days,
      beforePeriod,
      afterPeriod,
      difference,
      before,
      after,
      label: `Average fuel gaps were ${wording} this intervention. This is an observed association and does not establish a cause.`
    };
  }

  function authorizedAthletes({ athletes = [], relationships, coachId, athleteIds } = {}) {
    let allowed = null;
    if (Array.isArray(relationships)) {
      allowed = new Set(relationships.filter(relationship => relationship.status === "active" && (!coachId || String(relationship.coach_id || relationship.coachId) === String(coachId))).map(relationship => String(relationship.athlete_id || relationship.athleteId || "")));
    }
    if (Array.isArray(athleteIds) && athleteIds.length) {
      const requested = new Set(athleteIds.map(String));
      allowed = allowed ? new Set([...allowed].filter(id => requested.has(id))) : requested;
    }
    const seen = new Set();
    return athletes.filter(athlete => {
      const id = athleteIdFor(athlete);
      if (!id || seen.has(id) || (allowed && !allowed.has(id))) return false;
      seen.add(id);
      return true;
    });
  }

  function teamWindowPattern(events, totalEvents) {
    const common = mostCommonWindow(events);
    if (!common) return null;
    const athleteIds = new Set(common.items.map(item => item.athleteId).filter(Boolean));
    const meaningful = common.count >= MIN_TEAM_PATTERN_EVENTS && athleteIds.size >= MIN_TEAM_PATTERN_ATHLETES;
    return {
      ...common,
      athleteCount: athleteIds.size,
      totalEvents,
      sharePct: totalEvents >= MIN_TEAM_PERCENT_DENOMINATOR ? Math.round(common.count / totalEvents * 100) : null,
      meaningful
    };
  }

  function buildTeamAnalytics({ athletes = [], relationships, coachId, athleteIds, logs = [], targetsByUser = {}, period, comparisonPeriod, timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone || period?.timeZone);
    const scopedAthletes = authorizedAthletes({ athletes, relationships, coachId, athleteIds });
    const allowedIds = new Set(scopedAthletes.map(athleteIdFor));
    const scopedLogs = logsWithDates(logs).filter(log => allowedIds.has(String(log.userId || "")));
    const summaries = scopedAthletes.map(athlete => athletePeriodMetrics({
      athlete,
      logs: scopedLogs,
      targets: targetsByUser[athleteIdFor(athlete)] || {},
      period,
      timeZone: zone
    }));
    const previousSummaries = comparisonPeriod ? scopedAthletes.map(athlete => athletePeriodMetrics({
      athlete,
      logs: scopedLogs,
      targets: targetsByUser[athleteIdFor(athlete)] || {},
      period: comparisonPeriod,
      timeZone: zone
    })) : [];
    const previousById = new Map(previousSummaries.map(summary => [summary.athleteId, summary]));
    const trends = summaries.map(summary => ({ athlete: summary.athlete, athleteId: summary.athleteId, ...athleteTrend(summary, previousById.get(summary.athleteId) || { coverage: {}, consistency: {}, fuelling: {} }) }));
    const eligibleAthleteDays = summaries.reduce((sum, summary) => sum + summary.coverage.eligibleDays, 0);
    const loggedAthleteDays = summaries.reduce((sum, summary) => sum + summary.coverage.loggedDays, 0);
    const metricDays = summaries.flatMap(summary => summary.days.filter(day => day.metricDay).map(day => ({ ...day, athleteId: summary.athleteId })));
    const withinTargetDays = metricDays.filter(day => day.withinTarget).length;
    const exceededGaps = summaries.flatMap(summary => summary.exceededGaps.map(gap => ({ ...gap, athleteId: summary.athleteId })));
    const sleepyEvents = summaries.flatMap(summary => summary.sleepyLogs.map(log => {
      const band = timeBandForMinutes(minutesIntoDayInTimeZone(log.date, zone));
      return { log, athleteId: summary.athleteId, window: band ? { ...band, startBand: band, endBand: band } : null };
    }));
    const commonGapWindow = teamWindowPattern(exceededGaps, exceededGaps.length);
    const commonSleepyWindow = teamWindowPattern(sleepyEvents, sleepyEvents.length);
    const frequentlyExceeded = summaries.filter(summary => summary.coverage.metricDays >= 3 && summary.consistency.daysExceedingTarget >= 2 && summary.consistency.daysExceedingTarget / summary.coverage.metricDays >= 0.5);
    const contextGroups = new Map();
    metricDays.forEach(day => {
      const group = contextGroups.get(day.context) || { label: day.context, metricDays: 0, within: 0, athleteIds: new Set() };
      group.metricDays += 1;
      if (day.withinTarget) group.within += 1;
      group.athleteIds.add(day.athleteId);
      contextGroups.set(day.context, group);
    });
    const contexts = [...contextGroups.values()].map(group => ({
      label: group.label,
      metricDays: group.metricDays,
      athleteCount: group.athleteIds.size,
      adherencePct: group.metricDays ? Math.round(group.within / group.metricDays * 100) : null,
      sufficient: group.metricDays >= MIN_TEAM_PERCENT_DENOMINATOR && group.athleteIds.size >= MIN_TEAM_PATTERN_ATHLETES
    })).sort((a, b) => b.metricDays - a.metricDays || a.label.localeCompare(b.label));
    const travel = contexts.find(context => context.label === "Travel");
    const normal = contexts.find(context => context.label === "Normal");
    const travelComparison = travel?.sufficient && normal?.sufficient ? {
      travelAdherencePct: travel.adherencePct,
      normalAdherencePct: normal.adherencePct,
      differencePoints: travel.adherencePct - normal.adherencePct,
      sampleDays: travel.metricDays + normal.metricDays,
      athleteCount: new Set(metricDays.filter(day => day.context === "Travel" || day.context === "Normal").map(day => day.athleteId)).size
    } : null;
    const improved = trends.filter(trend => trend.direction === "improved");
    const deteriorated = trends.filter(trend => trend.direction === "deteriorated");
    const reviewById = new Map();
    const addReview = (summary, reason) => {
      const existing = reviewById.get(summary.athleteId) || { athlete: summary.athlete, athleteId: summary.athleteId, reasons: [] };
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      reviewById.set(summary.athleteId, existing);
    };
    deteriorated.forEach(trend => addReview(summaries.find(summary => summary.athleteId === trend.athleteId), trend.label));
    frequentlyExceeded.forEach(summary => addReview(summary, `Exceeded the configured gap target on ${summary.consistency.daysExceedingTarget} measurable days`));
    summaries.filter(summary => summary.sleepy.total >= 3 && new Set(summary.sleepyLogs.map(log => dateKeyInTimeZone(log.date, zone))).size >= 2).forEach(summary => addReview(summary, "Repeated Sleepy events across multiple days"));
    summaries.filter(summary => summary.coverage.eligibleDays >= 5 && summary.coverage.loggedPct <= 30).forEach(summary => addReview(summary, "Very limited logging coverage"));
    const patterns = [];
    if (commonGapWindow?.meaningful) {
      patterns.push({
        id: "gap_window",
        kind: "team",
        label: commonGapWindow.sharePct === null
          ? `${commonGapWindow.count} recurring >target gaps started across ${commonGapWindow.label} for ${commonGapWindow.athleteCount} athletes.`
          : `${commonGapWindow.sharePct}% of the squad's >target gaps started across ${commonGapWindow.label} (${commonGapWindow.count} gaps, ${commonGapWindow.athleteCount} athletes).`,
        sample: commonGapWindow.totalEvents
      });
    }
    if (travelComparison && Math.abs(travelComparison.differencePoints) >= 15) {
      patterns.push({
        id: "travel_adherence",
        kind: "team",
        label: `Travel-day target adherence was ${Math.abs(travelComparison.differencePoints)} percentage points ${travelComparison.differencePoints < 0 ? "lower" : "higher"} than normal days across ${travelComparison.sampleDays} measurable athlete-days. This is an association, not evidence of cause.`,
        sample: travelComparison.sampleDays
      });
    }
    if (commonSleepyWindow?.meaningful) {
      patterns.push({
        id: "sleepy_window",
        kind: "team",
        label: commonSleepyWindow.sharePct === null
          ? `${commonSleepyWindow.count} Sleepy events clustered in ${commonSleepyWindow.label} across ${commonSleepyWindow.athleteCount} athletes.`
          : `${commonSleepyWindow.sharePct}% of shared Sleepy events occurred in ${commonSleepyWindow.label} (${commonSleepyWindow.count} events, ${commonSleepyWindow.athleteCount} athletes). No medical cause is inferred.`,
        sample: commonSleepyWindow.totalEvents
      });
    }
    return {
      period,
      timeZone: zone,
      athleteCount: scopedAthletes.length,
      athletes: scopedAthletes,
      summaries,
      loggingCoverage: {
        loggedAthleteDays,
        eligibleAthleteDays,
        pct: eligibleAthleteDays ? Math.round(loggedAthleteDays / eligibleAthleteDays * 100) : null,
        sufficient: eligibleAthleteDays >= MIN_TEAM_PERCENT_DENOMINATOR
      },
      targetAdherence: {
        daysWithinTarget: withinTargetDays,
        metricDays: metricDays.length,
        pct: metricDays.length ? Math.round(withinTargetDays / metricDays.length * 100) : null,
        sufficient: metricDays.length >= MIN_TEAM_PERCENT_DENOMINATOR && new Set(metricDays.map(day => day.athleteId)).size >= MIN_TEAM_PATTERN_ATHLETES
      },
      frequentlyExceeded,
      commonGapWindow,
      commonSleepyWindow,
      contexts,
      travelComparison,
      trends,
      improved,
      deteriorated,
      reviewCandidates: [...reviewById.values()],
      patterns,
      insufficientPatternData: patterns.length === 0
    };
  }

  function buildWeeklyCoachBrief({ now = new Date(), timeZone, ...options } = {}) {
    const period = weeklyReportingPeriod({ now, timeZone });
    const comparisonPeriod = previousPeriodRange(period);
    const analytics = buildTeamAnalytics({ ...options, period, comparisonPeriod, timeZone: period.timeZone });
    return {
      period,
      comparisonPeriod,
      analytics,
      athleteCount: analytics.athleteCount,
      loggingCoveragePct: analytics.loggingCoverage.pct,
      frequentlyExceededCount: analytics.frequentlyExceeded.length,
      biggestGapWindow: analytics.commonGapWindow?.meaningful ? analytics.commonGapWindow : null,
      improvedCount: analytics.improved.length,
      deterioratedCount: analytics.deteriorated.length,
      reviewCount: analytics.reviewCandidates.length,
      limited: analytics.athleteCount < MIN_TEAM_PATTERN_ATHLETES || !analytics.loggingCoverage.sufficient
    };
  }

  function addMonthsClamped(dateKeyValue, months) {
    const key = validDateKey(dateKeyValue);
    if (!key) return "";
    const [year, month, day] = key.split("-").map(Number);
    const monthIndex = month - 1 + Number(months || 0);
    const targetYear = year + Math.floor(monthIndex / 12);
    const targetMonth = ((monthIndex % 12) + 12) % 12;
    const finalDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
    return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(finalDay).padStart(2, "0")}`;
  }

  function reviewScheduleDefinition(type) {
    const definitions = {
      monthly: { id: "monthly", label: "Monthly review", cadence: "monthly", reportPeriod: "4_weeks" },
      "8_week": { id: "8_week", label: "8-week review", cadence: "8_weeks", reportPeriod: "8_weeks" },
      contract: { id: "contract", label: "Contract review", cadence: "none", reportPeriod: "12_weeks" },
      end_of_season: { id: "end_of_season", label: "End-of-season review", cadence: "none", reportPeriod: "season" },
      custom: { id: "custom", label: "Custom review", cadence: "none", reportPeriod: "custom" }
    };
    return definitions[type] || definitions.custom;
  }

  function scheduleDueKey(schedule) {
    return validDateKey(schedule?.next_due_date || schedule?.nextDueDate || schedule?.due_date || schedule?.dueDate);
  }

  function scheduledReviewState(schedule, { now = new Date(), timeZone } = {}) {
    const status = String(schedule?.status || "active");
    const dueKey = scheduleDueKey(schedule);
    if (status === "paused") return { state: "paused", label: "Paused", due: false, dueKey };
    if (status === "completed" || !dueKey) return { state: "completed", label: "Completed", due: false, dueKey };
    const todayKey = dateKeyInTimeZone(now, timeZone);
    if (dueKey <= todayKey) return { state: "due", label: "Review due", due: true, dueKey, daysOffset: daysBetweenKeys(dueKey, todayKey) - 1 };
    return { state: "upcoming", label: "Upcoming", due: false, dueKey, daysOffset: daysBetweenKeys(todayKey, dueKey) - 1 };
  }

  function scheduleCadence(schedule) {
    const explicit = String(schedule?.cadence || "");
    if (explicit) return explicit;
    return reviewScheduleDefinition(schedule?.review_type || schedule?.reviewType).cadence;
  }

  function nextRecurringDueDate(schedule, completedKey) {
    const dueKey = scheduleDueKey(schedule);
    const cadence = scheduleCadence(schedule);
    if (!dueKey || cadence === "none") return null;
    let step = 1;
    let next = "";
    do {
      if (cadence === "monthly") next = addMonthsClamped(dueKey, step);
      else if (cadence === "8_weeks") next = shiftDateKey(dueKey, step * 56);
      else if (cadence === "custom_days") {
        const cadenceDays = Number(schedule?.cadence_days || schedule?.cadenceDays);
        if (!Number.isInteger(cadenceDays) || cadenceDays < 1) return null;
        next = shiftDateKey(dueKey, step * cadenceDays);
      } else return null;
      step += 1;
    } while (next <= completedKey && step < 1000);
    return next || null;
  }

  function completeScheduledReview(schedule, { completedOn = new Date(), timeZone, reportId = null } = {}) {
    const completedKey = validDateKey(completedOn) || dateKeyInTimeZone(completedOn, timeZone);
    const nextDueDate = nextRecurringDueDate(schedule, completedKey);
    return {
      status: nextDueDate ? "active" : "completed",
      next_due_date: nextDueDate,
      last_completed_at: parseDate(completedOn)?.toISOString() || zonedDateTimeToUtc(completedKey, timeZone)?.toISOString(),
      last_report_id: reportId || schedule?.last_report_id || null,
      updated_at: new Date().toISOString()
    };
  }

  function reportPeriodForSchedule(schedule, { timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const dueKey = scheduleDueKey(schedule) || dateKeyInTimeZone(new Date(), zone);
    const explicitStart = validDateKey(schedule?.report_period_start || schedule?.reportPeriodStart);
    const explicitEnd = validDateKey(schedule?.report_period_end || schedule?.reportPeriodEnd);
    if (explicitStart && explicitEnd) return periodFromKeys(explicitStart, explicitEnd, "custom", zone);
    const type = String(schedule?.review_type || schedule?.reviewType || "custom");
    const reportType = String(schedule?.report_period_type || schedule?.reportPeriodType || reviewScheduleDefinition(type).reportPeriod);
    if (type === "monthly") {
      const previousMonthEnd = shiftDateKey(`${dueKey.slice(0, 7)}-01`, -1);
      return periodFromKeys(`${previousMonthEnd.slice(0, 7)}-01`, previousMonthEnd, "custom", zone);
    }
    const endKey = shiftDateKey(dueKey, -1);
    if (reportType === "custom") return periodFromKeys(endKey, endKey, "custom", zone);
    if (reportType === "season") return periodFromKeys(`${endKey.slice(0, 4)}-01-01`, endKey, "season", zone);
    const weeks = Number(reportType.match(/^(\d+)_weeks$/)?.[1]) || 12;
    return periodFromKeys(shiftDateKey(endKey, -(weeks * 7 - 1)), endKey, `${weeks}_weeks`, zone);
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

  function buildCoachAttentionItems({ roster = [], dataHealth = { items: [] }, interventions = [], trainingContext = [], actions = [], now = new Date(), includeResolved = false } = {}) {
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
        : health.id === "no_logs_today"
          ? `no_logs_today:${key}:${occurrenceToken(health.lastLogAt || "never")}`
          : `${health.id}:${occurrenceToken(health.lastLogAt || "never")}`;
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
    (trainingContext || []).forEach(context => {
      const athleteId = String(context.athlete_id || context.athleteId || "");
      const athlete = rosterByAthlete.get(athleteId);
      const startsAt = parseDate(context.starts_at || context.startsAt);
      const gapStatus = String(context.gap_status || context.gapStatus || "");
      if (!athlete || !startsAt || startsAt < now || startsAt - now > 6 * 60 * 60 * 1000) return;
      if (!["exceeded", "close", "no_prior_fuel"].includes(gapStatus)) return;
      const label = gapStatus === "exceeded"
        ? "Upcoming session: gap target exceeded"
        : gapStatus === "close"
          ? "Upcoming session: gap target approaching"
          : "Upcoming session: no prior fuel log";
      const sessionLabel = context.session_name || context.sessionName || context.session_type || context.sessionType || "Training session";
      const contextTimeZone = context.timezone_name || context.timeZone;
      const detail = `${sessionLabel} at ${formatClockInTimeZone(startsAt, contextTimeZone)}${contextTimeZone ? ` ${contextTimeZone}` : ""}. ${gapStatus === "no_prior_fuel" ? "No prior shared fuel log is available." : `Projected gap at session start: ${duration(Number(context.gap_minutes_at_start ?? context.gapMinutesAtStart))}.`} This is schedule context only; the athlete's target is unchanged.`;
      add(attentionItem({
        athlete,
        type: `training_${gapStatus}`,
        category: gapStatus === "close" ? "approaching_gap" : "need_attention",
        label,
        detail,
        priority: gapStatus === "exceeded" ? 95 : gapStatus === "close" ? 75 : 55,
        occurrenceKey: `training:${occurrenceToken(context.session_id || context.sessionId)}:${gapStatus}:${occurrenceToken(context.last_fuel_at || context.lastFuelAt || "never")}`,
        canNudge: true
      }));
    });
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
    formatClockInTimeZone,
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
    TIME_BANDS,
    resolvedTimeZone,
    zonedDateParts,
    dateKeyInTimeZone,
    minutesIntoDayInTimeZone,
    validDateKey,
    shiftDateKey,
    daysBetweenKeys,
    dateKeysBetween,
    periodFromKeys,
    weeklyReportingPeriod,
    reviewPeriodRange,
    previousPeriodRange,
    periodQueryBounds,
    zonedDateTimeToUtc,
    timeBandForMinutes,
    gapWindow,
    athletePeriodMetrics,
    athleteTrend,
    buildAthleteReviewReport,
    interventionComparison,
    authorizedAthletes,
    buildTeamAnalytics,
    buildWeeklyCoachBrief,
    addMonthsClamped,
    reviewScheduleDefinition,
    scheduledReviewState,
    completeScheduledReview,
    reportPeriodForSchedule,
    buildTeamDataHealth,
    buildCoachAttentionItems,
    attentionSummary
  };
});
