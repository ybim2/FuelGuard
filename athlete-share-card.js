(function attachFuelGuardShareCard(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardShareCard = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardShareCard() {
  "use strict";

  const STORY_WIDTH = 1080;
  const STORY_HEIGHT = 1920;
  const DAILY_TEMPLATE = "daily-story";
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

  function drawBrand(ctx) {
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
    ctx.fillText("DAILY RHYTHM", 220, 132);
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

  return Object.freeze({
    STORY_WIDTH,
    STORY_HEIGHT,
    DAILY_TEMPLATE,
    registerTemplate,
    templateNames: () => Array.from(templates.keys()),
    renderTemplate,
    renderDailyStory,
    buildDailyStoryModel,
    dailyStoryFilename: model => `fuel-guard-daily-${model?.dateKey || localDateKey()}.png`,
    _test: Object.freeze({ dailyStatus, formatRelativeMinutes, validActivityLog, localDateKey })
  });
});
