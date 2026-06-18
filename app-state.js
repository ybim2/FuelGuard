const STEP_KEYS = ["pantry", "shopping", "adherence"];

const FORECAST_GROUPS = [
  { key: "meals", label: "Meals" },
  { key: "snacks", label: "Snacks" },
  { key: "supplements", label: "Supplements" },
  { key: "electrolytes", label: "Electrolytes" }
];

const DEFAULT_STATE = {
  completed: {
    gaps: false,
    plan: false,
    pantry: false,
    shopping: false,
    prep: false,
    adherence: false
  },
  forecastConfirmations: {
    meals: false,
    snacks: false,
    supplements: false,
    electrolytes: false
  },
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
    wholeMilk: { label: "Whole Milk", qty: 2000, unit: "ml", dailyUse: 300, group: "supplements" },
    electrolyteTablets: { label: "Electrolyte Tablets", qty: 10, unit: "tablets", dailyUse: 1, group: "electrolytes" },
    electrolyteSachets: { label: "Electrolyte Sachets", qty: 6, unit: "sachets", dailyUse: 0.5, group: "electrolytes" }
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
      forecastConfirmations: { ...defaults.forecastConfirmations, ...(parsed.forecastConfirmations || {}) },
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

    if (!FORECAST_GROUPS.every(group => merged.forecastConfirmations[group.key])) {
      merged.completed.pantry = false;
      merged.completed.shopping = false;
    }

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
    pantry: "Fuel categories confirmed",
    shopping: "Fuel forecast generated",
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

function ensureForecastConfirmations() {
  state.forecastConfirmations = {
    ...DEFAULT_STATE.forecastConfirmations,
    ...(state.forecastConfirmations || {})
  };
  return state.forecastConfirmations;
}

function isForecastCategoryComplete(groupKey) {
  return Boolean(ensureForecastConfirmations()[groupKey]);
}

function allForecastCategoriesConfirmed() {
  const confirmations = ensureForecastConfirmations();
  return FORECAST_GROUPS.every(group => confirmations[group.key]);
}

function nextForecastCategory() {
  const confirmations = ensureForecastConfirmations();
  return FORECAST_GROUPS.find(group => !confirmations[group.key]) || null;
}

function confirmForecastCategory(groupKey) {
  readForecastForm();
  ensureForecastConfirmations()[groupKey] = true;

  if (allForecastCategoriesConfirmed()) {
    state.completed.pantry = true;
    state.completed.shopping = true;
    addAdherence("pantry");
    addAdherence("shopping");
  }

  save();
  renderAll();
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
  return Math.round(((state.completed.pantry ? 100 : 0) + (state.completed.shopping ? 100 : 0)) / 2);
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
