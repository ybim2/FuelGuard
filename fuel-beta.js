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
  const SHOP_TYPE_OPTIONS = {
    full_shop: "Full shop",
    top_up: "Top-up shop",
    meal_prep: "Meal-prep batch"
  };
  const GRAPH_MODES = new Set(["fuel", "hydration", "risk"]);
  const CRASH_NOTE = "fuel_guard_event:crash";
  const LEGACY_FOLLOWUP_NOTE_RE = /(?:^|[;\n]\s*)fuel_guard_long_gap_reason:[^;\n]*/g;
  const LEGACY_FOLLOWUP_LINE_RE = /^(most long gaps|sleep was marked for long gaps|your .* block may have worked|.* shift gap logged|forgotten fuel gap logged|no .* available|sleep gap logged|long gap logged\. protect)/i;
  const SLEEP_WINDOW_START_MINUTE = 23 * 60;
  const SLEEP_WINDOW_END_MINUTE = 5 * 60;
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
  let accountBusy = false;
  let csvImportBusy = false;
  let csvImportPreview = null;
  let csvImportStatus = "";
  let missedLogEditingId = "";
  let missedLogStatus = "";
  let missedLogBusy = false;
  let runwayEditingId = "";
  let runwayStatus = "";
  let rideStatus = "";
  let activeRideTimer = null;

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
        eventTime: timestamp,
        logged_at: timestamp,
        label: "Fuelled",
        type: "fuel",
        logType: "fuel",
        entryMethod: "imported",
        source: "csv_import",
        dayType: dayTypeForKey(key),
        trainingSession: trainingSessionForKey(key),
        importEventId: String(row.event_id || "").trim(),
        importSource: String(row.source || "").trim(),
        importDeviceId: String(row.device_id || "").trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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

  function scrubLegacyFollowUpNote(value) {
    return String(value || "")
      .replace(LEGACY_FOLLOWUP_NOTE_RE, "")
      .replace(/^[;\s]+|[;\s]+$/g, "")
      .trim();
  }

  function scrubLegacyFollowUpLog(log) {
    if (!log || typeof log !== "object") return;
    delete log.longGapReason;
    delete log.longGapReasonLabel;
    delete log.longGapMinutes;
    if (Object.prototype.hasOwnProperty.call(log, "note")) log.note = scrubLegacyFollowUpNote(log.note);
    if (Object.prototype.hasOwnProperty.call(log, "notes")) log.notes = scrubLegacyFollowUpNote(log.notes);
  }

  function isLegacyFollowUpLine(line) {
    return LEGACY_FOLLOWUP_LINE_RE.test(String(line || "").trim());
  }

  function removeStoredFollowUpData(gap) {
    if (!gap || typeof gap !== "object") return;
    (gap.logs || []).forEach(scrubLegacyFollowUpLog);
    Object.values(gap.archive || {}).forEach(entry => {
      if (!entry || typeof entry !== "object") return;
      delete entry.longGapReasonCounts;
      delete entry.topLongGapReason;
      delete entry.topLongGapReasonLabel;
      (entry.logs || []).forEach(scrubLegacyFollowUpLog);
      if (Array.isArray(entry.summary)) entry.summary = entry.summary.filter(line => !isLegacyFollowUpLine(line));
      if (entry.crashCostInsight && Array.isArray(entry.crashCostInsight.lines)) {
        entry.crashCostInsight.lines = entry.crashCostInsight.lines.filter(line => !isLegacyFollowUpLine(line));
      }
    });
  }

  function betaState() {
    const gap = fuelGapState();
    if (!gap.dayTypes || Array.isArray(gap.dayTypes)) gap.dayTypes = {};
    if (!gap.trainingSessions || Array.isArray(gap.trainingSessions)) gap.trainingSessions = {};
    if (!gap.archive || Array.isArray(gap.archive)) gap.archive = {};
    if (!Array.isArray(gap.ridePlans)) gap.ridePlans = [];
    if (!Array.isArray(gap.rideTemplates)) gap.rideTemplates = [];
    if (!gap.activeRide || typeof gap.activeRide !== "object" || Array.isArray(gap.activeRide)) gap.activeRide = null;
    if (!Array.isArray(gap.foodRunway)) gap.foodRunway = [];
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
    if (!GRAPH_MODES.has(gap.graphMode)) gap.graphMode = "risk";
    normalizeStoredDayTypes(gap);
    removeStoredFollowUpData(gap);
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

  function dateInputValue(date = new Date()) {
    return dateKey(date);
  }

  function timeInputValue(date = new Date()) {
    return [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0")
    ].join(":");
  }

  function dateTimeFromInputs(dateValue, timeValue) {
    const text = `${dateValue || ""}T${timeValue || ""}`;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
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

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfCalendarWeek(date = new Date()) {
    const start = startOfDay(date);
    const daysSinceMonday = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
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

  function overlapMinutes(start, end, windowStart, windowEnd) {
    const startTime = Math.max(start.getTime(), windowStart.getTime());
    const endTime = Math.min(end.getTime(), windowEnd.getTime());
    return Math.max(0, (endTime - startTime) / 60000);
  }

  function sleepOverlapMinutes(start, end) {
    const startDate = logDate(start);
    const endDate = logDate(end);
    if (!startDate || !endDate || endDate <= startDate) return 0;

    let total = 0;
    const cursor = startOfDay(startDate);
    cursor.setDate(cursor.getDate() - 1);
    const lastDay = startOfDay(endDate);
    lastDay.setDate(lastDay.getDate() + 1);

    while (cursor <= lastDay) {
      const sleepStart = addMinutes(startOfDay(cursor), SLEEP_WINDOW_START_MINUTE);
      const sleepEnd = addMinutes(startOfDay(cursor), 24 * 60 + SLEEP_WINDOW_END_MINUTE);
      total += overlapMinutes(startDate, endDate, sleepStart, sleepEnd);
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  function awakeGapMinutes(gap) {
    if (!gap?.start || !gap?.end) return Number(gap?.minutes || 0);
    const minutes = Number(gap.minutes || 0);
    return Math.max(0, minutes - sleepOverlapMinutes(gap.start, gap.end));
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
    return GRAPH_MODES.has(betaState().graphMode) ? betaState().graphMode : "risk";
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
      const minutes = awakeGapMinutes(gap);
      return total + Math.max(0, minutes - preferredWindow);
    }, 0);
  }

  function fuelDebtSentence(minutes) {
    const debtMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    return debtMinutes > 0
      ? `You spent ${fuelDebtDurationText(debtMinutes)} beyond your preferred fuelling window. Long gaps can make your body feel harder to manage, and a small regular fuel moment may help you feel steadier.`
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

  function displayNoteForLog(log) {
    const note = scrubLegacyFollowUpNote(log?.note || log?.notes || "");
    if (!note || note.includes(CRASH_NOTE)) return "";
    return note;
  }

  function fuelDebtLevel(minutes) {
    const safeMinutes = Math.max(0, Math.round(Number(minutes || 0)));
    if (safeMinutes <= 0) return "stable";
    if (safeMinutes < 60) return "mild";
    if (safeMinutes < 120) return "medium";
    return "high";
  }

  function crashCostInsight({ fuelDebtMinutes = 0, likelyCostWindow: costWindow = "stable for now", hasCrash = false, recoveryWindow = null } = {}) {
    const debtText = fuelDebtDurationText(fuelDebtMinutes);
    const level = fuelDebtLevel(fuelDebtMinutes);
    const recovery = recoveryWindow || recoveryWindowScore({
      fuelDebtMinutes,
      highRiskGapCount: level === "stable" ? 0 : level === "mild" ? 0 : 1,
      crashZoneGapCount: level === "high" ? 1 : 0,
      crashLogCount: hasCrash ? 1 : 0
    });
    const lines = [`Time beyond fuel window: ${debtText}`, `Recovery support: ${recoveryRiskLabel(recovery.riskLabel)}`];
    if (costWindow && costWindow !== "stable for now") lines.push(`Possible impact window: ${costWindow}.`);

    if (level === "stable") {
      lines.push("Support window steady.");
      lines.push("Your fuelling rhythm is giving your body steadier support.");
    } else {
      lines.push(`You spent ${debtText} beyond your preferred fuelling window.`);
      lines.push("Support your work, training, and recovery window.");
      lines.push("This long gap may affect how steady you feel later.");
      if (level === "mild") {
        lines.push("Later energy impact may be starting to build.");
        lines.push("You moved past your target fuel window, so a gentle support signal is showing up.");
      } else if (level === "medium") {
        lines.push("Possible impact window: later today.");
        lines.push("The pattern suggests today may need extra steady-fuelling support.");
      } else {
        lines.push("This longer gap may affect how steady you feel later today or post-shift.");
        lines.push("Today’s support signal came from time beyond your fuel window, not from one moment.");
      }
    }

    if (hasCrash && level !== "stable") lines.push("A low-energy event was marked, so this pattern may be useful to review without treating it as medical proof.");

    return {
      title: "Later Energy Impact",
      level,
      debtText,
      costWindow: costWindow || "stable for now",
      lines
    };
  }

  function recoveryWindowScore({
    fuelLogCount = 0,
    hydrationLogCount = 0,
    mediumRiskGapCount = 0,
    highRiskGapCount = 0,
    crashZoneGapCount = 0,
    fuelDebtMinutes = 0,
    crashLogCount = 0
  } = {}) {
    let score = 100;
    score -= Math.min(30, Math.round(Math.max(0, fuelDebtMinutes) / 5));
    score -= Math.min(18, Number(mediumRiskGapCount || 0) * 4);
    score -= Math.min(28, Number(highRiskGapCount || 0) * 10);
    score -= Math.min(30, Number(crashZoneGapCount || 0) * 15);
    score -= Math.min(20, Number(crashLogCount || 0) * 10);
    if (Number(fuelLogCount || 0) >= 3) score += 5;
    if (Number(hydrationLogCount || 0) >= 4) score += 5;
    score = clamp(Math.round(score), 0, 100);
    const statusLabel = score >= 80
      ? "Recovery Window Supported"
      : score >= 60
        ? "Recovery Window Needs Support"
        : "Recovery Window Needs Extra Support";
    const riskLabel = score >= 80 ? "protected" : score >= 60 ? "elevated" : "under-prepared";
    return { score, statusLabel, riskLabel };
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
    if (status === "green") return "Steady";
    if (status === "amber") return "Eat soon";
    if (status === "red") return "Eat now";
    return "Recovery needed";
  }

  function riskZone(score) {
    if (score <= 30) return { label: "Steady", tone: "green" };
    if (score <= 60) return { label: "Eat soon", tone: "amber" };
    if (score <= 80) return { label: "Eat now", tone: "red" };
    return { label: "Recovery needed", tone: "crash" };
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
    const mediumRiskGaps = gaps.filter(gap => awakeGapMinutes(gap) >= mediumRiskLimit());
    const mediumRiskHydrationGaps = hydrationGaps.filter(gap => gap.minutes >= hydrationGreenLimit());
    const highRiskGaps = gaps.filter(gap => awakeGapMinutes(gap) >= riskLimit());
    const highRiskHydrationGaps = hydrationGaps.filter(gap => gap.minutes >= hydrationRiskLimit());
    const crashZoneGaps = gaps.filter(gap => awakeGapMinutes(gap) >= crashRiskLimit());
    const hydrationCrashZoneGaps = hydrationGaps.filter(gap => gap.minutes >= hydrationCrashRiskLimit());
    const completedHighRiskGaps = completedGaps.filter(gap => awakeGapMinutes(gap) >= riskLimit());
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
    const recoveryWindow = recoveryWindowScore({
      fuelLogCount: fuelLogs.length,
      hydrationLogCount: hydrationLogs.length,
      mediumRiskGapCount: mediumRiskGaps.length + mediumRiskHydrationGaps.length,
      highRiskGapCount: highRiskGaps.length + highRiskHydrationGaps.length,
      crashZoneGapCount: crashZoneGaps.length + hydrationCrashZoneGaps.length,
      fuelDebtMinutes,
      crashLogCount: crashLogs.length
    });
    const crashCost = crashCostInsight({
      fuelDebtMinutes,
      likelyCostWindow: costWindow,
      hasCrash: crashLogs.length > 0,
      recoveryWindow
    });
    const strongestGap = [...gaps, ...hydrationGaps].sort((a, b) => b.minutes - a.minutes)[0] || null;
    const vulnerableWindow = strongestGap ? timeWindowBucket(minutesIntoDay(strongestGap.start) + strongestGap.minutes / 2) : "Needs more data";
    const maxRiskScore = maxRiskScoreForDay(key, { now, endedAt });
    const risk = riskZone(maxRiskScore);
    const summary = [];
    const fuelGapSentence = longest
      ? `Your longest fuel gap was ${duration(longest)}${crashZoneGaps.length ? ", reaching Recovery needed" : highRiskGaps.length ? ", reaching Eat now" : mediumRiskGaps.length ? ", reaching Eat soon" : ""}.`
      : fuelLogs.length ? "More fuel logs are needed before Fuel Guard can calculate fuel gaps." : "No fuel logs were recorded.";
    const hydrationSentence = longestHydration
      ? `Your longest hydration gap was ${duration(longestHydration)}${hydrationCrashZoneGaps.length ? ", reaching Recovery needed" : highRiskHydrationGaps.length ? ", reaching Sip now" : mediumRiskHydrationGaps.length ? ", reaching Sip soon" : ""}.`
      : hydrationLogs.length ? "More hydration logs are needed before Fuel Guard can calculate hydration gaps." : "No hydration logs were recorded.";
    const crashSentence = crashLogs.length
      ? `${crashLogs.length} low-energy event${crashLogs.length === 1 ? " was" : "s were"} marked.`
      : "No low-energy event was marked.";
    const plainSummary = `On ${dayNameForKey(key)}, you logged fuel ${fuelLogs.length} time${fuelLogs.length === 1 ? "" : "s"} and hydration ${hydrationLogs.length} time${hydrationLogs.length === 1 ? "" : "s"}. ${fuelGapSentence} ${fuelDebtCopy} Recovery support: ${recoveryRiskLabel(recoveryWindow.riskLabel)}. ${consistencyCopy(longest || null, longestHydration || null)} ${crashSentence}`;
    summary.push(plainSummary);
    if (mediumRiskGaps.length || mediumRiskHydrationGaps.length) summary.push("Eat soon / sip soon nudges appeared as early support signals.");
    if (highRiskGaps.length) summary.push("Longer fuel gaps appeared, so extra support could help around those windows.");
    if (highRiskHydrationGaps.length) summary.push("Hydration gaps also became stretched, which may affect how steady the day feels.");
    if (crashZoneGaps.length) summary.push("Fuel reached Recovery needed after Eat now.");
    if (hydrationCrashZoneGaps.length) summary.push("Hydration reached Recovery needed after Sip now.");
    crashCost.lines.slice(2).forEach(line => {
      if (line && !summary.includes(line)) summary.push(line);
    });
    if (reactive) summary.push("Fuel moments may have happened after longer gaps today.");
    if (isTrainingDayValue(dayType, trainingSession) && (highRiskGaps.length || crashLogs.length)) {
      summary.push(`${trainingSessionLabel(trainingSession)} days may benefit from easier fuel access before long gaps affect energy later.`);
    }
    if (fuelLogs.length < 3 && hydrationLogs.length < 3) summary.push("More logs will make this day easier to explain.");

    const bullets = [
      { label: "Longest fuel gap", value: durationText(longest) },
      { label: "Time beyond fuel window", value: fuelDebtDurationText(fuelDebtMinutes) },
      { label: "Rhythm support", value: `${recoveryWindow.score}/100` },
      { label: "Recovery support", value: recoveryRiskLabel(recoveryWindow.riskLabel) },
      { label: "Longest hydration gap", value: durationText(longestHydration) },
      { label: "Early nudges", value: String(mediumRiskGaps.length + mediumRiskHydrationGaps.length) },
      { label: "Act-now gaps", value: String(highRiskGaps.length + highRiskHydrationGaps.length) },
      { label: "Recovery-needed gaps", value: String(crashZoneGaps.length + hydrationCrashZoneGaps.length) },
      { label: "Support window", value: vulnerableWindow },
      { label: "Low-energy event marked", value: crashLogs.length ? "Yes" : "No" },
      { label: "Peak status", value: `${maxRiskScore}/100 ${risk.label}` }
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
      fuelGuardScore: recoveryWindow.score,
      recoveryWindowStatus: recoveryWindow.statusLabel,
      recoveryWindowRisk: recoveryWindow.riskLabel,
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
        note: displayNoteForLog(log)
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
      fuelGuardScore: analysis.fuelGuardScore,
      recoveryWindowStatus: analysis.recoveryWindowStatus,
      recoveryWindowRisk: analysis.recoveryWindowRisk,
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
      ? "Steady right now."
      : status === "amber"
        ? "Eat soon."
        : status === "red"
          ? "Eat now."
          : "Recovery needed.";

    return {
      lastFuelled: last ? formatClock(last.date) : "No fuel logged",
      timeSinceFuel: Number.isFinite(minutes) ? duration(minutes) : "No fuel logged",
      minutesSinceFuel: minutes,
      status,
      statusLabel: riskStatusLabel(status),
      nextAction: `Status: ${riskStatusLabel(status)}`,
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

  function recordRhythmLog(type = "fuel", options = {}) {
    const normalizedType = ["fuel", "hydration", "fuel_hydration"].includes(type) ? type : "fuel";
    const includesFuel = normalizedType === "fuel" || normalizedType === "fuel_hydration";
    const label = normalizedType === "hydration"
      ? "Hydration logged"
      : normalizedType === "fuel_hydration"
        ? "Fuel + hydration logged"
        : "Fuelled";
    if (includesFuel && cooldownRemainingSeconds() > 0 && !options.bypassCooldown) {
      renderFuelGap();
      return;
    }

    const loggedAt = new Date();
    const key = dateKey(loggedAt);
    const localId = uid();
    const log = {
      id: localId,
      localId,
      timestamp: loggedAt.toISOString(),
      eventTime: loggedAt.toISOString(),
      logged_at: loggedAt.toISOString(),
      label,
      type: normalizedType,
      logType: normalizedType,
      entryMethod: options.entryMethod || "live",
      source: options.source || "manual",
      plannedTime: options.plannedTime || null,
      ridePlanId: options.ridePlanId || "",
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key),
      createdAt: loggedAt.toISOString(),
      updatedAt: loggedAt.toISOString(),
      syncStatus: "pending"
    };
    betaState().logs.push(log);
    if (includesFuel && !options.bypassCooldown) setCooldown();
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

  function logById(id) {
    return betaState().logs.find(log => String(log.id || log.localId || log.cloudId || "") === String(id));
  }

  function logIndexById(id) {
    return betaState().logs.findIndex(log => String(log.id || log.localId || log.cloudId || "") === String(id));
  }

  function setMissedLogDefaults(log = null) {
    const date = logDate(log) || new Date();
    const type = log ? logType(log) : "fuel";
    const typeInput = document.getElementById("missedLogType");
    const dateInput = document.getElementById("missedLogDate");
    const timeInput = document.getElementById("missedLogTime");
    if (typeInput) typeInput.value = type === "hydration" ? "hydration" : "fuel";
    if (dateInput) dateInput.value = dateInputValue(date);
    if (timeInput) timeInput.value = timeInputValue(date);
  }

  function setMissedLogPanel(open, log = null) {
    const panel = document.getElementById("missedLogPanel");
    const button = document.getElementById("showMissedLogButton");
    if (panel) panel.hidden = !open;
    if (button) button.textContent = open ? "Editing missed log" : "Add missed log";
    missedLogEditingId = log ? String(log.id || log.localId || log.cloudId || "") : "";
    if (open) setMissedLogDefaults(log);
    if (!open) missedLogStatus = "";
    renderMissedLogPanel();
  }

  function duplicateLogExists(type, timestamp, ignoreId = "") {
    const target = new Date(timestamp).getTime();
    if (!Number.isFinite(target)) return false;
    return betaState().logs.some(log => {
      const id = String(log.id || log.localId || log.cloudId || "");
      if (ignoreId && id === String(ignoreId)) return false;
      const logTime = logDate(log);
      return logType(log) === type && logTime && Math.abs(logTime.getTime() - target) < 1000;
    });
  }

  function refreshLogDatesAfterChange(oldDate, newDate) {
    if (oldDate) storeArchive(dateKey(oldDate));
    if (newDate) storeArchive(dateKey(newDate));
    if (!oldDate && !newDate) storeArchive(dateKey());
  }

  function renderMissedLogPanel() {
    const panel = document.getElementById("missedLogPanel");
    if (!panel || panel.hidden) return;
    const status = document.getElementById("missedLogStatus");
    const saveButton = document.getElementById("saveMissedLogButton");
    if (status) status.textContent = missedLogStatus;
    if (saveButton) {
      saveButton.disabled = missedLogBusy;
      saveButton.textContent = missedLogEditingId ? "Save changes" : "Save";
    }
  }

  async function saveMissedLog() {
    if (missedLogBusy) return;
    const type = document.getElementById("missedLogType")?.value === "hydration" ? "hydration" : "fuel";
    const dateValue = document.getElementById("missedLogDate")?.value || "";
    const timeValue = document.getElementById("missedLogTime")?.value || "";
    const eventDate = dateTimeFromInputs(dateValue, timeValue);
    if (!eventDate) {
      missedLogStatus = "Choose a valid date and time.";
      renderMissedLogPanel();
      return;
    }
    if (eventDate > new Date()) {
      missedLogStatus = "Missed logs cannot be in the future.";
      renderMissedLogPanel();
      return;
    }
    if (duplicateLogExists(type, eventDate.toISOString(), missedLogEditingId)) {
      missedLogStatus = "That log already exists.";
      renderMissedLogPanel();
      return;
    }

    missedLogBusy = true;
    renderMissedLogPanel();
    const existing = missedLogEditingId ? logById(missedLogEditingId) : null;
    const oldDate = existing ? logDate(existing) : null;
    const label = type === "hydration" ? "Hydration logged" : "Fuelled";
    const key = dateKey(eventDate);
    const log = existing || {
      id: uid(),
      localId: uid(),
      createdAt: new Date().toISOString(),
      source: "manual"
    };
    Object.assign(log, {
      timestamp: eventDate.toISOString(),
      eventTime: eventDate.toISOString(),
      logged_at: eventDate.toISOString(),
      label,
      type,
      logType: type,
      entryMethod: existing?.entryMethod || "retrospective",
      source: existing?.source || "manual",
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key),
      updatedAt: new Date().toISOString(),
      syncStatus: "pending"
    });
    if (!existing) betaState().logs.push(log);
    refreshLogDatesAfterChange(oldDate, eventDate);
    state.completed.liveFuelStatus = true;
    save();
    renderAll();
    await window.fuelGuardCloud?.saveLog(log);
    missedLogBusy = false;
    missedLogStatus = "";
    setMissedLogPanel(false);
  }

  async function deleteRhythmLogById(id) {
    const index = logIndexById(id);
    if (index < 0) return;
    if (!window.confirm("Delete this log?")) return;
    const removed = betaState().logs.splice(index, 1)[0];
    refreshLogDatesAfterChange(logDate(removed), null);
    save();
    renderAll();
    await window.fuelGuardCloud?.deleteLog(removed);
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
      <div class="fuel-gap-insight"><span>Early nudges today</span><strong>${analysis.mediumRiskGapCount + analysis.mediumRiskHydrationGapCount}</strong><small>Snack/sip nudges before act-now gaps.</small></div>
      <div class="fuel-gap-insight"><span>Act-now gaps today</span><strong>${analysis.highRiskGapCount}</strong><small>Gaps at or over the act-now threshold.</small></div>
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
    const target = document.getElementById("fuelDailyLog");
    if (!target) return;
    const logs = todayLogs();
    if (dateEl) dateEl.textContent = logs.length ? `${logs.length} today` : "No logs yet";
    target.innerHTML = logs.length
      ? `<div class="beta-history-log-list beta-latest-log-list">${logs.map(log => renderLogEvent(log)).join("")}</div>`
      : `<p class="muted fuel-daily-empty">Log fuel or hydration when it happens.</p>`;
    renderMissedLogPanel();
  }

  function gapZoneReached(entry) {
    if (Number(entry?.crashZoneGapCount || 0) > 0) return "Recovery needed";
    if (Number(entry?.highRiskGapCount || 0) > 0) return "Eat now";
    if (Number(entry?.mediumRiskGapCount || 0) > 0) return "Eat soon";
    return "Steady";
  }

  function dailyIcon(name) {
    const icons = {
      fuel: '<path d="M9 3h6"/><path d="M10 3v4l-2 3v9a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-9l-2-3V3"/><path d="M9 14h6"/>',
      hydration: '<path d="M12 3s6 6.2 6 11a6 6 0 0 1-12 0c0-4.8 6-11 6-11z"/><path d="M9.5 15.5c.7 1.2 1.5 1.8 2.8 1.8"/>',
      gap: '<path d="M4 12h5"/><path d="M15 12h5"/><path d="M9 8v8"/><path d="M15 8v8"/><path d="M7 18h10"/>',
      warning: '<path d="m12 3 9 16H3L12 3z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      energy: '<path d="m13 2-8 12h6l-1 8 8-12h-6l1-8z"/>',
      score: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="m12 14 4-5"/><path d="M6.5 18h11"/>',
      shield: '<path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3z"/><path d="m9 12 2 2 4-5"/>',
      clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
      recovery: '<path d="M4 13h4l2-5 4 9 2-4h4"/><path d="M5 6a5 5 0 0 1 7 0 5 5 0 0 1 7 0c2 2 2 5 0 7l-7 7-7-7c-2-2-2-5 0-7z"/>',
      route: '<path d="M5 7a2 2 0 1 0 0 .01"/><path d="M19 17a2 2 0 1 0 0 .01"/><path d="M7 7h4a3 3 0 0 1 0 6h2a3 3 0 0 1 0 6h4"/>',
      check: '<path d="m5 12 4 4L19 6"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.fuel}</svg>`;
  }

  function riskToneFromText(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("crash") || text.includes("under")) return "danger";
    if (text.includes("high")) return "high";
    if (text.includes("medium") || text.includes("elevated") || text.includes("risk")) return "elevated";
    return "protected";
  }

  function recoveryRiskLabel(risk) {
    if (risk === "under-prepared") return "Needs extra support";
    if (risk === "elevated") return "Needs support";
    return "Supported";
  }

  function scoreStatusLabel(score) {
    if (score >= 80) return "Steady";
    if (score >= 60) return "Needs support";
    return "Needs care";
  }

  function calloutIconForLine(line) {
    const text = String(line || "").toLowerCase();
    if (text.includes("support") || text.includes("recovery")) return "shield";
    if (text.includes("window") || text.includes("later")) return "clock";
    if (text.includes("low-energy") || text.includes("risk")) return "warning";
    if (text.includes("target") || text.includes("gap")) return "route";
    return "recovery";
  }

  function renderDailySummaryBullets(entry) {
    const fuelCount = Number(entry.fuelLogCount || 0);
    const hydrationCount = Number(entry.hydrationLogCount || 0);
    const crashCount = Number(entry.crashLogCount || 0);
    const longestGap = longestFuelGapForEntry(entry);
    const longestGapText = entry.longestGap || durationText(entry.longestGapMinutes || 0);
    const gapZone = gapZoneReached(entry);
    const gapTone = riskToneFromText(gapZone);
    const gapStart = longestGap ? minutesIntoDay(longestGap.start) : 0;
    const gapEnd = longestGap ? minutesIntoDay(longestGap.end) : 0;
    const gapLeft = longestGap ? (gapStart / 1440) * 100 : 0;
    const gapWidth = longestGap ? Math.max(3, ((gapEnd - gapStart) / 1440) * 100) : 0;
    const gapLabelLeft = longestGap ? gapLeft + gapWidth / 2 : 50;
    return `
      <section class="beta-daily-summary-visual" aria-label="Daily visual summary">
        <div class="beta-daily-log-tiles">
          <article class="beta-log-tile ${fuelCount ? "logged" : "empty"}">
            <span class="beta-icon-disc">${dailyIcon("fuel")}</span>
            <div class="beta-mini-ring" style="--ring-pct:${stylePercent(Math.min(100, (fuelCount / 3) * 100))}"><strong>${fuelCount}</strong></div>
            <div><span>Fuel Logs</span><small>${fuelCount ? "Logged today" : "No fuel yet"}</small></div>
            <i class="beta-check-dot">${fuelCount ? dailyIcon("check") : ""}</i>
          </article>
          <article class="beta-log-tile hydration ${hydrationCount ? "logged" : "empty"}">
            <span class="beta-icon-disc">${dailyIcon("hydration")}</span>
            <div class="beta-mini-ring" style="--ring-pct:${stylePercent(Math.min(100, (hydrationCount / 4) * 100))}"><strong>${hydrationCount}</strong></div>
            <div><span>Hydration Logs</span><small>${hydrationCount ? "Logged today" : "No hydration yet"}</small></div>
            <i class="beta-check-dot">${hydrationCount ? dailyIcon("check") : ""}</i>
          </article>
        </div>

        <article class="beta-longest-gap-card ${safeText(gapTone)}">
          <div class="beta-metric-card-head">
            <span class="beta-icon-disc amber">${dailyIcon("gap")}</span>
            <div><span>Longest Fuel Gap</span><strong>${safeText(longestGapText)}</strong></div>
          </div>
          <div class="beta-mini-dayline" aria-hidden="true">
            ${longestGap ? `<span class="beta-gap-bubble" style="left:${stylePercent(gapLabelLeft)}">${safeText(longestGapText)}</span>` : ""}
            ${longestGap ? `<span class="beta-mini-gap-segment" style="left:${stylePercent(gapLeft)};width:${stylePercent(gapWidth)}"></span>` : ""}
          </div>
          <div class="beta-mini-dayline-axis"><span>Morning</span><span>Midday</span><span>Evening</span></div>
        </article>

        <div class="beta-daily-metric-grid">
          <article class="beta-visual-metric-card ${safeText(gapTone)}">
            <div class="beta-metric-card-head">
              <span class="beta-icon-disc amber">${dailyIcon("warning")}</span>
              <div><span>Gap Zone Reached</span><strong>${safeText(gapZone)}</strong></div>
            </div>
            <b class="beta-status-chip">${safeText(gapZone)}</b>
          </article>
          <article class="beta-visual-metric-card ${crashCount ? "danger" : "quiet"}">
            <div class="beta-metric-card-head">
              <span class="beta-icon-disc">${dailyIcon("energy")}</span>
              <div><span>Low-Energy Events Marked</span><strong>${crashCount}</strong></div>
            </div>
            <small>${crashCount ? "Marked on this day" : "None marked"}</small>
          </article>
        </div>
      </section>
    `;
  }

  function recoveryWindowForEntry(entry) {
    const computed = recoveryWindowScore({
      fuelLogCount: entry?.fuelLogCount || 0,
      hydrationLogCount: entry?.hydrationLogCount || 0,
      mediumRiskGapCount: Number(entry?.mediumRiskGapCount || 0) + Number(entry?.mediumRiskHydrationGapCount || 0),
      highRiskGapCount: Number(entry?.highRiskGapCount || 0) + Number(entry?.highRiskHydrationGapCount || 0),
      crashZoneGapCount: Number(entry?.crashZoneGapCount || 0) + Number(entry?.hydrationCrashZoneGapCount || 0),
      fuelDebtMinutes: entry?.fuelDebtMinutes || 0,
      crashLogCount: entry?.crashLogCount || 0
    });
    const storedScore = Number(entry?.fuelGuardScore);
    if (!Number.isFinite(storedScore)) return computed;
    const score = clamp(Math.round(storedScore), 0, 100);
    const statusLabel = entry?.recoveryWindowStatus || (
      score >= 80 ? "Recovery Window Supported" : score >= 60 ? "Recovery Window Needs Support" : "Recovery Window Needs Extra Support"
    );
    const riskLabel = entry?.recoveryWindowRisk || (score >= 80 ? "protected" : score >= 60 ? "elevated" : "under-prepared");
    return { score, statusLabel, riskLabel };
  }

  function crashCostInsightForEntry(entry) {
    if (entry?.crashCostInsight?.lines?.length) return entry.crashCostInsight;
    return crashCostInsight({
      fuelDebtMinutes: entry?.fuelDebtMinutes || 0,
      likelyCostWindow: entry?.likelyCostWindow || "stable for now",
      hasCrash: Number(entry?.crashLogCount || 0) > 0,
      recoveryWindow: recoveryWindowForEntry(entry)
    });
  }

  function renderCrashCostInsight(entry) {
    const insight = crashCostInsightForEntry(entry);
    const lines = Array.isArray(insight.lines) ? insight.lines : [];
    if (!lines.length) return "";
    const recoveryWindow = recoveryWindowForEntry(entry);
    const fuelDebtMinutes = Math.max(0, Math.round(Number(entry?.fuelDebtMinutes || 0)));
    const fuelDebtText = entry?.fuelDebtText || insight.debtText || fuelDebtDurationText(fuelDebtMinutes);
    const costWindow = insight.costWindow || entry?.likelyCostWindow || "stable for now";
    const riskLabel = recoveryRiskLabel(recoveryWindow.riskLabel);
    const tone = riskToneFromText(recoveryWindow.riskLabel || insight.level);
    const longestGap = longestFuelGapForEntry(entry);
    const preferredWindow = mediumRiskLimit();
    const gapStart = longestGap ? minutesIntoDay(longestGap.start) : 0;
    const gapEnd = longestGap ? minutesIntoDay(longestGap.end) : 0;
    const safeEnd = longestGap ? Math.min(gapEnd, gapStart + preferredWindow) : 0;
    const safeLeft = longestGap ? (gapStart / 1440) * 100 : 6;
    const safeWidth = longestGap ? Math.max(4, ((safeEnd - gapStart) / 1440) * 100) : 28;
    const debtLeft = longestGap ? (safeEnd / 1440) * 100 : 34;
    const debtWidth = longestGap ? Math.max(0, ((gapEnd - safeEnd) / 1440) * 100) : fuelDebtMinutes ? 16 : 0;
    const recoveryLeft = costWindow.includes("post-shift") ? 74 : costWindow.includes("later") ? 66 : 82;
    const recoveryWidth = costWindow === "stable for now" ? 12 : 22;
    const callouts = lines
      .filter(line => !/^time beyond fuel window:/i.test(line))
      .filter(line => !/^recovery support:/i.test(line))
      .filter(line => !/^possible impact window:/i.test(line))
      .slice(0, 6);
    return `
      <section class="beta-crash-cost-insight ${safeText(tone)} ${safeText(insight.level || "stable")}" aria-label="Later energy impact">
        <div class="beta-crash-insight-head">
          <span class="beta-icon-disc amber">${dailyIcon("recovery")}</span>
          <div>
            <h4>${safeText(insight.title || "Later Energy Impact")}</h4>
            <p>Time beyond your fuel window shows where later support may help.</p>
          </div>
          <b class="beta-status-chip">${safeText(riskLabel)}</b>
        </div>
        <div class="beta-crash-summary-row">
          <article><span>${dailyIcon("clock")}Time beyond window</span><strong>${safeText(fuelDebtText)}</strong></article>
          <article><span>${dailyIcon("warning")}Recovery support</span><strong>${safeText(riskLabel)}</strong></article>
          <article><span>${dailyIcon("shield")}Support window</span><strong>${safeText(costWindow)}</strong></article>
        </div>
        <div class="beta-crash-timeline" aria-label="Later energy impact timeline">
          <span class="beta-crash-safe" style="left:${stylePercent(safeLeft)};width:${stylePercent(safeWidth)}"></span>
          <span class="beta-crash-debt" style="left:${stylePercent(debtLeft)};width:${stylePercent(debtWidth)}"></span>
          <span class="beta-crash-recovery" style="left:${stylePercent(recoveryLeft)};width:${stylePercent(recoveryWidth)}"></span>
          ${longestGap ? `<i class="beta-crash-marker start" style="left:${stylePercent(safeLeft)}"></i><i class="beta-crash-marker end" style="left:${stylePercent((gapEnd / 1440) * 100)}"></i>` : ""}
        </div>
        <div class="beta-crash-timeline-labels">
          <span>In your fuel window</span>
          <span>Extra support may help here</span>
          <span>${safeText(costWindow === "stable for now" ? "Recovery window stable" : "Support your recovery window")}</span>
        </div>
        <div class="beta-crash-callouts">
          ${callouts.map(line => `
            <article>
              <span class="beta-icon-disc">${dailyIcon(calloutIconForLine(line))}</span>
              <p>${safeText(line)}</p>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function entryLogsWithDates(entry) {
    return (entry?.logs || [])
      .map(log => ({ ...log, date: logDate(log.timestamp || log) }))
      .filter(log => log.date)
      .sort((a, b) => a.date - b.date);
  }

  function longestFuelGapForEntry(entry) {
    const gaps = Array.isArray(entry?.gaps) && entry.gaps.length
      ? entry.gaps
      : gapsFromFuelLogs(entryLogsWithDates(entry).filter(isFuelLog));
    return gaps
      .map(gap => ({
        ...gap,
        start: logDate(gap.start),
        end: logDate(gap.end),
        minutes: Number(gap.minutes || 0)
      }))
      .filter(gap => gap.start && gap.end && Number.isFinite(gap.minutes))
      .sort((a, b) => b.minutes - a.minutes)[0] || null;
  }

  function stylePercent(value) {
    return `${clamp(Number(value) || 0, 0, 100).toFixed(2)}%`;
  }

  function renderPersonalDailyInsights(entry) {
    const recoveryWindow = recoveryWindowForEntry(entry);
    const fuelDebtMinutes = Math.max(0, Math.round(Number(entry.fuelDebtMinutes || 0)));
    const fuelDebtText = entry.fuelDebtText || fuelDebtDurationText(fuelDebtMinutes);
    const longestGap = longestFuelGapForEntry(entry);
    const longestFuelGap = entry.longestGap || durationText(entry.longestGapMinutes || 0);
    const fuelLogs = entryLogsWithDates(entry).filter(isFuelLog);
    const storyLevel = fuelDebtLevel(fuelDebtMinutes);
    const preferredWindow = mediumRiskLimit();
    const score = clamp(Number(recoveryWindow.score || 0), 0, 100);
    const costWindow = entry.likelyCostWindow && entry.likelyCostWindow !== "stable for now"
      ? entry.likelyCostWindow
      : "stable for now";
    const storyTitle = fuelDebtMinutes
      ? `You spent ${fuelDebtText} beyond your preferred fuelling window.`
      : "Your fuelling rhythm stayed steady.";
    const recoveryCopy = recoveryWindow.riskLabel === "protected"
      ? "Your work/training recovery window looks supported today."
      : recoveryWindow.riskLabel === "elevated"
        ? "Your work/training recovery window may need extra care today."
        : "Your work/training recovery window may need extra support today.";
    const longestGapCopy = longestGap
      ? `Your longest gap ran ${formatClock(longestGap.start)}-${formatClock(longestGap.end)}.`
      : "Log at least two fuel points to reveal your longest gap.";
    const gapStart = longestGap ? minutesIntoDay(longestGap.start) : 0;
    const gapEnd = longestGap ? minutesIntoDay(longestGap.end) : 0;
    const gapLeft = longestGap ? (gapStart / 1440) * 100 : 0;
    const gapWidth = longestGap ? Math.max(2, ((gapEnd - gapStart) / 1440) * 100) : 0;
    const debtStart = longestGap ? Math.min(gapEnd, gapStart + preferredWindow) : 0;
    const debtLeft = longestGap ? (debtStart / 1440) * 100 : 0;
    const debtWidth = longestGap ? Math.max(0, ((gapEnd - debtStart) / 1440) * 100) : 0;
    const markers = fuelLogs.map(log => {
      const left = (minutesIntoDay(log.date) / 1440) * 100;
      return `<span class="beta-fuel-story-marker" style="left:${stylePercent(left)}" title="${safeText(formatClock(log.date))} fuel logged"></span>`;
    }).join("");
    return `
      <section class="beta-fuel-story ${safeText(storyLevel)}" aria-label="Visual fuel story">
        <div class="beta-fuel-story-head">
          <div>
          <span>Your fuel story</span>
            <h4>${safeText(storyTitle)}</h4>
            <p>${safeText(longestGapCopy)} ${safeText(recoveryCopy)}</p>
          </div>
          <div class="beta-recovery-orb" style="--score-pct:${stylePercent(score)}">
            <strong>${Math.round(score)}</strong>
            <span>Score</span>
          </div>
        </div>
        <div class="beta-fuel-story-track" aria-hidden="true">
          <span class="beta-fuel-story-gap" style="left:${stylePercent(gapLeft)};width:${stylePercent(gapWidth)}"></span>
          <span class="beta-fuel-story-debt" style="left:${stylePercent(debtLeft)};width:${stylePercent(debtWidth)}"></span>
          ${markers}
        </div>
        <div class="beta-fuel-story-axis" aria-hidden="true">
          <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
        </div>
        <div class="beta-fuel-story-legend">
          <span><i class="protected"></i>Supported rhythm</span>
          <span><i class="gap"></i>Longest gap: ${safeText(longestFuelGap)}</span>
          <span><i class="debt"></i>Beyond fuel window: ${safeText(fuelDebtText)}</span>
        </div>
        <div class="beta-recovery-window-strip">
          <span>Recovery window</span>
          <strong>${safeText(recoveryWindow.statusLabel)}</strong>
          <small>${safeText(costWindow === "stable for now" ? "Stable for now" : `Support: ${costWindow}`)}</small>
        </div>
      </section>
    `;
  }

  function renderDailyBullets(entry) {
    const recoveryWindow = recoveryWindowForEntry(entry);
    const sourceBullets = Array.isArray(entry.bullets) && entry.bullets.length
      ? entry.bullets
      : [
        { label: "Longest fuel gap", value: entry.longestGap || "Not enough data" },
        { label: "Time beyond fuel window", value: entry.fuelDebtText || fuelDebtDurationText(entry.fuelDebtMinutes || 0) },
        { label: "Longest hydration gap", value: entry.longestHydrationGap || "Not enough data" },
        { label: "Early nudges", value: String((entry.mediumRiskGapCount || 0) + (entry.mediumRiskHydrationGapCount || 0)) },
        { label: "Act-now gaps", value: String((entry.highRiskGapCount || 0) + (entry.highRiskHydrationGapCount || 0)) },
        { label: "Recovery-needed gaps", value: String((entry.crashZoneGapCount || 0) + (entry.hydrationCrashZoneGapCount || 0)) },
        { label: "Support window", value: entry.vulnerableWindow || "Needs more data" },
        { label: "Low-energy event marked", value: entry.crashLogCount ? "Yes" : "No" }
      ];
    const bullets = sourceBullets
      .filter(item => item.label !== "Likely cost window")
      .filter(item => item.label !== "Fuel Guard Score" && item.label !== "Rhythm support" && item.label !== "Recovery window risk" && item.label !== "Recovery support");
    bullets.splice(2, 0,
      { label: "Rhythm support", value: `${recoveryWindow.score}/100` },
      { label: "Recovery support", value: recoveryRiskLabel(recoveryWindow.riskLabel) }
    );
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
      <div class="beta-daily-timeline" aria-label="Fuel, hydration and low-energy markers across the day">
        <div class="beta-timeline-track">${points}</div>
        <div class="beta-timeline-axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span></div>
        <div class="beta-timeline-legend"><span class="fuel">Fuel</span><span class="hydration">Hydration</span><span class="crash">Low-energy marker</span></div>
      </div>
    `;
  }

  function renderLogEvent(log, { note: noteOverride = "" } = {}) {
    const date = logDate(log.timestamp || log);
    const displayNote = noteOverride || displayNoteForLog(log);
    const type = logType(log);
    const id = String(log?.id || log?.localId || log?.cloudId || "");
    const note = displayNote ? `<small>${safeText(displayNote)}</small>` : "";
    const method = log.entryMethod && log.entryMethod !== "live" ? `<small>${safeText(log.entryMethod)}</small>` : "";
    const source = log.source && log.source !== "manual" ? `<small>${safeText(log.source)}</small>` : "";
    return `
      <article class="beta-history-log-event ${safeText(type)}">
        <span class="beta-icon-disc ${type === "fuel" ? "" : type === "hydration" ? "shield" : "amber"}">${dailyIcon(type === "hydration" ? "hydration" : type === "crash" ? "energy" : "fuel")}</span>
        <div>
          <strong>${date ? formatClock(date) : "--"}</strong>
          <span>${safeText(log.typeLabel || logTypeLabel(log))}</span>
          ${note || method || source ? `<div class="beta-history-log-meta">${note}${method}${source}</div>` : ""}
          ${id && type !== "crash" ? `<div class="beta-log-event-actions"><button class="secondary" type="button" data-edit-log="${safeText(id)}">Edit</button><button class="secondary danger-secondary" type="button" data-delete-log="${safeText(id)}">Delete</button></div>` : ""}
        </div>
      </article>
    `;
  }

  function renderRawLogs(entry) {
    if (!entry.logs.length) return `<p class="muted">No raw logs stored for this day.</p>`;
    const logsHtml = entry.logs.map(log => renderLogEvent(log)).join("");
    return `<section class="beta-raw-log-details beta-history-log-view"><h4>Logged events</h4><div class="beta-history-log-list">${logsHtml}</div></section>`;
  }

  function renderDailySummaryNote(entry) {
    const fuelCount = Number(entry?.fuelLogCount || 0);
    const hydrationCount = Number(entry?.hydrationLogCount || 0);
    const gap = entry?.longestGap || durationText(entry?.longestGapMinutes || 0);
    const zone = gapZoneReached(entry);
    const crashCount = Number(entry?.crashLogCount || 0);
    return `
      <p class="beta-daily-summary-note">
        You logged fuel ${fuelCount} time${fuelCount === 1 ? "" : "s"} and hydration ${hydrationCount} time${hydrationCount === 1 ? "" : "s"}. Your longest fuel gap was ${safeText(gap)}, reaching ${safeText(zone)}.${crashCount ? ` ${crashCount} low-energy event${crashCount === 1 ? " was" : "s were"} marked.` : " No low-energy events were marked."}
      </p>
    `;
  }

  function renderHistoryDayOverview(entries) {
    const logged = entries
      .filter(entry => Number(entry.fuelLogCount || 0) > 0 || Number(entry.hydrationLogCount || 0) > 0 || Number(entry.crashLogCount || 0) > 0)
      .sort((a, b) => dateFromKey(b.date) - dateFromKey(a.date))
      .slice(0, 14);
    if (!logged.length) return "";
    return `
      <section class="beta-history-day-strip" aria-label="Previous fuel rhythm days">
        <div class="beta-history-day-strip-head">
          <h4>Previous days</h4>
          <span>Fuel, hydration, longest gap and support level reached</span>
        </div>
        <div class="beta-history-day-cards">
          ${logged.map(entry => {
            const zone = gapZoneReached(entry);
            const tone = riskToneFromText(zone);
            const selected = entry.date === selectedHistoryKey;
            return `
              <button class="beta-history-day-card ${safeText(tone)}${selected ? " selected" : ""}" type="button" data-history-day="${safeText(entry.date)}" aria-pressed="${selected ? "true" : "false"}">
                <span>${safeText(entry.dateLabel)}</span>
                <strong>${safeText(entry.longestGap || durationText(entry.longestGapMinutes || 0))}</strong>
                <small>${safeText(zone)}</small>
                <em>${dailyIcon("fuel")}${Number(entry.fuelLogCount || 0)} ${dailyIcon("hydration")}${Number(entry.hydrationLogCount || 0)} ${Number(entry.crashLogCount || 0) ? `${dailyIcon("energy")}${Number(entry.crashLogCount || 0)}` : ""}</em>
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `;
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
      <div class="fuel-archive-head"><div><p class="label">${safeText(entry.dateLabel)}</p><h3>${safeText(heading || "Day context not set")}</h3></div><span class="status-pill ${riskSignalTotal ? "amber" : "green"}">${riskSignalTotal ? "SUPPORT SIGNALS" : "STABLE"}</span></div>
      ${renderDailySummaryNote(entry)}
      ${renderDailySummaryBullets(entry)}
      <div class="beta-daily-visuals">
        <section class="beta-daily-visual"><h4>Daily timeline</h4>${renderDailyTimeline(entry)}</section>
      </div>
      ${renderRawLogs(entry)}
    `;
  }

  function renderDailyTimelineDetail(entry) {
    if (!entry) return `<p class="muted">No daily timeline yet. Log fuel or hydration to build today's rhythm.</p>`;
    return `
      <section class="beta-daily-visual beta-daily-timeline-section" aria-label="Daily Timeline">
        <div class="section-heading-row">
          <h3>Daily Timeline</h3>
          <span class="row-note">${safeText(entry.dateLabel || "Today")}</span>
        </div>
        ${renderDailyTimeline(entry)}
      </section>
    `;
  }

  function impactDayPhrase(entry) {
    if (!entry?.date) return "for this day";
    return entry.date === dateKey() ? "today" : `on ${entry.dateLabel || formatDateKey(entry.date)}`;
  }

  function impactToneForEntry(entry) {
    if (Number(entry?.fuelDebtMinutes || 0) >= 120 || Number(entry?.crashLogCount || 0) > 0) return "high";
    if (Number(entry?.fuelDebtMinutes || 0) > 0 || Number(entry?.highRiskGapCount || 0) > 0) return "elevated";
    return "stable";
  }

  function impactWindowLabel(entry) {
    const longestGap = longestFuelGapForEntry(entry);
    if (longestGap) {
      return timeWindowBucket(minutesIntoDay(longestGap.start) + Number(longestGap.minutes || 0) / 2);
    }
    return entry?.vulnerableWindow || "not clear yet";
  }

  function fuelDebtTodayCopy(entry) {
    const minutes = Math.max(0, Math.round(Number(entry?.fuelDebtMinutes || 0)));
    if (minutes > 0) {
      return `You spent ${fuelDebtDurationText(minutes)} beyond your preferred fuelling window ${impactDayPhrase(entry)}.`;
    }
    return `You stayed inside your preferred fuelling window ${impactDayPhrase(entry)}.`;
  }

  function hasLongGapSignal(entry) {
    return Number(entry?.fuelDebtMinutes || 0) > 0
      || Number(entry?.longestGapMinutes || 0) >= mediumRiskLimit()
      || Number(entry?.highRiskGapCount || 0) > 0
      || Number(entry?.crashZoneGapCount || 0) > 0;
  }

  function isProtectedImpactDay(entry) {
    return Number(entry?.fuelDebtMinutes || 0) <= 0
      && Number(entry?.highRiskGapCount || 0) <= 0
      && Number(entry?.crashZoneGapCount || 0) <= 0
      && Number(entry?.crashLogCount || 0) <= 0;
  }

  function impactSignalTone(entry, signal = "overall") {
    if (signal === "protected") return isProtectedImpactDay(entry) ? "stable" : "elevated";
    if (signal === "energy") return Number(entry?.crashLogCount || 0) > 0 ? "high" : "stable";
    if (signal === "window") return hasLongGapSignal(entry) || Number(entry?.crashLogCount || 0) > 0 ? "elevated" : "stable";
    if (signal === "debt") return Number(entry?.fuelDebtMinutes || 0) > 0 ? impactToneForEntry(entry) : "stable";
    if (signal === "gap") return Number(entry?.longestGapMinutes || 0) >= mediumRiskLimit() ? impactToneForEntry(entry) : "stable";
    return impactToneForEntry(entry);
  }

  function longestFuelGapImpactCopy(entry) {
    const gapText = entry?.longestGap || durationText(entry?.longestGapMinutes || 0);
    if (!Number(entry?.fuelLogCount || 0)) return "No fuel logs were recorded for this day yet.";
    if (!Number(entry?.longestGapMinutes || 0)) return "Log at least two fuel moments to see the longest fuel gap for this day.";
    const zone = gapZoneReached(entry);
    return `Your longest fuel gap ${impactDayPhrase(entry)} was ${gapText}, reaching ${zone}.`;
  }

  function lowEnergyAfterLongGapForEntry(entry) {
    const crashCount = Number(entry?.crashLogCount || 0);
    return crashCount > 0 && hasLongGapSignal(entry) ? crashCount : 0;
  }

  function lowEnergyAfterLongGapImpactCopy(entry) {
    const count = lowEnergyAfterLongGapForEntry(entry);
    const crashCount = Number(entry?.crashLogCount || 0);
    if (count > 0) {
      return `${count} low-energy event${count === 1 ? "" : "s"} appeared after a long fuel gap signal ${impactDayPhrase(entry)}.`;
    }
    if (crashCount > 0) return `${crashCount} low-energy event${crashCount === 1 ? " was" : "s were"} marked, but Fuel Guard does not see a long-gap signal before it yet.`;
    return "No low-energy events were marked after long fuel gaps on this day.";
  }

  function highestRiskWindowImpactCopy(entry) {
    if (!hasLongGapSignal(entry) && !Number(entry?.crashLogCount || 0)) {
      return "No clear highest-risk window stood out from this selected day.";
    }
    const windowLabel = impactWindowLabel(entry);
    const dayType = entry?.dayType || "";
    const training = entry?.trainingSession || "";
    if (dayType === "work") return `The highest-risk window ${impactDayPhrase(entry)} was around ${windowLabel} on a working day.`;
    if (training && training !== "rest") return `The highest-risk window ${impactDayPhrase(entry)} was around ${windowLabel} on a ${trainingSessionLabel(training).toLowerCase()} day.`;
    return `The highest-risk window ${impactDayPhrase(entry)} was around ${windowLabel}.`;
  }

  function protectedDayImpactCopy(entry) {
    if (isProtectedImpactDay(entry)) {
      return `This was a steadier day: time beyond your preferred fuelling window, Eat now gaps, Recovery needed windows, and low-energy events stayed clear.`;
    }
    const reasons = [];
    if (Number(entry?.fuelDebtMinutes || 0) > 0) reasons.push("time beyond your preferred fuelling window");
    if (Number(entry?.highRiskGapCount || 0) > 0) reasons.push("Eat now gaps");
    if (Number(entry?.crashZoneGapCount || 0) > 0) reasons.push("Recovery needed windows");
    if (Number(entry?.crashLogCount || 0) > 0) reasons.push("low-energy events");
    const reasonText = reasons.length > 1
      ? `${reasons.slice(0, -1).join(", ")} and ${reasons[reasons.length - 1]}`
      : reasons[0] || "support signals";
    return `This day may need more support because ${reasonText} showed up.`;
  }

  function renderImpactCard({ title, text, meta = "", icon = "recovery", tone = "stable", children = "" }) {
    const iconTone = tone === "high" ? "danger" : tone === "elevated" ? "amber" : "shield";
    return `
      <article class="beta-impact-simple-card ${safeText(tone)} beta-impact-signal-${safeText(icon)}">
        <div class="beta-impact-simple-head">
          <span class="beta-icon-disc ${safeText(iconTone)}">${dailyIcon(icon)}</span>
          <div>
            <h4>${safeText(title)}</h4>
            ${meta ? `<small>${safeText(meta)}</small>` : ""}
          </div>
        </div>
        <p>${safeText(text)}</p>
        ${children}
      </article>
    `;
  }

  function renderImpactDebtVisual(entry) {
    const debtMinutes = Math.max(0, Math.round(Number(entry?.fuelDebtMinutes || 0)));
    const longestGap = longestFuelGapForEntry(entry);
    const longestText = entry?.longestGap || durationText(entry?.longestGapMinutes || 0);
    const width = stylePercent(Math.min(100, (debtMinutes / 180) * 100));
    return `
      <div class="beta-impact-debt-rail" aria-label="Fuel Debt visual">
        <span style="width:${width}"></span>
      </div>
      <div class="beta-impact-mini-meta">
        <span>Longest gap: ${safeText(longestText)}</span>
        <span>${longestGap ? safeText(`${formatClock(longestGap.start)}-${formatClock(longestGap.end)}`) : safeText(entry?.highRiskWindow || entry?.vulnerableWindow || "Window from saved summary")}</span>
      </div>
    `;
  }

  function renderImpactDetail(entry) {
    if (!entry) return `<p class="muted">No impact story yet. Log fuel for a day and Impact will explain possible later energy impact.</p>`;
    const fuelDebtMinutes = Math.max(0, Math.round(Number(entry.fuelDebtMinutes || 0)));
    const highestRiskWindow = hasLongGapSignal(entry) || Number(entry.crashLogCount || 0)
      ? impactWindowLabel(entry)
      : "Not clear yet";
    return `
      <section class="beta-impact-simple-grid" aria-label="Impact insights">
        ${renderImpactCard({
          title: "Highest-Risk Window",
          text: highestRiskWindowImpactCopy(entry),
          meta: highestRiskWindow,
          icon: "route",
          tone: impactSignalTone(entry, "window")
        })}
        ${renderImpactCard({
          title: "Longest Fuel Gap",
          text: longestFuelGapImpactCopy(entry),
          meta: entry.longestGap || durationText(entry.longestGapMinutes || 0),
          icon: "clock",
          tone: impactSignalTone(entry, "gap")
        })}
        ${renderImpactCard({
          title: "Fuel Debt",
          text: fuelDebtTodayCopy(entry),
          meta: fuelDebtDurationText(fuelDebtMinutes),
          icon: "gap",
          tone: impactSignalTone(entry, "debt"),
          children: renderImpactDebtVisual(entry)
        })}
      </section>
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

  function weeklyTrendWindows(entries, referenceDate = new Date()) {
    const thisStart = startOfCalendarWeek(referenceDate);
    const nextStart = addDays(thisStart, 7);
    const lastStart = addDays(thisStart, -7);
    return {
      current: entries.filter(entry => {
        const date = dateFromKey(entry.date);
        return date >= thisStart && date < nextStart;
      }),
      previous: entries.filter(entry => {
        const date = dateFromKey(entry.date);
        return date >= lastStart && date < thisStart;
      })
    };
  }

  function crashRiskSignalsForEntry(entry) {
    const manualCrash = Number(entry.crashLogCount || 0);
    const highRiskFuel = Number(entry.highRiskGapCount || 0);
    const crashZoneFuel = Number(entry.crashZoneGapCount || 0);
    const extraSupportWindow = Number(entry.fuelDebtMinutes || 0) >= 60 ? 1 : 0;
    return manualCrash + highRiskFuel + crashZoneFuel + extraSupportWindow;
  }

  function trendMetrics(entries) {
    const hasEntries = entries.length > 0;
    const sumMetric = valueForEntry => hasEntries
      ? entries.reduce((sum, entry) => sum + valueForEntry(entry), 0)
      : null;
    return {
      averageFuelGap: averageValue(entries.map(entry => Number(entry.averageGapMinutes || 0)).filter(Boolean)),
      averageHydrationGap: averageValue(entries.map(entry => Number(entry.averageHydrationGapMinutes || 0)).filter(Boolean)),
      mediumRiskGaps: sumMetric(entry => Number(entry.mediumRiskGapCount || 0) + Number(entry.mediumRiskHydrationGapCount || 0)),
      highRiskGaps: sumMetric(entry => Number(entry.highRiskGapCount || 0) + Number(entry.highRiskHydrationGapCount || 0)),
      crashZoneGaps: sumMetric(entry => Number(entry.crashZoneGapCount || 0) + Number(entry.hydrationCrashZoneGapCount || 0)),
      crashEvents: sumMetric(entry => crashRiskSignalsForEntry(entry)),
      manualCrashEvents: sumMetric(entry => Number(entry.crashLogCount || 0)),
      fuelDebtMinutes: sumMetric(entry => Number(entry.fuelDebtMinutes || 0)),
      fuelGuardScore: averageValue(entries.map(entry => Number(entry.fuelGuardScore || 0)).filter(Boolean)),
      fuelLogs: sumMetric(entry => Number(entry.fuelLogCount || 0)),
      hydrationLogs: sumMetric(entry => Number(entry.hydrationLogCount || 0)),
      extraSupportWindows: sumMetric(entry => Number(entry.fuelDebtMinutes || 0) >= 60 ? 1 : 0),
      days: entries.length
    };
  }

  function renderTrendMiniBars(current, previous, { currentLabel = "This week", previousLabel = "Last week", unit = "" } = {}) {
    const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
    const safePrevious = Number.isFinite(previous) ? Math.max(0, previous) : 0;
    const max = Math.max(safeCurrent, safePrevious, 1);
    const currentText = Number.isFinite(current)
      ? unit === "minutes" ? compactDuration(safeCurrent) : String(Math.round(safeCurrent))
      : "Building";
    const previousText = Number.isFinite(previous)
      ? unit === "minutes" ? compactDuration(safePrevious) : String(Math.round(safePrevious))
      : "Building";
    return `
      <div class="beta-trend-mini-bars">
        <span><b>${safeText(currentLabel)}</b><i style="width:${stylePercent((safeCurrent / max) * 100)}"></i><em>${safeText(currentText)}</em></span>
        <span><b>${safeText(previousLabel)}</b><i class="previous" style="width:${stylePercent((safePrevious / max) * 100)}"></i><em>${safeText(previousText)}</em></span>
      </div>
    `;
  }

  function entryMetricValue(entry, metric) {
    if (!entry) return null;
    const value = Number(metric(entry));
    return Number.isFinite(value) ? Math.max(0, value) : null;
  }

  function trendChartWeekStart(current) {
    const dated = current.filter(entry => entry?.date).sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));
    return startOfCalendarWeek(dated.length ? dateFromKey(dated[0].date) : new Date());
  }

  function weeklyTrendChartPoints(current, previous, metric) {
    const currentStart = trendChartWeekStart(current);
    const previousStart = addDays(currentStart, -7);
    const currentByDate = Object.fromEntries(current.filter(entry => entry?.date).map(entry => [entry.date, entry]));
    const previousByDate = Object.fromEntries(previous.filter(entry => entry?.date).map(entry => [entry.date, entry]));
    return Array.from({ length: 7 }, (_, index) => {
      const currentDate = addDays(currentStart, index);
      const previousDate = addDays(previousStart, index);
      const currentKey = dateKey(currentDate);
      const previousKey = dateKey(previousDate);
      return {
        label: currentDate.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
        shortLabel: currentDate.toLocaleDateString(undefined, { weekday: "short" }),
        current: entryMetricValue(currentByDate[currentKey], metric),
        previous: entryMetricValue(previousByDate[previousKey], metric)
      };
    });
  }

  function hasTrendChartData(points) {
    return points.some(point => Number.isFinite(point.current) || Number.isFinite(point.previous));
  }

  function trendChartMax(points) {
    const values = points
      .flatMap(point => [point.current, point.previous])
      .filter(value => Number.isFinite(value));
    return Math.max(...values, 1);
  }

  function renderTrendLegend() {
    return `
      <div class="beta-trend-chart-legend" aria-hidden="true">
        <span><i class="current"></i>This week</span>
        <span><i class="previous"></i>Last week</span>
      </div>
    `;
  }

  function renderTrendAxisCopy(xLabel, yLabel) {
    return `<div class="beta-trend-axis-copy">Y: ${safeText(yLabel)} · X: ${safeText(xLabel)}</div>`;
  }

  function renderTrendLinePath(points, valueKey, xFor, yFor) {
    const segments = [];
    let currentSegment = [];
    points.forEach((point, index) => {
      const value = point[valueKey];
      if (Number.isFinite(value)) {
        currentSegment.push(`${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`);
      } else if (currentSegment.length) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    });
    if (currentSegment.length) segments.push(currentSegment);
    return segments.map(segment => `<polyline class="line ${safeText(valueKey)}" points="${segment.join(" ")}"></polyline>`).join("");
  }

  function renderTrendLineChart(points, { unit = "minutes", ariaLabel = "Trend line chart", xLabel = "Day/date", yLabel = "Fuel Debt" } = {}) {
    if (!hasTrendChartData(points)) return `<div class="beta-trend-chart-empty">Needs logged days to draw the chart.</div>`;
    const width = 320;
    const height = 172;
    const padding = { top: 18, right: 14, bottom: 48, left: 42 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const max = trendChartMax(points);
    const xFor = index => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yFor = value => padding.top + plotHeight - (value / max) * plotHeight;
    const maxLabel = unit === "minutes" ? compactDuration(max) : String(Math.round(max));
    return `
      <div class="beta-trend-chart beta-trend-line-chart" role="img" aria-label="${safeText(ariaLabel)}">
        ${renderTrendLegend()}
        ${renderTrendAxisCopy(xLabel, yLabel)}
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          <text class="y-label" x="6" y="${padding.top + 8}">${safeText(maxLabel)}</text>
          <text class="y-label" x="8" y="${padding.top + plotHeight}">0</text>
          ${renderTrendLinePath(points, "previous", xFor, yFor)}
          ${renderTrendLinePath(points, "current", xFor, yFor)}
          ${points.map((point, index) => Number.isFinite(point.previous) ? `<circle class="point previous" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.previous).toFixed(1)}" r="2.6"></circle>` : "").join("")}
          ${points.map((point, index) => Number.isFinite(point.current) ? `<circle class="point current" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.current).toFixed(1)}" r="3"></circle>` : "").join("")}
          ${points.map((point, index) => `<text class="x-label" x="${xFor(index).toFixed(1)}" y="${height - 23}">${safeText(point.label)}</text>`).join("")}
        </svg>
      </div>
    `;
  }

  function renderTrendBarChart(points, { unit = "minutes", ariaLabel = "Trend bar chart", xLabel = "Day/date", yLabel = "Longest gap" } = {}) {
    if (!hasTrendChartData(points)) return `<div class="beta-trend-chart-empty">Needs logged days to draw the chart.</div>`;
    const width = 320;
    const height = 172;
    const padding = { top: 18, right: 14, bottom: 48, left: 42 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const max = trendChartMax(points);
    const slot = plotWidth / points.length;
    const barWidth = Math.min(11, Math.max(6, slot * 0.25));
    const groupCenter = index => padding.left + slot * index + slot / 2;
    const yFor = value => padding.top + plotHeight - (value / max) * plotHeight;
    const maxLabel = unit === "minutes" ? compactDuration(max) : String(Math.round(max));
    return `
      <div class="beta-trend-chart beta-trend-bar-chart" role="img" aria-label="${safeText(ariaLabel)}">
        ${renderTrendLegend()}
        ${renderTrendAxisCopy(xLabel, yLabel)}
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          <text class="y-label" x="6" y="${padding.top + 8}">${safeText(maxLabel)}</text>
          <text class="y-label" x="8" y="${padding.top + plotHeight}">0</text>
          ${points.map((point, index) => {
            const center = groupCenter(index);
            const bars = [];
            if (Number.isFinite(point.previous)) {
              const previousHeight = Math.max(2, padding.top + plotHeight - yFor(point.previous));
              bars.push(`<rect class="bar previous" x="${(center - barWidth - 1.5).toFixed(1)}" y="${(padding.top + plotHeight - previousHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${previousHeight.toFixed(1)}" rx="3"></rect>`);
            }
            if (Number.isFinite(point.current)) {
              const currentHeight = Math.max(2, padding.top + plotHeight - yFor(point.current));
              bars.push(`<rect class="bar current" x="${(center + 1.5).toFixed(1)}" y="${(padding.top + plotHeight - currentHeight).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${currentHeight.toFixed(1)}" rx="3"></rect>`);
            }
            return bars.join("");
          }).join("")}
          ${points.map((point, index) => `<text class="x-label" x="${groupCenter(index).toFixed(1)}" y="${height - 23}">${safeText(point.label)}</text>`).join("")}
        </svg>
      </div>
    `;
  }

  function maxLongestFuelGap(entries) {
    const values = entries.map(entry => Number(entry.longestGapMinutes || 0)).filter(value => Number.isFinite(value) && value > 0);
    return values.length ? Math.max(...values) : null;
  }

  function lowEnergyAfterLongGapCount(entries) {
    const preferredWindow = mediumRiskLimit();
    return entries.reduce((count, entry) => {
      const crashCount = Number(entry.crashLogCount || 0);
      const longGap = Number(entry.fuelDebtMinutes || 0) > 0
        || Number(entry.longestGapMinutes || 0) >= preferredWindow
        || Number(entry.highRiskGapCount || 0) > 0
        || Number(entry.crashZoneGapCount || 0) > 0;
      return count + (crashCount > 0 && longGap ? crashCount : 0);
    }, 0);
  }

  function protectedDayCount(entries) {
    return entries.filter(entry =>
      Number(entry.fuelDebtMinutes || 0) <= 0
      && Number(entry.highRiskGapCount || 0) <= 0
      && Number(entry.crashZoneGapCount || 0) <= 0
      && Number(entry.crashLogCount || 0) <= 0
    ).length;
  }

  function repeatedWindowLabel(entry) {
    const windowLabel = impactWindowLabel(entry);
    if (!windowLabel || /not clear/i.test(windowLabel)) return "";
    if (entry?.dayType === "work") return `${windowLabel} on working days`;
    if (entry?.dayType) return `${windowLabel} on ${dayTypeLabel(entry.dayType).toLowerCase()}`;
    return windowLabel;
  }

  function repeatedDangerWindow(entries) {
    const groups = {};
    entries.forEach(entry => {
      const hasSignal = Number(entry.fuelDebtMinutes || 0) > 0
        || Number(entry.highRiskGapCount || 0) > 0
        || Number(entry.crashZoneGapCount || 0) > 0
        || Number(entry.crashLogCount || 0) > 0;
      if (!hasSignal) return;
      const label = repeatedWindowLabel(entry);
      if (!label) return;
      groups[label] = (groups[label] || 0) + 1;
    });
    const top = Object.entries(groups).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return top ? { label: top[0], count: top[1] } : null;
  }

  function trendPercentCopy(current, previous, { lowerIsBetter = true, metricLabel = "This signal" } = {}) {
    const plural = /days|events|signals|gaps/i.test(metricLabel);
    const verb = plural ? "are" : "is";
    if (!Number.isFinite(current)) return `${metricLabel} needs more matching days before Fuel Guard can compare it.`;
    if (!Number.isFinite(previous)) return `${metricLabel} ${plural ? "have" : "has"} this-week data; last week needs more matching days.`;
    if (current === previous) return `${metricLabel} ${verb} about the same as last week.`;
    if (previous <= 0) {
      if (current <= 0) return `${metricLabel} ${plural ? "stayed" : "stayed"} at 0 this week.`;
      return `${metricLabel} ${verb} showing this week; last week was 0.`;
    }
    const percent = Math.round(Math.abs(((current - previous) / previous) * 100));
    const direction = current < previous ? "down" : "up";
    const helpful = lowerIsBetter ? current < previous : current > previous;
    const meaning = helpful ? "is moving in the right direction" : "needs attention";
    return `${metricLabel} ${verb} ${direction} ${percent}% compared with last week, so this pattern ${meaning}.`;
  }

  function trendTone(current, previous, { lowerIsBetter = true } = {}) {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || current === previous) return "neutral";
    const helpful = lowerIsBetter ? current < previous : current > previous;
    return helpful ? "protected" : "elevated";
  }

  function trendCardValue(value, unit = "count", fallback = "Building") {
    if (!Number.isFinite(value)) return fallback;
    if (unit === "minutes") return compactDuration(value);
    return String(Math.round(value));
  }

  function renderImpactTrendCard({ title, value, copy, icon = "route", tone = "neutral", current = null, previous = null, unit = "count", visual = "" }) {
    return `
      <article class="beta-trend-pattern-card beta-impact-trend-card ${safeText(tone)}">
        <div class="beta-metric-card-head">
          <span class="beta-icon-disc ${tone === "elevated" ? "amber" : tone === "protected" ? "shield" : ""}">${dailyIcon(icon)}</span>
          <div><span>${safeText(title)}</span><strong>${safeText(value)}</strong></div>
        </div>
        ${visual}
        ${Number.isFinite(current) || Number.isFinite(previous) ? renderTrendMiniBars(current, previous, { unit }) : ""}
        <small>${safeText(copy)}</small>
      </article>
    `;
  }

  function renderImpactSignalTrends(current, previous) {
    const currentMetrics = trendMetrics(current);
    const previousMetrics = trendMetrics(previous);
    const currentLongest = maxLongestFuelGap(current);
    const previousLongest = maxLongestFuelGap(previous);
    const longestGapPoints = weeklyTrendChartPoints(current, previous, entry => Number(entry.longestGapMinutes || 0));
    const fuelDebtPoints = weeklyTrendChartPoints(current, previous, entry => Number(entry.fuelDebtMinutes || 0));
    const currentWindow = repeatedDangerWindow(current);
    const previousWindow = repeatedDangerWindow(previous);
    const windowCopy = !currentWindow
      ? "No repeated highest-risk window is clear this week."
      : currentWindow.count < 2
        ? `This week points most toward ${currentWindow.label}, but it has not repeated enough to call a pattern yet.`
        : previousWindow?.label === currentWindow.label
          ? `The same highest-risk window is still repeating this week: ${currentWindow.label}.`
          : previousWindow
            ? `The highest-risk window moved from ${previousWindow.label} last week to ${currentWindow.label} this week.`
            : `${currentWindow.label} repeated ${currentWindow.count} time${currentWindow.count === 1 ? "" : "s"} this week.`;
    return `
      <section class="beta-impact-trend-grid" aria-label="Impact signals over time">
        ${renderImpactTrendCard({
          title: "Highest-Risk Window Trend",
          value: currentWindow ? currentWindow.label : "Not repeating yet",
          copy: windowCopy,
          icon: "route",
          tone: currentWindow?.count >= 2 ? "elevated" : "protected"
        })}
        ${renderImpactTrendCard({
          title: "Longest Fuel Gap Trend",
          value: trendCardValue(currentLongest, "minutes", "Not enough data"),
          copy: trendPercentCopy(currentLongest, previousLongest, { metricLabel: "Your longest fuel gap" }),
          icon: "clock",
          tone: trendTone(currentLongest, previousLongest),
          current: currentLongest,
          previous: previousLongest,
          unit: "minutes",
          visual: renderTrendBarChart(longestGapPoints, {
            ariaLabel: "Longest Fuel Gap this week versus last week bar chart",
            yLabel: "Longest gap"
          })
        })}
        ${renderImpactTrendCard({
          title: "Fuel Debt Trend",
          value: Number.isFinite(currentMetrics.fuelDebtMinutes) ? fuelDebtDurationText(currentMetrics.fuelDebtMinutes) : "Not enough data",
          copy: trendPercentCopy(currentMetrics.fuelDebtMinutes, previousMetrics.fuelDebtMinutes, { metricLabel: "Your Fuel Debt" }),
          icon: "gap",
          tone: trendTone(currentMetrics.fuelDebtMinutes, previousMetrics.fuelDebtMinutes),
          current: currentMetrics.fuelDebtMinutes,
          previous: previousMetrics.fuelDebtMinutes,
          unit: "minutes",
          visual: renderTrendLineChart(fuelDebtPoints, {
            ariaLabel: "Fuel Debt this week versus last week line chart",
            yLabel: "Fuel Debt"
          })
        })}
        <p class="muted beta-trend-filter-note">${safeText(trendFilterCopy())}</p>
      </section>
    `;
  }

  function renderFoodRunwayTrendLegend() {
    return `
      <div class="beta-trend-chart-legend" aria-hidden="true">
        <span><i class="expected"></i>Expected duration</span>
        <span><i class="actual"></i>Actual duration</span>
      </div>
    `;
  }

  function runwayTrendPath(points, key, xFor, yFor) {
    const coordinates = points
      .filter(point => Number.isFinite(point[key]))
      .map(point => `${xFor(point.index).toFixed(1)},${yFor(point[key]).toFixed(1)}`);
    return coordinates.length ? `<polyline class="line ${safeText(key)}" points="${coordinates.join(" ")}"></polyline>` : "";
  }

  function renderFoodRunwayTrendChart(entries) {
    const points = entries
      .filter(entry => entry.actualFinishDate)
      .sort((a, b) => dateFromKey(a.shoppingDate) - dateFromKey(b.shoppingDate))
      .slice(-8)
      .map((entry, index) => ({
        index,
        label: dateFromKey(entry.shoppingDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        expected: daysBetweenKeys(entry.shoppingDate, entry.expectedFinishDate),
        actual: daysBetweenKeys(entry.shoppingDate, entry.actualFinishDate)
      }))
      .filter(point => Number.isFinite(point.expected) && Number.isFinite(point.actual));

    if (!points.length) return `<div class="beta-trend-chart-empty">Complete a Food Runway entry to draw the chart.</div>`;

    const width = 320;
    const height = 172;
    const padding = { top: 18, right: 14, bottom: 48, left: 42 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const max = Math.max(...points.flatMap(point => [point.expected, point.actual]), 1);
    const xFor = index => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yFor = value => padding.top + plotHeight - (value / max) * plotHeight;
    const maxLabel = `${Math.round(max)}d`;
    return `
      <div class="beta-trend-chart beta-runway-trend-chart" role="img" aria-label="Food Runway expected versus actual duration line graph">
        ${renderFoodRunwayTrendLegend()}
        ${renderTrendAxisCopy("Shopping date", "Duration days")}
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          <text class="y-label" x="8" y="${padding.top + 8}">${safeText(maxLabel)}</text>
          <text class="y-label" x="8" y="${padding.top + plotHeight}">0</text>
          ${runwayTrendPath(points, "expected", xFor, yFor)}
          ${runwayTrendPath(points, "actual", xFor, yFor)}
          ${points.map(point => `<circle class="point expected" cx="${xFor(point.index).toFixed(1)}" cy="${yFor(point.expected).toFixed(1)}" r="2.6"></circle><circle class="point actual" cx="${xFor(point.index).toFixed(1)}" cy="${yFor(point.actual).toFixed(1)}" r="3"></circle>`).join("")}
          ${points.map(point => `<text class="x-label" x="${xFor(point.index).toFixed(1)}" y="${height - 23}">${safeText(point.label)}</text>`).join("")}
        </svg>
      </div>
    `;
  }

  function renderFoodRunwayTrendCard() {
    const completed = completedRunwayEntries();
    const errors = completed.map(entry => Math.abs(daysBetweenKeys(entry.shoppingDate, entry.expectedFinishDate) - daysBetweenKeys(entry.shoppingDate, entry.actualFinishDate)));
    const averageError = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
    return `
      <article class="beta-trend-pattern-card beta-impact-trend-card beta-runway-trend-card">
        <div class="beta-metric-card-head">
          <span class="beta-icon-disc shield">${dailyIcon("route")}</span>
          <div><span>Food Runway Trend</span><strong>${Number.isFinite(averageError) ? `${averageError.toFixed(1)}d average error` : "Building"}</strong></div>
        </div>
        ${renderFoodRunwayTrendChart(completed)}
        <small>${completed.length ? `${completed.length} completed shop${completed.length === 1 ? "" : "s"} included. Incomplete shops are excluded from prediction accuracy.` : "Complete a shop to start tracking prediction accuracy over time."}</small>
      </article>
    `;
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
      "Act-now gaps are reducing",
      "Act-now gaps are increasing",
      "Act-now gaps are steady",
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
          ${renderTrendMetric("Act-now gaps", highRiskGaps.value, highRiskGaps.note, highRiskGaps.tone)}
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
      renderAverageMetric("Average number of act-now gaps per day", averageNumber(filteredEntries.map(entry => Number(entry.highRiskGapCount || 0))), "Based on current act-now threshold"),
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
      renderPatternGraph("Act-now gap count by day", filteredEntries, entry => Number(entry.highRiskGapCount || 0), entry => `${entry.highRiskGapCount || 0} act-now gap${Number(entry.highRiskGapCount || 0) === 1 ? "" : "s"}`, { max: maxRisk, tone: "red" })
    ].join("");
  }

  function renderTrends() {
    const summaryTarget = document.getElementById("fuelAveragesSummary");
    const allEntries = loggedHistoryEntries();
    const filteredEntries = allEntries.filter(entryMatchesTrendFilters);
    if (!summaryTarget) return;
    if (!filteredEntries.length) {
      summaryTarget.innerHTML = `<p class="muted beta-history-empty">No logged days match these filters yet.</p>${renderFoodRunwayTrendCard()}`;
      return;
    }

    const { current, previous } = weeklyTrendWindows(filteredEntries);
    summaryTarget.innerHTML = `${renderImpactSignalTrends(current, previous)}${renderFoodRunwayTrendCard()}`;
  }

  function renderHistory() {
    const summary = document.getElementById("fuelHistorySummary");
    const weekly = weeklySummary();
    if (summary) {
      summary.innerHTML = `
        <div class="fuel-gap-insight"><span>Days stored</span><strong>${weekly.entries.length}</strong><small>Local daily summaries.</small></div>
        <div class="fuel-gap-insight"><span>Fuel logs this week</span><strong>${weekly.totalLogs}</strong><small>One-tap fuel records.</small></div>
        <div class="fuel-gap-insight"><span>Longest weekly gap</span><strong>${safeText(durationText(weekly.longestGap))}</strong><small>Largest stored gap in the last 7 days.</small></div>
        <div class="fuel-gap-insight"><span>Repeated act-now window</span><strong>${safeText(weekly.topWindow ? weekly.topWindow[0] : "Building")}</strong><small>${safeText(weekly.topWindow ? "Common act-now gap window." : "Needs more daily summaries.")}</small></div>
        <div class="fuel-gap-insight"><span>Day type pattern</span><strong>${safeText(weekly.riskType ? weekly.riskType.label : "Building")}</strong><small>${safeText(weekly.riskType ? "Longest gaps cluster here." : "Tag day type to compare patterns.")}</small></div>
        <div class="fuel-gap-insight"><span>Average gap pattern</span><strong>${safeText(weekly.averageType ? weekly.averageType.label : "Building")}</strong><small>${safeText(weekly.averageType ? "Highest average gaps so far." : "Needs more history.")}</small></div>
      `;
    }
    const entries = archiveEntries();
    const count = document.getElementById("fuelHistoryCount");
    const detail = document.getElementById("fuelHistoryArchiveDetail");
    if (!detail) return;
    if (count) count.textContent = `${loggedHistoryEntries().length} logged day${loggedHistoryEntries().length === 1 ? "" : "s"} stored`;
    const todayKey = dateKey();
    const todayEntry = entries.find(entry => entry.date === todayKey) || buildArchiveEntry(todayKey);
    detail.innerHTML = renderDailyTimelineDetail(todayEntry);
    renderGraphModeControls();
    requestAnimationFrame(() => drawBetaGraph());
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

    ctx.strokeStyle = "rgba(24,42,32,.1)";
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
    ctx.fillStyle = "rgba(23,35,29,.58)";
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
      ctx.fillStyle = "rgba(23,35,29,.62)";
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
        ctx.strokeStyle = "rgba(255,255,255,.96)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, item.label === "Hydration" ? 4.5 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    });

    const currentX = xForMinute(minutesIntoDay(now));
    ctx.strokeStyle = "rgba(24,42,32,.13)";
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(23,35,29,.62)";
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
    ctx.strokeStyle = "rgba(24,42,32,.12)";
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

    ctx.fillStyle = "rgba(23,35,29,.62)";
    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    [
      [0, "00:00"],
      [360, "06:00"],
      [720, "12:00"],
      [1080, "18:00"],
      [1440, "24:00"]
    ].forEach(([minute, label]) => {
      ctx.fillText(label, clamp(xForMinute(minute), padding.left + 10, cssWidth - padding.right - 10), cssHeight - 10);
    });
    ctx.textAlign = "left";
    ctx.fillText("Status", 8, compact ? 16 : 18);
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

  function readNumberField(id, fallback = null) {
    const value = Number(document.getElementById(id)?.value || "");
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function generateRideSchedule(plan, startedAt = null) {
    const events = new Map();
    const durationMinutes = Number(plan.durationMinutes || 0);
    const addSeries = (type, first, interval) => {
      const firstOffset = Number(first || 0);
      const every = Number(interval || 0);
      if (!durationMinutes || !firstOffset || !every) return;
      for (let offset = firstOffset; offset <= durationMinutes; offset += every) {
        const existing = events.get(offset) || { plannedOffsetMinutes: offset, reminderType: type };
        existing.reminderType = existing.reminderType === type ? type : "both";
        events.set(offset, existing);
      }
    };
    addSeries("fuel", plan.firstFuelReminderMinutes, plan.fuelIntervalMinutes);
    addSeries("hydration", plan.firstHydrationReminderMinutes, plan.hydrationIntervalMinutes);
    return [...events.values()].sort((a, b) => a.plannedOffsetMinutes - b.plannedOffsetMinutes).map(event => {
      const plannedDate = startedAt ? addMinutes(new Date(startedAt), event.plannedOffsetMinutes) : null;
      return {
        id: event.id || uid(),
        ridePlanId: plan.id || "",
        reminderType: event.reminderType,
        plannedOffsetMinutes: event.plannedOffsetMinutes,
        plannedTime: plannedDate ? plannedDate.toISOString() : null,
        confirmedTime: null,
        status: "pending",
        delayMinutes: null
      };
    });
  }

  function readRidePlanFromForm() {
    return {
      id: document.getElementById("ridePlanName")?.dataset.editingId || uid(),
      userId: window.fuelGuardCloud?.accountView?.().userId || "",
      name: document.getElementById("ridePlanName")?.value?.trim() || "Ride plan",
      durationMinutes: readNumberField("rideDurationMinutes", 120),
      fuelIntervalMinutes: readNumberField("rideFuelInterval", null),
      firstFuelReminderMinutes: readNumberField("rideFirstFuel", null),
      hydrationIntervalMinutes: readNumberField("rideHydrationInterval", null),
      firstHydrationReminderMinutes: readNumberField("rideFirstHydration", null),
      alertType: "in_app",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function fillRideForm(plan = {}) {
    const fields = [
      ["ridePlanName", plan.name || ""],
      ["rideDurationMinutes", plan.durationMinutes || 120],
      ["rideFuelInterval", plan.fuelIntervalMinutes || 40],
      ["rideFirstFuel", plan.firstFuelReminderMinutes || 40],
      ["rideHydrationInterval", plan.hydrationIntervalMinutes || 15],
      ["rideFirstHydration", plan.firstHydrationReminderMinutes || 15]
    ];
    fields.forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = value;
    });
    const name = document.getElementById("ridePlanName");
    if (name) name.dataset.editingId = plan.id || "";
  }

  function reminderLabel(type) {
    if (type === "both") return "Fuel + Hydration";
    return type === "hydration" ? "Hydrate" : "Fuel";
  }

  function renderRideScheduleList(reminders) {
    if (!reminders.length) return `<p class="muted">Add ride duration and reminder intervals to preview the schedule.</p>`;
    return `<div class="beta-ride-reminder-list">${reminders.map(reminder => `<article><strong>${reminder.plannedOffsetMinutes} min</strong><span>${safeText(reminderLabel(reminder.reminderType))}</span></article>`).join("")}</div>`;
  }

  function saveRidePlan({ asTemplate = false } = {}) {
    const plan = readRidePlanFromForm();
    if (!plan.durationMinutes) {
      rideStatus = "Ride duration is required.";
      renderRidePlan();
      return null;
    }
    plan.devicePayload = {
      planId: plan.id,
      rideDurationMinutes: plan.durationMinutes,
      fuelIntervalMinutes: plan.fuelIntervalMinutes,
      firstFuelReminderMinutes: plan.firstFuelReminderMinutes,
      hydrationIntervalMinutes: plan.hydrationIntervalMinutes,
      firstHydrationReminderMinutes: plan.firstHydrationReminderMinutes,
      alertType: plan.alertType,
      createdAt: plan.createdAt
    };
    const gap = betaState();
    const target = asTemplate ? gap.rideTemplates : gap.ridePlans;
    const existingIndex = target.findIndex(item => item.id === plan.id);
    if (existingIndex >= 0) target[existingIndex] = { ...target[existingIndex], ...plan, updatedAt: new Date().toISOString() };
    else target.unshift(plan);
    rideStatus = asTemplate ? "Ride template saved." : "Ride plan saved.";
    save();
    renderRidePlan();
    return plan;
  }

  function startRide(plan = null) {
    const basePlan = plan || saveRidePlan() || readRidePlanFromForm();
    const startedAt = new Date().toISOString();
    betaState().activeRide = {
      id: uid(),
      planId: basePlan.id,
      plan: basePlan,
      startedAt,
      status: "active",
      reminders: generateRideSchedule(basePlan, startedAt),
      completedAt: null
    };
    rideStatus = "Ride started. Keep Fuel Guard open for in-app reminders.";
    save();
    renderAll();
    startActiveRideTimer();
  }

  function activeRideDueReminders() {
    const ride = betaState().activeRide;
    if (!ride || ride.status !== "active") return [];
    const now = Date.now();
    return ride.reminders.filter(reminder => reminder.status === "pending" && reminder.plannedTime && new Date(reminder.plannedTime).getTime() <= now);
  }

  function confirmRideReminder(type) {
    const ride = betaState().activeRide;
    if (!ride) return;
    const now = new Date();
    const due = ride.reminders.find(reminder => reminder.status === "pending" && (reminder.reminderType === type || reminder.reminderType === "both") && new Date(reminder.plannedTime).getTime() <= now.getTime());
    if (!due) {
      rideStatus = `No ${reminderLabel(type).toLowerCase()} reminder is due yet.`;
      renderRidePlan();
      return;
    }
    due.status = "completed";
    due.confirmedTime = now.toISOString();
    due.delayMinutes = Math.max(0, Math.round((now - new Date(due.plannedTime)) / 60000));
    const confirmedType = due.reminderType === "both" ? "fuel_hydration" : type === "hydration" ? "hydration" : "fuel";
    recordRhythmLog(confirmedType, {
      source: "ride_plan",
      entryMethod: "live",
      plannedTime: due.plannedTime,
      ridePlanId: ride.planId,
      bypassCooldown: true
    });
    rideStatus = `${reminderLabel(type)} confirmed.`;
    save();
    renderAll();
  }

  function endActiveRide() {
    const ride = betaState().activeRide;
    if (!ride) return;
    const now = new Date().toISOString();
    ride.status = "completed";
    ride.completedAt = now;
    ride.reminders.forEach(reminder => {
      if (reminder.status === "pending") reminder.status = "missed";
    });
    rideStatus = "Ride completed. Remaining reminders were marked missed.";
    save();
    renderAll();
  }

  function renderRidePlan() {
    const rideActive = document.getElementById("ride")?.classList.contains("active");
    if (!rideActive) return;
    if (!document.getElementById("rideDurationMinutes")?.value) fillRideForm();
    const currentPlan = readRidePlanFromForm();
    const preview = document.getElementById("rideSchedulePreview");
    if (preview) preview.innerHTML = renderRideScheduleList(generateRideSchedule(currentPlan));
    const status = document.getElementById("ridePlanStatus");
    if (status) status.textContent = rideStatus || "Fuel Guard Go device transfer: not connected yet.";
    const saved = document.getElementById("rideSavedPlans");
    if (saved) {
      const plans = betaState().ridePlans || [];
      saved.innerHTML = plans.length
        ? plans.map(plan => `<article class="beta-logistics-item"><div><strong>${safeText(plan.name)}</strong><span>${plan.durationMinutes} min · Fuel ${plan.firstFuelReminderMinutes || "--"}/${plan.fuelIntervalMinutes || "--"} · Hydration ${plan.firstHydrationReminderMinutes || "--"}/${plan.hydrationIntervalMinutes || "--"}</span></div><div class="beta-log-event-actions"><button class="secondary" type="button" data-edit-ride="${safeText(plan.id)}">Edit</button><button class="secondary" type="button" data-start-ride="${safeText(plan.id)}">Start</button><button class="secondary danger-secondary" type="button" data-delete-ride="${safeText(plan.id)}">Delete</button></div></article>`).join("")
        : `<p class="muted">No saved ride plans yet.</p>`;
    }
    const active = document.getElementById("activeRidePanel");
    if (active) active.innerHTML = renderActiveRide();
  }

  function renderActiveRide() {
    const ride = betaState().activeRide;
    if (!ride) return `<p class="muted">No active ride.</p>`;
    const started = new Date(ride.startedAt);
    const elapsed = Math.max(0, Math.round((Date.now() - started.getTime()) / 60000));
    const pending = ride.reminders.filter(reminder => reminder.status === "pending");
    const nextFuel = pending.find(reminder => reminder.reminderType === "fuel" || reminder.reminderType === "both");
    const nextHydration = pending.find(reminder => reminder.reminderType === "hydration" || reminder.reminderType === "both");
    const completed = ride.reminders.filter(reminder => reminder.status === "completed").length;
    const missed = ride.reminders.filter(reminder => reminder.status === "missed").length;
    return `
      <article class="beta-logistics-item">
        <div>
          <strong>${safeText(ride.plan?.name || "Active ride")}</strong>
          <span>Elapsed: ${elapsed} min</span>
          <span>Next fuel: ${nextFuel ? formatClock(new Date(nextFuel.plannedTime)) : "none"}</span>
          <span>Next hydration: ${nextHydration ? formatClock(new Date(nextHydration.plannedTime)) : "none"}</span>
          <span>Completed ${completed}; missed ${missed}</span>
        </div>
        <div class="button-row beta-settings-actions">
          <button class="secondary" type="button" data-confirm-ride="fuel">Confirm fuel</button>
          <button class="secondary" type="button" data-confirm-ride="hydration">Confirm hydration</button>
          <button class="secondary danger-secondary" type="button" data-end-ride>End ride</button>
        </div>
      </article>
    `;
  }

  function startActiveRideTimer() {
    if (activeRideTimer) return;
    activeRideTimer = window.setInterval(() => {
      const due = activeRideDueReminders();
      if (due.length) rideStatus = `${due.map(reminder => reminderLabel(reminder.reminderType)).join(" + ")} reminder due. Confirm when you actually fuel or hydrate.`;
      renderRidePlan();
    }, 30000);
  }

  function runwayEntries() {
    return betaState().foodRunway || [];
  }

  function shopTypeLabel(type) {
    return SHOP_TYPE_OPTIONS[type] || "Full shop";
  }

  function daysBetweenKeys(startKey, endKey) {
    const start = dateFromKey(startKey);
    const end = dateFromKey(endKey);
    return Math.round((end - start) / 86400000);
  }

  function completedRunwayEntries(type = "") {
    return runwayEntries()
      .filter(entry => entry.actualFinishDate && (!type || entry.shopType === type))
      .sort((a, b) => dateFromKey(b.actualFinishDate) - dateFromKey(a.actualFinishDate));
  }

  function runwayPrediction(type = "full_shop") {
    const completed = completedRunwayEntries(type).slice(0, 3);
    const durations = completed.map(entry => daysBetweenKeys(entry.shoppingDate, entry.actualFinishDate)).filter(value => Number.isFinite(value) && value >= 0);
    const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
    const active = runwayEntries().find(entry => entry.shopType === type && !entry.actualFinishDate);
    const predicted = active
      ? addDays(dateFromKey(active.shoppingDate), Math.round(average ?? daysBetweenKeys(active.shoppingDate, active.expectedFinishDate)))
      : null;
    const errors = completed.map(entry => Math.abs(daysBetweenKeys(entry.shoppingDate, entry.expectedFinishDate) - daysBetweenKeys(entry.shoppingDate, entry.actualFinishDate)));
    const averageError = errors.length ? errors.reduce((sum, value) => sum + value, 0) / errors.length : null;
    return { completed, average, active, predicted, averageError };
  }

  function runwayDifference(entry) {
    if (!entry?.actualFinishDate) return "Not finished yet";
    const expected = daysBetweenKeys(entry.shoppingDate, entry.expectedFinishDate);
    const actual = daysBetweenKeys(entry.shoppingDate, entry.actualFinishDate);
    const diff = actual - expected;
    if (diff === 0) return "On time";
    return `${Math.abs(diff)} day${Math.abs(diff) === 1 ? "" : "s"} ${diff < 0 ? "earlier" : "later"}`;
  }

  function saveRunwayEntry() {
    const shoppingDate = document.getElementById("runwayShoppingDate")?.value || dateKey();
    const expectedFinishDate = document.getElementById("runwayExpectedFinishDate")?.value || "";
    const actualFinishDate = document.getElementById("runwayActualFinishDate")?.value || "";
    const shopType = document.getElementById("runwayShopType")?.value || "full_shop";
    if (!expectedFinishDate) {
      runwayStatus = "Expected finish date is required.";
      renderFoodRunway();
      return;
    }
    const entries = runwayEntries();
    const existingActive = entries.find(entry => entry.shopType === shopType && !entry.actualFinishDate && entry.id !== runwayEditingId);
    if (!actualFinishDate && existingActive) {
      runwayStatus = `Only one current ${shopTypeLabel(shopType).toLowerCase()} can be active. Mark the current one finished first.`;
      renderFoodRunway();
      return;
    }
    const now = new Date().toISOString();
    const existing = runwayEditingId ? entries.find(entry => entry.id === runwayEditingId) : null;
    const entry = existing || { id: uid(), createdAt: now };
    Object.assign(entry, {
      userId: window.fuelGuardCloud?.accountView?.().userId || "",
      shopType,
      shoppingDate,
      expectedFinishDate,
      actualFinishDate: actualFinishDate || null,
      updatedAt: now
    });
    if (!existing) entries.unshift(entry);
    runwayEditingId = "";
    runwayStatus = "Food Runway saved.";
    save();
    renderAll();
  }

  function fillRunwayForm(entry = null) {
    const todayValue = dateKey();
    const fields = [
      ["runwayShoppingDate", entry?.shoppingDate || todayValue],
      ["runwayExpectedFinishDate", entry?.expectedFinishDate || ""],
      ["runwayActualFinishDate", entry?.actualFinishDate || ""],
      ["runwayShopType", entry?.shopType || "full_shop"]
    ];
    fields.forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input) input.value = value;
    });
  }

  function renderFoodRunway() {
    const runwayActive = document.getElementById("runway")?.classList.contains("active");
    if (!runwayActive) return;
    fillRunwayForm(runwayEditingId ? runwayEntries().find(entry => entry.id === runwayEditingId) : null);
    const status = document.getElementById("foodRunwayStatus");
    if (status) status.textContent = runwayStatus;
    const current = document.getElementById("foodRunwayCurrent");
    const active = runwayEntries().filter(entry => !entry.actualFinishDate);
    if (current) current.innerHTML = active.length
      ? active.map(entry => {
        const prediction = runwayPrediction(entry.shopType);
        const predicted = prediction.predicted ? dateKey(prediction.predicted) : entry.expectedFinishDate;
        const remaining = Math.max(0, daysBetweenKeys(dateKey(), predicted));
        return `<article class="beta-logistics-item"><div><strong>${safeText(shopTypeLabel(entry.shopType))}</strong><span>Shopped ${safeText(formatDateKey(entry.shoppingDate))}</span><span>Expected finish ${safeText(formatDateKey(entry.expectedFinishDate))}</span><span>Predicted finish ${safeText(formatDateKey(predicted))}</span><span>${remaining} estimated day${remaining === 1 ? "" : "s"} remaining</span></div><div class="beta-log-event-actions"><button class="secondary" type="button" data-finish-runway="${safeText(entry.id)}">Mark finished</button><button class="secondary" type="button" data-edit-runway="${safeText(entry.id)}">Edit</button></div></article>`;
      }).join("")
      : `<p class="muted">No current shop is active.</p>`;
    const previous = document.getElementById("foodRunwayPrevious");
    if (previous) {
      const entries = runwayEntries().filter(entry => entry.actualFinishDate).sort((a, b) => dateFromKey(b.shoppingDate) - dateFromKey(a.shoppingDate));
      previous.innerHTML = entries.length
        ? entries.map(entry => `<article class="beta-logistics-item"><div><strong>${safeText(formatDateKey(entry.shoppingDate))}</strong><span>${safeText(shopTypeLabel(entry.shopType))}</span><span>Expected ${daysBetweenKeys(entry.shoppingDate, entry.expectedFinishDate)} days · Actual ${daysBetweenKeys(entry.shoppingDate, entry.actualFinishDate)} days · ${safeText(runwayDifference(entry))}</span></div><div class="beta-log-event-actions"><button class="secondary" type="button" data-edit-runway="${safeText(entry.id)}">Edit</button><button class="secondary danger-secondary" type="button" data-delete-runway="${safeText(entry.id)}">Delete</button></div></article>`).join("")
        : `<p class="muted">No completed shops yet.</p>`;
    }
  }

  renderFuelGap = function renderFuelGapBeta() {
    const snapshot = fuelGapSnapshot();
    const cooldown = cooldownRemainingSeconds();
    const dashboardActive = document.getElementById("dashboard")?.classList.contains("active");
    const historyActive = document.getElementById("logs")?.classList.contains("active");
    const trendsActive = document.getElementById("trends")?.classList.contains("active");
    const rideActive = document.getElementById("ride")?.classList.contains("active");
    const runwayActive = document.getElementById("runway")?.classList.contains("active");
    const settingsActive = document.getElementById("checklist")?.classList.contains("active");

    const badge = document.getElementById("fuelGraphLastAte");
    if (badge) badge.textContent = snapshot.lastFuelled === "No fuel logged" ? "Last fuel: not logged yet" : `Last fuel: ${snapshot.timeSinceFuel} ago`;

    const next = document.getElementById("fuelGapNextAction");
    if (next) {
      next.textContent = snapshot.nextAction || `Status: ${snapshot.statusLabel || riskStatusLabel(snapshot.status)}`;
      next.className = `fuel-next-action beta-risk-pill ${snapshot.status}`;
    }

    const button = document.getElementById("graphLogFoodButton");
    if (button) {
      button.innerHTML = "<span>Log</span><span>Fuel</span>";
      button.disabled = cooldown > 0;
    }

    const hydrationButton = document.getElementById("graphLogHydrationButton");
    if (hydrationButton) hydrationButton.disabled = false;

    const undo = document.getElementById("undoLatestFoodLog");
    if (undo) undo.disabled = !todayLogs().length;

    const cooldownEl = document.getElementById("foodLogCooldownMessage");
    if (cooldownEl) cooldownEl.textContent = cooldown > 0 ? `Logged. You can fuel again in ${cooldown}s.` : "";

    renderGraphModeControls();
    if (dashboardActive) {
      renderDayTypeControls();
      renderDailyLog();
    }
    if (settingsActive) renderSettings();
    if (historyActive) renderHistory();
    if (trendsActive) renderTrends();
    if (rideActive) renderRidePlan();
    if (runwayActive) renderFoodRunway();
  };

  const baseSwitchScreen = switchScreen;
  switchScreen = function switchScreenBeta(screen) {
    const target = ["dashboard", "logs", "trends", "ride", "runway", "checklist"].includes(screen) ? screen : "dashboard";
    baseSwitchScreen(target);
    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.screen === target);
    });
    document.querySelectorAll(".mobile-nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileScreen === target);
    });
    const titles = {
      dashboard: ["Fuel Rhythm", "What is happening today."],
      logs: ["Data", "Status, logs, and today's timeline."],
      trends: ["Trends", "How habits are changing over time."],
      ride: ["Ride Plan", "Plan and run in-app fuel and hydration reminders."],
      runway: ["Food Runway", "Track how long shops and meal prep actually last."],
      checklist: ["Settings", "Adjust beta gap thresholds and reset test data."]
    };
    const title = document.getElementById("pageTitle");
    const subtitle = document.getElementById("pageSubtitle");
    if (title) title.textContent = titles[target][0];
    if (subtitle) subtitle.textContent = titles[target][1];
    if (target === "logs") renderHistory();
    if (target === "trends") renderTrends();
    if (target === "ride") renderRidePlan();
    if (target === "runway") renderFoodRunway();
    if (target === "checklist") renderSettings();
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
    document.getElementById("fuelSettingsStatus").textContent = "Support thresholds saved. Eat soon, Eat now, and Recovery needed starts updated for fuel and hydration.";
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
    gap.graphMode = "risk";
    gap.thresholds = { ...DEFAULT_THRESHOLDS };
    gap.dayEndedDate = "";
    gap.dayEndedAt = "";
    gap.fastingStartedAt = "";
    gap.cooldownUntil = 0;
    gap.ridePlans = [];
    gap.rideTemplates = [];
    gap.activeRide = null;
    gap.foodRunway = [];
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
  document.getElementById("showMissedLogButton")?.addEventListener("click", () => setMissedLogPanel(true));
  document.getElementById("cancelMissedLogButton")?.addEventListener("click", () => setMissedLogPanel(false));
  document.getElementById("saveMissedLogButton")?.addEventListener("click", saveMissedLog);
  document.getElementById("openRidePlanButton")?.addEventListener("click", () => switchScreen("ride"));
  document.getElementById("openFoodRunwayButton")?.addEventListener("click", () => switchScreen("runway"));
  document.getElementById("rideSavePlanButton")?.addEventListener("click", () => saveRidePlan());
  document.getElementById("rideTemplateButton")?.addEventListener("click", () => saveRidePlan({ asTemplate: true }));
  document.getElementById("rideStartButton")?.addEventListener("click", () => startRide());
  ["ridePlanName", "rideDurationMinutes", "rideFuelInterval", "rideFirstFuel", "rideHydrationInterval", "rideFirstHydration"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", renderRidePlan);
  });
  document.getElementById("runwaySaveEntryButton")?.addEventListener("click", saveRunwayEntry);
  document.getElementById("runwayCancelEditButton")?.addEventListener("click", () => {
    runwayEditingId = "";
    runwayStatus = "";
    fillRunwayForm();
    renderFoodRunway();
  });
  document.addEventListener("click", event => {
    const editLog = event.target.closest("[data-edit-log]");
    if (editLog) {
      const log = logById(editLog.dataset.editLog);
      if (log) setMissedLogPanel(true, log);
      return;
    }
    const deleteLogButton = event.target.closest("[data-delete-log]");
    if (deleteLogButton) {
      deleteRhythmLogById(deleteLogButton.dataset.deleteLog);
      return;
    }
    const openScreen = event.target.closest("[data-open-screen]");
    if (openScreen) {
      switchScreen(openScreen.dataset.openScreen);
      return;
    }
    const editRide = event.target.closest("[data-edit-ride]");
    if (editRide) {
      const plan = betaState().ridePlans.find(item => item.id === editRide.dataset.editRide);
      if (plan) fillRideForm(plan);
      renderRidePlan();
      return;
    }
    const startRideButton = event.target.closest("[data-start-ride]");
    if (startRideButton) {
      const plan = betaState().ridePlans.find(item => item.id === startRideButton.dataset.startRide);
      if (plan) startRide(plan);
      return;
    }
    const deleteRide = event.target.closest("[data-delete-ride]");
    if (deleteRide) {
      betaState().ridePlans = betaState().ridePlans.filter(plan => plan.id !== deleteRide.dataset.deleteRide);
      rideStatus = "Ride plan deleted.";
      save();
      renderRidePlan();
      return;
    }
    const confirmRide = event.target.closest("[data-confirm-ride]");
    if (confirmRide) {
      confirmRideReminder(confirmRide.dataset.confirmRide);
      return;
    }
    if (event.target.closest("[data-end-ride]")) {
      endActiveRide();
      return;
    }
    const editRunway = event.target.closest("[data-edit-runway]");
    if (editRunway) {
      runwayEditingId = editRunway.dataset.editRunway;
      renderFoodRunway();
      return;
    }
    const finishRunway = event.target.closest("[data-finish-runway]");
    if (finishRunway) {
      const entry = runwayEntries().find(item => item.id === finishRunway.dataset.finishRunway);
      if (entry) {
        entry.actualFinishDate = dateKey();
        entry.updatedAt = new Date().toISOString();
        runwayStatus = "Shop marked as finished.";
        save();
        renderAll();
      }
      return;
    }
    const deleteRunway = event.target.closest("[data-delete-runway]");
    if (deleteRunway) {
      betaState().foodRunway = runwayEntries().filter(entry => entry.id !== deleteRunway.dataset.deleteRunway);
      runwayStatus = "Food Runway entry deleted.";
      save();
      renderAll();
    }
  });
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
    betaState().graphMode = GRAPH_MODES.has(button.dataset.graphMode) ? button.dataset.graphMode : "risk";
    save();
    renderFuelGap();
  });
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", event => {
    selectedHistoryKey = event.target.value;
    renderHistory();
  });
  function selectHistoryDay(button) {
    if (!button) return;
    selectedHistoryKey = button.dataset.historyDay;
    renderHistory();
  }

  document.getElementById("fuelHistoryArchiveDetail")?.addEventListener("click", event => {
    const button = event.target.closest("[data-history-day]");
    selectHistoryDay(button);
  });
  document.getElementById("trendDayTypeFilter")?.addEventListener("change", event => {
    selectedTrendDayType = event.target.value || "all";
    renderTrends();
  });
  document.getElementById("trendTrainingFilter")?.addEventListener("change", event => {
    selectedTrendTrainingSession = event.target.value || "all";
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
      if (document.getElementById("logs")?.classList.contains("active")) drawBetaGraph();
    });
  });

  function scheduleFuelGuardTick() {
    const delay = cooldownRemainingSeconds() > 0 ? 1000 : 30000;
    window.setTimeout(() => {
      renderFuelGap();
      scheduleFuelGuardTick();
    }, delay);
  }

  if (betaState().activeRide?.status === "active") startActiveRideTimer();
  renderAll();
  scheduleFuelGuardTick();
})();
