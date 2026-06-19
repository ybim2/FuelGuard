const BARRIER_CATEGORIES = [
  "Positive nutrition day",
  "Neutral nutrition day",
  "Poor preparation",
  "Long gaps between meals",
  "Snack availability issue",
  "Training/work schedule disruption",
  "Planning gap",
  "Timing issue",
  "Low motivation / low bandwidth",
  "Family or social constraint",
  "Didn't know what to do",
  "Work / life overwhelm",
  "Food access issue",
  "Appetite or digestion issue",
  "Stress / emotional eating",
  "Budget constraint",
  "Other"
];

const BARRIER_WINDOWS = [2, 4, 6, 12, 18, 24];

const BARRIER_FIXES = {
  "Positive nutrition day": "Record what worked so it can be repeated.",
  "Neutral nutrition day": "Keep logging the context around fuel decisions.",
  "Poor preparation": "Protect tomorrow by confirming meals, snacks, shakes, and electrolytes.",
  "Long gaps between meals": "Set up an accessible fuel option before the next long work or training block.",
  "Snack availability issue": "Pack or restock snacks before your next shift or training session.",
  "Training/work schedule disruption": "Prepare portable fuel before the next schedule pinch point.",
  "Planning gap": "Create a fallback meal plan.",
  "Timing issue": "Add fuelling timing prompts.",
  "Low motivation / low bandwidth": "Use minimum viable nutrition.",
  "Family or social constraint": "Build around shared meals.",
  "Didn't know what to do": "Clarify the next meal decision.",
  "Work / life overwhelm": "Prepare workday fallback fuelling.",
  "Food access issue": "Create an emergency food list.",
  "Appetite or digestion issue": "Adjust food format and timing.",
  "Stress / emotional eating": "Create a non-judgemental stress-response plan.",
  "Budget constraint": "Build a lower-cost fuel plan.",
  Other: "Review recent context."
};

const POSITIVE_DIARY_CATEGORIES = new Set(["Positive nutrition day", "Neutral nutrition day"]);

