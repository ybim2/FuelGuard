// Mobile-first Fuel Guard behavior overrides.
// This keeps the existing one-page app intact and layers the daily PWA flow on top.
(() => {
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

  fuelGapSnapshot = function fuelGapSnapshotOverride(now = new Date()) {
    const last = lastFuelLog();
    const elapsedMinutes = minutesSinceLastFuel(now);
    const status = fuelGapStatus(elapsedMinutes);
    const copy = gapStatusCopy(status, Boolean(last));

    return {
      lastFuelled: last ? formatClock(last.date) : "No food logged",
      timeSinceFuel: Number.isFinite(elapsedMinutes) ? duration(elapsedMinutes) : "No food logged",
      status,
      nextAction: copy.nextAction,
      statusContext: copy.context
    };
  };

  fuelDaySummary = function fuelDaySummaryOverride(now = new Date()) {
    const logs = todaysFuelLogs(now);
    const last = logs[logs.length - 1] || null;
    const end = fuelDayEndSnapshot(now);
    const foodLogText = `${logs.length} food log${logs.length === 1 ? "" : "s"}`;
    const lastAte = last ? formatClock(last.date) : "No food logged";
    const endText = end.dayEnded
      ? `Day ended at ${end.endTime}. Fasting started.`
      : "Today's tracking is still open.";

    return {
      date: fuelTrackingDateLabel(now),
      fuelLogs: logs.length,
      lastFuelled: lastAte,
      dayEnded: end.dayEnded,
      endTime: end.endTime,
      message: `Today's food summary: ${foodLogText}. Last ate: ${lastAte}. ${endText}`
    };
  };

  recordFuelled = function recordFuelledOverride(note = "") {
    if (fuelDayEndSnapshot().dayEnded) return;

    const noteText = String(note || document.getElementById("foodLogNote")?.value || "").trim();
    fuelGapState().logs.push({
      id: uid(),
      timestamp: new Date().toISOString(),
      label: "Food logged",
      note: noteText
    });

    const noteField = document.getElementById("foodLogNote");
    if (noteField) noteField.value = "";

    state.completed.liveFuelStatus = true;
    recordFuelMomentum(
      "fuelLogged",
      "Food logged. System updated.",
      "Food logged. Your system is up to date. +1 Fuel Momentum",
      { dedupeDaily: false }
    );
    save();
    renderAll();
  };

  renderFuelGap = function renderFuelGapOverride() {
    const snapshot = fuelGapSnapshot();
    const daySummary = fuelDaySummary();

    const fuelLastFuelled = document.getElementById("fuelLastFuelled");
    if (fuelLastFuelled) fuelLastFuelled.textContent = snapshot.lastFuelled;

    const fuelTimeSince = document.getElementById("fuelTimeSince");
    if (fuelTimeSince) fuelTimeSince.textContent = snapshot.timeSinceFuel;

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

    const fuelledButton = document.getElementById("fuelledButton");
    if (fuelledButton) fuelledButton.disabled = daySummary.dayEnded;

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
      const logs = todaysFuelLogs();
      fuelDailyLog.innerHTML = logs.length
        ? logs.map(log => `
            <div class="row">
              <div>
                <div class="item-name">${formatClock(log.date)} - Food logged</div>
                ${log.note ? `<div class="row-note">${safeText(log.note)}</div>` : ""}
              </div>
            </div>
          `).join("")
        : `<p class="muted fuel-daily-empty">No food logged today.</p>`;
    }
  };

  function renderDiaryFoodContext() {
    const target = document.getElementById("diaryLastFoodLogged");
    if (!target) return;

    const logs = todaysFuelLogs();
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

  renderAll();
  setInterval(renderFuelGap, 60000);
})();
