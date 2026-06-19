const STEP_KEYS = ["pantry", "prep", "liveFuelStatus", "nutritionBarriers"];
const FUEL_GREEN_LIMIT_MINUTES = 210;
const FUEL_RED_LIMIT_MINUTES = 300;
const MEAL_PREP_WARNING_DAYS = 5;
const MEAL_PREPARATION_CHECKS = [
  {
    key: "meals",
    label: "Main Meals",
    question: "Are main meals prepared for tomorrow?",
    consequence: "Increased risk of missed meals and under-fuelling.",
    action: "Protect the next 2-4 days with prepared core meals.",
    horizon: "2-4 day batch coverage"
  },
  {
    key: "snacks",
    label: "Snacks",
    question: "Are snacks prepared or packed for tomorrow?",
    consequence: "Increased risk of missed snack windows and under-fuelling.",
    action: "Pack tomorrow's snacks or restock high-turnover snack items.",
    horizon: "Tomorrow coverage"
  },
  {
    key: "shakes",
    label: "Protein Shakes",
    question: "Are protein shake ingredients available?",
    consequence: "Increased risk of missed recovery fuel.",
    action: "Check protein powder, milk and shake ingredients.",
    horizon: "Tomorrow and week-ahead ingredients"
  },
  {
    key: "electrolytes",
    label: "Electrolytes",
    question: "Are electrolytes ready?",
    consequence: "Increased risk of poor training quality.",
    action: "Prepare water and electrolytes for tomorrow.",
    horizon: "Tomorrow coverage"
  },
  {
    key: "backup",
    label: "Emergency Backup",
    question: "Is there an emergency backup food option?",
    consequence: "Increased risk of under-fuelling if the plan breaks.",
    action: "Set one backup food option that can be used immediately.",
    horizon: "Fallback protection"
  }
];

const FORECAST_GROUPS = [
  { key: "meals", label: "Meals" },
  { key: "snacks", label: "Snacks" },
  { key: "supplements", label: "Supplements" },
  { key: "electrolytes", label: "Electrolytes" }
];

