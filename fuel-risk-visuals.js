// Fuel Guard risk visual layer.
// Draws risk-coloured rhythm segments without changing the fuel log or risk calculation logic.
(() => {
  const RISK_COLOURS = {
    green: "#2dff88",
    amber: "#ffb020",
    red: "#ff4d6d"
  };

  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };
  let renderFuelGapBase;
  let applying = false;

  function gapState() {
    if (typeof fuelGapState === "function") return fuelGapState();
    return window.state?.fuelGap || { logs: [], thresholds: { ...DEFAULT_THRESHOLDS } };
  }

  function limits() {
    const source = gapState().thresholds || {};
    const greenMinutes = Number(source.greenMinutes || DEFAULT_THRESHOLDS.greenMinutes);
    const redMinutes = Math.max(Number(source.redMinutes || DEFAULT_THRESHOLDS.redMinutes), greenMinutes + 30);
    return { greenMinutes, redMinutes };
  }

  function statusForGap(minutes) {
    if (typeof fuelGapStatus === "function") return fuelGapStatus(minutes);
    const threshold = limits();
    if (!Number.isFinite(minutes)) return "red";
    if (minutes < threshold.greenMinutes) return "green";
    if (minutes < threshold.redMinutes) return "amber";
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

  function todaysFuelLogs(now = new Date()) {
    const key = dateKey(now);
    return (gapState().logs || [])
      .map(log => ({ ...log, date: logDate(log) }))
      .filter(log => log.date && dateKey(log.date) === key && log.date <= now && logType(log) === "fuel")
      .sort((a, b) => a.date - b.date);
  }

  function buildRiskCurve(now = new Date()) {
    const logs = (gapState().logs || [])
      .map(log => ({ ...log, date: logDate(log) }))
      .filter(log => log.date && dateKey(log.date) === dateKey(now) && log.date <= now)
      .sort((a, b) => a.date - b.date);
    const currentMinute = clamp(minutesIntoDay(now), 0, 1440);
    const threshold = limits();
    const points = [{ minute: 0, value: 42 }];
    let value = 42;
    let lastMinute = 0;
    let lastFuelMinute = null;

    function addBoundaryPoints(toMinute) {
      if (lastFuelMinute === null) return;
      [threshold.greenMinutes, threshold.redMinutes].forEach(limit => {
        const boundary = lastFuelMinute + limit;
        if (boundary > lastMinute && boundary < toMinute) {
          value = clamp(value - Math.max(0, boundary - lastMinute) * 0.11, 8, 95);
          points.push({ minute: boundary, value, boundary: true });
          lastMinute = boundary;
        }
      });
    }

    logs.forEach(log => {
      const minute = clamp(minutesIntoDay(log.date), 0, currentMinute);
      addBoundaryPoints(minute);
      value = clamp(value - Math.max(0, minute - lastMinute) * 0.11, 8, 95);
      points.push({ minute, value });
      if (logType(log) === "fuel") {
        value = clamp(Math.max(value + 42, 86), 8, 95);
        points.push({ minute: Math.min(1440, minute + 0.45), value, log });
        lastFuelMinute = minute;
      }
      lastMinute = minute;
    });

    addBoundaryPoints(currentMinute);
    value = clamp(value - Math.max(0, currentMinute - lastMinute) * 0.11, 8, 95);
    points.push({ minute: currentMinute, value, current: true });
    return { points, currentMinute, fuelMinutes: todaysFuelLogs(now).map(log => minutesIntoDay(log.date)) };
  }

  function statusForSegment(startMinute, endMinute, fuelMinutes) {
    const midpoint = (startMinute + endMinute) / 2;
    const lastFuelMinute = [...fuelMinutes].reverse().find(minute => minute <= midpoint);
    if (!Number.isFinite(lastFuelMinute)) return "red";
    return statusForGap(midpoint - lastFuelMinute);
  }

  function drawRiskSegments(now = new Date()) {
    const canvas = document.getElementById("fuelRhythmGraph");
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, Math.round(rect.width || canvas.width));
    const cssHeight = Math.max(180, Math.round(rect.height || canvas.height));
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padding = { left: 34, right: 18, top: 18, bottom: 31 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const yForValue = value => padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight;
    const { points, fuelMinutes } = buildRiskCurve(now);
    const coordinates = points.map(point => ({ ...point, x: xForMinute(point.minute), y: yForValue(point.value) }));

    ctx.lineWidth = 4.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      const status = statusForSegment(previous.minute, current.minute, fuelMinutes);
      ctx.strokeStyle = RISK_COLOURS[status] || RISK_COLOURS.red;
      ctx.beginPath();
      ctx.moveTo(previous.x, previous.y);
      ctx.lineTo(current.x, current.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function reorderAverageGapMetric() {
    const stats = document.querySelector("#fuelHistoryArchiveDetail .fuel-archive-stats");
    if (!stats) return;
    const cards = [...stats.children];
    const cardByLabel = label => cards.find(card => card.querySelector("span")?.textContent.trim().toLowerCase() === label);
    const average = cardByLabel("average gap");
    const longest = cardByLabel("longest gap");
    if (average && longest && average.nextElementSibling !== longest) {
      stats.insertBefore(average, longest);
    }
  }

  function applyRiskVisuals() {
    if (applying) return;
    applying = true;
    requestAnimationFrame(() => {
      drawRiskSegments();
      reorderAverageGapMetric();
      applying = false;
    });
  }

  const existingRenderFuelGap = window.renderFuelGap;
  Object.defineProperty(window, "renderFuelGap", {
    configurable: true,
    get() {
      return renderFuelGapBase;
    },
    set(fn) {
      renderFuelGapBase = function wrappedRenderFuelGap(...args) {
        const result = fn.apply(this, args);
        applyRiskVisuals();
        return result;
      };
    }
  });
  if (typeof existingRenderFuelGap === "function") window.renderFuelGap = existingRenderFuelGap;

  document.addEventListener("DOMContentLoaded", applyRiskVisuals);
  document.querySelectorAll(".mobile-nav-item, .nav-item").forEach(button => {
    button.addEventListener("click", applyRiskVisuals);
  });
  window.addEventListener("resize", applyRiskVisuals);
  window.addEventListener("storage", applyRiskVisuals);
})();
