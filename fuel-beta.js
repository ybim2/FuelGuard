// Fuel Guard canonical mobile PWA layer.
// Focuses the app on real fuel and hydration logging, history, and settings.
(() => {
  const DEFAULT_THRESHOLDS = {
    greenMinutes: 150,
    redMinutes: 180,
    crashMinutes: 220,
    hydrationGreenMinutes: 90,
    hydrationRedMinutes: 120,
    hydrationCrashMinutes: 180
  };
  const FOOD_LOG_COOLDOWN_MS = 60000;
  const AUTH_EMAIL_COOLDOWN_MS = 60 * 60 * 1000;
  const AUTH_EMAIL_SENT_MESSAGE = "Email sent. Check your inbox before requesting another one.";
  const AUTH_RATE_LIMIT_MESSAGE = "Too many auth emails were requested while testing. Please wait around an hour before trying again.";
  const AUTH_EXISTING_ACCOUNT_MESSAGE = "This account may already exist. Try logging in, or wait before requesting another confirmation email.";
  const FUEL_CSV_REQUIRED_HEADERS = ["schema_version", "event_id", "event_type", "logged_at_iso", "logged_at_ms", "source", "device_id"];
  const FUEL_CSV_FUTURE_LIMIT_MS = 5 * 60 * 1000;
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
    { value: "rest", label: "No training" }
  ];
  const TRAINING_SESSION_LABELS = TRAINING_SESSION_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const GRAPH_MODES = new Set(["fuel", "hydration", "risk"]);
  const TREND_VIEWS = {
    fuel: {
      label: "Fuel",
      metric: "averageFuelGap",
      title: "Average fuel gap",
      unit: "minutes",
      threshold: 15,
      color: "#2dff88"
    },
    hydration: {
      label: "Hydration",
      metric: "averageHydrationGap",
      title: "Average hydration gap",
      unit: "minutes",
      threshold: 15,
      color: "#9fb7ff"
    },
    risk: {
      label: "High-risk periods",
      metric: "highRiskGaps",
      title: "High-risk periods",
      unit: "count",
      threshold: 0,
      color: "#ffb020"
    },
    crash: {
      label: "Crash events",
      metric: "crashEvents",
      title: "Crash events",
      unit: "count",
      threshold: 0,
      color: "#ff4d6d"
    }
  };
  const CRASH_NOTE = "fuel_guard_event:crash";
  const LONG_GAP_REASON_NOTE_PREFIX = "fuel_guard_long_gap_reason:";
  const LONG_GAP_REASON_OPTIONS = [
    { value: "focus_block", label: "Focus block" },
    { value: "busy_shift", label: "Busy shift" },
    { value: "forgot", label: "Forgot" },
    { value: "no_food_available", label: "No food available" },
    { value: "other", label: "Other" }
  ];
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
  let selectedTrendDayType = "all";
  let selectedTrendTrainingSession = "all";
  let selectedTrendView = "fuel";
  let accountBusy = false;
  let csvImportBusy = false;
  let csvImportPreview = null;
  let csvImportStatus = "";
  let latestTrendGraphData = null;
  let pendingLongGapReasonPrompt = null;

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

  function accountState() {
    state.account = {
      email: "",
      status: "",
      signupCooldownUntil: 0,
      resetCooldownUntil: 0,
      ...(state.account || {})
    };
    return state.account;
  }

  function authCooldownRemainingMs(kind) {
    const key = kind === "signup" ? "signupCooldownUntil" : "resetCooldownUntil";
    const until = Number(accountState()[key] || 0);
    return Math.max(0, until - Date.now());
  }

  function formatAuthCooldown(ms) {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    if (minutes >= 60) return "about an hour";
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  function authCooldownStatus() {
    const signupMs = authCooldownRemainingMs("signup");
    const resetMs = authCooldownRemainingMs("reset");
    if (signupMs > 0 && resetMs > 0) {
      return `${AUTH_EMAIL_SENT_MESSAGE} You can request another account or reset email in ${formatAuthCooldown(Math.max(signupMs, resetMs))}.`;
    }
    if (signupMs > 0) {
      return `Confirmation email sent. Check your inbox. You can request another confirmation email in ${formatAuthCooldown(signupMs)}.`;
    }
    if (resetMs > 0) {
      return `Reset email sent. You can request another later. You can request another reset email in ${formatAuthCooldown(resetMs)}.`;
    }
    return "";
  }

  function startAuthEmailCooldown(kind) {
    const account = accountState();
    const key = kind === "signup" ? "signupCooldownUntil" : "resetCooldownUntil";
    account[key] = Date.now() + AUTH_EMAIL_COOLDOWN_MS;
    account.status = "";
    save();
  }

  function normalizedAuthErrorText(error) {
    if (typeof error === "string") return error.toLowerCase();
    return [
      error?.code,
      error?.error_code,
      error?.name,
      error?.message,
      error?.error_description
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function isAuthRateLimitError(error) {
    const text = normalizedAuthErrorText(error);
    return Number(error?.status) === 429
      || text.includes("over_email_send_rate_limit")
      || text.includes("over_request_rate_limit")
      || text.includes("rate limit exceeded")
      || text.includes("email rate limit exceeded")
      || text.includes("account creation limit exceeded")
      || text.includes("password reset email exceeded")
      || text.includes("too many");
  }

  function isExistingAccountError(error) {
    const text = normalizedAuthErrorText(error);
    return text.includes("email_exists")
      || text.includes("user_already_exists")
      || text.includes("identity_already_exists")
      || text.includes("already exists")
      || text.includes("already registered")
      || (text.includes("confirmation") && text.includes("already"));
  }

  function parseCsvLine(line) {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(value);
        value = "";
      } else {
        value += char;
      }
    }
    cells.push(value);
    return cells.map(cell => cell.trim());
  }

  function parseFuelCsvText(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
    const headerIndex = lines.findIndex(line => line.trim());
    if (headerIndex < 0) return { recognized: false, rows: [] };
    const headers = parseCsvLine(lines[headerIndex]).map(header => header.trim());
    const missing = FUEL_CSV_REQUIRED_HEADERS.filter(header => !headers.includes(header));
    if (missing.length) return { recognized: false, rows: [] };

    const rows = [];
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      if (!lines[index].trim()) continue;
      const cells = parseCsvLine(lines[index]);
      const row = { __line: index + 1 };
      headers.forEach((header, cellIndex) => {
        row[header] = cells[cellIndex] || "";
      });
      rows.push(row);
    }
    return { recognized: true, rows };
  }

  function timestampFromFuelCsvRow(row, now = new Date()) {
    const isoText = String(row.logged_at_iso || "").trim();
    let date = null;
    if (isoText) {
      date = logDate(isoText);
      if (!date) return null;
    } else {
      const ms = Number(String(row.logged_at_ms || "").trim());
      date = Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
    }
    if (!date || Number.isNaN(date.getTime())) return null;
    if (date.getTime() - now.getTime() > FUEL_CSV_FUTURE_LIMIT_MS) return null;
    return date.toISOString();
  }

  function importHashParts(input) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    let h3 = 0xc0decafe;
    let h4 = 0xfeedface;
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
      h3 = Math.imul(h3 ^ code, 2246822507);
      h4 = Math.imul(h4 ^ code, 3266489909);
    }
    h1 = Math.imul(h1 ^ h1 >>> 16, 2246822507) ^ Math.imul(h2 ^ h2 >>> 13, 3266489909);
    h2 = Math.imul(h2 ^ h2 >>> 16, 2246822507) ^ Math.imul(h3 ^ h3 >>> 13, 3266489909);
    h3 = Math.imul(h3 ^ h3 >>> 16, 2246822507) ^ Math.imul(h4 ^ h4 >>> 13, 3266489909);
    h4 = Math.imul(h4 ^ h4 >>> 16, 2246822507) ^ Math.imul(h1 ^ h1 >>> 13, 3266489909);
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  function deterministicImportUuid(key) {
    const bytes = [];
    importHashParts(key).forEach(part => {
      bytes.push(part >>> 24 & 255, part >>> 16 & 255, part >>> 8 & 255, part & 255);
    });
    bytes[6] = bytes[6] & 15 | 80;
    bytes[8] = bytes[8] & 63 | 128;
    const hex = bytes.map(byte => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  function importKeyForCsvRow(row, timestamp) {
    const eventId = String(row.event_id || "").trim();
    if (eventId) return `event:${eventId}`;
    const source = String(row.source || "").trim();
    const deviceId = String(row.device_id || "").trim();
    return `fallback:${timestamp}|${source}|${deviceId}`;
  }

  function existingFuelImportKeys() {
    const keys = new Set();
    betaState().logs.forEach(log => {
      const id = log.cloudId || log.id;
      if (id) keys.add(`id:${id}`);
      if (log.importEventId) keys.add(`event:${log.importEventId}`);
      const date = logDate(log);
      if (date && (log.importSource || log.importDeviceId)) {
        keys.add(`fallback:${date.toISOString()}|${log.importSource || ""}|${log.importDeviceId || ""}`);
      }
    });
    return keys;
  }

  function buildFuelCsvImportPreview(csvText, options = {}) {
    const parsed = parseFuelCsvText(csvText);
    if (!parsed.recognized) return { recognized: false, logs: [], duplicateCount: 0, invalidCount: 0 };

    const now = options.now || new Date();
    const seen = existingFuelImportKeys();
    const logs = [];
    let duplicateCount = 0;
    let invalidCount = 0;

    parsed.rows.forEach(row => {
      if (row.event_type !== "FUEL_LOG") {
        invalidCount += 1;
        return;
      }
      const timestamp = timestampFromFuelCsvRow(row, now);
      if (!timestamp) {
        invalidCount += 1;
        return;
      }
      const importKey = importKeyForCsvRow(row, timestamp);
      const id = deterministicImportUuid(importKey);
      const idKey = `id:${id}`;
      if (seen.has(importKey) || seen.has(idKey)) {
        duplicateCount += 1;
        return;
      }
      seen.add(importKey);
      seen.add(idKey);
      const key = dateKey(logDate(timestamp));
      logs.push({
        id,
        timestamp,
        label: "Fuelled",
        type: "fuel",
        source: "csv_import",
        dayType: dayTypeForKey(key),
        trainingSession: trainingSessionForKey(key),
        importEventId: String(row.event_id || "").trim(),
        importSource: String(row.source || "").trim(),
        importDeviceId: String(row.device_id || "").trim(),
        syncStatus: "pending"
      });
    });

    const dates = logs.map(log => logDate(log)).filter(Boolean).sort((a, b) => a - b);
    return {
      recognized: true,
      logs,
      validCount: logs.length,
      duplicateCount,
      invalidCount,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null
    };
  }

  async function importFuelLogsFromCsv(file) {
    const text = await file.text();
    return buildFuelCsvImportPreview(text);
  }

  window.fuelGuardCsvImport = {
    importFuelLogsFromCsv,
    buildFuelCsvImportPreview
  };

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
    const hasCrashThreshold = Number.isFinite(Number(gap.thresholds.crashMinutes));
    if (!hasCrashThreshold && Number(gap.thresholds.greenMinutes) === 180 && Number(gap.thresholds.redMinutes) === 300) {
      gap.thresholds = { ...gap.thresholds, ...DEFAULT_THRESHOLDS };
    }
    gap.thresholds.greenMinutes = Number(gap.thresholds.greenMinutes || DEFAULT_THRESHOLDS.greenMinutes);
    gap.thresholds.redMinutes = Number(gap.thresholds.redMinutes || DEFAULT_THRESHOLDS.redMinutes);
    gap.thresholds.crashMinutes = Number(gap.thresholds.crashMinutes || DEFAULT_THRESHOLDS.crashMinutes);
    gap.thresholds.hydrationGreenMinutes = Number(gap.thresholds.hydrationGreenMinutes || DEFAULT_THRESHOLDS.hydrationGreenMinutes);
    gap.thresholds.hydrationRedMinutes = Number(gap.thresholds.hydrationRedMinutes || DEFAULT_THRESHOLDS.hydrationRedMinutes);
    gap.thresholds.hydrationCrashMinutes = Number(gap.thresholds.hydrationCrashMinutes || DEFAULT_THRESHOLDS.hydrationCrashMinutes);
    if (gap.thresholds.redMinutes <= gap.thresholds.greenMinutes) gap.thresholds.redMinutes = gap.thresholds.greenMinutes + 30;
    if (gap.thresholds.crashMinutes <= gap.thresholds.redMinutes) gap.thresholds.crashMinutes = gap.thresholds.redMinutes + 15;
    if (gap.thresholds.hydrationRedMinutes <= gap.thresholds.hydrationGreenMinutes) gap.thresholds.hydrationRedMinutes = gap.thresholds.hydrationGreenMinutes + 15;
    if (gap.thresholds.hydrationCrashMinutes <= gap.thresholds.hydrationRedMinutes) gap.thresholds.hydrationCrashMinutes = gap.thresholds.hydrationRedMinutes + 15;
    if (!GRAPH_MODES.has(gap.graphMode)) gap.graphMode = "fuel";
    normalizeStoredDayTypes(gap);
    return gap;
  }

  function thresholds() {
    return betaState().thresholds;
  }

  fuelGapStatus = function fuelGapStatusBeta(minutes) {
    const limits = thresholds();
    if (!Number.isFinite(minutes)) return "crash";
    if (minutes < limits.greenMinutes) return "green";
    if (minutes < limits.redMinutes) return "amber";
    if (minutes < limits.crashMinutes) return "red";
    return "crash";
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

  function hoursValue(minutes) {
    const value = Number(minutes || 0) / 60;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function minutesFromHoursField(id, fallbackMinutes, { min = 15, max = 720 } = {}) {
    const raw = Number(document.getElementById(id)?.value);
    const minutes = Number.isFinite(raw) ? Math.round(raw * 60) : fallbackMinutes;
    return clamp(minutes, min, max);
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
    if (type === "crash" || String(log?.note || log?.notes || "").includes(CRASH_NOTE)) return "crash";
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

  function isCrashLog(log) {
    return logType(log) === "crash";
  }

  function logTypeLabel(log) {
    const type = logType(log);
    if (type === "hydration") return "Hydration";
    if (type === "fuel_hydration") return "Fuel + Hydration";
    if (type === "crash") return "Low energy event";
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
    return GRAPH_MODES.has(betaState().graphMode) ? betaState().graphMode : "fuel";
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

  function gapsFromHydrationLogs(logs, referenceTime = new Date(), includeTrailing = false, trailingIsOngoing = false) {
    const sorted = [...logs].filter(isHydrationLog).sort((a, b) => a.date - b.date);
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

  function fuelDebtDurationText(minutes) {
    const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}m`;
  }

  function fuelDebtFromGaps(gaps) {
    const preferredWindow = mediumRiskLimit();
    return (Array.isArray(gaps) ? gaps : []).reduce((total, gap) => {
      const minutes = Number(gap?.minutes || 0);
      return total + Math.max(0, minutes - preferredWindow);
    }, 0);
  }

  function fuelDebtSentence(minutes) {
    const debtMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    return debtMinutes > 0
      ? `You spent ${fuelDebtDurationText(debtMinutes)} beyond your preferred fuelling window.`
      : "You stayed inside your preferred fuelling window.";
  }

  function likelyCostWindow({ fuelDebtMinutes = 0, dayType = "", hasHighRisk = false, isToday = false, now = new Date() } = {}) {
    if (Math.round(Number(fuelDebtMinutes || 0)) <= 0) return "stable for now";
    const windows = [];
    if (hasHighRisk) windows.push("later today");
    const minute = minutesIntoDay(now);
    const nearShift = isToday && minute >= 7 * 60 && minute <= 20 * 60;
    if (dayType === "work" || nearShift) windows.push("post-shift");
    return windows.length ? [...new Set(windows)].join(" / ") : "later today";
  }

  function longGapReasonOption(value) {
    return LONG_GAP_REASON_OPTIONS.find(option => option.value === value) || null;
  }

  function longGapReasonValueFromLog(log) {
    const explicit = String(log?.longGapReason || "").trim();
    if (longGapReasonOption(explicit)) return explicit;
    const note = String(log?.note || log?.notes || "");
    if (!note.includes(LONG_GAP_REASON_NOTE_PREFIX)) return "";
    const value = note.split(LONG_GAP_REASON_NOTE_PREFIX)[1]?.split(/[;\n]/)[0]?.trim() || "";
    return longGapReasonOption(value) ? value : "";
  }

  function longGapReasonLabelFromLog(log) {
    const option = longGapReasonOption(longGapReasonValueFromLog(log));
    return option?.label || "";
  }

  function longGapReasonNote(value) {
    return `${LONG_GAP_REASON_NOTE_PREFIX}${value}`;
  }

  function displayNoteForLog(log) {
    const reasonLabel = longGapReasonLabelFromLog(log);
    if (reasonLabel) return `Long gap reason: ${reasonLabel}`;
    const note = String(log?.note || log?.notes || "");
    if (!note || note.includes(CRASH_NOTE)) return "";
    return note.includes(LONG_GAP_REASON_NOTE_PREFIX) ? "" : note;
  }

  function longGapReasonPatternText(reasonValue) {
    if (reasonValue === "focus_block") return "Most long gaps were intentional focus blocks.";
    if (reasonValue === "busy_shift") return "Most long gaps were caused by busy shifts.";
    if (reasonValue === "forgot") return "Most long gaps were caused by forgetting.";
    if (reasonValue === "no_food_available") return "Most long gaps happened when no food was available.";
    if (reasonValue === "other") return "Most long gaps were marked as other.";
    return "";
  }

  function longGapReasonFollowUp(reasonValue) {
    if (reasonValue === "focus_block") return "Your focus block may have worked, but the fuel debt likely showed up later.";
    if (reasonValue === "busy_shift") return "Busy shift gap logged. This is where post-shift crashes often start.";
    if (reasonValue === "forgot") return "Forgotten fuel gap logged. This is the pattern Fuel Guard is designed to catch.";
    if (reasonValue === "no_food_available") return "No food available. This is a logistics issue, not a discipline issue.";
    if (reasonValue === "other") return "Long gap logged. Watch for the cost window later.";
    return "";
  }

  function topLongGapReason(logs) {
    const counts = {};
    (Array.isArray(logs) ? logs : []).forEach(log => {
      const value = longGapReasonValueFromLog(log);
      if (!value) return;
      counts[value] = (counts[value] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || null;
    return {
      counts,
      value: top?.[0] || "",
      label: top ? longGapReasonOption(top[0])?.label || top[0] : "",
      count: top?.[1] || 0
    };
  }

  function fuelDebtLevel(minutes) {
    const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    if (safeMinutes <= 0) return "stable";
    if (safeMinutes < 60) return "mild";
    if (safeMinutes < 120) return "medium";
    return "high";
  }

  function crashCostInsight({ fuelDebtMinutes = 0, likelyCostWindow: costWindow = "stable for now", topLongGapReason = "", hasCrash = false } = {}) {
    const debtText = fuelDebtDurationText(fuelDebtMinutes);
    const level = fuelDebtLevel(fuelDebtMinutes);
    const lines = [`Fuel debt: ${debtText}`, `Likely cost window: ${costWindow || "stable for now"}`];

    if (level === "stable") {
      lines.push("You stayed inside your preferred fuelling window.");
    } else {
      lines.push(`You spent ${debtText} beyond your preferred fuelling window.`);
      if (level === "mild") {
        lines.push("Crash risk is starting to build.");
        lines.push("You pushed past your target fuel window. This is where the crash risk starts to build.");
      } else if (level === "medium") {
        lines.push("Crash risk is building and may show up later today.");
        lines.push("Today’s crash risk came from time spent beyond your fuel window, not from one bad moment.");
      } else {
        lines.push("Fuel debt built quietly today. The cost is usually paid later.");
        lines.push("Today’s crash risk came from time spent beyond your fuel window, not from one bad moment.");
      }
    }

    const reasonFollowUp = longGapReasonFollowUp(topLongGapReason);
    if (reasonFollowUp) lines.push(reasonFollowUp);
    if (hasCrash && level !== "stable") lines.push("A low-energy event was marked, so this pattern is worth watching without treating it as medical proof.");

    return {
      title: "Crash Cost Insight",
      level,
      debtText,
      costWindow: costWindow || "stable for now",
      lines
    };
  }

  function riskLimit() {
    return thresholds().redMinutes;
  }

  function mediumRiskLimit() {
    return thresholds().greenMinutes;
  }

  function crashRiskLimit() {
    return thresholds().crashMinutes;
  }

  function hydrationGreenLimit() {
    return thresholds().hydrationGreenMinutes;
  }

  function hydrationRiskLimit() {
    return thresholds().hydrationRedMinutes;
  }

  function hydrationCrashRiskLimit() {
    return thresholds().hydrationCrashMinutes;
  }

  function riskStatusLabel(status) {
    if (status === "green") return "Low Risk";
    if (status === "amber") return "Medium Risk";
    if (status === "red") return "High Risk";
    return "Fuel Crash Zone / Under-fuelled Zone";
  }

  function riskZone(score) {
    if (score <= 30) return { label: "Low risk", tone: "green" };
    if (score <= 60) return { label: "Medium risk", tone: "amber" };
    if (score <= 80) return { label: "High risk", tone: "red" };
    return { label: "Fuel / Hydration Crash Zone", tone: "crash" };
  }

  function scoreFromGap(minutes, greenMinutes, redMinutes, crashMinutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return 0;
    if (minutes <= greenMinutes) return clamp((minutes / Math.max(1, greenMinutes)) * 30, 0, 30);
    if (minutes <= redMinutes) {
      return 30 + ((minutes - greenMinutes) / Math.max(1, redMinutes - greenMinutes)) * 30;
    }
    if (minutes <= crashMinutes) {
      return 60 + ((minutes - redMinutes) / Math.max(1, crashMinutes - redMinutes)) * 20;
    }
    return clamp(80 + ((minutes - crashMinutes) / Math.max(1, crashMinutes * 0.35)) * 20, 80, 100);
  }

  function riskScoreForGaps(fuelMinutes, hydrationMinutes) {
    const fuelScore = scoreFromGap(fuelMinutes, thresholds().greenMinutes, riskLimit(), crashRiskLimit());
    const hydrationScore = scoreFromGap(hydrationMinutes, hydrationGreenLimit(), hydrationRiskLimit(), hydrationCrashRiskLimit());
    return Math.round(clamp(Math.max(fuelScore, hydrationScore * 0.88), 0, 100));
  }

  function riskSamplesForDay(key, { now = new Date(), endedAt = "" } = {}) {
    const logs = logsForDay(key).filter(log => log.date);
    const fuelLogs = logs.filter(isFuelLog).sort((a, b) => a.date - b.date);
    const hydrationLogs = logs.filter(isHydrationLog).sort((a, b) => a.date - b.date);
    const crashLogs = logs.filter(isCrashLog).sort((a, b) => a.date - b.date);
    const endedDate = endedAt ? logDate(endedAt) : null;
    const isToday = key === dateKey(now);
    const endDate = endedDate || (isToday ? now : logs[logs.length - 1]?.date || dateFromKey(key));
    const endMinute = clamp(minutesIntoDay(endDate), 0, 1440);
    const samples = [];
    let fuelIndex = 0;
    let hydrationIndex = 0;
    let crashIndex = 0;
    let lastFuel = null;
    let lastHydration = null;

    for (let minute = 0; minute <= Math.max(0, endMinute); minute += 30) {
      const pointDate = addMinutes(startOfDay(dateFromKey(key)), minute);
      while (fuelIndex < fuelLogs.length && minutesIntoDay(fuelLogs[fuelIndex].date) <= minute) lastFuel = fuelLogs[fuelIndex++].date;
      while (hydrationIndex < hydrationLogs.length && minutesIntoDay(hydrationLogs[hydrationIndex].date) <= minute) lastHydration = hydrationLogs[hydrationIndex++].date;
      while (crashIndex < crashLogs.length && minutesIntoDay(crashLogs[crashIndex].date) <= minute) crashIndex += 1;
      const fuelGap = lastFuel ? (pointDate - lastFuel) / 60000 : Infinity;
      const hydrationGap = lastHydration ? (pointDate - lastHydration) / 60000 : Infinity;
      const base = riskScoreForGaps(fuelGap, hydrationGap);
      const nearbyCrash = crashLogs.some(log => Math.abs(minutesIntoDay(log.date) - minute) <= 15);
      samples.push({ minute, score: nearbyCrash ? 100 : base });
    }
    return samples;
  }

  function maxRiskScoreForDay(key, options = {}) {
    const samples = riskSamplesForDay(key, options);
    return samples.length ? Math.max(...samples.map(sample => sample.score)) : 0;
  }

  function dayNameForKey(key) {
    return dateFromKey(key).toLocaleDateString(undefined, { weekday: "long" });
  }

  function consistencyCopy(fuelLongest, hydrationLongest) {
    if (!Number.isFinite(fuelLongest) && !Number.isFinite(hydrationLongest)) return "Fuel and hydration both need more logs before consistency is clear.";
    if (!Number.isFinite(hydrationLongest) || hydrationLongest <= 0) return "Fuel timing is clearer than hydration because hydration has fewer logs.";
    if (!Number.isFinite(fuelLongest) || fuelLongest <= 0) return "Hydration timing is clearer than fuel because fuel has fewer logs.";
    if (hydrationLongest + 30 < fuelLongest) return "Hydration was more consistent than fuel.";
    if (fuelLongest + 30 < hydrationLongest) return "Fuel was more consistent than hydration.";
    return "Fuel and hydration consistency looked similar.";
  }

  function analyseDay(key, { now = new Date(), endedAt = "" } = {}) {
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const crashLogs = logs.filter(isCrashLog);
    const endedDate = endedAt ? logDate(endedAt) : null;
    const isToday = key === dateKey(now);
    const reference = endedDate || (isToday ? now : logs[logs.length - 1]?.date || dateFromKey(key));
    const gaps = gapsFromFuelLogs(fuelLogs, reference, Boolean(endedDate) || isToday, !endedDate && isToday);
    const hydrationGaps = gapsFromHydrationLogs(hydrationLogs, reference, Boolean(endedDate) || isToday, !endedDate && isToday);
    const completedGaps = gaps.filter(gap => !gap.ongoing);
    const mediumRiskGaps = gaps.filter(gap => gap.minutes >= mediumRiskLimit());
    const mediumRiskHydrationGaps = hydrationGaps.filter(gap => gap.minutes >= hydrationGreenLimit());
    const highRiskGaps = gaps.filter(gap => gap.minutes >= riskLimit());
    const highRiskHydrationGaps = hydrationGaps.filter(gap => gap.minutes >= hydrationRiskLimit());
    const crashZoneGaps = gaps.filter(gap => gap.minutes >= crashRiskLimit());
    const hydrationCrashZoneGaps = hydrationGaps.filter(gap => gap.minutes >= hydrationCrashRiskLimit());
    const completedHighRiskGaps = completedGaps.filter(gap => gap.minutes >= riskLimit());
    const longest = gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : 0;
    const average = gaps.length ? gaps.reduce((sum, gap) => sum + gap.minutes, 0) / gaps.length : 0;
    const longestHydration = hydrationGaps.length ? Math.max(...hydrationGaps.map(gap => gap.minutes)) : 0;
    const averageHydration = hydrationGaps.length ? hydrationGaps.reduce((sum, gap) => sum + gap.minutes, 0) / hydrationGaps.length : 0;
    const firstHighRiskGap = highRiskGaps[0] || null;
    const highRiskStart = firstHighRiskGap ? addMinutes(firstHighRiskGap.start, riskLimit()) : null;
    const reactive = completedHighRiskGaps.length > 0 && completedHighRiskGaps.length >= Math.ceil(Math.max(1, completedGaps.length) / 2);
    const firstFuel = fuelLogs[0] || null;
    const lastFuel = fuelLogs[fuelLogs.length - 1] || null;
    const dayType = dayTypeForKey(key);
    const trainingSession = trainingSessionForKey(key);
    const fuelDebtMinutes = Math.round(fuelDebtFromGaps(gaps));
    const fuelDebtCopy = fuelDebtSentence(fuelDebtMinutes);
    const costWindow = likelyCostWindow({
      fuelDebtMinutes,
      dayType,
      hasHighRisk: highRiskGaps.length > 0 || crashZoneGaps.length > 0,
      isToday,
      now
    });
    const reasonPattern = topLongGapReason(fuelLogs);
    const crashCost = crashCostInsight({
      fuelDebtMinutes,
      likelyCostWindow: costWindow,
      topLongGapReason: reasonPattern.value,
      hasCrash: crashLogs.length > 0
    });
    const strongestGap = [...gaps, ...hydrationGaps].sort((a, b) => b.minutes - a.minutes)[0] || null;
    const vulnerableWindow = strongestGap ? timeWindowBucket(minutesIntoDay(strongestGap.start) + strongestGap.minutes / 2) : "Needs more data";
    const maxRiskScore = maxRiskScoreForDay(key, { now, endedAt });
    const risk = riskZone(maxRiskScore);
    const summary = [];
    const fuelGapSentence = longest
      ? `Your longest fuel gap was ${duration(longest)}${crashZoneGaps.length ? ", which reached the Fuel Crash Zone" : highRiskGaps.length ? ", which entered High Risk" : mediumRiskGaps.length ? ", which reached Medium Risk" : ""}.`
      : fuelLogs.length ? "More fuel logs are needed before Fuel Guard can calculate fuel gaps." : "No fuel logs were recorded.";
    const hydrationSentence = longestHydration
      ? `Your longest hydration gap was ${duration(longestHydration)}${hydrationCrashZoneGaps.length ? ", which reached the Hydration Crash Zone / Under-hydrated Zone" : highRiskHydrationGaps.length ? ", which entered High Risk" : mediumRiskHydrationGaps.length ? ", which reached Medium Risk" : ""}.`
      : hydrationLogs.length ? "More hydration logs are needed before Fuel Guard can calculate hydration gaps." : "No hydration logs were recorded.";
    const crashSentence = crashLogs.length
      ? `${crashLogs.length} low-energy event${crashLogs.length === 1 ? " was" : "s were"} marked.`
      : "No bonking or crash event was marked.";
    const plainSummary = `On ${dayNameForKey(key)}, you logged fuel ${fuelLogs.length} time${fuelLogs.length === 1 ? "" : "s"} and hydration ${hydrationLogs.length} time${hydrationLogs.length === 1 ? "" : "s"}. ${fuelGapSentence} ${fuelDebtCopy} Likely cost window: ${costWindow}. ${consistencyCopy(longest || null, longestHydration || null)} ${crashSentence}`;
    summary.push(plainSummary);
    if (mediumRiskGaps.length || mediumRiskHydrationGaps.length) summary.push("Medium Risk nudges appeared before the serious warning zone.");
    if (highRiskGaps.length) summary.push("High-risk fuel gaps were present, so the day had avoidable risk windows.");
    if (highRiskHydrationGaps.length) summary.push("Hydration gaps also became stretched, which may have amplified the day’s risk.");
    if (crashZoneGaps.length) summary.push("Fuel reached the Crash Zone / Under-fuelled Zone after High Risk.");
    if (hydrationCrashZoneGaps.length) summary.push("Hydration reached the Crash Zone / Under-hydrated Zone after High Risk.");
    const reasonSummary = longGapReasonPatternText(reasonPattern.value);
    if (reasonSummary) summary.push(reasonSummary);
    crashCost.lines.slice(2).forEach(line => {
      if (line && !summary.includes(line)) summary.push(line);
    });
    if (reactive) summary.push("This looks like a reactive fuelling day rather than a planned fuelling day.");
    if (isTrainingDayValue(dayType, trainingSession) && (highRiskGaps.length || crashLogs.length)) {
      summary.push(`${trainingSessionLabel(trainingSession)} days need earlier fuel access before gaps turn into real-world crashes.`);
    }
    if (fuelLogs.length < 3 && hydrationLogs.length < 3) summary.push("More logs will make this day easier to explain.");

    const bullets = [
      { label: "Longest fuel gap", value: durationText(longest) },
      { label: "Fuel Debt", value: fuelDebtDurationText(fuelDebtMinutes) },
      { label: "Likely cost window", value: costWindow },
      { label: "Longest hydration gap", value: durationText(longestHydration) },
      { label: "Medium Risk nudges", value: String(mediumRiskGaps.length + mediumRiskHydrationGaps.length) },
      { label: "High-risk gaps", value: String(highRiskGaps.length + highRiskHydrationGaps.length) },
      { label: "Crash-zone gaps", value: String(crashZoneGaps.length + hydrationCrashZoneGaps.length) },
      { label: "Most vulnerable window", value: vulnerableWindow },
      { label: "Bonking/crash reported", value: crashLogs.length ? "Yes" : "No" },
      { label: "Estimated peak risk", value: `${maxRiskScore}/100 ${risk.label}` }
    ];

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
      crashLogs,
      firstFuelTime: firstFuel ? formatClock(firstFuel.date) : "Not logged",
      lastFuelTime: lastFuel ? formatClock(lastFuel.date) : "Not logged",
      firstFuelMinute: firstFuel ? minutesIntoDay(firstFuel.date) : null,
      lastFuelMinute: lastFuel ? minutesIntoDay(lastFuel.date) : null,
      fuelLogCount: fuelLogs.length,
      hydrationLogCount: hydrationLogs.length,
      crashLogCount: crashLogs.length,
      gaps,
      hydrationGaps,
      longestGapMinutes: longest,
      averageGapMinutes: average,
      fuelDebtMinutes,
      fuelDebtText: fuelDebtDurationText(fuelDebtMinutes),
      fuelDebtCopy,
      likelyCostWindow: costWindow,
      crashCostInsight: crashCost,
      longGapReasonCounts: reasonPattern.counts,
      topLongGapReason: reasonPattern.value,
      topLongGapReasonLabel: reasonPattern.label,
      longestHydrationGapMinutes: longestHydration,
      averageHydrationGapMinutes: averageHydration,
      mediumRiskGapCount: mediumRiskGaps.length,
      mediumRiskHydrationGapCount: mediumRiskHydrationGaps.length,
      longGapCount: highRiskGaps.length,
      highRiskGapCount: highRiskGaps.length,
      highRiskHydrationGapCount: highRiskHydrationGaps.length,
      crashZoneGapCount: crashZoneGaps.length,
      hydrationCrashZoneGapCount: hydrationCrashZoneGaps.length,
      highRiskStartMinute: highRiskStart ? minutesIntoDay(highRiskStart) : null,
      highRiskEndMinute: firstHighRiskGap ? minutesIntoDay(firstHighRiskGap.end) : null,
      highRiskWindow: firstHighRiskGap && highRiskStart ? `${formatClock(highRiskStart)}-${formatClock(firstHighRiskGap.end)}` : "Not detected",
      vulnerableWindow,
      maxRiskScore,
      riskLabel: risk.label,
      reactive,
      endedAt: endedDate ? endedDate.toISOString() : "",
      plainSummary,
      bullets,
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
      crashLogCount: analysis.crashLogCount,
      logs: analysis.logs.map(log => ({
        id: log.id || uid(),
        timestamp: log.date.toISOString(),
        type: logType(log),
        typeLabel: logTypeLabel(log),
        dayType: log.dayType || analysis.dayType,
        trainingSession: log.trainingSession || analysis.trainingSession,
        longGapReason: longGapReasonValueFromLog(log),
        longGapReasonLabel: longGapReasonLabelFromLog(log),
        longGapMinutes: Number(log.longGapMinutes || 0),
        note: String(log.note || "").includes(CRASH_NOTE) ? "" : log.note || ""
      })),
      gapMinutes: analysis.gaps.map(gap => Math.max(0, Math.round(gap.minutes))).filter(Number.isFinite),
      hydrationGapMinutes: analysis.hydrationGaps.map(gap => Math.max(0, Math.round(gap.minutes))).filter(Number.isFinite),
      longestGapMinutes: analysis.longestGapMinutes,
      averageGapMinutes: analysis.averageGapMinutes,
      fuelDebtMinutes: analysis.fuelDebtMinutes,
      fuelDebtText: analysis.fuelDebtText,
      fuelDebtCopy: analysis.fuelDebtCopy,
      likelyCostWindow: analysis.likelyCostWindow,
      crashCostInsight: analysis.crashCostInsight,
      longGapReasonCounts: analysis.longGapReasonCounts,
      topLongGapReason: analysis.topLongGapReason,
      topLongGapReasonLabel: analysis.topLongGapReasonLabel,
      longestHydrationGapMinutes: analysis.longestHydrationGapMinutes,
      averageHydrationGapMinutes: analysis.averageHydrationGapMinutes,
      mediumRiskGapCount: analysis.mediumRiskGapCount,
      mediumRiskHydrationGapCount: analysis.mediumRiskHydrationGapCount,
      longGapCount: analysis.longGapCount,
      highRiskGapCount: analysis.highRiskGapCount,
      highRiskHydrationGapCount: analysis.highRiskHydrationGapCount,
      crashZoneGapCount: analysis.crashZoneGapCount,
      hydrationCrashZoneGapCount: analysis.hydrationCrashZoneGapCount,
      longestGap: durationText(analysis.longestGapMinutes),
      averageGap: durationText(analysis.averageGapMinutes),
      longestHydrationGap: durationText(analysis.longestHydrationGapMinutes),
      averageHydrationGap: durationText(analysis.averageHydrationGapMinutes),
      highRiskStartMinute: analysis.highRiskStartMinute,
      highRiskEndMinute: analysis.highRiskEndMinute,
      highRiskWindow: analysis.highRiskWindow,
      vulnerableWindow: analysis.vulnerableWindow,
      maxRiskScore: analysis.maxRiskScore,
      riskLabel: analysis.riskLabel,
      reactive: analysis.reactive,
      plainSummary: analysis.plainSummary,
      bullets: analysis.bullets,
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
      ? "Fuel rhythm is currently under control."
      : status === "amber"
        ? "Medium Risk: maybe have a snack now."
        : status === "red"
          ? "High Risk: you are likely very hungry and the fuel gap is risky."
          : "Fuel Crash Zone / Under-fuelled Zone: you may have gone too long. Refuel and recover now.";

    return {
      lastFuelled: last ? formatClock(last.date) : "No fuel logged",
      timeSinceFuel: Number.isFinite(minutes) ? duration(minutes) : "No fuel logged",
      minutesSinceFuel: minutes,
      status,
      statusLabel: riskStatusLabel(status),
      nextAction: `Current Fuel Zone: ${riskStatusLabel(status)} - ${statusText}`,
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
      message: `${fuelLogs.length} fuel log${fuelLogs.length === 1 ? "" : "s"}. Last fuel: ${last ? formatClock(last.date) : "No fuel logged"}. Day type: ${dayTypeLabel(dayType)}. Tracking is open.`
    };
  };

  function renderLongGapReasonPrompt() {
    const prompt = document.getElementById("longGapReasonPrompt");
    if (!prompt) return;
    prompt.hidden = !pendingLongGapReasonPrompt;
  }

  function showLongGapReasonPrompt(log, gapMinutes) {
    if (!log?.id) return;
    pendingLongGapReasonPrompt = {
      logId: log.id,
      cloudId: log.cloudId || "",
      gapMinutes: Math.max(0, Math.round(gapMinutes || 0))
    };
    renderLongGapReasonPrompt();
  }

  function clearLongGapReasonPrompt() {
    pendingLongGapReasonPrompt = null;
    renderLongGapReasonPrompt();
  }

  function pendingLongGapLog() {
    if (!pendingLongGapReasonPrompt) return null;
    const { logId, cloudId } = pendingLongGapReasonPrompt;
    return betaState().logs.find(log => log.id === logId || log.localId === logId || log.cloudId === logId || log.id === cloudId || log.cloudId === cloudId) || null;
  }

  function applyLongGapReason(value) {
    const option = longGapReasonOption(value);
    const log = option ? pendingLongGapLog() : null;
    if (!log) {
      clearLongGapReasonPrompt();
      return;
    }
    log.longGapReason = option.value;
    log.longGapReasonLabel = option.label;
    log.longGapMinutes = pendingLongGapReasonPrompt?.gapMinutes || log.longGapMinutes || 0;
    log.note = longGapReasonNote(option.value);
    log.syncStatus = "pending";
    const date = logDate(log);
    if (date) storeArchive(dateKey(date));
    clearLongGapReasonPrompt();
    save();
    renderAll();
    window.fuelGuardCloud?.saveLog(log);
  }

  function recordRhythmLog(type = "fuel", options = {}) {
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

    const loggedAt = new Date();
    const previousFuel = includesFuel ? lastFuelLog() : null;
    const previousGapMinutes = previousFuel ? Math.max(0, (loggedAt - previousFuel.date) / 60000) : 0;
    const shouldPromptForReason = includesFuel && previousFuel && previousGapMinutes > mediumRiskLimit();
    const key = dateKey(loggedAt);
    const localId = uid();
    const log = {
      id: localId,
      localId,
      timestamp: loggedAt.toISOString(),
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
    if (shouldPromptForReason) showLongGapReasonPrompt(log, previousGapMinutes);
    else clearLongGapReasonPrompt();
    window.fuelGuardCloud?.saveLog(log);
  }

  recordFuelled = function recordFuelledBeta(options = {}) {
    recordRhythmLog("fuel", options);
  };

  function recordHydration() {
    recordRhythmLog("hydration", { source: "manual" });
  }

  function recordCrashEvent() {
    const key = dateKey();
    const log = {
      id: uid(),
      timestamp: new Date().toISOString(),
      label: "Low energy event",
      type: "crash",
      source: "manual",
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key),
      note: CRASH_NOTE,
      syncStatus: "pending"
    };
    betaState().logs.push(log);
    storeArchive(key);
    state.completed.liveFuelStatus = true;
    if (typeof addActivityEntry === "function") {
      addActivityEntry("crashEvent", "Low energy event marked.", { dedupeDaily: false });
    }
    save();
    renderAll();
    window.fuelGuardCloud?.saveLog(log);
  }

  window.recordCrashEvent = recordCrashEvent;

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

  function renderGapInsights(snapshot, analysis = analyseDay(dateKey())) {
    const target = document.getElementById("fuelGapInsights");
    if (!target) return;
    target.innerHTML = `
      <div class="fuel-gap-insight"><span>Longest gap today</span><strong>${safeText(durationText(analysis.longestGapMinutes))}</strong><small>${analysis.fuelLogCount ? "Today’s biggest fuel gap." : "Tap Log Fuel to start."}</small></div>
      <div class="fuel-gap-insight"><span>Medium Risk nudges today</span><strong>${analysis.mediumRiskGapCount + analysis.mediumRiskHydrationGapCount}</strong><small>Early snack/sip nudges before High Risk.</small></div>
      <div class="fuel-gap-insight"><span>High Risk gaps today</span><strong>${analysis.highRiskGapCount}</strong><small>Gaps at or over red threshold.</small></div>
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

  function setCsvImportStatus(message) {
    csvImportStatus = message || "";
    const status = document.getElementById("fuelCsvImportStatus");
    if (status) status.textContent = csvImportStatus;
  }

  function formatImportTimestamp(date) {
    return date
      ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "--";
  }

  function renderCsvImportPanel() {
    const preview = document.getElementById("fuelCsvImportPreview");
    const importButton = document.getElementById("fuelCsvImportButton");
    const confirmButton = document.getElementById("fuelCsvImportConfirmButton");
    const valid = document.getElementById("fuelCsvImportValidCount");
    const duplicates = document.getElementById("fuelCsvImportDuplicateCount");
    const invalid = document.getElementById("fuelCsvImportInvalidCount");
    const earliest = document.getElementById("fuelCsvImportEarliest");
    const latest = document.getElementById("fuelCsvImportLatest");
    const hasPreview = Boolean(csvImportPreview);

    if (importButton) importButton.disabled = csvImportBusy;
    if (preview) preview.hidden = !hasPreview;
    if (confirmButton) confirmButton.disabled = csvImportBusy || !csvImportPreview?.logs?.length;
    if (valid) valid.textContent = String(csvImportPreview?.validCount || 0);
    if (duplicates) duplicates.textContent = String(csvImportPreview?.duplicateCount || 0);
    if (invalid) invalid.textContent = String(csvImportPreview?.invalidCount || 0);
    if (earliest) earliest.textContent = formatImportTimestamp(csvImportPreview?.earliest);
    if (latest) latest.textContent = formatImportTimestamp(csvImportPreview?.latest);

    const status = document.getElementById("fuelCsvImportStatus");
    if (status) {
      status.setAttribute("aria-busy", csvImportBusy ? "true" : "false");
      status.textContent = csvImportStatus;
    }
  }

  function renderSettings() {
    const active = document.activeElement;
    [
      ["fuelGreenHours", thresholds().greenMinutes],
      ["fuelRedHours", thresholds().redMinutes],
      ["fuelCrashHours", thresholds().crashMinutes],
      ["hydrationGreenHours", thresholds().hydrationGreenMinutes],
      ["hydrationRedHours", thresholds().hydrationRedMinutes],
      ["hydrationCrashHours", thresholds().hydrationCrashMinutes]
    ].forEach(([id, minutes]) => {
      const input = document.getElementById(id);
      if (input && active !== input) input.value = hoursValue(minutes);
    });
    const buildInfo = window.FUEL_GUARD_BUILD || {};
    const canonical = document.getElementById("canonicalAppVersion");
    const buildMarker = document.getElementById("buildVersionMarker");
    const currentBuild = document.getElementById("appUpdateCurrentBuild");
    const updateStatus = document.getElementById("appUpdateStatus");
    const canonicalText = `Canonical app: ${buildInfo.canonicalApp || "mobile-pwa-v16-medium-risk-fix"}`;
    const buildText = buildInfo.buildVersion || "unknown build";
    if (canonical) canonical.textContent = canonicalText;
    if (buildMarker) buildMarker.textContent = `Build version: ${buildText}`;
    if (currentBuild) currentBuild.textContent = buildText;
    if (updateStatus && !updateStatus.dataset.userMessage) {
      updateStatus.textContent = "Update status: ready. User logs are stored separately and will not be cleared.";
    }
    const account = accountState();
    const cloud = window.fuelGuardCloud?.accountView?.() || null;
    const recovering = Boolean(cloud?.recovering);
    const signupCooldown = authCooldownRemainingMs("signup") > 0;
    const resetCooldown = authCooldownRemainingMs("reset") > 0;
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
    if (email && document.activeElement !== email) email.value = cloud?.email || account.email || "";
    if (password && (cloud?.signedIn || recovering) && document.activeElement !== password) password.value = "";
    if (newPassword && !recovering && document.activeElement !== newPassword) newPassword.value = "";
    if (confirmPassword && !recovering && document.activeElement !== confirmPassword) confirmPassword.value = "";
    if (userEmail) userEmail.textContent = cloud?.email || "Signed in";
    if (cloudStatus) {
      const pending = cloud?.pending ? `${cloud.pending} pending local change${cloud.pending === 1 ? "" : "s"}` : "All available logs synced";
      cloudStatus.textContent = accountBusy ? "Working..." : pending;
    }
    if (signIn) signIn.disabled = accountBusy || recovering || !cloud?.configured || cloud?.signedIn;
    if (signUp) signUp.disabled = accountBusy || signupCooldown || recovering || !cloud?.configured || cloud?.signedIn;
    if (forgot) forgot.disabled = accountBusy || resetCooldown || recovering || !cloud?.configured || cloud?.signedIn;
    if (signOut) signOut.disabled = accountBusy || recovering || !cloud?.signedIn;
    if (sync) sync.disabled = accountBusy || recovering || !cloud?.signedIn;
    if (updatePassword) updatePassword.disabled = accountBusy || !recovering || !cloud?.configured;
    if (cancelRecovery) cancelRecovery.disabled = accountBusy || !recovering;
    if (status) {
      const pending = cloud?.pending ? ` ${cloud.pending} pending local change${cloud.pending === 1 ? "" : "s"}.` : "";
      status.setAttribute("aria-busy", accountBusy ? "true" : "false");
      const cooldownStatus = authCooldownStatus();
      status.textContent = account.status
        ? account.status
        : cooldownStatus
          ? cooldownStatus
          : cloud?.status
          ? `${cloud.status}${pending}`
        : "Cloud sync needs Supabase public URL/key configuration.";
    }
    renderCsvImportPanel();
  }

  function renderAnalysisList(items) {
    if (!Array.isArray(items) || !items.length) return `<p class="muted">No extra behaviour notes for this day yet.</p>`;
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

  function crashCostInsightForEntry(entry) {
    if (entry?.crashCostInsight?.lines?.length) return entry.crashCostInsight;
    return crashCostInsight({
      fuelDebtMinutes: entry?.fuelDebtMinutes || 0,
      likelyCostWindow: entry?.likelyCostWindow || "stable for now",
      topLongGapReason: entry?.topLongGapReason || "",
      hasCrash: Number(entry?.crashLogCount || 0) > 0
    });
  }

  function renderCrashCostInsight(entry) {
    const insight = crashCostInsightForEntry(entry);
    const lines = Array.isArray(insight.lines) ? insight.lines : [];
    if (!lines.length) return "";
    return `
      <section class="beta-crash-cost-insight ${safeText(insight.level || "stable")}" aria-label="Crash Cost Insight">
        <h4>${safeText(insight.title || "Crash Cost Insight")}</h4>
        <ul>${lines.map(line => `<li>${safeText(line)}</li>`).join("")}</ul>
      </section>
    `;
  }

  function renderDailyBullets(entry) {
    const bullets = Array.isArray(entry.bullets) && entry.bullets.length
      ? entry.bullets
      : [
        { label: "Longest fuel gap", value: entry.longestGap || "Not enough data" },
        { label: "Fuel Debt", value: entry.fuelDebtText || fuelDebtDurationText(entry.fuelDebtMinutes || 0) },
        { label: "Likely cost window", value: entry.likelyCostWindow || "stable for now" },
        { label: "Longest hydration gap", value: entry.longestHydrationGap || "Not enough data" },
        { label: "Medium Risk nudges", value: String((entry.mediumRiskGapCount || 0) + (entry.mediumRiskHydrationGapCount || 0)) },
        { label: "High-risk gaps", value: String((entry.highRiskGapCount || 0) + (entry.highRiskHydrationGapCount || 0)) },
        { label: "Crash-zone gaps", value: String((entry.crashZoneGapCount || 0) + (entry.hydrationCrashZoneGapCount || 0)) },
        { label: "Most vulnerable window", value: entry.vulnerableWindow || "Needs more data" },
        { label: "Bonking/crash reported", value: entry.crashLogCount ? "Yes" : "No" }
      ];
    return `<ul class="beta-daily-bullets">${bullets.map(item => `<li><span>${safeText(item.label)}</span><strong>${safeText(item.value)}</strong></li>`).join("")}</ul>`;
  }

  function pointStyleForLog(log) {
    const type = logType(log);
    if (type === "hydration") return { className: "hydration", label: "H" };
    if (type === "crash") return { className: "crash", label: "!" };
    if (type === "fuel_hydration") return { className: "combined", label: "F+H" };
    return { className: "fuel", label: "F" };
  }

  function renderDailyTimeline(entry) {
    const logs = (entry.logs || []).map(log => ({ ...log, date: logDate(log.timestamp || log) })).filter(log => log.date);
    if (!logs.length) return `<p class="muted beta-history-empty">No timeline points for this day yet.</p>`;
    const points = logs.map(log => {
      const style = pointStyleForLog(log);
      const left = clamp((minutesIntoDay(log.date) / 1440) * 100, 0, 100);
      return `<span class="beta-timeline-point ${style.className}" style="left:${left}%" title="${safeText(formatClock(log.date))} ${safeText(logTypeLabel(log))}">${safeText(style.label)}</span>`;
    }).join("");
    return `
      <div class="beta-daily-timeline" aria-label="Fuel, hydration and crash markers across the day">
        <div class="beta-timeline-track">${points}</div>
        <div class="beta-timeline-axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
        <div class="beta-timeline-legend"><span class="fuel">Fuel</span><span class="hydration">Hydration</span><span class="crash">Crash marker</span></div>
      </div>
    `;
  }

  function renderRawLogs(entry) {
    if (!entry.logs.length) return `<p class="muted">No raw logs stored for this day.</p>`;
    const logsHtml = entry.logs.map(log => {
      const date = logDate(log.timestamp);
      const displayNote = displayNoteForLog(log);
      const note = displayNote ? `<div class="row-note">${safeText(displayNote)}</div>` : "";
      return `<div class="row fuel-archive-log-row"><div><div class="item-name">${date ? formatClock(date) : "--"} - ${safeText(log.typeLabel || "Fuel")}</div>${note}</div></div>`;
    }).join("");
    return `<section class="beta-raw-log-details"><h4>Raw logs</h4><div class="list">${logsHtml}</div></section>`;
  }

  function renderArchiveDetail(entry) {
    if (!entry) return `<p class="muted">No daily summaries yet.</p>`;
    const heading = [dayTypeLabel(entry.dayType), entry.trainingSession ? trainingSessionLabel(entry.trainingSession) : ""]
      .filter(Boolean)
      .join(" - ");
    const mediumRiskTotal = Number(entry.mediumRiskGapCount || 0) + Number(entry.mediumRiskHydrationGapCount || 0);
    const highRiskTotal = Number(entry.highRiskGapCount || 0) + Number(entry.highRiskHydrationGapCount || 0);
    const crashZoneTotal = Number(entry.crashZoneGapCount || 0) + Number(entry.hydrationCrashZoneGapCount || 0);
    const riskSignalTotal = mediumRiskTotal + highRiskTotal + crashZoneTotal + Number(entry.crashLogCount || 0);

    return `
      <div class="fuel-archive-head"><div><p class="label">${safeText(entry.dateLabel)}</p><h3>${safeText(heading || "Day context not set")}</h3></div><span class="status-pill ${riskSignalTotal ? "amber" : "green"}">${riskSignalTotal ? "RISK SIGNALS" : "STABLE"}</span></div>
      <p class="beta-daily-summary-copy">${safeText(entry.plainSummary || entry.analysis?.[0] || "No summary available yet.")}</p>
      <div class="beta-daily-visuals">
        <section class="beta-daily-visual"><h4>Daily timeline</h4>${renderDailyTimeline(entry)}</section>
      </div>
      ${renderCrashCostInsight(entry)}
      ${renderDailyBullets(entry)}
      ${renderRawLogs(entry)}
    `;
  }

  function loggedHistoryEntries() {
    return archiveEntries()
      .filter(entry => Number(entry.fuelLogCount || 0) > 0 || Number(entry.hydrationLogCount || 0) > 0 || (entry.logs || []).length > 0)
      .sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));
  }

  function entryMatchesTrainingFilter(entry, filter) {
    if (filter === "all") return true;
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
    return trainingSessionLabel(filter);
  }

  function trendDayTypeFilterLabel(filter) {
    if (filter === "all") return "all days";
    return dayTypeLabel(filter).toLowerCase();
  }

  function trendTrainingFilterLabel(filter) {
    if (filter === "all") return "all training sessions";
    if (filter === "rest") return "no training";
    return trainingSessionLabel(filter).toLowerCase();
  }

  function activeTrendConfig() {
    return TREND_VIEWS[selectedTrendView] || TREND_VIEWS.fuel;
  }

  function trendMetricValue(metrics, metric) {
    const value = metrics?.[metric];
    return Number.isFinite(value) ? value : null;
  }

  function trendValueText(value, config) {
    if (!Number.isFinite(value)) return "Not enough data";
    if (config.unit === "minutes") return compactDuration(value);
    return String(Math.round(value));
  }

  function trendFilterCopy() {
    return `Filtered to ${trendDayTypeFilterLabel(selectedTrendDayType)} and ${trendTrainingFilterLabel(selectedTrendTrainingSession)}.`;
  }

  function entryMatchesTrendFilters(entry) {
    const dayMatches = selectedTrendDayType === "all" || entry.dayType === selectedTrendDayType;
    const session = entry.trainingSession || "";
    const trainingMatches = selectedTrendTrainingSession === "all"
      || (selectedTrendTrainingSession === "rest" ? !session || session === "rest" : session === selectedTrendTrainingSession);
    return dayMatches && trainingMatches;
  }

  function renderTrendViewControls() {
    document.querySelectorAll("[data-trend-view]").forEach(button => {
      button.classList.toggle("active", button.dataset.trendView === selectedTrendView);
    });
  }

  function trendInsightCopy(config, trend, currentValue, previousValue) {
    if (!Number.isFinite(currentValue)) {
      return `${config.title} needs more matching logs before it can compare weeks.`;
    }
    if (!Number.isFinite(previousValue)) {
      return `${config.title} has this-week data; last week needs more matching logs.`;
    }
    if (trend.direction === "steady") {
      const verb = config.metric === "highRiskGaps" || config.metric === "crashEvents" ? "were" : "was";
      return `${config.title} ${verb} about the same as last week.`;
    }
    if (config.metric === "averageFuelGap") {
      return trend.improved
        ? `Your average fuel gap improved by ${compactDuration(trend.delta)} this week.`
        : `Your average fuel gap increased by ${compactDuration(trend.delta)} this week.`;
    }
    if (config.metric === "averageHydrationGap") {
      return trend.improved
        ? `Your average hydration gap improved by ${compactDuration(trend.delta)} this week.`
        : `Your average hydration gap increased by ${compactDuration(trend.delta)} this week.`;
    }
    if (config.metric === "highRiskGaps") {
      return trend.improved
        ? "High-risk periods were lower than last week."
        : "High-risk periods were higher than last week.";
    }
    return trend.improved
      ? "Crash events were lower than last week."
      : "Crash events were higher than last week.";
  }

  function weeklyTrendWindows(entries) {
    const todayStart = startOfDay();
    const thisStart = new Date(todayStart);
    thisStart.setDate(todayStart.getDate() - 6);
    const lastStart = new Date(todayStart);
    lastStart.setDate(todayStart.getDate() - 13);
    const lastEnd = new Date(todayStart);
    lastEnd.setDate(todayStart.getDate() - 7);
    return {
      current: entries.filter(entry => {
        const date = dateFromKey(entry.date);
        return date >= thisStart && date <= todayStart;
      }),
      previous: entries.filter(entry => {
        const date = dateFromKey(entry.date);
        return date >= lastStart && date <= lastEnd;
      })
    };
  }

  function trendMetrics(entries) {
    return {
      averageFuelGap: averageValue(entries.map(entry => Number(entry.averageGapMinutes || 0)).filter(Boolean)),
      averageHydrationGap: averageValue(entries.map(entry => Number(entry.averageHydrationGapMinutes || 0)).filter(Boolean)),
      mediumRiskGaps: entries.reduce((sum, entry) => sum + Number(entry.mediumRiskGapCount || 0) + Number(entry.mediumRiskHydrationGapCount || 0), 0),
      highRiskGaps: entries.reduce((sum, entry) => sum + Number(entry.highRiskGapCount || 0) + Number(entry.highRiskHydrationGapCount || 0), 0),
      crashZoneGaps: entries.reduce((sum, entry) => sum + Number(entry.crashZoneGapCount || 0) + Number(entry.hydrationCrashZoneGapCount || 0), 0),
      crashEvents: entries.reduce((sum, entry) => sum + Number(entry.crashLogCount || 0), 0),
      days: entries.length
    };
  }

  function metricTrend(current, previous, { lowerIsBetter = true, unit = "", threshold = 0 } = {}) {
    if (!Number.isFinite(current)) return { direction: "none", copy: "Needs more data", delta: 0, improved: false };
    if (!Number.isFinite(previous)) return { direction: "none", copy: "Needs last week for comparison", delta: 0, improved: false };
    const delta = current - previous;
    if (Math.abs(delta) <= threshold) return { direction: "steady", copy: "About the same as last week", delta, improved: false };
    const improved = lowerIsBetter ? delta < 0 : delta > 0;
    const amount = unit === "minutes" ? compactDuration(delta) : `${Math.abs(delta).toFixed(Math.abs(delta) < 1 ? 1 : 0)}${unit}`;
    return {
      direction: delta < 0 ? "down" : "up",
      copy: `${amount} ${delta < 0 ? "lower" : "higher"} than last week`,
      delta,
      improved
    };
  }

  function renderTrendStatus(label, trend) {
    const tone = trend.direction === "steady" ? "neutral" : trend.improved ? "good" : "watch";
    const value = trend.direction === "none" ? "Building" : trend.improved ? "Improving" : trend.direction === "steady" ? "Steady" : "Needs attention";
    return renderTrendMetric(label, value, trend.copy, tone);
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
          <div class="beta-habit-heading"><h3>Trends</h3><span>Recent days versus earlier logged days</span></div>
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
        <div class="beta-habit-heading"><h3>Trends</h3><span>Recent ${recent.length} logged day${recent.length === 1 ? "" : "s"} versus previous ${previous.length || 0}</span></div>
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

  function renderTrends() {
    const summaryTarget = document.getElementById("fuelAveragesSummary");
    const insightsTarget = document.getElementById("fuelTrendInsights");
    const allEntries = loggedHistoryEntries();
    const filteredEntries = allEntries.filter(entryMatchesTrendFilters);
    const config = activeTrendConfig();
    renderTrendViewControls();
    if (!summaryTarget || !insightsTarget) return;
    if (!filteredEntries.length) {
      latestTrendGraphData = null;
      summaryTarget.innerHTML = `<p class="muted beta-history-empty">No logged days match these filters yet.</p>`;
      insightsTarget.innerHTML = "";
      requestAnimationFrame(drawTrendsGraph);
      return;
    }

    const { current, previous } = weeklyTrendWindows(filteredEntries);
    const currentMetrics = trendMetrics(current);
    const previousMetrics = trendMetrics(previous);
    const currentValue = trendMetricValue(currentMetrics, config.metric);
    const previousValue = trendMetricValue(previousMetrics, config.metric);
    const trend = metricTrend(currentValue, previousValue, {
      unit: config.unit === "minutes" ? "minutes" : "",
      threshold: config.threshold,
      lowerIsBetter: true
    });
    latestTrendGraphData = {
      title: config.title,
      unit: config.unit,
      color: config.color,
      current: currentValue,
      previous: previousValue
    };
    summaryTarget.innerHTML = `<div class="fuel-gap-insights beta-average-grid">${renderTrendMetric(
      config.title,
      trendValueText(currentValue, config),
      `This week. Last week: ${trendValueText(previousValue, config)}.`,
      trend.direction === "steady" ? "neutral" : trend.improved ? "good" : "watch"
    )}</div>`;

    const insights = [
      trendInsightCopy(config, trend, currentValue, previousValue),
      trendFilterCopy()
    ];
    insights.push(`Medium Risk nudges this week: ${currentMetrics.mediumRiskGaps}.`);
    if (currentMetrics.crashZoneGaps) insights.push(`Crash-zone gaps this week: ${currentMetrics.crashZoneGaps}.`);
    if (!previous.length) insights.push("Last-week comparison will get stronger after another week of matching logs.");
    insightsTarget.innerHTML = `<ul class="beta-trend-bullets">${insights.map(item => `<li>${safeText(item)}</li>`).join("")}</ul>`;
    requestAnimationFrame(drawTrendsGraph);
  }

  function drawTrendsGraph() {
    const canvas = document.getElementById("fuelTrendsGraph");
    if (!canvas) return;
    const prepared = prepareCanvas(canvas, 320, 240);
    if (!prepared) return;
    const { ctx, cssWidth, cssHeight } = prepared;
    const data = latestTrendGraphData;
    const padding = { left: 76, right: 76, top: 34, bottom: 64 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    ctx.strokeStyle = "rgba(255,255,255,.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    [0, 0.25, 0.5, 0.75, 1].forEach(ratio => {
      const y = bottom - ratio * plotHeight;
      ctx.moveTo(padding.left, y);
      ctx.lineTo(cssWidth - padding.right, y);
    });
    ctx.stroke();
    if (!data || (!Number.isFinite(data.current) && !Number.isFinite(data.previous))) {
      ctx.fillStyle = "rgba(245,255,248,.62)";
      ctx.font = "13px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Log more matching days to compare this week with last week.", cssWidth / 2, cssHeight / 2);
      return;
    }
    const values = [data.previous, data.current].filter(Number.isFinite);
    const maxValue = Math.max(...values, data.unit === "minutes" ? 60 : 1);
    const pointFor = (value, index) => {
      const x = padding.left + (index / 1) * plotWidth;
      const normalized = clamp(value / maxValue, 0, 1);
      return { x, y: bottom - normalized * plotHeight };
    };
    const previousPoint = Number.isFinite(data.previous) ? pointFor(data.previous, 0) : null;
    const currentPoint = Number.isFinite(data.current) ? pointFor(data.current, 1) : null;
    if (previousPoint && currentPoint) {
      ctx.strokeStyle = data.color;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(previousPoint.x, previousPoint.y);
      ctx.lineTo(currentPoint.x, currentPoint.y);
      ctx.stroke();
    }
    [
      { point: previousPoint, value: data.previous, label: "Last week", color: "#9fb7ff" },
      { point: currentPoint, value: data.current, label: "This week", color: data.color }
    ].forEach(item => {
      if (!item.point) return;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(item.point.x, item.point.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(245,255,248,.82)";
      ctx.font = "12px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(data.unit === "minutes" ? compactDuration(item.value) : String(Math.round(item.value)), item.point.x, Math.max(16, item.point.y - 12));
      ctx.fillText(item.label, item.point.x, cssHeight - 16);
    });
    ctx.fillStyle = "rgba(245,255,248,.7)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(data.title, padding.left, 16);
    ctx.fillText(data.unit === "minutes" ? "gap" : "count", 7, padding.top + 3);
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
    requestAnimationFrame(() => drawDailyRiskGraph(selectedHistoryKey));
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

    const padding = { left: 54, right: 24, top: 54, bottom: 42 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const selectedMode = graphMode();
    const logs = todayLogs(now).filter(log => log.date <= now);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const series = [];
    if (selectedMode === "risk") {
      drawRiskGraphCanvas(canvas, dateKey(now), { now });
      return;
    }
    if (selectedMode === "fuel") {
      series.push({ label: "Fuel", color: "#2dff88", logs: fuelLogs });
    }
    if (selectedMode === "hydration") {
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
      ctx.fillText(label, clamp(xForMinute(minute), padding.left + 10, cssWidth - padding.right - 10), cssHeight - 12);
    });
    ctx.textAlign = "left";
    ctx.fillText("Logs", 8, 18);
    ctx.textAlign = "right";
    ctx.fillText(String(maxCount), padding.left - 8, yForCount(maxCount) + 4);
    ctx.fillText("0", padding.left - 8, bottom + 4);

    const labelY = padding.top - 16;
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
      const empty = selectedMode === "hydration" ? "No hydration logs yet." : "No fuel logs yet.";
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
    ctx.fillText("Now", clamp(currentX, padding.left + 18, cssWidth - padding.right - 18), padding.top + 14);
    ctx.textAlign = "left";
  }

  function prepareCanvas(canvas, minWidth = 320, minHeight = 180) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(minWidth, Math.round(rect.width || canvas.width));
    const cssHeight = Math.max(minHeight, Math.round(rect.height || canvas.height));
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssWidth * dpr) || canvas.height !== Math.round(cssHeight * dpr)) {
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    return { ctx, cssWidth, cssHeight };
  }

  function drawRiskGraphCanvas(canvas, key, { now = new Date(), endedAt = "", compact = false } = {}) {
    const prepared = prepareCanvas(canvas, 320, compact ? 160 : 210);
    if (!prepared) return 0;
    const { ctx, cssWidth, cssHeight } = prepared;
    const padding = { left: compact ? 44 : 58, right: compact ? 16 : 24, top: compact ? 34 : 44, bottom: compact ? 32 : 40 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const samples = riskSamplesForDay(key, { now, endedAt });
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const yForScore = score => bottom - (clamp(score, 0, 100) / 100) * plotHeight;
    const zones = [
      { from: 0, to: 30, color: "rgba(45,255,136,.07)" },
      { from: 31, to: 60, color: "rgba(255,176,32,.08)" },
      { from: 61, to: 80, color: "rgba(255,77,109,.08)" },
      { from: 81, to: 100, color: "rgba(255,77,109,.15)" }
    ];
    zones.forEach(zone => {
      ctx.fillStyle = zone.color;
      ctx.fillRect(padding.left, yForScore(zone.to), plotWidth, yForScore(zone.from) - yForScore(zone.to));
    });
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    [0, 30, 60, 80, 100].forEach(score => {
      const y = yForScore(score);
      ctx.moveTo(padding.left, y);
      ctx.lineTo(cssWidth - padding.right, y);
    });
    [0, 360, 720, 1080, 1440].forEach(minute => {
      const x = xForMinute(minute);
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, bottom);
    });
    ctx.stroke();

    if (samples.length) {
      ctx.strokeStyle = "#ffb020";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      samples.forEach((sample, index) => {
        const x = xForMinute(sample.minute);
        const y = yForScore(sample.score);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    const logs = logsForDay(key);
    logs.filter(isFuelLog).forEach(log => {
      ctx.fillStyle = "#2dff88";
      ctx.beginPath();
      ctx.arc(xForMinute(minutesIntoDay(log.date)), yForScore(12), 4, 0, Math.PI * 2);
      ctx.fill();
    });
    logs.filter(isHydrationLog).forEach(log => {
      ctx.fillStyle = "#9fb7ff";
      ctx.beginPath();
      ctx.arc(xForMinute(minutesIntoDay(log.date)), yForScore(20), 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    logs.filter(isCrashLog).forEach(log => {
      const x = xForMinute(minutesIntoDay(log.date));
      const y = yForScore(100);
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.fill();
    });

    ctx.fillStyle = "rgba(245,255,248,.62)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    [
      [0, "12am"],
      [360, "6am"],
      [720, "12pm"],
      [1080, "6pm"],
      [1440, "12am"]
    ].forEach(([minute, label]) => {
      ctx.fillText(label, clamp(xForMinute(minute), padding.left + 10, cssWidth - padding.right - 10), cssHeight - 10);
    });
    ctx.textAlign = "left";
    ctx.fillText(compact ? "Risk" : "Risk score", 8, compact ? 16 : 18);
    ctx.textAlign = "right";
    ctx.fillText("100", padding.left - 8, yForScore(100) + 4);
    ctx.fillText("0", padding.left - 8, bottom + 4);
    return samples.length ? samples[samples.length - 1].score : 0;
  }

  function drawDailyRiskGraph(key = selectedHistoryKey || dateKey()) {
    const canvas = document.getElementById("dailyRiskGraph");
    if (!canvas) return;
    const entry = archiveEntries().find(item => item.date === key);
    drawRiskGraphCanvas(canvas, key, { endedAt: entry?.endedAt || "", compact: true });
  }

  renderFuelGap = function renderFuelGapBeta() {
    const snapshot = fuelGapSnapshot();
    const summary = fuelDaySummary();
    const analysis = analyseDay(dateKey());
    const cooldown = cooldownRemainingSeconds();
    const dashboardActive = document.getElementById("dashboard")?.classList.contains("active");
    const historyActive = document.getElementById("logs")?.classList.contains("active");
    const trendsActive = document.getElementById("trends")?.classList.contains("active");
    const settingsActive = document.getElementById("checklist")?.classList.contains("active");

    const badge = document.getElementById("fuelGraphLastAte");
    if (badge) badge.textContent = snapshot.lastFuelled === "No fuel logged" ? "Last fuel: not logged yet" : `Last fuel: ${snapshot.timeSinceFuel} ago`;

    const next = document.getElementById("fuelGapNextAction");
    if (next) {
      next.textContent = snapshot.nextAction || `Current Fuel Zone: ${snapshot.statusLabel || riskStatusLabel(snapshot.status)}`;
      next.className = `fuel-next-action beta-risk-pill ${snapshot.status}`;
    }

    const debt = document.getElementById("fuelDebtStatus");
    if (debt) {
      const insight = crashCostInsightForEntry(analysis);
      debt.className = `fuel-debt-status beta-crash-cost-insight ${insight.level || "stable"}`;
      debt.innerHTML = `
        <h4>${safeText(insight.title || "Crash Cost Insight")}</h4>
        <ul>${(insight.lines || []).map(line => `<li>${safeText(line)}</li>`).join("")}</ul>
      `;
    }

    const context = document.getElementById("fuelStatusContext");
    if (context) {
      context.innerHTML = `<strong>Current Fuel Zone:</strong><span class="status-pill ${snapshot.status}">${safeText(snapshot.statusLabel || riskStatusLabel(snapshot.status))}</span><span>${safeText(snapshot.statusContext)}</span>`;
    }

    const button = document.getElementById("graphLogFoodButton");
    if (button) {
      button.textContent = "Log Fuel";
      button.disabled = cooldown > 0;
    }

    const hydrationButton = document.getElementById("graphLogHydrationButton");
    if (hydrationButton) hydrationButton.disabled = false;
    const crashButton = document.getElementById("graphLogCrashButton");
    if (crashButton) crashButton.disabled = false;

    const undo = document.getElementById("undoLatestFoodLog");
    if (undo) undo.disabled = !todayLogs().length;

    const cooldownEl = document.getElementById("foodLogCooldownMessage");
    if (cooldownEl) cooldownEl.textContent = cooldown > 0 ? `Logged. You can fuel again in ${cooldown}s.` : "";
    renderLongGapReasonPrompt();

    const daySummary = document.getElementById("fuelDaySummary");
    if (daySummary) daySummary.innerHTML = `<p class="label">Today</p><p>${safeText(summary.message)}</p>`;

    renderGraphModeControls();
    if (dashboardActive) {
      renderGapInsights(snapshot, analysis);
      renderDayTypeControls();
      renderDayAnalysis();
      renderDailyLog();
      drawBetaGraph();
    }
    if (settingsActive) renderSettings();
    if (historyActive) renderHistory();
    if (trendsActive) renderTrends();
  };

  const baseSwitchScreen = switchScreen;
  switchScreen = function switchScreenBeta(screen) {
    const target = ["dashboard", "logs", "trends", "checklist"].includes(screen) ? screen : "dashboard";
    baseSwitchScreen(target);
    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.screen === target);
    });
    document.querySelectorAll(".mobile-nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileScreen === target);
    });
    const titles = {
      dashboard: ["Live Fuel Rhythm", "What is happening today."],
      logs: ["Daily", "What happened that day, explained simply."],
      trends: ["Trends", "How habits are changing over time."],
      checklist: ["Settings", "Adjust beta gap thresholds and reset test data."]
    };
    const title = document.getElementById("pageTitle");
    const subtitle = document.getElementById("pageSubtitle");
    if (title) title.textContent = titles[target][0];
    if (subtitle) subtitle.textContent = titles[target][1];
    if (target === "logs") renderHistory();
    if (target === "trends") renderTrends();
    if (target === "checklist") renderSettings();
    if (target === "dashboard") requestAnimationFrame(() => {
      drawBetaGraph();
    });
  };

  function saveThresholdSettings() {
    const gap = betaState();
    const fuelGreen = minutesFromHoursField("fuelGreenHours", gap.thresholds.greenMinutes, { min: 30, max: 480 });
    const fuelRed = minutesFromHoursField("fuelRedHours", gap.thresholds.redMinutes, { min: 60, max: 600 });
    const fuelCrash = minutesFromHoursField("fuelCrashHours", gap.thresholds.crashMinutes, { min: 75, max: 720 });
    const hydrationGreen = minutesFromHoursField("hydrationGreenHours", gap.thresholds.hydrationGreenMinutes, { min: 15, max: 360 });
    const hydrationRed = minutesFromHoursField("hydrationRedHours", gap.thresholds.hydrationRedMinutes, { min: 30, max: 480 });
    const hydrationCrash = minutesFromHoursField("hydrationCrashHours", gap.thresholds.hydrationCrashMinutes, { min: 45, max: 600 });
    gap.thresholds.greenMinutes = fuelGreen;
    gap.thresholds.redMinutes = Math.max(fuelRed, fuelGreen + 15);
    gap.thresholds.crashMinutes = Math.max(fuelCrash, gap.thresholds.redMinutes + 15);
    gap.thresholds.hydrationGreenMinutes = hydrationGreen;
    gap.thresholds.hydrationRedMinutes = Math.max(hydrationRed, hydrationGreen + 15);
    gap.thresholds.hydrationCrashMinutes = Math.max(hydrationCrash, gap.thresholds.hydrationRedMinutes + 15);
    document.getElementById("fuelSettingsStatus").textContent = "Risk thresholds saved. Medium Risk, High Risk, and Crash Zone starts updated for fuel and hydration.";
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
    gap.graphMode = "fuel";
    gap.thresholds = { ...DEFAULT_THRESHOLDS };
    gap.dayEndedDate = "";
    gap.dayEndedAt = "";
    gap.fastingStartedAt = "";
    gap.cooldownUntil = 0;
    if (settingsStatus) settingsStatus.textContent = clearStatus;
    save();
    renderAll();
  }

  async function commitFuelCsvImport() {
    if (!csvImportPreview?.logs?.length) {
      setCsvImportStatus("No valid fuel logs found.");
      renderSettings();
      return;
    }

    csvImportBusy = true;
    setCsvImportStatus("Importing fuel logs...");
    try {
      const gap = betaState();
      csvImportPreview.logs.forEach(log => {
        gap.logs.push(log);
        const date = logDate(log);
        if (date) storeArchive(dateKey(date));
      });
      state.completed.liveFuelStatus = true;
      save();
      renderAll();
      const cloud = window.fuelGuardCloud?.accountView?.() || {};
      const canSyncNow = Boolean(cloud.configured && cloud.signedIn && navigator.onLine !== false);
      await window.fuelGuardCloud?.syncNow?.();
      const skipped = csvImportPreview.invalidCount > 0;
      csvImportStatus = skipped
        ? "Fuel logs imported. Some invalid rows were skipped."
        : canSyncNow
          ? "Fuel logs imported and synced."
          : "Fuel logs imported. Sign in to sync.";
      csvImportPreview = null;
      const fileInput = document.getElementById("fuelCsvImportFileInput");
      if (fileInput) fileInput.value = "";
    } catch (error) {
      csvImportStatus = `Import failed: ${error?.message || "unknown error"}`;
    } finally {
      csvImportBusy = false;
      renderAll();
    }
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
    betaState().graphMode = GRAPH_MODES.has(button.dataset.graphMode) ? button.dataset.graphMode : "fuel";
    save();
    renderFuelGap();
  });
  document.getElementById("longGapReasonPrompt")?.addEventListener("click", event => {
    const reasonButton = event.target.closest("[data-long-gap-reason]");
    if (reasonButton) {
      applyLongGapReason(reasonButton.dataset.longGapReason);
      return;
    }
    if (event.target.closest("[data-long-gap-skip]")) clearLongGapReasonPrompt();
  });
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", event => {
    selectedHistoryKey = event.target.value;
    renderHistory();
  });
  document.getElementById("trendDayTypeFilter")?.addEventListener("change", event => {
    selectedTrendDayType = event.target.value || "all";
    renderTrends();
  });
  document.getElementById("trendTrainingFilter")?.addEventListener("change", event => {
    selectedTrendTrainingSession = event.target.value || "all";
    renderTrends();
  });
  document.getElementById("fuelTrendViewControls")?.addEventListener("click", event => {
    const button = event.target.closest("[data-trend-view]");
    if (!button) return;
    selectedTrendView = TREND_VIEWS[button.dataset.trendView] ? button.dataset.trendView : "fuel";
    renderTrends();
  });
  document.getElementById("saveFuelThresholds")?.addEventListener("click", saveThresholdSettings);
  document.getElementById("clearFuelBetaData")?.addEventListener("click", clearBetaData);
  document.getElementById("fuelCsvImportButton")?.addEventListener("click", () => {
    const input = document.getElementById("fuelCsvImportFileInput");
    if (!input || csvImportBusy) return;
    input.value = "";
    input.click();
  });
  document.getElementById("fuelCsvImportFileInput")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    csvImportBusy = true;
    csvImportPreview = null;
    setCsvImportStatus("Reading CSV...");
    try {
      const preview = await importFuelLogsFromCsv(file);
      if (!preview.recognized) {
        csvImportStatus = "CSV format not recognised. Please export logs from your FG button and try again.";
        return;
      }
      csvImportPreview = preview;
      csvImportStatus = preview.logs.length
        ? "Review the fuel logs before importing."
        : "No valid fuel logs found.";
    } catch (error) {
      csvImportStatus = `Import failed: ${error?.message || "unknown error"}`;
    } finally {
      csvImportBusy = false;
      renderSettings();
    }
  });
  document.getElementById("fuelCsvImportConfirmButton")?.addEventListener("click", commitFuelCsvImport);
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
    const account = accountState();
    const email = document.getElementById("accountEmail")?.value.trim() || "";
    const password = document.getElementById("accountPassword")?.value || "";
    account.email = email;
    save();
    return { email, password };
  }

  function setAccountStatus(message) {
    const account = accountState();
    account.status = message;
    const status = document.getElementById("accountSetupStatus");
    if (status) status.textContent = message;
    save();
    renderSettings();
  }

  function clearAccountStatus() {
    accountState().status = "";
    save();
  }

  function recoveryPasswords() {
    return {
      password: document.getElementById("accountNewPassword")?.value || "",
      confirmation: document.getElementById("accountConfirmPassword")?.value || ""
    };
  }

  document.getElementById("accountSignInButton")?.addEventListener("click", async () => {
    if (accountBusy) return;
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
    if (accountBusy) return;
    if (authCooldownRemainingMs("signup") > 0) {
      clearAccountStatus();
      renderSettings();
      return;
    }
    const { email, password } = accountCredentials();
    if (!email || !password) {
      setAccountStatus("Enter email and password to create an account.");
      return;
    }
    try {
      accountBusy = true;
      setAccountStatus("Creating account...");
      await window.fuelGuardCloud?.signUp(email, password);
      startAuthEmailCooldown("signup");
      clearAccountStatus();
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        startAuthEmailCooldown("signup");
        setAccountStatus(AUTH_RATE_LIMIT_MESSAGE);
      } else if (isExistingAccountError(error)) {
        startAuthEmailCooldown("signup");
        setAccountStatus(AUTH_EXISTING_ACCOUNT_MESSAGE);
      } else {
        setAccountStatus(`Account creation failed: ${error?.message || "unknown error"}`);
      }
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountForgotPasswordButton")?.addEventListener("click", async () => {
    if (accountBusy) return;
    if (authCooldownRemainingMs("reset") > 0) {
      clearAccountStatus();
      renderSettings();
      return;
    }
    const { email } = accountCredentials();
    if (!email) {
      setAccountStatus("Enter your email address to reset your password.");
      return;
    }
    try {
      accountBusy = true;
      setAccountStatus("Sending password reset email...");
      await window.fuelGuardCloud?.sendPasswordReset(email);
      startAuthEmailCooldown("reset");
      clearAccountStatus();
    } catch (error) {
      if (isAuthRateLimitError(error)) {
        startAuthEmailCooldown("reset");
        setAccountStatus(AUTH_RATE_LIMIT_MESSAGE);
      } else {
        setAccountStatus(`Password reset failed: ${error?.message || "unknown error"}`);
      }
    } finally {
      accountBusy = false;
      renderSettings();
    }
  });
  document.getElementById("accountSignOutButton")?.addEventListener("click", async () => {
    if (accountBusy) return;
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
    if (accountBusy) return;
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
    if (accountBusy) return;
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
      if (document.getElementById("dashboard")?.classList.contains("active")) {
        drawBetaGraph();
      }
      if (document.getElementById("logs")?.classList.contains("active")) drawDailyRiskGraph(selectedHistoryKey);
      if (document.getElementById("trends")?.classList.contains("active")) drawTrendsGraph();
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
