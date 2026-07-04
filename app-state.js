const STORAGE_KEY = "fuelGuardStateV20";
const FUEL_GREEN_LIMIT_MINUTES = 180;
const FUEL_RED_LIMIT_MINUTES = 300;

const DEFAULT_STATE = {
  completed: {
    liveFuelStatus: false
  },
  fuelGap: {
    logs: [],
    archive: {},
    dayTypes: {},
    trainingSessions: {},
    graphMode: "combined",
    thresholds: {
      greenMinutes: FUEL_GREEN_LIMIT_MINUTES,
      redMinutes: FUEL_RED_LIMIT_MINUTES
    },
    dayEndedDate: "",
    dayEndedAt: "",
    fastingStartedAt: "",
    cooldownUntil: 0,
    cloud: {
      pendingDeleteIds: [],
      lastSyncedAt: "",
      lastError: ""
    }
  },
  account: {
    email: "",
    status: ""
  },
  fuelMomentum: {
    lastMessage: "",
    lastDate: ""
  },
  activityHistory: []
};

function cloneDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function load() {
  const defaults = cloneDefaults();
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaults;

  try {
    const parsed = JSON.parse(saved);
    const parsedFuelGap = isPlainObject(parsed.fuelGap) ? parsed.fuelGap : {};
    const parsedCompleted = isPlainObject(parsed.completed) ? parsed.completed : {};

    return {
      ...defaults,
      completed: {
        liveFuelStatus: Boolean(parsedCompleted.liveFuelStatus)
      },
      fuelGap: {
        ...defaults.fuelGap,
        ...parsedFuelGap,
        logs: Array.isArray(parsedFuelGap.logs) ? parsedFuelGap.logs : [],
        archive: isPlainObject(parsedFuelGap.archive) ? parsedFuelGap.archive : {},
        dayTypes: isPlainObject(parsedFuelGap.dayTypes) ? parsedFuelGap.dayTypes : {},
        trainingSessions: isPlainObject(parsedFuelGap.trainingSessions) ? parsedFuelGap.trainingSessions : {},
        thresholds: {
          ...defaults.fuelGap.thresholds,
          ...(isPlainObject(parsedFuelGap.thresholds) ? parsedFuelGap.thresholds : {})
        },
        cloud: {
          ...defaults.fuelGap.cloud,
          ...(isPlainObject(parsedFuelGap.cloud) ? parsedFuelGap.cloud : {}),
          pendingDeleteIds: Array.isArray(parsedFuelGap.cloud?.pendingDeleteIds)
            ? parsedFuelGap.cloud.pendingDeleteIds
            : []
        }
      },
      account: {
        ...defaults.account,
        ...(isPlainObject(parsed.account) ? parsed.account : {})
      },
      fuelMomentum: {
        ...defaults.fuelMomentum,
        ...(isPlainObject(parsed.fuelMomentum) ? parsed.fuelMomentum : {})
      },
      activityHistory: Array.isArray(parsed.activityHistory)
        ? parsed.activityHistory
        : Array.isArray(parsed["adherence" + "History"])
          ? parsed["adherence" + "History"]
          : []
    };
  } catch {
    return defaults;
  }
}