const OPTIONAL_FORECAST_GROUPS = [
  { key: "shakes", label: "Shakes" },
  { key: "uncategorised", label: "Uncategorised" }
];

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function compact(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function forecastGroupOptions() {
  return [...FORECAST_GROUPS, ...OPTIONAL_FORECAST_GROUPS];
}

function normalizeForecastCategory(category) {
  const raw = String(category || "").trim();
  const value = compact(raw);
  if (!value) return "uncategorised";

  const direct = forecastGroupOptions().find(group => value === compact(group.key) || value === compact(group.label));
  if (direct) return direct.key;
  if (value.includes("meal")) return "meals";
  if (value.includes("snack")) return "snacks";
  if (value.includes("shake") || value.includes("smoothie")) return "shakes";
  if (value.includes("supplement") || value.includes("proteinpowder")) return "supplements";
  if (value.includes("electrolyte")) return "electrolytes";
  return "uncategorised";
}

function labelForForecastGroup(groupKey) {
  return forecastGroupOptions().find(group => group.key === groupKey)?.label || "Uncategorised";
}

function forecastGroupsForPantry(pantry) {
  const source = pantry || (typeof state !== "undefined" ? state.pantry : {});
  const groups = [...FORECAST_GROUPS];
  const seen = new Set(groups.map(group => group.key));

  Object.values(source || {}).forEach(item => {
    const groupKey = normalizeForecastCategory(item.group);
    if (!seen.has(groupKey)) {
      groups.push({ key: groupKey, label: labelForForecastGroup(groupKey) });
      seen.add(groupKey);
    }
  });

  return groups;
}

const DEFAULT_STATE = {
  completed: {
    gaps: false,
    plan: false,
    pantry: false,
    shopping: false,
    liveFuelStatus: false,
    nutritionBarriers: false,
    prep: false,
    adherence: false,
    report: false
  },
  forecastConfirmations: {
    meals: false,
    snacks: false,
    supplements: false,
    electrolytes: false
  },
  fuelInfoConfirmed: false,
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
  nutritionBarriers: {
    logs: [],
    insightWindowWeeks: 4
  },
  mealPrep: {
    resolvedDate: "",
    snackPrepDate: "",
    notYetDate: "",
    checks: {
      meals: "",
      snacks: "",
      shakes: "",
      electrolytes: "",
      backup: ""
    },
    notYetChecks: {
      meals: "",
      snacks: "",
      shakes: "",
      electrolytes: "",
      backup: ""
    }
  },
  fuelGap: {
    logs: []
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
      nutritionBarriers: {
        ...defaults.nutritionBarriers,
        ...(parsed.nutritionBarriers || {}),
        logs: parsed.nutritionBarriers?.logs || []
      },
      mealPrep: { ...defaults.mealPrep, ...(parsed.mealPrep || {}) },
      fuelGap: {
        ...defaults.fuelGap,
        ...(parsed.fuelGap || {}),
        logs: parsed.fuelGap?.logs || []
      },
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

    if (!forecastGroupsForPantry(merged.pantry).every(group => merged.forecastConfirmations[group.key])) {
      merged.completed.pantry = false;
      merged.completed.shopping = false;
      merged.fuelInfoConfirmed = false;
    }
    if (!merged.fuelInfoConfirmed) merged.completed.pantry = false;

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

function todayKey(date = new Date()) {
  const localDate = new Date(date);
  return [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, "0"),
    String(localDate.getDate()).padStart(2, "0")
  ].join("-");
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function fuelGapState() {
  state.fuelGap = {
    ...DEFAULT_STATE.fuelGap,
    ...(state.fuelGap || {})
  };

  if (!Array.isArray(state.fuelGap.logs)) state.fuelGap.logs = [];
  return state.fuelGap;
}

function fuelLogDate(log) {
  const date = new Date(log.timestamp || log.date || log);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClock(date) {
  if (!date) return "--";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function todaysFuelLogs(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return fuelGapState().logs
    .map(log => ({ ...log, date: fuelLogDate(log) }))
    .filter(log => log.date && log.date >= start && log.date < end)
    .sort((a, b) => a.date - b.date);
}

function lastFuelLog() {
  return fuelGapState().logs
    .map(log => ({ ...log, date: fuelLogDate(log) }))
    .filter(log => log.date)
    .sort((a, b) => b.date - a.date)[0] || null;
}

function minutesSinceLastFuel(now = new Date()) {
  const last = lastFuelLog();
  if (!last) return Infinity;
  return Math.max(0, (now - last.date) / 60000);
}

function fuelGapStatus(minutes) {
  if (!Number.isFinite(minutes)) return "red";
  if (minutes < FUEL_GREEN_LIMIT_MINUTES) return "green";
  if (minutes < FUEL_RED_LIMIT_MINUTES) return "amber";
  return "red";
}

function fuelGapSnapshot(now = new Date()) {
  const last = lastFuelLog();
  const elapsedMinutes = minutesSinceLastFuel(now);
  const status = fuelGapStatus(elapsedMinutes);

  return {
    lastFuelled: last ? formatClock(last.date) : "No fuel logged",
    timeSinceFuel: Number.isFinite(elapsedMinutes) ? duration(elapsedMinutes) : "No fuel logged",
    status,
    nextAction: status === "red"
      ? "RED - fuel gap too long. Eat a quick available option within 30 minutes."
      : ""
  };
}

function fuelGapDurationsToday(now = new Date()) {
  const logs = todaysFuelLogs(now);
  const gaps = [];

  for (let index = 1; index < logs.length; index += 1) {
    gaps.push((logs[index].date - logs[index - 1].date) / 60000);
  }

  if (logs.length) gaps.push((now - logs[logs.length - 1].date) / 60000);
  return gaps.filter(gap => Number.isFinite(gap) && gap >= 0);
}

function fuelGapInsight(now = new Date()) {
  const logs = todaysFuelLogs(now);
  const gaps = fuelGapDurationsToday(now);

  return {
    longestGap: gaps.length ? Math.max(...gaps) : 0,
    confirmations: logs.length,
    highRiskGaps: gaps.filter(gap => gap >= FUEL_RED_LIMIT_MINUTES).length
  };
}

function recordFuelled() {
  fuelGapState().logs.push({
    id: uid(),
    timestamp: new Date().toISOString(),
    label: "Fuelled"
  });
  state.completed.liveFuelStatus = true;
  addAdherence("liveFuelStatus");
  save();
  renderAll();
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

function calculatedNextShopDays() {
  const finiteRunways = Object.values(state.pantry)
    .map(item => {
      const stock = Number(item.qty || 0);
      const burn = Number(item.dailyUse || 0);
      return burn > 0 ? stock / burn : Infinity;
    })
    .filter(Number.isFinite);

  if (!finiteRunways.length) return null;
  return Math.max(0, Math.min(...finiteRunways));
}

function calculatedNextShopDate() {
  const days = calculatedNextShopDays();
  return days === null ? null : addDays(days);
}

function daysToNextShop() {
  const days = calculatedNextShopDays();
  return days === null ? null : Math.ceil(days);
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
  return STEP_KEYS.filter(key => isStepComplete(key)).length;
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
    pantry: "Fuel confirmation completed",
    liveFuelStatus: "Live fuel status completed",
    prep: "Fuel availability confirmed",
    nutritionBarriers: "Nutrition barriers completed",
    shopping: "Fuel forecast reviewed",
    adherence: "Body and mind logged",
    report: "Download report completed"
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

  forecastGroupsForPantry().forEach(group => {
    if (typeof state.forecastConfirmations[group.key] !== "boolean") {
      state.forecastConfirmations[group.key] = false;
    }
  });

  return state.forecastConfirmations;
}

function isForecastCategoryComplete(groupKey) {
  return Boolean(ensureForecastConfirmations()[groupKey]);
}

function allForecastCategoriesConfirmed() {
  const confirmations = ensureForecastConfirmations();
  return forecastGroupsForPantry().every(group => confirmations[group.key]);
}

function nextForecastCategory() {
  const confirmations = ensureForecastConfirmations();
  return forecastGroupsForPantry().find(group => !confirmations[group.key]) || null;
}

function confirmForecastCategory(groupKey) {
  readForecastForm();
  ensureForecastConfirmations()[groupKey] = true;
  resetFuelInfoConfirmation();

  save();
  renderAll();
}

function resetFuelInfoConfirmation() {
  state.fuelInfoConfirmed = false;
  state.completed.pantry = false;
  state.completed.prep = false;
}

function resetPantryDependentState() {
  resetFuelInfoConfirmation();
  state.completed.shopping = false;
  state.completed.report = false;
}

function clearForecastCategory(groupKey) {
  const normalizedGroup = normalizeForecastCategory(groupKey);
  let removedCount = 0;

  Object.entries(state.pantry).forEach(([key, item]) => {
    if (normalizeForecastCategory(item.group || "meals") === normalizedGroup) {
      delete state.pantry[key];
      removedCount += 1;
    }
  });

  ensureForecastConfirmations()[normalizedGroup] = false;
  resetPantryDependentState();
  save();
  renderAll();
  return removedCount;
}

function clearWholePantry() {
  state.pantry = {};
  state.forecastConfirmations = {};
  resetPantryDependentState();
  save();
  renderAll();
}

function forecastStatus(daysUntilRunOut) {
  if (daysUntilRunOut <= 2) return "red";
  if (!Number.isFinite(daysUntilRunOut)) return "green";
  if (daysUntilRunOut <= 5) return "amber";
  return "green";
}

function forecastAction(row) {
  if (row.status === "red") return `Shop before ${row.runOutShortDate} or reduce daily use.`;
  if (row.status === "amber") return `Plan to shop by ${row.runOutShortDate} or reduce daily use if demand increases.`;
  return `Enough until ${row.runOutShortDate}. Keep monitoring.`;
}

function forecastRows() {
  return Object.entries(state.pantry).map(([key, item]) => {
    const currentStock = Number(item.qty || 0);
    const dailyBurnRate = Number(item.dailyUse || 0);
    const daysUntilRunOut = dailyBurnRate > 0 ? currentStock / dailyBurnRate : Infinity;
    const runOutDate = Number.isFinite(daysUntilRunOut) ? addDays(daysUntilRunOut) : null;
    const status = forecastStatus(daysUntilRunOut);
    const row = {
      key,
      label: item.label,
      unit: item.unit,
      group: normalizeForecastCategory(item.group || "meals"),
      imported: Boolean(item.imported),
      notes: item.notes || "",
      dailyUseUnit: item.dailyUseUnit || (item.imported ? "grams/day" : "per day"),
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

function mealPrepState() {
  state.mealPrep = {
    ...DEFAULT_STATE.mealPrep,
    ...(state.mealPrep || {})
  };
  state.mealPrep.checks = {
    ...DEFAULT_STATE.mealPrep.checks,
    ...(state.mealPrep.checks || {})
  };
  state.mealPrep.notYetChecks = {
    ...DEFAULT_STATE.mealPrep.notYetChecks,
    ...(state.mealPrep.notYetChecks || {})
  };

  const key = todayKey();
  if (state.mealPrep.resolvedDate === key) {
    MEAL_PREPARATION_CHECKS.forEach(check => {
      if (!state.mealPrep.checks[check.key]) state.mealPrep.checks[check.key] = key;
    });
  }
  if (state.mealPrep.snackPrepDate === key && !state.mealPrep.checks.snacks) {
    state.mealPrep.checks.snacks = key;
  }

  return state.mealPrep;
}

function mealPreparationCheckComplete(checkKey) {
  return mealPrepState().checks?.[checkKey] === todayKey();
}

function mealPrepResolvedToday() {
  return MEAL_PREPARATION_CHECKS.every(check => mealPreparationCheckComplete(check.key));
}

function snackPrepConfirmedToday() {
  return mealPreparationCheckComplete("snacks");
}

function isStepComplete(key) {
  if (key === "pantry") return Boolean(state.fuelInfoConfirmed);
  if (key === "prep") return mealPrepResolvedToday();
  return Boolean(state.completed[key]);
}

function mealPrepRiskRows() {
  const warningGroups = new Set(["meals", "snacks", "shakes", "supplements", "electrolytes"]);

  return forecastRows()
    .filter(row => warningGroups.has(row.group))
    .filter(row => Number.isFinite(row.daysUntilRunOut) && row.daysUntilRunOut <= MEAL_PREP_WARNING_DAYS)
    .sort((a, b) => a.daysUntilRunOut - b.daysUntilRunOut);
}

function mealPrepConsequence(row) {
  if (row.group === "meals") return "Increased risk of missed meals and under-fuelling.";
  if (row.group === "snacks") return "Increased risk of missed snack windows and under-fuelling.";
  if (row.group === "electrolytes") return "Increased risk of poor training quality.";
  return "Increased risk of under-fuelling and poor training quality.";
}

function mealPrepAction(row) {
  if (row.group === "meals") {
    return row.daysUntilRunOut <= 2
      ? "Prepare core meals before tomorrow."
      : `Prepare core meals before ${row.runOutShortDate}.`;
  }

  if (row.group === "snacks") {
    return row.daysUntilRunOut <= 2
      ? `Prep snacks for today and restock ${row.label} before ${row.runOutShortDate}.`
      : `Restock or prep ${row.label} before ${row.runOutShortDate}.`;
  }

  if (row.group === "electrolytes") {
    return `Restock electrolytes before ${row.runOutShortDate}.`;
  }

  return `Restock or prep ${row.label} before ${row.runOutShortDate}.`;
}

function mealPrepWarningSnapshot() {
  const prep = mealPrepState();
  const riskRows = mealPrepRiskRows();
  const resolvedToday = mealPrepResolvedToday();
  const checks = MEAL_PREPARATION_CHECKS.map(check => ({
    ...check,
    complete: mealPreparationCheckComplete(check.key),
    notYetToday: prep.notYetChecks?.[check.key] === todayKey()
  }));
  const incompleteChecks = checks.filter(check => !check.complete);
  const active = incompleteChecks.length > 0;
  const severity = active ? "red" : "green";

  state.completed.prep = resolvedToday;
  prep.resolvedDate = resolvedToday ? todayKey() : "";

  return {
    active,
    severity,
    resolvedToday,
    checks,
    incompleteChecks,
    statusLabel: active ? "Coverage incomplete" : "System Stable",
    prepStatus: active ? "Coverage unresolved" : "Tomorrow protected",
    warningLabel: active ? "ACTION REQUIRED" : "SYSTEM STABLE",
    riskRows: riskRows.map(row => ({
      ...row,
      consequence: mealPrepConsequence(row),
      actionRequired: mealPrepAction(row)
    }))
  };
}

function confirmMealPrepComplete() {
  const prep = mealPrepState();
  const key = todayKey();
  MEAL_PREPARATION_CHECKS.forEach(check => {
    prep.checks[check.key] = key;
    prep.notYetChecks[check.key] = "";
  });
  prep.resolvedDate = key;
  prep.snackPrepDate = key;
  prep.notYetDate = "";
  state.completed.prep = true;
  addAdherence("prep");
  save();
  renderAll();
}

function markMealPrepNotYet() {
  const prep = mealPrepState();
  prep.notYetDate = todayKey();
  prep.resolvedDate = "";
  state.completed.prep = false;
  save();
  renderAll();
}

function confirmMealPreparationItem(checkKey) {
  const prep = mealPrepState();
  const normalizedKey = String(checkKey || "");
  if (!MEAL_PREPARATION_CHECKS.some(check => check.key === normalizedKey)) return;

  prep.checks[normalizedKey] = todayKey();
  prep.notYetChecks[normalizedKey] = "";
  if (normalizedKey === "snacks") prep.snackPrepDate = todayKey();
  if (normalizedKey === "electrolytes") {
    prep.checks.hydration = "";
    prep.notYetChecks.hydration = "";
  }
  if (mealPrepResolvedToday()) {
    prep.resolvedDate = todayKey();
    state.completed.prep = true;
    addAdherence("prep");
  } else {
    prep.resolvedDate = "";
    state.completed.prep = false;
  }
  save();
  renderAll();
}

function markMealPreparationItemNotYet(checkKey) {
  const prep = mealPrepState();
  const normalizedKey = String(checkKey || "");
  if (!MEAL_PREPARATION_CHECKS.some(check => check.key === normalizedKey)) return;

  prep.checks[normalizedKey] = "";
  prep.notYetChecks[normalizedKey] = todayKey();
  if (normalizedKey === "snacks") prep.snackPrepDate = "";
  if (normalizedKey === "electrolytes") prep.checks.hydration = "";
  prep.resolvedDate = "";
  state.completed.prep = false;
  save();
  renderAll();
}

function foodRunoutDays() {
  const burnRows = forecastRows().filter(row => Number.isFinite(row.daysUntilRunOut));
  if (!burnRows.length) return Infinity;
  return Math.min(...burnRows.map(row => row.daysUntilRunOut));
}

function proactivityScore() {
  const runway = foodRunoutDays();
  if (!Number.isFinite(runway)) return 100;
  if (runway > 7) return 100;
  if (runway > 3) return 65;
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
