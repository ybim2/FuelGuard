// Fuel Guard risk visual layer.
// Colours the main Live Fuel Rhythm canvas stroke directly, without drawing a second overlay graph.
(() => {
  const RISK_COLOURS = {
    green: "#2dff88",
    amber: "#ffb020",
    red: "#ff4d6d"
  };
  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };

  function gapState() {
    if (typeof fuelGapState === "function") return fuelGapState();
    return window.state?.fuelGap || { logs: [], thresholds: { ...DEFAULT_THRESHOLDS } };
  }

  function thresholds() {
    const source = gapState().thresholds || {};
    const greenMinutes = Number(source.greenMinutes || DEFAULT_THRESHOLDS.greenMinutes);
    const redMinutes = Math.max(Number(source.redMinutes || DEFAULT_THRESHOLDS.redMinutes), greenMinutes + 30);
    return { greenMinutes, redMinutes };
  }

  function statusForMinutes(minutes) {
    if (typeof fuelGapStatus === "function") return fuelGapStatus(minutes);
    const limits = thresholds();
    if (!Number.isFinite(minutes)) return "red";
    if (minutes < limits.greenMinutes) return "green";
    if (minutes < limits.redMinutes) return "amber";
    return "red";
  }

  function logDate(log) {
    if (typeof fuelLogDate === "function") return fuelLogDate(log);
    const raw = log?.timestamp || log;
    const date = raw ? new Date(raw) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function dateKey(date = new Date()) {
    if (typeof todayKey === "function") return todayKey(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfDay(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function minutesIntoDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function logType(log) {
    const type = String(log?.type || "fuel").toLowerCase();
    return type === "hydration" ? "hydration" : "fuel";
  }

  function isFuelLog(log) {
    return logType(log) === "fuel";
  }

  function logsWithDates() {
    return (gapState().logs || [])
      .map(log => ({ ...log, date: logDate(log) }))
      .filter(log => log.date)
      .sort((a, b) => a.date - b.date);
  }

  function fuelDatesUntil(now = new Date()) {
    return logsWithDates().filter(log => isFuelLog(log) && log.date <= now).map(log => log.date);
  }

  function latestFuelBefore(fuelDates, date) {
    for (let index = fuelDates.length - 1; index >= 0; index -= 1) {
      if (fuelDates[index] <= date) return fuelDates[index];
    }
    return null;
  }

  function statusAtMinute(minute, now, fuelDates) {
    const date = new Date(startOfDay(now).getTime() + minute * 60000);
    const latest = latestFuelBefore(fuelDates, date);
    if (!latest) return "red";
    return statusForMinutes((date - latest) / 60000);
  }

  function currentMinute(now = new Date()) {
    return clamp(minutesIntoDay(now), 0, 1440);
  }

  function gradientStops(now, current, fuelDates) {
    const dayStart = startOfDay(now);
    const limits = thresholds();
    const stops = new Set([0, current]);

    fuelDates.forEach(date => {
      const fuelMinute = (date - dayStart) / 60000;
      [fuelMinute, fuelMinute + limits.greenMinutes, fuelMinute + limits.redMinutes].forEach(stop => {
        if (Number.isFinite(stop) && stop >= 0 && stop <= current) stops.add(clamp(stop, 0, current));
      });
    });

    return [...stops].sort((a, b) => a - b);
  }

  function addStop(addColorStop, gradient, stop, colour) {
    addColorStop.call(gradient, clamp(stop, 0, 1), colour);
  }

  function paintRiskGradient(gradient, addColorStop, now = new Date()) {
    const fuelDates = fuelDatesUntil(now);
    const current = currentMinute(now);
    const stops = gradientStops(now, current, fuelDates);
    const toOffset = minute => clamp(minute / 1440, 0, 1);
    const nudge = 0.0001;

    if (stops.length < 2) {
      const colour = RISK_COLOURS[statusAtMinute(current, now, fuelDates)] || RISK_COLOURS.red;
      addStop(addColorStop, gradient, 0, colour);
      addStop(addColorStop, gradient, 1, colour);
      return;
    }

    stops.forEach((minute, index) => {
      if (index === stops.length - 1) return;
      const nextMinute = stops[index + 1];
      const midpoint = (minute + nextMinute) / 2;
      const colour = RISK_COLOURS[statusAtMinute(midpoint, now, fuelDates)] || RISK_COLOURS.red;
      const start = toOffset(minute);
      const end = toOffset(nextMinute);
      addStop(addColorStop, gradient, start, colour);
      addStop(addColorStop, gradient, Math.max(start, end - nudge), colour);
    });

    const finalColour = RISK_COLOURS[statusAtMinute(current, now, fuelDates)] || RISK_COLOURS.red;
    addStop(addColorStop, gradient, toOffset(current), finalColour);
    addStop(addColorStop, gradient, 1, finalColour);
  }

  function isRhythmStrokeGradient(ctx, x0, y0, x1, y1) {
    if (ctx.canvas?.id !== "fuelRhythmGraph") return false;
    if (Math.abs(y0) > 0.01 || Math.abs(y1) > 0.01) return false;
    if (x1 <= x0) return false;
    return x0 >= 20;
  }

  function installRiskStrokeGradient() {
    const canvasContext = window.CanvasRenderingContext2D?.prototype;
    const gradientProto = window.CanvasGradient?.prototype;
    if (!canvasContext || !gradientProto || canvasContext.__fuelGuardRiskStroke) return;

    const baseCreateLinearGradient = canvasContext.createLinearGradient;
    const baseAddColorStop = gradientProto.addColorStop;
    const lockedGradients = new WeakSet();

    gradientProto.addColorStop = function fuelGuardAddColorStop(offset, colour) {
      if (lockedGradients.has(this)) return undefined;
      return baseAddColorStop.call(this, offset, colour);
    };

    canvasContext.createLinearGradient = function fuelGuardCreateLinearGradient(x0, y0, x1, y1) {
      const gradient = baseCreateLinearGradient.call(this, x0, y0, x1, y1);
      if (!isRhythmStrokeGradient(this, x0, y0, x1, y1)) return gradient;

      paintRiskGradient(gradient, baseAddColorStop);
      lockedGradients.add(gradient);
      return gradient;
    };

    canvasContext.__fuelGuardRiskStroke = true;
  }

  function injectHistoryGridStyle() {
    if (document.getElementById("fuel-risk-history-grid-style")) return;
    const style = document.createElement("style");
    style.id = "fuel-risk-history-grid-style";
    style.textContent = `
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div {
        min-width: 0;
      }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(1) { order: 1; }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(2) { order: 2; }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(5) { order: 3; border-color: rgba(45,255,136,.2); }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(4) { order: 4; border-color: rgba(45,255,136,.2); }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(3) { order: 5; }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(6) { order: 6; }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(7) { order: 7; }
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(8) { order: 8; }
    `;
    document.head.appendChild(style);
  }

  installRiskStrokeGradient();
  document.addEventListener("DOMContentLoaded", () => {
    installRiskStrokeGradient();
    injectHistoryGridStyle();
  });
})();
