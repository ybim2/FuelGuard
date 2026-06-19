
function renderFuelGap() {
  const snapshot = fuelGapSnapshot();
  const insight = fuelGapInsight();

  const fuelLastFuelled = document.getElementById("fuelLastFuelled");
  if (fuelLastFuelled) fuelLastFuelled.textContent = snapshot.lastFuelled;

  const fuelTimeSince = document.getElementById("fuelTimeSince");
  if (fuelTimeSince) fuelTimeSince.textContent = snapshot.timeSinceFuel;

  const fuelGapStatusEl = document.getElementById("fuelGapStatus");
  if (fuelGapStatusEl) {
    fuelGapStatusEl.textContent = snapshot.status.toUpperCase();
    fuelGapStatusEl.className = `status-pill ${snapshot.status}`;
  }

  const fuelGapNextAction = document.getElementById("fuelGapNextAction");
  if (fuelGapNextAction) {
    fuelGapNextAction.textContent = snapshot.nextAction;
    fuelGapNextAction.className = `fuel-next-action ${snapshot.status === "red" ? "red" : ""}`;
  }

  const fuelDailyLog = document.getElementById("fuelDailyLog");
  if (fuelDailyLog) {
    const logs = todaysFuelLogs();
    fuelDailyLog.innerHTML = logs.length
      ? logs
        .map(log => `
          <div class="row">
            <div class="item-name">${formatClock(log.date)} &mdash; Fuelled</div>
          </div>
        `)
        .join("")
      : `<p class="muted fuel-daily-empty">No fuel confirmations today.</p>`;
  }

  const fuelWeeklyInsight = document.getElementById("fuelWeeklyInsight");
  if (fuelWeeklyInsight) {
    fuelWeeklyInsight.innerHTML = `
      <div class="mini-card"><p class="label">Longest gap today</p><h3>${duration(insight.longestGap)}</h3></div>
      <div class="mini-card"><p class="label">Fuel confirmations today</p><h3>${insight.confirmations}</h3></div>
      <div class="mini-card"><p class="label">High-risk gaps</p><h3>${insight.highRiskGaps}</h3></div>
    `;
  }
}

function renderDashboard() {
  const gs = gapStats();
  const complete = completedCount();
  const total = STEP_KEYS.length;
  const worst = worstForecast();
  const status = worst?.status || "amber";

  const sideCompletion = document.getElementById("sideCompletion");
  if (sideCompletion) sideCompletion.textContent = `${complete}/${total} complete`;

  const dashboardCompletion = document.getElementById("dashboardCompletion");
  if (dashboardCompletion) dashboardCompletion.textContent = `${complete}/${total}`;

  renderFuelGap();


  const personalLongestGap = document.getElementById("personalLongestGap");
  if (personalLongestGap) personalLongestGap.textContent = duration(gs.longest);



  const topShoppingDay = document.getElementById("topShoppingDay");
  if (topShoppingDay) topShoppingDay.textContent = calculatedNextShopDate() ? formatShortDate(calculatedNextShopDate()) : "No burn rate";

  const topStatus = document.getElementById("topStatus");
  if (topStatus) {
    topStatus.textContent = status.toUpperCase();
    topStatus.className = `status-pill ${status}`;
  }

  const dashboardInsight = document.getElementById("dashboardInsight");
  if (dashboardInsight) {
    dashboardInsight.textContent = "Live Fuel Status is now part of Fuel Operations.";
  }

  if (typeof nutritionBarrierForecast === "function") {
    const barrierForecast = nutritionBarrierForecast();
    const dashboardBarrierRisk = document.getElementById("dashboardBarrierRisk");
    if (dashboardBarrierRisk) dashboardBarrierRisk.textContent = barrierForecast.riskLevelLabel;

    const dashboardBarrierNote = document.getElementById("dashboardBarrierNote");
    if (dashboardBarrierNote) dashboardBarrierNote.textContent = barrierForecast.dashboardNote;
  }

  const fuelStreakEl = document.getElementById("fuelStreak");
  if (fuelStreakEl) fuelStreakEl.textContent = `${fuelStreak()} day${fuelStreak() === 1 ? "" : "s"}`;

  const fuelStreakNote = document.getElementById("fuelStreakNote");
  if (fuelStreakNote) {
    fuelStreakNote.textContent = fuelStreak() >= 5
      ? `Congrats, you're on a ${fuelStreak()} day streak.`
      : "Build consistency one day at a time.";
  }

  const proactivityScoreEl = document.getElementById("proactivityScore");
  if (proactivityScoreEl) proactivityScoreEl.textContent = `${proactivityScore()}%`;

  const proactivityNote = document.getElementById("proactivityNote");
  if (proactivityNote) {
    proactivityNote.textContent = calculatedNextShopDate()
      ? `Calculated next shop: ${formatShortDate(calculatedNextShopDate())}`
      : "Add daily consumption rates to calculate a shopping date.";
  }

  const fuelDisciplineScoreEl = document.getElementById("fuelDisciplineScore");
  if (fuelDisciplineScoreEl) fuelDisciplineScoreEl.textContent = `${fuelDisciplineScore()}%`;

  const fastFlow = document.getElementById("fastFlow");
  if (fastFlow) {
    const steps = [
      ["fuelConfirmation", "Step 1", "Fuel Confirmation", "pantry"],
      ["dashboard", "Step 2", "Live Fuel status", "liveFuelStatus"],
      ["nutritionBarriers", "Step 3", "Nutrition Barriers", "nutritionBarriers"]
    ];

    fastFlow.innerHTML = steps
      .map(([screen, step, label, key]) => `
        <button class="flow-card ${state.completed[key] ? "done" : ""}" data-jump="${screen}">
          <span>${step}</span>
          <strong>${state.completed[key] ? "✓ " : ""}${label}</strong>
        </button>
      `)
      .join("");
  }

  renderChecklist();
}

