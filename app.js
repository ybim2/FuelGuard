const STEP_KEYS = ["pantry", "shopping", "prep", "adherence"];

const DEFAULT_STATE = {
  completed: {
    gaps: false,
    plan: false,
    pantry: false,
    shopping: false,
    prep: false,
    adherence: false
  },
  nutritionWhy: "Pass RAF training and stop energy crashes.",
  nextShopOpportunity: "",
  planningDays: 7,
  plannedShifts: 5,
  plannedTraining: 4,
  bagelsPerShift: 3,
  shakesPerDay: 1,
  meals: [
    { id: "m1", time: "07:30", name: "Breakfast", calories: 650 },
    { id: "m2", time: "10:15", name: "Snack", calories: 350 },
    { id: "m3", time: "13:00", name: "Lunch", calories: 800 },
    { id: "m4", time: "16:30", name: "Snack", calories: 450 },
    { id: "m5", time: "20:00", name: "Dinner", calories: 850 }
  ],
  planEvents: [
    { id: "e1", time: "06:00", name: "Wake", type: "life" },
    { id: "e2", time: "07:00", name: "Breakfast", type: "meal" },
    { id: "e3", time: "08:00", name: "Morrisons Shift", type: "work" },
    { id: "e4", time: "10:30", name: "Planned Snack", type: "meal" },
    { id: "e5", time: "13:00", name: "Lunch", type: "meal" },
    { id: "e6", time: "17:00", name: "Strength Training", type: "training" },
    { id: "e7", time: "18:30", name: "Recovery Meal", type: "meal" },
    { id: "e8", time: "20:00", name: "Coding Session", type: "deep-work" },
    { id: "e9", time: "22:00", name: "Protein Shake", type: "meal" },
    { id: "e10", time: "23:00", name: "Sleep", type: "life" }
  ],
  preparedFuel: {
    proteinBagels: { label: "Prepared Protein Bagels", qty: 0, unit: "bagels" },
    proteinShakes: { label: "Prepared Protein Shakes", qty: 0, unit: "shakes" }
  },
  pantry: {
    bagels: { label: "Bagels", qty: 18, unit: "single bagels", dailyUse: 4, packSize: 6, group: "snacks" },
    wraps: { label: "Wraps", qty: 8, unit: "wraps", dailyUse: 1, group: "meals" },
    yoghurt: { label: "Yoghurt", qty: 4, unit: "pots", dailyUse: 1, group: "snacks" },
    philadelphia: { label: "Philadelphia", qty: 2, unit: "tubs", dailyUse: 0.25, group: "meals" },
    deli: { label: "Deli Slices", qty: 7, unit: "packs", dailyUse: 0.75, group: "meals" },
    mixedVeg: { label: "Mixed Veg", qty: 2, unit: "bags", dailyUse: 0.25, group: "meals" },
    proteinPowder: { label: "Protein Powder", qty: 15, unit: "servings", dailyUse: 1, group: "supplements" },
    blueberries: { label: "Blueberries", qty: 500, unit: "g", dailyUse: 100, group: "snacks" },
    bananas: { label: "Bananas", qty: 6, unit: "bananas", dailyUse: 1, group: "snacks" },
    honey: { label: "Honey", qty: 300, unit: "g", dailyUse: 20, group: "snacks" },
    wholeMilk: { label: "Whole Milk", qty: 2000, unit: "ml", dailyUse: 300, group: "supplements" }
  },
  recipes: [
    {
      id: "proteinBagels",
      name: "Protein Bagels",
      category: "Portable snack",
      output: "12 prepared bagels",
      preparedKey: "proteinBagels",
      preparedQty: 12,
      ingredients: [
        { key: "bagels", qty: 12 },
        { key: "deli", qty: 4 },
        { key: "philadelphia", qty: 1 },
        { key: "mixedVeg", qty: 1 }
      ]
    },
    {
      id: "proteinShakes",
      name: "Protein Shake",
      category: "Recovery fuel",
      output: "1 shake",
      preparedKey: "proteinShakes",
      preparedQty: 1,
      ingredients: [
        { key: "proteinPowder", qty: 1 },
        { key: "blueberries", qty: 100 },
        { key: "bananas", qty: 1 },
        { key: "honey", qty: 20 },
        { key: "wholeMilk", qty: 300 }
      ]
    }
  ],
  bodyMind: {
    energy: "Stable",
    mood: "Calm",
    hunger: "Managed",
    note: ""
  },
  adherenceHistory: []
};

