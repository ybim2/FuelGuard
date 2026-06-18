const BARRIER_CATEGORIES = [
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

const BARRIER_TARGETS = [
  "Calories",
  "Protein",
  "Carbs",
  "Fat",
  "Hydration",
  "Pre-workout fuelling",
  "Post-workout fuelling",
  "Meal timing",
  "Overall"
];

const BARRIER_WINDOWS = [2, 4, 6, 12, 18, 24];

const BARRIER_FIXES = {
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

function parseOptionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function barrierDate(log) {
  const date = new Date(`${log.date || todayInputValue()}T00:00:00`);
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

function average(numbers) {
  const values = numbers.filter(Number.isFinite);
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function possibleEnergyDeficit(logs, weeks) {
  const calorieLogs = logs.filter(log => log.targetAffected === "Calories" && Number(log.deficitValue || 0) > 0);
  if (!calorieLogs.length) return null;
  const total = calorieLogs.reduce((sum, log) => sum + Number(log.deficitValue || 0), 0);
  return Math.round((total / (Number(weeks) * 7)) * 7);
}

function barrierRiskLevel(score) {
  if (score >= 65) return { level: "high", label: "High", status: "red" };
  if (score >= 35) return { level: "moderate", label: "Moderate", status: "amber" };
  return { level: "low", label: "Low", status: "green" };
}

function suggestedBarrierFix(category) {
  return BARRIER_FIXES[category] || BARRIER_FIXES.Other;
}

function nutritionBarrierForecast(weeks = nutritionBarrierState().insightWindowWeeks) {
  const logs = barrierLogsForWindow(weeks);
  const count = logs.length;

  if (!count) {
    return {
      logs,
      count: 0,
      riskScore: 0,
      riskLevel: "low",
      riskLevelLabel: "Low",
      status: "green",
      topBarrier: "No patterns yet",
      topBarrierCount: 0,
      topBarrierShare: 0,
      mostAffectedTarget: "No patterns yet",
      mostAffectedTargetCount: 0,
      averageDeficit: null,
      averageDeficitPercentage: null,
      possibleEnergyDeficit: null,
      suggestedFix: "Log what got in the way after a missed target.",
      dashboardNote: "No nutrition barrier patterns yet."
    };
  }

  const barrierCounts = countBy(logs, log => log.barrierCategory);
  const targetCounts = countBy(logs, log => log.targetAffected);
  const [topBarrier, topBarrierCount] = topCount(barrierCounts);
  const [mostAffectedTarget, mostAffectedTargetCount] = topCount(targetCounts);
  const topBarrierShare = Math.round((topBarrierCount / count) * 100);
  const averageDeficitValue = average(logs.map(log => Number(log.deficitValue)).filter(value => value > 0));
  const averageDeficitPct = average(logs.map(log => Number(log.deficitPercentage)).filter(value => value > 0));
  const forecastStatus = typeof worstForecast === "function" ? worstForecast()?.status : "green";
  const eventsPerWeek = count / Number(weeks);
  const frequencyScore = Math.min(35, eventsPerWeek * 16);
  const severityScore = averageDeficitPct === null ? 0 : Math.min(25, averageDeficitPct * 0.35);
  const repeatScore = Math.max(0, (topBarrierShare - 35) * 0.35);
  const fuelForecastScore = forecastStatus === "red" ? 15 : forecastStatus === "amber" ? 8 : 0;
  const trainingPressure = Number(state.plannedTraining || 0) / Math.max(1, Number(state.planningDays || 7));
  const trainingScore = Math.min(10, trainingPressure * 14);
  const riskScore = Math.max(0, Math.min(100, Math.round(frequencyScore + severityScore + repeatScore + fuelForecastScore + trainingScore)));
  const risk = barrierRiskLevel(riskScore);
  const dashboardNote = risk.level === "high"
    ? "Higher risk of missing fuelling targets; fix the repeated barrier first."
    : risk.level === "moderate"
      ? "Higher risk of missing fuelling targets if this pattern repeats."
      : "Low barrier pattern in this window.";

  return {
    logs,
    count,
    riskScore,
    riskLevel: risk.level,
    riskLevelLabel: risk.label,
    status: risk.status,
    topBarrier,
    topBarrierCount,
    topBarrierShare,
    mostAffectedTarget,
    mostAffectedTargetCount,
    averageDeficit: averageDeficitValue,
    averageDeficitPercentage: averageDeficitPct,
    possibleEnergyDeficit: possibleEnergyDeficit(logs, weeks),
    suggestedFix: suggestedBarrierFix(topBarrier),
    dashboardNote
  };
}

function nutritionBarrierReportSummary() {
  const forecast = nutritionBarrierForecast();
  if (!forecast.count) {
    return "- No nutrition barrier patterns yet. Log what got in the way after a missed target and Fuel Guard will spot repeat patterns here.";
  }

  return [
    `- Risk level: ${forecast.riskLevelLabel}`,
    `- Top barrier: ${forecast.topBarrier}`,
    `- Most affected target: ${forecast.mostAffectedTarget}`,
    `- Suggested next fix: ${forecast.suggestedFix}`
  ].join("\n");
}

function saveBarrierLog() {
  const date = document.getElementById("barrierDate")?.value || todayInputValue();
  const barrierCategory = document.getElementById("barrierCategory")?.value || "";
  const targetAffected = document.getElementById("barrierTarget")?.value || "";
  if (!barrierCategory || !targetAffected) return;

  const targetValue = parseOptionalNumber(document.getElementById("barrierTargetValue")?.value);
  const actualValue = parseOptionalNumber(document.getElementById("barrierActualValue")?.value);
  const hasDeficitInputs = targetValue !== null && actualValue !== null;
  const deficitValue = hasDeficitInputs ? Math.max(0, targetValue - actualValue) : null;
  const deficitPercentage = hasDeficitInputs && targetValue > 0 ? Math.round((deficitValue / targetValue) * 100) : null;
  const note = document.getElementById("barrierNote")?.value.trim() || "";

  nutritionBarrierState().logs.push({
    id: uid(),
    date,
    barrierCategory,
    targetAffected,
    targetValue,
    actualValue,
    deficitValue,
    deficitPercentage,
    note,
    createdDate: new Date().toISOString()
  });

  save();
  renderAll();
  ["barrierTargetValue", "barrierActualValue", "barrierNote"].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = "";
  });
}

function deleteBarrierLog(id) {
  nutritionBarrierState().logs = nutritionBarrierState().logs.filter(log => log.id !== id);
  save();
  renderAll();
}

function formatBarrierDeficit(log) {
  if (log.deficitValue === null || log.deficitValue === undefined) return "No deficit data";
  const value = `${Number(log.deficitValue).toFixed(Number(log.deficitValue) % 1 ? 1 : 0)}`;
  return log.deficitPercentage === null || log.deficitPercentage === undefined
    ? `${value} deficit`
    : `${value} deficit (${log.deficitPercentage}%)`;
}

function renderNutritionBarrierForm() {
  const barrierState = nutritionBarrierState();
  const dateInput = document.getElementById("barrierDate");
  if (dateInput && !dateInput.value) dateInput.value = todayInputValue();

  const categorySelect = document.getElementById("barrierCategory");
  if (categorySelect) {
    const selected = categorySelect.value || BARRIER_CATEGORIES[0];
    categorySelect.innerHTML = BARRIER_CATEGORIES
      .map(category => `<option value="${escapeHtml(category)}" ${selected === category ? "selected" : ""}>${escapeHtml(category)}</option>`)
      .join("");
  }

  const targetSelect = document.getElementById("barrierTarget");
  if (targetSelect) {
    const selected = targetSelect.value || BARRIER_TARGETS[0];
    targetSelect.innerHTML = BARRIER_TARGETS
      .map(target => `<option value="${escapeHtml(target)}" ${selected === target ? "selected" : ""}>${escapeHtml(target)}</option>`)
      .join("");
  }

  const windowSelect = document.getElementById("barrierInsightWindow");
  if (windowSelect) {
    windowSelect.value = String(barrierState.insightWindowWeeks);
    windowSelect.innerHTML = BARRIER_WINDOWS
      .map(weeks => `<option value="${weeks}" ${Number(barrierState.insightWindowWeeks) === weeks ? "selected" : ""}>${weeks} weeks</option>`)
      .join("");
  }
}

function renderNutritionBarrierSummary(forecast) {
  const summary = document.getElementById("barrierSummary");
  if (!summary) return;

  summary.innerHTML = `
    <div class="mini-card"><p class="label">Current Risk</p><h3><span class="status-pill ${forecast.status}">${forecast.riskLevelLabel}</span></h3></div>
    <div class="mini-card"><p class="label">Risk Score</p><h3>${forecast.riskScore}/100</h3></div>
    <div class="mini-card"><p class="label">Most Common Barrier</p><h3>${escapeHtml(forecast.topBarrier)}</h3></div>
    <div class="mini-card"><p class="label">Most Affected Target</p><h3>${escapeHtml(forecast.mostAffectedTarget)}</h3></div>
    <div class="mini-card"><p class="label">Possible Energy Deficit</p><h3>${forecast.possibleEnergyDeficit === null ? "No calorie data" : `${forecast.possibleEnergyDeficit} kcal / 7 days`}</h3></div>
    <div class="mini-card"><p class="label">Suggested Next Fix</p><h3>${escapeHtml(forecast.suggestedFix)}</h3></div>
  `;
}

function renderNutritionBarrierInsights(forecast) {
  const insights = document.getElementById("barrierInsights");
  if (!insights) return;

  if (!forecast.count) {
    insights.innerHTML = `<p class="muted">No nutrition barrier patterns yet. Log what got in the way after a missed target and Fuel Guard will spot repeat patterns here.</p>`;
    return;
  }

  const averageDeficit = forecast.averageDeficit === null
    ? "No deficit data"
    : `${Math.round(forecast.averageDeficit)} average deficit${forecast.averageDeficitPercentage === null ? "" : ` (${Math.round(forecast.averageDeficitPercentage)}%)`}`;

  insights.innerHTML = `
    <div class="row"><div><div class="item-name">Top barrier</div><div class="row-note">${escapeHtml(forecast.topBarrier)}</div></div><strong>${forecast.topBarrierCount}</strong></div>
    <div class="row"><div><div class="item-name">Barrier count</div><div class="row-note">Selected window</div></div><strong>${forecast.count}</strong></div>
    <div class="row"><div><div class="item-name">Percentage share</div><div class="row-note">Top barrier share</div></div><strong>${forecast.topBarrierShare}%</strong></div>
    <div class="row"><div><div class="item-name">Average deficit</div><div class="row-note">Where target and actual values exist</div></div><strong>${averageDeficit}</strong></div>
    <div class="row"><div><div class="item-name">Most affected target</div><div class="row-note">${escapeHtml(forecast.mostAffectedTarget)}</div></div><strong>${forecast.mostAffectedTargetCount}</strong></div>
    <div class="row"><div><div class="item-name">Suggested next fix</div><div class="row-note">A repeated barrier pattern may increase under-fuelling risk.</div></div><strong>${escapeHtml(forecast.suggestedFix)}</strong></div>
  `;
}

function renderNutritionBarrierRecentLogs() {
  const recentLogs = document.getElementById("barrierRecentLogs");
  if (!recentLogs) return;

  const logs = [...nutritionBarrierState().logs]
    .sort((a, b) => new Date(b.date || b.createdDate) - new Date(a.date || a.createdDate))
    .slice(0, 12);

  recentLogs.innerHTML = logs.length
    ? logs.map(log => `
      <div class="row">
        <div>
          <div class="item-name">${escapeHtml(log.barrierCategory)} - ${escapeHtml(log.targetAffected)}</div>
          <div class="row-note">${escapeHtml(formatShortDate(barrierDate(log)))} | ${escapeHtml(formatBarrierDeficit(log))}${log.note ? ` | ${escapeHtml(log.note)}` : ""}</div>
        </div>
        <button class="secondary" type="button" data-delete-barrier-log="${escapeHtml(log.id)}">Delete</button>
      </div>
    `).join("")
    : `<p class="muted">No nutrition barrier patterns yet. Log what got in the way after a missed target and Fuel Guard will spot repeat patterns here.</p>`;
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

document.addEventListener("change", event => {
  if (!event.target.matches("#barrierInsightWindow")) return;
  nutritionBarrierState().insightWindowWeeks = Number(event.target.value);
  save();
  renderAll();
});
