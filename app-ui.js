
function drawBars(id, values, label) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const width = 40;
  const gap = 18;
  const base = 220;
  ctx.fillStyle = "#a6b9af";
  ctx.fillText(label, 20, 20);

  values.forEach((value, index) => {
    ctx.fillStyle = "#2dff88";
    ctx.fillRect(50 + index * (width + gap), base - value * 1.7, width, value * 1.7);
    ctx.fillStyle = "#a6b9af";
    ctx.fillText(["M", "T", "W", "T", "F", "S", "S"][index] || index, 55 + index * (width + gap), 245);
  });
}

function drawLine(id, adherence, physiology) {
  const canvas = document.getElementById(id);
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  function line(values, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = 60 + index * 110;
      const y = 250 - value * 2;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  line(adherence, "#2dff88");
  line(physiology, "#20d6ff");
  ctx.fillStyle = "#f5fff8";
  ctx.fillText("Green: Adherence | Blue: Physiology", 20, 24);
}

function renderStats() {
  drawBars("weeklyChart", [20, 40, 60, 80, 100, 80, 60], "Adherence");
  drawBars("weeklyPhysiologyChart", [70, 50, 80, 70, physiologyScore(), 100, 70], "Physiology");
  drawLine("lineChart", [20, 40, 60, 80, 100, 80, 60], [70, 50, 80, 70, physiologyScore(), 100, 70]);
  drawBars("proactivityChart", [40, 55, 65, 70, proactivityScore(), proactivityScore(), proactivityScore()], "Proactivity");
}

function renderReport() {
  const gs = gapStats();
  const forecast = forecastRows();
  const worst = worstForecast();
  const critical = forecast.filter(row => row.status !== "green");
  const report = `Fuel Guard Daily Report - ${today()}

Readiness: ${completedCount()}/${STEP_KEYS.length} system steps complete

Meal Gaps
- Longest gap: ${duration(gs.longest)}
- Calories planned: ${gs.calories} kcal
- Last meal tracked: ${gs.last?.name || "N/A"}

Fuel Forecast
- Next shopping opportunity: ${state.nextShopOpportunity || "Not set"}
- Current status: ${(worst?.status || "amber").toUpperCase()}
- Attention needed: ${critical.length ? critical.map(row => `${row.label} (${row.status})`).join(", ") : "None"}

Behaviour Metrics
- Fuel streak: ${fuelStreak()} day(s)
- Proactivity score: ${proactivityScore()}%
- Fuel discipline score: ${fuelDisciplineScore()}%

Prepared Fuel
- Protein bagels: ${state.preparedFuel.proteinBagels.qty}
- Protein shakes: ${state.preparedFuel.proteinShakes.qty}

Pantry
- Protein bagel batches possible: ${batches(state.recipes[0])}
- Protein shake batches possible: ${batches(state.recipes[1])}

Body and Mind
- Energy: ${state.bodyMind.energy}
- Mood: ${state.bodyMind.mood}
- Hunger/crash risk: ${state.bodyMind.hunger}
- Note: ${state.bodyMind.note || "None"}
`;

  const reportPreview = document.getElementById("reportPreview");
  if (reportPreview) reportPreview.textContent = report;
  return report;
}

function downloadFuelReport() {
  const blob = new Blob([renderReport()], { type: "text/plain" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "fuel-guard-daily-report.txt";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function switchScreen(screen) {
  const target = document.getElementById(screen);
  if (!target) return;

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.screen === screen);
  });

  document.querySelectorAll(".screen").forEach(section => {
    section.classList.toggle("active", section.id === screen);
  });

  const titles = {
    dashboard: "System Overview",
    shopping: "Fuel Forecast",
    fuelConfirmation: "Fuel Confirmation",
    checklist: "Checklist",
    personalInsights: "Personal Insights",
    systemInsights: "System Insights",
    adherence: "Adherence",
    bodyMind: "Body & Mind",
    stats: "Stats",
    logs: "Weekly Logs",
    report: "Download Report",
    future: "Future Ideas Parked"
  };

  const subtitles = {
    dashboard: "Know when you'll run out. Know when to shop.",
    fuelConfirmation: "Confirm categories one by one before generating the forecast.",
    shopping: "Confirmed fuel information appears here as run-out predictions and shopping need.",
    report: "Download the latest Fuel Guard report.",
    adherence: "Review and adjust the operational stages completed today.",
    bodyMind: "Log how the fuel system felt in the body."
  };

  const pageTitle = document.getElementById("pageTitle");
  if (pageTitle) pageTitle.textContent = titles[screen] || "Fuel Guard";

  const pageSubtitle = document.getElementById("pageSubtitle");
  if (pageSubtitle) pageSubtitle.textContent = subtitles[screen] || "Manage this part of your fuel system.";

  renderStats();
}

function renderAll() {
  renderDashboard();
  renderGaps();
  renderTimeline();
  renderShopping();
  renderBodyMind();
  renderChecklist();
  renderLogs();
  renderStats();
  renderReport();
}

function readForecastForm() {
  const nextShopOpportunity = document.getElementById("nextShopOpportunity");
  if (nextShopOpportunity) state.nextShopOpportunity = nextShopOpportunity.value;

  document.querySelectorAll("[data-forecast-stock]").forEach(input => {
    const key = input.dataset.forecastStock;
    if (state.pantry[key]) state.pantry[key].qty = Number(input.value || 0);
  });

  document.querySelectorAll("[data-forecast-burn]").forEach(input => {
    const key = input.dataset.forecastBurn;
    if (state.pantry[key]) state.pantry[key].dailyUse = Number(input.value || 0);
  });
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.onclick = () => switchScreen(button.dataset.screen);
});