let state = load();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const uid = () => {
  const browserCrypto = globalThis.crypto;
  if (browserCrypto?.randomUUID) return browserCrypto.randomUUID();
  if (browserCrypto?.getRandomValues) {
    return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, char =>
      (Number(char) ^ browserCrypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(char) / 4).toString(16)
    );
  }
  return Math.random().toString(36).slice(2, 9);
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function duration(minutes) {
  if (!Number.isFinite(minutes)) return "No limit";
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}m`;
}

function today() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function todayKey(date = new Date()) {
  const localDate = new Date(date);
  return [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, "0"),
    String(localDate.getDate()).padStart(2, "0")
  ].join("-");
}

function fuelGapState() {
  state.fuelGap = {
    ...DEFAULT_STATE.fuelGap,
    ...(state.fuelGap || {})
  };

  if (!Array.isArray(state.fuelGap.logs)) state.fuelGap.logs = [];
  if (!isPlainObject(state.fuelGap.archive)) state.fuelGap.archive = {};
  if (!isPlainObject(state.fuelGap.dayTypes)) state.fuelGap.dayTypes = {};
  if (!isPlainObject(state.fuelGap.trainingSessions)) state.fuelGap.trainingSessions = {};
  if (!isPlainObject(state.fuelGap.thresholds)) state.fuelGap.thresholds = { ...DEFAULT_STATE.fuelGap.thresholds };
  return state.fuelGap;
}

function fuelLogDate(log) {
  const date = new Date(log?.timestamp || log?.date || log);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClock(date) {
  if (!date) return "--";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function fuelOnlyLogs(logs) {
  return logs.filter(log => String(log?.type || "fuel").toLowerCase() !== "hydration");
}

function todaysFuelLogs(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return fuelOnlyLogs(fuelGapState().logs)
    .map(log => ({ ...log, date: fuelLogDate(log) }))
    .filter(log => log.date && log.date >= start && log.date < end)
    .sort((a, b) => a.date - b.date);
}

function lastFuelLog() {
  return fuelOnlyLogs(fuelGapState().logs)
    .map(log => ({ ...log, date: fuelLogDate(log) }))
    .filter(log => log.date)
    .sort((a, b) => b.date - a.date)[0] || null;
}

function minutesSinceLastFuel(now = new Date()) {
  const last = lastFuelLog();
  if (!last) return Infinity;
  return Math.max(0, (now - last.date) / 60000);
}

function fuelGapStatus(minutes) {
  const thresholds = fuelGapState().thresholds || DEFAULT_STATE.fuelGap.thresholds;
  const greenMinutes = Number(thresholds.greenMinutes || FUEL_GREEN_LIMIT_MINUTES);
  const redMinutes = Math.max(Number(thresholds.redMinutes || FUEL_RED_LIMIT_MINUTES), greenMinutes + 30);
  if (!Number.isFinite(minutes)) return "red";
  if (minutes < greenMinutes) return "green";
  if (minutes < redMinutes) return "amber";
  return "red";
}

function fuelGapSnapshot(now = new Date()) {
  const last = lastFuelLog();
  const elapsedMinutes = minutesSinceLastFuel(now);
  const status = fuelGapStatus(elapsedMinutes);
  const statusText = status === "green"
    ? "Fuel gap is currently under control."
    : status === "amber"
      ? "Fuel gap is building. Plan fuel soon."
      : "High Risk fuel gap. Get fuel available now.";

  return {
    lastFuelled: last ? formatClock(last.date) : "No fuel logged",
    timeSinceFuel: Number.isFinite(elapsedMinutes) ? duration(elapsedMinutes) : "No fuel logged",
    minutesSinceFuel: elapsedMinutes,
    status,
    nextAction: statusText,
    statusContext: statusText
  };
}

function fuelTrackingDateLabel(now = new Date()) {
  return now.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function fuelDayEndSnapshot(now = new Date()) {
  const gap = fuelGapState();
  const endedAt = fuelLogDate(gap.dayEndedAt);
  const endedToday = Boolean(
    gap.dayEndedDate === todayKey(now) ||
    (endedAt && todayKey(endedAt) === todayKey(now))
  );

  return {
    dayEnded: endedToday,
    endTime: endedToday ? formatClock(endedAt) : "",
    fastingStarted: endedToday && Boolean(gap.fastingStartedAt)
  };
}

function fuelDaySummary(now = new Date()) {
  const logs = todaysFuelLogs(now);
  const last = logs[logs.length - 1] || null;
  const end = fuelDayEndSnapshot(now);
  const fuelLogText = `${logs.length} fuel log${logs.length === 1 ? "" : "s"}`;
  const lastFuelled = last ? formatClock(last.date) : "No fuel logged";
  const endText = end.dayEnded
    ? `Day ended at ${end.endTime}.`
    : "Today's tracking is still open.";

  return {
    date: fuelTrackingDateLabel(now),
    fuelLogs: logs.length,
    lastFuelled,
    dayEnded: end.dayEnded,
    endTime: end.endTime,
    message: `Today's fuelling summary: ${fuelLogText}. Last fuelled: ${lastFuelled}. ${endText}`
  };
}

function fuelGapDurationsToday(now = new Date()) {
  const logs = todaysFuelLogs(now);
  const gaps = [];

  for (let index = 1; index < logs.length; index += 1) {
    gaps.push((logs[index].date - logs[index - 1].date) / 60000);
  }

  if (logs.length) gaps.push((now - logs[logs.length - 1].date) / 60000);
  return gaps.filter(gap => Number.isFinite(gap) && gap >= 0);
}

function fuelGapInsight(now = new Date()) {
  const logs = todaysFuelLogs(now);
  const gaps = fuelGapDurationsToday(now);
  const redMinutes = Number(fuelGapState().thresholds?.redMinutes || FUEL_RED_LIMIT_MINUTES);

  return {
    longestGap: gaps.length ? Math.max(...gaps) : 0,
    confirmations: logs.length,
    highRiskGaps: gaps.filter(gap => gap >= redMinutes).length
  };
}

function addActivityEntry(key, label, { dedupeDaily = true } = {}) {
  if (!key || !label) return;

  state.activityHistory = Array.isArray(state.activityHistory) ? state.activityHistory : [];
  if (dedupeDaily) {
    state.activityHistory = state.activityHistory.filter(entry => {
      const sameDay = new Date(entry.date).toDateString() === new Date().toDateString();
      return !(sameDay && entry.key === key);
    });
  }

  state.activityHistory.push({
    key,
    label,
    date: new Date().toISOString()
  });
}

function recordFuelMomentum(key, activityLabel, message, options = {}) {
  state.fuelMomentum = {
    ...DEFAULT_STATE.fuelMomentum,
    ...(state.fuelMomentum || {}),
    lastMessage: message,
    lastDate: new Date().toISOString()
  };
  addActivityEntry(key, activityLabel, options);
}

function recordFuelled() {
  if (fuelDayEndSnapshot().dayEnded) return;

  fuelGapState().logs.push({
    id: uid(),
    timestamp: new Date().toISOString(),
    label: "Fuelled",
    type: "fuel"
  });
  state.completed.liveFuelStatus = true;
  recordFuelMomentum(
    "fuelLogged",
    "Fuel logged. Gap tracker updated.",
    "Fuel logged. Your fuel rhythm is up to date.",
    { dedupeDaily: false }
  );
  save();
  renderAll();
}

function endFuelDayAndStartFasting() {
  const now = new Date();
  const gap = fuelGapState();
  gap.dayEndedDate = todayKey(now);
  gap.dayEndedAt = now.toISOString();
  gap.fastingStartedAt = now.toISOString();
  addActivityEntry("fastingStarted", "Day ended. Fuel gap summary saved.", { dedupeDaily: true });
  save();
  renderAll();
}

function continueFuelDayTracking() {
  const wasEnded = fuelDayEndSnapshot().dayEnded;
  const gap = fuelGapState();
  gap.dayEndedDate = "";
  gap.dayEndedAt = "";
  gap.fastingStartedAt = "";

  if (wasEnded) addActivityEntry("fuelTrackingContinued", "Continued today's fuel tracking.", { dedupeDaily: true });
  save();
  renderAll();
}