function renderChecklist() {
  const items = [
    ["pantry", "Fuel Confirmation"],
    ["liveFuelStatus", "Live Fuel status"],
    ["nutritionBarriers", "Nutrition Barriers"]
  ];

  const dailyChecklist = document.getElementById("dailyChecklist");
  if (dailyChecklist) {
    dailyChecklist.innerHTML = items
      .map(([key, label]) => `
        <div class="check-item ${state.completed[key] ? "done" : ""}">
          <span>${state.completed[key] ? "✓" : "○"}</span>
          <strong>${label}</strong>
          <span>${state.completed[key] ? "Done" : "Pending"}</span>
        </div>
      `)
      .join("");
  }

  const adherenceActions = document.getElementById("adherenceActions");
  if (adherenceActions) {
    adherenceActions.innerHTML = items
      .map(([key, label]) => `
        <label class="check-item ${state.completed[key] ? "done" : ""}">
          <input type="checkbox" data-manual-complete="${key}" ${state.completed[key] ? "checked" : ""}>
          <strong>${label}</strong>
          <span>${state.completed[key] ? "Done" : "Pending"}</span>
        </label>
      `)
      .join("");
  }
}

function renderGaps() {
  const gs = gapStats();
  const gapHtml = `
    <div class="row">
      <div>
        <div class="item-name">Longest gap today</div>
        <div class="row-note">${gs.pair ? `${gs.pair[0].name} to ${gs.pair[1].name}` : "Add meals"}</div>
      </div>
      <strong>${duration(gs.longest)}</strong>
    </div>
    <div class="row">
      <div>
        <div class="item-name">Calories planned</div>
        <div class="row-note">Snacks fill the calorie gaps.</div>
      </div>
      <strong>${gs.calories} kcal</strong>
    </div>
    <div class="row">
      <div>
        <div class="item-name">Stopwatch</div>
        <div class="row-note">Since ${gs.last?.name || "last meal"}</div>
      </div>
      <strong>${duration(gs.since)}</strong>
    </div>
  `;

  const gapSummary = document.getElementById("gapSummary");
  if (gapSummary) gapSummary.innerHTML = gapHtml;

  const dashboardGapSummary = document.getElementById("dashboardGapSummary");
  if (dashboardGapSummary) dashboardGapSummary.innerHTML = gapHtml;

  const mealEditor = document.getElementById("mealEditor");
  if (mealEditor) {
    mealEditor.innerHTML = sortedMeals()
      .map(meal => `
        <div class="edit-row">
          <input type="time" value="${meal.time}" data-meal-time="${meal.id}">
          <input value="${meal.name}" data-meal-name="${meal.id}">
          <input type="number" value="${meal.calories}" data-meal-calories="${meal.id}">
          <button class="remove-btn" data-remove-meal="${meal.id}">×</button>
        </div>
      `)
      .join("");
  }
}

function renderTimeline() {
  const timeline = document.getElementById("dashboardTimelineView");
  if (!timeline) return;

  const items = timelineItems();
  timeline.innerHTML = items
    .map((item, index, allItems) => {
      const next = allItems[index + 1];
      const gap = next && item.type === "meal" && next.type === "meal" ? mins(next.time) - mins(item.time) : 0;
      return `
        <div class="timeline-chip ${gap > 195 ? "warning" : ""}">
          <small>${item.time}</small>
          <h3>${item.name}</h3>
          <p>${item.type}${item.type === "meal" ? ` - ${item.calories || 0} kcal` : ""}</p>
          ${gap ? `<small>Next meal gap: ${duration(gap)}</small>` : ""}
        </div>
      `;
    })
    .join("");
}
