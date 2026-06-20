// Mobile-first Fuel Guard behavior overrides.
// This keeps the existing one-page app intact and layers the daily PWA flow on top.
(() => {
  const FOOD_LOG_COOLDOWN_MS = 60000;
  const RISK_GAP_THRESHOLD_MINUTES = 300;
  const FOOD_TYPE_LABELS = {
    meal: "Meal",
    snack: "Snack",
    takeout: "Takeout",
    hydration: "Hydration"
  };
  const FOOD_TYPE_IMPACT = {
    meal: 88,
    snack: 66,
    takeout: 76,
    hydration: 46
  };
  const FOOD_TYPE_BOOST = {
    meal: 42,
    snack: 26,
    takeout: 34,
    hydration: 10
  };

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

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function normaliseFoodType(value) {
    const type = String(value || "meal").toLowerCase();
    return FOOD_TYPE_LABELS[type] ? type : "meal";
  }

  function selectedFoodLogType() {
    return normaliseFoodType(document.getElementById("foodLogType")?.value || "meal");
  }

  function isFoodLog(log) {
    return normaliseFoodType(log?.type) !== "hydration";
  }

  function logsWithDates() {
    return fuelGapState().logs
      .map((log, index) => ({ ...log, index, date: fuelLogDate(log) }))
      .filter(log => log.date)
      .sort((a, b) => a.date - b.date);
  }

  function startOfLocalDay(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function endOfLocalDay(date = new Date()) {
    const end = startOfLocalDay(date);
    end.setDate(end.getDate() + 1);
    return end;
  }

  function sameLocalDay(a, b) {
    return todayKey(a) === todayKey(b);
  }

  function todaysAllLogs(now = new Date()) {
    const start = startOfLocalDay(now);
    const end = endOfLocalDay(now);
    return logsWithDates().filter(log => log.date >= start && log.date < end);
  }

  function todaysFoodLogsOnly(now = new Date()) {
    return todaysAllLogs(now).filter(isFoodLog);
  }

  function lastFoodLog() {
    return logsWithDates().filter(isFoodLog).sort((a, b) => b.date - a.date)[0] || null;
  }

  function minutesSinceLastFood(now = new Date()) {
    const last = lastFoodLog();
    if (!last) return Infinity;
    return Math.max(0, (now - last.date) / 60000);
  }

  function cooldownRemainingSeconds(now = Date.now()) {
    const cooldownUntil = Number(fuelGapState().cooldownUntil || 0);
    if (!Number.isFinite(cooldownUntil) || cooldownUntil <= now) return 0;
    return Math.ceil((cooldownUntil - now) / 1000);
  }

  function setFoodLogCooldown() {
    fuelGapState().cooldownUntil = Date.now() + FOOD_LOG_COOLDOWN_MS;
  }

  function clearFoodLogCooldown() {
    fuelGapState().cooldownUntil = 0;
  }

  function gapStatusCopy(status, hasLog) {
    const copy = {
      green: {
        nextAction: "Next action: keep a quick food option available before the gap builds.",
        context: "Green means recently eaten / no immediate gap concern."
      },
      amber: {
        nextAction: "Next action: plan food soon. The food gap is building.",
        context: "Amber means the gap is building and food should be planned soon."
      },
      red: {
        nextAction: "Action needed soon. This is a long food gap; eat a quick available option within 30 minutes.",
        context: "Red means long gap or missed fuel window; action needed soon."
      }
    };

    if (!hasLog) {
      copy.red = {
        nextAction: "No food logged yet. Log food now or eat a quick available option.",
        context: "Gap risk stays red until Fuel Guard knows when you last ate."
      };
    }

    return copy[status];
  }

  function gapDurationText(minutes) {
    return Number.isFinite(minutes) ? duration(minutes) : "No food logged";
  }

  fuelGapSnapshot = function fuelGapSnapshotOverride(now = new Date()) {
    const last = lastFoodLog();
    const elapsedMinutes = minutesSinceLastFood(now);
    const status = fuelGapStatus(elapsedMinutes);
    const copy = gapStatusCopy(status, Boolean(last));

    return {
      lastFuelled: last ? formatClock(last.date) : "No food logged",
      timeSinceFuel: gapDurationText(elapsedMinutes),
      status,
      nextAction: copy.nextAction,
      statusContext: copy.context
    };
  };

  fuelDaySummary = function fuelDaySummaryOverride(now = new Date()) {
    const logs = todaysAllLogs(now);
    const foodLogs = logs.filter(isFoodLog);
    const hydrationLogs = logs.filter(log => !isFoodLog(log));
    const last = foodLogs[foodLogs.length - 1] || null;
    const end = fuelDayEndSnapshot(now);
    const foodLogText = `${foodLogs.length} food log${foodLogs.length === 1 ? "" : "s"}`;
    const hydrationText = hydrationLogs.length ? `, ${hydrationLogs.length} hydration log${hydrationLogs.length === 1 ? "" : "s"}` : "";
    const lastAte = last ? formatClock(last.date) : "No food logged";
    const endText = end.dayEnded
      ? `Day ended at ${end.endTime}. Fasting started.`
      : "Today's tracking is still open.";

    return {
      date: fuelTrackingDateLabel(now),
      fuelLogs: logs.length,
      foodLogs: foodLogs.length,
      hydrationLogs: hydrationLogs.length,
      lastFuelled: lastAte,
      dayEnded: end.dayEnded,
      endTime: end.endTime,
      message: `Today's food summary: ${foodLogText}${hydrationText}. Last ate: ${lastAte}. ${endText}`
    };
  };

  function latestTodayLogIndex(now = new Date()) {
    let latestIndex = -1;
    let latestDate = null;

    fuelGapState().logs.forEach((log, index) => {
      const date = fuelLogDate(log);
      if (!date || !sameLocalDay(date, now)) return;
      if (!latestDate || date > latestDate) {
        latestDate = date;
        latestIndex = index;
      }
    });

    return latestIndex;
  }

  recordFuelled = function recordFuelledOverride(note = "") {
    if (fuelDayEndSnapshot().dayEnded) return;

    const remaining = cooldownRemainingSeconds();
    if (remaining > 0) {
      renderFuelGap();
      return;
    }

    const noteText = String(note || document.getElementById("foodLogNote")?.value || "").trim();
    const type = selectedFoodLogType();
    const typeLabel = FOOD_TYPE_LABELS[type];

    fuelGapState().logs.push({
      id: uid(),
      timestamp: new Date().toISOString(),
      label: `${typeLabel} logged`,
      note: noteText,
      type
    });
    setFoodLogCooldown();

    const noteField = document.getElementById("foodLogNote");
    if (noteField) noteField.value = "";

    state.completed.liveFuelStatus = true;
    recordFuelMomentum(
      "fuelLogged",
      type === "hydration" ? "Hydration logged. System updated." : "Food logged. System updated.",
      type === "hydration"
        ? "Hydration logged. Food gap tracking stays visible. +1 Fuel Momentum"
        : "Food logged. Your system is up to date. +1 Fuel Momentum",
      { dedupeDaily: false }
    );
    save();
    renderAll();
  };

  function undoLatestFoodLog() {
    const index = latestTodayLogIndex();
    if (index < 0) return;

    fuelGapState().logs.splice(index, 1);
    clearFoodLogCooldown();
    state.completed.liveFuelStatus = todaysAllLogs().length > 0;
    addActivityEntry("foodLogUndo", "Latest food log undone.", { dedupeDaily: false });
    save();
    renderAll();
  }

  function gapsFromFoodLogs(logs, now = new Date(), includeCurrent = false) {
    const sorted = [...logs].filter(isFoodLog).sort((a, b) => a.date - b.date);
    const gaps = [];

    for (let index = 1; index < sorted.length; index += 1) {
      const minutes = (sorted[index].date - sorted[index - 1].date) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        gaps.push({
          minutes,
          start: sorted[index - 1].date,
          end: sorted[index].date,
          ongoing: false
        });
      }
    }

    if (includeCurrent && sorted.length) {
      const last = sorted[sorted.length - 1];
      const minutes = (now - last.date) / 60000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        gaps.push({
          minutes,
          start: last.date,
          end: now,
          ongoing: true
        });
      }
    }

    return gaps;
  }

  function insightValue(minutes) {
    return minutes > 0 ? duration(minutes) : "Not enough data";
  }

  function dailyGapSummary(now = new Date()) {
    const logs = todaysFoodLogsOnly(now);
    const gaps = gapsFromFoodLogs(logs, now, true);
    const total = gaps.reduce((sum, gap) => sum + gap.minutes, 0);

    return {
      logs,
      gaps,
      longest: gaps.length ? Math.max(...gaps.map(gap => gap.minutes)) : 0,
      average: gaps.length ? total / gaps.length : 0,
      riskyCount: gaps.filter(gap => gap.minutes >= RISK_GAP_THRESHOLD_MINUTES).length
    };
  }

  function logsForLastSevenDays(now = new Date()) {
    const start = startOfLocalDay(now);
    start.setDate(start.getDate() - 6);
    const end = new Date(now);
    return logsWithDates().filter(log => log.date >= start && log.date <= end && isFoodLog(log));
  }

  function riskyWindowLabel(date) {
    const hour = date.getHours();
    if (hour >= 9 && hour < 18) return "work hours";
    if (hour >= 5 && hour < 11) return "morning";
    if (hour >= 11 && hour < 15) return "midday";
    if (hour >= 15 && hour < 18) return "late afternoon";
    if (hour >= 18 && hour < 22) return "evening";
    return "late/overnight";
  }

  function weeklyGapSummary(now = new Date()) {
    const logs = logsForLastSevenDays(now);
    const byDay = new Map();

    logs.forEach(log => {
      const key = todayKey(log.date);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(log);
    });

    const allGaps = [];
    byDay.forEach(dayLogs => {
      const includeCurrent = dayLogs.some(log => sameLocalDay(log.date, now));
      allGaps.push(...gapsFromFoodLogs(dayLogs, now, includeCurrent));
    });

    const riskyGaps = allGaps.filter(gap => gap.minutes >= RISK_GAP_THRESHOLD_MINUTES);
    const windowCounts = riskyGaps.reduce((counts, gap) => {
      const label = riskyWindowLabel(gap.end);
      counts[label] = (counts[label] || 0) + 1;
      return counts;
    }, {});
    const topWindow = Object.entries(windowCounts).sort((a, b) => b[1] - a[1])[0] || null;

    const riskyByDay = new Map();
    riskyGaps.forEach(gap => {
      const key = todayKey(gap.end);
      riskyByDay.set(key, (riskyByDay.get(key) || 0) + 1);
    });
    const repeatedDays = [...riskyByDay.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key]) => {
        const date = new Date(`${key}T12:00:00`);
        return date.toLocaleDateString(undefined, { weekday: "short" });
      });

    return {
      longest: allGaps.length ? Math.max(...allGaps.map(gap => gap.minutes)) : 0,
      riskyCount: riskyGaps.length,
      topWindow,
      repeatedDays
    };
  }

  function renderFuelGapInsights(now = new Date()) {
    const target = document.getElementById("fuelGapInsights");
    if (!target) return;

    const daily = dailyGapSummary(now);
    const weekly = weeklyGapSummary(now);
    const riskyWindowText = weekly.topWindow && weekly.riskyCount >= 2
      ? `${weekly.topWindow[0]} (${weekly.topWindow[1]} gap${weekly.topWindow[1] === 1 ? "" : "s"})`
      : "Needs more data";
    const repeatedDaysText = weekly.repeatedDays.length ? weekly.repeatedDays.join(", ") : "None yet";

    target.innerHTML = `
      <div class="fuel-gap-insight">
        <span>Longest gap today</span>
        <strong>${safeText(insightValue(daily.longest))}</strong>
        <small>${daily.logs.length ? "Tracks the biggest food gap so far." : "Log food to start today's pattern."}</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Average gap today</span>
        <strong>${safeText(insightValue(daily.average))}</strong>
        <small>Based on food logs, plus the current gap.</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Gaps over 5h today</span>
        <strong>${daily.riskyCount}</strong>
        <small>${daily.riskyCount ? "Long gaps are building risk." : "No 5h gaps logged today."}</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Longest gap this week</span>
        <strong>${safeText(insightValue(weekly.longest))}</strong>
        <small>Uses the last seven days of food logs.</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Risky time window</span>
        <strong>${safeText(riskyWindowText)}</strong>
        <small>Shows when long gaps repeat often enough.</small>
      </div>
      <div class="fuel-gap-insight">
        <span>Repeated long-gap days</span>
        <strong>${safeText(repeatedDaysText)}</strong>
        <small>Days with two or more 5h gaps.</small>
      </div>
    `;
  }

  function minutesIntoDay(date) {
    return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  }

  function decayFuelValue(value, minutes) {
    return clamp(value - Math.max(0, minutes) * 0.11, 8, 95);
  }

  function buildFuelCurve(now = new Date()) {
    const currentMinute = clamp(minutesIntoDay(now), 0, 1440);
    const logs = todaysAllLogs(now).filter(log => log.date <= now);
    const markers = [];
    const points = [];
    let value = 42;
    let lastMinute = 0;

    points.push({ minute: 0, value });

    logs.forEach(log => {
      const minute = clamp(minutesIntoDay(log.date), 0, currentMinute);
      value = decayFuelValue(value, minute - lastMinute);
      points.push({ minute, value });

      const type = normaliseFoodType(log.type);
      const impact = FOOD_TYPE_IMPACT[type];
      const boost = FOOD_TYPE_BOOST[type];
      value = clamp(Math.max(value + boost, impact), 8, 95);
      const spikeMinute = Math.min(1440, minute + 0.45);
      const marker = { minute: spikeMinute, value, type, log };
      markers.push(marker);
      points.push(marker);
      lastMinute = minute;
    });

    value = decayFuelValue(value, currentMinute - lastMinute);
    points.push({ minute: currentMinute, value, current: true });

    return { points, markers, currentMinute };
  }

  function pointColor(type) {
    return ({
      meal: "#2dff88",
      snack: "#20d6ff",
      takeout: "#ffb020",
      hydration: "#9fb7ff"
    })[normaliseFoodType(type)];
  }

  function traceSmoothPath(ctx, coordinates) {
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

  function drawFuelRhythmGraph(now = new Date()) {
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

    const padding = { left: 34, right: 18, top: 18, bottom: 31 };
    const plotWidth = cssWidth - padding.left - padding.right;
    const plotHeight = cssHeight - padding.top - padding.bottom;
    const bottom = padding.top + plotHeight;
    const { points, markers, currentMinute } = buildFuelCurve(now);

    function xForMinute(minute) {
      return padding.left + (clamp(minute, 0, 1440) / 1440) * plotWidth;
    }

    function yForValue(value) {
      return padding.top + (1 - clamp(value, 0, 100) / 100) * plotHeight;
    }

    const coordinates = points.map(point => ({
      ...point,
      x: xForMinute(point.minute),
      y: yForValue(point.value)
    }));

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.beginPath();
    ctx.moveTo(padding.left, bottom);
    ctx.lineTo(cssWidth - padding.right, bottom);
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "rgba(245,255,248,.55)";
    [360, 720, 1080].forEach((minute, index) => {
      const label = ["6am", "12pm", "6pm"][index];
      const x = xForMinute(minute);
      ctx.fillText(label, x - 12, cssHeight - 11);
    });

    const currentX = xForMinute(currentMinute);
    ctx.strokeStyle = "rgba(255,255,255,.12)";
    ctx.beginPath();
    ctx.moveTo(currentX, padding.top);
    ctx.lineTo(currentX, bottom);
    ctx.stroke();
    ctx.fillStyle = "rgba(245,255,248,.62)";
    ctx.fillText("Now", Math.min(currentX + 5, cssWidth - 42), padding.top + 12);

    if (coordinates.length > 1) {
      const fillGradient = ctx.createLinearGradient(0, padding.top, 0, bottom);
      fillGradient.addColorStop(0, "rgba(45,255,136,.22)");
      fillGradient.addColorStop(1, "rgba(32,214,255,.01)");
      ctx.fillStyle = fillGradient;
      ctx.beginPath();
      traceSmoothPath(ctx, coordinates);
      ctx.lineTo(coordinates[coordinates.length - 1].x, bottom);
      ctx.lineTo(coordinates[0].x, bottom);
      ctx.closePath();
      ctx.fill();

      const strokeGradient = ctx.createLinearGradient(padding.left, 0, cssWidth - padding.right, 0);
      strokeGradient.addColorStop(0, "#20d6ff");
      strokeGradient.addColorStop(.52, "#2dff88");
      strokeGradient.addColorStop(1, "#ffb020");
      ctx.strokeStyle = strokeGradient;
      ctx.lineWidth = 3.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      traceSmoothPath(ctx, coordinates);
      ctx.stroke();
    }

    markers.forEach(marker => {
      const x = xForMinute(marker.minute);
      const y = yForValue(marker.value);
      const color = pointColor(marker.type);
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = "rgba(3,10,8,.86)";
      ctx.lineWidth = 2;

      if (marker.type === "takeout") {
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-5, -5, 10, 10);
        ctx.strokeRect(-5, -5, 10, 10);
      } else {
        ctx.beginPath();
        ctx.arc(x, y, marker.type === "hydration" ? 4 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  renderFuelGap = function renderFuelGapOverride() {
    const snapshot = fuelGapSnapshot();
    const daySummary = fuelDaySummary();
    const cooldownSeconds = cooldownRemainingSeconds();

    const fuelLastFuelled = document.getElementById("fuelLastFuelled");
    if (fuelLastFuelled) fuelLastFuelled.textContent = snapshot.lastFuelled;

    const fuelTimeSince = document.getElementById("fuelTimeSince");
    if (fuelTimeSince) fuelTimeSince.textContent = snapshot.timeSinceFuel;

    const fuelGraphLastAte = document.getElementById("fuelGraphLastAte");
    if (fuelGraphLastAte) {
      fuelGraphLastAte.textContent = snapshot.lastFuelled === "No food logged"
        ? "Last ate: not logged yet"
        : `Last ate: ${snapshot.timeSinceFuel} ago`;
    }

    const fuelGapNextAction = document.getElementById("fuelGapNextAction");
    if (fuelGapNextAction) {
      fuelGapNextAction.textContent = snapshot.nextAction;
      fuelGapNextAction.className = `fuel-next-action ${snapshot.status}`;
    }

    const fuelStatusContext = document.getElementById("fuelStatusContext");
    if (fuelStatusContext) {
      fuelStatusContext.innerHTML = `
        <strong>Gap risk:</strong>
        <span class="status-pill ${snapshot.status}">${snapshot.status.toUpperCase()}</span>
        <span>${safeText(snapshot.statusContext)}</span>
      `;
    }

    ["fuelledButton", "graphLogFoodButton"].forEach(id => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = daySummary.dayEnded || cooldownSeconds > 0;
      button.textContent = "Log food";
    });

    const undoButton = document.getElementById("undoLatestFoodLog");
    if (undoButton) undoButton.disabled = latestTodayLogIndex() < 0;

    const cooldownMessage = document.getElementById("foodLogCooldownMessage");
    if (cooldownMessage) {
      cooldownMessage.textContent = cooldownSeconds > 0
        ? `Logged. You can log again in ${cooldownSeconds}s.`
        : "";
    }

    const endFuelDayButton = document.getElementById("endFuelDayButton");
    if (endFuelDayButton) endFuelDayButton.disabled = daySummary.dayEnded;

    const continueFuelDayButton = document.getElementById("continueFuelDayButton");
    if (continueFuelDayButton) continueFuelDayButton.disabled = !daySummary.dayEnded;

    const fuelDaySummaryEl = document.getElementById("fuelDaySummary");
    if (fuelDaySummaryEl) {
      fuelDaySummaryEl.innerHTML = `
        <p class="label">Daily fuelling summary</p>
        <p>${safeText(daySummary.message)}</p>
      `;
    }

    const fuelDailyLogDate = document.getElementById("fuelDailyLogDate");
    if (fuelDailyLogDate) fuelDailyLogDate.textContent = daySummary.date;

    const fuelDailyLog = document.getElementById("fuelDailyLog");
    if (fuelDailyLog) {
      const logs = todaysAllLogs();
      fuelDailyLog.innerHTML = logs.length
        ? logs.map(log => {
            const type = normaliseFoodType(log.type);
            const label = FOOD_TYPE_LABELS[type];
            return `
              <div class="row">
                <div>
                  <div class="item-name">${formatClock(log.date)} - ${safeText(label)} logged</div>
                  ${log.note ? `<div class="row-note">${safeText(log.note)}</div>` : ""}
                </div>
              </div>
            `;
          }).join("")
        : `<p class="muted fuel-daily-empty">No food logged today.</p>`;
    }

    renderFuelGapInsights();
    drawFuelRhythmGraph();
  };

  function renderDiaryFoodContext() {
    const target = document.getElementById("diaryLastFoodLogged");
    if (!target) return;

    const logs = todaysFoodLogsOnly();
    const last = logs[logs.length - 1] || null;
    target.innerHTML = last
      ? `<span class="label">Last food logged</span><strong>${formatClock(last.date)}</strong><small>${safeText(last.note || `${logs.length} food log${logs.length === 1 ? "" : "s"} today`)}</small>`
      : `<span class="label">Last food logged</span><strong>None today</strong><small>Use Log food on Today.</small>`;
  }

  const originalRenderNutritionBarriers = renderNutritionBarriers;
  renderNutritionBarriers = function renderNutritionBarriersOverride() {
    originalRenderNutritionBarriers();
    renderDiaryFoodContext();
  };

  const originalSwitchScreen = switchScreen;
  let activeMobileTab = "today";
  function mobileTabForScreen(screen) {
    return ({
      dashboard: "today",
      nutritionBarriers: "diary",
      fuelConfirmation: "forecast",
      logs: "activity",
      checklist: "setup"
    })[screen] || activeMobileTab;
  }

  switchScreen = function switchScreenOverride(screen, mobileTab) {
    activeMobileTab = mobileTab || mobileTabForScreen(screen);
    originalSwitchScreen(screen);

    document.querySelectorAll(".mobile-nav-item").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileTab === activeMobileTab);
    });

    const pageSubtitle = document.getElementById("pageSubtitle");
    if (pageSubtitle && screen === "dashboard") {
      pageSubtitle.textContent = "See when you last ate and log food fast.";
    }
  };

  document.querySelectorAll(".mobile-nav-item").forEach(button => {
    button.onclick = () => {
      switchScreen(button.dataset.mobileScreen, button.dataset.mobileTab);
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    };
  });

  const undoLatestButton = document.getElementById("undoLatestFoodLog");
  if (undoLatestButton) undoLatestButton.addEventListener("click", undoLatestFoodLog);

  const foodLogType = document.getElementById("foodLogType");
  if (foodLogType) foodLogType.addEventListener("change", () => drawFuelRhythmGraph());

  let graphResizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(graphResizeTimer);
    graphResizeTimer = window.setTimeout(() => drawFuelRhythmGraph(), 120);
  });

  renderAll();
  setInterval(renderFuelGap, 1000);
})();
