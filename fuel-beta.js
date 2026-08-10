// Fuel Guard canonical mobile PWA layer.
// Focuses the app on planning today, logging quickly, and reviewing patterns.
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
  const FUEL_CSV_TIMESTAMP_HEADERS = ["schema_version", "event_id", "event_type", "logged_at_iso", "logged_at_ms", "source", "device_id"];
  const FUEL_CSV_ESP32_MILLIS_HEADERS = ["event_id", "event_type", "event_millis", "source", "device_id"];
  const FUEL_CSV_REQUIRED_HEADER_SETS = [
    { name: "Fuel Guard timestamp export", headers: FUEL_CSV_TIMESTAMP_HEADERS },
    { name: "Fuel Guard ESP32 export", headers: FUEL_CSV_ESP32_MILLIS_HEADERS }
  ];
  const FUEL_CSV_FUTURE_LIMIT_MS = 5 * 60 * 1000;
  const DAY_TYPE_OPTIONS = [
    { value: "work", label: "Working Day" },
    { value: "holiday", label: "Holiday" },
    { value: "competition", label: "Competition Day" }
  ];
  const DEPRECATED_DAY_TYPES = new Set(["travel"]);
  const GAP_INSIGHT_METRIC_IDS = new Set(["fuel-gap", "hydration-gap", "low-energy"]);
  const GAP_DURATION_METRIC_IDS = new Set(["fuel-gap", "hydration-gap"]);
  const LOG_HABIT_METRIC_IDS = new Set(["logs"]);
  const SLEEPY_CHECKIN_TYPE = "sleepy";
  const DEMAND_BLOCK_TYPES = new Set(["training", "work"]);
  const TRAINING_DEMAND_TYPES = [
    { value: "run", label: "Run" },
    { value: "bike", label: "Bike" },
    { value: "swim", label: "Swim" },
    { value: "strength", label: "Strength" },
    { value: "triathlon", label: "Triathlon" },
    { value: "sport", label: "Sport" },
    { value: "other", label: "Other" }
  ];
  const TRAINING_DEMAND_LABELS = TRAINING_DEMAND_TYPES.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const SESSION_INTENSITY_OPTIONS = [
    { value: "easy", label: "Easy" },
    { value: "moderate", label: "Moderate" },
    { value: "hard", label: "Hard" },
    { value: "long", label: "Long" }
  ];
  const SESSION_INTENSITY_LABELS = SESSION_INTENSITY_OPTIONS.reduce((labels, option) => {
    labels[option.value] = option.label;
    return labels;
  }, {});
  const FUEL_OPPORTUNITY_WEIGHTS = {
    normal: 0.5,
    pre_training: 1,
    during_training: 1,
    post_training: 1.25,
    follow_up_recovery: 1,
    pre_shift: 0.75,
    work_break: 1,
    post_shift: 0.75
  };
  const FUEL_SCORE_WEIGHTS = {
    training_adherence: 40,
    work_adherence: 25,
    gap_adherence: 20,
    target_completion: 15
  };
  const OPPORTUNITY_RULES = {
    dueSoonMinutes: 45,
    missedAfterMinutes: 180,
    nearestMatchToleranceMinutes: 90,
    preTraining: { beforeStartMinutes: 75, closeBeforeStartMinutes: 15 },
    duringTrainingMinimumMinutes: 90,
    postTraining: { afterStartMinutes: 0, afterEndMinutes: 75 },
    followUpRecovery: { afterStartMinutes: 120, afterEndMinutes: 210 },
    preShift: { beforeStartMinutes: 75, closeBeforeStartMinutes: 15 },
    postShift: { afterStartMinutes: 0, afterEndMinutes: 75 },
    normalWindowMinutes: 45
  };
  const WORK_BREAK_INTERVAL_OPTIONS = [
    { value: "120", label: "2 hours" },
    { value: "150", label: "2-3 hours" },
    { value: "180", label: "3 hours" },
    { value: "240", label: "4 hours" }
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
  const CRASH_NOTE = "fuel_guard_event:crash";
  const CHECKIN_NOTE_PREFIX = "fuel_guard_checkin:";
  const ENERGY_LEVELS = {
    high: "High",
    steady: "Steady",
    low: "Low",
    very_low: "Very low"
  };
  const CONCENTRATION_LEVELS = {
    sharp: "Sharp",
    normal: "Normal",
    reduced: "Reduced",
    poor: "Poor"
  };
  const YES_NO_LEVELS = {
    yes: "Yes",
    no: "No",
    not_sure: "Not sure"
  };
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
  let selectedTrendDayType = "all";
  let selectedTrendTrainingSession = "all";
  let selectedTrendWeekStartKey = "";
  let selectedTrendMonthKey = "";
  let selectedTrendPeriod = "week";
  let selectedTrendSegment = "overview";
  let selectedPlanSubtab = "today";
  let selectedLogPatternType = "fuel";
  let lastAutoFuelWindowDateKey = "";
  let accountBusy = false;
  let coachSharingBusy = false;
  let athleteProfileBusy = false;
  let athleteProfileStatus = "";
  let coachSharingState = {
    loadedFor: "",
    profile: null,
    relationships: [],
    nudges: [],
    status: ""
  };
  let csvImportBusy = false;
  let csvImportPreview = null;
  let csvImportStatus = "";
  let missedLogEditingId = "";
  let missedLogStatus = "";
  let missedLogBusy = false;
  let selectedTodayTimelineLogId = "";
  let quickLogConfirmation = "";
  let quickLogConfirmationTimer = 0;
  let demandPlannerStatus = "";
  let garminPatternsState = {
    loaded: false,
    loading: false,
    data: null,
    error: ""
  };
  let demandPlannerEditingId = "";

  const TARGET_FIELDS = [
    "dailyFuelLogs",
    "dailyHydrationLogs",
    "weeklyFuelLogs",
    "weeklyHydrationLogs"
  ];
  const COACH_PROFILES_TABLE = "fuel_user_profiles";
  const COACH_RELATIONSHIPS_TABLE = "fuel_coach_athletes";
  const COACH_NUDGES_TABLE = "fuel_coach_nudges";
  const ATHLETE_CODE_RE = /^FG-[A-Z0-9]{6}$/;
  const ATHLETE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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

  function coachSharingClient() {
    return window.fuelGuardCloud?.client || null;
  }

  function coachSharingUser() {
    return window.fuelGuardCloud?.user || null;
  }

  function setCoachSharingStatus(message) {
    coachSharingState.status = message || "";
    const status = document.getElementById("coachSharingStatus");
    if (status) status.textContent = coachSharingState.status;
  }

  function coachSharingSetupError(error) {
    return /fuel_user_profiles|fuel_coach_athletes|fuel_coach_nudges|athlete_code|coach_label|does not exist|schema cache/i.test(String(error?.message || ""));
  }

  function normalizeAthleteCode(value) {
    const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    const match = compact.match(/^FG[-_]?([A-Z0-9]{6})$/);
    return match ? `FG-${match[1]}` : compact;
  }

  function randomAthleteCode() {
    const values = new Uint8Array(6);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
    else {
      for (let index = 0; index < values.length; index += 1) values[index] = Math.floor(Math.random() * 255);
    }
    const suffix = Array.from(values, value => ATHLETE_CODE_CHARS[value % ATHLETE_CODE_CHARS.length]).join("");
    return `FG-${suffix}`;
  }

  function coachProfileSelect() {
    return "user_id,role,coach_enabled,display_name,first_name,last_name,avatar_url,job_title,athlete_code,created_at,updated_at";
  }

  async function ensureAthleteCoachProfile(client, user) {
    const select = coachProfileSelect();
    const { data: existing, error: profileError } = await client
      .from(COACH_PROFILES_TABLE)
      .select(select)
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    let profile = existing;
    if (!profile) {
      const { data, error } = await client
        .from(COACH_PROFILES_TABLE)
        .upsert({
          user_id: user.id,
          role: "athlete",
          coach_enabled: false,
          display_name: user.email || "Fuel Guard Athlete",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })
        .select(select)
        .single();
      if (error) throw error;
      profile = data;
    }

    if (profile?.athlete_code) return profile;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data, error } = await client
        .from(COACH_PROFILES_TABLE)
        .update({
          athlete_code: randomAthleteCode(),
          updated_at: new Date().toISOString()
        })
        .eq("user_id", user.id)
        .select(select)
        .single();
      if (!error && data?.athlete_code) return data;
      if (!/duplicate|unique|fuel_user_profiles_athlete_code/i.test(String(error?.message || ""))) throw error;
    }

    throw new Error("Could not create a unique Athlete Code.");
  }

  async function loadCoachSharingRelationships(force = false) {
    const client = coachSharingClient();
    const user = coachSharingUser();
    if (!client || !user?.id) return;
    if (!force && (coachSharingBusy || coachSharingState.loadedFor === user.id)) return;
    coachSharingBusy = true;
    try {
      const profile = await ensureAthleteCoachProfile(client, user);
      const { data, error } = await client
        .from(COACH_RELATIONSHIPS_TABLE)
        .select("id,coach_id,athlete_id,status,athlete_label,coach_label,created_at,accepted_at,revoked_at,updated_at")
        .eq("athlete_id", user.id)
        .in("status", ["pending", "active", "declined"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      const { data: nudges, error: nudgesError } = await client
        .from(COACH_NUDGES_TABLE)
        .select("id,coach_id,athlete_id,message,sent_at")
        .eq("athlete_id", user.id)
        .order("sent_at", { ascending: false })
        .limit(5);
      if (nudgesError) throw nudgesError;
      coachSharingState.profile = profile;
      coachSharingState.relationships = data || [];
      coachSharingState.nudges = nudges || [];
      coachSharingState.loadedFor = user.id;
      coachSharingState.status = coachSharingState.relationships.length
        ? "Coach access is ready."
        : "No coaches connected yet.";
    } catch (error) {
      coachSharingState.profile = null;
      coachSharingState.relationships = [];
      coachSharingState.nudges = [];
      coachSharingState.loadedFor = user.id;
      coachSharingState.status = coachSharingSetupError(error)
        ? "Coach access setup is not applied yet."
        : `Coach access could not load: ${error?.message || "unknown error"}`;
    } finally {
      coachSharingBusy = false;
      renderAthleteProfile();
      renderCoachSharing();
      renderCoachNudges();
    }
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
    if (headerIndex < 0) {
      return {
        recognized: false,
        rows: [],
        validationMessage: "CSV file is empty. Please export logs from your FG button and try again."
      };
    }
    const headers = parseCsvLine(lines[headerIndex]).map((header, index) => {
      const trimmed = header.trim();
      return index === 0 ? trimmed.replace(/^\uFEFF/, "") : trimmed;
    });
    const schema = FUEL_CSV_REQUIRED_HEADER_SETS.find(option => option.headers.every(header => headers.includes(header)));
    if (!schema) {
      const esp32Missing = FUEL_CSV_ESP32_MILLIS_HEADERS.filter(header => !headers.includes(header));
      const timestampMissing = FUEL_CSV_TIMESTAMP_HEADERS.filter(header => !headers.includes(header));
      const missing = esp32Missing.length <= timestampMissing.length ? esp32Missing : timestampMissing;
      return {
        recognized: false,
        rows: [],
        validationMessage: `CSV headers not recognised. Missing required ${missing.length === 1 ? "header" : "headers"}: ${missing.join(", ")}.`
      };
    }

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
    return { recognized: true, rows, schema: schema.name };
  }

  function selectedImportBaseDate(options = {}) {
    const key = options.baseDateKey || selectedDataDateKey();
    const base = dateFromKey(key);
    base.setHours(0, 0, 0, 0);
    return base;
  }

  function timestampResultFromFuelCsvRow(row, now = new Date(), options = {}) {
    const isoText = String(row.logged_at_iso || "").trim();
    let date = null;
    if (isoText) {
      date = logDate(isoText);
      if (!date) return { timestamp: "", validationMessage: `Line ${row.__line}: logged_at_iso is not a valid timestamp.` };
    } else {
      const loggedAtMsText = String(row.logged_at_ms || "").trim();
      const eventMillisText = String(row.event_millis || "").trim();
      if (loggedAtMsText) {
        const ms = Number(loggedAtMsText);
        if (!Number.isFinite(ms) || ms <= 0) {
          return { timestamp: "", validationMessage: `Line ${row.__line}: logged_at_ms must be a positive number.` };
        }
        date = new Date(ms);
      } else if (eventMillisText) {
        const eventMillis = Number(eventMillisText);
        if (!Number.isFinite(eventMillis) || eventMillis < 0) {
          return { timestamp: "", validationMessage: `Line ${row.__line}: event_millis must be a number.` };
        }
        date = new Date(selectedImportBaseDate(options).getTime() + eventMillis);
      } else {
        return { timestamp: "", validationMessage: `Line ${row.__line}: no timestamp found. Expected logged_at_iso, logged_at_ms, or event_millis.` };
      }
    }
    if (!date || Number.isNaN(date.getTime())) {
      return { timestamp: "", validationMessage: `Line ${row.__line}: timestamp could not be parsed.` };
    }
    if (date.getTime() - now.getTime() > FUEL_CSV_FUTURE_LIMIT_MS) {
      return { timestamp: "", validationMessage: `Line ${row.__line}: timestamp is more than 5 minutes in the future.` };
    }
    return { timestamp: date.toISOString(), validationMessage: "" };
  }

  function timestampFromFuelCsvRow(row, now = new Date(), options = {}) {
    return timestampResultFromFuelCsvRow(row, now, options).timestamp || null;
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
    if (!parsed.recognized) {
      return {
        recognized: false,
        logs: [],
        duplicateCount: 0,
        invalidCount: 0,
        validationMessage: parsed.validationMessage || "CSV headers not recognised."
      };
    }

    const now = options.now || new Date();
    const seen = existingFuelImportKeys();
    const logs = [];
    let duplicateCount = 0;
    let invalidCount = 0;
    const invalidMessages = [];
    if (!parsed.rows.length) {
      return {
        recognized: true,
        logs: [],
        validCount: 0,
        duplicateCount: 0,
        invalidCount: 0,
        earliest: null,
        latest: null,
        validationMessage: "CSV headers were recognised, but no data rows were found."
      };
    }

    parsed.rows.forEach(row => {
      if (row.event_type !== "FUEL_LOG") {
        invalidCount += 1;
        invalidMessages.push(`Line ${row.__line}: event_type must be FUEL_LOG.`);
        return;
      }
      const timestampResult = timestampResultFromFuelCsvRow(row, now, options);
      const timestamp = timestampResult.timestamp;
      if (!timestamp) {
        invalidCount += 1;
        if (timestampResult.validationMessage) invalidMessages.push(timestampResult.validationMessage);
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
        importEventMillis: String(row.event_millis || "").trim() ? Number(String(row.event_millis || "").trim()) : null,
        importSource: String(row.source || "").trim(),
        importDeviceId: String(row.device_id || "").trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        syncStatus: "pending"
      });
    });

    const dates = logs.map(log => logDate(log)).filter(Boolean).sort((a, b) => a - b);
    const preview = {
      recognized: true,
      logs,
      validCount: logs.length,
      duplicateCount,
      invalidCount,
      earliest: dates[0] || null,
      latest: dates[dates.length - 1] || null
    };
    preview.validationMessage = !logs.length && duplicateCount > 0 && !invalidMessages.length
      ? "All fuel logs in this CSV were already imported."
      : !logs.length && invalidMessages.length
        ? invalidMessages[0]
        : invalidMessages.length
          ? `${invalidCount} ${invalidCount === 1 ? "row was" : "rows were"} skipped. First issue: ${invalidMessages[0]}`
          : "";
    return preview;
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

  function isSelectableDayType(value) {
    return DAY_TYPE_OPTIONS.some(option => option.value === value);
  }

  function trendDayTypeValue(value) {
    const next = normalizeDayType(value);
    return next && isSelectableDayType(next) ? next : "";
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
      entry.dayTypeLabel = dayTypeLabel(entry.dayType);
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
    if (!Array.isArray(gap.demandBlocks)) gap.demandBlocks = [];
    if (!Array.isArray(gap.workBreaks)) gap.workBreaks = [];
    if (!Array.isArray(gap.ridePlans)) gap.ridePlans = [];
    if (!Array.isArray(gap.rideTemplates)) gap.rideTemplates = [];
    if (!gap.activeRide || typeof gap.activeRide !== "object" || Array.isArray(gap.activeRide)) gap.activeRide = null;
    if (!Array.isArray(gap.foodRunway)) gap.foodRunway = [];
    if (!gap.planRealism || typeof gap.planRealism !== "object" || Array.isArray(gap.planRealism)) gap.planRealism = {};
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
    gap.fuelWindowMinutes = clamp(Number(gap.fuelWindowMinutes || 720), 240, 1200);
    gap.maximumFuelGapMinutes = clamp(Number(gap.maximumFuelGapMinutes || gap.thresholds.redMinutes || DEFAULT_THRESHOLDS.redMinutes), 120, 240);
    gap.thresholds.greenMinutes = Math.max(30, gap.maximumFuelGapMinutes - 30);
    gap.thresholds.redMinutes = gap.maximumFuelGapMinutes;
    gap.thresholds.crashMinutes = Math.max(gap.maximumFuelGapMinutes + 40, gap.maximumFuelGapMinutes + 15);
    if (!gap.targets || typeof gap.targets !== "object" || Array.isArray(gap.targets)) gap.targets = {};
    TARGET_FIELDS.forEach(key => {
      gap.targets[key] = normalizeTargetNumber(gap.targets[key]);
    });
    gap.targets.weeklyFuelLogs = weeklyTargetFromDaily(gap.targets.dailyFuelLogs);
    gap.targets.weeklyHydrationLogs = weeklyTargetFromDaily(gap.targets.dailyHydrationLogs);
    gap.targets.updatedAt = String(gap.targets.updatedAt || "");
    normalizeStoredDayTypes(gap);
    removeStoredFollowUpData(gap);
    return gap;
  }

  function thresholds() {
    return betaState().thresholds;
  }

  function fuelWindowMinutes() {
    return betaState().fuelWindowMinutes;
  }

  function maximumFuelGapMinutes() {
    return betaState().maximumFuelGapMinutes;
  }

  function maximumFuelGapPresetValue(minutes = maximumFuelGapMinutes()) {
    const safeMinutes = Number(minutes);
    return [150, 180, 210, 240].includes(safeMinutes) ? String(safeMinutes) : "custom";
  }

  function applyMaximumFuelGapGoal(minutes) {
    const safeMinutes = clamp(Math.round(Number(minutes || DEFAULT_THRESHOLDS.redMinutes)), 120, 240);
    const gap = betaState();
    gap.maximumFuelGapMinutes = safeMinutes;
    gap.thresholds.greenMinutes = Math.max(30, safeMinutes - 30);
    gap.thresholds.redMinutes = safeMinutes;
    gap.thresholds.crashMinutes = safeMinutes + 40;
    gap.targets.updatedAt = new Date().toISOString();
    if (typeof addActivityEntry === "function") {
      addActivityEntry("maximumFuelGapConfigured", `Maximum fuel gap set to ${duration(safeMinutes)}.`, { dedupeDaily: true });
    }
    save();
    renderAll();
  }

  function fuelStatusLimits() {
    const goal = maximumFuelGapMinutes();
    const approach = Math.max(30, goal - 30);
    const crash = Math.max(goal + 40, Number(thresholds().crashMinutes || DEFAULT_THRESHOLDS.crashMinutes));
    return {
      greenMinutes: approach,
      redMinutes: goal,
      crashMinutes: Math.max(crash, goal + 15)
    };
  }

  function normalizeTargetNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const number = Number(text);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function targets() {
    return betaState().targets;
  }

  function hasTarget(value) {
    return Number.isInteger(value) && value > 0;
  }

  function weeklyTargetFromDaily(value) {
    return hasTarget(value) ? value * 7 : null;
  }

  function derivedTargets(source = targets()) {
    return {
      ...source,
      dailyFuelLogs: normalizeTargetNumber(source?.dailyFuelLogs),
      dailyHydrationLogs: normalizeTargetNumber(source?.dailyHydrationLogs),
      weeklyFuelLogs: weeklyTargetFromDaily(normalizeTargetNumber(source?.dailyFuelLogs)),
      weeklyHydrationLogs: weeklyTargetFromDaily(normalizeTargetNumber(source?.dailyHydrationLogs))
    };
  }

  function applyDerivedTargets() {
    betaState().targets = {
      ...derivedTargets(betaState().targets),
      updatedAt: String(betaState().targets?.updatedAt || "")
    };
    return betaState().targets;
  }

  function targetPercent(actual, target) {
    return hasTarget(target) ? Math.round((Math.max(0, actual) / target) * 100) : null;
  }


  fuelGapStatus = function fuelGapStatusBeta(minutes) {
    const limits = fuelStatusLimits();
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

  function encodeCheckinNote(payload = {}) {
    return `${CHECKIN_NOTE_PREFIX}${JSON.stringify(payload)}`;
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
    const parsed = parseCheckinNote(log?.note || log?.notes || "");
    return parsed || null;
  }

  function isCheckinLog(log) {
    return String(log?.type || "").toLowerCase() === "checkin" || Boolean(checkinPayload(log));
  }

  function levelLabel(value, labels) {
    const key = String(value || "").trim().toLowerCase();
    return labels[key] || "";
  }

  function simpleLevelLabel(value) {
    const key = String(value || "").trim().toLowerCase();
    if (key === "high") return "High";
    if (key === "steady") return "Steady";
    if (key === "low") return "Low";
    if (key === "very_low") return "Very low";
    return key ? key.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase()) : "";
  }

  function checkinTypeLabel(logOrPayload) {
    const payload = logOrPayload?.checkinType ? logOrPayload : checkinPayload(logOrPayload);
    const type = String(payload?.checkinType || "").toLowerCase();
    if (type === "concentration") return "Concentration check-in";
    if (type === "hunger") return "Hunger check-in";
    if (type === "fatigue") return "Fatigue check-in";
    if (type === SLEEPY_CHECKIN_TYPE) return "Sleepy";
    if (type === "work") return "Work check-in";
    if (type === "training") return "Training check-in";
    if (type === "daily") return "Daily check-in";
    return "Energy check-in";
  }

  function checkinContextLabel(value) {
    const context = String(value || "").toLowerCase();
    if (context === "work") return "Work";
    if (context === "training") return "Training";
    if (context === "daily_summary") return "Daily summary";
    if (context === "missed_fuel_moment") return "Missed fuel moment";
    return "Today";
  }

  function checkinSummary(logOrPayload) {
    const payload = logOrPayload?.checkinType ? logOrPayload : checkinPayload(logOrPayload);
    if (!payload) return "";
    const parts = [];
    if (String(payload.checkinType || "").toLowerCase() === SLEEPY_CHECKIN_TYPE) {
      parts.push("Noticeable sleepiness / low arousal");
    }
    const energy = levelLabel(payload.energyLevel, ENERGY_LEVELS);
    const concentration = levelLabel(payload.concentrationLevel, CONCENTRATION_LEVELS);
    if (energy) parts.push(`Energy: ${energy}`);
    if (concentration) parts.push(`Concentration: ${concentration}`);
    const arousal = simpleLevelLabel(payload.arousalLevel);
    if (arousal && String(payload.checkinType || "").toLowerCase() !== SLEEPY_CHECKIN_TYPE) parts.push(`Arousal: ${arousal}`);
    const hunger = simpleLevelLabel(payload.hungerLevel);
    const fatigue = simpleLevelLabel(payload.fatigueLevel);
    if (hunger) parts.push(`Hunger: ${hunger === "High" ? "Noted" : hunger}`);
    if (fatigue) parts.push(`Fatigue: ${fatigue}`);
    const breakTaken = levelLabel(payload.breakTaken, YES_NO_LEVELS);
    const fuelled = levelLabel(payload.fuelledDuringBreak, YES_NO_LEVELS);
    const recovery = levelLabel(payload.recoveryFuelCompleted, YES_NO_LEVELS);
    if (breakTaken) parts.push(`Break taken: ${breakTaken}`);
    if (fuelled) parts.push(`Fuelled during break: ${fuelled}`);
    if (recovery) parts.push(`Recovery fuel: ${recovery}`);
    if (payload.note) parts.push(String(payload.note));
    return parts.join(" · ");
  }

  function isLowEnergyCheckinLog(log) {
    if (isCrashLog(log)) return true;
    const payload = checkinPayload(log);
    if (!payload) return false;
    if (String(payload.checkinType || "").toLowerCase() === SLEEPY_CHECKIN_TYPE) return false;
    const level = String(payload.energyLevel || "").toLowerCase();
    return ["low", "very_low"].includes(level);
  }

  function isSleepyLog(log) {
    const payload = checkinPayload(log);
    return String(payload?.checkinType || "").toLowerCase() === SLEEPY_CHECKIN_TYPE;
  }

  function isPoorConcentrationCheckinLog(log) {
    const payload = checkinPayload(log);
    if (!payload) return false;
    const level = String(payload.concentrationLevel || "").toLowerCase();
    return ["reduced", "poor"].includes(level);
  }

  function isSubjectiveCheckinLog(log) {
    return isCheckinLog(log) || isCrashLog(log);
  }

  function logType(log) {
    const type = String(log?.type || "fuel").toLowerCase();
    if (type === "checkin" || checkinPayload(log)) return "checkin";
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
    const type = String(log?.type || "").toLowerCase();
    return type === "crash" || String(log?.note || log?.notes || "").includes(CRASH_NOTE);
  }

  function logTypeLabel(log) {
    const type = logType(log);
    if (type === "hydration") return "Hydration";
    if (type === "fuel_hydration") return "Fuel + Hydration";
    if (type === "checkin") return checkinTypeLabel(log);
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
    const next = normalizeDayType(value);
    return next && isSelectableDayType(next) && !DEPRECATED_DAY_TYPES.has(next)
      ? (DAY_TYPE_LABELS[next] || next)
      : "Not set";
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
    if (window.FuelGuardDomain?.applyDayTypeState) {
      window.FuelGuardDomain.applyDayTypeState(gap, key, nextValue);
    } else if (window.FuelGuardDomain?.applyDayTypeOverride) {
      window.FuelGuardDomain.applyDayTypeOverride(gap.dayTypes, key, nextValue);
      if (gap.archive?.[key]) gap.archive[key].dayType = nextValue || "";
    } else if (nextValue) gap.dayTypes[key] = nextValue;
    else delete gap.dayTypes[key];

    if (!window.FuelGuardDomain?.applyDayTypeState) {
      gap.logs.forEach(log => {
        const date = logDate(log);
        if (date && dateKey(date) === key) log.dayType = nextValue || "";
      });
    }

    storeArchive(key, { endedAt: gap.archive[key]?.endedAt || (gap.dayEndedDate === key ? gap.dayEndedAt : "") });
    if (typeof addActivityEntry === "function") {
      addActivityEntry("dayTypeSelected", `Day context set to ${nextValue ? dayTypeLabel(nextValue) : "Normal"}.`, { dedupeDaily: true });
    }
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
    if (isCheckinLog(log)) return checkinSummary(log);
    const note = scrubLegacyFollowUpNote(log?.note || log?.notes || "");
    if (!note || note.includes(CRASH_NOTE) || note.includes(CHECKIN_NOTE_PREFIX)) return "";
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
    return fuelStatusLimits().redMinutes;
  }

  function mediumRiskLimit() {
    return fuelStatusLimits().greenMinutes;
  }

  function crashRiskLimit() {
    return fuelStatusLimits().crashMinutes;
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

  function displayStatusLabel(value) {
    const text = String(value || "").toLowerCase();
    if (!text) return "Not enough data yet";
    if (text.includes("recovery") || text.includes("crash zone") || text.includes("under-fuel") || text.includes("needed")) return "Recovery needed";
    if (text.includes("eat now") || text.includes("high support") || text.includes("high risk") || text === "red" || text.includes("urgent")) return "Eat now";
    if (text.includes("eat soon") || text.includes("medium") || text === "amber") return "Eat soon";
    if (text.includes("steady") || text.includes("minimal") || text.includes("low risk") || text === "green") return "Steady";
    return value;
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
    const fuelScore = scoreFromGap(fuelMinutes, mediumRiskLimit(), riskLimit(), crashRiskLimit());
    const hydrationScore = scoreFromGap(hydrationMinutes, hydrationGreenLimit(), hydrationRiskLimit(), hydrationCrashRiskLimit());
    return Math.round(clamp(Math.max(fuelScore, hydrationScore * 0.88), 0, 100));
  }

  function riskSamplesForDay(key, { now = new Date(), endedAt = "" } = {}) {
    const logs = logsForDay(key).filter(log => log.date);
    const fuelLogs = logs.filter(isFuelLog).sort((a, b) => a.date - b.date);
    const hydrationLogs = logs.filter(isHydrationLog).sort((a, b) => a.date - b.date);
    const crashLogs = logs.filter(isLowEnergyCheckinLog).sort((a, b) => a.date - b.date);
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
    const checkinLogs = logs.filter(isSubjectiveCheckinLog);
    const crashLogs = logs.filter(isLowEnergyCheckinLog);
    const poorConcentrationLogs = logs.filter(isPoorConcentrationCheckinLog);
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
      ? `${crashLogs.length} low-energy check-in${crashLogs.length === 1 ? " was" : "s were"} marked.`
      : "No low-energy check-in was marked.";
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
      { label: "Low-energy check-ins", value: String(crashLogs.length) },
      { label: "Concentration check-ins", value: String(poorConcentrationLogs.length) },
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
      checkinLogs,
      crashLogs,
      poorConcentrationLogs,
      firstFuelTime: firstFuel ? formatClock(firstFuel.date) : "Not logged",
      lastFuelTime: lastFuel ? formatClock(lastFuel.date) : "Not logged",
      firstFuelMinute: firstFuel ? minutesIntoDay(firstFuel.date) : null,
      lastFuelMinute: lastFuel ? minutesIntoDay(lastFuel.date) : null,
      fuelLogCount: fuelLogs.length,
      hydrationLogCount: hydrationLogs.length,
      checkinCount: checkinLogs.length,
      crashLogCount: crashLogs.length,
      concentrationLogCount: poorConcentrationLogs.length,
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
      checkinCount: analysis.checkinCount,
      crashLogCount: analysis.crashLogCount,
      concentrationLogCount: analysis.concentrationLogCount,
      logs: analysis.logs.map(log => ({
        id: log.id || uid(),
        timestamp: log.date.toISOString(),
        type: logType(log),
        typeLabel: logTypeLabel(log),
        dayType: log.dayType || analysis.dayType,
        trainingSession: log.trainingSession || analysis.trainingSession,
        note: displayNoteForLog(log),
        checkin: checkinPayload(log) || null
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

  function selectedDataDateKey() {
    const todayKey = dateKey();
    if (!selectedHistoryKey) selectedHistoryKey = todayKey;
    if (selectedHistoryKey > todayKey) selectedHistoryKey = todayKey;
    return selectedHistoryKey;
  }

  function setSelectedDataDate(value) {
    const todayKey = dateKey();
    selectedHistoryKey = value && value <= todayKey ? value : todayKey;
    return selectedHistoryKey;
  }

  function selectedTrendWeekStart() {
    if (!selectedTrendWeekStartKey) selectedTrendWeekStartKey = dateKey(startOfCalendarWeek(new Date()));
    const start = startOfCalendarWeek(dateFromKey(selectedTrendWeekStartKey));
    const currentStart = startOfCalendarWeek(new Date());
    if (start > currentStart) {
      selectedTrendWeekStartKey = dateKey(currentStart);
      return currentStart;
    }
    selectedTrendWeekStartKey = dateKey(start);
    return start;
  }

  function setSelectedTrendWeekStart(date) {
    const currentStart = startOfCalendarWeek(new Date());
    const next = startOfCalendarWeek(date);
    selectedTrendWeekStartKey = dateKey(next > currentStart ? currentStart : next);
    return selectedTrendWeekStart();
  }

  function weekDays(start) {
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }

  function formatWeekRange(start) {
    const end = addDays(start, 6);
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  function entriesForWeek(entries, start) {
    const end = addDays(start, 7);
    return entries.filter(entry => {
      const date = dateFromKey(entry.date);
      return date >= start && date < end;
    });
  }


  function startOfCalendarMonth(date = new Date()) {
    const start = startOfDay(date);
    start.setDate(1);
    return start;
  }

  function addMonths(date, months) {
    const next = startOfCalendarMonth(date);
    next.setMonth(next.getMonth() + months);
    return startOfCalendarMonth(next);
  }

  function daysBetween(start, end) {
    return Math.max(0, Math.round((startOfDay(end) - startOfDay(start)) / 86400000));
  }

  function entriesForRange(entries, start, end) {
    return entries.filter(entry => {
      const date = dateFromKey(entry.date);
      return date >= start && date < end;
    });
  }

  function formatMonthRange(start) {
    return start.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function selectedTrendMonthStart() {
    if (!selectedTrendMonthKey) selectedTrendMonthKey = dateKey(startOfCalendarMonth(new Date()));
    const start = startOfCalendarMonth(dateFromKey(selectedTrendMonthKey));
    const currentStart = startOfCalendarMonth(new Date());
    if (start > currentStart) {
      selectedTrendMonthKey = dateKey(currentStart);
      return currentStart;
    }
    selectedTrendMonthKey = dateKey(start);
    return start;
  }

  function setSelectedTrendMonthStart(date) {
    const currentStart = startOfCalendarMonth(new Date());
    const next = startOfCalendarMonth(date);
    selectedTrendMonthKey = dateKey(next > currentStart ? currentStart : next);
    return selectedTrendMonthStart();
  }

  function selectedTrendRange() {
    const period = selectedTrendPeriod === "month" ? "month" : "week";
    if (period === "month") {
      const start = selectedTrendMonthStart();
      const end = addMonths(start, 1);
      const previousStart = addMonths(start, -1);
      const previousEnd = start;
      const currentStart = startOfCalendarMonth(new Date());
      const count = daysBetween(start, end);
      const days = Array.from({ length: count }, (_, index) => {
        const currentDate = addDays(start, index);
        const previousDate = addDays(previousStart, index);
        return {
          currentDate,
          previousDate: previousDate < previousEnd ? previousDate : null,
          label: String(currentDate.getDate()),
          shortLabel: String(currentDate.getDate()),
          dateLabel: weeklyDateLabel(currentDate),
          previousDateLabel: previousDate < previousEnd ? weeklyDateLabel(previousDate) : ""
        };
      });
      const isCurrent = dateKey(start) === dateKey(currentStart);
      return {
        period,
        start,
        end,
        previousStart,
        previousEnd,
        days,
        label: formatMonthRange(start),
        previousLabelText: formatMonthRange(previousStart),
        currentLabel: isCurrent ? "This month" : "Selected month",
        previousLabel: isCurrent ? "Last month" : "Previous month",
        periodLabel: "Selected month",
        axisLabel: "day/date",
        nextDisabled: start >= currentStart
      };
    }

    const start = selectedTrendWeekStart();
    const end = addDays(start, 7);
    const previousStart = addDays(start, -7);
    const previousEnd = start;
    const currentStart = startOfCalendarWeek(new Date());
    const days = weekDays(start).map((currentDate, index) => {
      const previousDate = addDays(previousStart, index);
      return {
        currentDate,
        previousDate,
        label: weeklyPointLabel(currentDate),
        shortLabel: weeklyPointLabel(currentDate),
        dateLabel: weeklyDateLabel(currentDate),
        previousDateLabel: weeklyDateLabel(previousDate)
      };
    });
    const isCurrent = dateKey(start) === dateKey(currentStart);
    return {
      period,
      start,
      end,
      previousStart,
      previousEnd,
      days,
      label: formatWeekRange(start),
      previousLabelText: formatWeekRange(previousStart),
      currentLabel: isCurrent ? "This week" : "Selected week",
      previousLabel: isCurrent ? "Last week" : "Previous week",
      periodLabel: "Selected week",
      axisLabel: "day/date",
      nextDisabled: start >= currentStart
    };
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
    if (minutes < 840) return `${minuteLabel(660)}-${minuteLabel(840)}`;
    if (minutes < 960) return `${minuteLabel(840)}-${minuteLabel(960)}`;
    if (minutes < 1080) return `${minuteLabel(960)}-${minuteLabel(1080)}`;
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

  function setQuickLogConfirmation(type = "fuel", date = new Date(), syncResult = null) {
    const label = type === "hydration"
      ? "Hydration logged"
      : type === "fuel_hydration"
        ? "Fuel + hydration logged"
        : type === SLEEPY_CHECKIN_TYPE
          ? "Sleepy logged"
        : "Fuel logged";
    const syncCopy = syncResult?.status === "synced"
      ? "Saved to cloud."
      : syncResult?.status === "error"
        ? "Saved here; cloud sync needs attention."
        : syncResult?.status === "pending"
          ? "Saved here; waiting to sync."
          : "Saving...";
    quickLogConfirmation = `${label} - ${formatClock(date)}. ${syncCopy}`;
    if (quickLogConfirmationTimer && typeof clearTimeout === "function") clearTimeout(quickLogConfirmationTimer);
    quickLogConfirmationTimer = typeof setTimeout === "function" ? setTimeout(() => {
      quickLogConfirmation = "";
      quickLogConfirmationTimer = 0;
      renderFuelGap();
    }, 3500) : 0;
  }

  function persistQuickLog(log, type, loggedAt) {
    const cloud = window.fuelGuardCloud;
    if (!cloud?.saveLog) {
      setQuickLogConfirmation(type, loggedAt, { status: "pending" });
      renderFuelGap();
      return Promise.resolve({ status: "pending", persisted: false, reason: "cloud_unavailable" });
    }
    return Promise.resolve(cloud.saveLog(log)).then(result => {
      setQuickLogConfirmation(type, loggedAt, result || { status: "error" });
      renderFuelGap();
      return result;
    }).catch(error => {
      setQuickLogConfirmation(type, loggedAt, { status: "error", error });
      renderFuelGap();
      return { status: "error", persisted: false, error };
    });
  }

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
    if (options.trainingMode) {
      const context = window.FuelGuardTrainingMode?.contextForEvent?.(normalizedType, loggedAt) || null;
      if (!context?.trainingModeSessionId) return Promise.resolve({ status: "error", persisted: false, reason: "training_mode_inactive" });
      Object.assign(log, context);
    }
    betaState().logs.push(log);
    if (includesFuel && !options.bypassCooldown) setCooldown();
    if (includesFuel) applyOpportunityMatchesForDay(key);
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
    setQuickLogConfirmation(normalizedType, loggedAt);
    save();
    renderAll();
    window.FuelGuardMilestones?.evaluate?.({ allowToast: true });
    return persistQuickLog(log, normalizedType, loggedAt);
  }

  recordFuelled = function recordFuelledBeta(options = {}) {
    recordRhythmLog("fuel", options);
  };

  function recordHydration() {
    recordRhythmLog("hydration", { source: "manual" });
  }

  window.recordTrainingModeEvent = function recordTrainingModeEvent(type) {
    return recordRhythmLog(type === "hydration" ? "hydration" : "fuel", {
      source: "manual",
      trainingMode: true
    });
  };

  function recordSleepy() {
    recordCheckinEvent({
      checkinType: SLEEPY_CHECKIN_TYPE,
      context: "general_day",
      arousalLevel: SLEEPY_CHECKIN_TYPE
    });
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
    if (button) button.textContent = open ? "Editing log" : "Edit log";
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
    const requestedType = document.getElementById("missedLogType")?.value || "fuel";
    const type = requestedType === "hydration" ? "hydration" : "fuel";
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
      note: displayNoteForLog(existing),
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key),
      updatedAt: new Date().toISOString(),
      syncStatus: "pending"
    });
    if (!existing) betaState().logs.push(log);
    if (type === "fuel") applyOpportunityMatchesForDay(key);
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
    const removedDate = logDate(removed);
    if (removedDate && isFuelLog(removed)) applyOpportunityMatchesForDay(dateKey(removedDate));
    refreshLogDatesAfterChange(logDate(removed), null);
    save();
    renderAll();
    await window.fuelGuardCloud?.deleteLog(removed);
  }

  function normalizedCheckinPayload(input = {}) {
    const now = new Date();
    const checkinType = String(input.checkinType || "energy").toLowerCase();
    const context = String(input.context || "general_day").toLowerCase();
    return {
      version: 1,
      checkinType,
      context,
      contextId: String(input.contextId || ""),
      energyLevel: String(input.energyLevel || "").toLowerCase(),
      concentrationLevel: String(input.concentrationLevel || "").toLowerCase(),
      hungerLevel: String(input.hungerLevel || "").toLowerCase(),
      fatigueLevel: String(input.fatigueLevel || "").toLowerCase(),
      arousalLevel: String(input.arousalLevel || "").toLowerCase(),
      breakTaken: String(input.breakTaken || "").toLowerCase(),
      fuelledDuringBreak: String(input.fuelledDuringBreak || "").toLowerCase(),
      recoveryFuelCompleted: String(input.recoveryFuelCompleted || "").toLowerCase(),
      note: String(input.note || "").trim().slice(0, 180),
      recordedAt: input.recordedAt || now.toISOString()
    };
  }

  function recordCheckinEvent(input = {}) {
    const payload = normalizedCheckinPayload(input);
    const loggedAt = logDate(payload.recordedAt) || new Date();
    const key = dateKey(loggedAt);
    const localId = uid();
    const log = {
      id: localId,
      localId,
      timestamp: loggedAt.toISOString(),
      eventTime: loggedAt.toISOString(),
      logged_at: loggedAt.toISOString(),
      label: checkinTypeLabel(payload),
      type: "checkin",
      logType: "checkin",
      entryMethod: "checkin",
      source: "manual",
      dayType: dayTypeForKey(key),
      trainingSession: trainingSessionForKey(key),
      checkin: payload,
      note: encodeCheckinNote(payload),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncStatus: "pending"
    };
    betaState().logs.push(log);
    storeArchive(key);
    state.completed.liveFuelStatus = true;
    if (typeof addActivityEntry === "function") {
      addActivityEntry("checkinLogged", `${checkinTypeLabel(payload)} saved.`, { dedupeDaily: false });
    }
    if (payload.checkinType === SLEEPY_CHECKIN_TYPE) setQuickLogConfirmation(SLEEPY_CHECKIN_TYPE, loggedAt);
    save();
    renderAll();
    return persistQuickLog(log, payload.checkinType === SLEEPY_CHECKIN_TYPE ? SLEEPY_CHECKIN_TYPE : "checkin", loggedAt);
  }

  window.recordCheckinEvent = recordCheckinEvent;

  function undoLatestRhythmLog() {
    const key = todayViewKey();
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
    if (latestType === "fuel" || latestType === "fuel_hydration") applyOpportunityMatchesForDay(key);
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
    // These controls are rendered inside the Today status card. They must not
    // inherit a stale History selection, otherwise clearing an override can
    // update a different day and leave the visible chip highlighted.
    const key = todayViewKey();
    const dayTypeSelect = document.getElementById("fuelDayType");
    const sessionSelect = document.getElementById("fuelTrainingSession");
    const dayType = dayTypeForKey(key);
    const session = trainingSessionForKey(key);
    if (dayTypeSelect && dayTypeSelect.value !== dayType) dayTypeSelect.value = dayType;
    if (sessionSelect && sessionSelect.value !== session) sessionSelect.value = session;
    const saved = document.getElementById("fuelDayTypeSaved");
    if (saved) {
      const dayText = dayType ? dayTypeLabel(dayType) : "Normal";
      saved.textContent = `Saved: ${dayText}.`;
    }
    document.querySelectorAll("[data-day-type-choice]").forEach(button => {
      const selected = String(button.dataset.dayTypeChoice || "") === dayType;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-checked", String(selected));
    });
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

  function renderCoachSharing() {
    const card = document.getElementById("coachSharingCard");
    if (!card) return;
    const cloud = window.fuelGuardCloud?.accountView?.() || null;
    const user = coachSharingUser();
    card.hidden = !cloud?.signedIn || !user?.id;
    if (card.hidden) return;

    const code = document.getElementById("coachAthleteCode");
    const copyButton = document.getElementById("coachCopyAthleteCodeButton");
    const shareButton = document.getElementById("coachShareAthleteCodeButton");
    const requests = document.getElementById("coachConnectionRequests");
    const list = document.getElementById("coachSharingList");
    const status = document.getElementById("coachSharingStatus");
    const athleteCode = coachSharingState.profile?.athlete_code || "";
    if (code) code.textContent = athleteCode || (coachSharingBusy ? "Loading..." : "Not ready");
    if (copyButton) copyButton.disabled = coachSharingBusy || !athleteCode;
    if (shareButton) shareButton.disabled = coachSharingBusy || !athleteCode;
    if (status) status.textContent = coachSharingBusy ? "Loading coach access..." : coachSharingState.status;

    if (!coachSharingState.loadedFor || coachSharingState.loadedFor !== user.id) {
      loadCoachSharingRelationships();
    }

    const relationshipCoachName = relationship => relationship.coach_label || `Coach ${String(relationship.coach_id || "").slice(0, 8)}`;
    const pendingRelationships = coachSharingState.relationships.filter(relationship => relationship.status === "pending");
    const connectedRelationships = coachSharingState.relationships.filter(relationship => relationship.status === "active");

    if (requests) {
      requests.innerHTML = pendingRelationships.length
        ? `<div class="beta-coach-sharing-items">
            ${pendingRelationships.map(relationship => `
              <article class="beta-coach-sharing-item pending">
                <div>
                  <strong>${safeText(relationshipCoachName(relationship))}</strong>
                  <small>wants to access your Fuel Guard timing data.</small>
                </div>
                <span>Pending</span>
                <div class="button-row beta-settings-actions">
                  <button class="secondary" type="button" data-approve-coach-sharing="${safeText(relationship.id)}">Approve</button>
                  <button class="secondary danger-secondary" type="button" data-decline-coach-sharing="${safeText(relationship.id)}">Decline</button>
                </div>
              </article>
            `).join("")}
          </div>
          <p class="muted">Approval shares fuel timing, hydration timing, Sleepy events, gap status, daily patterns, and review metrics derived from those events.</p>`
        : `<p class="muted">No coach connection requests right now.</p>`;
    }

    if (!list) return;
    list.innerHTML = connectedRelationships.length
      ? `<div class="beta-coach-sharing-items">
          ${connectedRelationships.map(relationship => `
            <article class="beta-coach-sharing-item active">
              <div>
                <strong>${safeText(relationshipCoachName(relationship))}</strong>
                <small>${safeText(relationship.accepted_at ? `Connected ${formatDateKey(dateKey(new Date(relationship.accepted_at)))}` : "Connected")}</small>
              </div>
              <span>Connected</span>
              <button class="secondary danger-secondary" type="button" data-revoke-coach-sharing="${safeText(relationship.id)}">Remove Coach</button>
            </article>
          `).join("")}
        </div>`
      : `<p class="muted">No coaches connected. Share your Athlete Code with a coach when you want to connect.</p>`;
  }

  function renderCoachNudges() {
    const card = document.getElementById("coachNudgeInbox");
    const list = document.getElementById("coachNudgeList");
    if (!card || !list) return;
    const user = coachSharingUser();
    const signedIn = Boolean(window.fuelGuardCloud?.accountView?.()?.signedIn && user?.id);
    if (!signedIn) {
      card.hidden = true;
      return;
    }
    if (coachSharingState.loadedFor !== user.id && !coachSharingBusy) loadCoachSharingRelationships();
    const relationshipByCoach = new Map(coachSharingState.relationships.map(relationship => [String(relationship.coach_id), relationship]));
    const nudges = coachSharingState.nudges || [];
    card.hidden = !nudges.length;
    if (card.hidden) return;
    list.innerHTML = nudges.slice(0, 3).map(nudge => {
      const relationship = relationshipByCoach.get(String(nudge.coach_id)) || {};
      const coachName = relationship.coach_label || "Your Fuel Guard coach";
      const sentAt = nudge.sent_at ? `${formatDateKey(dateKey(new Date(nudge.sent_at)))} · ${formatClock(new Date(nudge.sent_at))}` : "Recently";
      return `
        <article class="beta-coach-nudge-item">
          <strong>${safeText(nudge.message)}</strong>
          <span>${safeText(coachName)} · ${safeText(sentAt)}</span>
        </article>
      `;
    }).join("");
  }

  function renderSettings() {
    const buildInfo = window.FUEL_GUARD_BUILD || {};
    const canonical = document.getElementById("canonicalAppVersion");
    const buildMarker = document.getElementById("buildVersionMarker");
    const currentBuild = document.getElementById("appUpdateCurrentBuild");
    const updateStatus = document.getElementById("appUpdateStatus");
    const canonicalText = `Canonical app: ${buildInfo.canonicalApp || "mobile-pwa-v82-analysis-system"}`;
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
    renderAthleteProfile();
    renderCoachSharing();
    renderCsvImportPanel();
  }

  function renderAthleteProfile() {
    const card = document.getElementById("athleteProfileCard");
    const cloud = window.fuelGuardCloud?.accountView?.() || null;
    const user = coachSharingUser();
    const profile = coachSharingState.profile || {};
    if (card) card.hidden = !cloud?.signedIn;
    const fields = [
      ["athleteProfileFirstName", profile.first_name || ""],
      ["athleteProfileLastName", profile.last_name || ""],
      ["athleteProfileEmail", user?.email || cloud?.email || ""],
      ["athleteProfileAvatarUrl", profile.avatar_url || ""]
    ];
    fields.forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (input && document.activeElement !== input) input.value = value;
    });
    const saveButton = document.getElementById("athleteProfileSaveButton");
    if (saveButton) saveButton.disabled = athleteProfileBusy || !cloud?.signedIn;
    const status = document.getElementById("athleteProfileStatus");
    if (status) status.textContent = athleteProfileBusy ? "Saving profile…" : athleteProfileStatus;
  }

  async function saveAthleteProfile() {
    if (athleteProfileBusy) return;
    const client = coachSharingClient();
    const user = coachSharingUser();
    if (!client || !user?.id) {
      athleteProfileStatus = "Sign in before editing your profile.";
      renderAthleteProfile();
      return;
    }
    const firstName = document.getElementById("athleteProfileFirstName")?.value.trim() || "";
    const lastName = document.getElementById("athleteProfileLastName")?.value.trim() || "";
    const avatarUrl = document.getElementById("athleteProfileAvatarUrl")?.value.trim() || "";
    const displayName = [firstName, lastName].filter(Boolean).join(" ") || user.email || "Fuel Guard Athlete";
    athleteProfileBusy = true;
    athleteProfileStatus = "";
    renderAthleteProfile();
    try {
      const { data, error } = await client.from(COACH_PROFILES_TABLE)
        .upsert({
          user_id: user.id,
          role: coachSharingState.profile?.role || "athlete",
          coach_enabled: Boolean(coachSharingState.profile?.coach_enabled),
          display_name: displayName,
          first_name: firstName || null,
          last_name: lastName || null,
          avatar_url: avatarUrl || null,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })
        .select(coachProfileSelect())
        .single();
      if (error) throw error;
      coachSharingState.profile = data;
      athleteProfileStatus = "Profile saved.";
    } catch (error) {
      athleteProfileStatus = coachSharingSetupError(error)
        ? "Profile fields are waiting for the additive release migration."
        : `Profile could not be saved: ${error?.message || "unknown error"}`;
    } finally {
      athleteProfileBusy = false;
      renderAthleteProfile();
    }
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

  function timelineSourceLabel(log) {
    const trainingSessionId = String(log?.trainingModeSessionId || log?.training_mode_session_id || "");
    if (trainingSessionId) {
      const session = (betaState().trainingMode?.sessions || []).find(item => String(item.id) === trainingSessionId);
      return `Training · ${session?.title || "Session"}`;
    }
    const source = String(log?.source || log?.entryMethod || "manual").toLowerCase();
    if (!source || source === "manual" || source === "live") return "Manual";
    if (source === "csv_import" || source === "import" || source === "esp32") return "Imported";
    if (source === "garmin") return "Garmin";
    if (source === "hardware" || source === "bluetooth") return "Device";
    return source.replace(/[_-]+/g, " ").replace(/\b\w/g, char => char.toUpperCase());
  }

  function renderEventTimeline(logs = [], {
    emptyCopy = "No logs yet.",
    allowEditing = false,
    selectedId = "",
    showSource = true
  } = {}) {
    const normalizedLogs = (Array.isArray(logs) ? logs : [])
      .map(log => ({ ...log, date: logDate(log) }))
      .filter(log => log.date && (["fuel", "hydration", "fuel_hydration"].includes(logType(log)) || isSleepyLog(log)))
      .sort((a, b) => a.date - b.date);
    if (!normalizedLogs.length) {
      return `<p class="muted fuel-daily-empty">${safeText(emptyCopy)}</p>`;
    }
    return `
      <div class="beta-event-timeline" role="list">
        ${normalizedLogs.map(log => {
          const type = logType(log);
          const displayType = isSleepyLog(log) ? "sleepy" : type;
          const id = String(log?.id || log?.localId || log?.cloudId || "");
          const selected = allowEditing && id && selectedId === id;
          const iconType = isSleepyLog(log) ? "sleepy" : type === "hydration" ? "hydration" : "fuel";
          const canEdit = allowEditing && ["fuel", "hydration", "fuel_hydration"].includes(type);
          return `
            <article class="beta-event-timeline-item ${safeText(displayType)} ${selected ? "selected" : ""}" role="listitem">
              <button class="beta-event-timeline-main" type="button" data-toggle-log-actions="${safeText(id)}" aria-expanded="${selected ? "true" : "false"}">
                <time>${safeText(formatClock(log.date))}</time>
                <span class="beta-event-timeline-dot ${safeText(displayType)}" aria-hidden="true">${dailyIcon(iconType)}</span>
                <span class="beta-event-timeline-copy">
                  <strong>${safeText(logTypeLabel(log))}</strong>
                  <small>${showSource ? safeText(timelineSourceLabel(log)) : ""}</small>
                </span>
              </button>
              ${id && canEdit ? `<div class="beta-log-event-actions beta-event-timeline-actions" ${selected ? "" : "hidden"}><button class="secondary" type="button" data-edit-log="${safeText(id)}">Edit</button><button class="secondary danger-secondary" type="button" data-delete-log="${safeText(id)}">Delete</button></div>` : ""}
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderDailyLog() {
    const dateEl = document.getElementById("fuelDailyLogDate");
    const latestEl = document.getElementById("todayTimelineLatest");
    const target = document.getElementById("fuelDailyLog");
    if (!target) return;
    const key = todayViewKey();
    const logs = logsForDay(key)
      .filter(log => ["fuel", "hydration", "fuel_hydration"].includes(logType(log)) || isSleepyLog(log))
      .sort((a, b) => (logDate(b) || 0) - (logDate(a) || 0));
    const latest = logs[0] || null;
    if (dateEl) dateEl.textContent = logs.length ? `${logs.length} log${logs.length === 1 ? "" : "s"} on ${formatDateKey(key)}` : `No logs on ${formatDateKey(key)}`;
    if (latestEl) latestEl.textContent = latest ? `${logTypeLabel(latest)} · ${formatClock(logDate(latest))}` : "No logs yet";
    target.hidden = false;
    target.innerHTML = renderEventTimeline(logs, {
      emptyCopy: "No fuel, hydration, or sleepy logs yet today. Your first log will appear here.",
      allowEditing: false,
      selectedId: selectedTodayTimelineLogId
    });
  }

  function athleteTeamSessions() {
    return Array.isArray(window.fuelGuardCloud?.teamSessions) ? window.fuelGuardCloud.teamSessions : [];
  }

  function teamSessionDayLabel(session, now = new Date()) {
    const zone = session.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const currentKey = window.FuelGuardDomain?.dateKeyInTimeZone?.(now, zone) || todayKey(now);
    const sessionKey = session.session_date || window.FuelGuardDomain?.dateKeyInTimeZone?.(session.starts_at, zone) || "";
    if (sessionKey === currentKey) {
      const parts = window.FuelGuardDomain?.zonedDateParts?.(session.starts_at, zone);
      return Number(parts?.hour) >= 17 ? "Tonight" : "Today";
    }
    if (sessionKey === window.FuelGuardDomain?.shiftDateKey?.(currentKey, 1)) return "Tomorrow";
    return sessionKey ? formatDateKey(sessionKey) : "Upcoming";
  }

  function renderAthleteTeamSessionContext() {
    const target = document.getElementById("athleteTeamSessionContext");
    if (!target) return;
    const now = new Date();
    const session = athleteTeamSessions()
      .filter(item => item.status === "scheduled" && new Date(item.ends_at) >= now)
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))[0] || null;
    target.hidden = !session;
    if (!session) {
      target.innerHTML = "";
      return;
    }
    const zone = session.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    target.innerHTML = `
      <article class="beta-team-session-context">
        <div><span>${safeText(session.team_name || "Team session")}</span><strong>${safeText(teamSessionDayLabel(session, now))} · ${safeText(session.session_name || String(session.session_type || "Session").replace(/^./, value => value.toUpperCase()))}</strong></div>
        <time>${safeText(window.FuelGuardDomain?.formatClockInTimeZone?.(session.starts_at, zone) || formatClock(new Date(session.starts_at)))}–${safeText(window.FuelGuardDomain?.formatClockInTimeZone?.(session.ends_at, zone) || formatClock(new Date(session.ends_at)))}</time>
        ${session.location ? `<small>${safeText(session.location)}</small>` : ""}
      </article>
    `;
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
      sleepy: '<path d="M18 4a7.5 7.5 0 1 0 2 14.5A8.5 8.5 0 0 1 18 4z"/>',
      heart: '<path d="M5 6a5 5 0 0 1 7 0 5 5 0 0 1 7 0c2 2 2 5 0 7l-7 7-7-7c-2-2-2-5 0-7z"/>',
      score: '<path d="M4 14a8 8 0 0 1 16 0"/><path d="m12 14 4-5"/><path d="M6.5 18h11"/>',
      shield: '<path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3z"/><path d="m9 12 2 2 4-5"/>',
      clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
      chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 3-4 3 2 5-7"/>',
      recovery: '<path d="M4 13h4l2-5 4 9 2-4h4"/><path d="M5 6a5 5 0 0 1 7 0 5 5 0 0 1 7 0c2 2 2 5 0 7l-7 7-7-7c-2-2-2-5 0-7z"/>',
      route: '<path d="M5 7a2 2 0 1 0 0 .01"/><path d="M19 17a2 2 0 1 0 0 .01"/><path d="M7 7h4a3 3 0 0 1 0 6h2a3 3 0 0 1 0 6h4"/>',
      target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>',
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
    if (isSleepyLog(log)) return { className: "sleepy", label: "S" };
    if (type === "checkin") return { className: "checkin", label: "C" };
    if (type === "crash") return { className: "crash", label: "!" };
    if (type === "fuel_hydration") return { className: "combined", label: "F+H" };
    return { className: "fuel", label: "F" };
  }

  function stackedTimelineLogs(logs, { closeMinutes = 18, laneStep = 14, maxOffset = 22 } = {}) {
    const sorted = (Array.isArray(logs) ? logs : [])
      .filter(log => log?.date)
      .sort((a, b) => a.date - b.date);
    const clusters = [];
    sorted.forEach(log => {
      const minute = minutesIntoDay(log.date);
      const lastCluster = clusters[clusters.length - 1];
      const lastLog = lastCluster?.[lastCluster.length - 1];
      if (lastCluster && lastLog && Math.abs(minute - minutesIntoDay(lastLog.date)) <= closeMinutes) {
        lastCluster.push(log);
      } else {
        clusters.push([log]);
      }
    });
    return clusters.flatMap(cluster => cluster.map((log, index) => {
      const centeredIndex = index - (cluster.length - 1) / 2;
      const offset = clamp(centeredIndex * laneStep, -maxOffset, maxOffset);
      return { ...log, laneOffset: offset, closeCount: cluster.length };
    }));
  }

  function logMarkerTooltip(log) {
    return `${formatClock(log.date)} ${logTypeLabel(log)}`;
  }

  function renderDailyFuelLogTimeline(entry) {
    const fuelLogs = stackedTimelineLogs(entryLogsWithDates(entry).filter(isFuelLog), { closeMinutes: 20, laneStep: 14, maxOffset: 22 });
    if (!fuelLogs.length) return `<p class="muted beta-history-empty">No fuel logs for this day yet.</p>`;
    const markers = fuelLogs.map(log => {
      const left = (minutesIntoDay(log.date) / 1440) * 100;
      const tooltip = logMarkerTooltip(log);
      return `<span class="beta-fuel-time-marker" style="left:${stylePercent(left)};--lane-y:${Number(log.laneOffset || 0).toFixed(1)}px" title="${safeText(tooltip)}" data-tooltip="${safeText(tooltip)}" tabindex="0" aria-label="${safeText(tooltip)}"></span>`;
    }).join("");
    const times = fuelLogs.map(log => `<span>${safeText(formatClock(log.date))}</span>`).join("");
    return `
      <div class="beta-fuel-log-timeline" aria-label="Fuel log times across the selected day">
        <div class="beta-fuel-log-track">${markers}</div>
        <div class="beta-timeline-axis"><span>${safeText(minuteLabel(0))}</span><span>${safeText(minuteLabel(360))}</span><span>${safeText(minuteLabel(720))}</span><span>${safeText(minuteLabel(1080))}</span><span>${safeText(minuteLabel(1440))}</span></div>
        <div class="beta-fuel-log-times" aria-label="Exact fuel log times">${times}</div>
      </div>
    `;
  }

  function metricValueOrPending(value, fallback = "Not enough data yet") {
    if (value === null || value === undefined || value === "") return fallback;
    return safeText(value);
  }

  function dailyMetricTone(label, value, note = "") {
    const labelText = String(label || "").toLowerCase();
    const valueText = String(value || "").toLowerCase();
    const noteText = String(note || "").toLowerCase();
    const combined = `${labelText} ${valueText} ${noteText}`;
    if (/not enough|needs two|not started|waiting|no target|selected day complete/.test(combined)) return "neutral";
    if (labelText.includes("status")) {
      if (valueText.includes("recovery")) return "urgent";
      if (valueText.includes("eat now")) return "urgent";
      if (valueText.includes("eat soon")) return "warning";
      return "steady";
    }
    if (labelText.includes("hydration")) return "hydration";
    if (labelText.includes("low energy")) return "low-energy";
    if (labelText.includes("fuel") || labelText.includes("window") || labelText.includes("closes") || labelText.includes("time remaining")) return "fuel";
    if (labelText.includes("gap")) return "warning";
    return "neutral";
  }

  function dailyMetricCard(label, value, note = "", tone = "") {
    const cardTone = tone || dailyMetricTone(label, value, note);
    return `
      <article class="beta-daily-metric-card ${safeText(cardTone)}">
        <span>${safeText(label)}</span>
        <strong>${metricValueOrPending(value)}</strong>
        ${note ? `<small>${safeText(note)}</small>` : ""}
      </article>
    `;
  }

  function renderDailyMetricGroup(title, cards) {
    return `
      <section class="beta-daily-status-group">
        <h4>${safeText(title)}</h4>
        <div class="beta-daily-metric-grid">${cards.join("")}</div>
      </section>
    `;
  }


  function targetDifferenceText(actual, target) {
    if (!hasTarget(target)) return "No target set.";
    const difference = Math.round(actual - target);
    if (difference === 0) return "Right on target.";
    const label = Math.abs(difference) === 1 ? "log" : "logs";
    return difference > 0
      ? `${difference} ${label} above target.`
      : `${Math.abs(difference)} ${label} below target.`;
  }

  function targetProgressNote(label, actual, target, period = "target") {
    if (!hasTarget(target)) return `No ${period} ${label.toLowerCase()} target set.`;
    return `${label} target completed: ${targetPercent(actual, target)}%.`;
  }

  function renderTargetProgressCard(label, actual, target, tone = "fuel", period = "daily") {
    const percent = targetPercent(actual, target);
    const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
    const value = hasTarget(target) ? `${actual} of ${target}` : `${actual} log${actual === 1 ? "" : "s"}`;
    const note = hasTarget(target)
      ? targetProgressNote(label, actual, target, period)
      : `No ${period} ${label.toLowerCase()} target set.`;
    const fill = percent === null ? "" : `<i style="width:${stylePercent(width)}"></i>`;
    return `
      <article class="beta-target-progress-card ${safeText(tone)}">
        <div class="beta-target-progress-head">
          <span>${safeText(label)}</span>
          <strong>${safeText(value)}</strong>
        </div>
        <div class="beta-target-progress-bar" aria-hidden="true">${fill}</div>
        <small>${safeText(note)}</small>
      </article>
    `;
  }

  function renderDailyTargetProgress(fuelActual, hydrationActual, currentTargets = targets(), key = selectedDataDateKey()) {
    const dailyCard = (label, actual, target, tone) => {
      const lower = label.toLowerCase();
      const percent = targetPercent(actual, target);
      const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
      const value = hasTarget(target)
        ? `${actual} of ${target} ${lower} logs`
        : `${actual} ${lower} log${actual === 1 ? "" : "s"}`;
      const note = hasTarget(target)
        ? `${label} target completed: ${percent}%.`
        : `No daily ${lower} target set.`;
      const fill = percent === null ? "" : `<i style="width:${stylePercent(width)}"></i>`;
      return `
        <article class="beta-target-progress-card ${safeText(tone)}">
          <div class="beta-target-progress-head">
            <span>${safeText(label)}</span>
            <strong>${safeText(value)}</strong>
          </div>
          <div class="beta-target-progress-bar" aria-hidden="true">${fill}</div>
          <small>${safeText(note)}</small>
        </article>
      `;
    };
    return `
      <section class="beta-daily-targets-card" aria-label="Daily Targets">
        <div class="section-heading-row">
          <h3>Daily Targets</h3>
          <span class="row-note">${safeText(formatDateKey(key))}</span>
        </div>
        <div class="beta-target-progress-grid" aria-label="Daily target progress">
          ${dailyCard("Fuel", fuelActual, currentTargets.dailyFuelLogs, "fuel")}
          ${dailyCard("Hydration", hydrationActual, currentTargets.dailyHydrationLogs, "hydration")}
        </div>
      </section>
    `;
  }

  function addMinutesToDate(date, minutes) {
    const next = new Date(date);
    next.setMinutes(next.getMinutes() + Math.round(minutes));
    return next;
  }

  function displayTime(value) {
    return typeof formatTimeAmPm === "function" ? formatTimeAmPm(value) : formatClock(value);
  }

  function timeRangeText(start, end) {
    return `${displayTime(start)}-${displayTime(end)}`;
  }

  function minuteLabel(minutes) {
    const date = startOfDay();
    date.setMinutes(Math.round(clamp(Number(minutes || 0), 0, 1440)));
    return displayTime(date);
  }

  function hourRangeLabel(hour) {
    const start = clamp(Number(hour) || 0, 0, 23);
    return `${minuteLabel(start * 60)}-${minuteLabel((start + 1) * 60)}`;
  }

  function hourClockLabel(hour) {
    return minuteLabel(clamp(Number(hour) || 0, 0, 24) * 60);
  }

  function demandBlocks() {
    return betaState().demandBlocks;
  }

  function workBreaks() {
    return betaState().workBreaks;
  }

  function ensureEndAfterStart(start, end) {
    if (!start || !end) return end;
    const next = new Date(end);
    while (next <= start) next.setDate(next.getDate() + 1);
    return next;
  }

  function blockRange(block) {
    const start = logDate(block?.startTime);
    const rawEnd = logDate(block?.endTime);
    if (!start || !rawEnd) return null;
    return { start, end: ensureEndAfterStart(start, rawEnd) };
  }

  function dayBounds(key) {
    const start = startOfDay(dateFromKey(key));
    return { start, end: addDays(start, 1) };
  }

  function rangeOverlapsDay(range, key) {
    if (!range?.start || !range?.end) return false;
    const bounds = dayBounds(key);
    return range.start < bounds.end && range.end > bounds.start;
  }

  function demandBlocksForDay(key) {
    return demandBlocks()
      .filter(block => DEMAND_BLOCK_TYPES.has(String(block?.type || "")))
      .filter(block => block.date === key || rangeOverlapsDay(blockRange(block), key))
      .sort((a, b) => (blockRange(a)?.start?.getTime() || 0) - (blockRange(b)?.start?.getTime() || 0));
  }

  function workBreakRange(item, block = null) {
    const parent = block || demandBlocks().find(candidate => candidate.id === item?.demandBlockId);
    const parentRange = blockRange(parent);
    const start = logDate(item?.startTime);
    const rawEnd = logDate(item?.endTime);
    if (!start || !rawEnd) return null;
    let end = ensureEndAfterStart(start, rawEnd);
    if (parentRange && start < parentRange.start) {
      const shiftedStart = addDays(start, 1);
      const shiftedEnd = addDays(end, 1);
      if (shiftedStart <= parentRange.end) return { start: shiftedStart, end: ensureEndAfterStart(shiftedStart, shiftedEnd) };
    }
    if (parentRange && end < parentRange.start) end = addDays(end, 1);
    return { start, end };
  }

  function workBreaksForBlock(blockId) {
    return workBreaks()
      .filter(item => item.demandBlockId === blockId)
      .sort((a, b) => (workBreakRange(a)?.start?.getTime() || 0) - (workBreakRange(b)?.start?.getTime() || 0));
  }

  function trainingDemandLabel(block) {
    const type = TRAINING_DEMAND_LABELS[block?.sessionType] || "Training";
    const intensity = SESSION_INTENSITY_LABELS[block?.intensity] || "";
    return [block?.isKeySession ? "Key" : "", intensity, type].filter(Boolean).join(" ");
  }

  function demandBlockTitle(block) {
    if (!block) return "Plan item";
    if (block.title) return block.title;
    if (block.type === "training") return trainingDemandLabel(block);
    return block.shiftName || "Work shift";
  }

  function opportunityId(parts) {
    return deterministicImportUuid(`opportunity:${parts.filter(Boolean).join("|")}`);
  }

  function addOpportunity(list, opportunity) {
    if (!opportunity?.plannedStart || !opportunity?.plannedEnd) return;
    const start = logDate(opportunity.plannedStart);
    const end = logDate(opportunity.plannedEnd);
    if (!start || !end || end <= start) return;
    const id = opportunity.id || opportunityId([opportunity.date, opportunity.type, opportunity.demandBlockId || "normal", start.toISOString(), end.toISOString()]);
    list.push({
      ...opportunity,
      id,
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
      completedAt: "",
      matchedFuelLogId: "",
      timingScore: null,
      status: "upcoming",
      priority: Number(opportunity.priority || 1)
    });
  }

  function normalFuelPeriodForDay(key, fuelLogs = logsForDay(key).filter(isFuelLog)) {
    const firstFuel = fuelLogs[0]?.date || dateTimeFromInputs(key, "08:00") || startOfDay(dateFromKey(key));
    const start = new Date(firstFuel);
    const end = addMinutes(start, fuelWindowMinutes());
    return { start, end };
  }

  function generateNormalOpportunities(list, key, fuelLogs) {
    const period = normalFuelPeriodForDay(key, fuelLogs);
    const step = Math.max(60, mediumRiskLimit());
    for (let cursor = addMinutes(period.start, step); cursor < period.end; cursor = addMinutes(cursor, step)) {
      addOpportunity(list, {
        date: key,
        type: "normal",
        plannedStart: addMinutes(cursor, -OPPORTUNITY_RULES.normalWindowMinutes / 2).toISOString(),
        plannedEnd: addMinutes(cursor, OPPORTUNITY_RULES.normalWindowMinutes / 2).toISOString(),
        label: "Suggested fuel time",
        priority: 1
      });
    }
  }

  function generateTrainingOpportunities(list, block) {
    const range = blockRange(block);
    if (!range) return;
    const key = block.date || dateKey(range.start);
    const durationMinutes = (range.end - range.start) / 60000;
    const intensity = block.intensity || "easy";
    const isModerate = intensity === "moderate";
    const isDemanding = ["hard", "long"].includes(intensity) || block.isKeySession;
    addOpportunity(list, {
      date: key,
      type: "pre_training",
      demandBlockId: block.id,
      plannedStart: addMinutes(range.start, -OPPORTUNITY_RULES.preTraining.beforeStartMinutes).toISOString(),
      plannedEnd: addMinutes(range.start, -OPPORTUNITY_RULES.preTraining.closeBeforeStartMinutes).toISOString(),
      label: `Pre-training fuel for ${trainingDemandLabel(block).toLowerCase()}`,
      priority: block.isKeySession ? 8 : 6
    });
    if (isDemanding && durationMinutes >= OPPORTUNITY_RULES.duringTrainingMinimumMinutes) {
      const midpoint = addMinutes(range.start, durationMinutes / 2);
      addOpportunity(list, {
        date: key,
        type: "during_training",
        demandBlockId: block.id,
        plannedStart: addMinutes(midpoint, -25).toISOString(),
        plannedEnd: addMinutes(midpoint, 25).toISOString(),
        label: "During-training fuel",
        priority: block.isKeySession ? 8 : 7
      });
    }
    addOpportunity(list, {
      date: key,
      type: "post_training",
      demandBlockId: block.id,
      plannedStart: addMinutes(range.end, OPPORTUNITY_RULES.postTraining.afterStartMinutes).toISOString(),
      plannedEnd: addMinutes(range.end, OPPORTUNITY_RULES.postTraining.afterEndMinutes).toISOString(),
      label: "Post-training recovery fuel",
      priority: isDemanding || block.isKeySession ? 10 : 7
    });
    if (isModerate || isDemanding) {
      addOpportunity(list, {
        date: key,
        type: "follow_up_recovery",
        demandBlockId: block.id,
        plannedStart: addMinutes(range.end, OPPORTUNITY_RULES.followUpRecovery.afterStartMinutes).toISOString(),
        plannedEnd: addMinutes(range.end, OPPORTUNITY_RULES.followUpRecovery.afterEndMinutes).toISOString(),
        label: "Follow-up recovery fuel",
        priority: block.isKeySession ? 7 : 5
      });
    }
  }

  function generateWorkOpportunities(list, block) {
    const range = blockRange(block);
    if (!range) return;
    const key = block.date || dateKey(range.start);
    addOpportunity(list, {
      date: key,
      type: "pre_shift",
      demandBlockId: block.id,
      plannedStart: addMinutes(range.start, -OPPORTUNITY_RULES.preShift.beforeStartMinutes).toISOString(),
      plannedEnd: addMinutes(range.start, -OPPORTUNITY_RULES.preShift.closeBeforeStartMinutes).toISOString(),
      label: "Pre-shift fuel",
      priority: 5
    });
    workBreaksForBlock(block.id).forEach(item => {
      const breakRange = workBreakRange(item, block);
      if (!breakRange) return;
      addOpportunity(list, {
        date: key,
        type: "work_break",
        demandBlockId: block.id,
        plannedStart: breakRange.start.toISOString(),
        plannedEnd: breakRange.end.toISOString(),
        label: item.label || "Suggested break and fuel window",
        priority: 8
      });
    });
    addOpportunity(list, {
      date: key,
      type: "post_shift",
      demandBlockId: block.id,
      plannedStart: addMinutes(range.end, OPPORTUNITY_RULES.postShift.afterStartMinutes).toISOString(),
      plannedEnd: addMinutes(range.end, OPPORTUNITY_RULES.postShift.afterEndMinutes).toISOString(),
      label: "Post-shift recovery fuel",
      priority: 5
    });
  }

  function planRealismForKey(key) {
    const gap = betaState();
    if (!gap.planRealism || typeof gap.planRealism !== "object" || Array.isArray(gap.planRealism)) gap.planRealism = {};
    return gap.planRealism[key] || {};
  }

  function planRealismActionLabel(action) {
    return {
      move: "Move protected moment",
      widen: "Widen acceptable window",
      faster: "Add faster alternative",
      limited_access: "Mark food access limited",
      recalculate: "Recalculate rest of day"
    }[action] || "Keep plan visible";
  }

  function planRealismReasonLabel(reason) {
    return {
      work: "Work or meeting",
      commute: "Commute",
      training: "Training",
      access: "Limited food access",
      appetite: "Low appetite",
      social: "Social commitment",
      other: "Other"
    }[reason] || "No reason selected";
  }

  function setPlanRealismForKey(key, patch = {}) {
    const gap = betaState();
    gap.planRealism[key] = {
      ...planRealismForKey(key),
      ...patch,
      updatedAt: new Date().toISOString()
    };
    save();
  }

  function clearPlanRealismForKey(key) {
    const gap = betaState();
    delete gap.planRealism[key];
    save();
  }

  function shiftedOpportunity(opportunity, minutes) {
    const start = logDate(opportunity.plannedStart);
    const end = logDate(opportunity.plannedEnd);
    if (!start || !end) return opportunity;
    return {
      ...opportunity,
      plannedStart: addMinutes(start, minutes).toISOString(),
      plannedEnd: addMinutes(end, minutes).toISOString()
    };
  }

  function widenedOpportunity(opportunity, minutes) {
    const end = logDate(opportunity.plannedEnd);
    if (!end) return opportunity;
    return {
      ...opportunity,
      plannedEnd: addMinutes(end, minutes).toISOString()
    };
  }

  function applyPlanRealismAdjustments(key, opportunities) {
    const realism = planRealismForKey(key);
    if (!["mostly", "no"].includes(String(realism.response || ""))) return opportunities;
    const sorted = [...opportunities].sort((a, b) => (logDate(a.plannedStart) || 0) - (logDate(b.plannedStart) || 0));
    const fallback = sorted.find(item => !item.completedAt) || sorted[0];
    const targetId = String(realism.opportunityId || fallback?.id || "");
    const target = opportunities.find(item => String(item.id) === targetId) || fallback;
    const targetStart = logDate(target?.plannedStart);
    const action = String(realism.action || "move");
    const moveMinutes = Number.isFinite(Number(realism.moveMinutes)) ? Number(realism.moveMinutes) : 45;

    return opportunities.map(item => {
      const isTarget = String(item.id) === targetId;
      const start = logDate(item.plannedStart);
      const affectsRest = action === "recalculate" && targetStart && start && start >= targetStart;
      let next = { ...item };
      if (isTarget && (action === "move" || action === "recalculate")) next = shiftedOpportunity(next, moveMinutes);
      if (isTarget && action === "widen") next = widenedOpportunity(next, 30);
      if (affectsRest && !isTarget) next = shiftedOpportunity(next, Math.round(moveMinutes / 2));
      if (isTarget) {
        next.adjustmentNote = action === "faster"
          ? "Faster fuel option marked for this moment."
          : action === "limited_access"
            ? "Food access limited for this moment."
            : `${planRealismActionLabel(action)} applied.`;
        next.adjustmentReason = planRealismReasonLabel(realism.reason);
      }
      return next;
    });
  }

  function generateFuelOpportunitiesForDay(key, { now = new Date(), includeNormal = true } = {}) {
    const list = [];
    const fuelLogs = logsForDay(key).filter(isFuelLog);
    if (includeNormal) generateNormalOpportunities(list, key, fuelLogs);
    demandBlocksForDay(key).forEach(block => {
      if (block.type === "training") generateTrainingOpportunities(list, block);
      if (block.type === "work") generateWorkOpportunities(list, block);
    });
    const adjustedList = applyPlanRealismAdjustments(key, list);
    return matchFuelLogsToOpportunities(adjustedList, fuelLogs, now).sort((a, b) => {
      const startDiff = logDate(a.plannedStart) - logDate(b.plannedStart);
      return startDiff || b.priority - a.priority;
    });
  }

  function minutesOutsideWindow(date, start, end) {
    if (!date || !start || !end) return Infinity;
    if (date >= start && date <= end) return 0;
    return Math.min(Math.abs((date - start) / 60000), Math.abs((date - end) / 60000));
  }

  function calculateOpportunityTimingScore(completedAt, plannedStart, plannedEnd) {
    const completed = logDate(completedAt);
    const start = logDate(plannedStart);
    const end = logDate(plannedEnd);
    if (!completed || !start || !end) return 0;
    const distance = minutesOutsideWindow(completed, start, end);
    if (distance <= 0) return 100;
    if (distance <= 30) return 75;
    if (distance <= 60) return 50;
    if (distance <= 120) return 25;
    return 0;
  }

  function opportunityStatus(opportunity, now = new Date()) {
    const completed = logDate(opportunity.completedAt);
    const start = logDate(opportunity.plannedStart);
    const end = logDate(opportunity.plannedEnd);
    if (completed) return completed >= start && completed <= end ? "completed_on_time" : "completed_late";
    if (!start || !end) return "upcoming";
    if (now > addMinutes(end, OPPORTUNITY_RULES.missedAfterMinutes)) return "missed";
    if (now > end) return "overdue";
    if ((start - now) / 60000 <= OPPORTUNITY_RULES.dueSoonMinutes) return "due_soon";
    return "upcoming";
  }

  function matchFuelLogsToOpportunities(opportunities, fuelLogs, now = new Date()) {
    const matches = new Map();
    const usedLogs = new Set();
    const sortedOpps = [...opportunities].sort((a, b) => b.priority - a.priority || (logDate(a.plannedStart) - logDate(b.plannedStart)));
    sortedOpps.forEach(opportunity => {
      const start = logDate(opportunity.plannedStart);
      const end = logDate(opportunity.plannedEnd);
      const candidates = fuelLogs
        .filter(log => log.date && !usedLogs.has(log.id || log.localId || log.cloudId))
        .map(log => ({
          log,
          distance: minutesOutsideWindow(log.date, start, end),
          inside: log.date >= start && log.date <= end
        }))
        .filter(candidate => candidate.inside || candidate.distance <= OPPORTUNITY_RULES.nearestMatchToleranceMinutes)
        .sort((a, b) => Number(b.inside) - Number(a.inside) || a.distance - b.distance);
      const match = candidates[0]?.log;
      if (!match) return;
      const logId = match.id || match.localId || match.cloudId;
      usedLogs.add(logId);
      matches.set(opportunity.id, match);
    });
    return opportunities.map(opportunity => {
      const match = matches.get(opportunity.id);
      const completedAt = match?.date?.toISOString() || "";
      const next = {
        ...opportunity,
        completedAt,
        matchedFuelLogId: match ? String(match.id || match.localId || match.cloudId || "") : "",
        timingScore: completedAt ? calculateOpportunityTimingScore(completedAt, opportunity.plannedStart, opportunity.plannedEnd) : 0
      };
      next.status = opportunityStatus(next, now);
      return next;
    });
  }

  function applyOpportunityMatchesForDay(key) {
    const opportunities = generateFuelOpportunitiesForDay(key);
    const matchByLogId = new Map(opportunities.filter(item => item.matchedFuelLogId).map(item => [item.matchedFuelLogId, item.id]));
    betaState().logs.forEach(log => {
      const logId = String(log.id || log.localId || log.cloudId || "");
      const date = logDate(log);
      if (!date || dateKey(date) !== key || !isFuelLog(log)) return;
      const matchedId = matchByLogId.get(logId) || "";
      if (matchedId) log.matchedOpportunityId = matchedId;
      else delete log.matchedOpportunityId;
    });
    return opportunities;
  }

  function opportunityTypeGroup(type) {
    if (["pre_training", "during_training", "post_training", "follow_up_recovery"].includes(type)) return "training";
    if (["pre_shift", "work_break", "post_shift"].includes(type)) return "work";
    return "normal";
  }

  function activeOpportunities(opportunities) {
    return opportunities.filter(item => item.status !== "upcoming" || logDate(item.plannedStart) <= new Date());
  }

  function weightedOpportunityAverage(opportunities) {
    const scored = opportunities.filter(item => ["completed_on_time", "completed_late", "missed", "overdue"].includes(item.status));
    const totalWeight = scored.reduce((sum, item) => sum + Number(FUEL_OPPORTUNITY_WEIGHTS[item.type] || 1), 0);
    if (!scored.length || totalWeight <= 0) return null;
    return scored.reduce((sum, item) => sum + Number(item.timingScore || 0) * Number(FUEL_OPPORTUNITY_WEIGHTS[item.type] || 1), 0) / totalWeight;
  }

  function calculateGapScore(actualGapMinutes, targetGapMinutes) {
    if (!Number.isFinite(actualGapMinutes) || !Number.isFinite(targetGapMinutes) || targetGapMinutes <= 0) return null;
    if (actualGapMinutes <= targetGapMinutes) return 100;
    if (actualGapMinutes >= targetGapMinutes * 2) return 0;
    const excess = (actualGapMinutes - targetGapMinutes) / targetGapMinutes;
    return Math.round(100 * (1 - excess));
  }

  function fuelScoreLabel(score) {
    if (!Number.isFinite(score)) return "Not enough data";
    if (score >= 90) return "Strong adherence";
    if (score >= 75) return "Mostly on track";
    if (score >= 60) return "Inconsistent";
    if (score >= 40) return "Frequently off-plan";
    return "Significant fuelling drift";
  }

  function calculateDailyFuelScore(key, { now = new Date() } = {}) {
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const trainingScore = weightedOpportunityAverage(opportunities.filter(item => opportunityTypeGroup(item.type) === "training"));
    const workScore = weightedOpportunityAverage(opportunities.filter(item => opportunityTypeGroup(item.type) === "work"));
    const fuelLogs = logsForDay(key).filter(isFuelLog);
    const period = normalFuelPeriodForDay(key, fuelLogs);
    const eligibleGaps = gapsFromFuelLogs(fuelLogs)
      .filter(gap => gap.end >= period.start && gap.start <= period.end)
      .map(gap => calculateGapScore(awakeGapMinutes(gap), mediumRiskLimit()))
      .filter(Number.isFinite);
    const gapScore = eligibleGaps.length ? averageValue(eligibleGaps) : null;
    const target = targets().dailyFuelLogs;
    const targetScore = hasTarget(target) ? Math.min(100, (fuelLogs.length / target) * 100) : null;
    const components = [
      { id: "training_adherence", label: "Training timing", score: trainingScore, weight: FUEL_SCORE_WEIGHTS.training_adherence },
      { id: "work_adherence", label: "Work-shift timing", score: workScore, weight: FUEL_SCORE_WEIGHTS.work_adherence },
      { id: "gap_adherence", label: "Fuel-gap adherence", score: gapScore, weight: FUEL_SCORE_WEIGHTS.gap_adherence },
      { id: "target_completion", label: "Daily target completion", score: targetScore, weight: FUEL_SCORE_WEIGHTS.target_completion }
    ].filter(component => Number.isFinite(component.score));
    const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
    const finalScore = totalWeight > 0
      ? Math.round(components.reduce((sum, component) => sum + component.score * (component.weight / totalWeight), 0))
      : null;
    return {
      date: key,
      finalScore,
      label: fuelScoreLabel(finalScore),
      components: components.map(component => ({ ...component, score: Math.round(component.score), normalizedWeight: Math.round((component.weight / totalWeight) * 100) || 0 })),
      opportunities
    };
  }

  function fuelScoreForEntry(entry) {
    return calculateDailyFuelScore(entry?.date || selectedDataDateKey()).finalScore;
  }

  function opportunityStatusLabel(status) {
    return {
      upcoming: "Upcoming",
      due_soon: "Due soon",
      completed_on_time: "Completed on time",
      completed_late: "Completed late",
      overdue: "Overdue",
      missed: "Missed"
    }[status] || "Upcoming";
  }

  function opportunityTone(status) {
    if (status === "completed_on_time") return "protected";
    if (status === "completed_late" || status === "due_soon") return "neutral";
    if (status === "overdue" || status === "missed") return "elevated";
    return "stable";
  }

  function nextFuelOpportunity(opportunities, now = new Date()) {
    const candidates = opportunities.filter(item => !item.completedAt && item.status !== "missed");
    if (!candidates.length) return null;
    return candidates.sort((a, b) => {
      const aOverdue = a.status === "overdue" ? 1 : 0;
      const bOverdue = b.status === "overdue" ? 1 : 0;
      return bOverdue - aOverdue
        || b.priority - a.priority
        || Math.abs(logDate(a.plannedStart) - now) - Math.abs(logDate(b.plannedStart) - now);
    })[0] || null;
  }

  function opportunityCountdown(opportunity, now = new Date()) {
    const start = logDate(opportunity?.plannedStart);
    const end = logDate(opportunity?.plannedEnd);
    if (!start || !end) return "";
    if (opportunity.status === "overdue") return `${fuelDebtDurationText((now - end) / 60000)} overdue`;
    if (opportunity.status === "due_soon") return `${fuelDebtDurationText((start - now) / 60000)} until window opens`;
    if (opportunity.status === "upcoming") return `${fuelDebtDurationText((start - now) / 60000)} away`;
    return opportunityStatusLabel(opportunity.status);
  }

  function opportunityPlanCopy(opportunity) {
    if (!opportunity) return "No more fuel suggestions today.";
    if (opportunity.type === "work_break") return "Fuel, hydrate and step away from work if you can.";
    if (opportunity.type === "post_training") return "Supporting recovery from your training session.";
    if (opportunity.type === "pre_training") return "A small fuel moment before training can help the session feel steadier.";
    if (opportunity.type === "post_shift") return "Support your post-shift recovery window.";
    if (opportunity.type === "pre_shift") return "Support your shift before the long block starts.";
    return "Suggested fuel time based on your fuelling window.";
  }

  function selectedDemandEditBlock() {
    return demandPlannerEditingId ? demandBlocks().find(block => block.id === demandPlannerEditingId) || null : null;
  }

  function dateTimeForDemand(dateValue, timeValue, previous = null) {
    const date = dateTimeFromInputs(dateValue, timeValue);
    if (!date) return null;
    return previous ? ensureEndAfterStart(previous, date) : date;
  }

  function demandInputValue(block, key, fallback = "") {
    return block && Object.prototype.hasOwnProperty.call(block, key) ? block[key] : fallback;
  }

  function todayTrainingDemandType(key) {
    const existing = selectedDemandEditBlock()?.type === "training" ? selectedDemandEditBlock() : null;
    const session = trainingSessionForKey(key) || existing?.sessionType || "";
    if (!session || session === "rest") return "";
    return TRAINING_DEMAND_LABELS[session] ? session : "other";
  }

  function syncDayTypeFromDemand(block) {
    if (!block?.date) return;
    if (block.type === "work" && !dayTypeForKey(block.date)) setDayType(block.date, "work");
    if (block.type === "training" && block.sessionType && !trainingSessionForKey(block.date)) setTrainingSession(block.date, block.sessionType === "triathlon" || block.sessionType === "sport" || block.sessionType === "other" ? "" : block.sessionType);
  }

  function markDemandPlanningDirty() {
    const gap = betaState();
    gap.demandBlocks.forEach(block => {
      if (!block.syncStatus) block.syncStatus = "pending";
    });
    gap.workBreaks.forEach(item => {
      if (!item.syncStatus) item.syncStatus = "pending";
    });
  }

  async function persistDemandPlanning(message = "Demand plan saved.") {
    const key = selectedDataDateKey();
    applyOpportunityMatchesForDay(key);
    storeArchive(key);
    demandPlannerStatus = message;
    save();
    renderAll();
    try {
      await window.fuelGuardCloud?.saveDemandPlanning?.();
    } catch (error) {
      demandPlannerStatus = `Saved locally. Cloud demand planning sync will retry: ${error?.message || "unknown error"}`;
      renderDemandPlanner();
    }
  }

  function readTrainingDemandForm() {
    const key = selectedDataDateKey();
    const start = dateTimeForDemand(key, document.getElementById("trainingStartTime")?.value || "");
    const end = dateTimeForDemand(key, document.getElementById("trainingEndTime")?.value || "", start);
    if (!start || !end) throw new Error("Choose a valid training start and finish time.");
    const sessionType = todayTrainingDemandType(key);
    if (!sessionType) throw new Error("Choose a training session before saving training times.");
    return {
      type: "training",
      date: key,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      sessionType,
      intensity: document.getElementById("trainingIntensity")?.value || "easy",
      isKeySession: Boolean(document.getElementById("trainingKeySession")?.checked),
      title: "",
      notes: String(document.getElementById("trainingDemandNotes")?.value || "").trim()
    };
  }

  function hoursFieldValue(id, fallback, { min = 0.5, max = 12 } = {}) {
    const value = Number(document.getElementById(id)?.value);
    if (!Number.isFinite(value)) return fallback;
    return clamp(value, min, max);
  }

  function intervalFieldValue(id, fallback) {
    const value = Number(document.getElementById(id)?.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function workBreakPreferencesFromBlock(block) {
    const range = blockRange(block);
    const existing = block?.type === "work" ? workBreaksForBlock(block.id) : [];
    const firstRange = existing.length ? workBreakRange(existing[0], block) : null;
    const secondRange = existing.length > 1 ? workBreakRange(existing[1], block) : null;
    const firstAfterMinutes = Number.isFinite(Number(block?.firstBreakAfterMinutes))
      ? Number(block.firstBreakAfterMinutes)
      : firstRange && range
        ? clamp(Math.round((firstRange.start - range.start) / 60000), 30, 720)
        : 120;
    const intervalMinutes = Number.isFinite(Number(block?.breakIntervalMinutes))
      ? Number(block.breakIntervalMinutes)
      : firstRange && secondRange
        ? clamp(Math.round((secondRange.start - firstRange.start) / 60000), 60, 480)
        : 150;
    const breaksVary = Boolean(block?.breaksVary || existing.some(item => /vary|flexible/i.test(item.label || "")));
    return { firstAfterMinutes, intervalMinutes, breaksVary };
  }

  function windowOverlaps(start, end, range) {
    return Boolean(start && end && range?.start && range?.end && start < range.end && end > range.start);
  }

  function trainingRangesForDay(key) {
    return demandBlocksForDay(key)
      .filter(block => block.type === "training")
      .map(block => blockRange(block))
      .filter(Boolean);
  }

  function avoidTrainingOverlap(start, end, shiftEnd, trainingRanges) {
    let nextStart = start;
    let nextEnd = end;
    trainingRanges.forEach(range => {
      if (!windowOverlaps(nextStart, nextEnd, range)) return;
      nextStart = addMinutes(range.end, 15);
      nextEnd = addMinutes(nextStart, 30);
    });
    return nextEnd <= shiftEnd ? { start: nextStart, end: nextEnd } : null;
  }

  function generateFlexibleWorkBreakRows(blockId, shiftStart, shiftEnd, key, preferences) {
    const rows = [];
    const trainingRanges = trainingRangesForDay(key);
    const shiftMinutes = Math.max(0, (shiftEnd - shiftStart) / 60000);
    if (shiftMinutes < 210) return rows;
    const firstAfter = clamp(Number(preferences.firstAfterMinutes || 120), 60, Math.max(90, shiftMinutes - 60));
    const interval = clamp(Number(preferences.breakIntervalMinutes || 150), 90, 360);
    const labelPrefix = preferences.breaksVary ? "Flexible break and fuel window" : "Suggested break and fuel window";
    let cursor = addMinutes(shiftStart, firstAfter);
    let index = 1;
    while (cursor < addMinutes(shiftEnd, -30) && index <= 6) {
      const candidate = avoidTrainingOverlap(cursor, addMinutes(cursor, 30), shiftEnd, trainingRanges);
      if (candidate) {
        const label = rows.length ? `${labelPrefix} ${rows.length + 1}` : labelPrefix;
        const detail = preferences.breaksVary ? "Breaks vary" : "Estimate";
        rows.push({
          id: uid(),
          demandBlockId: blockId,
          startTime: candidate.start.toISOString(),
          endTime: candidate.end.toISOString(),
          label: `${label} (${detail})`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          syncStatus: "pending"
        });
      }
      cursor = addMinutes(cursor, interval);
      index += 1;
    }
    return rows;
  }

  function readWorkBreakRows(blockId, shiftStart, shiftEnd, key) {
    const firstAfterHours = hoursFieldValue("workFirstBreakAfterHours", 2, { min: 0.5, max: 8 });
    const intervalMinutes = intervalFieldValue("workBreakIntervalMinutes", 150);
    const breaksVary = Boolean(document.getElementById("workBreaksVary")?.checked);
    const preferences = {
      firstBreakAfterMinutes: Math.round(firstAfterHours * 60),
      breakIntervalMinutes: Math.round(intervalMinutes),
      breaksVary
    };
    return generateFlexibleWorkBreakRows(blockId, shiftStart, shiftEnd, key, preferences);
  }

  function readWorkDemandForm(blockId) {
    const key = selectedDataDateKey();
    const start = dateTimeForDemand(key, document.getElementById("workShiftStartTime")?.value || "");
    const end = dateTimeForDemand(key, document.getElementById("workShiftEndTime")?.value || "", start);
    if (!start || !end) throw new Error("Choose a valid shift start and finish time.");
    const firstAfterHours = hoursFieldValue("workFirstBreakAfterHours", 2, { min: 0.5, max: 8 });
    const intervalMinutes = intervalFieldValue("workBreakIntervalMinutes", 150);
    const breaksVary = Boolean(document.getElementById("workBreaksVary")?.checked);
    return {
      block: {
        type: "work",
        date: key,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        title: String(document.getElementById("workShiftName")?.value || "").trim(),
        shiftName: String(document.getElementById("workShiftName")?.value || "").trim(),
        notes: String(document.getElementById("workDemandNotes")?.value || "").trim(),
        firstBreakAfterMinutes: Math.round(firstAfterHours * 60),
        breakIntervalMinutes: Math.round(intervalMinutes),
        breaksVary
      },
      breaks: readWorkBreakRows(blockId, start, end, key)
    };
  }

  async function saveTrainingDemand() {
    try {
      const gap = betaState();
      const existing = selectedDemandEditBlock()?.type === "training" ? selectedDemandEditBlock() : null;
      const now = new Date().toISOString();
      const next = {
        ...(existing || {}),
        ...readTrainingDemandForm(),
        id: existing?.id || uid(),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        syncStatus: "pending"
      };
      if (existing) Object.assign(existing, next);
      else gap.demandBlocks.push(next);
      gap.workBreaks = gap.workBreaks.filter(item => item.demandBlockId !== next.id);
      syncDayTypeFromDemand(next);
      demandPlannerEditingId = "";
      await persistDemandPlanning("Training session saved. Fuel suggestions updated.");
    } catch (error) {
      demandPlannerStatus = error?.message || "Training session could not be saved.";
      renderDemandPlanner();
    }
  }

  async function saveWorkDemand() {
    try {
      const gap = betaState();
      const existing = selectedDemandEditBlock()?.type === "work" ? selectedDemandEditBlock() : null;
      const blockId = existing?.id || uid();
      const form = readWorkDemandForm(blockId);
      const now = new Date().toISOString();
      const next = {
        ...(existing || {}),
        ...form.block,
        id: blockId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        syncStatus: "pending"
      };
      if (existing) Object.assign(existing, next);
      else gap.demandBlocks.push(next);
      const oldBreaks = gap.workBreaks.filter(item => item.demandBlockId === blockId);
      oldBreaks.forEach(item => {
        if (item.cloudId || item.id) gap.cloud.pendingWorkBreakDeleteIds.push(item.cloudId || item.id);
      });
      gap.workBreaks = gap.workBreaks.filter(item => item.demandBlockId !== blockId).concat(form.breaks);
      syncDayTypeFromDemand(next);
      demandPlannerEditingId = "";
      await persistDemandPlanning("Work shift saved. Break and fuel windows updated.");
    } catch (error) {
      demandPlannerStatus = error?.message || "Work shift could not be saved.";
      renderDemandPlanner();
    }
  }

  async function deleteDemandBlock(id) {
    const gap = betaState();
    const block = gap.demandBlocks.find(item => item.id === id || item.cloudId === id);
    if (!block) return;
    if (!window.confirm("Delete this plan item?")) return;
    gap.demandBlocks = gap.demandBlocks.filter(item => item !== block);
    if (block.cloudId || block.id) gap.cloud.pendingDemandDeleteIds.push(block.cloudId || block.id);
    const removedBreaks = gap.workBreaks.filter(item => item.demandBlockId === block.id);
    removedBreaks.forEach(item => {
      if (item.cloudId || item.id) gap.cloud.pendingWorkBreakDeleteIds.push(item.cloudId || item.id);
    });
    gap.workBreaks = gap.workBreaks.filter(item => item.demandBlockId !== block.id);
    if (demandPlannerEditingId === block.id) demandPlannerEditingId = "";
    await persistDemandPlanning("Plan item deleted. Fuel suggestions updated.");
  }

  function renderDemandBlockCard(block) {
    const range = blockRange(block);
    const breaks = block.type === "work" ? workBreaksForBlock(block.id) : [];
    return `
      <article class="beta-demand-block-card ${safeText(block.type)}">
        <div>
          <strong>${safeText(demandBlockTitle(block))}</strong>
          <span>${safeText(range ? timeRangeText(range.start, range.end) : "Time not set")}</span>
          ${block.type === "training" ? `<small>${safeText(`${SESSION_INTENSITY_LABELS[block.intensity] || "Easy"}${block.isKeySession ? " · Key session" : ""}`)}</small>` : ""}
          ${block.type === "work" && breaks.length ? `<small>${safeText(`${breaks.length} suggested fuel window${breaks.length === 1 ? "" : "s"}`)}</small>` : ""}
        </div>
        <div class="button-row beta-demand-actions">
          <button class="secondary" type="button" data-edit-demand="${safeText(block.id)}">Edit</button>
          <button class="secondary danger-secondary" type="button" data-delete-demand="${safeText(block.id)}">Delete</button>
        </div>
      </article>
    `;
  }

  function renderDemandBlockList(blocks, emptyCopy) {
    return blocks.length
      ? blocks.map(renderDemandBlockCard).join("")
      : `<p class="muted beta-history-empty">${safeText(emptyCopy)}</p>`;
  }

  function renderTodayPlanningFields(key, blocks, trainingEditing, workEditing, editingRange) {
    const trainingRange = trainingEditing ? editingRange : null;
    const workRange = workEditing ? editingRange : null;
    const prefs = workBreakPreferencesFromBlock(workEditing);
    const trainingSession = trainingSessionForKey(key);
    const trainingCopy = trainingSession && trainingSession !== "rest"
      ? `${trainingSessionLabel(trainingSession)} uses the session selector above.`
      : "Choose a training session above before saving training times.";
    return `
      <div class="beta-today-planning-fields">
        <div class="beta-demand-existing beta-today-plan-existing">
          <div>
            <h4>Saved plan items</h4>
            ${renderDemandBlockList(blocks, "No work or training planned for this day yet.")}
          </div>
        </div>

        <div class="beta-demand-form beta-today-training-form">
          <h4>${trainingEditing ? "Edit training details" : "Training details"}</h4>
          <p class="row-note">${safeText(trainingCopy)}</p>
          <div class="form-grid beta-settings-grid beta-responsive-form-grid">
            <label>Training starts<input id="trainingStartTime" type="time" value="${safeText(trainingEditing && trainingRange ? timeInputValue(trainingRange.start) : "")}"></label>
            <label>Training finishes<input id="trainingEndTime" type="time" value="${safeText(trainingEditing && trainingRange ? timeInputValue(trainingRange.end) : "")}"></label>
            <label>Intensity<select id="trainingIntensity">${SESSION_INTENSITY_OPTIONS.map(option => `<option value="${safeText(option.value)}" ${demandInputValue(trainingEditing, "intensity", "easy") === option.value ? "selected" : ""}>${safeText(option.label)}</option>`).join("")}</select></label>
            <label class="beta-checkbox-label"><input id="trainingKeySession" type="checkbox" ${trainingEditing?.isKeySession ? "checked" : ""}> Key session</label>
            <label>Training notes<input id="trainingDemandNotes" type="text" value="${safeText(trainingEditing?.notes || "")}" placeholder="Optional"></label>
          </div>
          <div class="button-row beta-settings-actions">
            <button id="saveTrainingDemandButton" class="primary" type="button">${trainingEditing ? "Save training" : "Save training plan"}</button>
            ${trainingEditing ? `<button id="cancelDemandEditButton" class="secondary" type="button">Cancel edit</button>` : ""}
          </div>
        </div>

        <div class="beta-demand-form beta-today-work-form">
          <h4>${workEditing ? "Edit work shift and breaks" : "Work shift and breaks"}</h4>
          <div class="form-grid beta-settings-grid beta-responsive-form-grid">
            <label>Shift starts<input id="workShiftStartTime" type="time" value="${safeText(workEditing && workRange ? timeInputValue(workRange.start) : "")}"></label>
            <label>Shift finishes<input id="workShiftEndTime" type="time" value="${safeText(workEditing && workRange ? timeInputValue(workRange.end) : "")}"></label>
            <label>First planned break after<input id="workFirstBreakAfterHours" type="number" min="0.5" max="8" step="0.5" inputmode="decimal" value="${safeText(hoursValue(prefs.firstAfterMinutes || 120))}"></label>
            <label>Plan a break every<select id="workBreakIntervalMinutes">${WORK_BREAK_INTERVAL_OPTIONS.map(option => `<option value="${safeText(option.value)}" ${String(prefs.breakIntervalMinutes || 150) === option.value ? "selected" : ""}>${safeText(option.label)}</option>`).join("")}</select></label>
            <label>Shift name<input id="workShiftName" type="text" value="${safeText(workEditing?.title || workEditing?.shiftName || "")}" placeholder="Optional"></label>
            <label>Break notes<input id="workDemandNotes" type="text" value="${safeText(workEditing?.notes || "")}" placeholder="Optional"></label>
            <label class="beta-checkbox-label beta-breaks-vary"><input id="workBreaksVary" type="checkbox" ${prefs.breaksVary ? "checked" : ""}> Breaks vary</label>
          </div>
          <p class="row-note">Fuel Guard turns these break details into flexible suggested fuel windows.</p>
          <div class="button-row beta-settings-actions">
            <button id="saveWorkDemandButton" class="primary" type="button">${workEditing ? "Save work shift" : "Save work plan"}</button>
            ${workEditing ? `<button id="cancelDemandEditButton" class="secondary" type="button">Cancel edit</button>` : ""}
          </div>
        </div>

        <p id="fuelDemandPlannerStatus" class="row-note" aria-live="polite">${safeText(demandPlannerStatus)}</p>
        ${renderPlanRealismPrompt(key)}
      </div>
    `;
  }

  function planRealismOpportunityOptions(opportunities, selectedId) {
    return opportunities.map(item => {
      const windowText = timeRangeText(item.plannedStart, item.plannedEnd);
      const selected = String(item.id) === String(selectedId || "") ? "selected" : "";
      return `<option value="${safeText(item.id)}" ${selected}>${safeText(`${windowText} · ${item.label}`)}</option>`;
    }).join("");
  }

  function renderPlanRealismPrompt(key = selectedDataDateKey(), now = new Date()) {
    const opportunities = generateFuelOpportunitiesForDay(key, { now }).filter(item => !item.completedAt);
    if (!opportunities.length) {
      return `
        <section class="beta-plan-realism-panel" aria-label="Plan realism">
          <div>
            <h4>Does this fuelling plan feel realistic today?</h4>
            <p class="row-note">Add work, breaks or training above to create protected fuel moments you can adjust before the day gets difficult.</p>
          </div>
        </section>
      `;
    }
    const realism = planRealismForKey(key);
    const response = String(realism.response || "");
    const selectedOpportunityId = realism.opportunityId || opportunities[0]?.id || "";
    return `
      <section class="beta-plan-realism-panel" aria-label="Plan realism">
        <div class="beta-plan-realism-head">
          <div>
            <h4>Does this fuelling plan feel realistic today?</h4>
            <p class="row-note">Adjust a protected moment before it becomes difficult to use.</p>
          </div>
          ${realism.updatedAt ? `<span class="beta-plan-realism-saved">Saved</span>` : ""}
        </div>
        <div class="beta-plan-realism-options" role="group" aria-label="Plan realism options">
          <button class="secondary ${response === "yes" ? "active" : ""}" type="button" data-plan-realism-response="yes">Yes, this works</button>
          <button class="secondary ${response === "mostly" ? "active" : ""}" type="button" data-plan-realism-response="mostly">Mostly, one moment may be difficult</button>
          <button class="secondary ${response === "no" ? "active" : ""}" type="button" data-plan-realism-response="no">No, adjust my plan</button>
        </div>
        ${["mostly", "no"].includes(response) ? `
          <div class="beta-plan-realism-adjust">
            <div class="form-grid beta-settings-grid beta-responsive-form-grid">
              <label>Difficult moment<select id="planRealismOpportunity">${planRealismOpportunityOptions(opportunities, selectedOpportunityId)}</select></label>
              <label>Reason<select id="planRealismReason">
                <option value="work" ${realism.reason === "work" ? "selected" : ""}>Work or meeting</option>
                <option value="commute" ${realism.reason === "commute" ? "selected" : ""}>Commute</option>
                <option value="training" ${realism.reason === "training" ? "selected" : ""}>Training</option>
                <option value="access" ${realism.reason === "access" ? "selected" : ""}>Limited food access</option>
                <option value="appetite" ${realism.reason === "appetite" ? "selected" : ""}>Low appetite</option>
                <option value="social" ${realism.reason === "social" ? "selected" : ""}>Social commitment</option>
                <option value="other" ${realism.reason === "other" ? "selected" : ""}>Other</option>
              </select></label>
              <label>Adjustment<select id="planRealismAction">
                <option value="move" ${realism.action === "move" || !realism.action ? "selected" : ""}>Move protected moment</option>
                <option value="widen" ${realism.action === "widen" ? "selected" : ""}>Widen acceptable window</option>
                <option value="faster" ${realism.action === "faster" ? "selected" : ""}>Add faster alternative</option>
                <option value="limited_access" ${realism.action === "limited_access" ? "selected" : ""}>Mark food access limited</option>
                <option value="recalculate" ${realism.action === "recalculate" ? "selected" : ""}>Recalculate rest of day</option>
              </select></label>
              <label>Move by<select id="planRealismMoveMinutes">
                <option value="30" ${Number(realism.moveMinutes || 45) === 30 ? "selected" : ""}>30 minutes</option>
                <option value="45" ${Number(realism.moveMinutes || 45) === 45 ? "selected" : ""}>45 minutes</option>
                <option value="60" ${Number(realism.moveMinutes || 45) === 60 ? "selected" : ""}>60 minutes</option>
                <option value="90" ${Number(realism.moveMinutes || 45) === 90 ? "selected" : ""}>90 minutes</option>
              </select></label>
            </div>
            <div class="button-row beta-settings-actions">
              <button id="savePlanRealismButton" class="primary" type="button">Apply adjustment</button>
              <button id="clearPlanRealismButton" class="secondary" type="button">Clear adjustment</button>
            </div>
            <p class="row-note">${safeText(realism.action ? `${planRealismActionLabel(realism.action)} · ${planRealismReasonLabel(realism.reason)}` : "Choose the moment that may be difficult, then apply a small adjustment.")}</p>
          </div>
        ` : response === "yes" ? `<p class="row-note">Plan marked realistic. Keep logging as the day unfolds.</p>` : ""}
      </section>
    `;
  }

  function renderTrainingPlanner(key, blocks, trainingEditing, editingRange) {
    return `
      <section class="beta-rhythm-section-card beta-demand-planner-card" aria-label="Training planner">
        <div class="section-heading-row">
          <div>
            <h3>Training</h3>
            <p class="muted">Training details are entered once in the Today planning card.</p>
          </div>
          <span class="row-note">${safeText(formatDateKey(key))}</span>
        </div>
        <div class="beta-demand-existing">
          ${renderDemandBlockList(blocks.filter(block => block.type === "training"), "No training planned for this day yet.")}
        </div>
        <p class="row-note">Use Edit to update the same training record in Today.</p>
        ${renderTrainingCheckinSection(key, blocks.filter(block => block.type === "training"))}
      </section>
    `;
  }

  function renderWorkPlanner(key, blocks, workEditing, editingRange) {
    return `
      <section class="beta-rhythm-section-card beta-demand-planner-card" aria-label="Work planner">
        <div class="section-heading-row">
          <div>
            <h3>Work</h3>
            <p class="muted">Work-shift and break details are entered once in the Today planning card.</p>
          </div>
          <span class="row-note">${safeText(formatDateKey(key))}</span>
        </div>
        <div class="beta-demand-existing">
          ${renderDemandBlockList(blocks.filter(block => block.type === "work"), "No work shift planned for this day yet.")}
        </div>
        <p class="row-note">Use Edit to update the same shift and break record in Today.</p>
        ${renderWorkCheckinSection(key, blocks.filter(block => block.type === "work"))}
      </section>
    `;
  }

  function renderDemandPlanner() {
    const todayTarget = document.getElementById("fuelTodayPlanningFields");
    const workTarget = document.getElementById("fuelWorkPlanner");
    const trainingTarget = document.getElementById("fuelTrainingPlanner");
    const legacyTarget = document.getElementById("fuelDemandPlanner");
    if (!todayTarget && !workTarget && !trainingTarget && !legacyTarget) return;
    const key = selectedDataDateKey();
    const blocks = demandBlocksForDay(key);
    const editing = selectedDemandEditBlock();
    const editingRange = blockRange(editing);
    const trainingEditing = editing?.type === "training" ? editing : null;
    const workEditing = editing?.type === "work" ? editing : null;
    const todayMarkup = renderTodayPlanningFields(key, blocks, trainingEditing, workEditing, editingRange);
    const workMarkup = renderWorkPlanner(key, blocks, workEditing, editingRange);
    const trainingMarkup = renderTrainingPlanner(key, blocks, trainingEditing, editingRange);
    if (todayTarget) todayTarget.innerHTML = todayMarkup;
    if (workTarget) workTarget.innerHTML = workMarkup;
    if (trainingTarget) trainingTarget.innerHTML = trainingMarkup;
    if (legacyTarget) legacyTarget.innerHTML = `${workMarkup}${trainingMarkup}`;
  }

  function todayViewKey() {
    return dateKey();
  }

  function demandBlocksByTypeForDay(key, type) {
    return demandBlocksForDay(key).filter(block => block.type === type);
  }

  function compactBlockRangeText(block) {
    const range = blockRange(block);
    return range ? timeRangeText(range.start, range.end) : "Time not set";
  }

  function blockSummaryText(blocks, type) {
    if (!blocks.length) return type === "work" ? "No work shift planned." : "No training planned.";
    const labels = blocks.slice(0, 2).map(block => `${demandBlockTitle(block)} ${compactBlockRangeText(block)}`);
    const extra = blocks.length > 2 ? ` +${blocks.length - 2} more` : "";
    return `${labels.join(" · ")}${extra}`;
  }

  function opportunityCountSummary(opportunities) {
    const upcoming = opportunities.filter(item => ["upcoming", "due_soon", "overdue"].includes(item.status) && !item.completedAt).length;
    const missed = opportunities.filter(item => item.status === "missed").length;
    const completed = opportunities.filter(item => item.completedAt).length;
    return { upcoming, missed, completed };
  }

  function renderPlanTodayOverview(key = selectedDataDateKey(), now = new Date()) {
    const entry = buildArchiveEntry(key);
    const fuelLogs = logsForDay(key).filter(isFuelLog);
    const hydrationLogs = logsForDay(key).filter(isHydrationLog);
    const lowEnergyLogs = logsForDay(key).filter(isLowEnergyCheckinLog);
    const concentrationLogs = logsForDay(key).filter(isPoorConcentrationCheckinLog);
    const workBlocks = demandBlocksByTypeForDay(key, "work");
    const trainingBlocks = demandBlocksByTypeForDay(key, "training");
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const counts = opportunityCountSummary(opportunities);
    const window = fuellingWindowStatusForDay(key, fuelLogs, now);
    return `
      <section class="beta-rhythm-section-card beta-plan-today-card" aria-label="Today plan overview">
        <div class="section-heading-row">
          <div>
            <h3>Today plan</h3>
            <p class="muted">You enter work, training and targets. Fuel Guard turns that into practical fuel suggestions.</p>
          </div>
          <span class="row-note">${safeText(formatDateKey(key))}</span>
        </div>
        <div class="beta-plan-overview-grid">
          ${dailyMetricCard("Work", workBlocks.length ? `${workBlocks.length} shift${workBlocks.length === 1 ? "" : "s"}` : "Not planned", blockSummaryText(workBlocks, "work"), "fuel")}
          ${dailyMetricCard("Training", trainingBlocks.length ? `${trainingBlocks.length} session${trainingBlocks.length === 1 ? "" : "s"}` : "Not planned", blockSummaryText(trainingBlocks, "training"), "hydration")}
          ${dailyMetricCard("Fuelling window", window.started ? `${window.firstFuel}-${window.closesAt}` : window.remaining, window.message, "fuel")}
          ${dailyMetricCard("Targets", `${fuelLogs.length}${hasTarget(targets().dailyFuelLogs) ? `/${targets().dailyFuelLogs}` : ""} fuel · ${hydrationLogs.length}${hasTarget(targets().dailyHydrationLogs) ? `/${targets().dailyHydrationLogs}` : ""} hydration`, "Progress updates as logs are added.", "target")}
          ${dailyMetricCard("Suggested fuel", String(opportunities.length), `${counts.upcoming} upcoming · ${counts.completed} logged · ${counts.missed} missed`, "fuel")}
          ${dailyMetricCard("Check-ins", String(lowEnergyLogs.length + concentrationLogs.length), lowEnergyLogs.length || concentrationLogs.length ? "Energy and concentration signals appear in the timeline." : "Optional check-ins can add context.", "neutral")}
        </div>
        <p class="row-note">${safeText(entry.plainSummary || "Add logs or planning details to build the day summary.")}</p>
      </section>
    `;
  }

  function checkinOptionMarkup(options, selected = "") {
    return Object.entries(options)
      .map(([value, label]) => `<option value="${safeText(value)}" ${selected === value ? "selected" : ""}>${safeText(label)}</option>`)
      .join("");
  }

  function renderTimelineCheckins(key = selectedDataDateKey()) {
    const checkins = logsForDay(key).filter(isSubjectiveCheckinLog);
    return `
      <section class="beta-rhythm-section-card beta-checkin-card beta-timeline-checkin-card" aria-label="Timeline check-ins">
        <div class="section-heading-row">
          <div>
            <h3>Timeline check-ins</h3>
            <p class="muted">Add energy, concentration, hunger or fatigue context at the current time.</p>
          </div>
          <span class="row-note">${safeText(checkins.length ? `${checkins.length} saved` : "Optional")}</span>
        </div>
        <div class="beta-checkin-quick-grid">
          <button class="secondary" type="button" data-checkin-quick="energy" data-energy-level="low">Add low energy</button>
          <button class="secondary" type="button" data-checkin-quick="concentration" data-concentration-level="poor">Add poor concentration</button>
          <button class="secondary" type="button" data-checkin-quick="hunger" data-hunger-level="high">Add hunger</button>
          <button class="secondary" type="button" data-checkin-quick="fatigue" data-fatigue-level="high">Add fatigue</button>
        </div>
        <label class="beta-checkin-note">Optional note<input id="timelineCheckinNote" type="text" maxlength="180" placeholder="Optional context"></label>
        <p class="row-note">These check-ins do not replace fuel or hydration logs. They simply add context to the timeline.</p>
      </section>
    `;
  }

  function renderWorkCheckinSection(key, workBlocks) {
    const blockOptions = workBlocks.length
      ? workBlocks.map(block => `<option value="${safeText(block.id || block.cloudId || "")}">${safeText(demandBlockTitle(block))}</option>`).join("")
      : `<option value="">No saved shift yet</option>`;
    return `
      <div class="beta-context-checkin-panel beta-work-checkin-panel">
        <div>
          <h4>Work check-in</h4>
          <p class="muted">Optional context for energy, concentration and breaks during this shift.</p>
        </div>
        <div class="form-grid beta-settings-grid beta-responsive-form-grid">
          <label>Shift<select id="workCheckinBlock">${blockOptions}</select></label>
          <label>Energy<select id="workCheckinEnergy">${checkinOptionMarkup(ENERGY_LEVELS, "steady")}</select></label>
          <label>Concentration<select id="workCheckinConcentration">${checkinOptionMarkup(CONCENTRATION_LEVELS, "normal")}</select></label>
          <label>Break taken<select id="workCheckinBreakTaken">${checkinOptionMarkup(YES_NO_LEVELS, "not_sure")}</select></label>
          <label>Fuelled during break<select id="workCheckinFuelled">${checkinOptionMarkup(YES_NO_LEVELS, "not_sure")}</select></label>
          <label>Note<input id="workCheckinNote" type="text" maxlength="180" placeholder="Optional"></label>
        </div>
        <div class="button-row beta-settings-actions">
          <button id="saveWorkCheckinButton" class="secondary" type="button">Save work check-in</button>
        </div>
      </div>
    `;
  }

  function renderTrainingCheckinSection(key, trainingBlocks) {
    const blockOptions = trainingBlocks.length
      ? trainingBlocks.map(block => `<option value="${safeText(block.id || block.cloudId || "")}">${safeText(demandBlockTitle(block))}</option>`).join("")
      : `<option value="">No saved training yet</option>`;
    return `
      <div class="beta-context-checkin-panel beta-training-checkin-panel">
        <div>
          <h4>Training check-in</h4>
          <p class="muted">Optional context for energy, alertness, fatigue and recovery fuel.</p>
        </div>
        <div class="form-grid beta-settings-grid beta-responsive-form-grid">
          <label>Session<select id="trainingCheckinBlock">${blockOptions}</select></label>
          <label>Energy during session<select id="trainingCheckinEnergy">${checkinOptionMarkup(ENERGY_LEVELS, "steady")}</select></label>
          <label>Concentration / alertness<select id="trainingCheckinConcentration">${checkinOptionMarkup(CONCENTRATION_LEVELS, "normal")}</select></label>
          <label>Post-session fatigue<select id="trainingCheckinFatigue">
            <option value="">Not set</option>
            <option value="steady">Steady</option>
            <option value="high">High</option>
          </select></label>
          <label>Recovery fuel completed<select id="trainingCheckinRecoveryFuel">${checkinOptionMarkup(YES_NO_LEVELS, "not_sure")}</select></label>
          <label>Note<input id="trainingCheckinNote" type="text" maxlength="180" placeholder="Optional"></label>
        </div>
        <div class="button-row beta-settings-actions">
          <button id="saveTrainingCheckinButton" class="secondary" type="button">Save training check-in</button>
        </div>
      </div>
    `;
  }

  function renderDailyCheckinSection(key) {
    const existing = logsForDay(key).filter(log => isCheckinLog(log) && ["energy", "concentration", "daily"].includes(String(checkinPayload(log)?.checkinType || "")));
    if (existing.length >= 2 || key !== dateKey()) return "";
    return `
      <div class="beta-context-checkin-panel beta-daily-checkin-panel">
        <div>
          <h4>End-of-day check-in</h4>
          <p class="muted">Optional. Add this only if it helps explain the day.</p>
        </div>
        <div class="form-grid beta-settings-grid beta-responsive-form-grid">
          <label>Energy today<select id="dailyCheckinEnergy">${checkinOptionMarkup(ENERGY_LEVELS, "steady")}</select></label>
          <label>Concentration today<select id="dailyCheckinConcentration">${checkinOptionMarkup(CONCENTRATION_LEVELS, "normal")}</select></label>
          <label>Note<input id="dailyCheckinNote" type="text" maxlength="180" placeholder="Optional"></label>
        </div>
        <div class="button-row beta-settings-actions">
          <button id="saveDailyCheckinButton" class="secondary" type="button">Save daily check-in</button>
        </div>
      </div>
    `;
  }

  function lastLogForDay(key, predicate) {
    const logs = logsForDay(key).filter(predicate).sort((a, b) => a.date - b.date);
    return logs[logs.length - 1] || null;
  }

  function timeSinceLogForDay(key, predicate, now = new Date()) {
    if (key !== dateKey(now)) return "Selected day complete";
    const log = lastLogForDay(key, predicate);
    if (!log) return "Not logged yet";
    return duration(Math.max(0, (now - log.date) / 60000));
  }

  function fuellingWindowStatusForDay(key, fuelLogs, now = new Date()) {
    const sorted = [...fuelLogs].sort((a, b) => a.date - b.date);
    const first = sorted[0] || null;
    if (!first) {
      return {
        started: false,
        firstFuel: "",
        length: fuelDebtDurationText(fuelWindowMinutes()),
        closesAt: "",
        remaining: "Not started",
        message: "Your fuelling window will begin when you record your first fuel log."
      };
    }
    const start = first.date;
    const end = addMinutes(start, fuelWindowMinutes());
    const isToday = key === dateKey(now);
    const remainingMinutes = (end - now) / 60000;
    return {
      started: true,
      firstFuel: formatClock(start),
      length: fuelDebtDurationText(fuelWindowMinutes()),
      closesAt: formatClock(end),
      remaining: isToday
        ? remainingMinutes > 0
          ? `${fuelDebtDurationText(remainingMinutes)} remaining`
          : "Window ended"
        : "Selected day complete",
      message: isToday && remainingMinutes <= 0
        ? "Your fuelling window has ended for today."
        : `Fuelling window closes at ${formatClock(end)}.`
    };
  }

  function nextRelevantPlanEvent(key, now = new Date()) {
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const nextOpportunity = nextFuelOpportunity(opportunities, now);
    if (nextOpportunity) {
      return {
        label: nextOpportunity.label,
        time: logDate(nextOpportunity.plannedStart),
        end: logDate(nextOpportunity.plannedEnd),
        status: nextOpportunity.status,
        detail: opportunityPlanCopy(nextOpportunity)
      };
    }
    const nextDemand = demandBlocksForDay(key)
      .map(block => ({ block, range: blockRange(block) }))
      .filter(item => item.range && item.range.end >= now)
      .sort((a, b) => a.range.start - b.range.start)[0];
    if (!nextDemand) return null;
    return {
      label: demandBlockTitle(nextDemand.block),
      time: nextDemand.range.start,
      end: nextDemand.range.end,
      status: "upcoming",
      detail: nextDemand.block.type === "training" ? "Upcoming training session." : "Upcoming work shift."
    };
  }

  function todayRecommendation(status, event) {
    if (event) {
      const windowCopy = event.end ? `${formatClock(event.time)}-${formatClock(event.end)}` : formatClock(event.time);
      if (status === "green") return `${event.label} is at ${windowCopy}. Keep that fuel moment visible.`;
      if (status === "amber") return `${event.label} is at ${windowCopy}. You are approaching your maximum fuelling gap.`;
      if (status === "red") return `${event.label} is at ${windowCopy}. Your fuel gap goal has been reached; eat now if you can.`;
      return `${event.label} is at ${windowCopy}. Add a gentle fuel moment and support the next window.`;
    }
    if (status === "green") return "You look steady. Keep the next easy fuel or hydration moment visible.";
    if (status === "amber") return "Approaching fuel gap. A small regular fuel moment may help you feel steadier later.";
    if (status === "red") return "Fuel gap limit reached. Eat now if you can.";
    return "Recovery needed. Add fuel when you can and use the next hour as a support window.";
  }

  function fuelGapGoalCopy(snapshot) {
    const goal = maximumFuelGapMinutes();
    const elapsed = Number(snapshot?.minutesSinceFuel);
    if (!Number.isFinite(elapsed)) {
      return {
        primary: `Your ${duration(goal)} fuel-gap target starts after your first fuel log.`,
        secondary: "Log fuel when the day starts so Fuel Guard can track the window.",
        progress: 0
      };
    }
    const remaining = Math.round(goal - elapsed);
    const progress = clamp((elapsed / goal) * 100, 0, 100);
    if (remaining > 0) {
      return {
        primary: `${duration(remaining)} until your ${duration(goal)} fuel-gap target`,
        secondary: remaining <= 30 ? "Eat soon is showing because you are inside the final 30 minutes." : "You are still inside your chosen fuel-gap window.",
        progress
      };
    }
    return {
      primary: `Fuel gap ${duration(elapsed)}`,
      secondary: `Your ${duration(goal)} fuel-gap target has been reached.`,
      progress: 100
    };
  }

  function currentStatusSupportCopy(status, hasFuel) {
    if (!hasFuel) return "Ready when your first fuel log is recorded.";
    if (status === "green") return "You look steady right now.";
    if (status === "amber") return "You are approaching your fuel-gap target.";
    if (status === "red") return "Your fuel-gap target has been reached.";
    return "This gap has gone well beyond your target. Add fuel when you can.";
  }

  function renderCurrentFuellingStatus(key = todayViewKey(), now = new Date()) {
    const snapshot = fuelGapSnapshot(now);
    const hydrationSince = timeSinceLogForDay(key, isHydrationLog, now);
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const tone = snapshot.status === "green" ? "steady" : snapshot.status === "amber" ? "warning" : snapshot.status === "red" ? "urgent" : "recovery";
    const statusLabel = riskStatusLabel(snapshot.status);
    const goalCopy = fuelGapGoalCopy(snapshot);
    const lastFuel = lastLogForDay(key, isFuelLog);
    const lastHydration = lastLogForDay(key, isHydrationLog);
    const hasFuel = Boolean(lastFuel);
    const progressStyle = stylePercent(goalCopy.progress);
    const selectedDayType = dayTypeForKey(key);
    const maxGapMinutes = maximumFuelGapMinutes();
    const maxGapPreset = maximumFuelGapPresetValue(maxGapMinutes);
    const dayTypeChoices = [
      ["", "Normal"],
      ["work", "Working"],
      ["holiday", "Holiday"],
      ["competition", "Competition"]
    ];
    return `
      <section class="beta-today-status-card beta-primary-card ${safeText(tone)}" aria-label="Current fuelling status">
        <div class="beta-today-status-main">
          <span class="beta-status-kicker">Status</span>
          <strong class="beta-status-title beta-status-title-large">${safeText(statusLabel.toUpperCase())}</strong>
          <p>${safeText(currentStatusSupportCopy(snapshot.status, hasFuel))}</p>
        </div>
        <div class="beta-live-status-panel">
          <strong class="beta-gap-countdown">${safeText(goalCopy.primary)}</strong>
          <div class="beta-gap-progress" aria-hidden="true"><span style="width:${progressStyle}"></span></div>
          <small>${safeText(goalCopy.secondary)}</small>
        </div>
        <section class="beta-day-type-inline" aria-labelledby="dayTypeTitle">
          <div class="beta-day-type-inline-heading">
            <span id="dayTypeTitle">Day type</span>
            <strong>Today</strong>
          </div>
          <div class="beta-day-type-chips" role="radiogroup" aria-label="Day type for today">
            ${dayTypeChoices.map(([value, label]) => `<button type="button" role="radio" class="beta-day-type-chip${selectedDayType === value ? " selected" : ""}" aria-checked="${selectedDayType === value}" data-day-type-choice="${safeText(value)}">${safeText(label)}</button>`).join("")}
          </div>
          <section class="beta-maximum-gap-inline" aria-labelledby="maximumFuelGapTitle">
            <div class="beta-maximum-gap-inline-heading">
              <span id="maximumFuelGapTitle">Maximum fuel gap</span>
              <strong>${safeText(duration(maxGapMinutes))}</strong>
            </div>
            <div class="beta-maximum-gap-controls">
              <label>Gap target<select id="maximumFuelGapPreset">
                <option value="150"${maxGapPreset === "150" ? " selected" : ""}>2h 30m</option>
                <option value="180"${maxGapPreset === "180" ? " selected" : ""}>3h</option>
                <option value="210"${maxGapPreset === "210" ? " selected" : ""}>3h 30m</option>
                <option value="240"${maxGapPreset === "240" ? " selected" : ""}>4h</option>
                <option value="custom"${maxGapPreset === "custom" ? " selected" : ""}>Custom</option>
              </select></label>
              <label id="maximumFuelGapCustomWrap"${maxGapPreset === "custom" ? "" : " hidden"}>Custom minutes<input id="maximumFuelGapCustom" type="number" min="120" max="240" step="5" inputmode="numeric" value="${safeText(maxGapMinutes)}"></label>
            </div>
            <p id="maximumFuelGapStatus" class="row-note" aria-live="polite">Eat soon starts ${safeText(duration(30))} before this target.</p>
          </section>
        </section>
        <div class="beta-today-status-grid">
          ${dailyMetricCard("Last fuel", lastFuel ? formatClock(lastFuel.date) : "Not logged", hasFuel ? `${snapshot.timeSinceFuel} ago` : "No fuel logged yet", "fuel")}
          ${dailyMetricCard("Last hydration", lastHydration ? formatClock(lastHydration.date) : "Not logged", lastHydration ? `${hydrationSince} ago` : "No hydration logged yet", "hydration")}
          ${dailyMetricCard("Fuel logs", String(fuelLogs.length), "Logged on the selected day.", "fuel")}
          ${dailyMetricCard("Hydration logs", String(hydrationLogs.length), "Logged on the selected day.", "hydration")}
        </div>
      </section>
    `;
  }

  function hydrationSuggestionForDay(key, logs, now = new Date()) {
    if (key !== dateKey(now)) return [];
    const hydrationLogs = logs.filter(isHydrationLog).sort((a, b) => a.date - b.date);
    const last = hydrationLogs[hydrationLogs.length - 1] || null;
    const time = last ? addMinutes(last.date, hydrationGreenLimit()) : now;
    if (dateKey(time) !== key) return [];
    const status = last
      ? now > time ? "overdue" : (time - now) / 60000 <= OPPORTUNITY_RULES.dueSoonMinutes ? "due_soon" : "upcoming"
      : "due_soon";
    return [{
      type: "suggested-hydration",
      time,
      end: addMinutes(time, 30),
      title: "Suggested hydration",
      detail: last ? opportunityStatusLabel(status) : "Start hydration rhythm when convenient.",
      status
    }];
  }

  function todayActualTimelineItems(key, now = new Date()) {
    const logs = logsForDay(key);
    const completedOpportunityItems = generateFuelOpportunitiesForDay(key, { now })
      .filter(item => item.completedAt)
      .map(item => ({
        type: "completed-opportunity",
        time: logDate(item.completedAt) || logDate(item.plannedStart),
        end: null,
        title: item.label,
        detail: `Suggested window ${timeRangeText(item.plannedStart, item.plannedEnd)}`,
        status: item.status
      }))
      .filter(item => item.time);
    const logItems = logs.map(log => ({
      type: isFuelLog(log) ? "actual-fuel" : isHydrationLog(log) ? "actual-hydration" : isSubjectiveCheckinLog(log) ? "actual-checkin" : "actual-fuel",
      time: log.date,
      end: null,
      title: logTypeLabel(log),
      detail: isSubjectiveCheckinLog(log) ? (displayNoteForLog(log) || "Check-in saved") : "Completed log"
    }));
    return [...logItems, ...completedOpportunityItems]
      .filter(item => item.time)
      .sort((a, b) => a.time - b.time || String(a.type).localeCompare(String(b.type)));
  }

  function todaySuggestedTimelineItems(key, now = new Date()) {
    const logs = logsForDay(key);
    const demandItems = demandBlocksForDay(key).flatMap(block => {
      const range = blockRange(block);
      if (!range) return [];
      const blockItem = {
        type: block.type === "training" ? "planned-training" : "planned-work",
        time: range.start,
        end: range.end,
        title: demandBlockTitle(block),
        detail: block.type === "training" ? "Training session" : "Work shift"
      };
      const breakItems = block.type === "work"
        ? workBreaksForBlock(block.id).map(item => {
          const breakRange = workBreakRange(item, block);
          return breakRange ? {
            type: "planned-break",
            time: breakRange.start,
            end: breakRange.end,
            title: item.label || "Work break",
            detail: "Protected fuel time"
          } : null;
        }).filter(Boolean)
        : [];
      return [blockItem, ...breakItems];
    });
    const opportunityItems = generateFuelOpportunitiesForDay(key, { now }).map(item => ({
      type: item.status === "missed" || item.status === "overdue" ? "missed-opportunity" : "suggested-fuel",
      time: logDate(item.plannedStart),
      end: logDate(item.plannedEnd),
      title: item.label,
      detail: [
        item.completedAt ? `Completed at ${formatClock(item.completedAt)}` : opportunityStatusLabel(item.status),
        item.adjustmentNote || ""
      ].filter(Boolean).join(" · "),
      status: item.status
    })).filter(item => item.time);
    const hydrationItems = hydrationSuggestionForDay(key, logs, now);
    return [...demandItems, ...opportunityItems, ...hydrationItems]
      .filter(item => item.time)
      .sort((a, b) => a.time - b.time || String(a.type).localeCompare(String(b.type)));
  }

  function timelineTypeLabel(type) {
    if (type === "planned-work") return "Work";
    if (type === "planned-break") return "Break";
    if (type === "planned-training") return "Training";
    if (type === "suggested-fuel") return "Fuel moment";
    if (type === "suggested-hydration") return "Hydration";
    if (type === "completed-opportunity") return "Completed";
    if (type === "missed-opportunity") return "Overdue";
    if (type === "actual-hydration") return "Hydration log";
    if (type === "actual-low-energy" || type === "actual-checkin") return "Check-in";
    return "Fuel log";
  }

  function renderTimelineList(items, emptyCopy) {
    return `
      <div class="beta-unified-timeline">
        ${items.length ? items.map(item => `
          <article class="beta-unified-timeline-item ${safeText(item.type)}">
            <time>${safeText(item.end ? `${formatClock(item.time)}-${formatClock(item.end)}` : formatClock(item.time))}</time>
            <span class="beta-timeline-dot" aria-hidden="true"></span>
            <div>
              <strong>${safeText(item.title)}</strong>
              <small>${safeText(timelineTypeLabel(item.type))}${item.detail ? ` · ${safeText(item.detail)}` : ""}</small>
            </div>
          </article>
        `).join("") : `<p class="muted beta-history-empty">${safeText(emptyCopy)}</p>`}
      </div>
    `;
  }

  function renderTodayTimeline(key = todayViewKey(), now = new Date()) {
    const actualItems = todayActualTimelineItems(key, now);
    const suggestedItems = todaySuggestedTimelineItems(key, now);
    return `
      <section class="beta-rhythm-section-card beta-today-timeline-card" aria-label="Today’s timeline">
        <div class="section-heading-row">
          <div>
            <h3>Today’s timeline</h3>
            <p class="muted">Fuel, hydration and optional context across the selected day.</p>
          </div>
          <span class="row-note">${safeText(formatDateKey(key))}</span>
        </div>
        <div class="beta-fuel-plan-comparison">
          <section class="beta-fuel-plan-column actual" aria-label="Actual today’s timeline">
            <h4>Actual</h4>
            ${renderTimelineList(actualItems, "Log fuel or hydration to build the actual timeline.")}
          </section>
          <section class="beta-fuel-plan-column suggested" aria-label="Suggested timeline">
            <h4>Suggested</h4>
            ${renderTimelineList(suggestedItems, "Add work, breaks or training to generate suggested fuel windows.")}
          </section>
        </div>
        <div class="beta-timeline-legend" aria-hidden="true">
          <span><i class="planned"></i>Planned</span>
          <span><i class="suggested"></i>Suggested</span>
          <span><i class="completed"></i>Logged</span>
          <span><i class="missed"></i>Overdue</span>
        </div>
      </section>
    `;
  }

  function syncAnalysisDateInput() {
    const input = document.getElementById("fuelAnalysisDate");
    if (!input) return;
    const selectedKey = selectedDataDateKey();
    input.max = dateKey();
    if (input.value !== selectedKey) input.value = selectedKey;
  }

  function analysisTimeLabel(hour) {
    if (hour === 0 || hour === 24) return hour === 0 ? "12 AM" : "12 AM";
    if (hour === 12) return "12 PM";
    return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
  }

  function minutesFromDayStartForKey(key, value) {
    const date = logDate(value);
    if (!date) return null;
    const bounds = dayBounds(key);
    return clamp((date - bounds.start) / 60000, 0, 1440);
  }

  function analysisXForMinute(minute, padding, plotWidth) {
    return padding.left + (clamp(Number(minute || 0), 0, 1440) / 1440) * plotWidth;
  }

  function renderAnalysisTimeAxis({ width, height, padding, plotWidth, plotHeight }) {
    const tickHours = [0, 6, 12, 18, 24];
    return tickHours.map(hour => {
      const x = analysisXForMinute(hour * 60, padding, plotWidth);
      return `
        <line class="grid-line" x1="${x.toFixed(1)}" y1="${padding.top}" x2="${x.toFixed(1)}" y2="${padding.top + plotHeight}"></line>
        <text class="x-label" x="${x.toFixed(1)}" y="${height - 24}">${safeText(analysisTimeLabel(hour))}</text>
      `;
    }).join("");
  }

  function renderAnalysisGraphCard({ title, subtitle = "", graph = "", interpretation = "", empty = "", className = "" }) {
    return `
      <section class="beta-analysis-card ${safeText(className)}">
        <div class="beta-analysis-card-head">
          <div>
            <h3>${safeText(title)}</h3>
            ${subtitle ? `<p class="muted">${safeText(subtitle)}</p>` : ""}
          </div>
        </div>
        ${empty ? `<p class="muted beta-history-empty">${safeText(empty)}</p>` : graph}
        ${interpretation ? `<p class="beta-analysis-interpretation">${safeText(interpretation)}</p>` : ""}
      </section>
    `;
  }

  function analysisOpportunityStatusTone(status) {
    if (status === "completed_on_time") return "fuel";
    if (status === "completed_late" || status === "due_soon") return "neutral";
    if (status === "overdue" || status === "missed") return "critical";
    return "neutral";
  }

  function analysisDemandBandMarkup(key, padding, plotWidth, plotHeight) {
    return demandBlocksForDay(key).map(block => {
      const range = blockRange(block);
      if (!range) return "";
      const startMinute = minutesFromDayStartForKey(key, range.start);
      const endMinute = minutesFromDayStartForKey(key, range.end);
      const x = analysisXForMinute(startMinute, padding, plotWidth);
      const w = Math.max(4, analysisXForMinute(endMinute, padding, plotWidth) - x);
      const type = block.type === "training" ? "training" : "work";
      return `<rect class="demand-band ${safeText(type)}" x="${x.toFixed(1)}" y="${padding.top}" width="${w.toFixed(1)}" height="${plotHeight}" rx="12"><title>${safeText(`${demandBlockTitle(block)} · ${timeRangeText(range.start, range.end)}`)}</title></rect>`;
    }).join("");
  }

  function renderAnalysisTimelineGraph(key = selectedDataDateKey(), now = new Date()) {
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const hydrationItems = hydrationSuggestionForDay(key, logs, now);
    const demandBlocks = demandBlocksForDay(key);
    const hasData = fuelLogs.length || hydrationLogs.length || opportunities.length || demandBlocks.length;
    const hasPlan = opportunities.length || hydrationItems.length || demandBlocks.length;
    if (!hasData) {
      return renderAnalysisGraphCard({
        title: "Selected-day replay",
        subtitle: "Actual logs, planned moments, work and training across the day.",
        empty: "Log fuel or hydration, or add a plan item, to build the selected-day replay."
      });
    }
    const width = 960;
    const height = 330;
    const padding = { top: 42, right: 32, bottom: 66, left: 88 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const rowY = { plannedFuel: 96, actualFuel: 140, plannedHydration: 190, actualHydration: 234 };
    const labelMarkup = [
      ["Planned fuel", rowY.plannedFuel],
      ["Actual fuel", rowY.actualFuel],
      ["Planned hydration", rowY.plannedHydration],
      ["Actual hydration", rowY.actualHydration]
    ].map(([label, y]) => `<text class="row-label" x="18" y="${y + 5}">${safeText(label)}</text>`).join("");
    const opportunityBars = opportunities.map(item => {
      const startMinute = minutesFromDayStartForKey(key, item.plannedStart);
      const endMinute = minutesFromDayStartForKey(key, item.plannedEnd);
      if (startMinute === null || endMinute === null) return "";
      const x = analysisXForMinute(startMinute, padding, plotWidth);
      const w = Math.max(8, analysisXForMinute(endMinute, padding, plotWidth) - x);
      const tone = analysisOpportunityStatusTone(item.status);
      return `<rect class="planned-window ${safeText(tone)}" x="${x.toFixed(1)}" y="${rowY.plannedFuel - 12}" width="${w.toFixed(1)}" height="24" rx="12"><title>${safeText(`${item.label} · ${timeRangeText(item.plannedStart, item.plannedEnd)} · ${opportunityStatusLabel(item.status)}`)}</title></rect>`;
    }).join("");
    const hydrationBars = hydrationItems.map(item => {
      const startMinute = minutesFromDayStartForKey(key, item.time);
      const endMinute = minutesFromDayStartForKey(key, item.end);
      if (startMinute === null || endMinute === null) return "";
      const x = analysisXForMinute(startMinute, padding, plotWidth);
      const w = Math.max(8, analysisXForMinute(endMinute, padding, plotWidth) - x);
      return `<rect class="planned-window hydration" x="${x.toFixed(1)}" y="${rowY.plannedHydration - 12}" width="${w.toFixed(1)}" height="24" rx="12"><title>${safeText(`${item.title} · ${timeRangeText(item.time, item.end)}`)}</title></rect>`;
    }).join("");
    const marker = (log, y, className) => {
      const minute = minutesFromDayStartForKey(key, log.date);
      if (minute === null) return "";
      const x = analysisXForMinute(minute, padding, plotWidth);
      return `<circle class="actual-marker ${safeText(className)}" cx="${x.toFixed(1)}" cy="${y}" r="7"><title>${safeText(`${logTypeLabel(log)} · ${formatClock(log.date)}`)}</title></circle>`;
    };
    const completedCount = opportunities.filter(item => item.completedAt).length;
    const missedCount = opportunities.filter(item => item.status === "missed" || item.status === "overdue").length;
    const interpretation = !hasPlan
      ? "No plan was set for this day, so this replay shows the actual fuel and hydration logs that were captured."
      : missedCount
      ? `${missedCount} protected fuel moment${missedCount === 1 ? "" : "s"} need attention on this day.`
      : completedCount
        ? `${completedCount} planned fuel moment${completedCount === 1 ? "" : "s"} connected with actual logs.`
        : "Use this to compare the plan with the actual fuel and hydration logs.";
    const graph = `
      <div class="beta-analysis-graph" role="img" aria-label="Planned fuel and hydration compared with actual logs over a 24-hour day">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          ${renderAnalysisTimeAxis({ width, height, padding, plotWidth, plotHeight })}
          ${analysisDemandBandMarkup(key, padding, plotWidth, plotHeight)}
          <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
          ${labelMarkup}
          ${opportunityBars}
          ${hydrationBars}
          ${fuelLogs.map(log => marker(log, rowY.actualFuel, "fuel")).join("")}
          ${hydrationLogs.map(log => marker(log, rowY.actualHydration, "hydration")).join("")}
        </svg>
        <div class="beta-analysis-legend">
          <span><i class="fuel"></i>Fuel</span>
          <span><i class="hydration"></i>Hydration</span>
          <span><i class="critical"></i>Delayed or missed</span>
          <span><i class="neutral"></i>Work/training</span>
        </div>
      </div>
    `;
    return renderAnalysisGraphCard({
      title: "Selected-day replay",
      subtitle: "Actual logs, planned fuel opportunities, and work/training blocks.",
      graph,
      interpretation,
      className: "beta-analysis-timeline-card"
    });
  }

  function longestGapForLogs(logs, gapBuilder, key, now = new Date()) {
    const includeTrailing = key === dateKey(now);
    const gaps = gapBuilder(logs, now, includeTrailing, includeTrailing)
      .map(gap => ({ ...gap, minutes: awakeGapMinutes(gap) }))
      .filter(gap => Number.isFinite(gap.minutes) && gap.minutes >= 0);
    return gaps.sort((a, b) => Number(b.minutes || 0) - Number(a.minutes || 0))[0] || null;
  }

  function renderAnalysisGapGraph(key = selectedDataDateKey(), now = new Date()) {
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const fuelGaps = gapsFromFuelLogs(fuelLogs, now, key === dateKey(now), key === dateKey(now));
    const hydrationGaps = gapsFromHydrationLogs(hydrationLogs, now, key === dateKey(now), key === dateKey(now));
    const gaps = [
      ...fuelGaps.map(gap => ({ ...gap, kind: "fuel", threshold: mediumRiskLimit(), row: 108 })),
      ...hydrationGaps.map(gap => ({ ...gap, kind: "hydration", threshold: hydrationGreenLimit(), row: 184 }))
    ].map(gap => ({ ...gap, minutes: awakeGapMinutes(gap) }));
    if (!gaps.length) {
      return renderAnalysisGraphCard({
        title: "Fuel and hydration gaps",
        subtitle: "Longer gaps are highlighted against your preferred windows.",
        empty: "Add at least two fuel or hydration logs to see gap timing."
      });
    }
    const width = 960;
    const height = 280;
    const padding = { top: 42, right: 32, bottom: 62, left: 86 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const labelMarkup = [
      ["Fuel gaps", 108],
      ["Hydration gaps", 184]
    ].map(([label, y]) => `<text class="row-label" x="18" y="${y + 5}">${safeText(label)}</text>`).join("");
    const bars = gaps.map(gap => {
      const startMinute = minutesFromDayStartForKey(key, gap.start);
      const endMinute = minutesFromDayStartForKey(key, gap.end);
      if (startMinute === null || endMinute === null) return "";
      const x = analysisXForMinute(startMinute, padding, plotWidth);
      const w = Math.max(10, analysisXForMinute(endMinute, padding, plotWidth) - x);
      const tone = gap.minutes >= gap.threshold ? "critical" : gap.kind;
      return `<rect class="gap-bar ${safeText(tone)}" x="${x.toFixed(1)}" y="${gap.row - 14}" width="${w.toFixed(1)}" height="28" rx="14"><title>${safeText(`${gap.kind === "fuel" ? "Fuel" : "Hydration"} gap · ${duration(gap.minutes)} · ${formatClock(gap.start)} to ${formatClock(gap.end)}`)}</title></rect>`;
    }).join("");
    const longestFuel = longestGapForLogs(fuelLogs, gapsFromFuelLogs, key, now);
    const longestHydration = longestGapForLogs(hydrationLogs, gapsFromHydrationLogs, key, now);
    const interpretation = [
      longestFuel ? `Longest fuel gap: ${duration(longestFuel.minutes)}.` : "Fuel gap needs at least two logs.",
      longestHydration ? `Longest hydration gap: ${duration(longestHydration.minutes)}.` : "Hydration gap needs at least two logs."
    ].join(" ");
    const graph = `
      <div class="beta-analysis-graph" role="img" aria-label="Fuel and hydration gaps across the selected day">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          ${renderAnalysisTimeAxis({ width, height, padding, plotWidth, plotHeight })}
          <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
          ${labelMarkup}
          ${bars}
        </svg>
        <div class="beta-analysis-legend">
          <span><i class="fuel"></i>Within fuel rhythm</span>
          <span><i class="hydration"></i>Within hydration rhythm</span>
          <span><i class="critical"></i>Beyond preferred window</span>
        </div>
      </div>
    `;
    return renderAnalysisGraphCard({
      title: "Fuel and hydration gaps",
      subtitle: "When gaps stretched across the selected day.",
      graph,
      interpretation,
      className: "beta-analysis-gap-card"
    });
  }

  function analysisOpportunityStats(opportunities) {
    return opportunities.reduce((stats, item) => {
      if (item.status === "completed_on_time") stats.onTime += 1;
      else if (item.status === "completed_late") stats.late += 1;
      else if (item.status === "missed" || item.status === "overdue") stats.missed += 1;
      else stats.remaining += 1;
      stats.total += 1;
      return stats;
    }, { total: 0, onTime: 0, late: 0, missed: 0, remaining: 0 });
  }

  function renderAdherenceSegment(label, count, total, className) {
    const width = total > 0 ? Math.max(count ? 8 : 0, (count / total) * 100) : 0;
    return `<span class="${safeText(className)}" style="width:${stylePercent(width)}"><i>${safeText(`${label}: ${count}`)}</i></span>`;
  }

  function renderAnalysisAdherenceBreakdown(key = selectedDataDateKey(), now = new Date()) {
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const stats = analysisOpportunityStats(opportunities);
    if (!stats.total) {
      return renderAnalysisGraphCard({
        title: "Planned vs actual adherence",
        subtitle: "How protected moments resolved.",
        empty: "Add work, breaks, training or fuel-window details to generate protected moments."
      });
    }
    const graph = `
      <div class="beta-analysis-segmented" role="img" aria-label="Protected moments completed on time, completed late, missed, or remaining">
        <div class="beta-analysis-segment-bar">
          ${renderAdherenceSegment("On time", stats.onTime, stats.total, "fuel")}
          ${renderAdherenceSegment("Late", stats.late, stats.total, "neutral")}
          ${renderAdherenceSegment("Missed", stats.missed, stats.total, "critical")}
          ${renderAdherenceSegment("Remaining", stats.remaining, stats.total, "supporting")}
        </div>
        <div class="beta-analysis-stat-grid">
          ${dailyMetricCard("Planned moments", String(stats.total), "Protected fuel moments generated for this day.", "neutral")}
          ${dailyMetricCard("Completed on time", String(stats.onTime), "Fuel matched the protected window.", "fuel")}
          ${dailyMetricCard("Completed late", String(stats.late), "Fuel happened outside the window.", "neutral")}
          ${dailyMetricCard("Missed or overdue", String(stats.missed), "Use the next window to get steady again.", stats.missed ? "urgent" : "neutral")}
        </div>
      </div>
    `;
    const interpretation = stats.missed
      ? `${stats.missed} protected moment${stats.missed === 1 ? "" : "s"} were missed or overdue.`
      : stats.onTime
        ? "Protected fuel moments are mostly being connected with actual logs."
        : "Your plan is ready; keep logging when these windows happen.";
    return renderAnalysisGraphCard({
      title: "Planned vs actual adherence",
      subtitle: "A compact breakdown of protected moment outcomes.",
      graph,
      interpretation,
      className: "beta-analysis-adherence-card"
    });
  }

  function renderAnalysisProgression(key = selectedDataDateKey(), now = new Date()) {
    const scored = generateFuelOpportunitiesForDay(key, { now })
      .filter(opportunityIsScored)
      .sort((a, b) => (logDate(a.completedAt || a.plannedEnd) || 0) - (logDate(b.completedAt || b.plannedEnd) || 0));
    if (scored.length < 2) {
      return renderAnalysisGraphCard({
        title: "Daily adherence progression",
        subtitle: "How your day score moved as protected moments resolved.",
        empty: "Two completed, missed, or overdue protected moments are needed for a progression graph."
      });
    }
    const width = 920;
    const height = 300;
    const padding = { top: 42, right: 30, bottom: 64, left: 70 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const points = scored.map((item, index) => {
      const running = scored.slice(0, index + 1);
      return Math.round(averageValue(running.map(opportunity => Number(opportunity.timingScore || 0))));
    });
    const xFor = index => padding.left + (index / Math.max(1, points.length - 1)) * plotWidth;
    const yFor = value => padding.top + plotHeight - (value / 100) * plotHeight;
    const polyline = points.map((value, index) => `${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`).join(" ");
    const ticks = [0, 50, 100].map(value => {
      const y = yFor(value);
      return `
        <line class="grid-line" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${padding.left + plotWidth}" y2="${y.toFixed(1)}"></line>
        <text class="y-label" x="${padding.left - 12}" y="${(y + 4).toFixed(1)}">${value}%</text>
      `;
    }).join("");
    const marks = points.map((value, index) => `<circle class="point fuel" cx="${xFor(index).toFixed(1)}" cy="${yFor(value).toFixed(1)}" r="5"><title>${safeText(`${scored[index].label}: ${value}% after this moment`)}</title></circle>`).join("");
    const graph = `
      <div class="beta-analysis-graph" role="img" aria-label="Daily adherence score progression">
        <div class="beta-analysis-axis-copy"><span>Moment order</span><span>Adherence score</span></div>
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}"></line>
          ${ticks}
          <polyline class="line fuel" points="${polyline}"></polyline>
          ${marks}
        </svg>
      </div>
    `;
    return renderAnalysisGraphCard({
      title: "Daily adherence progression",
      subtitle: "How the score changed as the day unfolded.",
      graph,
      interpretation: points[points.length - 1] >= points[0] ? "Later protected moments helped the day stay steady." : "One or more later moments pulled the day’s adherence down.",
      className: "beta-analysis-progression-card"
    });
  }

  function renderAnalysisScenario(key = selectedDataDateKey(), now = new Date()) {
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const next = nextFuelOpportunity(opportunities, now);
    if (!next || key !== dateKey(now)) {
      return renderAnalysisGraphCard({
        title: "Scenario comparison",
        subtitle: "A quick estimate for the next useful fuel window.",
        empty: "When today has an upcoming protected fuel moment, Fuel Guard will compare using it now versus delaying it."
      });
    }
    const fuelLogs = logsForDay(key).filter(isFuelLog).filter(log => log.date <= now);
    const lastFuel = fuelLogs[fuelLogs.length - 1] || null;
    const plannedEnd = logDate(next.plannedEnd) || logDate(next.plannedStart);
    const delayedEnd = plannedEnd ? addMinutes(plannedEnd, 90) : null;
    const scores = opportunities.filter(opportunityIsScored).map(item => Number(item.timingScore || 0));
    const adherenceNow = Math.round(averageValue([...scores, 100].filter(Number.isFinite)));
    const adherenceDelayed = Math.round(averageValue([...scores, 50].filter(Number.isFinite)));
    const gapNow = lastFuel && plannedEnd ? Math.max(0, (plannedEnd - lastFuel.date) / 60000) : null;
    const gapDelayed = lastFuel && delayedEnd ? Math.max(0, (delayedEnd - lastFuel.date) / 60000) : null;
    const gapMax = Math.max(gapNow || 0, gapDelayed || 0, mediumRiskLimit(), 60);
    const bar = (label, value, max, className) => {
      const width = Number.isFinite(value) && max > 0 ? (value / max) * 100 : 0;
      return `
        <div class="beta-scenario-row ${safeText(className)}">
          <span>${safeText(label)}</span>
          <i style="width:${stylePercent(width)}"></i>
          <strong>${safeText(Number.isFinite(value) ? duration(value) : "Needs a fuel log")}</strong>
        </div>
      `;
    };
    const graph = `
      <div class="beta-analysis-scenario" role="img" aria-label="Scenario comparison for the next protected fuel moment">
        <div class="beta-scenario-bars">
          ${bar("Fuel within window", gapNow, gapMax, "fuel")}
          ${bar("Delay 90 minutes", gapDelayed, gapMax, "critical")}
        </div>
        <div class="beta-analysis-stat-grid">
          ${dailyMetricCard("Protected moment", timeRangeText(next.plannedStart, next.plannedEnd), next.label, "fuel")}
          ${dailyMetricCard("Estimated adherence", `${adherenceNow}% vs ${adherenceDelayed}%`, "Within window compared with delaying 90 minutes.", "neutral")}
          ${dailyMetricCard("Remaining daily target", hasTarget(targets().dailyFuelLogs) ? `${Math.max(0, targets().dailyFuelLogs - logsForDay(key).filter(isFuelLog).length)} fuel logs` : "No target set", "Based on your daily target.", "fuel")}
        </div>
      </div>
    `;
    return renderAnalysisGraphCard({
      title: "Scenario comparison",
      subtitle: "Estimated from your current plan and logs.",
      graph,
      interpretation: `Delaying this moment by 90 minutes would extend the next fuel gap${Number.isFinite(gapDelayed) ? ` to ${duration(gapDelayed)}` : ""}.`,
      className: "beta-analysis-scenario-card"
    });
  }

  function renderAnalysisPriorityCard(key = selectedDataDateKey(), now = new Date()) {
    const snapshot = key === dateKey(now) ? fuelGapSnapshot(now) : null;
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const next = nextFuelOpportunity(opportunities, now);
    const score = calculateDailyFuelScore(key, { now });
    const stats = analysisOpportunityStats(opportunities);
    const action = key === dateKey(now) && snapshot
      ? snapshot.nextAction
      : Number.isFinite(score.finalScore)
        ? `Fuel Score: ${score.finalScore}/100`
        : "Build the analysis";
    const copy = next
      ? `${next.label} is ${opportunityCountdown(next, now)}. ${opportunityPlanCopy(next)}`
      : stats.total
        ? "No remaining protected fuel moment is active for this day."
        : "Add a plan item and a couple of logs to unlock a more useful analysis.";
    return `
      <section class="beta-analysis-hero beta-analysis-card ${safeText(snapshot?.status || "neutral")}">
        <span class="beta-icon-disc shield">${dailyIcon("shield")}</span>
        <div>
          <p class="beta-analysis-eyebrow">${safeText(formatDateKey(key))}</p>
          <h3>${safeText(action)}</h3>
          <p>${safeText(copy)}</p>
        </div>
      </section>
    `;
  }

  function renderAnalysisKeyResult(key = selectedDataDateKey(), now = new Date()) {
    const entry = buildArchiveEntry(key);
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const stats = analysisOpportunityStats(opportunities);
    const score = calculateDailyFuelScore(key, { now });
    const fuelDebt = fuelDebtDurationText(Number(entry.fuelDebtMinutes || 0));
    return `
      <section class="beta-analysis-card beta-analysis-result-card">
        <div class="beta-analysis-card-head">
          <div>
            <h3>Key daily result</h3>
            <p class="muted">What mattered most in the selected day.</p>
          </div>
        </div>
        <div class="beta-analysis-stat-grid">
          ${dailyMetricCard("Fuel logs", String(fuelLogs.length), "Actual fuel logs on this day.", "fuel")}
          ${dailyMetricCard("Hydration logs", String(hydrationLogs.length), "Actual hydration logs on this day.", "hydration")}
          ${dailyMetricCard("Time beyond fuel window", fuelDebt, "A timing signal, not a calorie score.", Number(entry.fuelDebtMinutes || 0) > 0 ? "warning" : "fuel")}
          ${dailyMetricCard("Fuel Score", score.finalScore === null ? "Building" : `${score.finalScore}/100`, score.label, "neutral")}
          ${dailyMetricCard("Completed on time", String(stats.onTime), "Protected fuel moments.", "fuel")}
          ${dailyMetricCard("Missed or overdue", String(stats.missed), "Protected fuel moments.", stats.missed ? "urgent" : "neutral")}
        </div>
      </section>
    `;
  }

  function renderAnalysisWrittenInsights(key = selectedDataDateKey(), now = new Date()) {
    const entry = buildArchiveEntry(key);
    const fuelLogs = logsForDay(key).filter(isFuelLog);
    const longestFuel = longestGapForLogs(fuelLogs, gapsFromFuelLogs, key, now);
    const workBlocks = demandBlocksForDay(key).filter(block => block.type === "work");
    const overlapsWork = longestFuel && workBlocks.some(block => {
      const range = blockRange(block);
      return range && rangesOverlapMinutes(longestFuel.start, longestFuel.end, range.start, range.end) > 0;
    });
    const support = [];
    if (longestFuel) {
      support.push(`Your longest fuel gap was ${duration(longestFuel.minutes)}${overlapsWork ? " and overlapped with work time" : ""}.`);
    } else {
      support.push("Add at least two fuel logs to identify the longest fuel gap.");
    }
    if (Number(entry.fuelDebtMinutes || 0) > 0) {
      support.push(`You spent ${fuelDebtDurationText(entry.fuelDebtMinutes)} beyond your preferred fuelling window.`);
    } else {
      support.push("Fuel timing stayed inside the preferred window from the available logs.");
    }
    const recommendation = overlapsWork
      ? "For a similar day, place a small fuel moment near the start of the work window or a reliable break."
      : Number(entry.fuelDebtMinutes || 0) > 0
        ? "For a similar day, move one protected fuel moment earlier before the longer gap begins."
        : "Keep the plan simple: protect the next easy fuel or hydration moment.";
    return `
      <section class="beta-analysis-card beta-analysis-support-card">
        <div class="beta-analysis-card-head">
          <div>
            <h3>Supporting insights</h3>
            <p class="muted">Plain-language notes from today’s data.</p>
          </div>
        </div>
        <ul class="beta-analysis-bullets">
          ${support.map(item => `<li>${safeText(item)}</li>`).join("")}
        </ul>
      </section>
      <section class="beta-analysis-card beta-analysis-recommendation-card">
        <div class="beta-analysis-card-head">
          <span class="beta-icon-disc">${dailyIcon("check")}</span>
          <div>
            <h3>Recommended adjustment</h3>
            <p>${safeText(recommendation)}</p>
          </div>
        </div>
      </section>
    `;
  }

  function garminPatternsToken() {
    return window.fuelGuardCloud?.accessToken?.() || "";
  }

  async function loadGarminPatterns(force = false) {
    if (garminPatternsState.loading) return;
    if (garminPatternsState.loaded && !force) return;
    const token = garminPatternsToken();
    const account = window.fuelGuardCloud?.accountView?.() || {};
    if (!account.signedIn || !token) {
      garminPatternsState = {
        loaded: true,
        loading: false,
        data: null,
        error: "Sign in to view Garmin patterns after you connect Quick Log."
      };
      return;
    }
    garminPatternsState = { ...garminPatternsState, loading: true, error: "" };
    try {
      const response = await fetch("/api/garmin/patterns", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || "Garmin patterns are not available yet.");
      garminPatternsState = { loaded: true, loading: false, data, error: "" };
    } catch (error) {
      garminPatternsState = {
        loaded: true,
        loading: false,
        data: null,
        error: error?.message || "Garmin patterns are not available yet."
      };
    } finally {
      if (document.getElementById("insights")?.classList.contains("active")) {
        renderTrends();
      }
    }
  }

  function scheduleGarminPatternsLoad() {
    requestAnimationFrame(() => loadGarminPatterns(false));
  }

  function renderGarminCapabilitySummary(data = {}) {
    const capabilityRow = data?.capabilities || null;
    const capabilities = capabilityRow?.capabilities || {};
    const metrics = [
      ["heart_rate_history", "Heart rate"],
      ["stress_history", "Stress"],
      ["body_battery_history", "Body Battery"],
      ["activity_history", "Activities"],
      ["resting_heart_rate", "Resting HR"]
    ];
    if (!capabilityRow) {
      return `
        <div class="beta-garmin-capability-panel">
          <strong>Watch data status</strong>
          <p>Turn on health-pattern sharing in Fuel Guard Quick Log settings, then open the watch app to collect supported metrics.</p>
        </div>
      `;
    }
    const supported = metrics.filter(([key]) => capabilities[key]).map(([, label]) => label);
    const unsupported = metrics.filter(([key]) => !capabilities[key]).map(([, label]) => label);
    return `
      <div class="beta-garmin-capability-panel">
        <strong>Watch data status</strong>
        <p>${safeText(supported.length ? `Connected metrics: ${supported.join(", ")}.` : "No supported optional metrics have been reported yet.")}</p>
        ${unsupported.length ? `<small>Unavailable or not reported on this device: ${safeText(unsupported.join(", "))}.</small>` : ""}
      </div>
    `;
  }

  function garminFeatureRows() {
    const features = garminPatternsState.data?.features;
    return Array.isArray(features) ? features : [];
  }

  function garminMetricSeries(features, key) {
    return features
      .map(row => ({
        date: row.local_date || "",
        value: Number(row[key])
      }))
      .filter(point => point.date && Number.isFinite(point.value));
  }

  function renderGarminMetricChart(series, unit = "") {
    if (!series.length) return `<p class="muted beta-history-empty">No samples reported yet.</p>`;
    const width = 720;
    const height = 170;
    const padding = { top: 24, right: 18, bottom: 38, left: 44 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const values = series.map(point => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const yFor = value => padding.top + plotHeight - ((value - min) / range) * plotHeight;
    const xFor = index => padding.left + (series.length === 1 ? plotWidth / 2 : (index / (series.length - 1)) * plotWidth);
    const points = series.map((point, index) => `${xFor(index).toFixed(1)},${yFor(point.value).toFixed(1)}`).join(" ");
    const ticks = [min, min + range / 2, max].map(value => {
      const y = yFor(value);
      return `
        <line class="grid-line" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line>
        <text class="y-label" x="${padding.left - 8}" y="${(y + 4).toFixed(1)}">${safeText(`${Math.round(value)}${unit}`)}</text>
      `;
    }).join("");
    const labels = [
      series[0],
      series[Math.floor((series.length - 1) / 2)],
      series[series.length - 1]
    ].filter((point, index, list) => point && list.findIndex(item => item.date === point.date) === index)
      .map(point => {
        const index = series.findIndex(item => item.date === point.date);
        return `<text class="x-label" x="${xFor(index).toFixed(1)}" y="${height - 12}">${safeText(point.date.slice(5))}</text>`;
      }).join("");
    const markers = series.map((point, index) => {
      const x = xFor(index);
      const y = yFor(point.value);
      return `<circle class="point fuel" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"><title>${safeText(`${point.date}: ${Math.round(point.value)}${unit}`)}</title></circle>`;
    }).join("");
    return `
      <div class="beta-garmin-metric-chart" role="img" aria-label="Garmin metric trend">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          ${ticks}
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${width - padding.right}" y2="${padding.top + plotHeight}"></line>
          <polyline class="beta-garmin-metric-line" points="${points}"></polyline>
          ${markers}
          ${labels}
        </svg>
      </div>
    `;
  }

  function renderGarminMetricsSection() {
    if (!garminPatternsState.loaded && !garminPatternsState.loading) scheduleGarminPatternsLoad();
    const features = garminFeatureRows();
    const metrics = [
      { title: "Heart rate", note: "Morning median from opt-in local samples.", key: "morning_median_heart_rate", unit: " bpm", icon: "heart" },
      { title: "Stress", note: "Afternoon median from opt-in local samples.", key: "afternoon_median_stress", unit: "", icon: "chart" },
      { title: "Body Battery", note: "Daytime change from morning to evening samples.", key: "body_battery_daytime_change", unit: " pts", icon: "score" },
      { title: "Workouts", note: "Garmin activity summaries linked to fuelling rhythm.", key: "activity_count", unit: "", icon: "route" }
    ];
    return `
      <section class="beta-trend-habit-section beta-garmin-metrics-section" aria-label="Garmin metrics">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("heart")}</span>
          <div>
            <h3>Garmin metrics</h3>
            <p>Opt-in watch signals shown beside your fuelling rhythm. These are behavioural associations, not medical conclusions.</p>
          </div>
          <button class="secondary beta-garmin-refresh-button" type="button" data-refresh-garmin-patterns>Refresh</button>
        </div>
        ${garminPatternsState.loading ? `<p class="muted beta-history-empty">Loading Garmin metrics...</p>` : `
          <div class="beta-garmin-metrics-grid">
            ${metrics.map(metric => {
              const series = garminMetricSeries(features, metric.key).slice(-14);
              const latest = series[series.length - 1];
              return `
                <article class="beta-garmin-metric-card">
                  <div class="beta-garmin-metric-head">
                    <span class="beta-icon-disc">${dailyIcon(metric.icon)}</span>
                    <div>
                      <h4>${safeText(metric.title)}</h4>
                      <p>${safeText(metric.note)}</p>
                    </div>
                    <strong>${latest ? safeText(`${Math.round(latest.value)}${metric.unit}`) : "Building"}</strong>
                  </div>
                  ${renderGarminMetricChart(series, metric.unit)}
                </article>
              `;
            }).join("")}
          </div>
        `}
        <p class="row-note">Graphs use server-derived daily feature rows from your authenticated account.</p>
      </section>
    `;
  }

  function renderGarminPatternCards(insights = []) {
    if (!insights.length) {
      const message = garminPatternsState.data?.message || garminPatternsState.error || "Garmin pattern conclusions need repeated days, but the raw Garmin metrics above can appear sooner.";
      return `<p class="muted beta-history-empty">${safeText(message)}</p>`;
    }
    return `
      <div class="beta-garmin-pattern-list">
        ${insights.slice(0, 3).map(insight => `
          <article class="beta-garmin-pattern-card ${safeText(insight.tone || "neutral")}">
            <span class="beta-icon-disc ${insight.tone === "elevated" ? "amber" : "shield"}">${dailyIcon(insight.metric === "heart_rate" ? "heart" : insight.metric === "body_battery" ? "score" : "chart")}</span>
            <div>
              <h4>${safeText(insight.text)}</h4>
              <p>${safeText(insight.detail || "")}</p>
              ${insight.action ? `<small>${safeText(insight.action)}</small>` : ""}
              <span class="row-note">${safeText(`${insight.confidence || "limited"} confidence · ${insight.count || 0} matching days`)}</span>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderGarminPatternsSection() {
    if (!garminPatternsState.loaded && !garminPatternsState.loading) scheduleGarminPatternsLoad();
    const content = garminPatternsState.loading
      ? `<p class="muted beta-history-empty">Loading Garmin patterns...</p>`
      : renderGarminPatternCards(garminPatternsState.data?.insights || []);
    return `
      <section class="beta-trend-habit-section beta-garmin-patterns-section" aria-label="Garmin patterns">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("heart")}</span>
          <div>
            <h3>Garmin patterns</h3>
            <p>Opt-in watch signals compared with your fuelling rhythm. These are behavioural associations, not medical conclusions.</p>
          </div>
          <button class="secondary beta-garmin-refresh-button" type="button" data-refresh-garmin-patterns>Refresh</button>
        </div>
        ${renderGarminCapabilitySummary(garminPatternsState.data || {})}
        ${content}
        <p class="row-note">Fuel Guard uses Connect IQ-local samples only and shows insights after repeated evidence.</p>
      </section>
    `;
  }

  function ratingInput(id, label) {
    return `
      <label>${safeText(label)}
        <input id="${safeText(id)}" type="number" min="1" max="5" step="1" inputmode="numeric" value="3">
      </label>
    `;
  }

  function renderGarminDailyCheckinSection(key = selectedDataDateKey()) {
    return `
      <section class="beta-analysis-card beta-garmin-checkin-section" aria-label="Daily check-in">
        <div class="beta-analysis-card-head">
          <span class="beta-icon-disc">${dailyIcon("check")}</span>
          <div>
            <h3>Daily check-in</h3>
            <p>Optional 1-5 ratings help compare how your day felt with fuelling rhythm and Garmin patterns.</p>
          </div>
        </div>
        <div class="form-grid beta-settings-grid beta-garmin-checkin-grid" data-garmin-checkin-date="${safeText(key)}">
          ${ratingInput("garminCheckinEnergy", "Energy")}
          ${ratingInput("garminCheckinMood", "Mood")}
          ${ratingInput("garminCheckinSoreness", "Soreness")}
          ${ratingInput("garminCheckinHunger", "Hunger / appetite")}
          ${ratingInput("garminCheckinRecovery", "Perceived recovery")}
        </div>
        <label class="beta-checkin-note">Optional note<input id="garminCheckinNotes" type="text" maxlength="240" placeholder="Optional context"></label>
        <div class="button-row beta-settings-actions">
          <button id="saveGarminDailyCheckinButton" class="secondary" type="button">Save check-in</button>
        </div>
        <p id="garminDailyCheckinStatus" class="row-note" aria-live="polite">This is not a clinical assessment; use it as a gentle reflection.</p>
      </section>
    `;
  }

  function checkinNumber(id) {
    const value = Number(document.getElementById(id)?.value || 0);
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new Error("Check-in values must be whole numbers from 1 to 5.");
    return value;
  }

  async function saveGarminDailyCheckin() {
    const status = document.getElementById("garminDailyCheckinStatus");
    const token = garminPatternsToken();
    if (!token) {
      if (status) status.textContent = "Sign in to save this check-in.";
      return;
    }
    try {
      if (status) status.textContent = "Saving check-in...";
      const payload = {
        local_date: selectedDataDateKey(),
        energy: checkinNumber("garminCheckinEnergy"),
        mood: checkinNumber("garminCheckinMood"),
        soreness: checkinNumber("garminCheckinSoreness"),
        hunger_appetite: checkinNumber("garminCheckinHunger"),
        perceived_recovery: checkinNumber("garminCheckinRecovery"),
        notes: document.getElementById("garminCheckinNotes")?.value || ""
      };
      const response = await fetch("/api/garmin/checkin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.message || data?.error || "Could not save check-in.");
      if (status) status.textContent = "Check-in saved.";
      garminPatternsState.loaded = false;
      loadGarminPatterns(true);
    } catch (error) {
      if (status) status.textContent = error?.message || "Could not save check-in.";
    }
  }

  function renderAnalysisDailyTakeaway(key = selectedDataDateKey(), now = new Date()) {
    const entry = buildArchiveEntry(key);
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const missed = opportunities.filter(item => item.status === "missed" || item.status === "overdue").length;
    const completed = opportunities.filter(item => item.completedAt).length;
    const longestFuel = longestGapForLogs(fuelLogs, gapsFromFuelLogs, key, now);
    const fuelDebt = Number(entry.fuelDebtMinutes || 0);
    const workBlocks = demandBlocksByTypeForDay(key, "work");
    const trainingBlocks = demandBlocksByTypeForDay(key, "training");
    const overlapsWork = longestFuel && workBlocks.some(block => {
      const range = blockRange(block);
      return range && rangesOverlapMinutes(longestFuel.start, longestFuel.end, range.start, range.end) > 0;
    });
    const overlapsTraining = longestFuel && trainingBlocks.some(block => {
      const range = blockRange(block);
      return range && rangesOverlapMinutes(longestFuel.start, longestFuel.end, range.start, range.end) > 0;
    });
    let headline = "Today’s rhythm is still building.";
    let detail = "Add fuel and hydration logs, then use this replay to plan the next similar day.";
    if (fuelDebt > 0) {
      headline = `You spent ${fuelDebtDurationText(fuelDebt)} beyond your preferred fuelling window.`;
      detail = overlapsWork
        ? "That longer gap overlapped with work time, so the next useful action is protecting an earlier work fuel moment."
        : overlapsTraining
          ? "That longer gap overlapped with training time, so the next useful action is placing fuel around the training window."
          : "That longer gap may affect how steady the rest of the day feels, so plan one earlier fuel moment next time.";
    } else if (longestFuel) {
      headline = `Your longest fuel gap was ${duration(longestFuel.minutes)}.`;
      detail = missed
        ? `${missed} planned fuel moment${missed === 1 ? "" : "s"} slipped, so start with the easiest one to protect next time.`
        : completed
          ? `${completed} planned fuel moment${completed === 1 ? "" : "s"} connected with actual logs.`
          : "This day has logs, but no planned fuel moments to compare against yet.";
    } else if (fuelLogs.length || hydrationLogs.length) {
      headline = `${fuelLogs.length} fuel log${fuelLogs.length === 1 ? "" : "s"} and ${hydrationLogs.length} hydration log${hydrationLogs.length === 1 ? "" : "s"} were captured.`;
      detail = "Add one more fuel log or a simple plan to turn this into a clearer replay.";
    }
    return `
      <section class="beta-analysis-card beta-analysis-takeaway-card" aria-label="Daily takeaway">
        <div class="beta-analysis-card-head">
          <span class="beta-icon-disc shield">${dailyIcon(fuelDebt > 0 ? "clock" : "check")}</span>
          <div>
            <h3>Daily takeaway</h3>
            <p>${safeText(headline)}</p>
          </div>
        </div>
        <p class="beta-analysis-interpretation">${safeText(detail)}</p>
      </section>
    `;
  }

  function renderAnalysis() {
    const target = document.getElementById("fuelAnalysisContent");
    if (!target) return;
    syncAnalysisDateInput();
    const key = selectedDataDateKey();
    const now = new Date();
    target.innerHTML = `
      ${renderAnalysisTimelineGraph(key, now)}
      ${renderAnalysisDailyTakeaway(key, now)}
    `;
  }

  function renderTodayProgress(key = todayViewKey(), now = new Date()) {
    return "";
  }

  function renderAthleteActivitySummary() {
    const target = document.getElementById("athleteActivitySummary");
    if (!target || !window.FuelGuardDomain?.activityUsageSummary) return;
    const summary = window.FuelGuardDomain.activityUsageSummary(betaState().logs, new Date());
    target.innerHTML = `
      <span><b aria-hidden="true">🔥</b><strong>${summary.dayStreak}</strong> day streak</span>
      <span><b aria-hidden="true">🍽</b><strong>${summary.fuelMoments}</strong> fuel moments</span>
      <span><b aria-hidden="true">💧</b><strong>${summary.hydrationMoments}</strong> hydration moments</span>
    `;
  }

  function renderCompactDailySummary(key = todayViewKey()) {
    const entry = archiveEntries().find(item => item.date === key) || buildArchiveEntry(key);
    const logs = logsForDay(key);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const score = calculateDailyFuelScore(key);
    const opportunities = generateFuelOpportunitiesForDay(key);
    const next = nextFuelOpportunity(opportunities);
    const window = fuellingWindowStatusForDay(key, fuelLogs);
    const suggestionDetail = next
      ? `${next.label} · ${opportunityCountdown(next)}`
      : "No more fuel suggestions today.";
    const planCards = [
      dailyMetricCard("Fuelling window", window.started ? `${window.firstFuel}-${window.closesAt}` : window.remaining, window.message, "fuel"),
      dailyMetricCard("Fuel Score", score.finalScore === null ? "Building" : `${score.finalScore}/100`, score.label, "fuel"),
      dailyMetricCard("Fuel suggestions", String(opportunities.length), suggestionDetail, "fuel")
    ];
    const fuelCards = [
      dailyMetricCard("First fuel", firstEventTime(fuelLogs), "", "fuel"),
      dailyMetricCard("Most recent fuel", lastEventTime(fuelLogs), "", "fuel")
    ];
    if (fuelLogs.length >= 2) fuelCards.push(dailyMetricCard("Longest fuel gap", longestGapTextFromLogs(fuelLogs, gapsFromFuelLogs), "", "fuel"));
    const hydrationCards = [
      dailyMetricCard("First hydration", firstEventTime(hydrationLogs), "", "hydration"),
      dailyMetricCard("Most recent hydration", lastEventTime(hydrationLogs), "", "hydration")
    ];
    if (hydrationLogs.length >= 2) hydrationCards.push(dailyMetricCard("Longest hydration gap", longestGapTextFromLogs(hydrationLogs, gapsFromHydrationLogs), "", "hydration"));
    return `
      <section class="beta-rhythm-section-card beta-today-summary-card" aria-label="Daily summary">
        <div class="section-heading-row">
          <div>
            <h3>Daily summary</h3>
            <p class="muted">${safeText(entry.plainSummary || "Today’s summary will build as you log.")}</p>
          </div>
        </div>
        <div class="beta-daily-status-groups beta-compact-summary-grid">
          ${renderDailyMetricGroup("Fuel support", planCards)}
          ${renderDailyMetricGroup("Fuel timing", fuelCards)}
          ${renderDailyMetricGroup("Hydration timing", hydrationCards)}
        </div>
        <p class="row-note">Fuel Score reflects timing and targets only. It is not a calorie or medical score.</p>
        ${renderDailyCheckinSection(key)}
      </section>
    `;
  }

  function renderProtectedFuelMoments(key = selectedDataDateKey(), now = new Date()) {
    const opportunities = generateFuelOpportunitiesForDay(key, { now });
    const priorityOrder = { overdue: 0, due_soon: 1, upcoming: 2, completed_late: 3, completed_on_time: 4, missed: 5 };
    const moments = opportunities
      .filter(item => item.type !== "normal" || item.priority >= 1)
      .sort((a, b) => (priorityOrder[a.status] ?? 9) - (priorityOrder[b.status] ?? 9) || logDate(a.plannedStart) - logDate(b.plannedStart))
      .slice(0, 8);
    return `
      <section class="beta-rhythm-section-card beta-protected-moments-card" aria-label="Protected fuel times">
        <div class="section-heading-row">
          <div>
            <h3>Protected fuel times</h3>
            <p class="muted">Generated from your work schedule, flexible break estimates, training and fuelling window.</p>
          </div>
        </div>
        <div class="beta-protected-moment-list">
          ${moments.length ? moments.map(item => `
            <article class="beta-protected-moment ${safeText(opportunityTone(item.status))}">
              <time>${safeText(formatClock(item.plannedStart))}</time>
              <div><strong>${safeText(item.label)}</strong><small>${safeText(opportunityStatusLabel(item.status))}</small></div>
            </article>
          `).join("") : `<p class="muted beta-history-empty">Add work, breaks or training to generate protected fuelling moments.</p>`}
        </div>
      </section>
    `;
  }

  function firstEventTime(logs) {
    return logs.length ? formatClock(logs[0].date) : "Not enough data yet";
  }

  function lastEventTime(logs) {
    return logs.length ? formatClock(logs[logs.length - 1].date) : "Not enough data yet";
  }

  function longestGapTextFromLogs(logs, gapBuilder) {
    if (logs.length < 2) return "Not enough data yet";
    const gaps = gapBuilder(logs);
    const longest = gaps.length ? Math.max(...gaps.map(gap => Number(gap.minutes || 0))) : null;
    return Number.isFinite(longest) && longest > 0 ? duration(longest) : "Not enough data yet";
  }

  function timeSinceLastEventText(logs, key, now = new Date()) {
    if (!logs.length) return "Not enough data yet";
    if (key !== dateKey(now)) return "Selected day complete";
    const minutes = Math.max(0, (now - logs[logs.length - 1].date) / 60000);
    return duration(minutes);
  }

  function selectedDayStatusText(entry, now = new Date()) {
    const key = entry?.date || selectedDataDateKey();
    if (key === dateKey(now)) return riskStatusLabel(fuelGapStatus(minutesSinceLastFuel(now)));
    return displayStatusLabel(entry?.riskLabel || gapZoneReached(entry));
  }

  function renderDailyStatusCard(entry) {
    const key = entry?.date || selectedDataDateKey();
    const logs = entryLogsWithDates(entry);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const lowEnergyLogs = logs.filter(isLowEnergyCheckinLog);
    const status = selectedDayStatusText(entry);
    const fuelGapValue = longestGapTextFromLogs(fuelLogs, gapsFromFuelLogs);
    const hydrationGapValue = longestGapTextFromLogs(hydrationLogs, gapsFromHydrationLogs);
    return `
      <section class="beta-daily-metrics-section beta-daily-status-card" aria-label="Daily Status">
        <div class="section-heading-row">
          <h3>Daily Status</h3>
          <span class="row-note">${safeText(entry?.dateLabel || formatDateKey(key))}</span>
        </div>
        <div class="beta-daily-status-groups">
          ${renderDailyMetricGroup(`Status: ${status}`, [
            dailyMetricCard("Last fuel", lastEventTime(fuelLogs), "", "fuel"),
            dailyMetricCard("Time since last fuel", timeSinceLastEventText(fuelLogs, key), "", "fuel"),
            dailyMetricCard("Last hydration", lastEventTime(hydrationLogs), "", "hydration"),
            dailyMetricCard("Time since last hydration", timeSinceLastEventText(hydrationLogs, key), "", "hydration")
          ])}
          ${renderDailyMetricGroup("Daily log totals", [
            dailyMetricCard("Fuel logs", String(fuelLogs.length), "", "fuel"),
            dailyMetricCard("Hydration logs", String(hydrationLogs.length), "", "hydration"),
            dailyMetricCard("Low-energy check-ins", String(lowEnergyLogs.length), "", lowEnergyLogs.length ? "low-energy" : "neutral")
          ])}
          ${renderDailyMetricGroup("Fuel timing", [
            dailyMetricCard("First fuel", firstEventTime(fuelLogs), "", "fuel"),
            dailyMetricCard("Last fuel time", lastEventTime(fuelLogs), "", "fuel"),
            dailyMetricCard("Longest fuel gap", fuelGapValue, fuelLogs.length < 2 ? "Needs two fuel logs." : "", fuelLogs.length < 2 ? "neutral" : "fuel")
          ])}
          ${renderDailyMetricGroup("Hydration timing", [
            dailyMetricCard("First hydration", firstEventTime(hydrationLogs), "", "hydration"),
            dailyMetricCard("Last hydration time", lastEventTime(hydrationLogs), "", "hydration"),
            dailyMetricCard("Longest hydration gap", hydrationGapValue, hydrationLogs.length < 2 ? "Needs two hydration logs." : "", hydrationLogs.length < 2 ? "neutral" : "hydration")
          ])}
        </div>
      </section>
    `;
  }

  function renderDailyMetrics(entry, { includeHeading = true } = {}) {
    const key = entry?.date || selectedDataDateKey();
    const logs = entryLogsWithDates(entry);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    return `
      <section class="beta-daily-metrics-section" aria-label="Selected day metrics">
        ${includeHeading ? `
          <div class="section-heading-row">
            <h3>Selected day</h3>
            <span class="row-note">${safeText(entry?.dateLabel || formatDateKey(key))}</span>
          </div>
        ` : ""}
        ${renderDailyStatusCard(entry)}
        ${renderDailyTargetProgress(fuelLogs.length, hydrationLogs.length)}
      </section>
    `;
  }


  function selectedDaySummaryFilename(key = selectedDataDateKey()) {
    return `fuel-guard-${key || dateKey()}.png`;
  }

  function setDailySummaryShareStatus(message) {
    const status = document.getElementById("dailySummaryShareStatus");
    if (status) status.textContent = message || "";
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
      if (!canvas?.toBlob) {
        reject(new Error("Image export is not supported in this browser."));
        return;
      }
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error("Daily summary image could not be created."));
      }, "image/png", 0.95);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawPill(ctx, x, y, width, height, fill, text, color = "#07130f") {
    drawRoundedRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = "700 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + width / 2, y + height / 2 + 1);
  }

  function drawShareMetric(ctx, { x, y, width, label, value, note, color, percent }) {
    drawRoundedRect(ctx, x, y, width, 210, 34);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fill();
    ctx.fillStyle = "#34423c";
    ctx.font = "700 28px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label, x + 30, y + 26);
    ctx.fillStyle = "#07130f";
    ctx.font = "800 54px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(value, x + 30, y + 66);
    ctx.fillStyle = "#5b6b64";
    ctx.font = "500 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(note, x + 30, y + 132);
    drawRoundedRect(ctx, x + 30, y + 166, width - 60, 16, 8);
    ctx.fillStyle = "#dfe8e3";
    ctx.fill();
    if (Number.isFinite(percent)) {
      drawRoundedRect(ctx, x + 30, y + 166, (width - 60) * Math.min(1, Math.max(0, percent / 100)), 16, 8);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  function drawDailySummaryTimeline(ctx, x, y, width, logs) {
    const fuelLogs = stackedTimelineLogs(logs.filter(isFuelLog), { closeMinutes: 20, laneStep: 22, maxOffset: 44 });
    const hydrationLogs = stackedTimelineLogs(logs.filter(isHydrationLog), { closeMinutes: 20, laneStep: 22, maxOffset: 44 });
    drawRoundedRect(ctx, x, y, width, 240, 36);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fill();
    ctx.fillStyle = "#07130f";
    ctx.font = "800 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Daily rhythm", x + 34, y + 28);
    const trackX = x + 54;
    const trackY = y + 134;
    const trackWidth = width - 108;
    ctx.strokeStyle = "#cfdad4";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackX, trackY);
    ctx.lineTo(trackX + trackWidth, trackY);
    ctx.stroke();
    [0, 360, 720, 1080, 1440].forEach(minute => {
      const px = trackX + (minute / 1440) * trackWidth;
      ctx.strokeStyle = "#aab8b0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, trackY - 16);
      ctx.lineTo(px, trackY + 16);
      ctx.stroke();
      ctx.fillStyle = "#5b6b64";
      ctx.font = "600 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = minute === 0 ? "left" : minute === 1440 ? "right" : "center";
      ctx.fillText(`${String(Math.floor(minute / 60)).padStart(2, "0")}:00`, px, trackY + 34);
    });
    const drawMarker = (log, color, yBase) => {
      const px = trackX + (minutesIntoDay(log.date) / 1440) * trackWidth;
      const py = yBase + Number(log.laneOffset || 0);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.stroke();
    };
    fuelLogs.forEach(log => drawMarker(log, "#19b86a", trackY - 38));
    hydrationLogs.forEach(log => drawMarker(log, "#2d7ff9", trackY + 46));
    drawPill(ctx, x + 34, y + 184, 132, 40, "#dff6ea", "Fuel", "#0b6f3e");
    drawPill(ctx, x + 182, y + 184, 174, 40, "#e4efff", "Hydration", "#1d5fbf");
  }

  function createDailySummaryCanvas(entry = selectedDataEntry()) {
    const key = entry?.date || selectedDataDateKey();
    const logs = entryLogsWithDates(entry);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const currentTargets = targets();
    const fuelPercent = targetPercent(fuelLogs.length, currentTargets.dailyFuelLogs);
    const hydrationPercent = targetPercent(hydrationLogs.length, currentTargets.dailyHydrationLogs);
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export is not supported in this browser.");
    ctx.fillStyle = "#07130f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "rgba(45,255,136,0.18)");
    gradient.addColorStop(0.56, "rgba(255,255,255,0.08)");
    gradient.addColorStop(1, "rgba(35,103,213,0.18)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(118, 118, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#07130f";
    ctx.font = "900 38px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FG", 118, 120);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.font = "800 62px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Fuel Guard", 194, 76);
    ctx.font = "600 32px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.76)";
    ctx.fillText(formatDateKey(key), 198, 148);

    const fuelValue = hasTarget(currentTargets.dailyFuelLogs) ? `${fuelLogs.length} / ${currentTargets.dailyFuelLogs}` : String(fuelLogs.length);
    const hydrationValue = hasTarget(currentTargets.dailyHydrationLogs) ? `${hydrationLogs.length} / ${currentTargets.dailyHydrationLogs}` : String(hydrationLogs.length);
    drawShareMetric(ctx, {
      x: 70,
      y: 260,
      width: 450,
      label: "Fuel logs",
      value: fuelValue,
      note: hasTarget(currentTargets.dailyFuelLogs) ? `${fuelPercent}% of daily target` : "No daily target set",
      color: "#19b86a",
      percent: fuelPercent
    });
    drawShareMetric(ctx, {
      x: 560,
      y: 260,
      width: 450,
      label: "Hydration logs",
      value: hydrationValue,
      note: hasTarget(currentTargets.dailyHydrationLogs) ? `${hydrationPercent}% of daily target` : "No daily target set",
      color: "#2d7ff9",
      percent: hydrationPercent
    });
    drawDailySummaryTimeline(ctx, 70, 540, 940, logs);

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 44px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Your fuelling rhythm", 70, 860);
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "500 31px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    const summaryLines = [
      `Fuel: ${fuelLogs.length} log${fuelLogs.length === 1 ? "" : "s"}`,
      `Hydration: ${hydrationLogs.length} log${hydrationLogs.length === 1 ? "" : "s"}`,
      hasTarget(currentTargets.dailyFuelLogs) ? `Daily fuel target: ${fuelPercent}% complete` : "Set a daily fuel target in Settings",
      hasTarget(currentTargets.dailyHydrationLogs) ? `Daily hydration target: ${hydrationPercent}% complete` : "Set a daily hydration target in Settings"
    ];
    summaryLines.forEach((line, index) => ctx.fillText(line, 70, 938 + index * 52));

    ctx.fillStyle = "rgba(255,255,255,0.58)";
    ctx.font = "600 25px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("A simple summary of fuel and hydration timing. No private account info included.", 70, 1260);
    return canvas;
  }

  async function dailySummaryBlob() {
    return canvasBlob(createDailySummaryCanvas(selectedDataEntry()));
  }

  async function downloadDailySummaryImage() {
    setDailySummaryShareStatus("Creating image...");
    try {
      const blob = await dailySummaryBlob();
      downloadBlob(blob, selectedDaySummaryFilename());
      setDailySummaryShareStatus("Daily summary image downloaded.");
    } catch (error) {
      setDailySummaryShareStatus(`Image download failed: ${error?.message || "unknown error"}`);
    }
  }

  async function shareDailySummaryImage() {
    setDailySummaryShareStatus("Creating image...");
    try {
      const blob = await dailySummaryBlob();
      const filename = selectedDaySummaryFilename();
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Fuel Guard daily summary", text: "Fuel Guard daily summary" });
        setDailySummaryShareStatus("Daily summary shared.");
        return;
      }
      downloadBlob(blob, filename);
      setDailySummaryShareStatus("Sharing image downloaded because native sharing is not available here.");
    } catch (error) {
      if (error?.name === "AbortError") {
        setDailySummaryShareStatus("Share cancelled.");
        return;
      }
      setDailySummaryShareStatus(`Share failed: ${error?.message || "unknown error"}`);
    }
  }

  function selectedDataEntry() {
    const selectedKey = selectedDataDateKey();
    return archiveEntries().find(entry => entry.date === selectedKey) || buildArchiveEntry(selectedKey);
  }

  function syncSelectedDataDateInput() {
    const dateInput = document.getElementById("fuelDataDate");
    if (!dateInput) return;
    const selectedKey = selectedDataDateKey();
    dateInput.max = dateKey();
    if (dateInput.value !== selectedKey) dateInput.value = selectedKey;
  }

  function renderPlanSubtabs() {
    const valid = new Set(["today", "work", "training", "targets"]);
    if (!valid.has(selectedPlanSubtab)) selectedPlanSubtab = "today";
    document.querySelectorAll("[data-plan-subtab]").forEach(button => {
      const active = button.dataset.planSubtab === selectedPlanSubtab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    document.querySelectorAll("[data-plan-panel]").forEach(panel => {
      const active = panel.dataset.planPanel === selectedPlanSubtab;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });
  }

  function setPlanSubtab(value) {
    selectedPlanSubtab = ["today", "work", "training", "targets"].includes(value) ? value : "today";
    renderPlanSubtabs();
    renderDemandPlanner();
  }

  function renderSelectedDayCard() {
    syncSelectedDataDateInput();
    const entry = selectedDataEntry();
    const key = entry?.date || selectedDataDateKey();
    const logs = entryLogsWithDates(entry);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const todayKey = todayViewKey();
    const legacyTarget = document.getElementById("fuelSelectedDayMetrics");
    const statusTarget = document.getElementById("fuelDailyStatusMetrics");
    const windowTarget = document.getElementById("fuelFuellingWindowSummary");
    const targetsTarget = document.getElementById("fuelDailyTargetsSummary");
    const weeklyTargetsTarget = document.getElementById("fuelWeeklyTargetsSummary");
    const todayStatusTarget = document.getElementById("fuelTodayStatus");
    const todayTimelineTarget = document.getElementById("fuelTodayTimeline");
    const logPatternsTarget = document.getElementById("fuelLogPatterns");
    renderPlanSubtabs();
    if (legacyTarget) legacyTarget.innerHTML = "";
    if (statusTarget) statusTarget.innerHTML = renderDailyStatusCard(entry);
    renderDemandPlanner();
    if (todayStatusTarget) todayStatusTarget.innerHTML = renderCurrentFuellingStatus(todayKey);
    if (todayTimelineTarget) todayTimelineTarget.innerHTML = renderTodayTimeline(key);
    if (logPatternsTarget) logPatternsTarget.innerHTML = renderFuellingPatternGraphs(todayKey);
    if (windowTarget) windowTarget.innerHTML = "";
    if (targetsTarget) targetsTarget.innerHTML = renderDailyTargetProgress(fuelLogs.length, hydrationLogs.length);
    if (weeklyTargetsTarget) {
      const weekStart = startOfCalendarWeek(dateFromKey(todayKey));
      const weekEntries = entriesForRange(archiveEntries(), weekStart, addDays(weekStart, 7));
      weeklyTargetsTarget.innerHTML = renderWeeklyTargetSection(weekEntries);
    }
  }

  function renderLogEvent(log, { note: noteOverride = "" } = {}) {
    const date = logDate(log.timestamp || log);
    const displayNote = noteOverride || displayNoteForLog(log);
    const type = logType(log);
    const displayType = isSleepyLog(log) ? "sleepy" : type;
    const id = String(log?.id || log?.localId || log?.cloudId || "");
    const note = displayNote ? `<small>${safeText(displayNote)}</small>` : "";
    const method = log.entryMethod && log.entryMethod !== "live" ? `<small>${safeText(log.entryMethod)}</small>` : "";
    const source = log.source && log.source !== "manual" ? `<small>${safeText(log.source)}</small>` : "";
    const canEdit = ["fuel", "hydration", "fuel_hydration"].includes(type);
    const iconType = isSleepyLog(log) ? "sleepy" : type === "hydration" ? "hydration" : type === "checkin" || type === "crash" ? "energy" : "fuel";
    const iconClass = type === "hydration" ? "shield" : type === "checkin" || type === "crash" ? "amber" : "";
    return `
      <article class="beta-history-log-event ${safeText(displayType)}">
        <span class="beta-icon-disc ${safeText(iconClass)}">${dailyIcon(iconType)}</span>
        <div>
          <strong>${date ? formatClock(date) : "--"}</strong>
          <span>${safeText(log.typeLabel || logTypeLabel(log))}</span>
          ${note || method || source ? `<div class="beta-history-log-meta">${note}${method}${source}</div>` : ""}
          ${id ? `<div class="beta-log-event-actions">${canEdit ? `<button class="secondary" type="button" data-edit-log="${safeText(id)}">Edit</button>` : ""}<button class="secondary danger-secondary" type="button" data-delete-log="${safeText(id)}">Delete</button></div>` : ""}
        </div>
      </article>
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
    const selectedDayType = trendDayTypeValue(selectedTrendDayType);
    const entryDayType = trendDayTypeValue(entry.dayType);
    const dayMatches = !selectedDayType || entryDayType === selectedDayType;
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

  function trendPointTooltip(point, valueKey, unit = "minutes") {
    const label = valueKey === "previous" ? "Last week" : "This week";
    const value = point[valueKey];
    const valueText = unit === "minutes" ? compactDuration(value) : String(Math.round(value));
    return `${label} ${point.shortLabel || point.label}: ${valueText}`;
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
          ${points.map((point, index) => Number.isFinite(point.previous) ? `<circle class="point previous" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.previous).toFixed(1)}" r="2.6"><title>${safeText(trendPointTooltip(point, "previous", unit))}</title></circle>` : "").join("")}
          ${points.map((point, index) => Number.isFinite(point.current) ? `<circle class="point current" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.current).toFixed(1)}" r="3"><title>${safeText(trendPointTooltip(point, "current", unit))}</title></circle>` : "").join("")}
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

  function renderWeeklyFuelLogTimeline(entries, weekStart = trendChartWeekStart(entries)) {
    const entriesByDate = Object.fromEntries((entries || []).filter(entry => entry?.date).map(entry => [entry.date, entry]));
    let totalFuelLogs = 0;
    const rows = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      const key = dateKey(day);
      const entry = entriesByDate[key];
      const fuelLogs = stackedTimelineLogs(entryLogsWithDates(entry).filter(isFuelLog), { closeMinutes: 20, laneStep: 10, maxOffset: 17 });
      totalFuelLogs += fuelLogs.length;
      const markers = fuelLogs.map(log => {
        const left = (minutesIntoDay(log.date) / 1440) * 100;
        const tooltip = logMarkerTooltip(log);
        return `<span class="beta-weekly-fuel-marker" style="left:${stylePercent(left)};--lane-y:${Number(log.laneOffset || 0).toFixed(1)}px" title="${safeText(tooltip)}" data-tooltip="${safeText(tooltip)}" tabindex="0" aria-label="${safeText(tooltip)}"></span>`;
      }).join("");
      const times = fuelLogs.length ? fuelLogs.map(log => formatClock(log.date)).join(", ") : "No fuel logs";
      return `
        <div class="beta-weekly-fuel-row">
          <div class="beta-weekly-fuel-day"><strong>${safeText(day.toLocaleDateString(undefined, { weekday: "short" }))}</strong><span>${safeText(day.toLocaleDateString(undefined, { month: "short", day: "numeric" }))}</span></div>
          <div class="beta-weekly-fuel-track">${markers}</div>
          <div class="beta-weekly-fuel-times">${safeText(times)}</div>
        </div>
      `;
    }).join("");

    return `
      <article class="beta-trend-pattern-card beta-impact-trend-card beta-weekly-fuel-card">
        <div class="beta-metric-card-head">
          <span class="beta-icon-disc shield">${dailyIcon("fuel")}</span>
          <div><span>Fuel log timing archive</span><strong>${totalFuelLogs} fuel log${totalFuelLogs === 1 ? "" : "s"}</strong></div>
        </div>
        <div class="beta-weekly-fuel-timeline" aria-label="Weekly fuel log timing">
          ${rows}
          <div class="beta-weekly-fuel-axis" aria-hidden="true"><span>${safeText(minuteLabel(0))}</span><span>${safeText(minuteLabel(360))}</span><span>${safeText(minuteLabel(720))}</span><span>${safeText(minuteLabel(1080))}</span><span>${safeText(minuteLabel(1440))}</span></div>
        </div>
        <small>Each marker is one fuel log at its recorded time. Hover or focus a marker for the exact time.</small>
      </article>
    `;
  }

  function weeklyEntriesByDate(entries) {
    return Object.fromEntries((entries || []).filter(entry => entry?.date).map(entry => [entry.date, entry]));
  }

  function logsForEntryType(entry, predicate) {
    return entryLogsWithDates(entry).filter(predicate);
  }

  function activeEntriesForType(entries, predicate) {
    return entries.filter(entry => logsForEntryType(entry, predicate).length > 0);
  }

  function nthEventMinute(entry, predicate, index) {
    const logs = logsForEntryType(entry, predicate);
    return logs[index] ? minutesIntoDay(logs[index].date) : null;
  }

  function lastEventMinute(entry, predicate) {
    const logs = logsForEntryType(entry, predicate);
    return logs.length ? minutesIntoDay(logs[logs.length - 1].date) : null;
  }

  function averageClockForEvents(entries, predicate, selector) {
    const minutes = entries
      .map(entry => selector(entry, predicate))
      .filter(value => Number.isFinite(value));
    return averageClock(minutes);
  }

  function eventGapsForEntries(entries, predicate, gapBuilder) {
    return entries.flatMap(entry => gapBuilder(logsForEntryType(entry, predicate)).map(gap => Number(gap.minutes || 0))).filter(Number.isFinite);
  }

  function averageDurationForValues(values) {
    const average = averageValue(values);
    return Number.isFinite(average) ? duration(average) : "Not enough data yet";
  }

  function longestDurationForValues(values) {
    const finite = values.filter(value => Number.isFinite(value) && value > 0);
    return finite.length ? duration(Math.max(...finite)) : "Not enough data yet";
  }

  function activeDayNote(count) {
    return `Based on ${count} active day${count === 1 ? "" : "s"}.`;
  }

  function renderWeeklyMetricCard(label, value, note = "") {
    return `
      <article class="beta-weekly-metric-card">
        <span>${safeText(label)}</span>
        <strong>${safeText(value)}</strong>
        ${note ? `<small>${safeText(note)}</small>` : ""}
      </article>
    `;
  }


  function weeklyLogCount(entries, predicate) {
    return entries.reduce((sum, entry) => sum + logsForEntryType(entry, predicate).length, 0);
  }

  function renderWeeklyTargetMetric(label, actual, target, tone = "fuel") {
    const percent = targetPercent(actual, target);
    const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
    const value = hasTarget(target) ? `${actual} of ${target}` : `${actual} log${actual === 1 ? "" : "s"}`;
    const progressNote = hasTarget(target)
      ? targetProgressNote(label, actual, target, "weekly")
      : `No weekly ${label.toLowerCase()} target set.`;
    const differenceNote = hasTarget(target)
      ? `${percent}% complete. ${targetDifferenceText(actual, target)}`
      : `Set a daily ${label.toLowerCase()} target in Settings.`;
    const fill = percent === null ? "" : `<i style="width:${stylePercent(width)}"></i>`;
    return `
      <article class="beta-target-progress-card beta-weekly-target-card ${safeText(tone)}">
        <div class="beta-target-progress-head">
          <span>${safeText(label)}</span>
          <strong>${safeText(value)}</strong>
        </div>
        <div class="beta-target-progress-bar" aria-hidden="true">${fill}</div>
        <small>${safeText(progressNote)}</small>
        <div class="beta-target-difference">${safeText(differenceNote)}</div>
      </article>
    `;
  }

  function renderWeeklyTargetSection(entries) {
    const currentTargets = derivedTargets(targets());
    const fuelActual = weeklyLogCount(entries, isFuelLog);
    const hydrationActual = weeklyLogCount(entries, isHydrationLog);
    const hasAnyWeeklyTarget = hasTarget(currentTargets.weeklyFuelLogs) || hasTarget(currentTargets.weeklyHydrationLogs);
    const hasAnyLogs = fuelActual > 0 || hydrationActual > 0;
    const empty = !hasAnyWeeklyTarget && !hasAnyLogs
      ? `<p class="muted beta-history-empty">Set daily targets in Settings or log fuel and hydration to see weekly target progress here.</p>`
      : "";
    return `
      <section class="beta-weekly-section beta-weekly-target-section">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("target")}</span>
          <div>
            <h3>Weekly targets</h3>
            <p>Weekly targets are calculated from your daily targets × 7.</p>
          </div>
        </div>
        ${empty}
        <div class="beta-target-progress-grid beta-weekly-target-grid">
          ${renderWeeklyTargetMetric("Fuel", fuelActual, currentTargets.weeklyFuelLogs, "fuel")}
          ${renderWeeklyTargetMetric("Hydration", hydrationActual, currentTargets.weeklyHydrationLogs, "hydration")}
        </div>
      </section>
    `;
  }

  function averageFirstEvent(entries, predicate) {
    return averageClockForEvents(entries, predicate, (entry, test) => nthEventMinute(entry, test, 0));
  }

  function averageSecondEvent(entries, predicate) {
    return averageClockForEvents(entries, predicate, (entry, test) => nthEventMinute(entry, test, 1));
  }

  function averageLastEvent(entries, predicate) {
    return averageClockForEvents(entries, predicate, lastEventMinute);
  }

  function renderWeeklyFuelSection(entries) {
    const active = activeEntriesForType(entries, isFuelLog);
    const secondActive = entries.filter(entry => logsForEntryType(entry, isFuelLog).length >= 2);
    const totalLogs = entries.reduce((sum, entry) => sum + logsForEntryType(entry, isFuelLog).length, 0);
    const gaps = eventGapsForEntries(entries, isFuelLog, gapsFromFuelLogs);
    const activeCount = active.length;
    return `
      <section class="beta-weekly-section beta-weekly-section-fuel">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc amber">${dailyIcon("fuel")}</span>
          <div>
            <h3>Fuel</h3>
            <p>${safeText(activeDayNote(activeCount))}</p>
          </div>
        </div>
        <div class="beta-weekly-metric-grid">
          ${renderWeeklyMetricCard("Average first fuel", activeCount ? averageFirstEvent(entries, isFuelLog) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Average second fuel", secondActive.length ? averageSecondEvent(secondActive, isFuelLog) : "Not enough data yet", activeDayNote(secondActive.length))}
          ${renderWeeklyMetricCard("Average last fuel", activeCount ? averageLastEvent(entries, isFuelLog) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Total fuel logs", String(totalLogs), "Actual fuel logs this week.")}
          ${renderWeeklyMetricCard("Average fuel logs / active day", activeCount ? (totalLogs / activeCount).toFixed(1) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Average fuel gap", averageDurationForValues(gaps), gaps.length ? `${gaps.length} fuel gap${gaps.length === 1 ? "" : "s"} counted.` : "Needs at least two fuel logs in a day.")}
          ${renderWeeklyMetricCard("Longest weekly fuel gap", longestDurationForValues(gaps), gaps.length ? "Longest fuel gap inside this week." : "Needs at least two fuel logs in a day.")}
        </div>
      </section>
    `;
  }

  function renderWeeklyHydrationSection(entries) {
    const active = activeEntriesForType(entries, isHydrationLog);
    const secondActive = entries.filter(entry => logsForEntryType(entry, isHydrationLog).length >= 2);
    const totalLogs = entries.reduce((sum, entry) => sum + logsForEntryType(entry, isHydrationLog).length, 0);
    const gaps = eventGapsForEntries(entries, isHydrationLog, gapsFromHydrationLogs);
    const activeCount = active.length;
    return `
      <section class="beta-weekly-section beta-weekly-section-hydration">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("hydration")}</span>
          <div>
            <h3>Hydration</h3>
            <p>${safeText(activeDayNote(activeCount))}</p>
          </div>
        </div>
        <div class="beta-weekly-metric-grid">
          ${renderWeeklyMetricCard("Average first hydration", activeCount ? averageFirstEvent(entries, isHydrationLog) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Average second hydration", secondActive.length ? averageSecondEvent(secondActive, isHydrationLog) : "Not enough data yet", activeDayNote(secondActive.length))}
          ${renderWeeklyMetricCard("Average last hydration", activeCount ? averageLastEvent(entries, isHydrationLog) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Total hydration logs", String(totalLogs), "Actual hydration logs this week.")}
          ${renderWeeklyMetricCard("Average hydration logs / active day", activeCount ? (totalLogs / activeCount).toFixed(1) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Average hydration gap", averageDurationForValues(gaps), gaps.length ? `${gaps.length} hydration gap${gaps.length === 1 ? "" : "s"} counted.` : "Needs at least two hydration logs in a day.")}
          ${renderWeeklyMetricCard("Longest weekly hydration gap", longestDurationForValues(gaps), gaps.length ? "Longest hydration gap inside this week." : "Needs at least two hydration logs in a day.")}
        </div>
      </section>
    `;
  }

  function commonTimeRangeForLogs(logs) {
    if (logs.length < 2) return "Not enough data yet";
    const buckets = {};
    logs.forEach(log => {
      const label = timeWindowBucket(minutesIntoDay(log.date));
      buckets[label] = (buckets[label] || 0) + 1;
    });
    const top = Object.entries(buckets).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return top ? `${top[0]} (${top[1]} event${top[1] === 1 ? "" : "s"})` : "Not enough data yet";
  }

  function lowEnergyAfterLongGapWeeklyInsight(entries) {
    const lowEnergyLogs = entries.flatMap(entry => logsForEntryType(entry, isLowEnergyCheckinLog));
    if (!lowEnergyLogs.length) return "No Low Energy logs this week.";
    let supported = 0;
    lowEnergyLogs.forEach(event => {
      const dayLogs = logsForDay(dateKey(event.date)).filter(log => log.date <= event.date);
      const previousFuel = dayLogs.filter(isFuelLog).pop();
      const previousHydration = dayLogs.filter(isHydrationLog).pop();
      const fuelGap = previousFuel ? (event.date - previousFuel.date) / 60000 : null;
      const hydrationGap = previousHydration ? (event.date - previousHydration.date) / 60000 : null;
      if ((Number.isFinite(fuelGap) && fuelGap >= mediumRiskLimit()) || (Number.isFinite(hydrationGap) && hydrationGap >= hydrationGreenLimit())) supported += 1;
    });
    if (supported > 0) return `${supported} of ${lowEnergyLogs.length} Low Energy log${lowEnergyLogs.length === 1 ? "" : "s"} happened after a longer fuel or hydration gap.`;
    return "This week does not show a clear long-gap link before Low Energy logs yet.";
  }

  function renderWeeklyLowEnergySection(entries) {
    const active = activeEntriesForType(entries, isLowEnergyCheckinLog);
    const activeCount = active.length;
    const total = entries.reduce((sum, entry) => sum + logsForEntryType(entry, isLowEnergyCheckinLog).length, 0);
    const allLogs = entries.flatMap(entry => logsForEntryType(entry, isLowEnergyCheckinLog));
    const dayWithMost = entries
      .map(entry => ({ entry, count: logsForEntryType(entry, isLowEnergyCheckinLog).length }))
      .sort((a, b) => b.count - a.count || dateFromKey(a.entry.date) - dateFromKey(b.entry.date))[0];
    return `
      <section class="beta-weekly-section beta-weekly-section-low-energy">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc amber">${dailyIcon("energy")}</span>
          <div>
            <h3>Low Energy</h3>
            <p>${safeText(activeDayNote(activeCount))}</p>
          </div>
        </div>
        <div class="beta-weekly-metric-grid">
          ${renderWeeklyMetricCard("Total Low Energy logs", String(total), "Actual Low Energy events this week.")}
          ${renderWeeklyMetricCard("Average / active day", activeCount ? (total / activeCount).toFixed(1) : "Not enough data yet", activeDayNote(activeCount))}
          ${renderWeeklyMetricCard("Day with most", dayWithMost?.count ? `${dayWithMost.entry.dateLabel || formatDateKey(dayWithMost.entry.date)} (${dayWithMost.count})` : "Not enough data yet")}
          ${renderWeeklyMetricCard("Common time range", commonTimeRangeForLogs(allLogs), allLogs.length >= 2 ? "Based on Low Energy log times." : "Needs at least two Low Energy logs.")}
        </div>
        <p class="beta-weekly-insight">${safeText(lowEnergyAfterLongGapWeeklyInsight(entries))}</p>
      </section>
    `;
  }

  function weeklyPointLabel(day) {
    return day.toLocaleDateString(undefined, { weekday: "short" });
  }

  function weeklyDateLabel(day) {
    return day.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function weeklySeriesPoints(entries, weekStart, valueForEntry) {
    const byDate = weeklyEntriesByDate(entries);
    return weekDays(weekStart).map(day => {
      const key = dateKey(day);
      const value = valueForEntry(byDate[key], key);
      return {
        key,
        label: weeklyPointLabel(day),
        dateLabel: weeklyDateLabel(day),
        value: Number.isFinite(value) ? Math.max(0, value) : null
      };
    });
  }

  function weeklyChartMax(points) {
    const values = points.flatMap(point => Array.isArray(point.value) ? point.value : [point.value]).filter(value => Number.isFinite(value));
    return Math.max(...values, 1);
  }

  function weeklyChartValueText(value, unit = "count") {
    if (!Number.isFinite(value)) return "Not enough data";
    return unit === "minutes" ? compactDuration(value) : String(Math.round(value));
  }

  function renderWeeklySingleLineChart(points, { unit = "minutes", ariaLabel = "Weekly line chart", yLabel = "Duration", colorClass = "fuel" } = {}) {
    if (!points.some(point => Number.isFinite(point.value))) return `<div class="beta-trend-chart-empty">Needs matching logs to draw the chart.</div>`;
    const width = 420;
    const height = 190;
    const padding = { top: 22, right: 18, bottom: 48, left: 48 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const max = weeklyChartMax(points);
    const xFor = index => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yFor = value => padding.top + plotHeight - (value / max) * plotHeight;
    const path = points.reduce((segments, point, index) => {
      if (!Number.isFinite(point.value)) {
        if (segments.current.length) {
          segments.done.push(segments.current);
          segments.current = [];
        }
        return segments;
      }
      segments.current.push(`${xFor(index).toFixed(1)},${yFor(point.value).toFixed(1)}`);
      return segments;
    }, { current: [], done: [] });
    if (path.current.length) path.done.push(path.current);
    return `
      <div class="beta-trend-chart beta-weekly-single-chart" role="img" aria-label="${safeText(ariaLabel)}">
        <div class="beta-trend-axis-copy">Y: ${safeText(yLabel)} · X: day/date</div>
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          <text class="y-label" x="6" y="${padding.top + 8}">${safeText(weeklyChartValueText(max, unit))}</text>
          <text class="y-label" x="8" y="${padding.top + plotHeight}">0</text>
          ${path.done.map(segment => `<polyline class="line ${safeText(colorClass)}" points="${segment.join(" ")}"></polyline>`).join("")}
          ${points.map((point, index) => Number.isFinite(point.value) ? `<circle class="point ${safeText(colorClass)}" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.value).toFixed(1)}" r="3.2"><title>${safeText(`${point.label} ${point.dateLabel}: ${weeklyChartValueText(point.value, unit)}`)}</title></circle>` : "").join("")}
          ${points.map((point, index) => `<text class="x-label" x="${xFor(index).toFixed(1)}" y="${height - 24}">${safeText(point.label)}</text>`).join("")}
        </svg>
      </div>
    `;
  }

  function renderWeeklyGroupedCountChart(entries, weekStart) {
    const points = weekDays(weekStart).map(day => {
      const entry = weeklyEntriesByDate(entries)[dateKey(day)];
      return {
        label: weeklyPointLabel(day),
        dateLabel: weeklyDateLabel(day),
        fuel: logsForEntryType(entry, isFuelLog).length,
        hydration: logsForEntryType(entry, isHydrationLog).length,
        lowEnergy: logsForEntryType(entry, isLowEnergyCheckinLog).length
      };
    });
    const max = Math.max(...points.flatMap(point => [point.fuel, point.hydration, point.lowEnergy]), 1);
    const width = 420;
    const height = 190;
    const padding = { top: 22, right: 18, bottom: 48, left: 42 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const slot = plotWidth / points.length;
    const barWidth = Math.min(11, Math.max(5, slot * 0.18));
    const yFor = value => padding.top + plotHeight - (value / max) * plotHeight;
    const centerFor = index => padding.left + slot * index + slot / 2;
    const bar = (point, index, key, offset, className, label) => {
      const value = Number(point[key] || 0);
      const heightValue = value ? Math.max(2, padding.top + plotHeight - yFor(value)) : 0;
      const center = centerFor(index);
      return `<rect class="bar ${className}" x="${(center + offset - barWidth / 2).toFixed(1)}" y="${(padding.top + plotHeight - heightValue).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${heightValue.toFixed(1)}" rx="3"><title>${safeText(`${point.label} ${point.dateLabel}: ${value} ${label}`)}</title></rect>`;
    };
    return `
      <div class="beta-trend-chart beta-weekly-count-chart" role="img" aria-label="Fuel, hydration, and Low Energy logs by day">
        <div class="beta-trend-chart-legend" aria-hidden="true">
          <span><i class="fuel"></i>Fuel</span>
          <span><i class="hydration"></i>Hydration</span>
          <span><i class="crash"></i>Low Energy</span>
        </div>
        <div class="beta-trend-axis-copy">Y: log count · X: day/date</div>
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          <text class="y-label" x="8" y="${padding.top + 8}">${safeText(String(max))}</text>
          <text class="y-label" x="8" y="${padding.top + plotHeight}">0</text>
          ${points.map((point, index) => [
            bar(point, index, "fuel", -barWidth - 1.5, "fuel", "fuel logs"),
            bar(point, index, "hydration", 0, "hydration", "hydration logs"),
            bar(point, index, "lowEnergy", barWidth + 1.5, "crash", "Low Energy logs")
          ].join("")).join("")}
          ${points.map((point, index) => `<text class="x-label" x="${centerFor(index).toFixed(1)}" y="${height - 24}">${safeText(point.label)}</text>`).join("")}
        </svg>
      </div>
    `;
  }

  function renderWeeklyGraphs(entries, weekStart) {
    const fuelGapPoints = weeklySeriesPoints(entries, weekStart, entry => {
      const logs = logsForEntryType(entry, isFuelLog);
      if (logs.length < 2) return null;
      const gaps = gapsFromFuelLogs(logs);
      return gaps.length ? Math.max(...gaps.map(gap => Number(gap.minutes || 0))) : null;
    });
    const hydrationGapPoints = weeklySeriesPoints(entries, weekStart, entry => {
      const logs = logsForEntryType(entry, isHydrationLog);
      if (logs.length < 2) return null;
      const gaps = gapsFromHydrationLogs(logs);
      return gaps.length ? Math.max(...gaps.map(gap => Number(gap.minutes || 0))) : null;
    });
    const lowEnergyPoints = weeklySeriesPoints(entries, weekStart, entry => logsForEntryType(entry, isLowEnergyCheckinLog).length);
    return `
      <section class="beta-weekly-section beta-weekly-graphs-section">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("chart")}</span>
          <div>
            <h3>Weekly graphs</h3>
            <p>Selected week only. Blank points mean there was not enough data for that metric.</p>
          </div>
        </div>
        <div class="beta-weekly-graph-grid">
          <article class="beta-chart-card"><h4>Logs by day</h4>${renderWeeklyGroupedCountChart(entries, weekStart)}</article>
          <article class="beta-chart-card"><h4>Fuel gap trend</h4>${renderWeeklySingleLineChart(fuelGapPoints, { unit: "minutes", ariaLabel: "Longest fuel gap by day", yLabel: "longest fuel gap", colorClass: "fuel" })}</article>
          <article class="beta-chart-card"><h4>Hydration gap trend</h4>${renderWeeklySingleLineChart(hydrationGapPoints, { unit: "minutes", ariaLabel: "Longest hydration gap by day", yLabel: "longest hydration gap", colorClass: "hydration" })}</article>
          <article class="beta-chart-card"><h4>Low Energy trend</h4>${renderWeeklySingleLineChart(lowEnergyPoints, { unit: "count", ariaLabel: "Low Energy logs by day", yLabel: "Low Energy logs", colorClass: "crash" })}</article>
        </div>
      </section>
    `;
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

  function renderImpactTrendCard({ title, value, copy, icon = "route", tone = "neutral", current = null, previous = null, unit = "count", visual = "", showComparisonBars = true }) {
    return `
      <article class="beta-trend-pattern-card beta-impact-trend-card ${safeText(tone)}">
        <div class="beta-metric-card-head">
          <span class="beta-icon-disc ${tone === "elevated" ? "amber" : tone === "protected" ? "shield" : ""}">${dailyIcon(icon)}</span>
          <div><span>${safeText(title)}</span><strong>${safeText(value)}</strong></div>
        </div>
        ${visual}
        ${showComparisonBars && (Number.isFinite(current) || Number.isFinite(previous)) ? renderTrendMiniBars(current, previous, { unit }) : ""}
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
        ${renderWeeklyFuelLogTimeline(current)}
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
          showComparisonBars: false,
          visual: renderTrendLineChart(longestGapPoints, {
            ariaLabel: "Longest Fuel Gap this week versus last week line chart",
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
          showComparisonBars: false,
          visual: renderTrendLineChart(fuelDebtPoints, {
            ariaLabel: "Fuel Debt this week versus last week line chart",
            yLabel: "Fuel Debt"
          })
        })}
        <p class="muted beta-trend-filter-note">${safeText(trendFilterCopy())}</p>
      </section>
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



  function trendMetricDefinitions() {
    return [
      {
        id: "logs",
        title: "Logs by day",
        description: "Fuel and hydration logs per day.",
        icon: "chart",
        chart: "bar",
        unit: "count",
        yLabel: "Logs",
        aggregate: "sum",
        lowerIsBetter: null,
        valueForEntry: entry => logsForEntryType(entry, isFuelLog).length + logsForEntryType(entry, isHydrationLog).length,
        summaryLabel: "Fuel and hydration logs"
      },
      {
        id: "fuel-gap",
        title: "Fuel gap trend",
        description: "Longest fuel gap on each day.",
        icon: "fuel",
        chart: "line",
        unit: "minutes",
        yLabel: "Longest fuel gap",
        aggregate: "average",
        lowerIsBetter: true,
        valueForEntry: entry => {
          if (!entry) return null;
          const value = Number(entry.longestGapMinutes || 0);
          return value > 0 ? value : null;
        },
        summaryLabel: "Average daily longest fuel gap"
      },
      {
        id: "hydration-gap",
        title: "Hydration gap trend",
        description: "Longest hydration gap on each day.",
        icon: "hydration",
        chart: "line",
        unit: "minutes",
        yLabel: "Longest hydration gap",
        aggregate: "average",
        lowerIsBetter: true,
        valueForEntry: entry => {
          if (!entry) return null;
          const value = Number(entry.longestHydrationGapMinutes || 0);
          return value > 0 ? value : null;
        },
        summaryLabel: "Average daily longest hydration gap"
      },
      {
        id: "low-energy",
        title: "Low Energy trend",
        description: "Low Energy logs per day.",
        icon: "energy",
        chart: "bar",
        unit: "count",
        yLabel: "Low Energy logs",
        aggregate: "sum",
        lowerIsBetter: true,
        valueForEntry: entry => logsForEntryType(entry, isLowEnergyCheckinLog).length,
        summaryLabel: "Low Energy logs"
      },
      {
        id: "concentration",
        title: "Concentration trend",
        description: "Reduced or poor concentration check-ins per day.",
        icon: "energy",
        chart: "bar",
        unit: "count",
        yLabel: "Concentration check-ins",
        aggregate: "sum",
        lowerIsBetter: true,
        valueForEntry: entry => logsForEntryType(entry, isPoorConcentrationCheckinLog).length,
        summaryLabel: "Reduced concentration check-ins"
      }
    ];
  }

  function trendMetricById(id) {
    return trendMetricDefinitions().find(metric => metric.id === id) || trendMetricDefinitions()[0];
  }

  function trendEntryValue(entry, metric) {
    if (!entry) return null;
    const value = Number(metric.valueForEntry(entry));
    return Number.isFinite(value) ? Math.max(0, value) : null;
  }

  function trendComparisonPoints(metric, range, entries) {
    const currentEntries = entriesForRange(entries, range.start, range.end);
    const previousEntries = entriesForRange(entries, range.previousStart, range.previousEnd);
    const currentByDate = weeklyEntriesByDate(currentEntries);
    const previousByDate = weeklyEntriesByDate(previousEntries);
    return range.days.map((day, index) => {
      const currentKey = dateKey(day.currentDate);
      const previousKey = day.previousDate ? dateKey(day.previousDate) : "";
      return {
        index,
        label: day.label,
        shortLabel: day.shortLabel,
        dateLabel: day.dateLabel,
        previousDateLabel: day.previousDateLabel,
        currentKey,
        previousKey,
        current: trendEntryValue(currentByDate[currentKey], metric),
        previous: previousKey ? trendEntryValue(previousByDate[previousKey], metric) : null
      };
    });
  }

  function trendValues(points, key) {
    return points.map(point => point[key]).filter(value => Number.isFinite(value));
  }

  function trendAggregateValue(points, key, aggregate = "sum") {
    const values = trendValues(points, key);
    if (!values.length) return null;
    if (aggregate === "average") return averageValue(values);
    if (aggregate === "max") return Math.max(...values);
    return values.reduce((sum, value) => sum + value, 0);
  }

  function trendComparisonLabel(value, unit) {
    if (!Number.isFinite(value)) return "Not enough data";
    return unit === "minutes" ? compactDuration(value) : String(Math.round(value));
  }

  function trendDifferenceLabel(diff, unit) {
    const value = Math.abs(diff);
    return unit === "minutes" ? compactDuration(value) : String(Math.round(value));
  }

  function trendSummary(metric, currentValue, previousValue, range) {
    if (!Number.isFinite(currentValue) && !Number.isFinite(previousValue)) {
      return { tone: "neutral", label: "Building", copy: `Log more data to compare ${metric.summaryLabel.toLowerCase()}.` };
    }
    if (!Number.isFinite(previousValue)) {
      return { tone: "neutral", label: "Current only", copy: `${metric.summaryLabel} has ${range.currentLabel.toLowerCase()} data. ${range.previousLabel} needs more logs for comparison.` };
    }
    if (!Number.isFinite(currentValue)) {
      return { tone: "neutral", label: "Previous only", copy: `${range.currentLabel} needs more logs before Fuel Guard can compare this signal.` };
    }
    const diff = currentValue - previousValue;
    const tolerance = metric.unit === "minutes" ? 10 : 0.5;
    if (Math.abs(diff) <= tolerance) {
      return { tone: "neutral", label: "Staying similar", copy: `${metric.summaryLabel} is staying similar to ${range.previousLabel.toLowerCase()}.` };
    }
    const change = trendDifferenceLabel(diff, metric.unit);
    if (metric.lowerIsBetter === null) {
      return diff > 0
        ? { tone: "neutral", label: "More logs", copy: `${metric.summaryLabel} is up by ${change} compared with ${range.previousLabel.toLowerCase()}.` }
        : { tone: "neutral", label: "Fewer logs", copy: `${metric.summaryLabel} is down by ${change} compared with ${range.previousLabel.toLowerCase()}.` };
    }
    const improving = metric.lowerIsBetter ? diff < 0 : diff > 0;
    if (improving) {
      const direction = diff < 0 ? "down" : "up";
      return { tone: "protected", label: "Improving", copy: `${metric.summaryLabel} is ${direction} by ${change} compared with ${range.previousLabel.toLowerCase()}.` };
    }
    const direction = diff > 0 ? "up" : "down";
    return { tone: "elevated", label: "Needs attention", copy: `${metric.summaryLabel} is ${direction} by ${change} compared with ${range.previousLabel.toLowerCase()}.` };
  }

  function trendComparisonData() {
    const range = selectedTrendRange();
    const entries = archiveEntries();
    const currentEntries = entriesForRange(entries, range.start, range.end);
    const previousEntries = entriesForRange(entries, range.previousStart, range.previousEnd);
    const cards = trendMetricDefinitions().map(metric => {
      const points = trendComparisonPoints(metric, range, entries);
      const currentValue = trendAggregateValue(points, "current", metric.aggregate);
      const previousValue = trendAggregateValue(points, "previous", metric.aggregate);
      const summary = trendSummary(metric, currentValue, previousValue, range);
      return { metric, points, currentValue, previousValue, summary };
    });
    return { range, entries, currentEntries, previousEntries, cards };
  }

  function minuteOfDayFromDate(date) {
    return date ? date.getHours() * 60 + date.getMinutes() : null;
  }

  function averageMinutes(values) {
    const valid = values.filter(value => Number.isFinite(value));
    if (!valid.length) return null;
    return valid.reduce((sum, value) => sum + value, 0) / valid.length;
  }

  function clockFromMinuteOfDay(minutes) {
    if (!Number.isFinite(minutes)) return "Not enough data yet";
    const date = startOfDay();
    date.setMinutes(Math.round(minutes));
    return formatClock(date);
  }

  function logEventsForInsight(entry, predicate = () => true) {
    return entryLogsWithDates(entry)
      .filter(log => isFuelLog(log) || isHydrationLog(log))
      .filter(predicate)
      .sort((a, b) => a.date - b.date);
  }

  function averageBoundaryLogInsight(entries, boundary) {
    const values = entries.map(entry => {
      const logs = logEventsForInsight(entry);
      const log = boundary === "final" ? logs[logs.length - 1] : logs[0];
      return minuteOfDayFromDate(log?.date);
    }).filter(value => Number.isFinite(value));
    return {
      value: clockFromMinuteOfDay(averageMinutes(values)),
      detail: values.length ? `${values.length} day${values.length === 1 ? "" : "s"} with logs` : "Needs fuel or hydration logs"
    };
  }

  function averageBoundaryFuelLogInsight(entries, boundary) {
    const values = entries.map(entry => {
      const logs = logEventsForInsight(entry, isFuelLog);
      const log = boundary === "final" ? logs[logs.length - 1] : logs[0];
      return minuteOfDayFromDate(log?.date);
    }).filter(value => Number.isFinite(value));
    return {
      value: clockFromMinuteOfDay(averageMinutes(values)),
      detail: values.length ? `${values.length} day${values.length === 1 ? "" : "s"} with fuel logs` : "Needs fuel logs"
    };
  }

  function mostCommonValueInsight(values, fallback = "Not enough data yet") {
    const counts = new Map();
    values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    if (!counts.size) return { value: fallback, detail: "Needs matching saved days" };
    const [value, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
    return { value, detail: `${count} day${count === 1 ? "" : "s"}` };
  }

  function mostCommonDayTypeInsight(entries) {
    return mostCommonValueInsight(entries.map(entry => {
      const value = trendDayTypeValue(entry.dayType || dayTypeForKey(entry.date));
      return value ? dayTypeLabel(value) : "";
    }));
  }

  function mostCommonTrainingSessionInsight(entries) {
    return mostCommonValueInsight(entries.map(entry => {
      const value = entry.trainingSession || trainingSessionForKey(entry.date);
      return value ? trainingSessionLabel(value) : "";
    }));
  }

  function mostCommonLogHourInsight(entries, predicate) {
    const hours = entries.flatMap(entry => logEventsForInsight(entry, predicate))
      .map(log => log.date?.getHours())
      .filter(hour => Number.isInteger(hour));
    const counts = new Map();
    hours.forEach(hour => counts.set(hour, (counts.get(hour) || 0) + 1));
    if (!counts.size) return { value: "Not enough data yet", detail: "Needs matching logs" };
    const [hour, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    return { value: hourRangeLabel(hour), detail: `${count} log${count === 1 ? "" : "s"}` };
  }

  function gapHourBins(gap) {
    const start = logDate(gap?.start);
    const end = logDate(gap?.end);
    if (!start || !end || end <= start) return [];
    const startHour = clamp(Math.floor(minutesIntoDay(start) / 60), 0, 23);
    const endHour = clamp(Math.ceil(minutesIntoDay(end) / 60), startHour + 1, 24);
    return Array.from({ length: Math.max(0, endHour - startHour) }, (_, index) => startHour + index);
  }

  function significantGapWindows(entries, predicate, gapBuilder, minimumMinutes) {
    return entries.flatMap(entry => {
      const logs = logsForEntryType(entry, predicate);
      if (logs.length < 2) return [];
      return gapBuilder(logs)
        .map(gap => ({ ...gap, minutes: Number(gap.minutes || 0), bins: gapHourBins(gap) }))
        .filter(gap => gap.minutes >= minimumMinutes && gap.bins.length);
    });
  }

  function mostCommonGapWindowInsight(entries, predicate, gapBuilder, minimumMinutes) {
    const gaps = significantGapWindows(entries, predicate, gapBuilder, minimumMinutes);
    if (gaps.length < 2) return { value: "Not enough gap data yet.", detail: "Needs recurring significant gaps." };
    const counts = new Map();
    gaps.forEach(gap => {
      new Set(gap.bins).forEach(hour => counts.set(hour, (counts.get(hour) || 0) + 1));
    });
    const recurringHours = Array.from(counts.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => a[0] - b[0]);
    if (!recurringHours.length) return { value: "Not enough gap data yet.", detail: "No recurring gap window yet." };

    const runs = [];
    let current = [];
    recurringHours.forEach(item => {
      if (!current.length || item[0] === current[current.length - 1][0] + 1) current.push(item);
      else {
        runs.push(current);
        current = [item];
      }
    });
    if (current.length) runs.push(current);

    const best = runs.map(run => ({
      start: run[0][0],
      end: run[run.length - 1][0] + 1,
      score: run.reduce((sum, [, count]) => sum + count, 0),
      peak: Math.max(...run.map(([, count]) => count))
    })).sort((a, b) => b.score - a.score || b.peak - a.peak || (b.end - b.start) - (a.end - a.start) || a.start - b.start)[0];
    if (!best || best.peak < 2) return { value: "Not enough gap data yet.", detail: "Needs a repeated window." };
    return {
      value: `${hourClockLabel(best.start)}-${hourClockLabel(best.end)}`,
      detail: `${best.peak} recurring gap${best.peak === 1 ? "" : "s"} in this window`
    };
  }

  function entriesWithHabitData(entries) {
    return entries.some(entry => (
      logEventsForInsight(entry).length > 0
      || trendDayTypeValue(entry.dayType || dayTypeForKey(entry.date))
      || entry.trainingSession
    ));
  }

  function trendHabitInsightDefinitions(data, { includeDayType = true } = {}) {
    const insights = [
      {
        id: "first-log",
        title: "Average first log time",
        icon: "clock",
        current: averageBoundaryLogInsight(data.currentEntries, "first"),
        previous: averageBoundaryLogInsight(data.previousEntries, "first")
      },
      {
        id: "final-log",
        title: "Average final log time",
        icon: "clock",
        current: averageBoundaryLogInsight(data.currentEntries, "final"),
        previous: averageBoundaryLogInsight(data.previousEntries, "final")
      }
    ];
    if (includeDayType) {
      insights.push({
        id: "day-type",
        title: "Most common day type",
        icon: "route",
        current: mostCommonDayTypeInsight(data.currentEntries),
        previous: mostCommonDayTypeInsight(data.previousEntries)
      });
    }
    insights.push(
      {
        id: "session-type",
        title: "Most common session type",
        icon: "score",
        current: mostCommonTrainingSessionInsight(data.currentEntries),
        previous: mostCommonTrainingSessionInsight(data.previousEntries)
      },
      {
        id: "fuel-hour",
        title: "Most common fuelling hour",
        icon: "fuel",
        current: mostCommonLogHourInsight(data.currentEntries, isFuelLog),
        previous: mostCommonLogHourInsight(data.previousEntries, isFuelLog)
      },
      {
        id: "hydration-hour",
        title: "Most common hydration hour",
        icon: "hydration",
        current: mostCommonLogHourInsight(data.currentEntries, isHydrationLog),
        previous: mostCommonLogHourInsight(data.previousEntries, isHydrationLog)
      },
      {
        id: "fuel-gap-window",
        title: "Most common fuel-gap window",
        icon: "fuel",
        current: mostCommonGapWindowInsight(data.currentEntries, isFuelLog, gapsFromFuelLogs, mediumRiskLimit()),
        previous: mostCommonGapWindowInsight(data.previousEntries, isFuelLog, gapsFromFuelLogs, mediumRiskLimit())
      },
      {
        id: "hydration-gap-window",
        title: "Most common hydration-gap window",
        icon: "hydration",
        current: mostCommonGapWindowInsight(data.currentEntries, isHydrationLog, gapsFromHydrationLogs, hydrationGreenLimit()),
        previous: mostCommonGapWindowInsight(data.previousEntries, isHydrationLog, gapsFromHydrationLogs, hydrationGreenLimit())
      }
    );
    return insights;
  }

  function trendHabitInsightMap(data) {
    return Object.fromEntries(trendHabitInsightDefinitions(data).map(insight => [insight.id, insight]));
  }

  function renderTrendHabitMetricCard(insight, data) {
    if (!insight) return "";
    return `
      <article class="beta-trend-habit-card ${safeText(insight.id)}">
        <span class="beta-icon-disc ${insight.id.includes("hydration") ? "shield" : insight.id.includes("fuel") ? "amber" : ""}">${dailyIcon(insight.icon)}</span>
        <div>
          <h4>${safeText(insight.title)}</h4>
          <div class="beta-trend-habit-values">
            <span><b>${safeText(data.range.currentLabel)}</b><strong>${safeText(insight.current.value)}</strong><small>${safeText(insight.current.detail)}</small></span>
            <span><b>${safeText(data.range.previousLabel)}</b><strong>${safeText(insight.previous.value)}</strong><small>${safeText(insight.previous.detail)}</small></span>
          </div>
        </div>
      </article>
    `;
  }

  function renderTrendHabitGroup(title, insights, data) {
    const cards = insights.filter(Boolean).map(insight => renderTrendHabitMetricCard(insight, data)).join("");
    if (!cards) return "";
    return `
      <div class="beta-trend-habit-group">
        <h4>${safeText(title)}</h4>
        <div class="beta-trend-habit-grid">${cards}</div>
      </div>
    `;
  }

  function renderTrendHabitInsights(data) {
    const insights = trendHabitInsightMap(data);
    const hasData = entriesWithHabitData(data.currentEntries) || entriesWithHabitData(data.previousEntries);
    return `
      <section class="beta-trend-habit-section" aria-label="Habit insights">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("chart")}</span>
          <div>
            <h3>Fuel Gap Windows &amp; Log Windows</h3>
            <p>${safeText(data.range.label)} compared with ${safeText(data.range.previousLabelText)}.</p>
          </div>
        </div>
        ${hasData ? `
          <div class="beta-trend-habit-groups">
            ${renderTrendHabitGroup("Fuel Gap Windows", [insights["fuel-gap-window"], insights["hydration-gap-window"]], data)}
            ${renderTrendHabitGroup("Log Windows", [insights["first-log"], insights["final-log"], insights["fuel-hour"], insights["hydration-hour"]], data)}
          </div>
        ` : `<p class="muted beta-history-empty">Not enough log-window data yet.</p>`}
      </section>
    `;
  }

  function logsPerDayText(value) {
    return Number.isFinite(value) ? `${value.toFixed(1)} logs/day` : "Not enough data";
  }

  function logFrequencyDifference(currentAverage, previousAverage) {
    if (!Number.isFinite(currentAverage) || !Number.isFinite(previousAverage)) return { tone: "neutral", label: "Needs more comparison data" };
    const diff = currentAverage - previousAverage;
    if (Math.abs(diff) < 0.05) return { tone: "neutral", label: "Staying similar" };
    const amount = Math.abs(diff).toFixed(1);
    return diff > 0
      ? { tone: "neutral", label: `Increase of ${amount} logs per day` }
      : { tone: "protected", label: `Decrease of ${amount} logs per day` };
  }

  function renderLogHabits(data) {
    const insights = trendHabitInsightMap(data);
    const logsCard = data.cards.find(card => card.metric.id === "logs");
    const currentTotal = Number(logsCard?.currentValue);
    const previousTotal = Number(logsCard?.previousValue);
    const currentDays = Math.max(1, data.range.days.length);
    const previousDays = Math.max(1, data.range.days.filter(day => day.previousDate).length || currentDays);
    const currentAverage = Number.isFinite(currentTotal) ? currentTotal / currentDays : null;
    const previousAverage = Number.isFinite(previousTotal) ? previousTotal / previousDays : null;
    const outcome = logFrequencyDifference(currentAverage, previousAverage);
    const hasData = entriesWithHabitData(data.currentEntries) || entriesWithHabitData(data.previousEntries) || Number.isFinite(currentAverage) || Number.isFinite(previousAverage);
    return `
      <section class="beta-trend-habit-section beta-log-habits-section" aria-label="Log Habits">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("score")}</span>
          <div>
            <h3>Log Habits</h3>
            <p>Context and logging frequency for the selected period.</p>
          </div>
        </div>
        ${hasData ? `
          <div class="beta-trend-habit-groups">
            ${renderTrendHabitGroup("Log context", [insights["session-type"], insights["day-type"]], data)}
            <div class="beta-trend-habit-group">
              <h4>Logging frequency</h4>
              <div class="beta-trend-habit-grid">
                <article class="beta-trend-habit-card beta-log-frequency-card">
                  <span class="beta-icon-disc">${dailyIcon("chart")}</span>
                  <div>
                    <h4>Logs by day</h4>
                    <div class="beta-trend-habit-values">
                      <span><b>${safeText(data.range.currentLabel)}</b><strong>${safeText(logsPerDayText(currentAverage))}</strong><small>${Number.isFinite(currentTotal) ? `${Math.round(currentTotal)} total logs` : "Needs matching logs"}</small></span>
                      <span><b>${safeText(data.range.previousLabel)}</b><strong>${safeText(logsPerDayText(previousAverage))}</strong><small>${Number.isFinite(previousTotal) ? `${Math.round(previousTotal)} total logs` : "Needs matching logs"}</small></span>
                    </div>
                    <small class="beta-gap-insight-outcome ${safeText(outcome.tone)}">${safeText(outcome.label)}</small>
                  </div>
                </article>
              </div>
            </div>
          </div>
        ` : `<p class="muted beta-history-empty">Not enough log habit data yet.</p>`}
      </section>
    `;
  }

  function relevantEntriesForPersonalisedInsights(data, lookbackDays = 84) {
    const end = startOfDay(data?.range?.end || new Date());
    const start = addDays(end, -lookbackDays);
    return entriesForRange(archiveEntries(), start, end)
      .filter(entry => {
        const hasLogs = (entry.logs || []).length > 0 || Number(entry.fuelLogCount || 0) > 0 || Number(entry.hydrationLogCount || 0) > 0;
        const hasDemand = demandBlocksForDay(entry.date).length > 0;
        return hasLogs || hasDemand;
      })
      .sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));
  }

  function distinctWeekCountForSignals(signals) {
    return new Set(signals.map(signal => dateKey(startOfCalendarWeek(signal.date)))).size;
  }

  function weekdayLabel(date) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }

  function isTrainingSessionSet(value) {
    const next = String(value || "").trim();
    return Boolean(next && next !== "rest");
  }

  function isOvernightBlock(block) {
    const range = blockRange(block);
    if (!range) return false;
    return dateKey(range.start) !== dateKey(range.end)
      || range.end.getHours() < range.start.getHours();
  }

  function rangesOverlapMinutes(aStart, aEnd, bStart, bEnd) {
    if (!aStart || !aEnd || !bStart || !bEnd) return 0;
    return Math.max(0, (Math.min(aEnd, bEnd) - Math.max(aStart, bStart)) / 60000);
  }

  function opportunityIsScored(opportunity) {
    return ["completed_on_time", "completed_late", "overdue", "missed"].includes(opportunity?.status)
      && Number.isFinite(Number(opportunity.timingScore));
  }

  function opportunityDelayMinutes(opportunity) {
    const completed = logDate(opportunity?.completedAt);
    const start = logDate(opportunity?.plannedStart);
    const end = logDate(opportunity?.plannedEnd);
    if (completed && start && end) return minutesOutsideWindow(completed, start, end);
    if (opportunity?.status === "overdue" || opportunity?.status === "missed") return OPPORTUNITY_RULES.missedAfterMinutes;
    return 0;
  }

  function scoreForOpportunityGroup(opportunities) {
    const scored = opportunities.filter(opportunityIsScored);
    return scored.length ? weightedOpportunityAverage(scored) : null;
  }

  function workShiftSignalsForDay(day) {
    return day.workBlocks.map(block => {
      const range = blockRange(block);
      const opportunities = day.opportunities.filter(item => item.demandBlockId === block.id && opportunityTypeGroup(item.type) === "work");
      return {
        day,
        block,
        range,
        date: day.date,
        isOvernight: isOvernightBlock(block),
        score: scoreForOpportunityGroup(opportunities),
        opportunities
      };
    }).filter(signal => signal.range);
  }

  function workBreakSignalsForDay(day) {
    return day.workBlocks.flatMap(block => {
      const breaks = workBreaksForBlock(block.id)
        .map(item => ({ item, range: workBreakRange(item, block) }))
        .filter(item => item.range)
        .sort((a, b) => a.range.start - b.range.start);
      const opportunities = day.opportunities
        .filter(item => item.type === "work_break" && item.demandBlockId === block.id)
        .sort((a, b) => logDate(a.plannedStart) - logDate(b.plannedStart));
      return breaks.map((item, index) => {
        const opportunity = opportunities.find(candidate => {
          const start = logDate(candidate.plannedStart);
          const end = logDate(candidate.plannedEnd);
          return start && end
            && Math.abs(start - item.range.start) < 60000
            && Math.abs(end - item.range.end) < 60000;
        }) || opportunities[index] || null;
        return {
          day,
          block,
          break: item.item,
          breakOrder: index + 1,
          isFirstBreak: index === 0,
          isOvernight: isOvernightBlock(block),
          opportunity,
          delayMinutes: opportunity ? opportunityDelayMinutes(opportunity) : 0,
          delayedOrMissed: opportunity ? ["completed_late", "overdue", "missed"].includes(opportunity.status) : false,
          score: opportunity && Number.isFinite(Number(opportunity.timingScore)) ? Number(opportunity.timingScore) : null,
          date: day.date
        };
      });
    });
  }

  function trainingOpportunitySignalsForDay(day) {
    return day.opportunities
      .filter(item => opportunityTypeGroup(item.type) === "training")
      .filter(opportunityIsScored)
      .map(opportunity => ({
        day,
        opportunity,
        category: opportunity.type,
        score: Number(opportunity.timingScore),
        delayMinutes: opportunityDelayMinutes(opportunity),
        isWorkday: day.hasWork,
        date: day.date
      }));
  }

  function fuelGapSignalsForDay(day) {
    return gapsFromFuelLogs(day.fuelLogs)
      .map(gap => ({
        day,
        date: day.date,
        start: gap.start instanceof Date ? gap.start : logDate(gap.start),
        end: gap.end instanceof Date ? gap.end : logDate(gap.end),
        minutes: Number(gap.minutes || 0)
      }))
      .filter(gap => gap.start && gap.end && Number.isFinite(gap.minutes) && gap.minutes > 0)
      .map(gap => {
        const overlapsWork = day.workBlocks.some(block => {
          const range = blockRange(block);
          return range && rangesOverlapMinutes(gap.start, gap.end, range.start, range.end) > 0;
        });
        const phase = trainingGapPhase(gap, day.trainingBlocks);
        return { ...gap, overlapsWork, trainingPhase: phase };
      });
  }

  function trainingGapPhase(gap, blocks) {
    const candidates = blocks
      .map(block => blockRange(block))
      .filter(Boolean)
      .map(range => {
        if (rangesOverlapMinutes(gap.start, gap.end, range.start, range.end) > 0) return { phase: "during", distance: 0 };
        if (gap.end <= range.start) return { phase: "before", distance: (range.start - gap.end) / 60000 };
        if (gap.start >= range.end) return { phase: "after", distance: (gap.start - range.end) / 60000 };
        return null;
      })
      .filter(candidate => candidate && candidate.distance <= 360)
      .sort((a, b) => a.distance - b.distance);
    return candidates[0]?.phase || "";
  }

  function buildPersonalisedDaySignal(entry) {
    const date = dateFromKey(entry.date);
    const blocks = demandBlocksForDay(entry.date);
    const workBlocks = blocks.filter(block => block.type === "work");
    const trainingBlocks = blocks.filter(block => block.type === "training");
    const score = calculateDailyFuelScore(entry.date);
    const logs = entryLogsWithDates(entry);
    const hasWork = workBlocks.length > 0 || trendDayTypeValue(entry.dayType || dayTypeForKey(entry.date)) === "work";
    const hasTraining = trainingBlocks.length > 0 || isTrainingSessionSet(entry.trainingSession || trainingSessionForKey(entry.date));
    const signal = {
      entry,
      key: entry.date,
      date,
      weekday: date.getDay(),
      weekdayLabel: weekdayLabel(date),
      blocks,
      workBlocks,
      trainingBlocks,
      hasWork,
      hasTraining,
      hasBoth: hasWork && hasTraining,
      score: score.finalScore,
      scoreData: score,
      opportunities: score.opportunities,
      logs,
      fuelLogs: logs.filter(isFuelLog)
    };
    signal.workShifts = workShiftSignalsForDay(signal);
    signal.workBreaks = workBreakSignalsForDay(signal);
    signal.trainingOpportunities = trainingOpportunitySignalsForDay(signal);
    signal.fuelGaps = fuelGapSignalsForDay(signal);
    return signal;
  }

  function personalisedInsightContext(data = trendComparisonData()) {
    const entries = relevantEntriesForPersonalisedInsights(data);
    const days = entries.map(buildPersonalisedDaySignal)
      .filter(day => day.date && Number.isFinite(day.score));
    return {
      data,
      entries,
      days,
      workShifts: days.flatMap(day => day.workShifts),
      workBreaks: days.flatMap(day => day.workBreaks),
      trainingOpportunities: days.flatMap(day => day.trainingOpportunities),
      fuelGaps: days.flatMap(day => day.fuelGaps)
    };
  }

  function averageSignalValue(signals, selector) {
    return averageValue(signals.map(selector).filter(Number.isFinite));
  }

  function recentSignalBoost(signals) {
    const latest = signals
      .map(signal => signal.date)
      .filter(Boolean)
      .sort((a, b) => b - a)[0];
    if (!latest) return 0;
    const daysAgo = Math.max(0, (new Date() - latest) / 86400000);
    if (daysAgo <= 14) return 8;
    if (daysAgo <= 35) return 4;
    return 0;
  }

  function personalisedInsightRank({ frequency = 0, magnitude = 0, signals = [], relevance = 0, actionable = 0 } = {}) {
    return frequency * 4 + Math.min(40, magnitude) + recentSignalBoost(signals) + relevance + actionable;
  }

  function insightCandidate({ id, category, text, detail = "", icon = "chart", tone = "neutral", frequency = 0, magnitude = 0, signals = [], relevance = 0, actionable = 8, evidence = "" }) {
    return {
      id,
      category,
      text,
      detail,
      icon,
      tone,
      frequency,
      magnitude,
      evidence,
      rank: personalisedInsightRank({ frequency, magnitude, signals, relevance, actionable })
    };
  }

  function lowerScoreCopy(labelA, averageA, labelB, averageB) {
    const diff = Math.round(Math.abs(averageA - averageB));
    return `${labelA} average ${diff} Fuel Score point${diff === 1 ? "" : "s"} lower than ${labelB}.`;
  }

  function scoreComparisonInsight({ id, category, labelA, labelB, groupA, groupB, icon = "score", tone = "elevated", relevance = 0 }) {
    if (groupA.length < 2 || groupB.length < 2) return null;
    const averageA = averageSignalValue(groupA, signal => signal.score);
    const averageB = averageSignalValue(groupB, signal => signal.score);
    if (!Number.isFinite(averageA) || !Number.isFinite(averageB)) return null;
    const diff = averageA - averageB;
    if (Math.abs(diff) < 10) return null;
    const lowerLabel = diff < 0 ? labelA : labelB;
    const higherLabel = diff < 0 ? labelB : labelA;
    const lowerAverage = diff < 0 ? averageA : averageB;
    const higherAverage = diff < 0 ? averageB : averageA;
    return insightCandidate({
      id,
      category,
      text: lowerScoreCopy(lowerLabel, lowerAverage, higherLabel, higherAverage),
      detail: `${Math.round(lowerAverage)}/100 vs ${Math.round(higherAverage)}/100 across repeated days.`,
      icon,
      tone,
      frequency: Math.min(groupA.length, groupB.length),
      magnitude: Math.abs(diff),
      signals: [...groupA, ...groupB],
      relevance
    });
  }

  function weekdayFuelScoreInsight(context) {
    const groups = new Map();
    context.days.forEach(day => {
      if (!groups.has(day.weekday)) groups.set(day.weekday, []);
      groups.get(day.weekday).push(day);
    });
    const eligible = Array.from(groups.entries())
      .map(([weekday, days]) => ({
        weekday,
        days,
        weeks: distinctWeekCountForSignals(days),
        average: averageSignalValue(days, day => day.score),
        label: days[0]?.weekdayLabel || ""
      }))
      .filter(group => group.days.length >= 3 && group.weeks >= 3 && Number.isFinite(group.average));
    if (eligible.length < 2) return null;
    const sorted = eligible.sort((a, b) => a.average - b.average);
    const lowest = sorted[0];
    const others = sorted.slice(1);
    const comparisonAverage = averageValue(others.map(group => group.average).filter(Number.isFinite));
    if (!Number.isFinite(comparisonAverage)) return null;
    const diff = comparisonAverage - lowest.average;
    if (diff < 10) return null;
    const copy = lowest.weeks >= 3
      ? `${lowest.label} has been your lowest-scoring day over the last ${lowest.weeks} weeks.`
      : `Your Fuel Score has been lower on recent ${lowest.label}s.`;
    return insightCandidate({
      id: "weekday-fuel-score",
      category: "weekday",
      text: copy,
      detail: `${Math.round(lowest.average)}/100 average, ${Math.round(diff)} points below your other repeated weekdays.`,
      icon: "clock",
      tone: "elevated",
      frequency: lowest.days.length,
      magnitude: diff,
      signals: lowest.days,
      relevance: 4
    });
  }

  function dayTypeFuelScoreInsights(context) {
    const workdays = context.days.filter(day => day.hasWork);
    const nonWorkdays = context.days.filter(day => !day.hasWork);
    const trainingDays = context.days.filter(day => day.hasTraining);
    const nonTrainingDays = context.days.filter(day => !day.hasTraining);
    const bothDays = context.days.filter(day => day.hasBoth);
    const notBothDays = context.days.filter(day => !day.hasBoth);
    return [
      scoreComparisonInsight({
        id: "workday-score",
        category: "day-score",
        labelA: "Workdays",
        labelB: "Non-workdays",
        groupA: workdays,
        groupB: nonWorkdays,
        icon: "route",
        relevance: 6
      }),
      scoreComparisonInsight({
        id: "training-day-score",
        category: "day-score",
        labelA: "Training days",
        labelB: "Non-training days",
        groupA: trainingDays,
        groupB: nonTrainingDays,
        icon: "score",
        relevance: 5
      }),
      scoreComparisonInsight({
        id: "work-training-score",
        category: "combined-day-score",
        labelA: "Work-and-training days",
        labelB: "Other days",
        groupA: bothDays,
        groupB: notBothDays,
        icon: "warning",
        relevance: 9
      })
    ].filter(Boolean);
  }

  function shiftTimingInsight(context) {
    const dayShifts = context.workShifts.filter(shift => !shift.isOvernight && Number.isFinite(shift.score));
    const overnightShifts = context.workShifts.filter(shift => shift.isOvernight && Number.isFinite(shift.score));
    const candidate = scoreComparisonInsight({
      id: "overnight-shift-score",
      category: "shift",
      labelA: "Overnight shifts",
      labelB: "Day shifts",
      groupA: overnightShifts,
      groupB: dayShifts,
      icon: "clock",
      relevance: 8
    });
    if (candidate) return candidate;

    const overnightBreaks = context.workBreaks.filter(item => item.isOvernight);
    const dayBreaks = context.workBreaks.filter(item => !item.isOvernight);
    if (overnightBreaks.length < 2 || dayBreaks.length < 2) return null;
    const overnightDelay = averageSignalValue(overnightBreaks, item => item.delayMinutes);
    const dayDelay = averageSignalValue(dayBreaks, item => item.delayMinutes);
    if (!Number.isFinite(overnightDelay) || !Number.isFinite(dayDelay) || Math.abs(overnightDelay - dayDelay) < 30) return null;
    const delayedLabel = overnightDelay > dayDelay ? "night shifts" : "day shifts";
    const diff = Math.round(Math.abs(overnightDelay - dayDelay));
    return insightCandidate({
      id: "shift-break-delay",
      category: "shift",
      text: `Work-break fuelling is delayed by about ${diff} minutes more on ${delayedLabel}.`,
      detail: "Break timing is inferred from your saved work shifts and flexible break windows.",
      icon: "clock",
      tone: "elevated",
      frequency: Math.min(overnightBreaks.length, dayBreaks.length),
      magnitude: diff / 3,
      signals: [...overnightBreaks, ...dayBreaks],
      relevance: 8
    });
  }

  function workBreakOrderInsight(context) {
    const first = context.workBreaks.filter(item => item.isFirstBreak);
    const later = context.workBreaks.filter(item => !item.isFirstBreak);
    if (first.length < 2 || later.length < 2) return null;
    const firstDelay = averageSignalValue(first, item => item.delayMinutes);
    const laterDelay = averageSignalValue(later, item => item.delayMinutes);
    const firstMissRate = first.filter(item => item.delayedOrMissed).length / first.length;
    const laterMissRate = later.filter(item => item.delayedOrMissed).length / later.length;
    const delayDiff = firstDelay - laterDelay;
    const missDiff = firstMissRate - laterMissRate;
    if (Number.isFinite(delayDiff) && Math.abs(delayDiff) >= 30) {
      const label = delayDiff > 0 ? "first work break" : "later work breaks";
      return insightCandidate({
        id: "work-break-order-delay",
        category: "break-order",
        text: `You tend to delay your ${label} by about ${Math.round(Math.abs(delayDiff))} minutes more.`,
        detail: "Break order is based on chronological order inside each shift.",
        icon: "route",
        tone: "elevated",
        frequency: Math.min(first.length, later.length),
        magnitude: Math.abs(delayDiff) / 3,
        signals: [...first, ...later],
        relevance: 9
      });
    }
    if (Math.abs(missDiff) >= 0.25) {
      const label = missDiff > 0 ? "first work break" : "later work breaks";
      return insightCandidate({
        id: "work-break-order-missed",
        category: "break-order",
        text: `${label[0].toUpperCase()}${label.slice(1)} are delayed or missed more often.`,
        detail: `${Math.round(Math.max(firstMissRate, laterMissRate) * 100)}% of matching break windows were delayed or missed.`,
        icon: "route",
        tone: "elevated",
        frequency: Math.min(first.length, later.length),
        magnitude: Math.abs(missDiff) * 40,
        signals: [...first, ...later],
        relevance: 9
      });
    }
    return null;
  }

  function trainingOpportunityCategoryInsight(context) {
    const pre = context.trainingOpportunities.filter(item => item.category === "pre_training");
    const post = context.trainingOpportunities.filter(item => item.category === "post_training");
    if (pre.length < 2 || post.length < 2) return null;
    const preAverage = averageSignalValue(pre, item => item.score);
    const postAverage = averageSignalValue(post, item => item.score);
    if (!Number.isFinite(preAverage) || !Number.isFinite(postAverage)) return null;
    const diff = postAverage - preAverage;
    if (Math.abs(diff) < 10) return null;
    const stronger = diff > 0 ? "post-training" : "pre-training";
    const softer = diff > 0 ? "pre-training" : "post-training";
    return insightCandidate({
      id: "pre-post-training-adherence",
      category: "training-adherence",
      text: `Your ${stronger} fuel adherence is ${Math.round(Math.abs(diff))} points stronger than ${softer}.`,
      detail: "Training timing uses matched fuel suggestions.",
      icon: "score",
      tone: "protected",
      frequency: Math.min(pre.length, post.length),
      magnitude: Math.abs(diff),
      signals: [...pre, ...post],
      relevance: 8
    });
  }

  function trainingAdherenceWorkdayInsight(context) {
    const workdayTraining = context.trainingOpportunities.filter(item => item.isWorkday);
    const nonWorkdayTraining = context.trainingOpportunities.filter(item => !item.isWorkday);
    if (workdayTraining.length < 2 || nonWorkdayTraining.length < 2) return null;
    const workAverage = averageSignalValue(workdayTraining, item => item.score);
    const nonWorkAverage = averageSignalValue(nonWorkdayTraining, item => item.score);
    if (!Number.isFinite(workAverage) || !Number.isFinite(nonWorkAverage)) return null;
    const diff = workAverage - nonWorkAverage;
    if (Math.abs(diff) < 10) return null;
    const stronger = diff > 0 ? "workdays" : "non-workdays";
    const lower = diff > 0 ? "non-workdays" : "workdays";
    return insightCandidate({
      id: "training-workday-adherence",
      category: "training-adherence",
      text: `Training fuel adherence is ${Math.round(Math.abs(diff))} points stronger on ${stronger}.`,
      detail: `${lower[0].toUpperCase()}${lower.slice(1)} may need a simpler fuel cue around training.`,
      icon: "score",
      tone: diff < 0 ? "elevated" : "protected",
      frequency: Math.min(workdayTraining.length, nonWorkdayTraining.length),
      magnitude: Math.abs(diff),
      signals: [...workdayTraining, ...nonWorkdayTraining],
      relevance: 10
    });
  }

  function workGapInsight(context) {
    const duringWork = context.fuelGaps.filter(gap => gap.overlapsWork);
    const outsideWork = context.fuelGaps.filter(gap => !gap.overlapsWork);
    if (duringWork.length < 3 || outsideWork.length < 3) return null;
    const workAverage = averageSignalValue(duringWork, gap => gap.minutes);
    const outsideAverage = averageSignalValue(outsideWork, gap => gap.minutes);
    if (!Number.isFinite(workAverage) || !Number.isFinite(outsideAverage) || Math.abs(workAverage - outsideAverage) < 30) return null;
    const longerLabel = workAverage > outsideAverage ? "during work shifts" : "outside work shifts";
    const diff = Math.round(Math.abs(workAverage - outsideAverage));
    return insightCandidate({
      id: "work-fuel-gaps",
      category: "fuel-gap-context",
      text: `Your fuel gaps are about ${diff} minutes longer ${longerLabel}.`,
      detail: "This compares gaps that overlap saved work blocks with gaps outside work blocks.",
      icon: "gap",
      tone: workAverage > outsideAverage ? "elevated" : "neutral",
      frequency: Math.min(duringWork.length, outsideWork.length),
      magnitude: diff / 3,
      signals: [...duringWork, ...outsideWork],
      relevance: 8
    });
  }

  function trainingGapInsight(context) {
    const groups = ["before", "during", "after"].map(phase => {
      const gaps = context.fuelGaps.filter(gap => gap.trainingPhase === phase);
      return { phase, gaps, average: averageSignalValue(gaps, gap => gap.minutes) };
    }).filter(group => group.gaps.length >= 3 && Number.isFinite(group.average));
    if (groups.length < 2) return null;
    const sorted = groups.sort((a, b) => b.average - a.average);
    const longest = sorted[0];
    const comparison = averageValue(sorted.slice(1).map(group => group.average));
    if (!Number.isFinite(comparison) || longest.average - comparison < 30) return null;
    const phaseLabel = {
      before: "before training",
      during: "during training",
      after: "after training"
    }[longest.phase] || "around training";
    return insightCandidate({
      id: "training-fuel-gap-phase",
      category: "fuel-gap-context",
      text: `Your longest fuel gaps tend to happen ${phaseLabel}.`,
      detail: `${duration(longest.average)} average gap in that window.`,
      icon: "gap",
      tone: "elevated",
      frequency: longest.gaps.length,
      magnitude: (longest.average - comparison) / 3,
      signals: longest.gaps,
      relevance: 7
    });
  }

  function latestDayGapObservation(context) {
    const entry = [...context.entries].reverse().find(item => entryLogsWithDates(item).filter(isFuelLog).length >= 2);
    if (!entry) return null;
    const fuelLogs = entryLogsWithDates(entry).filter(isFuelLog);
    const longest = longestGapForLogs(fuelLogs, gapsFromFuelLogs, entry.date, new Date());
    if (!longest) return null;
    const debt = Number(buildArchiveEntry(entry.date).fuelDebtMinutes || entry.fuelDebtMinutes || 0);
    if (longest.minutes < mediumRiskLimit() && debt <= 0) return null;
    return insightCandidate({
      id: "latest-day-gap-observation",
      category: "gap",
      text: debt > 0
        ? `On your latest logged day, ${fuelDebtDurationText(debt)} sat beyond your preferred fuelling window.`
        : `On your latest logged day, your longest fuel gap was ${duration(longest.minutes)}.`,
      detail: "This is a single-day replay signal, not a repeated pattern yet.",
      icon: "gap",
      tone: "elevated",
      frequency: 1,
      magnitude: Math.max(longest.minutes / 3, debt / 3),
      signals: [entry],
      relevance: 2,
      actionable: 4,
      evidence: "Snapshot"
    });
  }

  function logHabitObservation(context) {
    const entries = context.entries.filter(entry => {
      const logs = entryLogsWithDates(entry);
      return logs.filter(isFuelLog).length || logs.filter(isHydrationLog).length;
    });
    if (entries.length < 2) return null;
    const fuelAverage = averageValue(entries.map(entry => entryLogsWithDates(entry).filter(isFuelLog).length));
    const hydrationAverage = averageValue(entries.map(entry => entryLogsWithDates(entry).filter(isHydrationLog).length));
    if (!Number.isFinite(fuelAverage) && !Number.isFinite(hydrationAverage)) return null;
    return insightCandidate({
      id: "recent-log-habit-observation",
      category: "habit",
      text: `Across your recent logged days, you average ${Number.isFinite(fuelAverage) ? fuelAverage.toFixed(1) : "0"} fuel logs and ${Number.isFinite(hydrationAverage) ? hydrationAverage.toFixed(1) : "0"} hydration logs.`,
      detail: "This helps show logging rhythm before stronger patterns are available.",
      icon: "chart",
      tone: "neutral",
      frequency: entries.length,
      magnitude: Math.max(fuelAverage || 0, hydrationAverage || 0),
      signals: entries,
      relevance: 2,
      actionable: 3,
      evidence: entries.length >= 3 ? "Early pattern" : "Limited evidence"
    });
  }

  function timingObservation(context) {
    const entries = context.entries
      .map(entry => {
        const fuelLogs = entryLogsWithDates(entry).filter(isFuelLog).sort((a, b) => a.date - b.date);
        return { entry, first: fuelLogs[0]?.date || null };
      })
      .filter(item => item.first);
    if (entries.length < 2) return null;
    const averageMinute = averageValue(entries.map(item => item.first.getHours() * 60 + item.first.getMinutes()));
    if (!Number.isFinite(averageMinute)) return null;
    const hours = Math.floor(averageMinute / 60);
    const minutes = Math.round(averageMinute % 60);
    const labelDate = new Date();
    labelDate.setHours(hours, minutes, 0, 0);
    return insightCandidate({
      id: "recent-first-fuel-timing",
      category: "timing",
      text: `Your first fuel log has recently tended to land around ${formatClock(labelDate)}.`,
      detail: "Use this as a timing cue, not a rule.",
      icon: "clock",
      tone: "neutral",
      frequency: entries.length,
      magnitude: entries.length,
      signals: entries.map(item => item.entry),
      relevance: 3,
      actionable: 5,
      evidence: entries.length >= 3 ? "Early pattern" : "Limited evidence"
    });
  }

  function personalisedInsightCandidates(data = trendComparisonData()) {
    const context = personalisedInsightContext(data);
    const candidates = [
      weekdayFuelScoreInsight(context),
      ...dayTypeFuelScoreInsights(context),
      shiftTimingInsight(context),
      workBreakOrderInsight(context),
      trainingOpportunityCategoryInsight(context),
      trainingAdherenceWorkdayInsight(context),
      workGapInsight(context),
      trainingGapInsight(context),
      latestDayGapObservation(context),
      logHabitObservation(context),
      timingObservation(context)
    ].filter(Boolean);
    return { context, candidates };
  }

  function personalisedInsightEvidenceLabel(insight) {
    if (insight.evidence) return insight.evidence;
    const frequency = Number(insight.frequency || 0);
    const weeks = distinctWeekCountForSignals(insight.signals || []);
    if (frequency >= 6 && weeks >= 3) return "Repeated pattern";
    if (frequency >= 3) return "Emerging pattern";
    if (frequency >= 2) return "Limited evidence";
    return "Snapshot";
  }

  function selectPersonalisedInsights(candidates, limit = 3) {
    const dedupeKey = candidate => {
      const category = String(candidate?.category || "");
      if (category.includes("gap")) return "gap";
      if (category.includes("training")) return "training";
      if (category.includes("day-score") || category === "weekday") return "score";
      return category || candidate.id;
    };
    const seen = new Set();
    return [...candidates]
      .sort((a, b) => b.rank - a.rank || b.magnitude - a.magnitude || b.frequency - a.frequency)
      .filter(candidate => {
        const key = dedupeKey(candidate);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }

  function personalisedInsights(data = trendComparisonData()) {
    return selectPersonalisedInsights(personalisedInsightCandidates(data).candidates);
  }

  function renderPersonalisedInsights(data) {
    const firstFuel = averageBoundaryFuelLogInsight(data.currentEntries, "first");
    const fuelGapWindow = mostCommonGapWindowInsight(data.currentEntries, isFuelLog, gapsFromFuelLogs, mediumRiskLimit());
    const finalFuel = averageBoundaryFuelLogInsight(data.currentEntries, "final");
    const metrics = [
      { label: "Average first log", value: firstFuel.value, detail: firstFuel.detail, icon: "clock" },
      { label: "Most common fuelling gap", value: fuelGapWindow.value, detail: fuelGapWindow.detail, icon: "route" },
      { label: "Average final log", value: finalFuel.value, detail: finalFuel.detail, icon: "clock" }
    ];
    return `
      <section class="beta-trend-habit-section beta-personalised-insights-section" aria-label="Personalised Insights">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("shield")}</span>
          <div>
            <h3>Personalised Insights</h3>
            <p>Three practical rhythm signals from the selected ${safeText(data.range.period)}.</p>
          </div>
        </div>
        <div class="beta-personalised-insight-list beta-personalised-metric-list">
          ${metrics.map(metric => `
            <article class="beta-personalised-insight-card beta-personalised-metric-card">
              <span class="beta-icon-disc">${dailyIcon(metric.icon)}</span>
              <div>
                <span>${safeText(metric.label)}</span>
                <p>${safeText(metric.value)}</p>
                <small>${safeText(metric.detail)}</small>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `;
  }

  function averageFuelScoreForEntries(entries) {
    const scores = entries.map(entry => calculateDailyFuelScore(entry.date).finalScore).filter(Number.isFinite);
    return scores.length ? averageValue(scores) : null;
  }

  function scoreDifferenceLabel(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return "Comparison building";
    const diff = Math.round(current - previous);
    if (diff === 0) return "No change from previous period";
    return `${diff > 0 ? "↑" : "↓"} ${Math.abs(diff)} point${Math.abs(diff) === 1 ? "" : "s"} from previous period`;
  }

  function scoreComponentPeriodAverage(entries, componentId) {
    const values = entries
      .map(entry => calculateDailyFuelScore(entry.date).components.find(component => component.id === componentId)?.score)
      .filter(Number.isFinite);
    return values.length ? Math.round(averageValue(values)) : null;
  }

  function renderFuelScoreGraph(range) {
    const points = range.days.map(day => {
      const key = dateKey(day.currentDate);
      const score = calculateDailyFuelScore(key).finalScore;
      return { label: day.shortLabel, dateLabel: day.dateLabel, score };
    });
    if (!points.some(point => Number.isFinite(point.score))) return `<div class="beta-trend-chart-empty">Add fuel logs and work/training plans to build Fuel Score history.</div>`;
    const width = 760;
    const height = 300;
    const padding = { top: 34, right: 28, bottom: 60, left: 64 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xFor = index => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yFor = score => padding.top + plotHeight - (score / 100) * plotHeight;
    const path = renderTrendLinePath(points.map(point => ({ current: point.score })), "current", xFor, yFor);
    const yTicks = [0, 50, 100].map(tick => {
      const y = yFor(tick);
      return `
        <line class="grid-line" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${padding.left + plotWidth}" y2="${y.toFixed(1)}"></line>
        <text class="y-label" x="${padding.left - 12}" y="${(y + 4).toFixed(1)}">${tick}</text>
      `;
    }).join("");
    return `
      <div class="beta-trend-chart beta-fuel-score-chart" role="img" aria-label="Daily Fuel Score graph">
        ${renderTrendAxisCopy("day/date", "Fuel Score")}
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          ${yTicks}
          ${path}
          ${points.map((point, index) => Number.isFinite(point.score) ? `<circle class="point current" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.score).toFixed(1)}" r="4"><title>${safeText(`${point.dateLabel}: ${point.score}/100 · ${fuelScoreLabel(point.score)}`)}</title></circle>` : "").join("")}
          ${points.map((point, index) => `<text class="x-label" x="${xFor(index).toFixed(1)}" y="${height - 24}">${safeText(point.label)}</text>`).join("")}
        </svg>
      </div>
    `;
  }

  function renderFuelScoreTrends(data) {
    const currentScore = averageFuelScoreForEntries(data.currentEntries);
    const previousScore = averageFuelScoreForEntries(data.previousEntries);
    const currentLabel = Number.isFinite(currentScore) ? `${Math.round(currentScore)}/100` : "Building";
    const componentRows = [
      ["training_adherence", "Training timing"],
      ["work_adherence", "Work-shift timing"],
      ["gap_adherence", "Fuel-gap adherence"],
      ["target_completion", "Daily target completion"]
    ].map(([id, label]) => {
      const value = scoreComponentPeriodAverage(data.currentEntries, id);
      return Number.isFinite(value) ? `<span><b>${safeText(label)}</b><strong>${value}</strong></span>` : "";
    }).join("");
    return `
      <section class="beta-trend-habit-section beta-fuel-score-section" aria-label="Fuel Score">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("score")}</span>
          <div>
            <h3>Fuel Score</h3>
            <p>Based on adherence to your planned fuelling times.</p>
          </div>
          <span class="beta-trend-result-chip ${Number(currentScore || 0) >= 75 ? "protected" : Number(currentScore || 0) >= 60 ? "neutral" : "elevated"}">${safeText(currentLabel)}</span>
        </div>
        <div class="beta-fuel-score-summary">
          <strong>${safeText(Number.isFinite(currentScore) ? fuelScoreLabel(currentScore) : "Add fuel suggestions to build a score.")}</strong>
          <span>${safeText(scoreDifferenceLabel(currentScore, previousScore))}</span>
        </div>
        ${componentRows ? `<div class="beta-fuel-score-components">${componentRows}</div>` : `<p class="muted beta-history-empty">Components appear when training, work, gap or target data exists for this period.</p>`}
        ${renderFuelScoreGraph(data.range)}
      </section>
    `;
  }

  function trainingOrWorkOpportunityStats(entries, group) {
    const opportunities = entries.flatMap(entry => calculateDailyFuelScore(entry.date).opportunities)
      .filter(item => opportunityTypeGroup(item.type) === group);
    const completed = opportunities.filter(item => item.completedAt);
    const missed = opportunities.filter(item => item.status === "missed" || item.status === "overdue");
    const average = weightedOpportunityAverage(opportunities);
    return { opportunities, completed, missed, average };
  }

  function mostMissedOpportunityLabel(opportunities) {
    const missed = opportunities.filter(item => item.status === "missed" || item.status === "overdue");
    const counts = new Map();
    missed.forEach(item => counts.set(item.type, (counts.get(item.type) || 0) + 1));
    if (!counts.size) return "No repeated missed fuel time yet";
    const [type, count] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    const label = type.replace(/_/g, " ");
    return `${label} · ${count} time${count === 1 ? "" : "s"}`;
  }

  function renderDemandAdherenceInsights(data) {
    const training = trainingOrWorkOpportunityStats(data.currentEntries, "training");
    const work = trainingOrWorkOpportunityStats(data.currentEntries, "work");
    if (training.opportunities.length + work.opportunities.length < 2) {
      return `
        <section class="beta-trend-habit-section beta-demand-adherence-section">
          <div class="beta-weekly-section-head">
            <span class="beta-icon-disc amber">${dailyIcon("route")}</span>
            <div><h3>Demand adherence</h3><p>Add a few training or work blocks before Fuel Guard draws demand conclusions.</p></div>
          </div>
        </section>
      `;
    }
    return `
      <section class="beta-trend-habit-section beta-demand-adherence-section">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc amber">${dailyIcon("route")}</span>
          <div>
            <h3>Demand adherence</h3>
            <p>Training and work timing signals for this selected period.</p>
          </div>
        </div>
        <div class="beta-trend-habit-grid">
          ${renderWeeklyMetricCard("Training fuel times completed", `${training.completed.length} of ${training.opportunities.length}`, Number.isFinite(training.average) ? `Average timing score ${Math.round(training.average)}.` : "Needs completed training fuel times.")}
          ${renderWeeklyMetricCard("Work-break fuel times completed", `${work.completed.length} of ${work.opportunities.length}`, Number.isFinite(work.average) ? `Average timing score ${Math.round(work.average)}.` : "Needs completed work fuel times.")}
          ${renderWeeklyMetricCard("Most commonly missed fuel time", mostMissedOpportunityLabel([...training.opportunities, ...work.opportunities]), "Only shown when there is enough repeated signal.")}
        </div>
      </section>
    `;
  }

  function sevenDayFuelDebtSummary(referenceDate = new Date()) {
    const end = addDays(startOfDay(referenceDate), 1);
    const start = addDays(end, -7);
    const entries = entriesForRange(archiveEntries(), start, end);
    const opportunities = entries.flatMap(entry => calculateDailyFuelScore(entry.date).opportunities);
    const missedKeyOpportunities = opportunities.filter(item => {
      const block = demandBlocks().find(candidate => candidate.id === item.demandBlockId);
      return block?.isKeySession && (item.status === "missed" || item.status === "overdue");
    }).length;
    const delayedOpportunities = opportunities.filter(item => item.status === "completed_late" || item.status === "overdue").length;
    const excessGapMinutes = entries.reduce((sum, entry) => sum + Number(entry.fuelDebtMinutes || 0), 0);
    let consecutiveOffPlanDays = 0;
    [...entries].sort((a, b) => dateFromKey(b.date) - dateFromKey(a.date)).some(entry => {
      const score = calculateDailyFuelScore(entry.date).finalScore;
      if (Number.isFinite(score) && score < 75) {
        consecutiveOffPlanDays += 1;
        return false;
      }
      return consecutiveOffPlanDays > 0;
    });
    const firstHalf = entries.slice(0, Math.floor(entries.length / 2));
    const secondHalf = entries.slice(Math.floor(entries.length / 2));
    const firstAverage = averageFuelScoreForEntries(firstHalf);
    const secondAverage = averageFuelScoreForEntries(secondHalf);
    const direction = !Number.isFinite(firstAverage) || !Number.isFinite(secondAverage)
      ? "stable"
      : secondAverage + 5 < firstAverage ? "worsening" : secondAverage > firstAverage + 5 ? "improving" : "stable";
    const severity = missedKeyOpportunities >= 2 || excessGapMinutes >= 360 || consecutiveOffPlanDays >= 4
      ? "High"
      : delayedOpportunities >= 2 || excessGapMinutes >= 120 || consecutiveOffPlanDays >= 2
        ? "Building"
        : excessGapMinutes > 0 || delayedOpportunities > 0
          ? "Low"
          : "Clear";
    return { missedKeyOpportunities, delayedOpportunities, excessGapMinutes, consecutiveOffPlanDays, direction, severity };
  }

  function renderFuelDebtSevenDay(data) {
    const debt = sevenDayFuelDebtSummary(data.range.end);
    return `
      <section class="beta-trend-habit-section beta-fuel-debt-section" aria-label="Fuel Debt">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc amber">${dailyIcon("gap")}</span>
          <div>
            <h3>Fuel Debt</h3>
            <p>Seven-day behavioural summary of repeated missed or delayed fuel times.</p>
          </div>
          <span class="beta-trend-result-chip ${debt.severity === "Clear" ? "protected" : debt.severity === "High" ? "elevated" : "neutral"}">${safeText(debt.severity)}</span>
        </div>
        <div class="beta-trend-habit-grid">
          ${renderWeeklyMetricCard("Missed key fuel times", String(debt.missedKeyOpportunities), "Key-session fuel times only.")}
          ${renderWeeklyMetricCard("Delayed fuel times", String(debt.delayedOpportunities), "Completed late or still overdue.")}
          ${renderWeeklyMetricCard("Beyond planned gaps", fuelDebtDurationText(debt.excessGapMinutes), `Pattern direction: ${debt.direction}.`)}
          ${renderWeeklyMetricCard("Consecutive off-plan days", String(debt.consecutiveOffPlanDays), "Days below mostly-on-track adherence.")}
        </div>
        <p class="row-note">Fuel Debt is a timing-pattern summary, not a calorie or medical calculation.</p>
      </section>
    `;
  }

  function longFuelGapsForEntry(entry) {
    const logs = logsForEntryType(entry, isFuelLog);
    if (logs.length < 2) return [];
    return gapsFromFuelLogs(logs)
      .map(gap => ({ ...gap, minutes: awakeGapMinutes(gap) }))
      .filter(gap => Number(gap.minutes || 0) >= riskLimit());
  }

  function checkinFollowsLongFuelGap(entry, checkin) {
    if (!checkin?.date) return false;
    return longFuelGapsForEntry(entry).some(gap => {
      const end = logDate(gap.end);
      const start = logDate(gap.start);
      if (!start || !end) return false;
      const followWindowEnd = addMinutes(end, 120);
      return checkin.date >= start && checkin.date <= followWindowEnd;
    });
  }

  function countCheckinsAfterLongGaps(entries, predicate) {
    return entries.reduce((count, entry) => {
      const checkins = logsForEntryType(entry, predicate);
      return count + checkins.filter(checkin => checkinFollowsLongFuelGap(entry, checkin)).length;
    }, 0);
  }

  function workCheckinIssueCount(entries) {
    return entries.flatMap(entry => logsForEntryType(entry, log => {
      const payload = checkinPayload(log);
      return payload?.context === "work" || payload?.checkinType === "work";
    })).filter(log => {
      const payload = checkinPayload(log) || {};
      return payload.breakTaken === "no" || payload.fuelledDuringBreak === "no";
    }).length;
  }

  function trainingCheckinIssueCount(entries) {
    return entries.flatMap(entry => logsForEntryType(entry, log => {
      const payload = checkinPayload(log);
      return payload?.context === "training" || payload?.checkinType === "training";
    })).filter(log => {
      const payload = checkinPayload(log) || {};
      return payload.recoveryFuelCompleted === "no" || payload.fatigueLevel === "high";
    }).length;
  }

  function riskPatternStatus(signals) {
    const enough = signals.days >= 3 || signals.checkins >= 3 || signals.longFuelGaps >= 3;
    if (!enough) {
      return {
        label: "Emerging pattern",
        tone: "neutral",
        copy: "Fuel Guard needs a few more repeated logs or check-ins before it calls this a reliable pattern."
      };
    }
    if (signals.longFuelGaps >= 5 && (signals.lowEnergyAfterLongGaps >= 2 || signals.poorConcentrationAfterLongGaps >= 2 || signals.trainingIssues >= 2)) {
      return {
        label: "High timing support signal",
        tone: "elevated",
        copy: "Repeated long fuelling gaps are showing up alongside energy, concentration or recovery check-ins."
      };
    }
    if (signals.longFuelGaps >= 3 || signals.missedFuelMoments >= 3) {
      return {
        label: "Repeated fuelling gaps",
        tone: "elevated",
        copy: "Longer fuelling gaps are recurring in the selected period."
      };
    }
    if (signals.lowEnergyAfterLongGaps + signals.poorConcentrationAfterLongGaps + signals.workIssues + signals.trainingIssues > 0) {
      return {
        label: "Emerging pattern",
        tone: "neutral",
        copy: "A few check-ins may be connected with stretched fuel timing, but the evidence is still limited."
      };
    }
    return {
      label: "Low current risk",
      tone: "protected",
      copy: "This period does not show a repeated long-fuel-gap pattern from the available logs and check-ins."
    };
  }

  function riskPatternSignals(entries) {
    const lowEnergy = entries.reduce((sum, entry) => sum + logsForEntryType(entry, isLowEnergyCheckinLog).length, 0);
    const poorConcentration = entries.reduce((sum, entry) => sum + logsForEntryType(entry, isPoorConcentrationCheckinLog).length, 0);
    const checkins = entries.reduce((sum, entry) => sum + logsForEntryType(entry, isSubjectiveCheckinLog).length, 0);
    const longFuelGaps = entries.reduce((sum, entry) => sum + longFuelGapsForEntry(entry).length, 0);
    const missedFuelMoments = entries.flatMap(entry => calculateDailyFuelScore(entry.date).opportunities)
      .filter(item => item.status === "missed" || item.status === "overdue").length;
    const lowEnergyAfterLongGaps = countCheckinsAfterLongGaps(entries, isLowEnergyCheckinLog);
    const poorConcentrationAfterLongGaps = countCheckinsAfterLongGaps(entries, isPoorConcentrationCheckinLog);
    const workIssues = workCheckinIssueCount(entries);
    const trainingIssues = trainingCheckinIssueCount(entries);
    return {
      days: entries.length,
      checkins,
      lowEnergy,
      poorConcentration,
      longFuelGaps,
      missedFuelMoments,
      lowEnergyAfterLongGaps,
      poorConcentrationAfterLongGaps,
      workIssues,
      trainingIssues
    };
  }

  function riskPatternFactors(signals) {
    const factors = [];
    if (signals.longFuelGaps) factors.push(`${signals.longFuelGaps} longer fuel gap${signals.longFuelGaps === 1 ? "" : "s"}`);
    if (signals.missedFuelMoments) factors.push(`${signals.missedFuelMoments} missed or overdue fuel moment${signals.missedFuelMoments === 1 ? "" : "s"}`);
    if (signals.lowEnergyAfterLongGaps) factors.push(`${signals.lowEnergyAfterLongGaps} low-energy check-in${signals.lowEnergyAfterLongGaps === 1 ? "" : "s"} near long gaps`);
    if (signals.poorConcentrationAfterLongGaps) factors.push(`${signals.poorConcentrationAfterLongGaps} concentration check-in${signals.poorConcentrationAfterLongGaps === 1 ? "" : "s"} near long gaps`);
    if (signals.workIssues) factors.push(`${signals.workIssues} work check-in${signals.workIssues === 1 ? "" : "s"} with missed break or fuel context`);
    if (signals.trainingIssues) factors.push(`${signals.trainingIssues} training check-in${signals.trainingIssues === 1 ? "" : "s"} with recovery or fatigue context`);
    return factors;
  }

  function riskPatternRecommendation(data, signals) {
    const gapWindow = mostCommonGapWindowInsight(data.currentEntries, isFuelLog, gapsFromFuelLogs, riskLimit());
    if (gapWindow.value && !String(gapWindow.value).toLowerCase().includes("not enough")) {
      return `Your longer fuel gaps most often cluster around ${gapWindow.value}. Try adding a small planned fuel moment before that window.`;
    }
    if (signals.workIssues) return "Use the Work check-in after your next shift to notice whether breaks and fuel access are part of the pattern.";
    if (signals.trainingIssues) return "Use the Training check-in after your next session to see whether recovery fuel is part of the pattern.";
    if (signals.checkins < 3) return "Add a quick energy or concentration check-in when something changes, then Fuel Guard can compare it with your gaps.";
    return "Keep fuel and hydration logging simple, then review whether check-ins continue to cluster around longer gaps.";
  }

  function renderRiskPatternCard({ title, value, note, icon = "chart", tone = "" }) {
    return `
      <article class="beta-trend-habit-card beta-risk-pattern-card ${safeText(tone)}">
        <span class="beta-icon-disc ${tone === "elevated" ? "amber" : tone === "protected" ? "shield" : ""}">${dailyIcon(icon)}</span>
        <div>
          <h4>${safeText(title)}</h4>
          <strong>${safeText(value)}</strong>
          <small>${safeText(note)}</small>
        </div>
      </article>
    `;
  }

  function renderRiskAndPatterns(data) {
    const signals = riskPatternSignals(data.currentEntries);
    const status = riskPatternStatus(signals);
    const factors = riskPatternFactors(signals);
    const energyCopy = signals.checkins < 3
      ? "Not enough check-in data yet."
      : `${signals.lowEnergy} low-energy and ${signals.poorConcentration} reduced-concentration check-in${signals.lowEnergy + signals.poorConcentration === 1 ? "" : "s"} in this period.`;
    const relationshipCopy = signals.lowEnergyAfterLongGaps || signals.poorConcentrationAfterLongGaps
      ? `${signals.lowEnergyAfterLongGaps + signals.poorConcentrationAfterLongGaps} check-in${signals.lowEnergyAfterLongGaps + signals.poorConcentrationAfterLongGaps === 1 ? "" : "s"} appeared near longer fuel gaps.`
      : "No clear check-in and fuel-gap relationship yet.";
    return `
      <section class="beta-trend-habit-section beta-risk-pattern-section" aria-label="Risk and Patterns">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc ${status.tone === "elevated" ? "amber" : status.tone === "protected" ? "shield" : ""}">${dailyIcon("shield")}</span>
          <div>
            <h3>Risk and Patterns</h3>
            <p>Fuel, hydration, energy and concentration signals for the selected period.</p>
          </div>
          <span class="beta-trend-result-chip ${safeText(status.tone)}">${safeText(status.label)}</span>
        </div>
        <div class="beta-trend-habit-grid">
          ${renderRiskPatternCard({ title: "Current risk status", value: status.label, note: status.copy, icon: "shield", tone: status.tone })}
          ${renderRiskPatternCard({ title: "Main contributing factors", value: factors.length ? factors.slice(0, 2).join(" · ") : "No repeated factor yet", note: factors.length > 2 ? factors.slice(2).join(" · ") : "Fuel Guard uses repeated signals, not one isolated event.", icon: "warning", tone: factors.length ? "elevated" : "protected" })}
          ${renderRiskPatternCard({ title: "Gap graphs", value: "Fuel and hydration gap graphs below", note: "Use those charts to see when longer gaps repeat.", icon: "gap", tone: signals.longFuelGaps ? "elevated" : "neutral" })}
          ${renderRiskPatternCard({ title: "Energy and concentration patterns", value: energyCopy, note: relationshipCopy, icon: "energy", tone: signals.lowEnergyAfterLongGaps || signals.poorConcentrationAfterLongGaps ? "elevated" : "neutral" })}
          ${renderRiskPatternCard({ title: "One recommendation", value: "Next practical action", note: riskPatternRecommendation(data, signals), icon: "check", tone: "protected" })}
        </div>
        <p class="row-note">Risk wording is behavioural and cautious. It is not a medical diagnosis.</p>
      </section>
    `;
  }

  function gapInsightTitle(metricId) {
    if (metricId === "fuel-gap") return "Fuel gaps";
    if (metricId === "hydration-gap") return "Hydration gaps";
    if (metricId === "low-energy") return "Low-energy logs";
    return "Gap signal";
  }

  function gapInsightDifference(card) {
    const { metric, currentValue, previousValue } = card;
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) {
      return { tone: "neutral", label: "Needs more comparison data" };
    }
    const diff = currentValue - previousValue;
    const tolerance = metric.unit === "minutes" ? 10 : 0.5;
    if (Math.abs(diff) <= tolerance) return { tone: "neutral", label: "Staying similar" };
    const change = trendDifferenceLabel(diff, metric.unit);
    const improved = metric.lowerIsBetter ? diff < 0 : diff > 0;
    return improved
      ? { tone: "protected", label: `Improved by ${change}` }
      : { tone: "elevated", label: `Increased by ${change}` };
  }

  function renderGapInsights(data) {
    const cards = data.cards.filter(card => GAP_INSIGHT_METRIC_IDS.has(card.metric.id));
    return `
      <section class="beta-trend-habit-section beta-gap-insights-section" aria-label="Gap Insights">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc amber">${dailyIcon("chart")}</span>
          <div>
            <h3>Gap Insights</h3>
            <p>Fuel, hydration, and low-energy signals for the selected period.</p>
          </div>
        </div>
        <div class="beta-trend-habit-grid">
          ${cards.map(card => {
            const outcome = gapInsightDifference(card);
            return `
              <article class="beta-trend-habit-card beta-gap-insight-card ${safeText(outcome.tone)}">
                <span class="beta-icon-disc ${card.metric.id.includes("hydration") ? "shield" : card.metric.id.includes("fuel") ? "amber" : ""}">${dailyIcon(card.metric.icon)}</span>
                <div>
                  <h4>${safeText(gapInsightTitle(card.metric.id))}</h4>
                  <div class="beta-trend-habit-values">
                    <span><b>${safeText(data.range.currentLabel)}</b><strong>${safeText(trendComparisonLabel(card.currentValue, card.metric.unit))}</strong><small>${safeText(card.metric.summaryLabel)}</small></span>
                    <span><b>${safeText(data.range.previousLabel)}</b><strong>${safeText(trendComparisonLabel(card.previousValue, card.metric.unit))}</strong><small>${safeText(data.range.previousLabelText)}</small></span>
                  </div>
                  <small class="beta-gap-insight-outcome ${safeText(outcome.tone)}">${safeText(outcome.label)}</small>
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function comparisonTrendChartMax(points) {
    const values = points.flatMap(point => [point.current, point.previous]).filter(value => Number.isFinite(value));
    return Math.max(...values, 1);
  }

  function comparisonTrendDisplayMax(rawMax, metric) {
    if (metric.unit === "count") return Math.max(2, Math.ceil(rawMax));
    if (GAP_DURATION_METRIC_IDS.has(metric.id)) return Math.max(360, Math.ceil(rawMax / 180) * 180);
    return Math.max(60, Math.ceil(rawMax / 30) * 30);
  }

  function comparisonTrendYAxisTicks(max, metric) {
    if (metric.unit === "count") return [0, Math.ceil(max / 2), max];
    if (GAP_DURATION_METRIC_IDS.has(metric.id)) {
      const ticks = [];
      for (let tick = 0; tick <= max; tick += 180) ticks.push(tick);
      return ticks.length >= 3 ? ticks : [0, 180, 360];
    }
    return [0, max / 2, max];
  }

  function trendYAxisTickLabel(value, metric) {
    if (metric.unit === "minutes" && GAP_DURATION_METRIC_IDS.has(metric.id)) {
      return `${Math.round(value / 60)} hours`;
    }
    return trendComparisonLabel(value, metric.unit);
  }

  function trendXAxisLabel(point, index, total, period) {
    if (period === "week") return point.shortLabel;
    if (index === 0 || index === total - 1 || (index + 1) % 5 === 0) return point.shortLabel;
    return "";
  }

  function comparisonPointTooltip(metric, point, key, range) {
    const label = key === "previous" ? range.previousLabel : range.currentLabel;
    const dateLabel = key === "previous" ? point.previousDateLabel : point.dateLabel;
    const value = point[key];
    return `${label} ${dateLabel}: ${trendComparisonLabel(value, metric.unit)} ${metric.unit === "minutes" ? "" : metric.yLabel.toLowerCase()}`.trim();
  }

  function renderComparisonLegend(range) {
    return `
      <div class="beta-trend-chart-legend" aria-hidden="true">
        <span><i class="current"></i>${safeText(range.currentLabel)}</span>
        <span><i class="previous"></i>${safeText(range.previousLabel)}</span>
      </div>
    `;
  }

  function renderComparisonLinePath(points, key, xFor, yFor) {
    const segments = [];
    let current = [];
    points.forEach((point, index) => {
      const value = point[key];
      if (Number.isFinite(value)) current.push(`${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`);
      else if (current.length) {
        segments.push(current);
        current = [];
      }
    });
    if (current.length) segments.push(current);
    return segments.map(segment => `<polyline class="line ${safeText(key)}" points="${segment.join(" ")}"></polyline>`).join("");
  }

  function renderTrendComparisonChart(card, range) {
    const { metric, points } = card;
    if (!hasTrendChartData(points)) return `<div class="beta-trend-chart-empty">Needs matching logs to draw this comparison.</div>`;
    const width = 760;
    const height = 360;
    const padding = { top: 42, right: 28, bottom: 78, left: 82 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const max = comparisonTrendDisplayMax(comparisonTrendChartMax(points), metric);
    const ticks = comparisonTrendYAxisTicks(max, metric);
    const xFor = index => padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
    const yFor = value => padding.top + plotHeight - (value / max) * plotHeight;
    const xLabels = points.map((point, index) => `<text class="x-label" x="${xFor(index).toFixed(1)}" y="${height - 26}">${safeText(trendXAxisLabel(point, index, points.length, range.period))}</text>`).join("");
    const yTicks = ticks.map(tick => {
      const y = yFor(tick);
      return `
        <line class="grid-line" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${padding.left + plotWidth}" y2="${y.toFixed(1)}"></line>
        <text class="y-label" x="${padding.left - 12}" y="${(y + 4).toFixed(1)}">${safeText(trendYAxisTickLabel(tick, metric))}</text>
      `;
    }).join("");
    let marks = "";
    if (metric.chart === "bar") {
      const slot = plotWidth / points.length;
      const barWidth = Math.min(12, Math.max(3, slot * 0.28));
      marks = points.map((point, index) => {
        const center = padding.left + slot * index + slot / 2;
        const bars = [];
        if (Number.isFinite(point.previous)) {
          const h = point.previous ? Math.max(2, padding.top + plotHeight - yFor(point.previous)) : 0;
          bars.push(`<rect class="bar previous" x="${(center - barWidth - 1.5).toFixed(1)}" y="${(padding.top + plotHeight - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${safeText(comparisonPointTooltip(metric, point, "previous", range))}</title></rect>`);
        }
        if (Number.isFinite(point.current)) {
          const h = point.current ? Math.max(2, padding.top + plotHeight - yFor(point.current)) : 0;
          bars.push(`<rect class="bar current" x="${(center + 1.5).toFixed(1)}" y="${(padding.top + plotHeight - h).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${safeText(comparisonPointTooltip(metric, point, "current", range))}</title></rect>`);
        }
        return bars.join("");
      }).join("");
    } else {
      marks = `
        ${renderComparisonLinePath(points, "previous", xFor, yFor)}
        ${renderComparisonLinePath(points, "current", xFor, yFor)}
        ${points.map((point, index) => Number.isFinite(point.previous) ? `<circle class="point previous" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.previous).toFixed(1)}" r="3.5"><title>${safeText(comparisonPointTooltip(metric, point, "previous", range))}</title></circle>` : "").join("")}
        ${points.map((point, index) => Number.isFinite(point.current) ? `<circle class="point current" cx="${xFor(index).toFixed(1)}" cy="${yFor(point.current).toFixed(1)}" r="3.9"><title>${safeText(comparisonPointTooltip(metric, point, "current", range))}</title></circle>` : "").join("")}
      `;
    }
    return `
      <div class="beta-trend-chart beta-trend-comparison-chart" role="img" aria-label="${safeText(metric.title)} comparison chart">
        <div class="beta-trend-graph-title">${safeText(metric.title)}</div>
        ${renderComparisonLegend(range)}
        ${renderTrendAxisCopy(range.axisLabel, metric.yLabel)}
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${padding.top + plotHeight}" x2="${padding.left + plotWidth}" y2="${padding.top + plotHeight}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotHeight}"></line>
          ${yTicks}
          ${marks}
          ${xLabels}
        </svg>
      </div>
    `;
  }

  function renderTrendComparisonCard(card, range) {
    const { metric, currentValue, previousValue, summary } = card;
    const usesExternalInsightCard = GAP_INSIGHT_METRIC_IDS.has(metric.id) || LOG_HABIT_METRIC_IDS.has(metric.id);
    return `
      <article class="beta-trend-comparison-card ${safeText(summary.tone)}" data-trend-card="${safeText(metric.id)}">
        <div class="beta-weekly-section-head beta-trend-card-head">
          <span class="beta-icon-disc ${summary.tone === "elevated" ? "amber" : summary.tone === "protected" ? "shield" : ""}">${dailyIcon(metric.icon)}</span>
          <div>
            <h3>${safeText(metric.title)}</h3>
            <p>${safeText(metric.description)}</p>
          </div>
          ${usesExternalInsightCard ? "" : `<span class="beta-trend-result-chip ${safeText(summary.tone)}">${safeText(summary.label)}</span>`}
        </div>
        ${usesExternalInsightCard ? "" : `<div class="beta-trend-value-row">
          <span><b>${safeText(range.currentLabel)}</b>${safeText(trendComparisonLabel(currentValue, metric.unit))}</span>
          <span><b>${safeText(range.previousLabel)}</b>${safeText(trendComparisonLabel(previousValue, metric.unit))}</span>
        </div>`}
        ${renderTrendComparisonChart(card, range)}
        ${usesExternalInsightCard ? "" : `<p class="beta-weekly-insight">${safeText(summary.copy)}</p>`}
        <div class="button-row beta-trend-card-actions">
          <button class="secondary" type="button" data-share-trend-card="${safeText(metric.id)}">Share</button>
          <button class="secondary" type="button" data-download-trend-card="${safeText(metric.id)}">Download</button>
        </div>
      </article>
    `;
  }

  function setTrendsShareStatus(message) {
    const status = document.getElementById("trendsShareStatus");
    if (status) status.textContent = message || "";
  }

  function trendImageFilename(id = "trends") {
    const range = selectedTrendRange();
    return `fuel-guard-${id}-${range.period}-${dateKey(range.start)}.png`;
  }

  function drawTrendLogo(ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(92, 92, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#07130f";
    ctx.font = "900 31px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FG", 92, 94);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 42px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Fuel Guard", 154, 56);
    ctx.fillStyle = "rgba(255,255,255,.76)";
    ctx.font = "600 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Insights", 158, 108);
  }


  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    words.forEach(word => {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !current) current = next;
      else {
        lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    lines.slice(0, maxLines).forEach((line, index) => {
      const suffix = index === maxLines - 1 && lines.length > maxLines ? "..." : "";
      ctx.fillText(`${line}${suffix}`, x, y + index * lineHeight);
    });
  }

  function drawTrendChartOnCanvas(ctx, card, range, x, y, width, height) {
    const { metric, points } = card;
    drawRoundedRect(ctx, x, y, width, height, 28);
    ctx.fillStyle = "rgba(255,255,255,.94)";
    ctx.fill();
    ctx.fillStyle = "#07130f";
    ctx.font = "800 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(metric.title, x + 28, y + 24);
    ctx.fillStyle = "#5b6b64";
    ctx.font = "600 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`${range.currentLabel} vs ${range.previousLabel}`, x + 28, y + 62);
    const legendY = y + 102;
    drawPill(ctx, x + 28, legendY, 155, 38, "#dff6ea", range.currentLabel, "#0b6f3e");
    drawPill(ctx, x + 198, legendY, 162, 38, "#eee7ff", range.previousLabel, "#5b21b6");

    const plot = { left: x + 62, top: y + 150, width: width - 100, height: Math.max(80, height - 240) };
    const max = comparisonTrendDisplayMax(comparisonTrendChartMax(points), metric);
    const xFor = index => plot.left + (points.length === 1 ? plot.width / 2 : (index / (points.length - 1)) * plot.width);
    const yFor = value => plot.top + plot.height - (value / max) * plot.height;
    ctx.strokeStyle = "rgba(7,19,15,.18)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(plot.left, plot.top + plot.height);
    ctx.lineTo(plot.left + plot.width, plot.top + plot.height);
    ctx.moveTo(plot.left, plot.top);
    ctx.lineTo(plot.left, plot.top + plot.height);
    ctx.stroke();
    ctx.fillStyle = "#5b6b64";
    ctx.font = "600 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(trendYAxisTickLabel(max, metric), x + 20, plot.top - 8);
    ctx.fillText("0", x + 24, plot.top + plot.height - 18);

    if (metric.chart === "bar") {
      const slot = plot.width / points.length;
      const barWidth = Math.min(16, Math.max(5, slot * 0.24));
      points.forEach((point, index) => {
        const center = plot.left + slot * index + slot / 2;
        [["previous", "#7c3aed", -barWidth - 2], ["current", "#167a45", 2]].forEach(([key, color, offset]) => {
          const value = point[key];
          if (!Number.isFinite(value)) return;
          const h = value ? Math.max(3, plot.top + plot.height - yFor(value)) : 0;
          drawRoundedRect(ctx, center + offset, plot.top + plot.height - h, barWidth, h, 5);
          ctx.fillStyle = color;
          ctx.fill();
        });
      });
    } else {
      const drawLine = (key, color, dash = []) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 5;
        ctx.setLineDash(dash);
        let started = false;
        points.forEach((point, index) => {
          const value = point[key];
          if (!Number.isFinite(value)) {
            started = false;
            return;
          }
          const px = xFor(index);
          const py = yFor(value);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]);
      };
      drawLine("previous", "#7c3aed", [10, 8]);
      drawLine("current", "#167a45");
      points.forEach((point, index) => {
        [["previous", "#7c3aed"], ["current", "#167a45"]].forEach(([key, color]) => {
          const value = point[key];
          if (!Number.isFinite(value)) return;
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = color;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(xFor(index), yFor(value), 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
      });
    }

    ctx.fillStyle = "#5b6b64";
    ctx.font = "600 18px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    points.forEach((point, index) => {
      const label = trendXAxisLabel(point, index, points.length, range.period);
      if (!label) return;
      ctx.fillText(label, xFor(index), plot.top + plot.height + 28);
    });
    ctx.textAlign = "left";
    ctx.fillStyle = "#07130f";
    ctx.font = "700 23px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    drawWrappedText(ctx, card.summary.copy, x + 28, y + height - 58, width - 56, 28, 2);
  }

  function createTrendCardCanvas(card, range) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export is not supported in this browser.");
    ctx.fillStyle = "#07130f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "rgba(45,255,136,.18)");
    gradient.addColorStop(1, "rgba(124,58,237,.18)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTrendLogo(ctx);
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.font = "600 25px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`${range.label} compared with ${range.previousLabelText}`, 70, 176);
    drawTrendChartOnCanvas(ctx, card, range, 70, 245, 940, 865);
    ctx.fillStyle = "rgba(255,255,255,.62)";
    ctx.font = "600 23px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Generated by Fuel Guard. No private account information included.", 70, 1255);
    return canvas;
  }

  function createAllTrendsCanvas(data) {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    const chartHeight = 350;
    const chartGap = 34;
    const chartsTop = 300;
    canvas.height = Math.max(1920, chartsTop + data.cards.length * (chartHeight + chartGap) + 150);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image export is not supported in this browser.");
    ctx.fillStyle = "#07130f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "rgba(45,255,136,.16)");
    gradient.addColorStop(.5, "rgba(255,255,255,.08)");
    gradient.addColorStop(1, "rgba(35,103,213,.18)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawTrendLogo(ctx);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 44px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Trend comparison", 70, 176);
    ctx.fillStyle = "rgba(255,255,255,.78)";
    ctx.font = "600 25px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`${data.range.label} compared with ${data.range.previousLabelText}`, 70, 232);
    data.cards.forEach((card, index) => drawTrendChartOnCanvas(ctx, card, data.range, 70, chartsTop + index * (chartHeight + chartGap), 940, chartHeight));
    ctx.fillStyle = "rgba(255,255,255,.62)";
    ctx.font = "600 23px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("Generated by Fuel Guard. No private account information included.", 70, canvas.height - 76);
    return canvas;
  }

  async function shareTrendCanvas(canvas, filename, statusLabel, downloadOnly = false) {
    setTrendsShareStatus("Creating insight image...");
    try {
      const blob = await canvasBlob(canvas);
      if (!downloadOnly && navigator.share && typeof File !== "undefined") {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], title: statusLabel, text: statusLabel });
          setTrendsShareStatus("Insight image shared.");
          return;
        }
      }
      downloadBlob(blob, filename);
      setTrendsShareStatus(downloadOnly ? "Insight image downloaded." : "Insight image downloaded because native sharing is not available here.");
    } catch (error) {
      if (error?.name === "AbortError") {
        setTrendsShareStatus("Share cancelled.");
        return;
      }
      setTrendsShareStatus(`Insight image failed: ${error?.message || "unknown error"}`);
    }
  }

  async function shareTrendCard(metricId, downloadOnly = false) {
    const data = trendComparisonData();
    const card = data.cards.find(item => item.metric.id === metricId) || data.cards[0];
    if (!card) return;
    await shareTrendCanvas(createTrendCardCanvas(card, data.range), trendImageFilename(metricId), `Fuel Guard ${card.metric.title}`, downloadOnly);
  }

  async function shareAllTrends(downloadOnly = false) {
    const data = trendComparisonData();
    await shareTrendCanvas(createAllTrendsCanvas(data), trendImageFilename("insights"), "Fuel Guard insights", downloadOnly);
  }

  function updateTrendControls(range) {
    const weekButton = document.getElementById("trendPeriodWeekButton");
    const monthButton = document.getElementById("trendPeriodMonthButton");
    const periodLabel = document.getElementById("trendPeriodLabel");
    const rangeLabel = document.getElementById("trendWeekLabel");
    const nextButton = document.getElementById("trendNextWeekButton");
    if (weekButton) {
      weekButton.classList.toggle("active", selectedTrendPeriod === "week");
      weekButton.setAttribute("aria-pressed", selectedTrendPeriod === "week" ? "true" : "false");
    }
    if (monthButton) {
      monthButton.classList.toggle("active", selectedTrendPeriod === "month");
      monthButton.setAttribute("aria-pressed", selectedTrendPeriod === "month" ? "true" : "false");
    }
    if (periodLabel) periodLabel.textContent = range.periodLabel;
    if (rangeLabel) rangeLabel.textContent = range.label;
    if (nextButton) nextButton.disabled = Boolean(range.nextDisabled);
  }

  function trendSegmentDefinitions() {
    return [
      { id: "overview", label: "Overview" },
      { id: "fuel", label: "Fuel" },
      { id: "hydration", label: "Hydration" },
      { id: "timing", label: "Timing" },
      { id: "adherence", label: "Adherence" }
    ];
  }

  function normalizeTrendSegment(value) {
    return trendSegmentDefinitions().some(item => item.id === value) ? value : "overview";
  }

  function renderTrendSegmentTabs() {
    selectedTrendSegment = normalizeTrendSegment(selectedTrendSegment);
    return `
      <nav class="beta-trend-segments" aria-label="Trend sections">
        ${trendSegmentDefinitions().map(segment => `
          <button class="${selectedTrendSegment === segment.id ? "active" : ""}" type="button" data-trend-segment="${safeText(segment.id)}" aria-pressed="${selectedTrendSegment === segment.id ? "true" : "false"}">${safeText(segment.label)}</button>
        `).join("")}
      </nav>
    `;
  }

  function trendCard(data, id) {
    return data.cards.find(card => card.metric.id === id) || null;
  }

  function renderTrendCards(data, ids) {
    const cards = ids.map(id => trendCard(data, id)).filter(Boolean);
    if (!cards.length) return "";
    return `
      <section class="beta-trend-comparison-grid" aria-label="Trend comparison cards">
        ${cards.map(card => renderTrendComparisonCard(card, data.range)).join("")}
      </section>
    `;
  }

  function renderTrendPriorityInsight(data) {
    return "";
  }

  const FUELLING_PATTERN_BUCKETS = [
    { label: "00-06", tick: "00:00", startHour: 0, endHour: 6 },
    { label: "06-09", tick: "06:00", startHour: 6, endHour: 9 },
    { label: "09-12", tick: "09:00", startHour: 9, endHour: 12 },
    { label: "12-15", tick: "12:00", startHour: 12, endHour: 15 },
    { label: "15-18", tick: "15:00", startHour: 15, endHour: 18 },
    { label: "18-21", tick: "18:00", startHour: 18, endHour: 21 },
    { label: "21-24", tick: "21:00", startHour: 21, endHour: 24 }
  ];

  const LOG_PATTERN_TYPES = [
    {
      id: "fuel",
      label: "Fuel",
      icon: "fuel",
      noun: "fuel log",
      nounPlural: "fuel logs",
      empty: "No fuel logged today",
      question: "When have I fuelled today?"
    },
    {
      id: "hydration",
      label: "Hydration",
      icon: "hydration",
      noun: "hydration log",
      nounPlural: "hydration logs",
      empty: "No hydration logged today",
      question: "When have I hydrated today?"
    },
    {
      id: "sleepy",
      label: "Sleepy",
      icon: "sleepy",
      noun: "sleepy event",
      nounPlural: "sleepy events",
      empty: "No sleepy events logged today",
      question: "When during the day have I felt sleepy?"
    },
    {
      id: "training",
      label: "Training",
      icon: "chart",
      noun: "training event",
      nounPlural: "training events",
      empty: "No Training Mode sessions today",
      question: "Where did today’s Training sessions and intake events happen?"
    }
  ];

  function normalizeLogPatternType(value) {
    return LOG_PATTERN_TYPES.some(type => type.id === value) ? value : "fuel";
  }

  function logPatternDefinition(value = selectedLogPatternType) {
    const id = normalizeLogPatternType(value);
    return LOG_PATTERN_TYPES.find(type => type.id === id) || LOG_PATTERN_TYPES[0];
  }

  function logMatchesPattern(log, type) {
    if (type === "training") return Boolean(log.trainingModeSessionId || log.training_mode_session_id);
    if (type === "hydration") return isHydrationLog(log);
    if (type === "sleepy") return isSleepyLog(log);
    return isFuelLog(log);
  }

  function fuellingPatternLogs(key = todayViewKey(), type = selectedLogPatternType) {
    const patternType = normalizeLogPatternType(type);
    return logsForDay(key)
      .filter(log => logMatchesPattern(log, patternType))
      .map(log => ({ ...log, minute: minutesIntoDay(log.date) }))
      .filter(log => Number.isFinite(log.minute) && log.minute >= 0 && log.minute < 1440)
      .sort((a, b) => a.minute - b.minute);
  }

  function fuellingPatternBucketCounts(logs) {
    return FUELLING_PATTERN_BUCKETS.map(bucket => {
      const start = bucket.startHour * 60;
      const end = bucket.endHour * 60;
      const bucketLogs = logs.filter(log => log.minute >= start && log.minute < end);
      return {
        ...bucket,
        count: bucketLogs.length,
        times: bucketLogs.map(log => formatClock(log.date))
      };
    });
  }

  function integerTicks(maxValue) {
    const max = Math.max(1, Math.ceil(Number(maxValue) || 0));
    const step = Math.max(1, Math.ceil(max / 4));
    const ticks = [];
    for (let value = 0; value <= max; value += step) ticks.push(value);
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
    return ticks;
  }

  function renderFuellingPatternBarChart(key = todayViewKey(), type = selectedLogPatternType) {
    const pattern = logPatternDefinition(type);
    const logs = fuellingPatternLogs(key, pattern.id);
    const buckets = fuellingPatternBucketCounts(logs);
    const maxCount = Math.max(...buckets.map(bucket => bucket.count), 1);
    const ticks = integerTicks(maxCount);
    const yMax = ticks[ticks.length - 1] || 1;
    const width = 460;
    const height = 230;
    const padding = { top: 22, right: 18, bottom: 50, left: 46 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const slot = plotWidth / buckets.length;
    const barWidth = Math.min(34, Math.max(18, slot * 0.54));
    const xFor = index => padding.left + slot * index + slot / 2;
    const yFor = value => bottom - (Math.max(0, value) / yMax) * plotHeight;
    const topBucket = buckets.reduce((top, bucket) => bucket.count > top.count ? bucket : top, buckets[0]);
    const summary = logs.length
      ? `Most ${pattern.nounPlural} cluster around ${topBucket.label}.`
      : pattern.empty;
    return `
      <article class="beta-fuelling-pattern-chart-card">
        <div class="beta-fuelling-pattern-axis-copy">
          <span>Y: event count</span>
          <span>X: time of day</span>
        </div>
        <div class="beta-fuelling-pattern-chart ${safeText(pattern.id)}" role="img" aria-label="${safeText(pattern.label)} event count by time of day">
          <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
            <line class="axis" x1="${padding.left}" y1="${bottom}" x2="${padding.left + plotWidth}" y2="${bottom}"></line>
            <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${bottom}"></line>
            ${ticks.map(tick => {
              const y = yFor(tick);
              return `
                <line class="grid" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${padding.left + plotWidth}" y2="${y.toFixed(1)}"></line>
                <text class="y-label" x="${padding.left - 12}" y="${(y + 4).toFixed(1)}">${safeText(String(tick))}</text>
              `;
            }).join("")}
            ${buckets.map((bucket, index) => {
              const x = xFor(index);
              const barHeight = bucket.count ? Math.max(4, bottom - yFor(bucket.count)) : 0;
              const y = bottom - barHeight;
              const title = bucket.count
                ? `${bucket.label}: ${bucket.count} ${bucket.count === 1 ? pattern.noun : pattern.nounPlural}${bucket.times.length ? ` (${bucket.times.join(", ")})` : ""}`
                : `${bucket.label}: 0 ${pattern.nounPlural}`;
              return `
                <rect class="bar" x="${(x - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="8">
                  <title>${safeText(title)}</title>
                </rect>
                <text class="x-label" x="${x.toFixed(1)}" y="${height - 26}">${safeText(bucket.tick)}</text>
              `;
            }).join("")}
          </svg>
        </div>
        <small>${safeText(summary)}</small>
      </article>
    `;
  }

  function trainingSessionsForPattern(key = todayViewKey()) {
    return window.FuelGuardDomain.trainingPatternLanes({
      logs: logsForDay(key),
      sessions: betaState().trainingMode?.sessions || [],
      key
    });
  }

  function renderTrainingPatternLanes(key = todayViewKey()) {
    const lanes = trainingSessionsForPattern(key);
    if (!lanes.length) return `<article class="beta-training-pattern-empty"><p>No Training Mode sessions today.</p></article>`;
    return `
      <div class="beta-training-pattern-lanes" role="img" aria-label="Training sessions with Fuel and Hydration events">
        ${lanes.map(({ session, events: sessionLogs }) => {
          const startedAt = logDate(session.startedAt || session.started_at);
          const endedAt = logDate(session.endedAt || session.ended_at) || new Date();
          const durationMs = Math.max(1, endedAt - startedAt);
          return `
            <article class="beta-training-pattern-lane">
              <div class="beta-training-pattern-label">
                <strong>${safeText(session.title || "Training session")}</strong>
                <span>${safeText(formatClock(startedAt))}–${safeText(formatClock(endedAt))}</span>
              </div>
              <div class="beta-training-pattern-track">
                ${sessionLogs.map(log => {
                  const left = clamp(((log.date - startedAt) / durationMs) * 100, 0, 100);
                  const type = isHydrationLog(log) && !isFuelLog(log) ? "hydration" : "fuel";
                  return `<i class="${type}" style="left:${stylePercent(left)}" title="${safeText(logTypeLabel(log))} · ${safeText(formatClock(log.date))}"><span>${type === "fuel" ? "F" : "H"}</span></i>`;
                }).join("")}
              </div>
            </article>
          `;
        }).join("")}
        <div class="beta-training-pattern-legend"><span><i class="fuel"></i>Fuel</span><span><i class="hydration"></i>Hydration</span></div>
      </div>
    `;
  }

  function renderFuellingPatternGraphs(key = todayViewKey()) {
    selectedLogPatternType = normalizeLogPatternType(selectedLogPatternType);
    const pattern = logPatternDefinition(selectedLogPatternType);
    return `
      <section class="beta-trend-habit-section beta-fuelling-patterns-section" aria-label="Today’s patterns">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc amber">${dailyIcon(pattern.icon)}</span>
          <div>
            <h3>Today’s patterns</h3>
            <p>${safeText(pattern.question)}</p>
          </div>
        </div>
        <nav class="beta-log-pattern-tabs" aria-label="Today’s pattern type">
          ${LOG_PATTERN_TYPES.map(type => `
            <button class="${type.id === selectedLogPatternType ? "active" : ""}" type="button" data-log-pattern-type="${safeText(type.id)}" aria-pressed="${type.id === selectedLogPatternType ? "true" : "false"}">${safeText(type.label)}</button>
          `).join("")}
        </nav>
        ${selectedLogPatternType === "training" ? renderTrainingPatternLanes(key) : renderFuellingPatternBarChart(key, selectedLogPatternType)}
      </section>
    `;
  }

  function renderInsightsWeeklySummary(data) {
    const loggedDays = data.currentEntries.filter(entry => (entry.logs || []).length || Number(entry.fuelLogCount || 0) || Number(entry.hydrationLogCount || 0));
    const fuelLogs = data.currentEntries.reduce((sum, entry) => sum + Number(entry.fuelLogCount || 0), 0);
    const hydrationLogs = data.currentEntries.reduce((sum, entry) => sum + Number(entry.hydrationLogCount || 0), 0);
    const insights = trendHabitInsightMap(data);
    const fuelGapWindow = insights["fuel-gap-window"]?.current || { value: "Not enough gap data yet.", detail: "Needs recurring significant gaps." };
    const fuellingWindow = insights["fuel-hour"]?.current || { value: "Not enough data yet", detail: "Needs matching logs" };
    const summaryCopy = loggedDays.length
      ? `You logged ${fuelLogs} fuel and ${hydrationLogs} hydration moment${fuelLogs + hydrationLogs === 1 ? "" : "s"} across ${loggedDays.length} day${loggedDays.length === 1 ? "" : "s"} in this ${data.range.period}.`
      : `No fuel or hydration logs in this ${data.range.period} yet.`;
    return `
      <section class="beta-trend-habit-section beta-insights-summary-section" aria-label="Weekly summary">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("chart")}</span>
          <div>
            <h3 class="beta-status-title">Weekly summary</h3>
            <p>${safeText(summaryCopy)}</p>
          </div>
        </div>
        <div class="beta-trend-habit-grid beta-insights-summary-grid">
          ${renderWeeklyMetricCard("Fuel logs", String(fuelLogs), "Fuel moments recorded in this period.")}
          ${renderWeeklyMetricCard("Hydration logs", String(hydrationLogs), "Hydration moments recorded in this period.")}
          ${renderWeeklyMetricCard("Most common fuel-gap window", fuelGapWindow.value, fuelGapWindow.detail)}
          ${renderWeeklyMetricCard("Most common fuelling window", fuellingWindow.value, fuellingWindow.detail)}
        </div>
      </section>
    `;
  }

  function renderGarminSignalsSummary() {
    if (!garminPatternsState.loaded && !garminPatternsState.loading) scheduleGarminPatternsLoad();
    const insights = garminPatternsState.data?.insights || [];
    if (!insights.length) return "";
    const insight = insights[0];
    return `
      <section class="beta-trend-habit-section beta-garmin-signals-summary" aria-label="Garmin signals">
        <div class="beta-weekly-section-head">
          <span class="beta-icon-disc shield">${dailyIcon("heart")}</span>
          <div>
            <h3>Garmin signals</h3>
            <p>Opt-in Connect IQ-local samples, shown as behavioural associations only.</p>
          </div>
          <button class="secondary beta-garmin-refresh-button" type="button" data-refresh-garmin-patterns>Refresh</button>
        </div>
        <article class="beta-personalised-insight-card ${safeText(insight.tone || "neutral")}">
          <span class="beta-icon-disc ${insight.tone === "elevated" ? "amber" : "shield"}">${dailyIcon(insight.metric === "heart_rate" ? "heart" : insight.metric === "body_battery" ? "score" : "chart")}</span>
          <div>
            <p>${safeText(insight.text)}</p>
            ${insight.detail ? `<small>${safeText(insight.detail)}</small>` : ""}
            <span class="beta-evidence-label">${safeText(`${insight.confidence || "limited"} confidence · ${insight.count || 0} matching days`)}</span>
          </div>
        </article>
      </section>
    `;
  }

  function renderInsightsSupportingDetails(data) {
    return "";
  }

  function renderTrendSegmentContent(data) {
    selectedTrendSegment = normalizeTrendSegment(selectedTrendSegment);
    if (selectedTrendSegment === "fuel") {
      return `
        ${renderFuelDebtSevenDay(data)}
        ${renderTrendCards(data, ["fuel-gap"])}
      `;
    }
    if (selectedTrendSegment === "hydration") {
      return renderTrendCards(data, ["hydration-gap"]);
    }
    if (selectedTrendSegment === "timing") {
      return `
        ${renderGapInsights(data)}
        ${renderTrendHabitInsights(data)}
        ${renderRiskAndPatterns(data)}
        ${renderTrendCards(data, ["low-energy", "concentration"])}
      `;
    }
    if (selectedTrendSegment === "adherence") {
      return `
        ${renderFuelScoreTrends(data)}
        ${renderDemandAdherenceInsights(data)}
        ${renderLogHabits(data)}
        ${renderTrendCards(data, ["logs"])}
      `;
    }
    return `
      ${renderTrendPriorityInsight(data)}
      ${renderPersonalisedInsights(data)}
      ${renderGarminMetricsSection()}
      ${renderGarminPatternsSection()}
    `;
  }

  function renderTrends() {
    const summaryTarget = document.getElementById("fuelAveragesSummary");
    if (!summaryTarget) return;
    renderSelectedDayCard();
    const data = trendComparisonData();
    updateTrendControls(data.range);
    summaryTarget.innerHTML = `
      ${renderInsightsWeeklySummary(data)}
      ${renderPersonalisedInsights(data)}
      ${renderGarminSignalsSummary()}
    `;
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
    const selectedMode = "risk";
    const selectedKey = selectedDataDateKey();
    const entry = archiveEntries().find(item => item.date === selectedKey) || buildArchiveEntry(selectedKey);
    const isSelectedToday = selectedKey === dateKey(now);
    const logs = logsForDay(selectedKey).filter(log => !isSelectedToday || log.date <= now);
    const fuelLogs = logs.filter(isFuelLog);
    const hydrationLogs = logs.filter(isHydrationLog);
    const crashLogs = logs.filter(isLowEnergyCheckinLog);
    const series = [];
    if (selectedMode === "risk") {
      drawRiskGraphCanvas(canvas, selectedKey, { now, endedAt: entry?.endedAt || "" });
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
      [0, minuteLabel(0)],
      [360, minuteLabel(360)],
      [720, minuteLabel(720)],
      [1080, minuteLabel(1080)],
      [1440, minuteLabel(1440)]
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

    crashLogs.forEach(log => {
      const x = xForMinute(minutesIntoDay(log.date));
      const y = padding.top + 12;
      ctx.fillStyle = "#ff4d6d";
      ctx.beginPath();
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.fill();
    });

    if (isSelectedToday) {
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
    }
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
      { from: 31, to: 60, color: "rgba(102,112,133,.08)" },
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
      ctx.strokeStyle = "#b42318";
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
    logs.filter(isLowEnergyCheckinLog).forEach(log => {
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
      [0, minuteLabel(0)],
      [360, minuteLabel(360)],
      [720, minuteLabel(720)],
      [1080, minuteLabel(1080)],
      [1440, minuteLabel(1440)]
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

  renderFuelGap = function renderFuelGapBeta() {
    const snapshot = fuelGapSnapshot();
    const cooldown = cooldownRemainingSeconds();
    const dashboardActive = document.getElementById("dashboard")?.classList.contains("active");
    const settingsActive = document.getElementById("checklist")?.classList.contains("active");

    const button = document.getElementById("graphLogFoodButton");
    if (button) {
      button.innerHTML = "<span>Fuel</span>";
      button.disabled = cooldown > 0;
    }

    const hydrationButton = document.getElementById("graphLogHydrationButton");
    if (hydrationButton) {
      hydrationButton.innerHTML = "<span>Hydrate</span>";
      hydrationButton.disabled = false;
    }

    const sleepyButton = document.getElementById("graphLogSleepyButton");
    if (sleepyButton) {
      sleepyButton.innerHTML = "<span>Sleepy</span>";
      sleepyButton.disabled = false;
    }

    const undo = document.getElementById("undoLatestFoodLog");
    if (undo) undo.disabled = !logsForDay(todayViewKey()).length;

    const cooldownEl = document.getElementById("foodLogCooldownMessage");
    if (cooldownEl) {
      cooldownEl.textContent = quickLogConfirmation
        ? `${quickLogConfirmation}${cooldown > 0 ? `. You can fuel again in ${cooldown}s.` : ""}`
        : cooldown > 0
          ? `Logged. You can fuel again in ${cooldown}s.`
          : "";
    }

    if (dashboardActive) {
      renderCoachNudges();
      renderAthleteActivitySummary();
      renderAthleteTeamSessionContext();
      renderDayTypeControls();
      renderSelectedDayCard();
      renderDailyLog();
    }
    if (settingsActive) renderSettings();
  };

  const baseSwitchScreen = switchScreen;
  switchScreen = function switchScreenBeta(screen) {
    const target = ["dashboard", "training", "checklist"].includes(screen) ? screen : "dashboard";
    baseSwitchScreen(target);
    document.querySelectorAll(".nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.screen === target);
    });
    document.querySelectorAll(".mobile-nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileScreen === target);
    });
    if (target === "dashboard") {
      renderCoachNudges();
      renderAthleteActivitySummary();
      renderAthleteTeamSessionContext();
      renderSelectedDayCard();
      renderDailyLog();
    }
    if (target === "checklist") renderSettings();
    if (target === "training") window.FuelGuardTrainingMode?.render?.();
  };

  async function clearBetaData() {
    if (!window.confirm("Clear fuel beta logs, summaries, day types and thresholds?")) return;
    const settingsStatus = document.getElementById("fuelSettingsStatus");
    const dataStatus = document.getElementById("fuelDataActionsStatus");
    let clearStatus = "Fuel Guard data cleared.";
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
    if (settingsStatus) settingsStatus.textContent = clearStatus;
    if (dataStatus) dataStatus.textContent = clearStatus;
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
      [...new Set(csvImportPreview.logs.map(log => {
        const date = logDate(log);
        return date ? dateKey(date) : "";
      }).filter(Boolean))].forEach(key => applyOpportunityMatchesForDay(key));
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

  function recordQuickTimelineCheckin(button) {
    if (!button) return;
    const checkinType = button.dataset.checkinQuick || "energy";
    recordCheckinEvent({
      checkinType,
      context: "general_day",
      energyLevel: button.dataset.energyLevel || "",
      concentrationLevel: button.dataset.concentrationLevel || "",
      hungerLevel: button.dataset.hungerLevel || "",
      fatigueLevel: button.dataset.fatigueLevel || "",
      note: document.getElementById("timelineCheckinNote")?.value || ""
    });
  }

  function saveWorkCheckin() {
    recordCheckinEvent({
      checkinType: "work",
      context: "work",
      contextId: document.getElementById("workCheckinBlock")?.value || "",
      energyLevel: document.getElementById("workCheckinEnergy")?.value || "steady",
      concentrationLevel: document.getElementById("workCheckinConcentration")?.value || "normal",
      breakTaken: document.getElementById("workCheckinBreakTaken")?.value || "not_sure",
      fuelledDuringBreak: document.getElementById("workCheckinFuelled")?.value || "not_sure",
      note: document.getElementById("workCheckinNote")?.value || ""
    });
  }

  function saveTrainingCheckin() {
    recordCheckinEvent({
      checkinType: "training",
      context: "training",
      contextId: document.getElementById("trainingCheckinBlock")?.value || "",
      energyLevel: document.getElementById("trainingCheckinEnergy")?.value || "steady",
      concentrationLevel: document.getElementById("trainingCheckinConcentration")?.value || "normal",
      fatigueLevel: document.getElementById("trainingCheckinFatigue")?.value || "",
      recoveryFuelCompleted: document.getElementById("trainingCheckinRecoveryFuel")?.value || "not_sure",
      note: document.getElementById("trainingCheckinNote")?.value || ""
    });
  }

  function saveDailyCheckin() {
    recordCheckinEvent({
      checkinType: "daily",
      context: "daily_summary",
      energyLevel: document.getElementById("dailyCheckinEnergy")?.value || "steady",
      concentrationLevel: document.getElementById("dailyCheckinConcentration")?.value || "normal",
      note: document.getElementById("dailyCheckinNote")?.value || ""
    });
  }

  document.querySelectorAll(".mobile-nav-item").forEach(button => {
    button.onclick = () => {
      switchScreen(button.dataset.mobileScreen);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    };
  });

  document.getElementById("undoLatestFoodLog")?.addEventListener("click", undoLatestRhythmLog);
  document.getElementById("showMissedLogButton")?.addEventListener("click", () => setMissedLogPanel(true));
  document.getElementById("cancelMissedLogButton")?.addEventListener("click", () => setMissedLogPanel(false));
  document.getElementById("saveMissedLogButton")?.addEventListener("click", saveMissedLog);
  document.addEventListener("click", event => {
    const planSubtab = event.target.closest("[data-plan-subtab]");
    if (planSubtab) {
      setPlanSubtab(planSubtab.dataset.planSubtab || "today");
      return;
    }
    if (event.target.closest("#saveTrainingDemandButton")) {
      saveTrainingDemand();
      return;
    }
    if (event.target.closest("#saveWorkDemandButton")) {
      saveWorkDemand();
      return;
    }
    if (event.target.closest("#cancelDemandEditButton")) {
      demandPlannerEditingId = "";
      demandPlannerStatus = "";
      renderDemandPlanner();
      renderSelectedDayCard();
      return;
    }
    const editDemand = event.target.closest("[data-edit-demand]");
    if (editDemand) {
      demandPlannerEditingId = editDemand.dataset.editDemand || "";
      demandPlannerStatus = "Editing plan item.";
      const block = selectedDemandEditBlock();
      if (block?.type) selectedPlanSubtab = "today";
      renderSelectedDayCard();
      return;
    }
    const deleteDemand = event.target.closest("[data-delete-demand]");
    if (deleteDemand) {
      deleteDemandBlock(deleteDemand.dataset.deleteDemand);
      return;
    }
    const quickCheckin = event.target.closest("[data-checkin-quick]");
    if (quickCheckin) {
      recordQuickTimelineCheckin(quickCheckin);
      return;
    }
    if (event.target.closest("#saveWorkCheckinButton")) {
      saveWorkCheckin();
      return;
    }
    if (event.target.closest("#saveTrainingCheckinButton")) {
      saveTrainingCheckin();
      return;
    }
    if (event.target.closest("#saveDailyCheckinButton")) {
      saveDailyCheckin();
      return;
    }
    if (event.target.closest("[data-refresh-garmin-patterns]")) {
      loadGarminPatterns(true);
      return;
    }
    if (event.target.closest("#saveGarminDailyCheckinButton")) {
      saveGarminDailyCheckin();
      return;
    }
  });
  document.addEventListener("click", event => {
    const logPatternType = event.target.closest("[data-log-pattern-type]");
    if (logPatternType) {
      selectedLogPatternType = normalizeLogPatternType(logPatternType.dataset.logPatternType);
      const target = document.getElementById("fuelLogPatterns");
      if (target) target.innerHTML = renderFuellingPatternGraphs(todayViewKey());
      return;
    }
    const hydrationButton = event.target.closest("#graphLogHydrationButton");
    if (hydrationButton) {
      event.preventDefault();
      recordHydration();
      return;
    }
    const sleepyButton = event.target.closest("#graphLogSleepyButton");
    if (sleepyButton) {
      event.preventDefault();
      recordSleepy();
      return;
    }
    const timelineLogToggle = event.target.closest("[data-toggle-log-actions]");
    if (timelineLogToggle && timelineLogToggle.dataset.toggleLogActions) {
      selectedTodayTimelineLogId = selectedTodayTimelineLogId === timelineLogToggle.dataset.toggleLogActions
        ? ""
        : timelineLogToggle.dataset.toggleLogActions;
      renderDailyLog();
      return;
    }
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
    const realismResponse = event.target.closest("[data-plan-realism-response]");
    if (realismResponse) {
      const key = selectedDataDateKey();
      const response = realismResponse.dataset.planRealismResponse || "yes";
      if (response === "yes") {
        setPlanRealismForKey(key, { response: "yes", opportunityId: "", reason: "", action: "", moveMinutes: 45 });
      } else {
        const opportunities = generateFuelOpportunitiesForDay(key).filter(item => !item.completedAt);
        setPlanRealismForKey(key, {
          response,
          opportunityId: planRealismForKey(key).opportunityId || opportunities[0]?.id || "",
          reason: planRealismForKey(key).reason || "work",
          action: planRealismForKey(key).action || "move",
          moveMinutes: planRealismForKey(key).moveMinutes || 45
        });
      }
      renderFuelGap();
      return;
    }
    if (event.target.closest("#savePlanRealismButton")) {
      const key = selectedDataDateKey();
      setPlanRealismForKey(key, {
        response: planRealismForKey(key).response || "mostly",
        opportunityId: document.getElementById("planRealismOpportunity")?.value || "",
        reason: document.getElementById("planRealismReason")?.value || "work",
        action: document.getElementById("planRealismAction")?.value || "move",
        moveMinutes: Number(document.getElementById("planRealismMoveMinutes")?.value || 45)
      });
      renderFuelGap();
      return;
    }
    if (event.target.closest("#clearPlanRealismButton")) {
      clearPlanRealismForKey(selectedDataDateKey());
      renderFuelGap();
      return;
    }
  });
  document.getElementById("fuelDayType")?.addEventListener("change", event => {
    const key = todayViewKey();
    setDayType(key, event.target.value);
    save();
    renderAll();
    window.fuelGuardCloud?.syncLogsForDay(key);
  });
  document.addEventListener("click", event => {
    const choice = event.target.closest("[data-day-type-choice]");
    if (!choice) return;
    const select = document.getElementById("fuelDayType");
    if (!select) return;
    select.value = choice.dataset.dayTypeChoice || "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  document.getElementById("fuelTrainingSession")?.addEventListener("change", event => {
    const key = selectedDataDateKey();
    setTrainingSession(key, event.target.value);
    save();
    renderAll();
    window.fuelGuardCloud?.syncLogsForDay(key);
  });
  function commitMaximumFuelGapCustom(input) {
    const minutes = Number(input?.value);
    if (!Number.isFinite(minutes) || minutes < 120 || minutes > 240) {
      const status = document.getElementById("maximumFuelGapStatus");
      if (status) status.textContent = "Enter a target from 120 to 240 minutes.";
      return;
    }
    applyMaximumFuelGapGoal(minutes);
  }

  document.addEventListener("change", event => {
    if (event.target.id === "maximumFuelGapPreset") {
      const value = event.target.value;
      if (value === "custom") {
        const customWrap = document.getElementById("maximumFuelGapCustomWrap");
        const customInput = document.getElementById("maximumFuelGapCustom");
        if (customWrap) customWrap.hidden = false;
        if (customInput) {
          customInput.value = String(maximumFuelGapMinutes());
          customInput.focus();
        }
        const status = document.getElementById("maximumFuelGapStatus");
        if (status) status.textContent = "Enter a target from 120 to 240 minutes.";
        return;
      }
      applyMaximumFuelGapGoal(Number(value));
      return;
    }
    if (event.target.id === "maximumFuelGapCustom") {
      commitMaximumFuelGapCustom(event.target);
    }
  });
  document.addEventListener("focusout", event => {
    if (event.target.id === "maximumFuelGapCustom") commitMaximumFuelGapCustom(event.target);
  });
  document.addEventListener("keydown", event => {
    if (event.target.id !== "maximumFuelGapCustom" || event.key !== "Enter") return;
    event.preventDefault();
    commitMaximumFuelGapCustom(event.target);
  });
  document.getElementById("fuelDataDate")?.addEventListener("change", event => {
    setSelectedDataDate(event.target.value);
    renderFuelGap();
  });
  document.getElementById("fuelAnalysisDate")?.addEventListener("change", event => {
    setSelectedDataDate(event.target.value);
    renderFuelGap();
  });
  document.getElementById("trendDayTypeFilter")?.addEventListener("change", event => {
    selectedTrendDayType = event.target.value || "all";
    renderTrends();
  });
  document.getElementById("trendTrainingFilter")?.addEventListener("change", event => {
    selectedTrendTrainingSession = event.target.value || "all";
    renderTrends();
  });
  document.getElementById("trendPeriodWeekButton")?.addEventListener("click", () => {
    selectedTrendPeriod = "week";
    renderTrends();
  });
  document.getElementById("trendPeriodMonthButton")?.addEventListener("click", () => {
    selectedTrendPeriod = "month";
    renderTrends();
  });
  document.getElementById("trendPreviousWeekButton")?.addEventListener("click", () => {
    if (selectedTrendPeriod === "month") setSelectedTrendMonthStart(addMonths(selectedTrendMonthStart(), -1));
    else setSelectedTrendWeekStart(addDays(selectedTrendWeekStart(), -7));
    renderTrends();
  });
  document.getElementById("trendNextWeekButton")?.addEventListener("click", () => {
    if (selectedTrendPeriod === "month") setSelectedTrendMonthStart(addMonths(selectedTrendMonthStart(), 1));
    else setSelectedTrendWeekStart(addDays(selectedTrendWeekStart(), 7));
    renderTrends();
  });
  document.getElementById("shareTrendsButton")?.addEventListener("click", () => shareAllTrends(false));
  document.getElementById("downloadTrendsButton")?.addEventListener("click", () => shareAllTrends(true));
  document.addEventListener("click", event => {
    const trendSegment = event.target.closest("[data-trend-segment]");
    if (trendSegment) {
      selectedTrendSegment = normalizeTrendSegment(trendSegment.dataset.trendSegment);
      renderTrends();
      return;
    }
    const shareCard = event.target.closest("[data-share-trend-card]");
    if (shareCard) {
      shareTrendCard(shareCard.dataset.shareTrendCard, false);
      return;
    }
    const downloadCard = event.target.closest("[data-download-trend-card]");
    if (downloadCard) shareTrendCard(downloadCard.dataset.downloadTrendCard, true);
  });

  function currentAthleteCode() {
    return normalizeAthleteCode(coachSharingState.profile?.athlete_code || "");
  }

  function athleteCodeShareText(code = currentAthleteCode()) {
    return `Connect with me on Fuel Guard using Athlete Code ${code}.`;
  }

  async function copyAthleteCode() {
    const code = currentAthleteCode();
    if (!ATHLETE_CODE_RE.test(code)) {
      setCoachSharingStatus("Your Athlete Code is not ready yet.");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      setCoachSharingStatus("Athlete Code copied.");
    } catch (_error) {
      setCoachSharingStatus(`Copy manually: ${code}`);
    }
  }

  async function shareAthleteCode() {
    const code = currentAthleteCode();
    if (!ATHLETE_CODE_RE.test(code)) {
      setCoachSharingStatus("Your Athlete Code is not ready yet.");
      return;
    }
    const text = athleteCodeShareText(code);
    try {
      if (!navigator.share) {
        await copyAthleteCode();
        return;
      }
      await navigator.share({ title: "Fuel Guard Athlete Code", text });
      setCoachSharingStatus("Athlete Code ready to share.");
    } catch (error) {
      if (/abort/i.test(String(error?.name || error?.message || ""))) return;
      setCoachSharingStatus("Sharing was not available. Copy the code instead.");
    }
  }

  async function updateCoachSharingRelationship(id, nextStatus, successMessage) {
    if (coachSharingBusy || !id) return;
    const client = coachSharingClient();
    const user = coachSharingUser();
    if (!client || !user?.id) {
      setCoachSharingStatus("Sign in before changing coach access.");
      return;
    }
    coachSharingBusy = true;
    setCoachSharingStatus("Updating coach access...");
    try {
      const now = new Date().toISOString();
      const patch = { status: nextStatus, updated_at: now };
      if (nextStatus === "active") {
        patch.accepted_at = now;
        patch.revoked_at = null;
      }
      if (nextStatus === "revoked") patch.revoked_at = now;
      const expectedStatus = nextStatus === "revoked" ? "active" : "pending";
      const updateResult = await client
        .from(COACH_RELATIONSHIPS_TABLE)
        .update(patch)
        .eq("id", id)
        .eq("athlete_id", user.id)
        .eq("status", expectedStatus)
        .select("id,status,accepted_at,updated_at")
        .maybeSingle();
      if (updateResult.error) throw updateResult.error;
      let relationship = updateResult.data;
      if (!relationship) {
        const currentResult = await client
          .from(COACH_RELATIONSHIPS_TABLE)
          .select("id,status,accepted_at,updated_at")
          .eq("id", id)
          .eq("athlete_id", user.id)
          .maybeSingle();
        if (currentResult.error) throw currentResult.error;
        if (currentResult.data?.status !== nextStatus) throw new Error("Coach connection was already changed.");
        relationship = currentResult.data;
      }
      let emailWarning = "";
      const notificationKind = nextStatus === "active"
        ? "coach_approved"
        : nextStatus === "declined"
          ? "coach_declined"
          : "";
      if (notificationKind) {
        try {
          await window.FuelGuardTransactionalEmail.sendNotification({
            accessToken: window.fuelGuardCloud.accessToken(),
            kind: notificationKind,
            entityId: relationship.id
          });
        } catch (emailError) {
          console.error("Coach connection decision email delivery failed", {
            relationshipId: relationship.id,
            kind: notificationKind,
            error: String(emailError?.message || emailError)
          });
          emailWarning = " The relationship was updated, but its email could not be delivered.";
        }
      }
      coachSharingState.loadedFor = "";
      await loadCoachSharingRelationships(true);
      coachSharingState.status = `${successMessage}${emailWarning}`;
    } catch (error) {
      setCoachSharingStatus(coachSharingSetupError(error)
        ? "Coach access setup is not applied yet."
        : `Could not update coach access: ${error?.message || "unknown error"}`);
    } finally {
      coachSharingBusy = false;
      renderCoachSharing();
    }
  }

  function approveCoachSharing(id) {
    return updateCoachSharingRelationship(id, "active", "Coach connection approved.");
  }

  function declineCoachSharing(id) {
    return updateCoachSharingRelationship(id, "declined", "Coach connection declined.");
  }

  async function revokeCoachSharing(id) {
    return updateCoachSharingRelationship(id, "revoked", "Coach access removed.");
  }

  document.getElementById("coachCopyAthleteCodeButton")?.addEventListener("click", copyAthleteCode);
  document.getElementById("coachShareAthleteCodeButton")?.addEventListener("click", shareAthleteCode);
  document.getElementById("athleteProfileSaveButton")?.addEventListener("click", saveAthleteProfile);
  document.addEventListener("click", event => {
    const approve = event.target.closest("[data-approve-coach-sharing]");
    if (approve) {
      approveCoachSharing(approve.dataset.approveCoachSharing);
      return;
    }
    const decline = event.target.closest("[data-decline-coach-sharing]");
    if (decline) {
      declineCoachSharing(decline.dataset.declineCoachSharing);
      return;
    }
    const revoke = event.target.closest("[data-revoke-coach-sharing]");
    if (revoke) revokeCoachSharing(revoke.dataset.revokeCoachSharing);
  });
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
        csvImportStatus = preview.validationMessage || "CSV headers not recognised. Please export logs from your FG button and try again.";
        return;
      }
      csvImportPreview = preview;
      csvImportStatus = preview.logs.length
        ? "Review the fuel logs before importing."
        : preview.validationMessage || "No valid fuel logs found.";
    } catch (error) {
      csvImportStatus = `Import failed: ${error?.message || "unknown error"}`;
    } finally {
      csvImportBusy = false;
      renderSettings();
    }
  });
  document.getElementById("fuelCsvImportConfirmButton")?.addEventListener("click", commitFuelCsvImport);
  document.getElementById("shareDailySummaryButton")?.addEventListener("click", shareDailySummaryImage);
  document.getElementById("downloadDailySummaryButton")?.addEventListener("click", downloadDailySummaryImage);
  window.addEventListener("fuelguard:pwa-update-status", event => {
    const status = document.getElementById("appUpdateStatus");
    if (!status) return;
    status.dataset.userMessage = "true";
    status.textContent = event.detail?.message || "Update status changed.";
  });
  window.addEventListener("fuelguard:cloud-status", () => {
    garminPatternsState.loaded = false;
    renderCoachNudges();
    if (document.getElementById("checklist")?.classList.contains("active")) renderSettings();
    if (document.getElementById("analysis")?.classList.contains("active")) renderAnalysis();
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

  window.fuelGuardDemandPlanning = {
    generateFuelOpportunitiesForDay,
    calculateOpportunityTimingScore,
    calculateDailyFuelScore,
    personalisedInsightContext,
    personalisedInsightCandidates,
    personalisedInsights,
    applyOpportunityMatchesForDay,
    applyOpportunityMatchesForVisibleDays() {
      const keys = new Set([dateKey(), selectedDataDateKey()]);
      betaState().logs.forEach(log => {
        const date = logDate(log);
        if (date) keys.add(dateKey(date));
      });
      demandBlocks().forEach(block => {
        if (block?.date) keys.add(block.date);
      });
      keys.forEach(key => {
        applyOpportunityMatchesForDay(key);
        storeArchive(key);
      });
      save();
    }
  };

  function scheduleFuelGuardTick() {
    const delay = cooldownRemainingSeconds() > 0 ? 1000 : 30000;
    window.setTimeout(() => {
      const currentKey = dateKey();
      if (lastAutoFuelWindowDateKey && currentKey !== lastAutoFuelWindowDateKey) {
        selectedHistoryKey = currentKey;
      }
      lastAutoFuelWindowDateKey = currentKey;
      renderFuelGap();
      scheduleFuelGuardTick();
    }, delay);
  }

  function markFuelGuardAppReady() {
    document.body?.classList.remove("app-booting");
    document.body?.classList.add("app-ready");
  }

  lastAutoFuelWindowDateKey = dateKey();
  renderAll();
  requestAnimationFrame(markFuelGuardAppReady);
  scheduleFuelGuardTick();
})();
