// Fuel Guard risk visual layer.
// Replaces the main rhythm line stroke with clean, non-overlapping risk-coloured segments.
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

  function todayLogs(now = new Date()) {
    const key = dateKey(now);
    return logsWithDates().filter(log => dateKey(log.date) === key && log.date <= now);
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
    return { points, markers, currentMinute };
  }

  function chartMapper(ctx) {
    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(320, Math.round(rect.width || canvas.width / dpr || canvas.width));
    const cssHeight = Math.max(180, Math.round(rect.height || canvas.height / dpr || canvas.height));
    const padding = { left: 34, right: 18, top: 18, bottom: 31 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;

    return {
      xForMinute: minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth,
      yForValue: value => padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight,
      minuteForX: x => clamp(((x - padding.left) / plotWidth) * 1440, 0, 1440)
    };
  }

  function midpoint(a, b) {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      minute: (a.minute + b.minute) / 2
    };
  }

  function quadraticPoint(start, control, end, t) {
    const inverse = 1 - t;
    return {
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
      minute: inverse * inverse * start.minute + 2 * inverse * t * control.minute + t * t * end.minute
    };
  }

  function sampledSmoothCurve(coordinates) {
    if (!coordinates.length) return [];
    const samples = [coordinates[0]];
    let cursor = coordinates[0];
    let cursorMinute = coordinates[0].minute;
    const density = 18;

    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      const end = midpoint(previous, current);
      const start = { ...cursor, minute: cursorMinute };
      for (let step = 1; step <= density; step += 1) {
        samples.push(quadraticPoint(start, previous, end, step / density));
      }
      cursor = end;
      cursorMinute = end.minute;
    }

    const last = coordinates[coordinates.length - 1];
    const lineSteps = 8;
    for (let step = 1; step <= lineSteps; step += 1) {
      const t = step / lineSteps;
      samples.push({
        x: cursor.x + (last.x - cursor.x) * t,
        y: cursor.y + (last.y - cursor.y) * t,
        minute: cursorMinute + (last.minute - cursorMinute) * t
      });
    }

    return samples;
  }

  function drawPolyline(ctx, points, colour) {
    if (points.length < 2) return;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      ctx.lineTo(points[index].x, points[index].y);
    }
    ctx.stroke();
  }

  function drawRiskSegments(ctx, now = new Date()) {
    const mapper = chartMapper(ctx);
    const { points } = buildCurve(now);
    const coordinates = points.map(point => ({
      ...point,
      x: mapper.xForMinute(point.minute),
      y: mapper.yForValue(point.value)
    }));
    const samples = sampledSmoothCurve(coordinates);
    if (samples.length < 2) return;

    const fuelDates = fuelDatesUntil(now);
    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";

    let activeStatus = statusAtMinute((samples[0].minute + samples[1].minute) / 2, now, fuelDates);
    let activePoints = [samples[0], samples[1]];

    for (let index = 2; index < samples.length; index += 1) {
      const previous = samples[index - 1];
      const current = samples[index];
      const status = statusAtMinute((previous.minute + current.minute) / 2, now, fuelDates);
      if (status !== activeStatus) {
        drawPolyline(ctx, activePoints, RISK_COLOURS[activeStatus] || RISK_COLOURS.red);
        activeStatus = status;
        activePoints = [previous, current];
      } else {
        activePoints.push(current);
      }
    }

    drawPolyline(ctx, activePoints, RISK_COLOURS[activeStatus] || RISK_COLOURS.red);
    ctx.restore();
  }

  function isRhythmLineStroke(ctx) {
    return ctx.canvas?.id === "fuelRhythmGraph" && Math.abs(Number(ctx.lineWidth) - 3.5) < 0.2;
  }

  function installSegmentStroke() {
    const canvasContext = window.CanvasRenderingContext2D?.prototype;
    if (!canvasContext || canvasContext.__fuelGuardSegmentStroke) return;

    const baseStroke = canvasContext.stroke;
    canvasContext.stroke = function fuelGuardStroke(path) {
      if (isRhythmLineStroke(this)) {
        drawRiskSegments(this);
        return undefined;
      }
      return baseStroke.apply(this, arguments);
    };

    canvasContext.__fuelGuardSegmentStroke = true;
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

  installSegmentStroke();
  document.addEventListener("DOMContentLoaded", () => {
    installSegmentStroke();
    injectHistoryGridStyle();
  });
})();