document.addEventListener("click", event => {
  const jump = event.target.closest("[data-jump]");
  if (jump) switchScreen(jump.dataset.jump);

  const categoryButton = event.target.closest("[data-confirm-forecast-category]");
  if (categoryButton) confirmForecastCategory(categoryButton.dataset.confirmForecastCategory);
});

const mealEditor = document.getElementById("mealEditor");
if (mealEditor) {
  mealEditor.oninput = event => {
    const id = event.target.dataset.mealTime || event.target.dataset.mealName || event.target.dataset.mealCalories;
    if (!id) return;

    const meal = state.meals.find(item => item.id === id);
    if (!meal) return;

    if (event.target.dataset.mealTime) meal.time = event.target.value;
    if (event.target.dataset.mealName) meal.name = event.target.value;
    if (event.target.dataset.mealCalories) meal.calories = Number(event.target.value || 0);

    save();
    renderAll();
  };

  mealEditor.onclick = event => {
    const id = event.target.dataset.removeMeal;
    if (!id) return;

    state.meals = state.meals.filter(meal => meal.id !== id);
    save();
    renderAll();
  };
}

const fuelForecastList = document.getElementById("fuelForecastList");
if (fuelForecastList) {
  fuelForecastList.onchange = () => {
    readForecastForm();
    save();
    renderAll();
  };
}

const forecastConfirmationFlow = document.getElementById("forecastConfirmationFlow");
if (forecastConfirmationFlow) {
  forecastConfirmationFlow.onchange = () => {
    readForecastForm();
    save();
    renderAll();
  };
}

const saveShopping = document.getElementById("saveShopping");
if (saveShopping) {
  saveShopping.onclick = () => {
    readForecastForm();
    if (allForecastCategoriesConfirmed()) {
      markDone("shopping");
      switchScreen("shopping");
    } else {
      save();
      renderAll();
    }
  };
}

const saveManualAdherence = document.getElementById("saveManualAdherence");
if (saveManualAdherence) {
  saveManualAdherence.onclick = () => {
    document.querySelectorAll("[data-manual-complete]").forEach(checkbox => {
      state.completed[checkbox.dataset.manualComplete] = checkbox.checked;
    });
    save();
    renderAll();
  };
}

const logBodyMind = document.getElementById("logBodyMind");
if (logBodyMind) {
  logBodyMind.onclick = () => {
    state.bodyMind = {
      energy: document.getElementById("energyToday")?.value || "Stable",
      mood: document.getElementById("moodToday")?.value || "Calm",
      hunger: document.getElementById("hungerToday")?.value || "Managed",
      note: document.getElementById("recoveryNote")?.value || ""
    };
    markDone("adherence");
  };
}

const downloadReport = document.getElementById("downloadReport");
if (downloadReport) downloadReport.onclick = downloadFuelReport;

const downloadForecastReport = document.getElementById("downloadForecastReport");
if (downloadForecastReport) downloadForecastReport.onclick = downloadFuelReport;

document.addEventListener("click", event => {
  const tipId = event.target.dataset.closeTip;
  if (!tipId) return;

  const tip = document.getElementById(tipId);
  if (tip) tip.remove();
});

renderAll();
