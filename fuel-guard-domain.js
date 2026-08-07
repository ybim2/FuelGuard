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
    buildCoachRoster
  };
});
