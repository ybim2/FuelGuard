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
  const PERFORMANCE_IMPACT_RULES = Object.freeze({
    comparisonWindowDays: 14,
    sixWeekDays: 42,
    minimumGapDaysPerWindow: 5,
    minimumSessionsPerWindow: 3,
    minimumFeedbackPerWindow: 3,
    minimumOutcomeSeparationDays: 14,
    coverageDirectionPoints: 10,
    trainingCoverageDirectionPoints: 15,
    feedbackDirectionPoints: 15,
    maximumGapDirectionMinutes: 15,
    longGapRelativeDirection: 0.25,
    outcomeRelativeStability: 0.01,
    outcomeAbsoluteStability: 0.01
  });
  const MILESTONE_THRESHOLDS = Object.freeze({
    streak: Object.freeze([3, 5, 7, 14, 30, 50, 100]),
    fuel: Object.freeze([10, 25, 50, 100, 250, 500, 1000]),
    hydration: Object.freeze([10, 25, 50, 100, 250, 500, 1000])
  });
  const ATHLETE_POINT_MILESTONES = Object.freeze([
    Object.freeze({ eventType: "athlete_streak_3", category: "streak", threshold: 3, points: 25, title: "3-day streak" }),
    Object.freeze({ eventType: "athlete_streak_7", category: "streak", threshold: 7, points: 50, title: "7-day streak" }),
    Object.freeze({ eventType: "athlete_streak_30", category: "streak", threshold: 30, points: 150, title: "30-day streak" }),
    Object.freeze({ eventType: "athlete_fuel_25", category: "fuel", threshold: 25, points: 25, title: "25 fuel moments" }),
    Object.freeze({ eventType: "athlete_fuel_100", category: "fuel", threshold: 100, points: 75, title: "100 fuel moments" }),
    Object.freeze({ eventType: "athlete_fuel_250", category: "fuel", threshold: 250, points: 150, title: "250 fuel moments" })
  ]);
  const ATHLETE_POINT_LEVELS = Object.freeze([
    Object.freeze({ key: "started", title: "Started", threshold: 0 }),
    Object.freeze({ key: "building", title: "Building consistency", threshold: 250 }),
    Object.freeze({ key: "established", title: "Established routine", threshold: 500 }),
    Object.freeze({ key: "endurance", title: "Endurance standard", threshold: 1000 }),
    Object.freeze({ key: "advanced", title: "Advanced consistency", threshold: 2000 })
  ]);
  const TRAINING_QUANTITY_FIELDS = Object.freeze(["carbsG", "fluidMl", "sodiumMg", "caffeineMg"]);
  const TRAINING_QUANTITY_LIMITS = Object.freeze({
    carbsG: 500,
    fluidMl: 5000,
    sodiumMg: 10000,
    caffeineMg: 1000
  });
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
      trainingModeSessionId: row?.training_mode_session_id || row?.trainingModeSessionId || "",
      trainingModePresetId: row?.training_mode_preset_id || row?.trainingModePresetId || "",
      carbsG: row?.carbs_g ?? row?.carbsG ?? null,
      fluidMl: row?.fluid_ml ?? row?.fluidMl ?? null,
      sodiumMg: row?.sodium_mg ?? row?.sodiumMg ?? null,
      caffeineMg: row?.caffeine_mg ?? row?.caffeineMg ?? null,
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

  function workoutAthleteId(workout = {}) {
    return String(workout.athleteId || workout.athlete_id || workout.userId || workout.user_id || "");
  }

  function normalizeWorkout(row = {}) {
    const startAt = parseDate(row.startAt || row.start_at || row.startedAt || row.started_at || row.startTime || row.start_time);
    const suppliedEnd = parseDate(row.endAt || row.end_at || row.endedAt || row.ended_at || row.endTime || row.end_time);
    const suppliedDuration = Number(row.durationSeconds ?? row.duration_seconds ?? row.duration);
    const endAt = suppliedEnd || (startAt && Number.isFinite(suppliedDuration) && suppliedDuration > 0
      ? new Date(startAt.getTime() + suppliedDuration * 1000)
      : null);
    if (!startAt || !endAt || endAt <= startAt) return null;

    const rawSource = String(row.sourceProvider || row.source_provider || row.source || "manual").trim().toLowerCase();
    const source = rawSource.includes("garmin") ? "garmin" : rawSource || "manual";
    const sourceActivityId = String(
      row.sourceActivityId
      || row.source_activity_id
      || row.externalSessionId
      || row.external_session_id
      || ""
    );
    const id = String(row.id || sourceActivityId || `${source}:${startAt.toISOString()}`);
    const type = String(
      row.type
      || row.activityType
      || row.activity_type
      || row.sessionType
      || row.session_type
      || "training"
    ).trim() || "training";
    const title = String(row.title || row.name || row.sessionName || row.session_name || "").trim();

    return {
      id,
      athleteId: workoutAthleteId(row),
      source,
      sourceActivityId,
      type,
      title,
      startAt,
      endAt,
      durationSeconds: Math.round((endAt - startAt) / 1000),
      timeZone: String(row.timeZone || row.timezone || row.timezoneName || row.timezone_name || ""),
      raw: row
    };
  }

  function workoutDedupeKey(workout) {
    const athleteId = workoutAthleteId(workout);
    if (workout.sourceActivityId) return `${athleteId}|${workout.source}|external:${workout.sourceActivityId}`;
    return [
      athleteId,
      workout.source,
      workout.startAt.toISOString(),
      workout.type.toLowerCase(),
      workout.durationSeconds
    ].join("|");
  }

  function comparableActivityType(value) {
    const type = String(value || "training").trim().toLowerCase();
    if (/ride|cycling|bike|biking/.test(type)) return "bike";
    if (/run|running|jog/.test(type)) return "run";
    if (/swim/.test(type)) return "swim";
    if (/triathlon|brick/.test(type)) return "multisport";
    return type.replace(/[^a-z0-9]+/g, "_") || "training";
  }

  function crossProviderActivityMatch(left, right) {
    if (!left || !right) return false;
    if (!left.athleteId || left.athleteId !== right.athleteId) return false;
    if (!left.source || !right.source || left.source === right.source) return false;
    if (comparableActivityType(left.type) !== comparableActivityType(right.type)) return false;
    const startDifference = Math.abs(left.startAt - right.startAt) / 1000;
    const durationDifference = Math.abs(left.durationSeconds - right.durationSeconds);
    const durationTolerance = Math.max(120, Math.min(left.durationSeconds, right.durationSeconds) * 0.05);
    return startDifference <= 120 && durationDifference <= durationTolerance;
  }

  function normalizeWorkouts(workouts = []) {
    const unique = new Map();
    (Array.isArray(workouts) ? workouts : []).forEach(row => {
      const workout = normalizeWorkout(row);
      if (!workout) return;
      const key = workoutDedupeKey(workout);
      if (unique.has(key)) return;
      const providerDuplicate = [...unique.values()].some(candidate => crossProviderActivityMatch(candidate, workout));
      if (!providerDuplicate) unique.set(key, workout);
    });
    return Array.from(unique.values()).sort((a, b) => b.startAt - a.startAt || String(a.id).localeCompare(String(b.id)));
  }

  function lowerBoundFuel(logs, timestamp) {
    let low = 0;
    let high = logs.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (logs[middle].date.getTime() < timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function upperBoundFuel(logs, timestamp) {
    let low = 0;
    let high = logs.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (logs[middle].date.getTime() <= timestamp) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function getWorkoutFuelContexts(workouts = [], fuelEvents = []) {
    const normalizedWorkouts = normalizeWorkouts(workouts);
    const athleteIds = new Set(normalizedWorkouts.map(workout => workout.athleteId).filter(Boolean));
    const allowUnscopedFuel = athleteIds.size <= 1;
    const fuelByAthlete = new Map();
    const allFuel = [];

    logsWithDates(fuelEvents).filter(isFuelLog).forEach(log => {
      allFuel.push(log);
      const athleteId = String(log.userId || "");
      if (!athleteId && !allowUnscopedFuel) return;
      const key = athleteId || "__unscoped__";
      if (!fuelByAthlete.has(key)) fuelByAthlete.set(key, []);
      fuelByAthlete.get(key).push(log);
    });

    return normalizedWorkouts.map(workout => {
      const scoped = !workout.athleteId && allowUnscopedFuel
        ? allFuel
        : allowUnscopedFuel
          ? [...(fuelByAthlete.get(workout.athleteId) || []), ...(fuelByAthlete.get("__unscoped__") || [])].sort((a, b) => a.date - b.date)
          : fuelByAthlete.get(workout.athleteId) || [];
      const startMs = workout.startAt.getTime();
      const endMs = workout.endAt.getTime();
      const previousIndex = lowerBoundFuel(scoped, startMs) - 1;
      const nextIndex = upperBoundFuel(scoped, endMs);
      const previousFuelEvent = previousIndex >= 0 ? scoped[previousIndex] : null;
      const nextFuelEvent = nextIndex < scoped.length ? scoped[nextIndex] : null;
      return {
        workout,
        athleteId: workout.athleteId,
        previousFuelEvent,
        nextFuelEvent,
        preFuelGapMinutes: previousFuelEvent ? Math.round((startMs - previousFuelEvent.date.getTime()) / 60000) : null,
        postFuelGapMinutes: nextFuelEvent ? Math.round((nextFuelEvent.date.getTime() - endMs) / 60000) : null,
        hasPreviousFuel: Boolean(previousFuelEvent),
        hasPostFuel: Boolean(nextFuelEvent)
      };
    });
  }

  function getWorkoutFuelContext(workout, fuelEvents = []) {
    return getWorkoutFuelContexts([workout], fuelEvents)[0] || null;
  }

  function averageFinite(values = []) {
    const finite = values.map(Number).filter(Number.isFinite);
    return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
  }

  function aggregateWorkoutFuelContexts(contexts = [], { targetMinutes, timeZone, minimumSamples = 2 } = {}) {
    const valid = (Array.isArray(contexts) ? contexts : []).filter(context => context?.workout?.startAt && context?.workout?.endAt);
    const preGaps = valid.map(context => context.preFuelGapMinutes).filter(Number.isFinite);
    const postGaps = valid.map(context => context.postFuelGapMinutes).filter(Number.isFinite);
    const zone = resolvedTimeZone(timeZone);
    const postFuelSameDay = context => context.nextFuelEvent
      && dateKeyInTimeZone(context.nextFuelEvent.date, zone) === dateKeyInTimeZone(context.workout.endAt, zone);
    const configuredTarget = Number(targetMinutes);
    const extended = Number.isFinite(configuredTarget) && configuredTarget > 0
      ? valid.filter(context => Number.isFinite(context.preFuelGapMinutes) && context.preFuelGapMinutes > configuredTarget)
      : [];
    const evening = valid.filter(context => minutesIntoDayInTimeZone(context.workout.startAt, zone) >= 18 * 60);
    const other = valid.filter(context => minutesIntoDayInTimeZone(context.workout.startAt, zone) < 18 * 60);
    const eveningAverage = averageFinite(evening.map(context => context.preFuelGapMinutes));
    const otherAverage = averageFinite(other.map(context => context.preFuelGapMinutes));
    const eveningLonger = evening.length >= 3
      && other.length >= 3
      && Number.isFinite(eveningAverage)
      && Number.isFinite(otherAverage)
      && eveningAverage - otherAverage >= 30;

    return {
      sessionCount: valid.length,
      preFuelSampleCount: preGaps.length,
      postFuelSampleCount: postGaps.length,
      averagePreFuelGapMinutes: preGaps.length >= minimumSamples ? Math.round(averageFinite(preGaps)) : null,
      averagePostFuelGapMinutes: postGaps.length >= minimumSamples ? Math.round(averageFinite(postGaps)) : null,
      missingPreviousFuelCount: valid.filter(context => !context.hasPreviousFuel).length,
      missingPostFuelCount: valid.filter(context => !context.hasPostFuel).length,
      noPostFuelSameDayCount: valid.filter(context => !postFuelSameDay(context)).length,
      extendedPreFuelGapCount: extended.length,
      targetMinutes: Number.isFinite(configuredTarget) && configuredTarget > 0 ? configuredTarget : null,
      eveningLonger,
      eveningPreFuelGapMinutes: eveningLonger ? Math.round(eveningAverage) : null,
      otherPreFuelGapMinutes: eveningLonger ? Math.round(otherAverage) : null,
      enoughForPatterns: valid.length >= 3
    };
  }

  function workoutFuelSummariesByAthlete({ contexts = [], targetsByUser = {}, timeZone, minimumSamples = 2 } = {}) {
    const grouped = new Map();
    (Array.isArray(contexts) ? contexts : []).forEach(context => {
      const athleteId = String(context?.athleteId || context?.workout?.athleteId || "");
      if (!athleteId) return;
      if (!grouped.has(athleteId)) grouped.set(athleteId, []);
      grouped.get(athleteId).push(context);
    });
    return Array.from(grouped.entries()).map(([athleteId, athleteContexts]) => {
      const targets = targetsByUser[athleteId] || {};
      const configuredTarget = Number(
        targets.maximumFuelGapMinutes
        ?? targets.maximum_fuel_gap_minutes
        ?? targets.maximum_fuel_gap
        ?? targets.maxFuelGapMinutes
      );
      return {
        athleteId,
        contexts: athleteContexts.sort((a, b) => b.workout.startAt - a.workout.startAt),
        ...aggregateWorkoutFuelContexts(athleteContexts, {
          targetMinutes: Number.isFinite(configuredTarget) ? maximumFuelGapMinutes(targets) : null,
          timeZone,
          minimumSamples
        })
      };
    });
  }

  function validActivityUsageLog(log) {
    if (!log || typeof log !== "object" || !logDate(log)) return false;
    if (log.deleted_at || log.deletedAt || log.revoked_at || log.revokedAt || log.valid === false) return false;
    const source = String(log.source || "manual").trim().toLowerCase();
    if (["test", "fixture", "invalid"].includes(source)) return false;
    const type = String(log.type || log.logType || log.log_type || "").trim().toLowerCase();
    return ["fuel", "hydration", "fuel_hydration"].includes(type) && !checkinPayload(log);
  }

  // A usage day contains at least one real fuel or hydration moment. The
  // current streak ends today when today has a usage day; otherwise it may end
  // yesterday so an in-progress day does not break the streak before midnight.
  // Fuel+hydration moments count once in each lifetime total. Check-ins such as
  // Sleepy are neither fuel nor hydration and never affect these numbers.
  function activityUsageSummary(logs = [], now = new Date()) {
    const valid = (Array.isArray(logs) ? logs : [])
      .filter(validActivityUsageLog)
      .map(normalizeLog)
      .filter(Boolean)
      .sort((a, b) => a.date - b.date);
    const fuelMoments = valid.filter(isFuelLog);
    const hydrationMoments = valid.filter(isHydrationLog);
    const streakForDays = days => {
      const today = dateKey(now);
      let cursor = days.has(today) ? today : shiftDateKey(today, -1);
      let streak = 0;
      while (cursor && days.has(cursor)) {
        streak += 1;
        cursor = shiftDateKey(cursor, -1);
      }
      return streak;
    };
    const fuelDays = new Set(fuelMoments.map(log => dateKey(log.date)));
    const hydrationDays = new Set(hydrationMoments.map(log => dateKey(log.date)));
    const usageDays = new Set([...fuelMoments, ...hydrationMoments].map(log => dateKey(log.date)));
    return {
      dayStreak: streakForDays(usageDays),
      fuelStreak: streakForDays(fuelDays),
      hydrationStreak: streakForDays(hydrationDays),
      fuelMoments: fuelMoments.length,
      hydrationMoments: hydrationMoments.length
    };
  }

  function applyDayTypeOverride(dayTypes = {}, key, value) {
    const target = dayTypes && typeof dayTypes === "object" && !Array.isArray(dayTypes) ? dayTypes : {};
    const date = String(key || "");
    const next = String(value || "").trim().toLowerCase();
    if (!date) return target;
    if (["work", "holiday", "competition"].includes(next)) target[date] = next;
    else delete target[date];
    return target;
  }

  function applyDayTypeState(fuelGap = {}, key, value) {
    const date = String(key || "");
    const next = ["work", "holiday", "competition"].includes(String(value || "").trim().toLowerCase())
      ? String(value).trim().toLowerCase()
      : "";
    if (!date || !fuelGap || typeof fuelGap !== "object" || Array.isArray(fuelGap)) return next;
    if (!fuelGap.dayTypes || typeof fuelGap.dayTypes !== "object" || Array.isArray(fuelGap.dayTypes)) fuelGap.dayTypes = {};
    applyDayTypeOverride(fuelGap.dayTypes, date, next);
    if (fuelGap.archive?.[date] && typeof fuelGap.archive[date] === "object") {
      fuelGap.archive[date].dayType = next;
      fuelGap.archive[date].dayTypeLabel = next === "work"
        ? "Working Day"
        : next === "holiday"
          ? "Holiday"
          : next === "competition"
            ? "Competition Day"
            : "Not set";
    }
    if (Array.isArray(fuelGap.logs)) {
      fuelGap.logs.forEach(log => {
        const loggedAt = logDate(log);
        if (loggedAt && dateKey(loggedAt) === date) log.dayType = next;
      });
    }
    return next;
  }

  function milestoneKey(category, threshold) {
    return `${String(category || "")}:${Number(threshold)}`;
  }

  function milestoneValue(summary = {}, category) {
    if (category === "streak") return Number(summary.dayStreak || 0);
    if (category === "fuel") return Number(summary.fuelMoments || 0);
    if (category === "hydration") return Number(summary.hydrationMoments || 0);
    return 0;
  }

  function milestoneLabel(category, threshold) {
    const formatted = Number(threshold).toLocaleString("en-GB");
    if (category === "streak") return `${formatted} day streak`;
    if (category === "fuel") return `${formatted} fuelling moments`;
    return `${formatted} hydration moments`;
  }

  function earnedMilestones(summary = {}) {
    return Object.entries(MILESTONE_THRESHOLDS).flatMap(([category, thresholds]) =>
      thresholds.filter(threshold => milestoneValue(summary, category) >= threshold).map(threshold => ({
        key: milestoneKey(category, threshold),
        category,
        threshold,
        label: milestoneLabel(category, threshold)
      }))
    );
  }

  function newlyCrossedMilestones(previousSummary, currentSummary = {}, acknowledgedKeys = []) {
    if (!previousSummary || typeof previousSummary !== "object") return [];
    const acknowledged = new Set((Array.isArray(acknowledgedKeys) ? acknowledgedKeys : []).map(String));
    return earnedMilestones(currentSummary).filter(milestone =>
      milestoneValue(previousSummary, milestone.category) < milestone.threshold
      && !acknowledged.has(milestone.key)
    );
  }

  function athletePointProgress(summary = {}) {
    const valueFor = milestone => milestone.category === "streak"
      ? Number(summary.dayStreak || 0)
      : Number(summary.fuelMoments || 0);
    const milestones = ATHLETE_POINT_MILESTONES.map(milestone => ({
      ...milestone,
      currentValue: valueFor(milestone),
      earned: valueFor(milestone) >= milestone.threshold,
      remaining: Math.max(0, milestone.threshold - valueFor(milestone))
    }));
    const earnedPoints = milestones.filter(item => item.earned).reduce((total, item) => total + item.points, 0);
    const nextMilestones = milestones.filter(item => !item.earned).sort((a, b) => {
      const aProgress = a.threshold ? a.currentValue / a.threshold : 0;
      const bProgress = b.threshold ? b.currentValue / b.threshold : 0;
      return bProgress - aProgress || a.threshold - b.threshold;
    });
    return { earnedPoints, milestones, nextMilestone: nextMilestones[0] || null };
  }

  function athletePointLevelProgress(totalPoints = 0) {
    const points = Math.max(0, Math.floor(Number(totalPoints) || 0));
    const achieved = ATHLETE_POINT_LEVELS.filter(level => points >= level.threshold);
    const current = achieved.at(-1) || ATHLETE_POINT_LEVELS[0];
    const next = ATHLETE_POINT_LEVELS.find(level => level.threshold > points) || null;
    const range = next ? Math.max(1, next.threshold - current.threshold) : 1;
    return {
      points,
      current,
      next,
      remaining: next ? next.threshold - points : 0,
      progressPct: next ? Math.min(100, Math.round((points - current.threshold) / range * 100)) : 100,
      levels: ATHLETE_POINT_LEVELS.map(level => ({ ...level, achieved: points >= level.threshold }))
    };
  }

  function quantityValue(value) {
    if (value === null || value === undefined || value === "") return 0;
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : NaN;
  }

  function normalizeTrainingPreset(preset = {}) {
    const normalized = {};
    TRAINING_QUANTITY_FIELDS.forEach(field => {
      const value = quantityValue(preset[field] ?? preset[field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)]);
      normalized[field] = Number.isFinite(value) ? value : 0;
    });
    return normalized;
  }

  function validateTrainingPreset(preset = {}) {
    const normalized = normalizeTrainingPreset(preset);
    const errors = TRAINING_QUANTITY_FIELDS.flatMap(field => {
      const value = normalized[field];
      if (!Number.isInteger(value) || value < 0) return [`${field} must be a whole number at or above zero.`];
      if (value > TRAINING_QUANTITY_LIMITS[field]) return [`${field} is above the supported per-event limit.`];
      return [];
    });
    if (!TRAINING_QUANTITY_FIELDS.some(field => normalized[field] > 0)) {
      errors.push("At least one training quantity must be above zero.");
    }
    return { valid: errors.length === 0, errors, preset: normalized };
  }

  function trainingEventContext(session, eventType) {
    if (!session || !["fuel", "hydration", "fuel_hydration"].includes(eventType)) return null;
    const useHydrationPreset = eventType === "hydration";
    const prefix = useHydrationPreset ? "hydration" : "fuel";
    const preset = normalizeTrainingPreset({
      carbsG: session[`${prefix}CarbsG`] ?? session[`${prefix}_carbs_g`],
      fluidMl: session[`${prefix}FluidMl`] ?? session[`${prefix}_fluid_ml`],
      sodiumMg: session[`${prefix}SodiumMg`] ?? session[`${prefix}_sodium_mg`],
      caffeineMg: session[`${prefix}CaffeineMg`] ?? session[`${prefix}_caffeine_mg`]
    });
    return {
      trainingModeSessionId: session.id || session.sessionId || "",
      trainingModePresetId: session[`${prefix}PresetId`] ?? session[`${prefix}_preset_id`] ?? "",
      ...preset
    };
  }

  function applyTrainingEventContext(log = {}, session = null, eventType = log?.type) {
    const context = trainingEventContext(session, String(eventType || "").toLowerCase());
    return context ? { ...log, ...context } : { ...log };
  }

  function trainingLogSessionId(log = {}) {
    return String(log.trainingModeSessionId || log.training_mode_session_id || "");
  }

  function trainingSessionIntakeSummary({ session = {}, logs = [], now = new Date() } = {}) {
    const startedAt = parseDate(session.startedAt || session.started_at);
    const endedAt = parseDate(session.endedAt || session.ended_at);
    const effectiveEnd = endedAt || parseDate(now) || new Date();
    const durationSeconds = startedAt ? Math.max(0, Math.round((effectiveEnd - startedAt) / 1000)) : 0;
    const sessionId = String(session.id || session.sessionId || "");
    const matching = (Array.isArray(logs) ? logs : []).filter(log => sessionId && trainingLogSessionId(log) === sessionId);
    const totals = { carbsG: 0, fluidMl: 0, sodiumMg: 0, caffeineMg: 0 };
    matching.forEach(log => {
      const preset = normalizeTrainingPreset(log);
      TRAINING_QUANTITY_FIELDS.forEach(field => { totals[field] += preset[field]; });
    });
    const hours = durationSeconds / 3600;
    const perHour = Object.fromEntries(TRAINING_QUANTITY_FIELDS.map(field => [
      field,
      hours > 0 ? Math.round((totals[field] / hours) * 10) / 10 : 0
    ]));
    return { sessionId, durationSeconds, eventCount: matching.length, totals, perHour, logs: matching };
  }

  const MIN_VALID_TRAINING_RATE_SECONDS = 15 * 60;

  function completedTrainingSessionMetrics({ session = {}, logs = [], now = new Date() } = {}) {
    const summary = trainingSessionIntakeSummary({ session, logs, now });
    const endedAt = parseDate(session.endedAt || session.ended_at);
    const completed = String(session.status || "") === "completed" && Boolean(endedAt);
    const validDuration = completed && summary.durationSeconds >= MIN_VALID_TRAINING_RATE_SECONDS;
    const validLoggedIntake = validDuration && summary.eventCount > 0;
    const actualPerHour = Object.fromEntries(TRAINING_QUANTITY_FIELDS.map(field => [
      field,
      validLoggedIntake ? summary.perHour[field] : null
    ]));
    return {
      ...summary,
      completed,
      validDuration,
      validLoggedIntake,
      actualPerHour,
      minimumRateDurationSeconds: MIN_VALID_TRAINING_RATE_SECONDS
    };
  }

  function trainingCompletionSummary({ session = {}, logs = [], now = new Date() } = {}) {
    const metrics = completedTrainingSessionMetrics({ session, logs, now });
    const startedAt = parseDate(session.startedAt || session.started_at);
    const endedAt = parseDate(session.endedAt || session.ended_at);
    const fuelEventCount = metrics.logs.filter(isFuelLog).length;
    const hydrationEventCount = metrics.logs.filter(isHydrationLog).length;
    const plan = session.plan && typeof session.plan === "object" ? session.plan : {
      carbsG: session.planCarbsGPerHour ?? session.plan_carbs_g_per_hour,
      fluidMl: session.planFluidMlPerHour ?? session.plan_fluid_ml_per_hour,
      sodiumMg: session.planSodiumMgPerHour ?? session.plan_sodium_mg_per_hour,
      caffeineMg: session.planCaffeineMgPerHour ?? session.plan_caffeine_mg_per_hour
    };
    const normalizedPlan = normalizeTrainingPreset(plan);
    const hasPlan = TRAINING_QUANTITY_FIELDS.some(field => normalizedPlan[field] > 0);
    const plannedDurationMinutes = Math.max(15, Number(session.estimatedDurationMinutes || session.estimated_duration_minutes) || Math.round(metrics.durationSeconds / 60) || 60);
    const planned = hasPlan ? trainingPlannedSessionTotals(normalizedPlan, plannedDurationMinutes) : null;
    const workout = startedAt && endedAt ? {
      id: session.id,
      athleteId: session.userId || session.user_id || "",
      startAt: startedAt,
      endAt: endedAt,
      source: "training_mode",
      type: session.sessionType || session.session_type || "training",
      title: session.title || "Training session"
    } : null;
    const context = workout ? getWorkoutFuelContext(workout, logsWithDates(logs).filter(log => log.date <= (parseDate(now) || new Date()))) : null;
    let coverageMessage = "Recorded session totals are ready.";
    if (!metrics.completed) coverageMessage = "This session is not complete, so completion rates are not shown.";
    else if (!metrics.validDuration) coverageMessage = "This session was under 15 minutes, so extrapolated rates are not shown.";
    else if (!metrics.eventCount) coverageMessage = "No Fuel or Hydration event was recorded for this session; rates are not shown.";
    return {
      ...metrics,
      startedAt,
      endedAt,
      title: String(session.title || "Training session"),
      fuelEventCount,
      hydrationEventCount,
      planned,
      hasPlan,
      postFuelGapMinutes: context?.hasPostFuel ? context.postFuelGapMinutes : null,
      firstPostFuelAt: context?.hasPostFuel ? context.nextFuelEvent?.date || null : null,
      coverageMessage
    };
  }

  function activeTrainingSessionInsights({ session = {}, logs = [], now = new Date() } = {}) {
    const summary = trainingSessionIntakeSummary({ session, logs, now });
    const durationMinutes = summary.durationSeconds / 60;
    const rateReady = summary.durationSeconds >= MIN_VALID_TRAINING_RATE_SECONDS;
    const plan = normalizeTrainingPreset(session.plan && typeof session.plan === "object" ? session.plan : {
      carbsG: session.planCarbsGPerHour ?? session.plan_carbs_g_per_hour,
      fluidMl: session.planFluidMlPerHour ?? session.plan_fluid_ml_per_hour,
      sodiumMg: session.planSodiumMgPerHour ?? session.plan_sodium_mg_per_hour,
      caffeineMg: session.planCaffeineMgPerHour ?? session.plan_caffeine_mg_per_hour
    });
    const fuelIntervalMinutes = Math.max(5, Number(session.fuelIntervalMinutes || session.fuel_interval_minutes) || 30);
    const hydrationIntervalMinutes = Math.max(5, Number(session.hydrationIntervalMinutes || session.hydration_interval_minutes) || 20);
    const startedAt = parseDate(session.startedAt || session.started_at);
    const currentAt = parseDate(now) || new Date();
    const latestMatching = predicate => summary.logs.filter(predicate)
      .map(log => ({ ...log, date: logDate(log) }))
      .filter(log => log.date && log.date <= currentAt)
      .sort((a, b) => b.date - a.date)[0] || null;
    const latestFuel = latestMatching(isFuelLog);
    const latestHydration = latestMatching(isHydrationLog);
    const minutesSince = log => log?.date
      ? Math.max(0, Math.round((currentAt - log.date) / 60000))
      : startedAt ? Math.max(0, Math.round((currentAt - startedAt) / 60000)) : null;
    const fuelGapMinutes = minutesSince(latestFuel);
    const hydrationGapMinutes = minutesSince(latestHydration);
    const insights = [];

    if (latestFuel) {
      insights.push({
        id: "fuel_timing",
        label: "Fuel timing",
        value: `${duration(fuelGapMinutes)} since recorded Fuel`,
        detail: `Your planned Fuel interval is ${fuelIntervalMinutes} minutes.`,
        tone: fuelGapMinutes >= fuelIntervalMinutes ? "attention" : "steady"
      });
    } else {
      insights.push({
        id: "fuel_timing",
        label: "Fuel timing",
        value: "No Fuel recorded in this session yet",
        detail: Number.isFinite(fuelGapMinutes)
          ? `${duration(fuelGapMinutes)} of session time recorded. Your planned interval is ${fuelIntervalMinutes} minutes.`
          : `Your planned interval is ${fuelIntervalMinutes} minutes.`,
        tone: Number.isFinite(fuelGapMinutes) && fuelGapMinutes >= fuelIntervalMinutes ? "attention" : "neutral"
      });
    }

    if (!rateReady) {
      insights.push({
        id: "rate_evidence",
        label: "Pace evidence",
        value: "Session pace is still building",
        detail: "Hourly pace and projections appear after 15 recorded minutes so short sessions are not over-interpreted.",
        tone: "neutral"
      });
    } else {
      const paceInsight = (id, label, field, unit) => {
        const actual = Number(summary.perHour[field] || 0);
        const planned = Number(plan[field] || 0);
        if (!actual && !planned) return null;
        const difference = actual - planned;
        const tolerance = Math.max(field === "fluidMl" ? 50 : 5, planned * 0.1);
        const comparison = !planned
          ? `No ${label.toLowerCase()} target is configured for this session.`
          : Math.abs(difference) <= tolerance
            ? `You're roughly on your planned ${label.toLowerCase()} pace of ${wholeMeasurement(planned, `${unit}/h`)}.`
            : `${wholeMeasurement(actual, `${unit}/h`)} recorded against ${wholeMeasurement(planned, `${unit}/h`)} planned.`;
        return {
          id,
          label: `${label} pace`,
          value: actual ? `About ${wholeMeasurement(actual, `${unit}/h`)}` : `No ${label.toLowerCase()} recorded yet`,
          detail: comparison,
          tone: planned && difference < -tolerance ? "attention" : "steady"
        };
      };
      [
        paceInsight("carbohydrate_pace", "Carbohydrate", "carbsG", "g"),
        paceInsight("hydration_pace", "Hydration", "fluidMl", "ml"),
        plan.sodiumMg > 0 ? paceInsight("sodium_pace", "Sodium", "sodiumMg", "mg") : null
      ].filter(Boolean).forEach(insight => insights.push(insight));

      const estimatedDurationMinutes = Math.max(durationMinutes, Number(session.estimatedDurationMinutes || session.estimated_duration_minutes) || 0);
      if (estimatedDurationMinutes >= 30 && plan.carbsG > 0 && summary.totals.carbsG > 0) {
        const projected = summary.perHour.carbsG * estimatedDurationMinutes / 60;
        const plannedTotal = plan.carbsG * estimatedDurationMinutes / 60;
        const difference = Math.round(projected - plannedTotal);
        if (Math.abs(difference) >= 5) {
          insights.push({
            id: "carbohydrate_projection",
            label: "Projected session intake",
            value: `${Math.round(projected)}g carbohydrate at current recorded pace`,
            detail: difference < 0
              ? `That is around ${Math.abs(difference)}g below the ${Math.round(plannedTotal)}g session plan.`
              : `That is around ${difference}g above the ${Math.round(plannedTotal)}g session plan.`,
            tone: difference < 0 ? "attention" : "steady"
          });
        }
      }
    }

    const candidates = [
      { label: "Next Fuel", type: "Fuel", gap: fuelGapMinutes, interval: fuelIntervalMinutes, recorded: Boolean(latestFuel) },
      { label: "Hydration", type: "Hydration", gap: hydrationGapMinutes, interval: hydrationIntervalMinutes, recorded: Boolean(latestHydration) }
    ].filter(item => Number.isFinite(item.gap))
      .map(item => ({ ...item, proximity: item.gap / item.interval }))
      .filter(item => item.proximity >= 0.8)
      .sort((a, b) => b.proximity - a.proximity);
    if (candidates[0]) {
      const next = candidates[0];
      const overdue = next.gap >= next.interval;
      insights.push({
        id: "next_action",
        label: next.label,
        value: overdue ? `${next.interval}-minute interval reached` : `${next.interval}-minute interval approaching`,
        detail: next.recorded
          ? `The last recorded ${next.type} event was ${duration(next.gap)} ago.`
          : `No ${next.type.toLowerCase()} has been recorded during ${duration(next.gap)} of this session.`,
        tone: overdue ? "attention" : "steady"
      });
    }

    const priorities = ["next_action", "fuel_timing", "carbohydrate_pace", "hydration_pace", "sodium_pace", "carbohydrate_projection", "rate_evidence"];
    return {
      durationMinutes,
      rateReady,
      summary,
      plan,
      insights: insights.sort((a, b) => priorities.indexOf(a.id) - priorities.indexOf(b.id)).slice(0, 4)
    };
  }

  function completedTrainingSessionAverages({ sessions = [], logs = [], now = new Date(), limit = 6 } = {}) {
    const recent = (Array.isArray(sessions) ? sessions : [])
      .filter(session => String(session.status || "") === "completed" && parseDate(session.endedAt || session.ended_at))
      .sort((a, b) => parseDate(b.startedAt || b.started_at) - parseDate(a.startedAt || a.started_at))
      .slice(0, Math.max(1, Number(limit) || 6));
    const metrics = recent.map(session => completedTrainingSessionMetrics({
      session,
      logs,
      now: parseDate(session.endedAt || session.ended_at) || now
    }));
    const durationMetrics = metrics.filter(metric => metric.validDuration);
    const intakeMetrics = metrics.filter(metric => metric.validLoggedIntake);
    return {
      sessionCount: metrics.length,
      validDurationCount: durationMetrics.length,
      validIntakeCount: intakeMetrics.length,
      averages: {
        carbsGPerSession: intakeMetrics.length ? averageFinite(intakeMetrics.map(metric => metric.totals.carbsG)) : null,
        carbsGPerHour: intakeMetrics.length ? averageFinite(intakeMetrics.map(metric => metric.actualPerHour.carbsG)) : null,
        fluidMlPerSession: intakeMetrics.length ? averageFinite(intakeMetrics.map(metric => metric.totals.fluidMl)) : null,
        durationSeconds: durationMetrics.length ? averageFinite(durationMetrics.map(metric => metric.durationSeconds)) : null
      },
      metrics
    };
  }

  function trainingPlanProgress(summary = {}, plan = {}) {
    const hours = Math.max(0, Number(summary.durationSeconds || 0) / 3600);
    return Object.fromEntries(TRAINING_QUANTITY_FIELDS.map(field => {
      const rawRate = plan[field] ?? plan[`${field}PerHour`] ?? plan[field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)] ?? 0;
      const rate = Math.max(0, Number(rawRate) || 0);
      const actual = Number(summary.totals?.[field] || 0);
      const expected = Math.round(rate * hours * 10) / 10;
      const difference = Math.round((actual - expected) * 10) / 10;
      const tolerance = Math.max(1, rate * 0.1);
      return [field, {
        actual,
        plannedRate: rate,
        expected,
        difference,
        state: !rate ? "unplanned" : difference < -tolerance ? "behind" : difference > tolerance ? "ahead" : "on_plan"
      }];
    }));
  }

  function trainingHourlyPlan({
    fuelPreset = {},
    hydrationPreset = {},
    fuelIntervalMinutes = 30,
    hydrationIntervalMinutes = 20,
    advancedPlan = {},
    useAdvancedPlan = false
  } = {}) {
    const intervals = {
      fuel: clamp(Math.round(Number(fuelIntervalMinutes) || 30), 5, 360),
      hydration: clamp(Math.round(Number(hydrationIntervalMinutes) || 20), 5, 360)
    };
    const presets = {
      fuel: normalizeTrainingPreset(fuelPreset),
      hydration: normalizeTrainingPreset(hydrationPreset)
    };
    const derived = Object.fromEntries(TRAINING_QUANTITY_FIELDS.map(field => {
      const rate = (presets.fuel[field] * 60 / intervals.fuel)
        + (presets.hydration[field] * 60 / intervals.hydration);
      return [field, Math.round(rate)];
    }));
    const advanced = normalizeTrainingPreset(advancedPlan);
    return {
      intervals,
      derived,
      effective: useAdvancedPlan ? advanced : derived,
      source: useAdvancedPlan ? "advanced" : "derived"
    };
  }

  function wholeMeasurement(value, unit = "") {
    const rounded = Math.round(Number(value) || 0);
    return `${rounded.toLocaleString("en-GB")}${unit}`;
  }

  function trainingPlannedSessionTotals(plan = {}, estimatedDurationMinutes = 60) {
    const minutes = clamp(Math.round(Number(estimatedDurationMinutes) || 60), 15, 1440);
    const hours = minutes / 60;
    const totals = Object.fromEntries(TRAINING_QUANTITY_FIELDS.map(field => [
      field,
      Math.round(Math.max(0, Number(plan[field] || 0)) * hours)
    ]));
    return { estimatedDurationMinutes: minutes, totals };
  }

  function todayAthleteInsights({ logs = [], sessions = [], key, now = new Date(), timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const referenceNow = parseDate(now) || new Date();
    const targetKey = validDateKey(key) || dateKeyInTimeZone(referenceNow, zone);
    const normalizedLogs = logsWithDates(logs);
    const dayLogs = normalizedLogs.filter(log => dateKeyInTimeZone(log.date, zone) === targetKey);
    const fuelLogs = dayLogs.filter(isFuelLog);
    const hydrationLogs = dayLogs.filter(isHydrationLog);
    const sleepyLogs = dayLogs.filter(isSleepyLog);
    const insights = [
      {
        id: "fuel-moments-today",
        label: "Fuel today",
        value: `${fuelLogs.length}`,
        detail: `${fuelLogs.length === 1 ? "Fuelling moment" : "Fuelling moments"} recorded today.`
      },
      {
        id: "hydration-moments-today",
        label: "Hydration today",
        value: `${hydrationLogs.length}`,
        detail: `${hydrationLogs.length === 1 ? "Hydration moment" : "Hydration moments"} recorded today.`
      }
    ];

    const fuelGaps = fuelLogs.slice(1).map((log, index) => ({
      start: fuelLogs[index].date,
      end: log.date,
      minutes: Math.max(0, Math.round((log.date - fuelLogs[index].date) / 60000))
    }));
    if (fuelGaps.length) {
      const average = Math.round(averageFinite(fuelGaps.map(gap => gap.minutes)));
      const largest = fuelGaps.slice().sort((left, right) => right.minutes - left.minutes)[0];
      insights.push({
        id: "average-fuel-interval-today",
        label: "Average fuel interval today",
        value: duration(average),
        detail: `Across ${fuelGaps.length} completed interval${fuelGaps.length === 1 ? "" : "s"} today.`
      });
      insights.push({
        id: "largest-fuel-gap-today",
        label: "Largest fuel gap today",
        value: `${formatClockInTimeZone(largest.start, zone)}–${formatClockInTimeZone(largest.end, zone)}`,
        detail: `${duration(largest.minutes)} between recorded Fuel moments.`
      });
    } else if (fuelLogs.length) {
      const latestFuel = fuelLogs.at(-1);
      const currentMinutes = Math.max(0, Math.round((referenceNow - latestFuel.date) / 60000));
      insights.push({
        id: "current-fuel-gap-today",
        label: "Current fuel gap",
        value: duration(currentMinutes),
        detail: `Since Fuel at ${formatClockInTimeZone(latestFuel.date, zone)}.`
      });
    }

    if (hydrationLogs.length) {
      const latestHydration = hydrationLogs.at(-1);
      const currentMinutes = Math.max(0, Math.round((referenceNow - latestHydration.date) / 60000));
      insights.push({
        id: "current-hydration-gap-today",
        label: "Current hydration gap",
        value: duration(currentMinutes),
        detail: `Since Hydrate at ${formatClockInTimeZone(latestHydration.date, zone)}.`
      });
    }

    const latestSleepy = sleepyLogs.at(-1);
    if (latestSleepy) {
      const previousFuel = normalizedLogs.filter(log => isFuelLog(log) && log.date < latestSleepy.date).at(-1);
      insights.push({
        id: "sleepy-fuel-gap-today",
        label: "Latest Sleepy timing",
        value: previousFuel ? `${duration(Math.round((latestSleepy.date - previousFuel.date) / 60000))} after last fuel` : "No earlier Fuel recorded",
        detail: `Sleepy recorded at ${formatClockInTimeZone(latestSleepy.date, zone)}.`
      });
    }

    const daySessions = (Array.isArray(sessions) ? sessions : [])
      .filter(session => {
        const start = parseDate(session.startedAt || session.started_at);
        return start && dateKeyInTimeZone(start, zone) === targetKey;
      })
      .sort((left, right) => parseDate(right.startedAt || right.started_at) - parseDate(left.startedAt || left.started_at));
    const session = daySessions[0];
    if (session) {
      const startAt = parseDate(session.startedAt || session.started_at);
      const endedAt = parseDate(session.endedAt || session.ended_at);
      const context = getWorkoutFuelContext({
        id: session.id,
        athleteId: session.userId || session.user_id || "",
        source: "training_mode",
        type: session.sessionType || session.session_type || "training",
        title: session.title || "Training session",
        startAt,
        endAt: endedAt || referenceNow
      }, normalizedLogs);
      insights.push({
        id: "training-fuel-before-today",
        label: `Before ${session.title || "training"}`,
        value: context?.hasPreviousFuel ? `${duration(context.preFuelGapMinutes)} before session` : "No earlier Fuel recorded",
        detail: context?.hasPreviousFuel
          ? `Last Fuel ${formatClockInTimeZone(context.previousFuelEvent.date, zone)} · session ${formatClockInTimeZone(startAt, zone)}.`
          : `Session started at ${formatClockInTimeZone(startAt, zone)}.`
      });
      if (endedAt) {
        insights.push({
          id: "training-fuel-after-today",
          label: `After ${session.title || "training"}`,
          value: context?.hasPostFuel ? `${duration(context.postFuelGapMinutes)} post workout to fuel` : "Waiting for post-workout Fuel",
          detail: context?.hasPostFuel
            ? `Session ended ${formatClockInTimeZone(endedAt, zone)} · next Fuel ${formatClockInTimeZone(context.nextFuelEvent.date, zone)}.`
            : `Session ended at ${formatClockInTimeZone(endedAt, zone)}.`
        });
      }
    }

    return { key: targetKey, insights, counts: { fuel: fuelLogs.length, hydration: hydrationLogs.length, sleepy: sleepyLogs.length } };
  }

  function athleteTrainingInsights({ logs = [], sessions = [], now = new Date(), timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const normalizedLogs = logsWithDates(logs);
    const completed = (Array.isArray(sessions) ? sessions : [])
      .filter(session => String(session.status || "completed") === "completed" && parseDate(session.startedAt || session.started_at) && parseDate(session.endedAt || session.ended_at));
    const contexts = completed.map(session => getWorkoutFuelContext({
      id: session.id,
      athleteId: session.userId || session.user_id || "",
      source: "training_mode",
      type: session.sessionType || session.session_type || "training",
      title: session.title || "Training session",
      startAt: session.startedAt || session.started_at,
      endAt: session.endedAt || session.ended_at
    }, normalizedLogs)).filter(Boolean);
    const preGaps = contexts.map(context => context.preFuelGapMinutes).filter(Number.isFinite);
    const postGaps = contexts.map(context => context.postFuelGapMinutes).filter(Number.isFinite);
    const sessionInsights = [];
    if (preGaps.length) sessionInsights.push({ id: "average-pre-session-gap", label: "Average pre-session fuel gap", value: duration(Math.round(averageFinite(preGaps))), detail: `${preGaps.length} recorded session${preGaps.length === 1 ? "" : "s"}.` });
    if (postGaps.length) {
      sessionInsights.push({ id: "average-post-session-gap", label: "Average post-session refuel", value: duration(Math.round(averageFinite(postGaps))), detail: `${postGaps.length} recorded post-workout Fuel moment${postGaps.length === 1 ? "" : "s"}.` });
      sessionInsights.push({ id: "longest-post-session-gap", label: "Longest recent post-session delay", value: duration(Math.max(...postGaps)), detail: "Measured from session finish to first Fuel." });
    }
    const today = todayAthleteInsights({ logs: normalizedLogs, sessions, now, timeZone: zone });
    const dayInsightIds = new Set(["fuel-moments-today", "hydration-moments-today", "average-fuel-interval-today", "largest-fuel-gap-today", "current-fuel-gap-today", "current-hydration-gap-today", "sleepy-fuel-gap-today"]);
    return { sessionInsights, dayInsights: today.insights.filter(insight => dayInsightIds.has(insight.id)) };
  }

  function behaviouralPatternInsights({ logs = [], sessions = [], timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const normalizedLogs = logsWithDates(logs);
    const fuelLogs = normalizedLogs.filter(isFuelLog);
    const byDay = new Map();
    fuelLogs.forEach(log => {
      const key = dateKeyInTimeZone(log.date, zone);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(log);
    });
    const gaps = [];
    byDay.forEach((dayLogs, key) => {
      dayLogs.sort((a, b) => a.date - b.date);
      for (let index = 1; index < dayLogs.length; index += 1) {
        const start = dayLogs[index - 1].date;
        const end = dayLogs[index].date;
        gaps.push({
          key,
          start,
          end,
          minutes: Math.round((end - start) / 60000),
          startMinute: minutesIntoDayInTimeZone(start, zone),
          endMinute: minutesIntoDayInTimeZone(end, zone)
        });
      }
    });

    const insights = [];
    if (gaps.length >= 3) {
      const average = Math.round(averageFinite(gaps.map(gap => gap.minutes)));
      insights.push({
        id: "average-fuel-interval",
        label: "Average fuelling interval",
        value: duration(average),
        detail: `Observed across ${gaps.length} same-day fuel intervals.`,
        sampleCount: gaps.length
      });
    }

    const recurring = mostCommonWindow(gaps, gap => gapWindow(gap));
    const recurringDays = new Set((recurring?.items || []).map(gap => gap.key)).size;
    if (recurring && recurring.count >= 2 && recurringDays >= 2) {
      insights.push({
        id: "recurring-gap-window",
        label: "Largest recurring gap",
        value: recurring.label.replace("-", "–"),
        detail: `Observed on ${recurringDays} days; this is a timing association, not a diagnosis.`,
        sampleCount: recurring.count
      });
    }

    const completedSessions = (Array.isArray(sessions) ? sessions : [])
      .filter(session => String(session.status || "completed") === "completed" && parseDate(session.startedAt || session.started_at) && parseDate(session.endedAt || session.ended_at));
    const trainingDays = new Set(completedSessions.map(session => dateKeyInTimeZone(session.startedAt || session.started_at, zone)));
    const averageDayGap = key => averageFinite(gaps.filter(gap => gap.key === key).map(gap => gap.minutes));
    const trainingDayGaps = [...trainingDays].map(averageDayGap).filter(Number.isFinite);
    const ordinaryDayGaps = [...byDay.keys()].filter(key => !trainingDays.has(key)).map(averageDayGap).filter(Number.isFinite);
    if (trainingDayGaps.length >= 2 && ordinaryDayGaps.length >= 2) {
      const trainingAverage = averageFinite(trainingDayGaps);
      const ordinaryAverage = averageFinite(ordinaryDayGaps);
      const differencePct = ordinaryAverage > 0 ? Math.round(((trainingAverage - ordinaryAverage) / ordinaryAverage) * 100) : 0;
      insights.push({
        id: "training-day-comparison",
        label: "Training days",
        value: `${Math.abs(differencePct)}% ${differencePct >= 0 ? "longer" : "shorter"} average fuel interval`,
        detail: `Observed across ${trainingDayGaps.length} training and ${ordinaryDayGaps.length} non-training days.`,
        sampleCount: trainingDayGaps.length + ordinaryDayGaps.length
      });
    }

    const sleepyLogs = normalizedLogs.filter(isSleepyLog);
    if (sleepyLogs.length >= 3) {
      const afterLongGap = sleepyLogs.filter(sleepy => {
        const previousFuel = fuelLogs.filter(fuel => fuel.date < sleepy.date && dateKeyInTimeZone(fuel.date, zone) === dateKeyInTimeZone(sleepy.date, zone)).at(-1);
        return previousFuel && (sleepy.date - previousFuel.date) / 60000 > 180;
      }).length;
      const pct = Math.round((afterLongGap / sleepyLogs.length) * 100);
      insights.push({
        id: "sleepy-after-long-gap",
        label: "Sleepy and fuel gaps",
        value: `${pct}% occurred over 3h after fuel`,
        detail: `Observed across ${sleepyLogs.length} Sleepy events; this does not establish cause.`,
        sampleCount: sleepyLogs.length
      });
    }

    if (completedSessions.length >= 3) {
      const workouts = completedSessions.map(session => ({
        id: session.id,
        athleteId: session.userId || session.user_id || "",
        source: "training_mode",
        type: session.sessionType || session.session_type || "training",
        title: session.title,
        startAt: session.startedAt || session.started_at,
        endAt: session.endedAt || session.ended_at
      }));
      const contexts = getWorkoutFuelContexts(workouts, normalizedLogs);
      const compliant = contexts.filter(context => Number.isFinite(context.postFuelGapMinutes) && context.postFuelGapMinutes <= 120).length;
      insights.push({
        id: "post-training-fuel",
        label: "Post-training fuel compliance",
        value: `${Math.round((compliant / contexts.length) * 100)}%`,
        detail: `Fuel within 2h after ${contexts.length} completed Training Mode sessions.`,
        sampleCount: contexts.length
      });
    }

    return { insights, enoughData: insights.length > 0, gapSampleCount: gaps.length };
  }

  function trainingPatternLanes({ logs = [], sessions = [], key = dateKey(), timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const normalizedLogs = logsWithDates(logs);
    const trainingLogs = normalizedLogs.filter(log => trainingLogSessionId(log));
    const referencedIds = new Set(trainingLogs.map(trainingLogSessionId));
    const matched = (Array.isArray(sessions) ? sessions : []).filter(session => {
      const startedAt = parseDate(session.startedAt || session.started_at);
      return (startedAt && dateKeyInTimeZone(startedAt, zone) === key) || referencedIds.has(String(session.id || ""));
    }).map(session => ({ ...session }));
    referencedIds.forEach(id => {
      if (!matched.some(session => String(session.id) === id)) {
        const events = trainingLogs.filter(log => trainingLogSessionId(log) === id);
        matched.push({ id, title: "Training session", sessionType: "training", startedAt: events[0]?.date, endedAt: events.at(-1)?.date });
      }
    });
    return matched
      .map(session => ({
        session,
        events: trainingLogs.filter(log => trainingLogSessionId(log) === String(session.id))
      }))
      .sort((left, right) => parseDate(left.session.startedAt || left.session.started_at) - parseDate(right.session.startedAt || right.session.started_at));
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
    if (preset === "week") {
      const selected = validDateKey(customEnd);
      if (!selected) return weeklyReportingPeriod({ now, timeZone: zone });
      const [year, month, day] = selected.split("-").map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const daysSinceMonday = (weekday + 6) % 7;
      const startKey = shiftDateKey(selected, -daysSinceMonday);
      return periodFromKeys(startKey, shiftDateKey(startKey, 6), "week", zone);
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

  function longestLoggingStreak(days = []) {
    let current = 0;
    let longest = 0;
    (Array.isArray(days) ? days : []).forEach(day => {
      current = day?.logged ? current + 1 : 0;
      longest = Math.max(longest, current);
    });
    return longest;
  }

  function athleteWeeklyRecap({ logs = [], sessions = [], targets = {}, now = new Date(), timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const period = weeklyReportingPeriod({ now, timeZone: zone });
    const previousPeriod = previousPeriodRange(period);
    const current = athletePeriodMetrics({ logs, targets, period, timeZone: zone });
    const previous = athletePeriodMetrics({ logs, targets, period: previousPeriod, timeZone: zone });
    const completedSessions = (Array.isArray(sessions) ? sessions : []).filter(session => {
      const startedAt = parseDate(session.startedAt || session.started_at);
      const endedAt = parseDate(session.endedAt || session.ended_at);
      if (!startedAt || !endedAt || String(session.status || "") !== "completed") return false;
      const key = dateKeyInTimeZone(startedAt, zone);
      return key >= period.startKey && key <= period.endKey;
    });
    const sessionsWithRecordedActivity = completedSessions.filter(session =>
      trainingSessionIntakeSummary({ session, logs, now: session.endedAt || session.ended_at || now }).eventCount > 0
    ).length;
    const repeatedGapWindow = current.fuelling.commonGapWindow
      && current.fuelling.commonGapWindow.count >= 2
      && new Set(current.fuelling.commonGapWindow.items.map(gap => gap.key)).size >= 2
      ? current.fuelling.commonGapWindow
      : null;
    const trend = athleteTrend(current, previous);
    const improvements = [];
    if (trend.direction === "improved") improvements.push(trend.label);
    if (current.coverage.loggedDays >= 5) improvements.push(`${current.coverage.loggedDays} days contained Fuel Guard records.`);
    if (completedSessions.length && sessionsWithRecordedActivity === completedSessions.length) {
      improvements.push(`All ${completedSessions.length} completed training session${completedSessions.length === 1 ? "" : "s"} included recorded Fuel or Hydration activity.`);
    }
    const areas = [];
    if (!current.coverage.loggedDays) {
      areas.push("No Fuel Guard records were available for this completed week.");
    } else if (current.coverage.metricDays < 2) {
      areas.push("More days with at least two recorded Fuel moments are needed to calculate a reliable weekly gap pattern.");
    }
    if (current.exceededGaps.length) {
      areas.push(`${current.exceededGaps.length} observed fuel gap${current.exceededGaps.length === 1 ? "" : "s"} exceeded the ${duration(current.targetMinutes)} Daily target.`);
    }
    if (completedSessions.length > sessionsWithRecordedActivity) {
      const count = completedSessions.length - sessionsWithRecordedActivity;
      areas.push(`${count} completed training session${count === 1 ? " had" : "s had"} no Fuel or Hydration activity recorded against the session.`);
    }
    if (!areas.length && current.coverage.loggedDays) areas.push("Keep recording consistently so future week-to-week patterns have stronger coverage.");
    return {
      period,
      previousPeriod,
      coverage: current.coverage,
      loggingStreak: longestLoggingStreak(current.days),
      fuelMoments: current.fuelLogs.length,
      hydrationMoments: current.hydrationLogs.length,
      trainingSessions: completedSessions.length,
      trainingSessionsWithRecordedActivity: sessionsWithRecordedActivity,
      longestObservedGapMinutes: current.gaps.length ? current.fuelling.longestGapMinutes : null,
      averageObservedGapMinutes: current.gaps.length >= 2 ? current.fuelling.averageGapMinutes : null,
      commonLongGapWindow: repeatedGapWindow?.label || null,
      comparison: {
        available: trend.direction !== "insufficient",
        direction: trend.direction,
        label: trend.label,
        previousLoggedDays: previous.coverage.loggedDays,
        previousAverageGapMinutes: previous.fuelling.averageGapMinutes
      },
      improvements: improvements.slice(0, 2),
      areas: areas.slice(0, 2),
      evidenceNote: "This recap describes recorded Fuel Guard activity. Missing records are not evidence of food or drink intake."
    };
  }

  function normalizePrePracticeStatus(status) {
    const value = String(status || "").trim().toLowerCase();
    if (value === "green") return "green";
    if (["amber", "yellow"].includes(value)) return "amber";
    if (["red", "crash"].includes(value)) return "red";
    return "grey";
  }

  function prePracticeFuelState({ session = {}, logs = [], targets = {}, now = new Date(), timeZone, reminderWindowMinutes = 180 } = {}) {
    const referenceNow = parseDate(now) || new Date();
    const startsAt = parseDate(session.starts_at || session.startsAt);
    const zone = resolvedTimeZone(timeZone || session.timezone_name || session.timeZone);
    const scheduled = !["cancelled", "completed"].includes(String(session.status || session.session_status || "scheduled").toLowerCase());
    const fuelLogs = logsWithDates(logs)
      .filter(log => isFuelLog(log) && log.date <= referenceNow && (!startsAt || log.date <= startsAt))
      .sort((left, right) => left.date - right.date);
    const latestFuel = fuelLogs.at(-1) || null;
    const gapMinutesAtStart = startsAt && latestFuel
      ? Math.max(0, Math.floor((startsAt - latestFuel.date) / 60000))
      : null;
    const rawStatus = Number.isFinite(gapMinutesAtStart) ? fuelGapStatus(gapMinutesAtStart, targets) : "none";
    const status = normalizePrePracticeStatus(rawStatus);
    const minutesUntilStart = startsAt ? Math.round((startsAt - referenceNow) / 60000) : null;
    const reminderEligible = scheduled
      && Number.isFinite(minutesUntilStart)
      && minutesUntilStart >= 0
      && minutesUntilStart <= Math.max(1, Number(reminderWindowMinutes) || 180)
      && ["amber", "red"].includes(status);
    const sessionLabel = String(session.session_name || session.sessionName || session.session_type || session.sessionType || "Practice")
      .trim().replace(/[_-]+/g, " ").replace(/^./, character => character.toUpperCase());
    const startClock = startsAt ? formatClockInTimeZone(startsAt, zone) : "soon";
    return {
      status,
      rawStatus,
      latestFuel,
      gapMinutesAtStart,
      maximumFuelGapMinutes: maximumFuelGapMinutes(targets),
      minutesUntilStart,
      reminderEligible,
      sessionLabel,
      startClock,
      title: `${sessionLabel} starts at ${startClock}`,
      detail: "Make sure you're fuelled and ready to train."
    };
  }

  function prePracticeTeamSummary(rows = []) {
    const statuses = (Array.isArray(rows) ? rows : []).map(row => normalizePrePracticeStatus(
      row.pre_session_status || row.preSessionStatus || row.status
    ));
    const counts = { green: 0, amber: 0, red: 0, grey: 0 };
    statuses.forEach(status => { counts[status] += 1; });
    const needsFuel = counts.amber + counts.red;
    let insight = "No actively shared athlete fuelling data is available for this session.";
    if (needsFuel) {
      insight = `${needsFuel} athlete${needsFuel === 1 ? "" : "s"} may need to fuel before this session.`;
    } else if (counts.green && !counts.grey) {
      insight = "All visible athletes are appropriately fuelled for this session.";
    } else if (counts.green) {
      insight = "Most visible athletes are appropriately fuelled; some do not have enough logging data.";
    } else if (counts.grey) {
      insight = "Fuel Guard does not yet have enough logging data to assess these athletes.";
    }
    return { total: statuses.length, counts, needsFuel, insight };
  }

  function athleteNudgeEligibility({ logs = [], sessions = [], teamSessions = [], targets = {}, preferences = {}, now = new Date(), timeZone } = {}) {
    const referenceNow = parseDate(now) || new Date();
    const zone = resolvedTimeZone(timeZone);
    const enabled = {
      maximumGap: preferences.maximumGap !== false && preferences.maximum_gap_enabled !== false,
      postTraining: preferences.postTraining !== false && preferences.post_training_enabled !== false,
      trainingMode: preferences.trainingMode !== false && preferences.training_mode_enabled !== false
    };
    const normalizedLogs = logsWithDates(logs).filter(log => log.date <= referenceNow);
    const fuelLogs = normalizedLogs.filter(isFuelLog);
    const candidates = [];
    const targetMinutes = maximumFuelGapMinutes(targets);
    const latestFuel = fuelLogs.at(-1);
    if (enabled.maximumGap) {
      (Array.isArray(teamSessions) ? teamSessions : []).forEach(session => {
        const state = prePracticeFuelState({ session, logs: normalizedLogs, targets, now: referenceNow, timeZone });
        if (!state.reminderEligible) return;
        candidates.push({
          id: "pre_practice_fuel",
          category: "maximum_gap",
          priority: state.status === "red" ? 100 : 85,
          title: state.title,
          detail: state.detail,
          occurrenceKey: `pre_practice:${String(session.id || session.session_id || session.starts_at || session.startsAt)}`,
          minimumIntervalMinutes: 180,
          status: state.status
        });
      });
    }
    if (enabled.maximumGap && latestFuel) {
      const elapsed = Math.max(0, Math.round((referenceNow - latestFuel.date) / 60000));
      if (elapsed >= Math.max(0, targetMinutes - APPROACHING_WINDOW_MINUTES)) {
        candidates.push({
          id: "maximum_fuel_gap",
          category: "maximum_gap",
          priority: elapsed >= targetMinutes ? 90 : 70,
          title: `${duration(elapsed)} since your last recorded Fuel.`,
          detail: `Your Daily target is ${duration(targetMinutes)}.`,
          occurrenceKey: `maximum_gap:${dateKeyInTimeZone(referenceNow, zone)}:${Math.floor(elapsed / 30)}`,
          minimumIntervalMinutes: 30
        });
      }
    }
    const completed = (Array.isArray(sessions) ? sessions : []).filter(session => {
      const endedAt = parseDate(session.endedAt || session.ended_at);
      if (!endedAt || String(session.status || "") !== "completed") return false;
      const elapsed = (referenceNow - endedAt) / 60000;
      return elapsed >= 20 && elapsed <= 180;
    }).sort((a, b) => parseDate(b.endedAt || b.ended_at) - parseDate(a.endedAt || a.ended_at));
    const latestCompleted = completed[0];
    if (enabled.postTraining && latestCompleted) {
      const endedAt = parseDate(latestCompleted.endedAt || latestCompleted.ended_at);
      const postFuel = fuelLogs.find(log => log.date > endedAt);
      if (!postFuel) {
        const elapsed = Math.round((referenceNow - endedAt) / 60000);
        candidates.push({
          id: "post_training_fuel",
          category: "post_training",
          priority: 80,
          title: `Training finished ${duration(elapsed)} ago.`,
          detail: "No post-training Fuel has been recorded yet.",
          occurrenceKey: `post_training:${String(latestCompleted.id || endedAt.toISOString())}`,
          minimumIntervalMinutes: 120
        });
      }
    }
    const active = (Array.isArray(sessions) ? sessions : []).find(session => String(session.status || "") === "active" && !parseDate(session.endedAt || session.ended_at));
    if (enabled.trainingMode && active) {
      const startedAt = parseDate(active.startedAt || active.started_at);
      const interval = Math.max(5, Number(active.fuelIntervalMinutes || active.fuel_interval_minutes) || 30);
      const recorded = fuelLogs.filter(log => trainingLogSessionId(log) === String(active.id || ""));
      const anchor = recorded.at(-1)?.date || startedAt;
      const elapsed = anchor ? Math.max(0, Math.round((referenceNow - anchor) / 60000)) : 0;
      if (anchor && elapsed >= Math.max(5, interval - 10)) {
        candidates.push({
          id: "training_fuel_window",
          category: "training_mode",
          priority: 75,
          title: `${duration(elapsed)} since ${recorded.length ? "your last recorded Training Fuel" : "Training Mode started"}.`,
          detail: `Your Training Mode Fuel interval is ${duration(interval)}.`,
          occurrenceKey: `training_mode:${String(active.id || startedAt?.toISOString() || "active")}:${Math.floor(elapsed / interval)}`,
          minimumIntervalMinutes: interval
        });
      }
    }
    return candidates.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
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

  function buildWeeklyCoachReview(options = {}) {
    const base = buildAthleteReviewReport(options);
    const scoredDays = base.metrics.days.map(day => ({
      ...day,
      score: day.fuelLogs.length * 4 + day.hydrationLogs.length + (day.withinTarget === true ? 3 : 0)
        - day.gaps.filter(gap => gap.exceededTarget).length * 2
    }));
    const strongest = scoredDays.filter(day => day.logged).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))[0] || null;
    const weakest = [...scoredDays].sort((a, b) => a.score - b.score || a.key.localeCompare(b.key))[0] || null;
    const longGaps = [...base.metrics.exceededGaps]
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 3)
      .map(gap => ({ date: gap.key, minutes: Math.round(gap.minutes), window: gap.window?.label || "Recorded interval" }));
    const workoutSummary = options.workoutSummary || {};
    const contexts = (workoutSummary.contexts || []).filter(context => {
      const key = dateKeyInTimeZone(context?.workout?.startAt, base.timeZone);
      return key >= base.period.startKey && key <= base.period.endKey;
    });
    const preRecorded = contexts.filter(context => context.hasPreviousFuel).length;
    const postRecorded = contexts.filter(context => context.hasPostFuel).length;
    const postGapContexts = contexts
      .filter(context => context.hasPostFuel && Number.isFinite(context.postFuelGapMinutes))
      .map(context => ({
        date: dateKeyInTimeZone(context.workout.endAt, base.timeZone),
        minutes: Math.round(context.postFuelGapMinutes)
      }))
      .sort((a, b) => a.minutes - b.minutes);
    const postTrainingObservations = [];
    const strongestPost = postGapContexts.find(context => context.minutes <= 120);
    const latestPost = [...postGapContexts].reverse().find(context => context.minutes > 120);
    const missingPost = contexts.filter(context => !context.hasPostFuel).length;
    if (strongestPost) {
      postTrainingObservations.push(`Strong recorded example — ${strongestPost.date}: post-session Fuel was recorded ${duration(strongestPost.minutes)} after training.`);
    }
    if (latestPost) {
      postTrainingObservations.push(`Post-training opportunity — ${latestPost.date}: first recorded Fuel was ${duration(latestPost.minutes)} after training.`);
    }
    if (missingPost) {
      postTrainingObservations.push(`${missingPost} shared workout${missingPost === 1 ? " had" : "s had"} no post-session Fuel recorded.`);
    }
    if (contexts.length && !postTrainingObservations.length) {
      postTrainingObservations.push("Post-session Fuel timing was recorded, with no gap beyond two hours in the shared workouts.");
    }
    const training = {
      workoutCount: contexts.length,
      preFuelRecorded: preRecorded,
      postFuelRecorded: postRecorded,
      noPreFuelRecorded: Math.max(0, contexts.length - preRecorded),
      noPostFuelRecorded: Math.max(0, contexts.length - postRecorded),
      observations: postTrainingObservations
    };
    const recurringPatterns = [];
    if (base.fuelling.commonGapWindow?.count >= 2) {
      recurringPatterns.push(`${base.fuelling.commonGapWindow.label} contained ${base.fuelling.commonGapWindow.count} repeated recorded fuel gaps.`);
    }
    if (base.sleepy.commonWindow?.count >= 2) {
      recurringPatterns.push(`${base.sleepy.commonWindow.label} contained ${base.sleepy.commonWindow.count} recorded Sleepy events.`);
    }
    if (!recurringPatterns.length) recurringPatterns.push("No recurring timing pattern had enough recorded evidence this week.");

    const strongestText = strongest
      ? `${strongest.key}: ${strongest.fuelLogs.length} Fuel and ${strongest.hydrationLogs.length} Hydration event${strongest.hydrationLogs.length === 1 ? "" : "s"} recorded${strongest.withinTarget === true ? "; recorded gaps stayed within target" : ""}.`
      : "No day had enough recorded events to identify a strongest day.";
    const weakestText = !weakest
      ? "No day had enough recorded evidence to identify a weakest day."
      : weakest.fuelLogs.length === 0
        ? `${weakest.key}: No fuel was recorded. This describes the shared record only.`
        : `${weakest.key}: ${weakest.fuelLogs.length} Fuel event${weakest.fuelLogs.length === 1 ? " was" : "s were"} recorded${weakest.exceededTarget ? ", with a recorded gap beyond the configured target" : ""}.`;
    const discussionPrompts = [
      weakest?.fuelLogs?.length === 0
        ? `What made logging harder on ${weakest.key}, and is there a gentler way to capture the day?`
        : "Which part of this week's fuelling rhythm felt easiest to repeat?",
      longGaps.length
        ? `What was happening around the ${longGaps[0].window} gap, and what support would be practical next time?`
        : "Is there a training or work window worth watching next week?",
      contexts.length
        ? "Did the recorded pre- and post-training fuel moments match how the sessions felt?"
        : "Were there training sessions this week that were not present in the shared record?"
    ];
    const weeklyReview = { strongestDay: strongestText, weakestDay: weakestText, longGaps, training, recurringPatterns, discussionPrompts };
    return {
      ...base,
      title: `Weekly Coach Review - ${base.athleteName}`,
      reviewKind: "weekly",
      weeklyReview,
      executiveSummary: [
        `Shared logging was present on ${base.coverage.loggedDays} of ${base.coverage.totalDays} days.`,
        strongestText,
        weakestText,
        contexts.length
          ? `${preRecorded} of ${contexts.length} shared workouts had a prior Fuel event recorded and ${postRecorded} had a post-session Fuel event recorded.`
          : "No shared workout record was available for pre/post-training review this week."
      ]
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

  function buildTeamSessionCoachBrief({ contexts = [], period, comparisonPeriod, timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone || period?.timeZone);
    const rows = (Array.isArray(contexts) ? contexts : []).filter(row => {
      const startsAt = row?.starts_at || row?.startsAt;
      return parseDate(startsAt) && String(row?.session_status || row?.sessionStatus || "scheduled") !== "cancelled";
    });
    const withinPeriod = (row, selected) => {
      if (!selected?.startKey || !selected?.endKey) return true;
      const key = dateKeyInTimeZone(row.starts_at || row.startsAt, row.timezone_name || row.timeZone || zone);
      return key >= selected.startKey && key <= selected.endKey;
    };
    const summarise = selectedRows => {
      const athleteSessions = selectedRows.length;
      const logged = selectedRows.filter(row => String(row.pre_session_status || row.preSessionStatus) !== "no_logging");
      const withinTarget = logged.filter(row => ["green", "yellow"].includes(String(row.pre_session_status || row.preSessionStatus)));
      const completed = selectedRows.filter(row => String(row.post_session_status || row.postSessionStatus) !== "pending");
      const prompt = completed.filter(row => String(row.post_session_status || row.postSessionStatus) === "prompt");
      return {
        sessionCount: new Set(selectedRows.map(row => String(row.session_id || row.sessionId))).size,
        athleteSessions,
        loggingCoveragePct: athleteSessions ? Math.round(logged.length / athleteSessions * 100) : null,
        preConsistencyPct: logged.length ? Math.round(withinTarget.length / logged.length * 100) : null,
        postPromptPct: completed.length ? Math.round(prompt.length / completed.length * 100) : null,
        noLoggingCount: athleteSessions - logged.length,
        redCount: selectedRows.filter(row => String(row.pre_session_status || row.preSessionStatus) === "red").length,
        lateCount: completed.filter(row => String(row.post_session_status || row.postSessionStatus) === "late").length,
        noPostFuelCount: completed.filter(row => String(row.post_session_status || row.postSessionStatus) === "no_fuel").length
      };
    };
    const athleteSummary = selectedRows => {
      const grouped = new Map();
      selectedRows.forEach(row => {
        const athleteId = String(row.athlete_id || row.athleteId || "");
        if (!athleteId) return;
        const item = grouped.get(athleteId) || {
          athleteId,
          athleteName: row.athlete_name || row.athleteName || "Fuel Guard Athlete",
          opportunities: 0,
          successes: 0,
          noLogging: 0,
          red: 0,
          late: 0,
          noPostFuel: 0
        };
        const pre = String(row.pre_session_status || row.preSessionStatus || "no_logging");
        const post = String(row.post_session_status || row.postSessionStatus || "pending");
        item.opportunities += 1;
        if (["green", "yellow"].includes(pre)) item.successes += 1;
        if (pre === "no_logging") item.noLogging += 1;
        if (pre === "red") item.red += 1;
        if (post !== "pending") {
          item.opportunities += 1;
          if (post === "prompt") item.successes += 1;
          if (post === "late") item.late += 1;
          if (post === "no_fuel") item.noPostFuel += 1;
        }
        grouped.set(athleteId, item);
      });
      return [...grouped.values()].map(item => ({
        ...item,
        adherencePct: item.opportunities ? Math.round(item.successes / item.opportunities * 100) : null
      }));
    };
    const currentRows = rows.filter(row => withinPeriod(row, period));
    const previousRows = comparisonPeriod ? rows.filter(row => withinPeriod(row, comparisonPeriod)) : [];
    const currentAthletes = athleteSummary(currentRows);
    const previousByAthlete = new Map(athleteSummary(previousRows).map(item => [item.athleteId, item]));
    const trends = currentAthletes.map(item => {
      const previous = previousByAthlete.get(item.athleteId);
      const comparable = item.opportunities >= 2 && previous?.opportunities >= 2;
      const change = comparable ? item.adherencePct - previous.adherencePct : null;
      return {
        ...item,
        previousAdherencePct: previous?.adherencePct ?? null,
        direction: !comparable || Math.abs(change) < 20 ? "stable" : change > 0 ? "improving" : "deteriorating",
        change
      };
    });
    const sessionGroups = new Map();
    currentRows.forEach(row => {
      const sessionId = String(row.session_id || row.sessionId || "");
      if (!sessionGroups.has(sessionId)) sessionGroups.set(sessionId, []);
      sessionGroups.get(sessionId).push(row);
    });
    const positiveSessions = [...sessionGroups.entries()].map(([sessionId, sessionRows]) => {
      const completed = sessionRows.filter(row => String(row.post_session_status || row.postSessionStatus) !== "pending");
      const preGood = sessionRows.filter(row => ["green", "yellow"].includes(String(row.pre_session_status || row.preSessionStatus))).length;
      const postGood = completed.filter(row => String(row.post_session_status || row.postSessionStatus) === "prompt").length;
      return {
        sessionId,
        startsAt: sessionRows[0]?.starts_at || sessionRows[0]?.startsAt,
        positive: completed.length > 0
          && preGood / sessionRows.length >= 0.8
          && postGood / completed.length >= 0.8
      };
    }).filter(item => parseDate(item.startsAt)).sort((a, b) => parseDate(b.startsAt) - parseDate(a.startsAt));
    let teamSessionStreak = 0;
    for (const session of positiveSessions) {
      if (!session.positive) break;
      teamSessionStreak += 1;
    }
    const summary = summarise(currentRows);
    const scoredAreas = [
      { id: "logging", label: "Logging coverage", value: summary.loggingCoveragePct },
      { id: "pre", label: "Pre-session consistency", value: summary.preConsistencyPct },
      { id: "post", label: "Prompt post-session fuel", value: summary.postPromptPct }
    ].filter(area => Number.isFinite(area.value)).sort((a, b) => b.value - a.value);
    return {
      period,
      comparisonPeriod,
      ...summary,
      strongestArea: scoredAreas[0] || null,
      needsAttentionArea: scoredAreas.at(-1) || null,
      athletes: trends,
      improving: trends.filter(item => item.direction === "improving"),
      deteriorating: trends.filter(item => item.direction === "deteriorating"),
      missingPatterns: trends.filter(item => item.noLogging > 0 || item.noPostFuel > 0),
      needsAttention: trends.filter(item => item.red > 0 || item.noPostFuel > 0),
      teamSessionStreak,
      milestone: teamSessionStreak >= 3 ? `${teamSessionStreak}-session team consistency streak` : ""
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

  function impactComparisonPeriod({ range = "six_weeks", now = new Date(), timeZone, firstEvidenceAt } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const endKey = dateKeyInTimeZone(now, zone);
    const firstEvidenceKey = firstEvidenceAt
      ? validDateKey(firstEvidenceAt) || dateKeyInTimeZone(firstEvidenceAt, zone)
      : "";
    const requestedDays = range === "twelve_weeks" ? 84 : PERFORMANCE_IMPACT_RULES.sixWeekDays;
    const startKey = range === "since_first_evidence" && firstEvidenceKey
      ? firstEvidenceKey
      : shiftDateKey(endKey, -(requestedDays - 1));
    const period = periodFromKeys(startKey, endKey, range, zone);
    const windowDays = PERFORMANCE_IMPACT_RULES.comparisonWindowDays;
    const baselineEndKey = shiftDateKey(startKey, Math.min(windowDays, period.totalDays) - 1);
    const currentStartKey = shiftDateKey(endKey, -(Math.min(windowDays, period.totalDays) - 1));
    return {
      ...period,
      firstEvidenceKey,
      baseline: periodFromKeys(startKey, baselineEndKey, "impact_baseline", zone),
      current: periodFromKeys(currentStartKey, endKey, "impact_current", zone),
      comparable: period.totalDays >= windowDays * 2
        && Boolean(firstEvidenceKey)
        && firstEvidenceKey <= baselineEndKey
    };
  }

  function impactResultDate(result = {}) {
    return validDateKey(result.observed_on || result.observedOn || result.date);
  }

  function performanceOutcomeChange(metric = {}, results = []) {
    const metricId = String(metric.id || metric.metricId || "");
    const matching = (Array.isArray(results) ? results : [])
      .filter(result => !metricId || String(result.metric_id || result.metricId || "") === metricId)
      .map(result => ({ ...result, observedKey: impactResultDate(result), numericValue: Number(result.value) }))
      .filter(result => result.observedKey && Number.isFinite(result.numericValue))
      .sort((left, right) => left.observedKey.localeCompare(right.observedKey)
        || String(left.created_at || left.createdAt || "").localeCompare(String(right.created_at || right.createdAt || "")));
    const baseline = matching[0] || null;
    const current = matching[matching.length - 1] || null;
    const separationDays = baseline && current ? Math.max(0, daysBetweenKeys(baseline.observedKey, current.observedKey) - 1) : 0;
    const sufficient = matching.length >= 2 && separationDays >= PERFORMANCE_IMPACT_RULES.minimumOutcomeSeparationDays;
    if (!sufficient) {
      return {
        metric,
        baseline,
        current,
        sampleCount: matching.length,
        separationDays,
        sufficient: false,
        direction: "insufficient",
        difference: null,
        changePct: null
      };
    }

    const baselineValue = baseline.numericValue;
    const currentValue = current.numericValue;
    const difference = currentValue - baselineValue;
    const threshold = Math.max(
      Math.abs(baselineValue) * PERFORMANCE_IMPACT_RULES.outcomeRelativeStability,
      PERFORMANCE_IMPACT_RULES.outcomeAbsoluteStability
    );
    let directionalChange = difference;
    const directionRule = String(metric.direction || "higher");
    if (directionRule === "lower") directionalChange = -difference;
    if (directionRule === "target_range") {
      const minimum = Number(metric.target_min ?? metric.targetMin);
      const maximum = Number(metric.target_max ?? metric.targetMax);
      const distance = value => value < minimum ? minimum - value : value > maximum ? value - maximum : 0;
      directionalChange = distance(baselineValue) - distance(currentValue);
    }
    const direction = Math.abs(directionalChange) < threshold
      ? "stable"
      : directionalChange > 0 ? "improved" : "declined";
    return {
      metric,
      baseline,
      current,
      sampleCount: matching.length,
      separationDays,
      sufficient: true,
      direction,
      difference,
      directionalChange,
      changePct: baselineValue === 0 ? null : difference / Math.abs(baselineValue) * 100
    };
  }

  function impactDirection(current, baseline, { favourable = "higher", threshold = 0 } = {}) {
    if (!Number.isFinite(current) || !Number.isFinite(baseline)) return "insufficient";
    const raw = current - baseline;
    if (Math.abs(raw) < threshold) return "stable";
    const favourableChange = favourable === "lower" ? -raw : raw;
    return favourableChange > 0 ? "improved" : "declined";
  }

  function impactSignal({ id, label, baseline, current, unit = "", direction = "insufficient", samples = {} } = {}) {
    return {
      id,
      label,
      baseline,
      current,
      unit,
      direction,
      difference: Number.isFinite(current) && Number.isFinite(baseline) ? current - baseline : null,
      samples
    };
  }

  function impactComponentStatus(signals = []) {
    const eligible = signals.filter(signal => !["insufficient"].includes(signal.direction));
    const improved = eligible.filter(signal => signal.direction === "improved").length;
    const declined = eligible.filter(signal => signal.direction === "declined").length;
    const stable = eligible.filter(signal => signal.direction === "stable").length;
    let id = "insufficient";
    if (eligible.length && improved >= 2 && declined === 0) id = "strong_improvement";
    else if (improved > declined) id = "improving";
    else if (declined > improved) id = "declining";
    else if (improved && declined) id = "mixed";
    else if (eligible.length && stable === eligible.length) id = "stable";
    const labels = {
      strong_improvement: "Strong improvement",
      improving: "Improving",
      mixed: "Mixed",
      stable: "Stable",
      declining: "Declining",
      insufficient: "Insufficient evidence"
    };
    return { id, label: labels[id], eligible: eligible.length, improved, declined, stable, signals };
  }

  function impactWindowMetrics({ logs = [], workouts = [], feedback = [], targetMinutes, period, timeZone } = {}) {
    const zone = resolvedTimeZone(timeZone || period?.timeZone);
    const target = Number.isFinite(Number(targetMinutes)) && Number(targetMinutes) > 0
      ? Number(targetMinutes)
      : DEFAULT_MAXIMUM_FUEL_GAP_MINUTES;
    const keys = dateKeysBetween(period.startKey, period.endKey);
    const scopedLogs = logsWithDates(logs).filter(log => {
      const key = dateKeyInTimeZone(log.date, zone);
      return key >= period.startKey && key <= period.endKey;
    });
    const dayMetrics = keys.map(key => {
      const dayLogs = scopedLogs.filter(log => dateKeyInTimeZone(log.date, zone) === key);
      const fuelLogs = dayLogs.filter(isFuelLog);
      const hydrationLogs = dayLogs.filter(isHydrationLog);
      const gaps = [];
      for (let index = 1; index < fuelLogs.length; index += 1) {
        const minutes = (fuelLogs[index].date - fuelLogs[index - 1].date) / 60000;
        if (Number.isFinite(minutes) && minutes > 0 && minutes <= 1080) gaps.push(minutes);
      }
      return {
        key,
        fuelLogged: fuelLogs.length > 0,
        hydrationLogged: hydrationLogs.length > 0,
        measurableGap: gaps.length > 0,
        maximumGapMinutes: gaps.length ? Math.max(...gaps) : null,
        longGapCount: gaps.filter(minutes => minutes > target).length
      };
    });
    const measurableDays = dayMetrics.filter(day => day.measurableGap);
    const workoutContexts = getWorkoutFuelContexts(workouts, logs).filter(context => {
      const key = dateKeyInTimeZone(context.workout.endAt, zone);
      return key >= period.startKey && key <= period.endKey;
    });
    const preCovered = workoutContexts.filter(context => context.hasPreviousFuel && context.preFuelGapMinutes <= target).length;
    const postCovered = workoutContexts.filter(context => context.hasPostFuel
      && context.postFuelGapMinutes <= target
      && dateKeyInTimeZone(context.nextFuelEvent.date, zone) === dateKeyInTimeZone(context.workout.endAt, zone)).length;
    const scopedFeedback = (Array.isArray(feedback) ? feedback : []).filter(item => {
      const key = dateKeyInTimeZone(item.session_ended_at || item.sessionEndedAt, zone);
      return key >= period.startKey && key <= period.endKey;
    });
    const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return {
      period,
      totalDays: keys.length,
      fuelCoveragePct: keys.length ? dayMetrics.filter(day => day.fuelLogged).length / keys.length * 100 : null,
      hydrationCoveragePct: keys.length ? dayMetrics.filter(day => day.hydrationLogged).length / keys.length * 100 : null,
      measurableGapDays: measurableDays.length,
      averageMaximumGapMinutes: average(measurableDays.map(day => day.maximumGapMinutes)),
      longGapsPerWeek: keys.length ? dayMetrics.reduce((sum, day) => sum + day.longGapCount, 0) / keys.length * 7 : null,
      sessionCount: workoutContexts.length,
      preFuelCoveragePct: workoutContexts.length ? preCovered / workoutContexts.length * 100 : null,
      postFuelCoveragePct: workoutContexts.length ? postCovered / workoutContexts.length * 100 : null,
      feedbackCount: scopedFeedback.length,
      lowEnergyPct: scopedFeedback.length ? scopedFeedback.filter(item => item.energy_rating === "low_energy" || item.energyRating === "low_energy").length / scopedFeedback.length * 100 : null,
      completedAsPlannedPct: scopedFeedback.length ? scopedFeedback.filter(item => item.session_completion === "yes" || item.sessionCompletion === "yes").length / scopedFeedback.length * 100 : null,
      dayMetrics,
      workoutContexts,
      feedback: scopedFeedback
    };
  }

  function impactLongGapDirection(current, baseline) {
    if (!Number.isFinite(current) || !Number.isFinite(baseline)) return "insufficient";
    if (baseline === 0) return current >= 0.5 ? "declined" : "stable";
    if (current === 0) return baseline >= 0.5 ? "improved" : "stable";
    return impactDirection(current, baseline, {
      favourable: "lower",
      threshold: Math.abs(baseline) * PERFORMANCE_IMPACT_RULES.longGapRelativeDirection
    });
  }

  function impactWindowSignals(baseline, current, comparable) {
    const complete = comparable
      && baseline.totalDays === PERFORMANCE_IMPACT_RULES.comparisonWindowDays
      && current.totalDays === PERFORMANCE_IMPACT_RULES.comparisonWindowDays;
    const behavior = [
      impactSignal({
        id: "fuel_coverage", label: "Fuel logging coverage", baseline: baseline.fuelCoveragePct, current: current.fuelCoveragePct, unit: "%",
        direction: complete ? impactDirection(current.fuelCoveragePct, baseline.fuelCoveragePct, { threshold: PERFORMANCE_IMPACT_RULES.coverageDirectionPoints }) : "insufficient",
        samples: { baselineDays: baseline.totalDays, currentDays: current.totalDays }
      }),
      impactSignal({
        id: "hydration_coverage", label: "Hydration logging coverage", baseline: baseline.hydrationCoveragePct, current: current.hydrationCoveragePct, unit: "%",
        direction: complete ? impactDirection(current.hydrationCoveragePct, baseline.hydrationCoveragePct, { threshold: PERFORMANCE_IMPACT_RULES.coverageDirectionPoints }) : "insufficient",
        samples: { baselineDays: baseline.totalDays, currentDays: current.totalDays }
      }),
      impactSignal({
        id: "average_maximum_gap", label: "Average maximum daily fuel gap", baseline: baseline.averageMaximumGapMinutes, current: current.averageMaximumGapMinutes, unit: "minutes",
        direction: baseline.measurableGapDays >= PERFORMANCE_IMPACT_RULES.minimumGapDaysPerWindow && current.measurableGapDays >= PERFORMANCE_IMPACT_RULES.minimumGapDaysPerWindow
          ? impactDirection(current.averageMaximumGapMinutes, baseline.averageMaximumGapMinutes, { favourable: "lower", threshold: PERFORMANCE_IMPACT_RULES.maximumGapDirectionMinutes }) : "insufficient",
        samples: { baselineDays: baseline.measurableGapDays, currentDays: current.measurableGapDays }
      }),
      impactSignal({
        id: "long_gaps", label: "Long fuel gaps per week", baseline: baseline.longGapsPerWeek, current: current.longGapsPerWeek, unit: "/week",
        direction: baseline.measurableGapDays >= PERFORMANCE_IMPACT_RULES.minimumGapDaysPerWindow && current.measurableGapDays >= PERFORMANCE_IMPACT_RULES.minimumGapDaysPerWindow
          ? impactLongGapDirection(current.longGapsPerWeek, baseline.longGapsPerWeek) : "insufficient",
        samples: { baselineDays: baseline.measurableGapDays, currentDays: current.measurableGapDays }
      }),
      impactSignal({
        id: "pre_training_coverage", label: "Pre-training fuel coverage", baseline: baseline.preFuelCoveragePct, current: current.preFuelCoveragePct, unit: "%",
        direction: baseline.sessionCount >= PERFORMANCE_IMPACT_RULES.minimumSessionsPerWindow && current.sessionCount >= PERFORMANCE_IMPACT_RULES.minimumSessionsPerWindow
          ? impactDirection(current.preFuelCoveragePct, baseline.preFuelCoveragePct, { threshold: PERFORMANCE_IMPACT_RULES.trainingCoverageDirectionPoints }) : "insufficient",
        samples: { baselineSessions: baseline.sessionCount, currentSessions: current.sessionCount }
      }),
      impactSignal({
        id: "post_training_coverage", label: "Post-training recovery fuel coverage", baseline: baseline.postFuelCoveragePct, current: current.postFuelCoveragePct, unit: "%",
        direction: baseline.sessionCount >= PERFORMANCE_IMPACT_RULES.minimumSessionsPerWindow && current.sessionCount >= PERFORMANCE_IMPACT_RULES.minimumSessionsPerWindow
          ? impactDirection(current.postFuelCoveragePct, baseline.postFuelCoveragePct, { threshold: PERFORMANCE_IMPACT_RULES.trainingCoverageDirectionPoints }) : "insufficient",
        samples: { baselineSessions: baseline.sessionCount, currentSessions: current.sessionCount }
      })
    ];
    const training = [
      impactSignal({
        id: "low_energy_sessions", label: "Low-energy sessions", baseline: baseline.lowEnergyPct, current: current.lowEnergyPct, unit: "%",
        direction: baseline.feedbackCount >= PERFORMANCE_IMPACT_RULES.minimumFeedbackPerWindow && current.feedbackCount >= PERFORMANCE_IMPACT_RULES.minimumFeedbackPerWindow
          ? impactDirection(current.lowEnergyPct, baseline.lowEnergyPct, { favourable: "lower", threshold: PERFORMANCE_IMPACT_RULES.feedbackDirectionPoints }) : "insufficient",
        samples: { baselineFeedback: baseline.feedbackCount, currentFeedback: current.feedbackCount }
      }),
      impactSignal({
        id: "completed_as_planned", label: "Sessions completed as planned", baseline: baseline.completedAsPlannedPct, current: current.completedAsPlannedPct, unit: "%",
        direction: baseline.feedbackCount >= PERFORMANCE_IMPACT_RULES.minimumFeedbackPerWindow && current.feedbackCount >= PERFORMANCE_IMPACT_RULES.minimumFeedbackPerWindow
          ? impactDirection(current.completedAsPlannedPct, baseline.completedAsPlannedPct, { threshold: PERFORMANCE_IMPACT_RULES.feedbackDirectionPoints }) : "insufficient",
        samples: { baselineFeedback: baseline.feedbackCount, currentFeedback: current.feedbackCount }
      })
    ];
    return { behavior, training };
  }

  function overallImpactStatus(components = []) {
    const eligible = components.filter(component => component.id !== "insufficient");
    const positive = eligible.filter(component => component.id === "improving" || component.id === "strong_improvement").length;
    const negative = eligible.filter(component => component.id === "declining").length;
    const mixed = eligible.filter(component => component.id === "mixed").length;
    let id = "insufficient";
    if (eligible.length >= 2) {
      if (positive >= 2 && negative === 0 && mixed === 0 && eligible.some(component => component.id === "strong_improvement")) id = "strong_positive";
      else if (positive > negative && mixed === 0) id = "positive";
      else if (negative > 0 && positive === 0 && mixed === 0) id = "negative";
      else if (eligible.every(component => component.id === "stable")) id = "stable";
      else id = "mixed";
    }
    const labels = {
      strong_positive: "Strong positive trend",
      positive: "Positive trend",
      mixed: "Mixed evidence",
      stable: "Stable",
      negative: "Negative trend",
      insufficient: "Insufficient evidence"
    };
    return { id, label: labels[id], eligible: eligible.length, positive, negative, mixed };
  }

  function earliestImpactEvidence({ logs = [], results = [], feedback = [], workouts = [] } = {}) {
    const candidates = [
      ...logsWithDates(logs).map(log => log.date),
      ...(Array.isArray(results) ? results : []).map(result => impactResultDate(result)).filter(Boolean),
      ...(Array.isArray(feedback) ? feedback : []).map(item => item.session_ended_at || item.sessionEndedAt).filter(Boolean),
      ...normalizeWorkouts(workouts).map(workout => workout.endAt).filter(Boolean)
    ].map(value => parseDate(value) || (validDateKey(value) ? new Date(`${value}T12:00:00Z`) : null)).filter(Boolean);
    return candidates.length ? new Date(Math.min(...candidates.map(date => date.getTime()))) : null;
  }

  function buildAthleteImpactReport({ metrics = [], results = [], logs = [], workouts = [], feedback = [], targets = {}, range = "six_weeks", now = new Date(), timeZone, firstEvidenceAt } = {}) {
    const zone = resolvedTimeZone(timeZone);
    const evidenceStart = parseDate(firstEvidenceAt) || earliestImpactEvidence({ logs, results, feedback, workouts });
    const reportPeriod = impactComparisonPeriod({ range, now, timeZone: zone, firstEvidenceAt: evidenceStart });
    const targetMinutes = maximumFuelGapMinutes(targets);
    const baseline = impactWindowMetrics({ logs, workouts, feedback, targetMinutes, period: reportPeriod.baseline, timeZone: zone });
    const current = impactWindowMetrics({ logs, workouts, feedback, targetMinutes, period: reportPeriod.current, timeZone: zone });
    const windowSignals = impactWindowSignals(baseline, current, reportPeriod.comparable);
    const activeMetrics = (Array.isArray(metrics) ? metrics : [])
      .filter(metric => !(metric.archived_at || metric.archivedAt))
      .sort((left, right) => Number(left.display_order || left.displayOrder || 0) - Number(right.display_order || right.displayOrder || 0));
    const outcomes = activeMetrics.map(metric => {
      const outcome = performanceOutcomeChange(metric, (Array.isArray(results) ? results : []).filter(result => {
        const key = impactResultDate(result);
        return key && key <= reportPeriod.endKey;
      }));
      if (outcome.sufficient && outcome.current.observedKey < reportPeriod.startKey) {
        return { ...outcome, sufficient: false, direction: "insufficient" };
      }
      return outcome;
    });
    const outcomeSignals = outcomes.map(outcome => impactSignal({
      id: `outcome_${outcome.metric.id}`,
      label: outcome.metric.name,
      baseline: outcome.baseline?.numericValue ?? null,
      current: outcome.current?.numericValue ?? null,
      unit: outcome.metric.unit,
      direction: outcome.direction,
      samples: { results: outcome.sampleCount, separationDays: outcome.separationDays }
    }));
    const components = {
      behavior: impactComponentStatus(windowSignals.behavior),
      trainingExperience: impactComponentStatus(windowSignals.training),
      performanceOutcomes: impactComponentStatus(outcomeSignals)
    };
    const overall = overallImpactStatus(Object.values(components));
    const reportWorkouts = normalizeWorkouts(workouts).filter(workout => {
      const key = dateKeyInTimeZone(workout.endAt, zone);
      return key >= reportPeriod.startKey && key <= reportPeriod.endKey;
    });
    const reportFeedback = (Array.isArray(feedback) ? feedback : []).filter(item => {
      const key = dateKeyInTimeZone(item.session_ended_at || item.sessionEndedAt, zone);
      return key >= reportPeriod.startKey && key <= reportPeriod.endKey;
    });
    const reportResults = (Array.isArray(results) ? results : []).filter(result => {
      const key = impactResultDate(result);
      return key >= reportPeriod.startKey && key <= reportPeriod.endKey;
    });
    const evidenceDays = evidenceStart
      ? Math.min(reportPeriod.totalDays, daysBetweenKeys(
        dateKeyInTimeZone(evidenceStart, zone) < reportPeriod.startKey ? reportPeriod.startKey : dateKeyInTimeZone(evidenceStart, zone),
        reportPeriod.endKey
      ))
      : 0;
    const positiveParts = Object.entries(components)
      .filter(([_key, component]) => component.id === "improving" || component.id === "strong_improvement")
      .map(([key]) => key === "behavior" ? "fuelling behaviour" : key === "trainingExperience" ? "training experience" : "selected performance outcomes");
    const summary = overall.id === "insufficient"
      ? "Fuel Guard is building your baseline. More comparable days, completed-session feedback or dated performance results are needed before a trend is reported."
      : positiveParts.length
        ? `During the same period, ${positiveParts.join(" and ")} improved alongside one another. This is an observed association, not evidence that Fuel Guard caused the change.`
        : overall.id === "negative"
          ? "The visible evidence moved in an unfavourable direction during this period. This is an observation to review, not a causal or medical conclusion."
          : "The available evidence was stable or mixed during this period; Fuel Guard does not infer a cause."
    return {
      range,
      timeZone: zone,
      period: reportPeriod,
      targetMinutes,
      baseline,
      current,
      outcomes,
      signals: { ...windowSignals, outcomes: outcomeSignals },
      components,
      overall,
      summary,
      evidence: {
        days: evidenceDays,
        workouts: reportWorkouts.length,
        feedback: reportFeedback.length,
        performanceResults: reportResults.length
      }
    };
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

  function buildCoachAttentionItems({ roster = [], dataHealth = { items: [] }, interventions = [], trainingContext = [], workoutFuelSummaries = [], actions = [], now = new Date(), includeResolved = false } = {}) {
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
    (workoutFuelSummaries || []).forEach(summary => {
      const athlete = rosterByAthlete.get(String(summary.athleteId || ""));
      if (!athlete || Number(summary.sessionCount || 0) < 3) return;
      const contexts = Array.isArray(summary.contexts) ? summary.contexts : [];
      if (Number(summary.extendedPreFuelGapCount || 0) >= 2 && Number.isFinite(Number(summary.targetMinutes))) {
        const latest = contexts.find(context => Number(context.preFuelGapMinutes) > Number(summary.targetMinutes));
        add(attentionItem({
          athlete,
          type: "training_repeated_long_pre_gap",
          category: "need_attention",
          label: "Repeated longer fuel gap before training",
          detail: `${summary.extendedPreFuelGapCount} of ${summary.sessionCount} recent sessions started after the athlete's configured ${duration(Number(summary.targetMinutes))} fuel-gap target. This is a timing pattern, not a medical conclusion.`,
          priority: 72,
          occurrenceKey: `training_repeated_long_pre_gap:${occurrenceToken(latest?.workout?.id || key)}:${summary.extendedPreFuelGapCount}:${summary.targetMinutes}`,
          canNudge: true
        }));
      }
      if (Number(summary.noPostFuelSameDayCount || 0) >= 2) {
        const latest = contexts.find(context => !context.nextFuelEvent
          || dateKeyInTimeZone(context.nextFuelEvent.date, context.workout.timeZone) !== dateKeyInTimeZone(context.workout.endAt, context.workout.timeZone));
        add(attentionItem({
          athlete,
          type: "training_missing_post_fuel",
          category: "need_attention",
          label: "Repeated no post-session fuel log",
          detail: `${summary.noPostFuelSameDayCount} of ${summary.sessionCount} recent sessions had no subsequent fuel logged that day. Review the shared timing context with the athlete.`,
          priority: 68,
          occurrenceKey: `training_missing_post_fuel:${occurrenceToken(latest?.workout?.id || key)}:${summary.noPostFuelSameDayCount}`,
          canNudge: true
        }));
      }
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
    MILESTONE_THRESHOLDS,
    ATHLETE_POINT_MILESTONES,
    ATHLETE_POINT_LEVELS,
    TRAINING_QUANTITY_FIELDS,
    TRAINING_QUANTITY_LIMITS,
    PERFORMANCE_IMPACT_RULES,
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
    normalizeWorkout,
    normalizeWorkouts,
    crossProviderActivityMatch,
    getWorkoutFuelContext,
    getWorkoutFuelContexts,
    aggregateWorkoutFuelContexts,
    workoutFuelSummariesByAthlete,
    validActivityUsageLog,
    activityUsageSummary,
    applyDayTypeOverride,
    applyDayTypeState,
    milestoneKey,
    milestoneValue,
    milestoneLabel,
    earnedMilestones,
    newlyCrossedMilestones,
    athletePointProgress,
    athletePointLevelProgress,
    normalizeTrainingPreset,
    validateTrainingPreset,
    trainingEventContext,
    applyTrainingEventContext,
    trainingLogSessionId,
    trainingSessionIntakeSummary,
    completedTrainingSessionMetrics,
    trainingCompletionSummary,
    activeTrainingSessionInsights,
    completedTrainingSessionAverages,
    trainingPlanProgress,
    trainingHourlyPlan,
    trainingPlannedSessionTotals,
    wholeMeasurement,
    todayAthleteInsights,
    athleteTrainingInsights,
    behaviouralPatternInsights,
    trainingPatternLanes,
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
    athleteWeeklyRecap,
    normalizePrePracticeStatus,
    prePracticeFuelState,
    prePracticeTeamSummary,
    athleteNudgeEligibility,
    buildAthleteReviewReport,
    buildWeeklyCoachReview,
    interventionComparison,
    authorizedAthletes,
    buildTeamAnalytics,
    buildWeeklyCoachBrief,
    buildTeamSessionCoachBrief,
    addMonthsClamped,
    reviewScheduleDefinition,
    scheduledReviewState,
    completeScheduledReview,
    reportPeriodForSchedule,
    buildTeamDataHealth,
    impactComparisonPeriod,
    performanceOutcomeChange,
    impactComponentStatus,
    impactWindowMetrics,
    overallImpactStatus,
    earliestImpactEvidence,
    buildAthleteImpactReport,
    buildCoachAttentionItems,
    attentionSummary
  };
});
