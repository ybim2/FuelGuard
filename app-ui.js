
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
  const forecast = forecastRows();
  const worst = worstForecast();
  const critical = forecast.filter(row => row.status !== "green");

  return `Fuel Guard Forecast Report - ${today()}

System Status
- Steps complete: ${completedCount()}/${STEP_KEYS.length}
- Current status: ${(worst?.status || "amber").toUpperCase()}
- Calculated next shop: ${calculatedNextShopDate() ? formatShortDate(calculatedNextShopDate()) : "No burn rate"}

Shopping Priority
${critical.length ? critical.map(row => `- ${row.label}: ${row.nextAction} (${row.status.toUpperCase()})`).join("\n") : "- All tracked food is green. Keep monitoring."}

Nutrition Barriers
${typeof nutritionBarrierReportSummary === "function" ? nutritionBarrierReportSummary() : "- No nutrition barrier patterns yet. Log what got in the way after a missed target and Fuel Guard will spot repeat patterns here."}

Fuel Forecast
${forecast.map(row => `- ${row.label}: ${row.currentStock} ${row.unit}, ${row.dailyBurnRate}/day, runs out ${row.runOutShortDate}, ${row.status.toUpperCase()}`).join("\n")}
`;
}

function downloadFuelReport() {
  const blob = new Blob([renderReport()], { type: "text/plain" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "fuel-guard-forecast-report.txt";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
  state.completed.report = true;
  addAdherence("report");
  save();
  renderAll();
}


function setPantryImportStatus(message) {
  const status = document.getElementById("pantryImportStatus");
  if (status) status.textContent = message || "";
}

function loadXlsxParser() {
  if (window.XLSX) return Promise.resolve(window.XLSX);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-xlsx-parser="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.XLSX));
      existing.addEventListener("error", () => reject(new Error("Spreadsheet parser failed to load.")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.sheetjs.com/xlsx-latest/package/dist/xlsx.full.min.js";
    script.async = true;
    script.dataset.xlsxParser = "true";
    script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error("Spreadsheet parser failed to load."));
    script.onerror = () => reject(new Error("Spreadsheet parser failed to load."));
    document.body.appendChild(script);
  });
}

function rowValue(row, names) {
  const entries = Object.entries(row || {}).map(([key, value]) => [compact(key), value]);
  const wanted = names.map(compact);
  const match = entries.find(([key]) => wanted.includes(key));
  return match ? match[1] : "";
}

function pantryKeyForItem(name) {
  const target = compact(name);
  const existing = Object.entries(state.pantry).find(([key, item]) => compact(key) === target || compact(item.label) === target);
  if (existing) return existing[0];

  const base = slug(name) || `imported-${Date.now()}`;
  let key = base;
  let index = 2;
  while (state.pantry[key]) {
    key = `${base}-${index}`;
    index += 1;
  }
  return key;
}

function applyPantryTemplateRows(rows) {
  let importedCount = 0;

  rows.forEach(row => {
    const label = String(rowValue(row, ["Item Name", "Item", "Name"]) || "").trim();
    if (!label) return;

    const key = pantryKeyForItem(label);
    const existing = state.pantry[key] || {};
    const rawQuantity = rowValue(row, ["Quantity", "Qty", "Current Stock", "Stock"]);
    const quantity = Number(String(rawQuantity || "0").replace(/,/g, ""));
    const unit = String(rowValue(row, ["Unit", "Units"]) || existing.unit || "units").trim();
    const notes = String(rowValue(row, ["Notes", "Note"]) || "").trim();

    state.pantry[key] = {
      ...existing,
      label,
      qty: Number.isFinite(quantity) ? quantity : Number(existing.qty || 0),
      unit,
      group: normalizeForecastCategory(rowValue(row, ["Category", "Section", "Group"])),
      notes,
      imported: true,
      dailyUse: Number(existing.dailyUse || 0)
    };
    importedCount += 1;
  });

  if (!importedCount) return 0;

  state.forecastConfirmations = {};
  state.completed.pantry = false;
  state.completed.shopping = false;
  state.completed.report = false;
  save();
  renderAll();
  return importedCount;
}

async function importPantryTemplate(file) {
  if (!file) return;

  try {
    setPantryImportStatus("Loading template...");
    const XLSX = await loadXlsxParser();
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error("No worksheet found.");

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    const importedCount = applyPantryTemplateRows(rows);
    setPantryImportStatus(importedCount ? `Imported ${importedCount} item${importedCount === 1 ? "" : "s"}.` : "No pantry rows found.");
  } catch (error) {
    console.error(error);
    setPantryImportStatus(error.message || "Import failed. Check the template columns and try again.");
  }
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

  if (screen === "shopping" && allForecastCategoriesConfirmed() && !state.completed.shopping) {
    state.completed.shopping = true;
    addAdherence("shopping");
    save();
    renderAll();
  }

  const titles = {
    dashboard: "System Overview",
    shopping: "Fuel Forecast",
    nextAction: "Download Report",
    fuelConfirmation: "Fuel Confirmation",
    checklist: "Checklist",
    nutritionBarriers: "Nutrition Barriers",
    adherence: "Adherence",
    bodyMind: "Body & Mind",
    logs: "Activity Log",
    future: "Future Ideas Parked"
  };

  const subtitles = {
    dashboard: "Know when you'll run out. Know when to shop.",
    fuelConfirmation: "Confirm categories one by one before generating the forecast.",
    shopping: "Confirmed fuel information appears here as run-out predictions and shopping need.",
    nutritionBarriers: "Spot what disrupts fuelling and choose the next fix.",
    nextAction: "Download the latest forecast report with the current shopping priority.",
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
  if (typeof renderNutritionBarriers === "function") renderNutritionBarriers();
  renderBodyMind();
  renderChecklist();
  renderLogs();
  renderStats();
}

function readForecastForm() {
  document.querySelectorAll("[data-forecast-label]").forEach(input => {
    const key = input.dataset.forecastLabel;
    if (state.pantry[key]) state.pantry[key].label = input.value.trim() || state.pantry[key].label;
  });

  document.querySelectorAll("[data-forecast-group]").forEach(input => {
    const key = input.dataset.forecastGroup;
    if (state.pantry[key]) state.pantry[key].group = normalizeForecastCategory(input.value);
  });

  document.querySelectorAll("[data-forecast-unit]").forEach(input => {
    const key = input.dataset.forecastUnit;
    if (state.pantry[key]) state.pantry[key].unit = input.value.trim() || state.pantry[key].unit;
  });

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
  if (categoryButton) {
    event.preventDefault();
    const currentCategory = categoryButton.closest("details");
    if (currentCategory) currentCategory.open = false;
    confirmForecastCategory(categoryButton.dataset.confirmForecastCategory);
  }
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
  forecastConfirmationFlow.oninput = () => {
    readForecastForm();
    save();
  };

  forecastConfirmationFlow.onchange = event => {
    readForecastForm();
    save();
    if (event.target.matches("[data-forecast-group]")) renderAll();
  };
}


const importPantryTemplateButton = document.getElementById("importPantryTemplate");
const pantryTemplateInput = document.getElementById("pantryTemplateInput");
if (importPantryTemplateButton && pantryTemplateInput) {
  importPantryTemplateButton.onclick = () => pantryTemplateInput.click();
  pantryTemplateInput.onchange = () => {
    importPantryTemplate(pantryTemplateInput.files?.[0]);
    pantryTemplateInput.value = "";
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

const downloadForecastReport = document.getElementById("downloadForecastReport");
if (downloadForecastReport) downloadForecastReport.onclick = downloadFuelReport;


document.addEventListener("click", event => {
  const tipId = event.target.dataset.closeTip;
  if (!tipId) return;

  const tip = document.getElementById(tipId);
  if (tip) tip.remove();
});

renderAll();
