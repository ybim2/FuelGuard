
function renderFuelGap() {
  const snapshot = fuelGapSnapshot();
  const daySummary = fuelDaySummary();

  const fuelLastFuelled = document.getElementById("fuelLastFuelled");
  if (fuelLastFuelled) fuelLastFuelled.textContent = snapshot.lastFuelled;

  const fuelTimeSince = document.getElementById("fuelTimeSince");
  if (fuelTimeSince) fuelTimeSince.textContent = snapshot.timeSinceFuel;

  const fuelGapNextAction = document.getElementById("fuelGapNextAction");
  if (fuelGapNextAction) {
    fuelGapNextAction.textContent = snapshot.nextAction;
    fuelGapNextAction.className = `fuel-next-action ${snapshot.status === "red" ? "red" : ""}`;
  }

  const fuelledButton = document.getElementById("fuelledButton");
  if (fuelledButton) {
    fuelledButton.disabled = daySummary.dayEnded;
  }

  const endFuelDayButton = document.getElementById("endFuelDayButton");
  if (endFuelDayButton) {
    endFuelDayButton.disabled = daySummary.dayEnded;
  }

  const continueFuelDayButton = document.getElementById("continueFuelDayButton");
  if (continueFuelDayButton) {
    continueFuelDayButton.disabled = !daySummary.dayEnded;
  }

  const fuelDaySummaryEl = document.getElementById("fuelDaySummary");
  if (fuelDaySummaryEl) {
    fuelDaySummaryEl.innerHTML = `
      <p class="label">Daily fuelling summary</p>
      <p>${daySummary.message}</p>
    `;
  }

  const fuelDailyLogDate = document.getElementById("fuelDailyLogDate");
  if (fuelDailyLogDate) fuelDailyLogDate.textContent = daySummary.date;

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
}

function renderFuelMomentum() {
  if (typeof syncFuelMomentumBarrierTrendImprovement === "function" && syncFuelMomentumBarrierTrendImprovement()) {
    save();
  }

  const snapshot = fuelMomentumSnapshot();
  const score = document.getElementById("fuelMomentumScore");
  if (score) score.textContent = `${snapshot.score}/${snapshot.maxScore}`;

  const items = document.getElementById("fuelMomentumItems");
  if (items) {
    const rows = [
      ["Fuel logged", snapshot.fuelLogged, "+1"],
      ["Tomorrow protected", snapshot.tomorrowProtected, "+2"],
      ["Diary trend", snapshot.barrierImproved, "+3"]
    ];

    items.innerHTML = rows
      .map(([label, complete, points]) => `
        <div class="fuel-momentum-item ${complete ? "complete" : ""}">
          <span>${label}</span>
          <strong>${complete ? "Complete" : "Pending"} ${points}</strong>
        </div>
      `)
      .join("");
  }

  const message = document.getElementById("fuelMomentumMessage");
  if (message) message.textContent = snapshot.message;
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
  renderFuelMomentum();


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
    dashboardInsight.textContent = "Live Fuel Status is your default daily check-in.";
  }

  if (typeof nutritionBarrierForecast === "function") {
    const barrierForecast = nutritionBarrierForecast();
    const dashboardBarrierRisk = document.getElementById("dashboardBarrierRisk");
    if (dashboardBarrierRisk) dashboardBarrierRisk.textContent = `${barrierForecast.count} entries`;

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
      ["fuelConfirmation", "Step 2", "Fuel Availability", "prep"],
      ["dashboard", "Step 3", "Live Fuel Status", "liveFuelStatus"],
      ["nutritionBarriers", "Step 4", "Nutrition Diary", "nutritionBarriers"]
    ];

    fastFlow.innerHTML = steps
      .map(([screen, step, label, key]) => `
        <button class="flow-card ${isStepComplete(key) ? "done" : ""}" data-jump="${screen}">
          <span>${step}</span>
          <strong>${isStepComplete(key) ? "✓ " : ""}${label}</strong>
        </button>
      `)
      .join("");
  }

  renderChecklist();
}

function renderChecklist() {
  const items = [
    ["pantry", "Fuel Confirmation"],
    ["prep", "Fuel Availability"],
    ["liveFuelStatus", "Live Fuel Status"],
    ["nutritionBarriers", "Nutrition Diary"]
  ];

  const dailyChecklist = document.getElementById("dailyChecklist");
  if (dailyChecklist) {
    dailyChecklist.innerHTML = items
      .map(([key, label]) => `
        <div class="check-item ${isStepComplete(key) ? "done" : ""}">
          <span>${isStepComplete(key) ? "✓" : "○"}</span>
          <strong>${label}</strong>
          <span>${isStepComplete(key) ? "Done" : "Pending"}</span>
        </div>
      `)
      .join("");
  }

  const adherenceActions = document.getElementById("adherenceActions");
  if (adherenceActions) {
    adherenceActions.innerHTML = items
      .map(([key, label]) => `
        <label class="check-item ${isStepComplete(key) ? "done" : ""}">
          <input type="checkbox" data-manual-complete="${key}" ${isStepComplete(key) ? "checked" : ""}>
          <strong>${label}</strong>
          <span>${isStepComplete(key) ? "Done" : "Pending"}</span>
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