let state = load();

function load() {
  const saved = localStorage.getItem("fuelGuardStateV20");
  const defaults = structuredClone(DEFAULT_STATE);
  if (!saved) return defaults;

  try {
    const parsed = JSON.parse(saved);
    const merged = {
      ...defaults,
      ...parsed,
      completed: { ...defaults.completed, ...(parsed.completed || {}) },
      bodyMind: { ...defaults.bodyMind, ...(parsed.bodyMind || {}) },
      adherenceHistory: parsed.adherenceHistory || []
    };

    merged.pantry = { ...defaults.pantry };
    Object.entries(parsed.pantry || {}).forEach(([key, item]) => {
      merged.pantry[key] = { ...(defaults.pantry[key] || {}), ...item };
    });

    merged.preparedFuel = { ...defaults.preparedFuel };
    Object.entries(parsed.preparedFuel || {}).forEach(([key, item]) => {
      merged.preparedFuel[key] = { ...(defaults.preparedFuel[key] || {}), ...item };
    });

    return merged;
  } catch {
    return defaults;
  }
}

function save() {
  localStorage.setItem("fuelGuardStateV20", JSON.stringify(state));
}

const uid = () => Math.random().toString(36).slice(2, 9);

function mins(time) {
  const [hours, minutes] = String(time || "0:0").split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function duration(minutes) {
  if (!Number.isFinite(minutes)) return "No limit";
  const safeMinutes = Math.max(0, Math.round(minutes));
  return `${Math.floor(safeMinutes / 60)}h ${String(safeMinutes % 60).padStart(2, "0")}m`;
}

function today() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateFromInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(days) {
  const date = startOfToday();
  date.setDate(date.getDate() + Math.max(0, Math.ceil(days)));
  return date;
}

function formatShortDate(date) {
  if (!date) return "No date";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function daysToNextShop() {
  const shopDate = dateFromInput(state.nextShopOpportunity);
  if (!shopDate) return null;
  return Math.ceil((shopDate - startOfToday()) / 86400000);
}

function formatDays(days) {
  if (!Number.isFinite(days)) return "No burn rate";
  if (days <= 0) return "0 days";
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`;
}

function sortedMeals() {
  return [...state.meals].sort((a, b) => mins(a.time) - mins(b.time));
}

function timelineItems() {
  if (state.timeline && state.timeline.length) {
    return [...state.timeline].sort((a, b) => mins(a.time) - mins(b.time));
  }

  const mealEvents = state.meals.map(meal => ({
    id: meal.id,
    time: meal.time,
    name: meal.name,
    type: "meal",
    calories: meal.calories || 0
  }));

  const otherEvents = (state.planEvents || [])
    .filter(event => !mealEvents.some(meal => meal.time === event.time && meal.name === event.name))
    .map(event => ({
      id: event.id,
      time: event.time,
      name: event.name,
      type: event.type || "life",
      calories: event.calories || 0
    }));

  return [...mealEvents, ...otherEvents].sort((a, b) => mins(a.time) - mins(b.time));
}

function gapStats() {
  const meals = sortedMeals();
  let longest = 0;
  let pair = null;

  for (let index = 1; index < meals.length; index += 1) {
    const gap = mins(meals[index].time) - mins(meals[index - 1].time);
    if (gap > longest) {
      longest = gap;
      pair = [meals[index - 1], meals[index]];
    }
  }

  const calories = meals.reduce((sum, meal) => sum + Number(meal.calories || 0), 0);
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const pastMeals = meals.filter(meal => mins(meal.time) <= nowMinutes);
  const last = pastMeals[pastMeals.length - 1] || meals[0];
  const since = last ? Math.max(0, nowMinutes - mins(last.time)) : 0;

  return { meals, longest, pair, calories, since, last };
}

function batches(recipe) {
  return Math.min(...recipe.ingredients.map(item => Math.floor((state.pantry[item.key]?.qty || 0) / item.qty)));
}

function formatQty(key, item) {
  if (key === "bagels") return `${(item.qty / 6).toFixed(1)} packs (${item.qty} bagels)`;
  return `${item.qty} ${item.unit}`;
}

function completedCount() {
  return STEP_KEYS.filter(key => state.completed[key]).length;
}

function dailyMaintenanceComplete() {
  return completedCount() >= STEP_KEYS.length;
}

function markDone(key) {
  state.completed[key] = true;
  addAdherence(key);
  save();
  renderAll();
}

function addAdherence(key) {
  const labels = {
    pantry: "Pantry checked",
    shopping: "Fuel burn forecast updated",
    prep: "Meal prep complete",
    adherence: "Body and mind logged"
  };

  if (!labels[key]) return;

  state.adherenceHistory = state.adherenceHistory.filter(entry => {
    const sameDay = new Date(entry.date).toDateString() === new Date().toDateString();
    return !(sameDay && entry.key === key);
  });

  state.adherenceHistory.push({
    key,
    label: labels[key],
    date: new Date().toISOString()
  });
}

function forecastStatus(daysUntilRunOut, shopDays) {
  if (daysUntilRunOut <= 0) return "red";
  if (!Number.isFinite(daysUntilRunOut)) return "green";
  if (shopDays === null) return "amber";
  if (shopDays < 0) return "red";
  if (daysUntilRunOut < shopDays) return "red";
  if (daysUntilRunOut - shopDays <= 2) return "amber";
  return "green";
}

function forecastAction(row) {
  if (!state.nextShopOpportunity) return "Set next shopping opportunity so this can be judged.";
  if (row.status === "red") return `Shop before ${row.runOutShortDate} or reduce daily use.`;
  if (row.status === "amber") return "Add to the next shop or reduce daily use if demand increases.";
  return `Enough until ${formatShortDate(dateFromInput(state.nextShopOpportunity))}. Keep monitoring.`;
}

function forecastRows() {
  const shopDays = daysToNextShop();

  return Object.entries(state.pantry).map(([key, item]) => {
    const currentStock = Number(item.qty || 0);
    const dailyBurnRate = Number(item.dailyUse || 0);
    const daysUntilRunOut = dailyBurnRate > 0 ? currentStock / dailyBurnRate : Infinity;
    const runOutDate = Number.isFinite(daysUntilRunOut) ? addDays(daysUntilRunOut) : null;
    const status = forecastStatus(daysUntilRunOut, shopDays);
    const row = {
      key,
      label: item.label,
      unit: item.unit,
      group: item.group || "meals",
      currentStock,
      dailyBurnRate,
      daysUntilRunOut,
      runOutDate,
      runOutShortDate: runOutDate ? formatShortDate(runOutDate) : "no run-out date",
      status
    };

    row.nextAction = forecastAction(row);
    return row;
  });
}

function forecastRank(status) {
  return { red: 3, amber: 2, green: 1 }[status] || 0;
}

function worstForecast() {
  return [...forecastRows()].sort((a, b) => forecastRank(b.status) - forecastRank(a.status))[0];
}

function foodRunoutDays() {
  const burnRows = forecastRows().filter(row => Number.isFinite(row.daysUntilRunOut));
  if (!burnRows.length) return Infinity;
  return Math.min(...burnRows.map(row => row.daysUntilRunOut));
}

function proactivityScore() {
  const runway = foodRunoutDays();
  const shopDays = daysToNextShop();
  if (shopDays === null || shopDays < 0) return 0;
  if (shopDays < runway) return 100;
  if (shopDays === runway) return 65;
  return 25;
}

function fuelDisciplineScore() {
  return Math.round(((state.completed.shopping ? 100 : 0) + (state.completed.prep ? 100 : 0)) / 2);
}

function fuelStreak() {
  return dailyMaintenanceComplete()
    ? Math.max(1, new Set(state.adherenceHistory.map(entry => new Date(entry.date).toDateString())).size)
    : 0;
}

function physiologyScore() {
  const energy = { Low: 35, Stable: 70, High: 100 }[state.bodyMind.energy] || 70;
  const mood = { Flat: 35, Calm: 70, Motivated: 100 }[state.bodyMind.mood] || 70;
  const hunger = { Managed: 100, Distracting: 55, Crashed: 20 }[state.bodyMind.hunger] || 100;
  return Math.round((energy + mood + hunger) / 3);
}

function renderDashboard() {
  const gs = gapStats();
  const totalBatches = state.recipes.reduce((sum, recipe) => sum + batches(recipe), 0);
  const complete = completedCount();
  const total = STEP_KEYS.length;
  const worst = worstForecast();
  const status = worst?.status || "amber";

  const sideCompletion = document.getElementById("sideCompletion");
  if (sideCompletion) sideCompletion.textContent = `${complete}/${total} complete`;

  const dashboardCompletion = document.getElementById("dashboardCompletion");
  if (dashboardCompletion) dashboardCompletion.textContent = `${complete}/${total}`;

  const systemDailyProgress = document.getElementById("systemDailyProgress");
  if (systemDailyProgress) systemDailyProgress.textContent = `${complete}/${total}`;

  const completionBar = document.getElementById("completionBar");
  if (completionBar) completionBar.style.width = `${(complete / total) * 100}%`;

  const completionMessageTitle = document.getElementById("completionMessageTitle");
  if (completionMessageTitle) {
    completionMessageTitle.textContent = dailyMaintenanceComplete()
      ? "Fuel Operations Complete"
      : `${complete}/${total} steps complete`;
  }

  const completionMessageText = document.getElementById("completionMessageText");
  if (completionMessageText) {
    completionMessageText.textContent = dailyMaintenanceComplete()
      ? "Your core personal fuel operations are complete for today."
      : "Use Checklist to complete the fuel management loop. Use Insights to review what is happening.";
  }

  const completionMessageCard = document.getElementById("completionMessageCard");
  if (completionMessageCard) completionMessageCard.classList.toggle("complete", dailyMaintenanceComplete());

  const dashboardPrepared = document.getElementById("dashboardPrepared");
  if (dashboardPrepared) {
    dashboardPrepared.textContent = `${state.preparedFuel.proteinBagels.qty + state.preparedFuel.proteinShakes.qty} units`;
  }

  const dashboardPreparedNote = document.getElementById("dashboardPreparedNote");
  if (dashboardPreparedNote) {
    dashboardPreparedNote.textContent = `${state.preparedFuel.proteinBagels.qty} bagels, ${state.preparedFuel.proteinShakes.qty} shakes ready.`;
  }

  const personalLongestGap = document.getElementById("personalLongestGap");
  if (personalLongestGap) personalLongestGap.textContent = duration(gs.longest);

  const dashboardCalories = document.getElementById("dashboardCalories");
  if (dashboardCalories) dashboardCalories.textContent = `${gs.calories} kcal`;

  const personalCaloriesSmall = document.getElementById("personalCaloriesSmall");
  if (personalCaloriesSmall) personalCaloriesSmall.textContent = `${gs.calories} kcal planned`;

  const dashboardBatches = document.getElementById("dashboardBatches");
  if (dashboardBatches) dashboardBatches.textContent = totalBatches;

  const readinessScore = document.getElementById("readinessScore");
  if (readinessScore) readinessScore.textContent = complete >= 4 ? "92" : complete >= 2 ? "78" : "61";

  const readinessNote = document.getElementById("readinessNote");
  if (readinessNote) {
    readinessNote.textContent = complete >= 4
      ? "Your daily fuel system is managed."
      : "Finish the core steps before trusting readiness.";
  }

  const topShoppingDay = document.getElementById("topShoppingDay");
  if (topShoppingDay) topShoppingDay.textContent = state.nextShopOpportunity || "Set in Fuel Forecast";

  const topStatus = document.getElementById("topStatus");
  if (topStatus) {
    topStatus.textContent = status.toUpperCase();
    topStatus.className = `status-pill ${status}`;
  }

  const dashboardInsight = document.getElementById("dashboardInsight");
  if (dashboardInsight) {
    dashboardInsight.textContent = "Dashboard is ordered by action: Checklist, System Insights, then Personal Insights.";
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
    proactivityNote.textContent = state.nextShopOpportunity
      ? `Next planned shop: ${state.nextShopOpportunity}`
      : "Add a shop opportunity in Fuel Forecast.";
  }

  const fuelDisciplineScoreEl = document.getElementById("fuelDisciplineScore");
  if (fuelDisciplineScoreEl) fuelDisciplineScoreEl.textContent = `${fuelDisciplineScore()}%`;

  const fastFlow = document.getElementById("fastFlow");
  if (fastFlow) {
    const steps = [
      ["setupActions", "Step 1", "Confirm pantry", "pantry"],
      ["shopping", "Step 2", "Update burn forecast", "shopping"],
      ["shopping", "Step 3", "Confirm meal prep", "prep"],
      ["bodyMind", "Step 4", "Body and mind log", "adherence"]
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
    ["pantry", "Pantry checked"],
    ["shopping", "Fuel burn forecast updated"],
    ["prep", "Meal prep complete"],
    ["adherence", "Body and mind logged"]
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

function renderSetupActions() {
  const pantry = document.getElementById("setupPantryList");
  if (!pantry) return;

  pantry.innerHTML = Object.entries(state.pantry)
    .map(([key, item]) => `
      <div class="row">
        <div>
          <div class="item-name">${item.label}</div>
          <div class="row-note">${formatQty(key, item)}</div>
        </div>
        <input class="qty-input" type="number" value="${item.qty}" data-setup-pantry="${key}">
      </div>
    `)
    .join("");
}

function renderShopping() {
  const nextShopOpportunity = document.getElementById("nextShopOpportunity");
  if (nextShopOpportunity) nextShopOpportunity.value = state.nextShopOpportunity;

  const forecastList = document.getElementById("fuelForecastList");
  if (forecastList) {
    const groups = [
      ["meals", "Meals"],
      ["snacks", "Snacks"],
      ["supplements", "Supplements"]
    ];

    forecastList.innerHTML = groups
      .map(([group, title]) => {
        const rows = forecastRows().filter(row => row.group === group);
        if (!rows.length) return "";

        return `
          <section class="forecast-section">
            <h3>${title}</h3>
            <div class="forecast-row forecast-heading">
              <span>Food Item</span>
              <span>Current Stock</span>
              <span>Daily Burn Rate</span>
              <span>Run-Out Forecast</span>
              <span>Traffic Light Status / Next Action</span>
            </div>
            ${rows
              .map(row => `
                <div class="forecast-row">
                  <div>
                    <div class="item-name">${row.label}</div>
                    <div class="row-note">${row.unit}</div>
                  </div>
                  <label class="forecast-field">
                    <span>Current Stock</span>
                    <input type="number" min="0" step="0.01" value="${row.currentStock}" data-forecast-stock="${row.key}">
                  </label>
                  <label class="forecast-field">
                    <span>Daily Burn Rate</span>
                    <input type="number" min="0" step="0.01" value="${row.dailyBurnRate}" data-forecast-burn="${row.key}">
                  </label>
                  <div>
                    <strong>${formatDays(row.daysUntilRunOut)}</strong>
                    <div class="row-note">${Number.isFinite(row.daysUntilRunOut) ? row.runOutShortDate : "No run-out date"}</div>
                  </div>
                  <div>
                    <span class="status-pill ${row.status}">${row.status.toUpperCase()}</span>
                    <div class="row-note">${row.nextAction}</div>
                  </div>
                </div>
              `)
              .join("")}
          </section>
        `;
      })
      .join("");
  }

  const shoppingList = document.getElementById("shoppingList");
  if (!shoppingList) return;

  const rows = forecastRows();
  const needsAttention = rows
    .filter(row => row.status !== "green")
    .sort((a, b) => forecastRank(b.status) - forecastRank(a.status));

  if (!state.nextShopOpportunity) {
    shoppingList.innerHTML = `
      <div class="row">
        <div>
          <div class="item-name">Set next shopping opportunity</div>
          <div class="row-note">Forecast status needs a target shopping date.</div>
        </div>
        <strong>Required</strong>
      </div>
    `;
    return;
  }

  if (!needsAttention.length) {
    shoppingList.innerHTML = `
      <div class="row">
        <div>
          <div class="item-name">All tracked food is green</div>
          <div class="row-note">Enough stock until ${formatShortDate(dateFromInput(state.nextShopOpportunity))}.</div>
        </div>
        <strong>Hold</strong>
      </div>
    `;
    return;
  }

  shoppingList.innerHTML = needsAttention
    .map(row => `
      <div class="row">
        <div>
          <div class="item-name">${row.label}</div>
          <div class="row-note">${row.nextAction}</div>
        </div>
        <span class="status-pill ${row.status}">${row.status.toUpperCase()}</span>
      </div>
    `)
    .join("");
}

function renderPurpose() {
  const whyDisplay = document.getElementById("nutritionWhyDisplay");
  if (whyDisplay) whyDisplay.textContent = state.nutritionWhy;

  const whyInput = document.getElementById("nutritionWhyInput");
  if (whyInput) whyInput.value = state.nutritionWhy;

  const energyToday = document.getElementById("energyToday");
  if (energyToday) energyToday.value = state.bodyMind.energy;

  const moodToday = document.getElementById("moodToday");
  if (moodToday) moodToday.value = state.bodyMind.mood;

  const hungerToday = document.getElementById("hungerToday");
  if (hungerToday) hungerToday.value = state.bodyMind.hunger;

  const recoveryNote = document.getElementById("recoveryNote");
  if (recoveryNote) recoveryNote.value = state.bodyMind.note || "";
}

function renderLogs() {
  const entries = [...(state.adherenceHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date));

  const weeklyLogSummary = document.getElementById("weeklyLogSummary");
  if (weeklyLogSummary) {
    weeklyLogSummary.innerHTML = `
      <div class="mini-card"><p class="label">Steps completed</p><h3>${completedCount()}/${STEP_KEYS.length}</h3></div>
      <div class="mini-card"><p class="label">Streak</p><h3>${fuelStreak()} days</h3></div>
      <div class="mini-card"><p class="label">Physiology</p><h3>${physiologyScore()}%</h3></div>
    `;
  }

  const activityLog = document.getElementById("activityLog");
  if (activityLog) {
    activityLog.innerHTML = entries.length
      ? entries
        .map(entry => `
          <div class="row">
            <div>
              <div class="item-name">${entry.label}</div>
              <div class="row-note">${new Date(entry.date).toLocaleString()}</div>
            </div>
            <strong>Done</strong>
          </div>
        `)
        .join("")
      : `<p class="muted">No activity logged yet.</p>`;
  }
}

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
    setupActions: "Confirm Pantry",
    shopping: "Fuel Forecast",
    checklist: "Checklist",
    startWhy: "Start With Why",
    personalInsights: "Personal Insights",
    systemInsights: "System Insights",
    adherence: "Adherence",
    bodyMind: "Body & Mind",
    stats: "Stats",
    logs: "Weekly Logs",
    report: "Daily Report",
    future: "Future Ideas Parked"
  };

  const subtitles = {
    dashboard: "A clear view of whether your personal fuel operations support training, work and recovery.",
    setupActions: "Confirm current stock before trusting the forecast.",
    shopping: "Forecast shopping need from stock and daily burn rate.",
    startWhy: "Keep the purpose visible before the process gets noisy.",
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
  renderSetupActions();
  renderDashboard();
  renderGaps();
  renderTimeline();
  renderShopping();
  renderPurpose();
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

const setupPantryList = document.getElementById("setupPantryList");
if (setupPantryList) {
  setupPantryList.oninput = event => {
    const key = event.target.dataset.setupPantry;
    if (!key || !state.pantry[key]) return;

    state.pantry[key].qty = Number(event.target.value || 0);
    save();
    renderAll();
  };
}

const setupConfirmPantry = document.getElementById("setupConfirmPantry");
if (setupConfirmPantry) setupConfirmPantry.onclick = () => markDone("pantry");

const fuelForecastList = document.getElementById("fuelForecastList");
if (fuelForecastList) {
  fuelForecastList.onchange = () => {
    readForecastForm();
    save();
    renderAll();
  };
}

const saveShopping = document.getElementById("saveShopping");
if (saveShopping) {
  saveShopping.onclick = () => {
    readForecastForm();
    markDone("shopping");
  };
}

const confirmShopping = document.getElementById("confirmShopping");
if (confirmShopping) {
  confirmShopping.onclick = () => {
    readForecastForm();
    state.completed.shopping = true;
    markDone("prep");
  };
}

const saveWhy = document.getElementById("saveWhy");
if (saveWhy) {
  saveWhy.onclick = () => {
    const whyInput = document.getElementById("nutritionWhyInput");
    state.nutritionWhy = whyInput?.value || state.nutritionWhy;
    save();
    renderAll();
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
if (downloadReport) {
  downloadReport.onclick = () => {
    const blob = new Blob([renderReport()], { type: "text/plain" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "fuel-guard-daily-report.txt";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
}

document.addEventListener("click", event => {
  const tipId = event.target.dataset.closeTip;
  if (!tipId) return;

  const tip = document.getElementById(tipId);
  if (tip) tip.remove();
});

renderAll();
