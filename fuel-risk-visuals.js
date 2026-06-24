// Fuel Guard risk visual layer.
// Keeps the original smooth graph behaviour and colours that same curve by risk section.
(() => {
  const RISK_COLOURS = {
    green: "#2dff88",
    amber: "#ffb020",
    red: "#ff4d6d"
  };
  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };
  let installed = false;
  let queued = false;

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

  function todayLogs(now = new Date()) {
    const key = dateKey(now);
    return logsWithDates().filter(log => dateKey(log.date) === key && log.date <= now);
  }

  function fuelDatesUntil(now = new Date()) {
    return logsWithDates().filter(log => isFuelLog(log) && log.date <= now).map(log => log.date);
  }

  // Matches the beta graph's original point physics: same decline rate, same fuel spike, same current marker.
  function buildCurve(now = new Date()) {
    const logs = todayLogs(now);
    const currentMinute = clamp(minutesIntoDay(now), 0, 1440);
    const points = [{ minute: 0, value: 42 }];
    const markers = [];
    let value = 42;
    let lastMinute = 0;

    logs.forEach(log => {
      const minute = clamp(minutesIntoDay(log.date), 0, currentMinute);
      value = clamp(value - Math.max(0, minute - lastMinute) * 0.11, 8, 95);
      points.push({ minute, value });
      if (isFuelLog(log)) {
        value = clamp(Math.max(value + 42, 86), 8, 95);
        const marker = { minute: Math.min(1440, minute + 0.45), value, log };
        markers.push(marker);
        points.push(marker);
      }
      lastMinute = minute;
    });

    value = clamp(value - Math.max(0, currentMinute - lastMinute) * 0.11, 8, 95);
    points.push({ minute: currentMinute, value, current: true });
    return { points, markers };
  }

  function tracePath(ctx, coordinates) {
    if (!coordinates.length) return;
    ctx.moveTo(coordinates[0].x, coordinates[0].y);
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      const midX = (previous.x + current.x) / 2;
      const midY = (previous.y + current.y) / 2;
      ctx.quadraticCurveTo(previous.x, previous.y, midX, midY);
    }
    const last = coordinates[coordinates.length - 1];
    ctx.lineTo(last.x, last.y);
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

  function gradientStopPoints(now, currentMinute, fuelDates) {
    const start = startOfDay(now);
    const limits = thresholds();
    const points = new Set([0, currentMinute]);

    fuelDates.forEach(date => {
      const fuelMinute = (date - start) / 60000;
      [fuelMinute, fuelMinute + limits.greenMinutes, fuelMinute + limits.redMinutes].forEach(point => {
        if (point >= 0 && point <= currentMinute) points.add(clamp(point, 0, currentMinute));
      });
    });

    return [...points].filter(Number.isFinite).sort((a, b) => a - b);
  }

  function addGradientStop(gradient, stop, colour) {
    gradient.addColorStop(clamp(stop, 0, 1), colour);
  }

  function createRiskGradient(ctx, padding, cssWidth, now, currentMinute) {
    const gradient = ctx.createLinearGradient(padding.left, 0, cssWidth - padding.right, 0);
    const fuelDates = fuelDatesUntil(now);
    const stops = gradientStopPoints(now, currentMinute, fuelDates);
    const stopForMinute = minute => clamp(minute / 1440, 0, 1);
    const nudge = 0.0001;

    if (stops.length < 2) {
      const colour = RISK_COLOURS[statusAtMinute(currentMinute, now, fuelDates)] || RISK_COLOURS.red;
      gradient.addColorStop(0, colour);
      gradient.addColorStop(1, colour);
      return gradient;
    }

    stops.forEach((minute, index) => {
      if (index === stops.length - 1) return;
      const nextMinute = stops[index + 1];
      const midpoint = (minute + nextMinute) / 2;
      const colour = RISK_COLOURS[statusAtMinute(midpoint, now, fuelDates)] || RISK_COLOURS.red;
      const start = stopForMinute(minute);
      const end = stopForMinute(nextMinute);
      addGradientStop(gradient, Math.max(0, start - (index ? 0 : 0)), colour);
      addGradientStop(gradient, Math.max(start, end - nudge), colour);
    });

    const finalColour = RISK_COLOURS[statusAtMinute(currentMinute, now, fuelDates)] || RISK_COLOURS.red;
    addGradientStop(gradient, stopForMinute(currentMinute), finalColour);
    addGradientStop(gradient, 1, finalColour);
    return gradient;
  }

  function drawSmoothRiskCurve(now = new Date()) {
    const canvas = document.getElementById("fuelRhythmGraph");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(rect.width || canvas.width));
    const cssHeight = Math.max(180, Math.round(rect.height || canvas.height));
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const padding = { left: 34, right: 18, top: 18, bottom: 31 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const yForValue = value => padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight;
    const { points, markers } = buildCurve(now);
    const coordinates = points.map(point => ({ ...point, x: xForMinute(point.minute), y: yForValue(point.value) }));
    if (coordinates.length < 2) return;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = createRiskGradient(ctx, padding, cssWidth, now, clamp(minutesIntoDay(now), 0, 1440));
    ctx.lineWidth = 3.7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    tracePath(ctx, coordinates);
    ctx.stroke();

    markers.forEach(marker => {
      const x = xForMinute(marker.minute);
      const y = yForValue(marker.value);
      ctx.fillStyle = RISK_COLOURS.green;
      ctx.strokeStyle = "rgba(3,10,8,.86)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
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

  function applyVisualFixes() {
    injectHistoryGridStyle();
    drawSmoothRiskCurve();
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyVisualFixes();
    });
  }

  function installRenderHook() {
    if (installed || typeof window.renderFuelGap !== "function" || window.renderFuelGap.__riskSegmentsApplied) return;
    const original = window.renderFuelGap;
    window.renderFuelGap = function renderFuelGapWithSmoothRiskCurve(...args) {
      const result = original.apply(this, args);
      applyVisualFixes();
      return result;
    };
    window.renderFuelGap.__riskSegmentsApplied = true;
    installed = true;
  }

  function boot() {
    installRenderHook();
    applyVisualFixes();
  }

  document.addEventListener("DOMContentLoaded", boot);
  document.querySelectorAll(".mobile-nav-item, .nav-item").forEach(button => {
    button.addEventListener("click", () => setTimeout(boot, 30));
  });
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", queueApply);
  window.addEventListener("resize", queueApply);
  window.addEventListener("storage", queueApply);
  setTimeout(boot, 0);
})();
