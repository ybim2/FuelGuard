(function attachFuelGuardShareCard(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardShareCard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardShareCard() {
  "use strict";

  const STORY_WIDTH = 1080;
  const STORY_HEIGHT = 1920;
  const DAILY_TEMPLATE = "daily-story";
  const DAILY_SUMMARY_TEMPLATE = "daily-summary";
  const PRE_POST_TEMPLATE = "pre-post-workout";
  const DURING_WORKOUT_TEMPLATE = "during-workout";
  const SLEEPINESS_TEMPLATE = "sleepiness";
  const ANALYTICS_TEMPLATE = "athlete-analytics";
  const templates = new Map();

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
  }

  function safeDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value || "");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function localDateKey(value = new Date()) {
    const date = safeDate(value) || new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function dateFromLog(log) {
    if (!log || typeof log !== "object") return null;
    return safeDate(log.timestamp || log.logged_at || log.loggedAt || log.date || log.created_at || log.createdAt);
  }

  function validActivityLog(log) {
    if (!dateFromLog(log)) return false;
    if (log.deleted_at || log.deletedAt || log.revoked_at || log.revokedAt || log.valid === false) return false;
    const source = String(log.source || "manual").trim().toLowerCase();
    if (["test", "fixture", "invalid"].includes(source)) return false;
    const type = String(log.type || log.logType || log.log_type || "").trim().toLowerCase();
    return ["fuel", "hydration", "fuel_hydration"].includes(type);
  }

  function isFuel(log) {
    const type = String(log?.type || log?.logType || log?.log_type || "fuel").toLowerCase();
    return type === "fuel" || type === "fuel_hydration";
  }

  function isHydration(log) {
    const type = String(log?.type || log?.logType || log?.log_type || "").toLowerCase();
    return type === "hydration" || type === "fuel_hydration";
  }

  function sessionDate(session) {
    return safeDate(session?.endedAt || session?.ended_at || session?.startedAt || session?.started_at);
  }

  function formatRelativeMinutes(minutes) {
    const rounded = Math.max(0, Math.round(Number(minutes) || 0));
    if (rounded < 2) return "just now";
    if (rounded < 60) return `${rounded}m ago`;
    const hours = Math.floor(rounded / 60);
    const remaining = rounded % 60;
    return `${hours}h${remaining ? ` ${remaining}m` : ""} ago`;
  }

  function dailyStatus(latestFuelAt, now, maximumGapMinutes) {
    if (!latestFuelAt) {
      return {
        key: "empty",
        label: "READY WHEN YOU ARE",
        detail: "Your first fuel moment starts today’s rhythm.",
        color: "#d6e2dc"
      };
    }
    const elapsedMinutes = Math.max(0, (now.getTime() - latestFuelAt.getTime()) / 60000);
    const maximum = clamp(maximumGapMinutes || 180, 120, 240);
    if (elapsedMinutes < maximum - 30) {
      return {
        key: "steady",
        label: "RHYTHM LOCKED",
        detail: `Fuelled ${formatRelativeMinutes(elapsedMinutes)}. Keep it moving.`,
        color: "#b9ff66"
      };
    }
    if (elapsedMinutes < maximum) {
      return {
        key: "approaching",
        label: "FUEL WINDOW",
        detail: `Fuelled ${formatRelativeMinutes(elapsedMinutes)}. Your next moment is close.`,
        color: "#ffd36a"
      };
    }
    return {
      key: "refuel",
      label: "RESET THE RHYTHM",
      detail: `Fuelled ${formatRelativeMinutes(elapsedMinutes)}. Time for the next moment.`,
      color: "#ff8d70"
    };
  }

  function fallbackUsageSummary(logs, now) {
    const daysFor = predicate => new Set(logs.filter(predicate).map(log => localDateKey(dateFromLog(log))));
    const streak = days => {
      let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
      let value = 0;
      while (days.has(localDateKey(cursor))) {
        value += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      return value;
    };
    const fuelDays = daysFor(isFuel);
    const hydrationDays = daysFor(isHydration);
    const usageDays = new Set([...fuelDays, ...hydrationDays]);
    return {
      dayStreak: streak(usageDays),
      fuelStreak: streak(fuelDays),
      hydrationStreak: streak(hydrationDays)
    };
  }

  function buildDailyStoryModel({ logs = [], sessions = [], now = new Date(), maximumGapMinutes = 180, domain = null } = {}) {
    const currentTime = safeDate(now) || new Date();
    const key = domain?.dateKey ? domain.dateKey(currentTime) : localDateKey(currentTime);
    const validLogs = (Array.isArray(logs) ? logs : []).filter(log => (
      domain?.validActivityUsageLog ? domain.validActivityUsageLog(log) : validActivityLog(log)
    ));
    const normalized = validLogs
      .map(log => domain?.normalizeLog ? domain.normalizeLog(log) : { ...log, date: dateFromLog(log) })
      .filter(log => log && (log.date || dateFromLog(log)));
    const dailyLogs = normalized
      .map(log => ({ ...log, date: safeDate(log.date) || dateFromLog(log) }))
      .filter(log => (domain?.dateKey ? domain.dateKey(log.date) : localDateKey(log.date)) === key)
      .sort((a, b) => a.date - b.date);
    const fuelLogs = dailyLogs.filter(log => domain?.isFuelLog ? domain.isFuelLog(log) : isFuel(log));
    const hydrationLogs = dailyLogs.filter(log => domain?.isHydrationLog ? domain.isHydrationLog(log) : isHydration(log));
    const usage = domain?.activityUsageSummary
      ? domain.activityUsageSummary(validLogs, currentTime)
      : fallbackUsageSummary(normalized.map(log => ({ ...log, timestamp: log.date })), currentTime);
    const completedSessions = (Array.isArray(sessions) ? sessions : [])
      .filter(session => String(session?.status || "").toLowerCase() === "completed")
      .filter(session => {
        const date = sessionDate(session);
        return date && (domain?.dateKey ? domain.dateKey(date) : localDateKey(date)) === key;
      });
    const trainingLogCount = dailyLogs.filter(log => String(log.trainingModeSessionId || log.training_mode_session_id || "")).length;
    const latestFuelAt = fuelLogs.length ? fuelLogs[fuelLogs.length - 1].date : null;
    const eventMinutes = dailyLogs.map(log => ({
      minute: log.date.getHours() * 60 + log.date.getMinutes(),
      fuel: domain?.isFuelLog ? domain.isFuelLog(log) : isFuel(log),
      hydration: domain?.isHydrationLog ? domain.isHydrationLog(log) : isHydration(log)
    }));

    return Object.freeze({
      template: DAILY_TEMPLATE,
      dateKey: key,
      dateLabel: new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(currentTime),
      momentCount: dailyLogs.length,
      fuelCount: fuelLogs.length,
      hydrationCount: hydrationLogs.length,
      dayStreak: Math.max(0, Number(usage?.dayStreak) || 0),
      fuelStreak: Math.max(0, Number(usage?.fuelStreak) || 0),
      hydrationStreak: Math.max(0, Number(usage?.hydrationStreak) || 0),
      status: dailyStatus(latestFuelAt, currentTime, maximumGapMinutes),
      training: completedSessions.length
        ? `${completedSessions.length} TRAINING SESSION${completedSessions.length === 1 ? "" : "S"} COMPLETE`
        : trainingLogCount
          ? "TRAINING MODE IN THE RHYTHM"
          : "",
      events: eventMinutes
    });
  }

  function normalizedLogs(logs = [], domain = null) {
    return (Array.isArray(logs) ? logs : [])
      .filter(log => dateFromLog(log))
      .filter(log => !(log.deleted_at || log.deletedAt || log.revoked_at || log.revokedAt || log.valid === false))
      .filter(log => !["test", "fixture", "invalid"].includes(String(log.source || "manual").trim().toLowerCase()))
      .map(log => domain?.normalizeLog ? domain.normalizeLog(log) : { ...log, date: dateFromLog(log) })
      .map(log => ({ ...log, date: safeDate(log?.date) || dateFromLog(log) }))
      .filter(log => log.date)
      .sort((left, right) => left.date - right.date);
  }

  function latestCompletedSession(sessions = []) {
    return (Array.isArray(sessions) ? sessions : [])
      .filter(session => String(session?.status || "").toLowerCase() === "completed" && sessionDate(session))
      .sort((left, right) => sessionDate(right) - sessionDate(left))[0] || null;
  }

  function clock(value, domain = null) {
    const date = safeDate(value);
    if (!date) return "Not recorded";
    return domain?.formatClock ? domain.formatClock(date) : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function measurement(value, unit) {
    const amount = Number(value);
    return Number.isFinite(amount) ? `${Math.round(amount * 10) / 10}${unit}` : "Not recorded";
  }

  function baseSummaryModel(template, title, { kicker = "FUEL GUARD ATHLETE", headline = "", detail = "", metrics = [], note = "", date = new Date() } = {}) {
    return Object.freeze({
      template,
      title,
      kicker,
      headline,
      detail,
      metrics: metrics.slice(0, 6),
      note,
      dateLabel: new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(safeDate(date) || new Date())
    });
  }

  function buildDailySummaryModel({ logs = [], now = new Date(), maximumGapMinutes = 180, domain = null } = {}) {
    const current = safeDate(now) || new Date();
    const key = domain?.dateKey ? domain.dateKey(current) : localDateKey(current);
    const today = normalizedLogs(logs, domain).filter(log => (domain?.dateKey ? domain.dateKey(log.date) : localDateKey(log.date)) === key);
    const fuel = today.filter(log => domain?.isFuelLog ? domain.isFuelLog(log) : isFuel(log));
    const hydration = today.filter(log => domain?.isHydrationLog ? domain.isHydrationLog(log) : isHydration(log));
    const lastFuel = fuel.at(-1)?.date || null;
    const lastHydration = hydration.at(-1)?.date || null;
    const fuelMinutes = lastFuel ? Math.max(0, (current - lastFuel) / 60000) : null;
    const hydrationMinutes = lastHydration ? Math.max(0, (current - lastHydration) / 60000) : null;
    const status = dailyStatus(lastFuel, current, maximumGapMinutes);
    return baseSummaryModel(DAILY_SUMMARY_TEMPLATE, "Daily Fuel + Hydration", {
      headline: status.label,
      detail: status.detail,
      metrics: [
        { label: "Last Fuel", value: clock(lastFuel, domain), accent: "fuel" },
        { label: "Since Fuel", value: Number.isFinite(fuelMinutes) ? formatRelativeMinutes(fuelMinutes) : "No Fuel yet", accent: "fuel" },
        { label: "Last Hydration", value: clock(lastHydration, domain), accent: "hydration" },
        { label: "Since Hydration", value: Number.isFinite(hydrationMinutes) ? formatRelativeMinutes(hydrationMinutes) : "No Hydration yet", accent: "hydration" }
      ],
      note: `${fuel.length} Fuel · ${hydration.length} Hydration recorded today`,
      date: current
    });
  }

  function buildPrePostWorkoutModel({ logs = [], sessions = [], domain = null } = {}) {
    const session = latestCompletedSession(sessions);
    if (!session) return baseSummaryModel(PRE_POST_TEMPLATE, "Pre/Post Workout Fuelling", {
      headline: "BUILD YOUR FIRST SESSION",
      detail: "Complete Training Mode to create a pre/post-workout summary.",
      metrics: []
    });
    const startAt = safeDate(session.startedAt || session.started_at);
    const endAt = safeDate(session.endedAt || session.ended_at);
    const context = domain?.getWorkoutFuelContext?.({
      id: session.id,
      athleteId: session.userId || session.user_id || "",
      source: "training_mode",
      type: session.sessionType || session.session_type || "training",
      title: session.title || "Training session",
      startAt,
      endAt
    }, normalizedLogs(logs, domain)) || {};
    return baseSummaryModel(PRE_POST_TEMPLATE, "Pre/Post Workout Fuelling", {
      headline: String(session.title || "Training session").toUpperCase(),
      detail: `${clock(startAt, domain)}–${clock(endAt, domain)}`,
      metrics: [
        { label: "Fuel before", value: context.hasPreviousFuel ? `${domain?.duration?.(context.preFuelGapMinutes) || `${context.preFuelGapMinutes}m`} before` : "Not recorded", accent: "fuel" },
        { label: "Fuel after", value: context.hasPostFuel ? `${domain?.duration?.(context.postFuelGapMinutes) || `${context.postFuelGapMinutes}m`} after` : "Not recorded", accent: "fuel" }
      ],
      note: "Timing reflects recorded Fuel moments around this completed session.",
      date: endAt
    });
  }

  function buildDuringWorkoutModel({ logs = [], sessions = [], domain = null } = {}) {
    const session = latestCompletedSession(sessions);
    if (!session || !domain?.trainingCompletionSummary) return baseSummaryModel(DURING_WORKOUT_TEMPLATE, "During-Workout Fuelling", {
      headline: "NO COMPLETED SESSION YET",
      detail: "Complete Training Mode to create a session nutrition summary."
    });
    const summary = domain.trainingCompletionSummary({ session, logs: normalizedLogs(logs, domain), now: new Date() });
    const plannedCarbs = summary.planned?.totals?.carbsG;
    return baseSummaryModel(DURING_WORKOUT_TEMPLATE, "During-Workout Fuelling", {
      headline: String(summary.title || "Training session").toUpperCase(),
      detail: `${clock(summary.startedAt, domain)}–${clock(summary.endedAt, domain)} · ${summary.fuelEventCount} Fuel · ${summary.hydrationEventCount} Hydration`,
      metrics: [
        { label: "Carbohydrate", value: measurement(summary.totals.carbsG, "g"), accent: "fuel" },
        { label: "Fluid", value: measurement(summary.totals.fluidMl, "ml"), accent: "hydration" },
        { label: "Sodium", value: measurement(summary.totals.sodiumMg, "mg"), accent: "hydration" },
        { label: "Caffeine", value: measurement(summary.totals.caffeineMg, "mg"), accent: "neutral" }
      ],
      note: Number.isFinite(plannedCarbs) ? `Actual ${measurement(summary.totals.carbsG, "g")} carbohydrate · Planned ${measurement(plannedCarbs, "g")}` : summary.coverageMessage,
      date: summary.endedAt
    });
  }

  function sleepPeriod(date) {
    const hour = date.getHours();
    if (hour < 12) return "Morning";
    if (hour < 17) return "Afternoon";
    return "Evening";
  }

  function buildSleepinessModel({ logs = [], now = new Date(), domain = null } = {}) {
    const current = safeDate(now) || new Date();
    const start = new Date(current.getTime() - 7 * 86400000);
    const sleepy = normalizedLogs(logs, domain)
      .filter(log => domain?.isSleepyLog ? domain.isSleepyLog(log) : String(log?.type || "").toLowerCase() === "sleepy")
      .filter(log => log.date >= start && log.date <= current)
      .sort((left, right) => left.date - right.date);
    const counts = sleepy.reduce((map, log) => map.set(sleepPeriod(log.date), (map.get(sleepPeriod(log.date)) || 0) + 1), new Map());
    const common = sleepy.length >= 2 ? [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] : null;
    return baseSummaryModel(SLEEPINESS_TEMPLATE, "Sleepiness", {
      headline: sleepy.length ? `${sleepy.length} SLEEPY EVENT${sleepy.length === 1 ? "" : "S"}` : "NO SLEEPY EVENTS",
      detail: "Recorded over the last seven days.",
      metrics: [
        { label: "Latest", value: sleepy.length ? `${clock(sleepy.at(-1).date, domain)} · ${sleepPeriod(sleepy.at(-1).date)}` : "Not recorded", accent: "neutral" },
        { label: "Common period", value: common || "Needs two events", accent: "neutral" }
      ],
      note: sleepy.length >= 2 ? "This is a timing pattern from your records, not a causal or medical conclusion." : "More recorded events are needed before showing a timing pattern.",
      date: current
    });
  }

  function buildSummaryModel(template, data = {}) {
    if (template === DAILY_SUMMARY_TEMPLATE) return buildDailySummaryModel(data);
    if (template === PRE_POST_TEMPLATE) return buildPrePostWorkoutModel(data);
    if (template === DURING_WORKOUT_TEMPLATE) return buildDuringWorkoutModel(data);
    if (template === SLEEPINESS_TEMPLATE) return buildSleepinessModel(data);
    if (template === ANALYTICS_TEMPLATE) return buildAnalyticsStoryModel(data);
    throw new Error(`Unknown Fuel Guard share model: ${template}`);
  }

  function buildAnalyticsStoryModel({ analytics = {}, athleteName = "", now = new Date() } = {}) {
    const rhythm = analytics.rhythm || {};
    const training = analytics.training || {};
    const metrics = [];
    if (rhythm.peak?.label) metrics.push({ label: "Most common fuel time", value: rhythm.peak.label, accent: "fuel" });
    if (rhythm.typicalGap?.averageMinutes) metrics.push({ label: "Recurring daytime gap", value: `${Math.floor(rhythm.typicalGap.averageMinutes / 60)}h ${rhythm.typicalGap.averageMinutes % 60}m`, accent: "neutral" });
    if (training.sufficient && Number(training.metrics?.carbsG?.perHour) > 0) metrics.push({ label: "Training carbohydrate", value: `${Math.round(training.metrics.carbsG.perHour)} g/hr`, accent: "fuel" });
    if (training.sufficient && Number(training.metrics?.fluidMl?.perHour) > 0) metrics.push({ label: "Training fluid", value: `${Math.round(training.metrics.fluidMl.perHour)} ml/hr`, accent: "hydration" });
    const period = String(analytics.period || "30d").toUpperCase();
    const safeName = String(athleteName || "").trim().slice(0, 30);
    return Object.freeze({ ...baseSummaryModel(ANALYTICS_TEMPLATE, safeName ? `${safeName.toUpperCase()}’S FUEL RHYTHM` : "YOUR FUEL RHYTHM", {
      kicker: "FUEL GUARD ATHLETE · ANALYTICS",
      headline: rhythm.sufficient ? `${rhythm.typicalEventsPerLoggedDay} FUEL MOMENTS` : "RHYTHM IN PROGRESS",
      detail: rhythm.sufficient ? `Your average across ${rhythm.loggedDays} logged days · ${period}` : "Keep logging Fuel to reveal your own daily rhythm.",
      metrics,
      note: training.sufficient
        ? `${training.workoutCount} completed Training Mode workout${training.workoutCount === 1 ? "" : "s"} included. Recorded behaviour, not a target.`
        : "Built only from your recorded Fuel and completed Training Mode sessions.",
      date: now
    }),
      period,
      rhythmBars: Array.isArray(rhythm.bars) ? rhythm.bars.slice(0, 24).map(item => clamp(item?.relativeHeight, 0, 100)) : [],
      trainingRates: {
        carbsG: training.sufficient ? Number(training.metrics?.carbsG?.perHour) || null : null,
        sodiumMg: training.sufficient ? Number(training.metrics?.sodiumMg?.perHour) || null : null,
        fluidMl: training.sufficient ? Number(training.metrics?.fluidMl?.perHour) || null : null
      },
      insight: rhythm.typicalGap?.averageMinutes
        ? `Longest recurring daytime gap: ${Math.floor(rhythm.typicalGap.averageMinutes / 60)}h ${rhythm.typicalGap.averageMinutes % 60}m.`
        : rhythm.peak?.label ? `Most common fuel window: ${rhythm.peak.label}.` : "Your Fuel Rhythm becomes clearer as you keep logging."
    });
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function fillPill(ctx, x, y, width, height, fill, stroke = "") {
    roundedRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function fitFont(ctx, text, { maximum, minimum, width, weight = 800 } = {}) {
    let size = Number(maximum) || 48;
    const floor = Number(minimum) || 24;
    do {
      ctx.font = `${weight} ${size}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      if (ctx.measureText(String(text || "")).width <= width || size <= floor) return size;
      size -= 2;
    } while (size >= floor);
    return floor;
  }

  function drawBrand(ctx, subtitle = "DAILY RHYTHM") {
    ctx.save();
    fillPill(ctx, 72, 78, 118, 72, "#b9ff66");
    ctx.fillStyle = "#08120e";
    ctx.font = "900 36px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FG", 131, 115);
    ctx.fillStyle = "rgba(244,250,247,0.92)";
    ctx.font = "750 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("FUEL GUARD", 220, 101);
    ctx.fillStyle = "rgba(244,250,247,0.5)";
    ctx.font = "650 18px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(String(subtitle || "FUEL GUARD ATHLETE"), 220, 132);
    ctx.restore();
  }

  function drawBackground(ctx, width, height) {
    ctx.fillStyle = "#06100c";
    ctx.fillRect(0, 0, width, height);
    const wash = ctx.createLinearGradient(0, 0, width, height);
    wash.addColorStop(0, "rgba(19,69,48,0.74)");
    wash.addColorStop(0.45, "rgba(6,16,12,0.22)");
    wash.addColorStop(1, "rgba(14,42,57,0.68)");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(870, 380, 0, 870, 380, 700);
    glow.addColorStop(0, "rgba(185,255,102,0.2)");
    glow.addColorStop(0.48, "rgba(89,197,133,0.06)");
    glow.addColorStop(1, "rgba(6,16,12,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(218,255,228,0.055)";
    ctx.lineWidth = 2;
    for (let offset = -height; offset < width; offset += 90) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + height, height);
      ctx.stroke();
    }
  }

  function drawRhythm(ctx, model) {
    const x = 92;
    const y = 1030;
    const width = 896;
    ctx.fillStyle = "rgba(240,250,245,0.48)";
    ctx.font = "700 21px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("TODAY’S RHYTHM", x, y - 48);

    const trackY = y + 42;
    ctx.strokeStyle = "rgba(236,250,242,0.2)";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, trackY);
    ctx.lineTo(x + width, trackY);
    ctx.stroke();

    [360, 720, 1080].forEach(minute => {
      const px = x + (minute / 1440) * width;
      ctx.fillStyle = "rgba(240,250,245,0.28)";
      ctx.beginPath();
      ctx.arc(px, trackY, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    model.events.slice(0, 20).forEach((event, index) => {
      const px = x + clamp(event.minute / 1440, 0, 1) * width;
      const py = trackY + (index % 2 ? 18 : -18);
      ctx.fillStyle = event.fuel && event.hydration ? "#f5fbf7" : event.fuel ? "#b9ff66" : "#65c8ff";
      ctx.beginPath();
      ctx.arc(px, py, event.fuel && event.hydration ? 13 : 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(6,16,12,0.72)";
      ctx.lineWidth = 4;
      ctx.stroke();
    });

    ctx.fillStyle = "#f4faf7";
    ctx.font = "800 34px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${model.fuelCount} FUEL`, x, y + 144);
    ctx.fillStyle = "#65c8ff";
    ctx.fillText(`${model.hydrationCount} HYDRATION`, x + 292, y + 144);
  }

  function drawStreaks(ctx, model) {
    const y = 1368;
    fillPill(ctx, 72, y, 936, 270, "rgba(236,250,242,0.075)", "rgba(236,250,242,0.14)");
    ctx.fillStyle = "rgba(240,250,245,0.48)";
    ctx.font = "700 21px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("CONSISTENCY, BUILT DAILY", 112, y + 58);

    const streaks = [
      ["DAY", model.dayStreak, "#f4faf7"],
      ["FUEL", model.fuelStreak, "#b9ff66"],
      ["HYDRATION", model.hydrationStreak, "#65c8ff"]
    ];
    streaks.forEach(([label, value, color], index) => {
      const columnX = 112 + index * 296;
      ctx.fillStyle = color;
      ctx.font = "850 72px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(String(value), columnX, y + 158);
      ctx.fillStyle = "rgba(240,250,245,0.58)";
      ctx.font = "700 21px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(`${label} STREAK`, columnX, y + 206);
    });
  }

  function renderDailyStory(model, { canvasFactory } = {}) {
    const makeCanvas = canvasFactory || (() => {
      if (typeof document === "undefined") throw new Error("A canvas factory is required outside the browser.");
      return document.createElement("canvas");
    });
    const canvas = makeCanvas();
    canvas.width = STORY_WIDTH;
    canvas.height = STORY_HEIGHT;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) throw new Error("Story image export is not supported in this browser.");

    drawBackground(ctx, STORY_WIDTH, STORY_HEIGHT);
    drawBrand(ctx);
    ctx.fillStyle = "rgba(244,250,247,0.62)";
    ctx.font = "650 27px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(model.dateLabel || "TODAY").toUpperCase(), 74, 264);

    ctx.fillStyle = model.status?.color || "#b9ff66";
    const statusLabel = model.status?.label || "DAILY RHYTHM";
    fitFont(ctx, statusLabel, { maximum: 98, minimum: 66, width: 936, weight: 900 });
    ctx.fillText(statusLabel, 72, 470);
    ctx.fillStyle = "rgba(244,250,247,0.82)";
    const statusDetail = model.status?.detail || "Keep building the rhythm.";
    fitFont(ctx, statusDetail, { maximum: 37, minimum: 28, width: 928, weight: 520 });
    ctx.fillText(statusDetail, 76, 548);

    ctx.strokeStyle = model.status?.color || "#b9ff66";
    ctx.globalAlpha = 0.72;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(540, 785, 175, Math.PI * 0.18, Math.PI * 1.82);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f4faf7";
    ctx.font = "900 128px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(model.momentCount ?? model.events?.length ?? 0), 540, 820);
    ctx.fillStyle = "rgba(244,250,247,0.56)";
    ctx.font = "700 23px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("MOMENTS TODAY", 540, 866);

    if (model.training) {
      ctx.font = "750 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      const badgeWidth = Math.min(700, ctx.measureText(model.training).width + 74);
      fillPill(ctx, (STORY_WIDTH - badgeWidth) / 2, 910, badgeWidth, 58, "rgba(185,255,102,0.12)", "rgba(185,255,102,0.3)");
      ctx.fillStyle = "#b9ff66";
      ctx.textAlign = "center";
      ctx.fillText(model.training, STORY_WIDTH / 2, 947);
    }

    drawRhythm(ctx, model);
    drawStreaks(ctx, model);

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(244,250,247,0.86)";
    ctx.font = "760 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("FUEL THE WORK. PROTECT THE RHYTHM.", 72, 1764);
    ctx.fillStyle = "rgba(244,250,247,0.42)";
    ctx.font = "650 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("FUELGUARDAPP.COM", 72, 1812);
    return canvas;
  }

  function wrappedText(ctx, text, x, y, maximumWidth, lineHeight, maximumLines = 3) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    words.forEach(word => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maximumWidth || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    lines.slice(0, maximumLines).forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
    return Math.min(lines.length, maximumLines);
  }

  function renderSummaryStory(model, { canvasFactory } = {}) {
    const makeCanvas = canvasFactory || (() => {
      if (typeof document === "undefined") throw new Error("A canvas factory is required outside the browser.");
      return document.createElement("canvas");
    });
    const canvas = makeCanvas();
    canvas.width = STORY_WIDTH;
    canvas.height = STORY_HEIGHT;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) throw new Error("Story image export is not supported in this browser.");
    drawBackground(ctx, STORY_WIDTH, STORY_HEIGHT);
    drawBrand(ctx, "ATHLETE STORY");

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(244,250,247,0.5)";
    ctx.font = "700 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(String(model.kicker || "FUEL GUARD ATHLETE"), 72, 248);
    ctx.fillStyle = "#f4faf7";
    fitFont(ctx, model.title, { maximum: 58, minimum: 40, width: 936, weight: 860 });
    ctx.fillText(String(model.title || "Fuel Guard"), 72, 330);

    ctx.fillStyle = "#b9ff66";
    fitFont(ctx, model.headline, { maximum: 88, minimum: 48, width: 936, weight: 900 });
    wrappedText(ctx, model.headline, 72, 490, 936, 96, 2);
    ctx.fillStyle = "rgba(244,250,247,0.72)";
    ctx.font = "540 30px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    wrappedText(ctx, model.detail, 72, 700, 900, 42, 3);

    const metrics = Array.isArray(model.metrics) ? model.metrics : [];
    const columns = metrics.length <= 2 ? 1 : 2;
    const gap = 24;
    const width = columns === 1 ? 936 : (936 - gap) / 2;
    const cardHeight = metrics.length <= 2 ? 220 : 190;
    metrics.forEach((metric, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = 72 + column * (width + gap);
      const y = 880 + row * (cardHeight + gap);
      const accent = metric.accent === "hydration" ? "#65c8ff" : metric.accent === "fuel" ? "#b9ff66" : "#f4faf7";
      roundedRect(ctx, x, y, width, cardHeight, 28);
      ctx.fillStyle = "rgba(236,250,242,0.075)";
      ctx.fill();
      ctx.strokeStyle = "rgba(236,250,242,0.14)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = "rgba(244,250,247,0.48)";
      ctx.font = "700 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(String(metric.label || "VALUE").toUpperCase(), x + 34, y + 54);
      ctx.fillStyle = accent;
      fitFont(ctx, metric.value, { maximum: 48, minimum: 28, width: width - 68, weight: 850 });
      wrappedText(ctx, metric.value, x + 34, y + 126, width - 68, 48, 2);
    });

    ctx.fillStyle = "rgba(244,250,247,0.66)";
    ctx.font = "560 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    wrappedText(ctx, model.note, 72, 1628, 920, 38, 3);
    ctx.fillStyle = "rgba(244,250,247,0.4)";
    ctx.font = "650 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(String(model.dateLabel || "").toUpperCase(), 72, 1770);
    ctx.fillText("FUELGUARDAPP.COM", 72, 1815);
    return canvas;
  }

  function renderAnalyticsStory(model, { canvasFactory } = {}) {
    const makeCanvas = canvasFactory || (() => {
      if (typeof document === "undefined") throw new Error("A canvas factory is required outside the browser.");
      return document.createElement("canvas");
    });
    const canvas = makeCanvas();
    canvas.width = STORY_WIDTH;
    canvas.height = STORY_HEIGHT;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) throw new Error("Story image export is not supported in this browser.");
    drawBackground(ctx, STORY_WIDTH, STORY_HEIGHT);
    drawBrand(ctx, "ATHLETE ANALYTICS");

    ctx.textAlign = "left";
    ctx.fillStyle = "#b9ff66";
    fitFont(ctx, model.title, { maximum: 76, minimum: 46, width: 936, weight: 900 });
    ctx.fillText(String(model.title || "YOUR FUEL RHYTHM"), 72, 320);
    ctx.fillStyle = "rgba(244,250,247,.5)";
    ctx.font = "700 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText(`${model.period || "30D"} · AVERAGE LOGGED DAY`, 74, 374);

    const bars = Array.isArray(model.rhythmBars) && model.rhythmBars.length === 24 ? model.rhythmBars : Array(24).fill(4);
    const chartX = 76;
    const chartY = 790;
    const chartWidth = 928;
    const gap = 10;
    const barWidth = (chartWidth - gap * 23) / 24;
    ctx.strokeStyle = "rgba(244,250,247,.16)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(chartX, chartY);
    ctx.lineTo(chartX + chartWidth, chartY);
    ctx.stroke();
    bars.forEach((height, index) => {
      const barHeight = Math.max(8, clamp(height, 0, 100) / 100 * 310);
      const gradient = ctx.createLinearGradient(0, chartY - barHeight, 0, chartY);
      gradient.addColorStop(0, "#b9ff66");
      gradient.addColorStop(1, "#168b4e");
      roundedRect(ctx, chartX + index * (barWidth + gap), chartY - barHeight, barWidth, barHeight, barWidth / 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    });
    ctx.fillStyle = "rgba(244,250,247,.78)";
    ctx.font = "750 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    [[0, "12 AM"], [6, "6 AM"], [12, "12 PM"], [18, "6 PM"], [23, "12 AM"]].forEach(([hour, label]) => {
      ctx.textAlign = hour === 23 ? "right" : "left";
      ctx.fillText(label, chartX + hour / 23 * chartWidth, chartY + 50);
    });

    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(244,250,247,.5)";
    ctx.font = "700 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("HOW I FUEL TRAINING", 76, 940);
    const rates = [
      ["CARBOHYDRATE", model.trainingRates?.carbsG, "g/hr", "#b9ff66"],
      ["SODIUM", model.trainingRates?.sodiumMg, "mg/hr", "#c2baff"],
      ["FLUID", model.trainingRates?.fluidMl, "ml/hr", "#65c8ff"]
    ];
    rates.forEach(([label, value, unit, color], index) => {
      const x = 76 + index * 309;
      ctx.fillStyle = "rgba(236,250,242,.07)";
      roundedRect(ctx, x, 988, 285, 250, 28);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = "900 70px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(Number.isFinite(value) ? String(Math.round(value)) : "—", x + 24, 1090);
      ctx.fillStyle = "rgba(244,250,247,.78)";
      ctx.font = "750 22px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(unit, x + 26, 1130);
      ctx.fillStyle = "rgba(244,250,247,.46)";
      ctx.font = "700 17px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(label, x + 26, 1192);
    });

    fillPill(ctx, 72, 1320, 936, 250, "rgba(236,250,242,.075)", "rgba(236,250,242,.14)");
    ctx.fillStyle = "rgba(244,250,247,.5)";
    ctx.font = "700 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("ONE THING THAT STANDS OUT", 112, 1382);
    ctx.fillStyle = "#f4faf7";
    ctx.font = "760 37px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    wrappedText(ctx, model.insight, 112, 1460, 840, 49, 3);

    ctx.fillStyle = "rgba(244,250,247,.82)";
    ctx.font = "760 26px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("MY BEHAVIOUR. MY FUEL RHYTHM.", 72, 1764);
    ctx.fillStyle = "rgba(244,250,247,.42)";
    ctx.font = "650 20px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillText("FUELGUARDAPP.COM", 72, 1812);
    return canvas;
  }

  function registerTemplate(name, renderer) {
    const key = String(name || "").trim();
    if (!key || typeof renderer !== "function") throw new TypeError("A template name and renderer are required.");
    templates.set(key, renderer);
    return key;
  }

  function renderTemplate(name, model, options) {
    const renderer = templates.get(String(name || ""));
    if (!renderer) throw new Error(`Unknown Fuel Guard story template: ${name}`);
    return renderer(model, options);
  }

  registerTemplate(DAILY_TEMPLATE, renderDailyStory);
  registerTemplate(DAILY_SUMMARY_TEMPLATE, renderSummaryStory);
  registerTemplate(PRE_POST_TEMPLATE, renderSummaryStory);
  registerTemplate(DURING_WORKOUT_TEMPLATE, renderSummaryStory);
  registerTemplate(SLEEPINESS_TEMPLATE, renderSummaryStory);
  registerTemplate(ANALYTICS_TEMPLATE, renderAnalyticsStory);

  return Object.freeze({
    STORY_WIDTH,
    STORY_HEIGHT,
    DAILY_TEMPLATE,
    DAILY_SUMMARY_TEMPLATE,
    PRE_POST_TEMPLATE,
    DURING_WORKOUT_TEMPLATE,
    SLEEPINESS_TEMPLATE,
    ANALYTICS_TEMPLATE,
    registerTemplate,
    templateNames: () => Array.from(templates.keys()),
    renderTemplate,
    renderDailyStory,
    renderSummaryStory,
    renderAnalyticsStory,
    buildDailyStoryModel,
    buildDailySummaryModel,
    buildPrePostWorkoutModel,
    buildDuringWorkoutModel,
    buildSleepinessModel,
    buildAnalyticsStoryModel,
    buildSummaryModel,
    dailyStoryFilename: model => `fuel-guard-daily-${model?.dateKey || localDateKey()}.png`,
    _test: Object.freeze({ dailyStatus, formatRelativeMinutes, validActivityLog, localDateKey })
  });
});
