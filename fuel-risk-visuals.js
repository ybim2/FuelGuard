// Fuel Guard risk visual layer.
// Applies after the beta renderer so the live graph and history layout do not depend on timing-sensitive overlays.
(() => {
  const RISK_COLOURS = {
    green: "#2dff88",
    amber: "#ffb020",
    red: "#ff4d6d"
  };
  const DEFAULT_THRESHOLDS = { greenMinutes: 180, redMinutes: 300 };
  let queued = false;
  let installed = false;
  let observerInstalled = false;

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

  function todaysLogs(now = new Date()) {
    const key = dateKey(now);
    return logsWithDates().filter(log => dateKey(log.date) === key && log.date <= now);
  }

  function fuelDatesUntil(now = new Date()) {
    return logsWithDates().filter(log => isFuelLog(log) && log.date <= now).map(log => log.date);
  }

  function buildCurve(now = new Date()) {
    const logs = todaysLogs(now);
    const currentMinute = clamp(minutesIntoDay(now), 0, 1440);
    const limits = thresholds();
    const points = [{ minute: 0, value: 42 }];
    const markers = [];
    let value = 42;
    let lastMinute = 0;
    let lastFuelMinute = null;

    function addBoundaryPoints(toMinute) {
      if (lastFuelMinute === null) return;
      [limits.greenMinutes, limits.redMinutes].forEach(limit => {
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
      if (isFuelLog(log)) {
        value = clamp(Math.max(value + 42, 86), 8, 95);
        const marker = { minute: Math.min(1440, minute + 0.45), value, log };
        markers.push(marker);
        points.push(marker);
        lastFuelMinute = minute;
      }
      lastMinute = minute;
    });

    addBoundaryPoints(currentMinute);
    value = clamp(value - Math.max(0, currentMinute - lastMinute) * 0.11, 8, 95);
    points.push({ minute: currentMinute, value, current: true });
    return { points, markers, currentMinute };
  }

  function latestFuelBefore(fuelDates, date) {
    for (let index = fuelDates.length - 1; index >= 0; index -= 1) {
      if (fuelDates[index] <= date) return fuelDates[index];
    }
    return null;
  }

  function statusForSegment(startMinute, endMinute, fuelDates, now) {
    const midpoint = (startMinute + endMinute) / 2;
    const segmentDate = new Date(startOfDay(now).getTime() + midpoint * 60000);
    const latest = latestFuelBefore(fuelDates, segmentDate);
    if (!latest) return "red";
    return statusForMinutes((segmentDate - latest) / 60000);
  }

  function drawLineSegment(ctx, previous, current, colour, width) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(previous.x, previous.y);
    ctx.lineTo(current.x, current.y);
    ctx.stroke();
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

    const padding = { left: 34, right: 18, top: 18, bottom: 31 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const xForMinute = minute => padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    const yForValue = value => padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight;
    const { points, markers } = buildCurve(now);
    const fuelDates = fuelDatesUntil(now);
    const coordinates = points.map(point => ({ ...point, x: xForMinute(point.minute), y: yForValue(point.value) }));

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1];
      const current = coordinates[index];
      const status = statusForSegment(previous.minute, current.minute, fuelDates, now);
      drawLineSegment(ctx, previous, current, "rgba(2,8,6,.48)", 7.2);
      drawLineSegment(ctx, previous, current, RISK_COLOURS[status] || RISK_COLOURS.red, 4.9);
    }

    markers.forEach(marker => {
      const x = xForMinute(marker.minute);
      const y = yForValue(marker.value);
      ctx.fillStyle = RISK_COLOURS.green;
      ctx.strokeStyle = "rgba(3,10,8,.9)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(x, y, 5.8, 0, Math.PI * 2);
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
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(3),
      .beta-mvp #fuelHistoryArchiveDetail .fuel-archive-stats > div:nth-child(4) {
        border-color: rgba(45,255,136,.2);
      }
    `;
    document.head.appendChild(style);
  }

  function reorderAverageGapMetric() {
    const stats = document.querySelector("#fuelHistoryArchiveDetail .fuel-archive-stats");
    if (!stats) return;
    const cards = [...stats.children];
    const used = new Set();
    const cardByLabels = labels => {
      const match = cards.find(card => {
        if (used.has(card)) return false;
        const text = card.querySelector("span")?.textContent.trim().toLowerCase();
        return labels.includes(text);
      });
      if (match) used.add(match);
      return match;
    };
    const orderedCards = [
      cardByLabels(["first fuel"]),
      cardByLabels(["last fuel"]),
      cardByLabels(["average gap"]),
      cardByLabels(["longest gap"]),
      cardByLabels(["fuel logs"]),
      cardByLabels(["high-risk gaps", "long gaps"]),
      cardByLabels(["predicted danger"]),
      cardByLabels(["actual danger"]),
      ...cards.filter(card => !used.has(card))
    ].filter(Boolean);

    orderedCards.forEach(card => stats.appendChild(card));
  }

  function applyVisualFixes() {
    injectHistoryGridStyle();
    reorderAverageGapMetric();
    drawRiskSegments();
  }

  function queueApply() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        queued = false;
        applyVisualFixes();
      });
    });
  }

  function installRenderHook() {
    if (installed || typeof window.renderFuelGap !== "function") return;
    const original = window.renderFuelGap;
    window.renderFuelGap = function renderFuelGapWithRiskSegments(...args) {
      const result = original.apply(this, args);
      queueApply();
      setTimeout(applyVisualFixes, 80);
      return result;
    };
    window.renderFuelGap.__riskSegmentsApplied = true;
    installed = true;
  }

  function installHistoryObserver() {
    if (observerInstalled) return;
    const target = document.getElementById("fuelHistoryArchiveDetail");
    if (!target) return;
    const observer = new MutationObserver(queueApply);
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    observerInstalled = true;
  }

  function boot() {
    installRenderHook();
    installHistoryObserver();
    queueApply();
    setTimeout(() => {
      installRenderHook();
      installHistoryObserver();
      applyVisualFixes();
    }, 100);
  }

  document.addEventListener("DOMContentLoaded", boot);
  document.querySelectorAll(".mobile-nav-item, .nav-item").forEach(button => {
    button.addEventListener("click", () => setTimeout(boot, 40));
  });
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", () => setTimeout(applyVisualFixes, 40));
  window.addEventListener("resize", queueApply);
  window.addEventListener("storage", queueApply);
  setTimeout(boot, 0);
})();