function nutritionBarrierState() {
  state.nutritionBarriers = {
    logs: [],
    insightWindowWeeks: 4,
    ...(state.nutritionBarriers || {})
  };

  if (!Array.isArray(state.nutritionBarriers.logs)) state.nutritionBarriers.logs = [];
  if (!BARRIER_WINDOWS.includes(Number(state.nutritionBarriers.insightWindowWeeks))) {
    state.nutritionBarriers.insightWindowWeeks = 4;
  }

  return state.nutritionBarriers;
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function barrierDate(log) {
  const date = new Date(log.createdDate || `${log.date || todayInputValue()}T00:00:00`);
  return Number.isNaN(date.getTime()) ? startOfToday() : date;
}

function barrierLogsForWindow(weeks = nutritionBarrierState().insightWindowWeeks) {
  const cutoff = startOfToday();
  cutoff.setDate(cutoff.getDate() - Number(weeks) * 7);
  return nutritionBarrierState().logs.filter(log => barrierDate(log) >= cutoff);
}

function countBy(items, getter) {
  return items.reduce((counts, item) => {
    const key = getter(item) || "None";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function topCount(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ["No patterns yet", 0];
}

function nutritionBarrierTrendSnapshot() {
  const todayStart = startOfToday();
  const currentStart = new Date(todayStart);
  currentStart.setDate(currentStart.getDate() - 6);
  const previousStart = new Date(currentStart);
  previousStart.setDate(previousStart.getDate() - 7);

  const logs = nutritionBarrierState().logs;
  const currentLogs = logs.filter(log => {
    const date = barrierDate(log);
    return date >= currentStart && date <= todayStart;
  });
  const previousLogs = logs.filter(log => {
    const date = barrierDate(log);
    return date >= previousStart && date < currentStart;
  });
  const currentCounts = countBy(currentLogs, log => log.barrierCategory);
  const previousCounts = countBy(previousLogs, log => log.barrierCategory);
  const improvedCategory = Object.entries(previousCounts)
    .map(([category, previousCount]) => ({
      category,
      previousCount,
      currentCount: currentCounts[category] || 0,
      improvement: previousCount - (currentCounts[category] || 0)
    }))
    .filter(item => item.improvement > 0)
    .sort((a, b) => b.improvement - a.improvement)[0];
  const improved = previousLogs.length > 0 && currentLogs.length < previousLogs.length;
  const label = improvedCategory?.category || "diary events";

  return {
    improved,
    label,
    currentCount: currentLogs.length,
    previousCount: previousLogs.length,
    message: improved
      ? `Nutrition trend improving: fewer ${label.toLowerCase()} this week.`
      : "Nutrition diary trend needs more data or fewer repeat challenges."
  };
}

function suggestedBarrierFix(category) {
  return BARRIER_FIXES[category] || BARRIER_FIXES.Other;
}

function latestNutritionDiaryLog(logs) {
  return [...(logs || [])]
    .sort((a, b) => new Date(b.createdDate || b.date || 0) - new Date(a.createdDate || a.date || 0))[0] || null;
}

function sortedForecastRowsByStatus(status) {
  if (typeof forecastRows !== "function") return [];
  return forecastRows()
    .filter(row => row.status === status)
    .sort((a, b) => Number(a.daysUntilRunOut) - Number(b.daysUntilRunOut));
}

function rowDeadline(row) {
  return row?.runOutShortDate && row.runOutShortDate !== "no run-out date"
    ? ` before ${row.runOutShortDate}`
    : " before your next training/work block";
}

function dynamicNutritionNextFix(logs, topCategory) {
  const latestLog = latestNutritionDiaryLog(logs);
  const positiveTone = POSITIVE_DIARY_CATEGORIES.has(latestLog?.barrierCategory) || POSITIVE_DIARY_CATEGORIES.has(topCategory);
  const redRow = sortedForecastRowsByStatus("red")[0];
  const amberRow = sortedForecastRowsByStatus("amber")[0];
  const tomorrowProtected = typeof mealPrepResolvedToday === "function" ? mealPrepResolvedToday() : false;
  const positivePrefix = positiveTone ? "Good day to maintain the system. " : "";

  if (topCategory === "Snack availability issue") {
    return `${positivePrefix}Pack or restock snacks before your next shift or training session.`;
  }

  if (topCategory === "Long gaps between meals") {
    return `${positivePrefix}Set up an accessible fuel option before the next long work or training block.`;
  }

  if (topCategory === "Training/work schedule disruption") {
    return `${positivePrefix}Prepare portable fuel before the next schedule pinch point.`;
  }

  if (topCategory === "Poor preparation" || !tomorrowProtected) {
    return `${positivePrefix}Protect tomorrow by confirming meals, snacks, shakes, and electrolytes.`;
  }

  if (redRow) {
    return `${positivePrefix}Prepare or restock ${redRow.label}${rowDeadline(redRow)}.`;
  }

  if (amberRow) {
    return `${positivePrefix}Check ${amberRow.label} availability so tomorrow stays protected.`;
  }

  if (!tomorrowProtected) {
    return `${positivePrefix}Protect tomorrow by confirming meals, snacks, shakes, and electrolytes.`;
  }

  if (positiveTone) {
    return "Good day to maintain the system. Keep tomorrow protected.";
  }

  return suggestedBarrierFix(topCategory);
}

function nutritionBarrierForecast(weeks = nutritionBarrierState().insightWindowWeeks) {
  const logs = barrierLogsForWindow(weeks);
  const count = logs.length;

  if (!count) {
    const suggestedFix = dynamicNutritionNextFix(logs, "No patterns yet");
    return {
      logs,
      count: 0,
      topBarrier: "No patterns yet",
      topBarrierCount: 0,
      topBarrierShare: 0,
      latestExperience: "No entries yet",
      suggestedFix,
      dashboardNote: "No nutrition diary patterns yet."
    };
  }

  const barrierCounts = countBy(logs, log => log.barrierCategory);
  const [topBarrier, topBarrierCount] = topCount(barrierCounts);
  const topBarrierShare = Math.round((topBarrierCount / count) * 100);
  const latestExperience = latestNutritionDiaryLog(logs)?.barrierCategory || "No entries yet";
  const dashboardNote = `Most common experience: ${topBarrier}.`;

  return {
    logs,
    count,
    topBarrier,
    topBarrierCount,
    topBarrierShare,
    latestExperience,
    suggestedFix: dynamicNutritionNextFix(logs, topBarrier),
    dashboardNote
  };
}

function nutritionBarrierReportSummary() {
  const forecast = nutritionBarrierForecast();
  if (!forecast.count) {
    return "- No nutrition diary patterns yet. Log what influenced your day and Fuel Guard will spot repeat patterns here.";
  }

  return [
    `- Entries logged: ${forecast.count}`,
    `- Most common experience: ${forecast.topBarrier}`,
    `- Latest experience: ${forecast.latestExperience}`,
    `- Suggested next fix: ${forecast.suggestedFix}`
  ].join("\n");
}

function saveBarrierLog() {
  const barrierCategory = document.getElementById("barrierCategory")?.value || "";
  if (!barrierCategory) return;

  const note = document.getElementById("barrierNote")?.value.trim() || "";
  const createdDate = new Date().toISOString();

  nutritionBarrierState().logs.push({
    id: uid(),
    date: todayInputValue(),
    barrierCategory,
    note,
    createdDate
  });

  state.completed.nutritionBarriers = true;
  addAdherence("nutritionBarriers");
  if (typeof syncFuelMomentumBarrierTrendImprovement === "function") syncFuelMomentumBarrierTrendImprovement();
  save();
  renderAll();
  ["barrierNote"].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = "";
  });
}

function deleteBarrierLog(id) {
  nutritionBarrierState().logs = nutritionBarrierState().logs.filter(log => log.id !== id);
  if (typeof syncFuelMomentumBarrierTrendImprovement === "function") syncFuelMomentumBarrierTrendImprovement();
  save();
  renderAll();
}

function renderNutritionBarrierForm() {
  const categorySelect = document.getElementById("barrierCategory");
  if (categorySelect) {
    const selected = categorySelect.value || BARRIER_CATEGORIES[0];
    categorySelect.innerHTML = BARRIER_CATEGORIES
      .map(category => `<option value="${escapeHtml(category)}" ${selected === category ? "selected" : ""}>${escapeHtml(category)}</option>`)
      .join("");
  }
}

function renderNutritionBarrierSummary(forecast) {
  const summary = document.getElementById("barrierSummary");
  if (!summary) return;

  summary.innerHTML = `
    <div class="mini-card"><p class="label">Entries Logged</p><h3>${forecast.count}</h3></div>
    <div class="mini-card"><p class="label">Most Common Experience</p><h3>${escapeHtml(forecast.topBarrier)}</h3></div>
    <div class="mini-card"><p class="label">Latest Experience</p><h3>${escapeHtml(forecast.latestExperience)}</h3></div>
    <div class="mini-card"><p class="label">Suggested Next Fix</p><h3>${escapeHtml(forecast.suggestedFix)}</h3></div>
  `;
}

function renderNutritionBarrierInsights(forecast) {
  const insights = document.getElementById("barrierInsights");
  if (!insights) return;

  const trend = nutritionBarrierTrendSnapshot();
  const trendHtml = trend.improved
    ? `<div class="fuel-momentum-feedback"><strong>${escapeHtml(trend.message)}</strong></div>`
    : "";

  if (!forecast.count) {
    insights.innerHTML = trendHtml || `<p class="muted">No nutrition diary patterns yet. Log what influenced your day and Fuel Guard will spot repeat patterns here.</p>`;
    return;
  }

  insights.innerHTML = `
    ${trendHtml}
    <div class="row"><div><div class="item-name">Most common experience</div><div class="row-note">${escapeHtml(forecast.topBarrier)}</div></div><strong>${forecast.topBarrierCount}</strong></div>
    <div class="row"><div><div class="item-name">Diary entries</div><div class="row-note">Selected window</div></div><strong>${forecast.count}</strong></div>
    <div class="row"><div><div class="item-name">Latest experience</div><div class="row-note">Most recent diary entry</div></div><strong>${escapeHtml(forecast.latestExperience)}</strong></div>
    <div class="row"><div><div class="item-name">Suggested next fix</div><div class="row-note">Based on Today's experiences and current fuel setup.</div></div><strong>${escapeHtml(forecast.suggestedFix)}</strong></div>
  `;
}

function renderNutritionBarrierRecentLogs() {
  const recentLogs = document.getElementById("barrierRecentLogs");
  if (!recentLogs) return;

  const logs = [...nutritionBarrierState().logs]
    .sort((a, b) => new Date(b.createdDate || b.date) - new Date(a.createdDate || a.date))
    .slice(0, 12);

  recentLogs.innerHTML = logs.length
    ? logs.map(log => `
      <div class="row">
        <div>
          <div class="item-name">${escapeHtml(log.barrierCategory)}</div>
          <div class="row-note">${escapeHtml(formatShortDate(barrierDate(log)))}${log.note ? ` | ${escapeHtml(log.note)}` : ""}</div>
        </div>
        <button class="secondary" type="button" data-delete-barrier-log="${escapeHtml(log.id)}">Delete</button>
      </div>
    `).join("")
    : `<p class="muted">No nutrition diary patterns yet. Log what influenced your day and Fuel Guard will spot repeat patterns here.</p>`;
}

function renderNutritionBarriers() {
  nutritionBarrierState();
  renderNutritionBarrierForm();
  const forecast = nutritionBarrierForecast();
  renderNutritionBarrierSummary(forecast);
  renderNutritionBarrierInsights(forecast);
  renderNutritionBarrierRecentLogs();
}

document.addEventListener("click", event => {
  const saveButton = event.target.closest("#saveBarrierLog");
  if (saveButton) saveBarrierLog();

  const deleteButton = event.target.closest("[data-delete-barrier-log]");
  if (deleteButton) deleteBarrierLog(deleteButton.dataset.deleteBarrierLog);
});
