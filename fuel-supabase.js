// Fuel Guard Supabase Auth and cloud log sync.
(() => {
  const TABLE = "fuel_logs";
  const TARGETS_TABLE = "fuel_targets";
  const DEMAND_BLOCKS_TABLE = "fuel_demand_blocks";
  const WORK_BREAKS_TABLE = "fuel_work_breaks";
  const STATUS_EVENT = "fuelguard:cloud-status";
  const SYNCED = "synced";
  const PENDING = "pending";
  const ERROR = "error";
  const ALLOWED_TYPES = new Set(["fuel", "hydration", "fuel_hydration"]);
  const ALLOWED_SOURCES = new Set(["manual", "csv_import", "hardware", "bluetooth"]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const CRASH_NOTE = "fuel_guard_event:crash";

  let client = null;
  let session = null;
  let initialized = false;
  let syncInProgress = false;
  let recoveryMode = false;
  let lastStatus = "Cloud sync is not configured yet.";

  function config() {
    return window.FUEL_GUARD_SUPABASE_CONFIG || {};
  }

  function configured() {
    const next = config();
    return Boolean(next.url && next.anonKey && window.supabase?.createClient);
  }

  function user() {
    return session?.user || null;
  }

  function status(message) {
    lastStatus = message;
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { message } }));
  }

  function recoveryRedirectUrl() {
    return `${window.location.origin}/?auth=recovery`;
  }

  function urlRequestsRecovery() {
    const queryRequestsRecovery = new URLSearchParams(window.location.search).get("auth") === "recovery";
    const hashRequestsRecovery = /(?:^|[&#?])(?:type|auth)=recovery(?:$|[&#=])/.test(window.location.hash || "");
    return queryRequestsRecovery || hashRequestsRecovery;
  }

  function cleanRecoveryUrl() {
    if (!window.history?.replaceState) return;
    window.history.replaceState({}, document.title, `${window.location.origin}${window.location.pathname || "/"}`);
  }

  function setRecoveryMode(active, message) {
    recoveryMode = Boolean(active);
    if (message) status(message);
    window.dispatchEvent(new CustomEvent("fuelguard:password-recovery", { detail: { active: recoveryMode } }));
    if (typeof renderAll === "function") renderAll();
  }

  function gapState() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    if (!gap) return null;
    if (!gap.cloud || typeof gap.cloud !== "object" || Array.isArray(gap.cloud)) {
      gap.cloud = {
        pendingDeleteIds: [],
        pendingDemandDeleteIds: [],
        pendingWorkBreakDeleteIds: [],
        lastSyncedAt: "",
        lastError: ""
      };
    }
    if (!Array.isArray(gap.cloud.pendingDeleteIds)) gap.cloud.pendingDeleteIds = [];
    if (!Array.isArray(gap.cloud.pendingDemandDeleteIds)) gap.cloud.pendingDemandDeleteIds = [];
    if (!Array.isArray(gap.cloud.pendingWorkBreakDeleteIds)) gap.cloud.pendingWorkBreakDeleteIds = [];
    if (!Array.isArray(gap.demandBlocks)) gap.demandBlocks = [];
    if (!Array.isArray(gap.workBreaks)) gap.workBreaks = [];
    return gap;
  }

  function persistAndRender() {
    if (typeof save === "function") save();
    if (typeof renderAll === "function") renderAll();
  }

  function isOnline() {
    return navigator.onLine !== false;
  }

  function isUuid(value) {
    return UUID_RE.test(String(value || ""));
  }

  function normalizeType(value) {
    const next = String(value || "fuel").toLowerCase();
    return ALLOWED_TYPES.has(next) ? next : "fuel";
  }

  function isCrashLog(log) {
    return String(log?.type || "").toLowerCase() === "crash"
      || String(log?.note || log?.notes || "").includes(CRASH_NOTE);
  }

  function normalizeSource(value) {
    const next = String(value || "manual").toLowerCase();
    return ALLOWED_SOURCES.has(next) ? next : "manual";
  }

  function dateFromLog(log) {
    const date = typeof fuelLogDate === "function" ? fuelLogDate(log) : new Date(log?.timestamp || log?.date);
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function timestampForRow(row) {
    const date = dateFromLog({
      timestamp: row?.logged_at,
      logged_at: row?.logged_at,
      created_at: row?.created_at
    });
    return date ? date.toISOString() : "";
  }

  function rowFingerprint(row) {
    const timestamp = timestampForRow(row);
    if (!timestamp) return "";
    return [
      timestamp,
      normalizeType(row?.type),
      normalizeSource(row?.source),
      row?.day_type || "",
      row?.training_session || "",
      row?.notes || ""
    ].join("|");
  }

  function logFingerprint(log) {
    const date = dateFromLog(log);
    if (!date) return "";
    return [
      date.toISOString(),
      normalizeType(log?.type),
      normalizeSource(log?.source),
      log?.dayType || "",
      log?.trainingSession || "",
      log?.note || log?.notes || ""
    ].join("|");
  }

  function sameInstant(log, row) {
    const localDate = dateFromLog(log);
    const rowTimestamp = timestampForRow(row);
    if (!localDate || !rowTimestamp) return false;
    return localDate.toISOString() === rowTimestamp;
  }

  function labelForType(type) {
    if (type === "crash") return "Low energy event";
    if (type === "hydration") return "Hydration logged";
    if (type === "fuel_hydration") return "Fuel + hydration logged";
    return "Fuelled";
  }

  function rowToLog(row) {
    const timestamp = timestampForRow(row);
    if (!timestamp) return null;
    const crash = String(row.notes || "").includes(CRASH_NOTE);
    const type = crash ? "crash" : normalizeType(row.type);
    return {
      id: row.id,
      cloudId: row.id,
      timestamp,
      label: labelForType(type),
      type,
      source: normalizeSource(row.source),
      dayType: row.day_type || "",
      trainingSession: row.training_session || "",
      note: row.notes || "",
      syncStatus: SYNCED
    };
  }

  function rowForLog(log, currentUser) {
    const date = dateFromLog(log);
    if (!date || !currentUser?.id) return null;

    const id = isUuid(log.cloudId || log.id) ? String(log.cloudId || log.id) : "";
    const crash = isCrashLog(log);
    const row = {
      user_id: currentUser.id,
      logged_at: date.toISOString(),
      type: crash ? "fuel" : normalizeType(log.type),
      source: normalizeSource(log.source),
      day_type: log.dayType || null,
      training_session: log.trainingSession || null,
      notes: crash ? CRASH_NOTE : log.note || log.notes || null
    };
    if (id) row.id = id;
    return row;
  }

  function setLogSyncState(log, syncStatus) {
    if (!log || typeof log !== "object") return log;
    log.syncStatus = syncStatus;
    return log;
  }

  function allLogs() {
    const gap = gapState();
    if (!gap) return [];
    if (!Array.isArray(gap.logs)) gap.logs = [];
    return gap.logs;
  }


  function targetNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }

  function targetsState() {
    const gap = gapState();
    if (!gap) return null;
    if (!gap.targets || typeof gap.targets !== "object" || Array.isArray(gap.targets)) gap.targets = {};
    ["dailyFuelLogs", "dailyHydrationLogs", "weeklyFuelLogs", "weeklyHydrationLogs"].forEach(key => {
      gap.targets[key] = targetNumber(gap.targets[key]);
    });
    gap.targets.updatedAt = String(gap.targets.updatedAt || "");
    return gap.targets;
  }

  function planningState() {
    const gap = gapState();
    if (!gap) return null;
    if (!Array.isArray(gap.demandBlocks)) gap.demandBlocks = [];
    if (!Array.isArray(gap.workBreaks)) gap.workBreaks = [];
    if (!Array.isArray(gap.cloud.pendingDemandDeleteIds)) gap.cloud.pendingDemandDeleteIds = [];
    if (!Array.isArray(gap.cloud.pendingWorkBreakDeleteIds)) gap.cloud.pendingWorkBreakDeleteIds = [];
    return gap;
  }

  function parsePlanningDate(value) {
    const date = value instanceof Date ? value : new Date(value || "");
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function planningDateKey(value) {
    if (typeof todayKey !== "function") return "";
    const date = parsePlanningDate(value);
    return date ? todayKey(date) : "";
  }

  function isoForPlanning(value) {
    const date = parsePlanningDate(value);
    return date ? date.toISOString() : "";
  }

  function demandBlockRowFromState(block, currentUser) {
    if (!block || !currentUser?.id) return null;
    const start = isoForPlanning(block.startTime);
    const end = isoForPlanning(block.endTime);
    const type = String(block.type || "");
    if (!start || !end || !["training", "work"].includes(type)) return null;
    const id = isUuid(block.cloudId || block.id) ? String(block.cloudId || block.id) : "";
    const row = {
      user_id: currentUser.id,
      date: block.date || planningDateKey(start),
      type,
      start_time: start,
      end_time: end,
      title: block.title || null,
      session_type: type === "training" ? block.sessionType || null : null,
      intensity: type === "training" ? block.intensity || null : null,
      is_key_session: Boolean(type === "training" && block.isKeySession),
      shift_name: type === "work" ? block.shiftName || block.title || null : null,
      notes: block.notes || null,
      updated_at: block.updatedAt || new Date().toISOString()
    };
    if (id) row.id = id;
    return row;
  }

  function workBreakRowFromState(item, currentUser) {
    const gap = planningState();
    if (!item || !currentUser?.id || !gap) return null;
    const parent = gap.demandBlocks.find(block => {
      const ids = [block.id, block.cloudId].filter(Boolean).map(String);
      return ids.includes(String(item.demandBlockId || ""));
    });
    const demandBlockId = parent?.cloudId || parent?.id || item.demandBlockId || "";
    const start = isoForPlanning(item.startTime);
    const end = isoForPlanning(item.endTime);
    if (!start || !end || !isUuid(demandBlockId)) return null;
    const id = isUuid(item.cloudId || item.id) ? String(item.cloudId || item.id) : "";
    const row = {
      user_id: currentUser.id,
      demand_block_id: demandBlockId,
      start_time: start,
      end_time: end,
      label: item.label || null,
      updated_at: item.updatedAt || new Date().toISOString()
    };
    if (id) row.id = id;
    return row;
  }

  function rowToDemandBlock(row) {
    if (!row?.id) return null;
    return {
      id: row.id,
      cloudId: row.id,
      userId: row.user_id || "",
      date: row.date || planningDateKey(row.start_time),
      type: row.type,
      startTime: row.start_time,
      endTime: row.end_time,
      title: row.title || "",
      sessionType: row.session_type || "",
      intensity: row.intensity || "",
      isKeySession: Boolean(row.is_key_session),
      shiftName: row.shift_name || "",
      notes: row.notes || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || row.created_at || "",
      syncStatus: SYNCED
    };
  }

  function rowToWorkBreak(row) {
    if (!row?.id || !row?.demand_block_id) return null;
    return {
      id: row.id,
      cloudId: row.id,
      userId: row.user_id || "",
      demandBlockId: row.demand_block_id,
      startTime: row.start_time,
      endTime: row.end_time,
      label: row.label || "",
      createdAt: row.created_at || "",
      updatedAt: row.updated_at || row.created_at || "",
      syncStatus: SYNCED
    };
  }

  function updateLocalDemandBlockFromRow(block, row) {
    const gap = planningState();
    if (!block || !row || !gap) return;
    const previousIds = [block.id, block.cloudId].filter(Boolean).map(String);
    Object.assign(block, rowToDemandBlock(row));
    gap.workBreaks.forEach(item => {
      if (previousIds.includes(String(item.demandBlockId || ""))) item.demandBlockId = row.id;
    });
  }

  function updateLocalWorkBreakFromRow(item, row) {
    if (!item || !row) return;
    Object.assign(item, rowToWorkBreak(row));
  }

  function planningRowsMatchTimes(row, item) {
    return isoForPlanning(row.start_time) === isoForPlanning(item.startTime)
      && isoForPlanning(row.end_time) === isoForPlanning(item.endTime);
  }

  function findMatchingDemandBlock(row, fallbackBlock) {
    const gap = planningState();
    if (!gap) return null;
    const ids = [row?.id, fallbackBlock?.id, fallbackBlock?.cloudId].filter(Boolean).map(String);
    return gap.demandBlocks.find(block => ids.includes(String(block.id || "")) || ids.includes(String(block.cloudId || "")))
      || gap.demandBlocks.find(block => block.type === row.type && block.date === row.date && planningRowsMatchTimes(row, block));
  }

  function findMatchingWorkBreak(row, fallbackItem) {
    const gap = planningState();
    if (!gap) return null;
    const ids = [row?.id, fallbackItem?.id, fallbackItem?.cloudId].filter(Boolean).map(String);
    return gap.workBreaks.find(item => ids.includes(String(item.id || "")) || ids.includes(String(item.cloudId || "")))
      || gap.workBreaks.find(item => String(item.demandBlockId || "") === String(row.demand_block_id || "") && planningRowsMatchTimes(row, item));
  }

  function demandPlanningTableMissing(error) {
    const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toLowerCase();
    return text.includes("42p01")
      || text.includes("pgrst205")
      || text.includes("schema cache")
      || text.includes("does not exist");
  }

  async function flushDemandPlanningDeletes() {
    const gap = planningState();
    const currentUser = user();
    if (!client || !currentUser || !gap) return;
    const breakIds = [...new Set(gap.cloud.pendingWorkBreakDeleteIds.filter(isUuid))];
    if (breakIds.length) {
      const { error } = await client
        .from(WORK_BREAKS_TABLE)
        .delete()
        .eq("user_id", currentUser.id)
        .in("id", breakIds);
      if (error) throw error;
      gap.cloud.pendingWorkBreakDeleteIds = gap.cloud.pendingWorkBreakDeleteIds.filter(id => !breakIds.includes(id));
    }

    const blockIds = [...new Set(gap.cloud.pendingDemandDeleteIds.filter(isUuid))];
    if (blockIds.length) {
      const { error } = await client
        .from(DEMAND_BLOCKS_TABLE)
        .delete()
        .eq("user_id", currentUser.id)
        .in("id", blockIds);
      if (error) throw error;
      gap.cloud.pendingDemandDeleteIds = gap.cloud.pendingDemandDeleteIds.filter(id => !blockIds.includes(id));
    }
  }

  async function upsertDemandBlocks() {
    const gap = planningState();
    const currentUser = user();
    if (!client || !currentUser || !gap) return [];
    const rows = gap.demandBlocks
      .map(block => ({ block, row: demandBlockRowFromState(block, currentUser) }))
      .filter(item => item.row);
    if (!rows.length) return [];

    const withId = rows.filter(item => item.row.id);
    const withoutId = rows.filter(item => !item.row.id);
    const savedRows = [];
    const selectColumns = "id,user_id,date,type,start_time,end_time,title,session_type,intensity,is_key_session,shift_name,notes,created_at,updated_at";

    if (withId.length) {
      const { data, error } = await client
        .from(DEMAND_BLOCKS_TABLE)
        .upsert(withId.map(item => item.row), { onConflict: "id" })
        .select(selectColumns);
      if (error) throw error;
      (data || []).forEach((row, index) => {
        updateLocalDemandBlockFromRow(withId[index]?.block || findMatchingDemandBlock(row), row);
        savedRows.push(row);
      });
    }

    if (withoutId.length) {
      const { data, error } = await client
        .from(DEMAND_BLOCKS_TABLE)
        .insert(withoutId.map(item => item.row))
        .select(selectColumns);
      if (error) throw error;
      (data || []).forEach((row, index) => {
        updateLocalDemandBlockFromRow(withoutId[index]?.block || findMatchingDemandBlock(row), row);
        savedRows.push(row);
      });
    }

    return savedRows;
  }

  async function upsertWorkBreaks() {
    const gap = planningState();
    const currentUser = user();
    if (!client || !currentUser || !gap) return [];
    const rows = gap.workBreaks
      .map(item => ({ item, row: workBreakRowFromState(item, currentUser) }))
      .filter(item => item.row);
    if (!rows.length) return [];

    const withId = rows.filter(item => item.row.id);
    const withoutId = rows.filter(item => !item.row.id);
    const savedRows = [];
    const selectColumns = "id,user_id,demand_block_id,start_time,end_time,label,created_at,updated_at";

    if (withId.length) {
      const { data, error } = await client
        .from(WORK_BREAKS_TABLE)
        .upsert(withId.map(item => item.row), { onConflict: "id" })
        .select(selectColumns);
      if (error) throw error;
      (data || []).forEach((row, index) => {
        updateLocalWorkBreakFromRow(withId[index]?.item || findMatchingWorkBreak(row), row);
        savedRows.push(row);
      });
    }

    if (withoutId.length) {
      const { data, error } = await client
        .from(WORK_BREAKS_TABLE)
        .insert(withoutId.map(item => item.row))
        .select(selectColumns);
      if (error) throw error;
      (data || []).forEach((row, index) => {
        updateLocalWorkBreakFromRow(withoutId[index]?.item || findMatchingWorkBreak(row), row);
        savedRows.push(row);
      });
    }

    return savedRows;
  }

  async function fetchDemandPlanningRows() {
    const currentUser = user();
    if (!client || !currentUser) return { blocks: [], breaks: [] };
    const blockColumns = "id,user_id,date,type,start_time,end_time,title,session_type,intensity,is_key_session,shift_name,notes,created_at,updated_at";
    const breakColumns = "id,user_id,demand_block_id,start_time,end_time,label,created_at,updated_at";
    const [blockResult, breakResult] = await Promise.all([
      client.from(DEMAND_BLOCKS_TABLE).select(blockColumns).eq("user_id", currentUser.id).order("start_time", { ascending: true }),
      client.from(WORK_BREAKS_TABLE).select(breakColumns).eq("user_id", currentUser.id).order("start_time", { ascending: true })
    ]);
    if (blockResult.error) throw blockResult.error;
    if (breakResult.error) throw breakResult.error;
    return { blocks: blockResult.data || [], breaks: breakResult.data || [] };
  }

  function mergeDemandPlanningRows(blockRows, breakRows) {
    const gap = planningState();
    if (!gap) return;
    const cloudBlocks = blockRows.map(rowToDemandBlock).filter(Boolean);
    const cloudBreaks = breakRows.map(rowToWorkBreak).filter(Boolean);
    const cloudBlockIds = new Set(cloudBlocks.flatMap(block => [block.id, block.cloudId].filter(Boolean).map(String)));
    const cloudBreakIds = new Set(cloudBreaks.flatMap(item => [item.id, item.cloudId].filter(Boolean).map(String)));
    const pendingBlocks = gap.demandBlocks.filter(block => {
      const ids = [block.id, block.cloudId].filter(Boolean).map(String);
      return !ids.some(id => cloudBlockIds.has(id)) && block.syncStatus !== SYNCED;
    });
    const pendingBreaks = gap.workBreaks.filter(item => {
      const ids = [item.id, item.cloudId].filter(Boolean).map(String);
      return !ids.some(id => cloudBreakIds.has(id)) && item.syncStatus !== SYNCED;
    });
    gap.demandBlocks = [...cloudBlocks, ...pendingBlocks].sort((a, b) => {
      const aDate = parsePlanningDate(a.startTime);
      const bDate = parsePlanningDate(b.startTime);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });
    gap.workBreaks = [...cloudBreaks, ...pendingBreaks].sort((a, b) => {
      const aDate = parsePlanningDate(a.startTime);
      const bDate = parsePlanningDate(b.startTime);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });
  }

  function markDemandPlanningPending() {
    const gap = planningState();
    if (!gap) return;
    gap.demandBlocks.forEach(block => {
      if (block.syncStatus !== SYNCED) block.syncStatus = PENDING;
    });
    gap.workBreaks.forEach(item => {
      if (item.syncStatus !== SYNCED) item.syncStatus = PENDING;
    });
  }

  async function syncDemandPlanning() {
    if (!client || !user()) return;
    const gap = planningState();
    if (!gap) return;
    await flushDemandPlanningDeletes();
    await upsertDemandBlocks();
    await upsertWorkBreaks();
    const rows = await fetchDemandPlanningRows();
    mergeDemandPlanningRows(rows.blocks, rows.breaks);
    if (typeof window.fuelGuardDemandPlanning?.applyOpportunityMatchesForVisibleDays === "function") {
      window.fuelGuardDemandPlanning.applyOpportunityMatchesForVisibleDays();
    }
  }

  function hasAnyTarget(targets) {
    return Boolean(targets && [
      targets.dailyFuelLogs,
      targets.dailyHydrationLogs,
      targets.weeklyFuelLogs,
      targets.weeklyHydrationLogs
    ].some(value => Number.isInteger(value) && value > 0));
  }

  function targetUpdatedAt(targets) {
    const time = Date.parse(targets?.updatedAt || "");
    return Number.isFinite(time) ? time : 0;
  }

  function targetRowFromState(currentUser) {
    const localTargets = targetsState();
    if (!currentUser?.id || !localTargets) return null;
    return {
      user_id: currentUser.id,
      daily_fuel_logs: targetNumber(localTargets.dailyFuelLogs),
      daily_hydration_logs: targetNumber(localTargets.dailyHydrationLogs),
      weekly_fuel_logs: targetNumber(localTargets.weeklyFuelLogs),
      weekly_hydration_logs: targetNumber(localTargets.weeklyHydrationLogs),
      updated_at: localTargets.updatedAt || new Date().toISOString()
    };
  }

  function applyTargetRow(row) {
    if (!row) return;
    const localTargets = targetsState();
    if (!localTargets) return;
    localTargets.dailyFuelLogs = targetNumber(row.daily_fuel_logs);
    localTargets.dailyHydrationLogs = targetNumber(row.daily_hydration_logs);
    localTargets.weeklyFuelLogs = targetNumber(row.weekly_fuel_logs);
    localTargets.weeklyHydrationLogs = targetNumber(row.weekly_hydration_logs);
    localTargets.updatedAt = row.updated_at || localTargets.updatedAt || "";
  }

  async function fetchTargetRow() {
    const currentUser = user();
    if (!client || !currentUser) return null;
    const { data, error } = await client
      .from(TARGETS_TABLE)
      .select("user_id,daily_fuel_logs,daily_hydration_logs,weekly_fuel_logs,weekly_hydration_logs,updated_at,created_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function upsertTargets() {
    const currentUser = user();
    const row = targetRowFromState(currentUser);
    if (!client || !currentUser || !row) return null;
    const { data, error } = await client
      .from(TARGETS_TABLE)
      .upsert(row, { onConflict: "user_id" })
      .select("user_id,daily_fuel_logs,daily_hydration_logs,weekly_fuel_logs,weekly_hydration_logs,updated_at,created_at")
      .single();
    if (error) throw error;
    applyTargetRow(data);
    return data;
  }

  async function syncTargets() {
    if (!client || !user()) return;
    const localTargets = targetsState();
    const cloudTargets = await fetchTargetRow();
    if (!cloudTargets) {
      if (hasAnyTarget(localTargets) || localTargets?.updatedAt) await upsertTargets();
      return;
    }
    if (targetUpdatedAt(cloudTargets) >= targetUpdatedAt(localTargets)) {
      applyTargetRow(cloudTargets);
      return;
    }
    await upsertTargets();
  }

  function mergeSyncedRows(rows) {
    const gap = gapState();
    if (!gap) return;
    const existingLogs = Array.isArray(gap.logs) ? gap.logs : [];
    const seenCloudKeys = new Set();
    const cloudLogs = [];
    rows.map(rowToLog).filter(Boolean).forEach(log => {
      const cloudKey = isUuid(log.cloudId || log.id) ? `cloud:${log.cloudId || log.id}` : "";
      const fallbackKey = logFingerprint(log);
      if ((cloudKey && seenCloudKeys.has(cloudKey)) || (fallbackKey && seenCloudKeys.has(fallbackKey))) return;
      if (cloudKey) seenCloudKeys.add(cloudKey);
      if (fallbackKey) seenCloudKeys.add(fallbackKey);
      cloudLogs.push(log);
    });
    const pendingLocal = existingLogs.filter(log => {
      if (![PENDING, ERROR].includes(log.syncStatus)) return false;
      const id = log.cloudId || log.id;
      const cloudKey = isUuid(id) ? `cloud:${id}` : "";
      const fallbackKey = logFingerprint(log);
      return !(cloudKey && seenCloudKeys.has(cloudKey)) && !(fallbackKey && seenCloudKeys.has(fallbackKey));
    });

    gap.logs = [...cloudLogs, ...pendingLocal].sort((a, b) => {
      const aDate = dateFromLog(a);
      const bDate = dateFromLog(b);
      return (aDate?.getTime() || 0) - (bDate?.getTime() || 0);
    });
    rebuildDayContextFromLogs(gap);
  }

  function rebuildDayContextFromLogs(gap) {
    if (!gap || typeof todayKey !== "function") return;
    gap.dayTypes = gap.dayTypes && typeof gap.dayTypes === "object" && !Array.isArray(gap.dayTypes) ? gap.dayTypes : {};
    gap.trainingSessions = gap.trainingSessions && typeof gap.trainingSessions === "object" && !Array.isArray(gap.trainingSessions) ? gap.trainingSessions : {};
    gap.logs.forEach(log => {
      const date = dateFromLog(log);
      if (!date) return;
      const key = todayKey(date);
      if (log.dayType && !gap.dayTypes[key]) gap.dayTypes[key] = log.dayType;
      if (log.trainingSession && !gap.trainingSessions[key]) gap.trainingSessions[key] = log.trainingSession;
    });
  }

  function updateLocalLogFromRow(localLog, row) {
    if (!localLog || !row) return;
    localLog.id = row.id;
    localLog.cloudId = row.id;
    localLog.timestamp = timestampForRow(row) || localLog.timestamp;
    localLog.type = String(row.notes || "").includes(CRASH_NOTE) ? "crash" : normalizeType(row.type);
    localLog.label = labelForType(localLog.type);
    localLog.syncStatus = SYNCED;
    localLog.source = normalizeSource(row.source);
    localLog.dayType = row.day_type || localLog.dayType || "";
    localLog.trainingSession = row.training_session || localLog.trainingSession || "";
    localLog.note = row.notes || localLog.note || "";
  }

  function logMatchesRow(log, row) {
    if (!sameInstant(log, row)) return false;
    return logFingerprint(log) === rowFingerprint(row)
      && normalizeType(log.type) === normalizeType(row.type)
      && normalizeSource(log.source) === normalizeSource(row.source)
      && (log.dayType || "") === (row.day_type || "")
      && (log.trainingSession || "") === (row.training_session || "")
      && (log.note || log.notes || "") === (row.notes || "");
  }

  function matchPendingLogsToCloudRows(logs, rows) {
    logs.forEach(log => {
      if (!log || log.syncStatus === SYNCED) return;
      const localId = log.cloudId || log.id;
      const match = rows.find(row => {
        if (isUuid(localId) && row.id === localId && logMatchesRow(log, row)) return true;
        return !isUuid(localId) && logMatchesRow(log, row);
      });
      if (!match) return;
      updateLocalLogFromRow(log, match);
    });
    return logs.filter(log => log.syncStatus !== SYNCED);
  }

  function findMatchingLocalLog(row, fallbackLog) {
    const logs = allLogs();
    const id = row.id;
    const localId = fallbackLog?.id || fallbackLog?.cloudId;
    return logs.find(log => log.id === id || log.cloudId === id || log.id === localId || log.cloudId === localId)
      || logs.find(log => {
        return sameInstant(log, row) && normalizeType(log.type) === normalizeType(row.type);
      });
  }

  async function fetchRows() {
    const currentUser = user();
    if (!client || !currentUser) return [];
    const { data, error } = await client
      .from(TABLE)
      .select("id,user_id,logged_at,type,source,day_type,training_session,notes,created_at")
      .eq("user_id", currentUser.id)
      .order("logged_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function uploadLogs(logs) {
    const currentUser = user();
    if (!client || !currentUser || !logs.length) return [];
    const rows = logs
      .map(log => ({ log, row: rowForLog(log, currentUser) }))
      .filter(item => item.row);
    if (!rows.length) return [];

    const withId = rows.filter(item => item.row.id);
    const withoutId = rows.filter(item => !item.row.id);
    const savedRows = [];

    if (withId.length) {
      const { data, error } = await client
        .from(TABLE)
        .upsert(withId.map(item => item.row), { onConflict: "id" })
        .select("id,user_id,logged_at,type,source,day_type,training_session,notes,created_at");
      if (error) throw error;
      (data || []).forEach((row, index) => {
        updateLocalLogFromRow(withId[index]?.log || findMatchingLocalLog(row), row);
        savedRows.push(row);
      });
    }

    if (withoutId.length) {
      const { data, error } = await client
        .from(TABLE)
        .insert(withoutId.map(item => item.row))
        .select("id,user_id,logged_at,type,source,day_type,training_session,notes,created_at");
      if (error) throw error;
      (data || []).forEach((row, index) => {
        updateLocalLogFromRow(withoutId[index]?.log || findMatchingLocalLog(row), row);
        savedRows.push(row);
      });
    }

    return savedRows;
  }

  async function flushDeletes() {
    const gap = gapState();
    const currentUser = user();
    if (!client || !currentUser || !gap?.cloud.pendingDeleteIds.length) return;
    const ids = [...new Set(gap.cloud.pendingDeleteIds.filter(isUuid))];
    if (!ids.length) {
      gap.cloud.pendingDeleteIds = [];
      return;
    }

    const { error } = await client
      .from(TABLE)
      .delete()
      .eq("user_id", currentUser.id)
      .in("id", ids);
    if (error) throw error;
    gap.cloud.pendingDeleteIds = gap.cloud.pendingDeleteIds.filter(id => !ids.includes(id));
  }

  async function syncNow() {
    if (syncInProgress) return;
    const gap = gapState();
    if (!configured()) {
      status("Cloud sync needs Supabase public URL/key configuration.");
      return;
    }
    if (!user()) {
      status("Not signed in. Logs are cached on this device.");
      return;
    }
    if (!isOnline()) {
      status("Offline. New logs are cached locally and will sync when online.");
      return;
    }

    syncInProgress = true;
    status("Syncing Fuel Guard logs...");
    try {
      await flushDeletes();
      const existingRows = await fetchRows();
      const pending = allLogs().filter(log => log.syncStatus !== SYNCED);
      await uploadLogs(matchPendingLogsToCloudRows(pending, existingRows));
      const rows = await fetchRows();
      mergeSyncedRows(rows);
      let targetWarning = "";
      try {
        await syncTargets();
      } catch (targetError) {
        targetWarning = ` Targets stayed cached locally: ${targetError?.message || "target sync failed"}.`;
      }
      let planningWarning = "";
      try {
        await syncDemandPlanning();
      } catch (planningError) {
        planningWarning = demandPlanningTableMissing(planningError)
          ? " Demand planning stayed cached locally until the Supabase demand-planning SQL is applied."
          : ` Demand planning stayed cached locally: ${planningError?.message || "planning sync failed"}.`;
      }
      if (gap) {
        gap.cloud.lastSyncedAt = new Date().toISOString();
        gap.cloud.lastError = "";
      }
      status(`Synced ${rows.length} cloud log${rows.length === 1 ? "" : "s"}.${targetWarning}${planningWarning}`);
      persistAndRender();
    } catch (error) {
      if (gap) gap.cloud.lastError = error?.message || "Sync failed.";
      allLogs().filter(log => log.syncStatus !== SYNCED).forEach(log => setLogSyncState(log, ERROR));
      status(`Cloud sync failed: ${error?.message || "unknown error"}`);
      if (typeof save === "function") save();
    } finally {
      syncInProgress = false;
    }
  }

  async function saveLog(log) {
    if (!log) return;
    setLogSyncState(log, PENDING);
    if (typeof save === "function") save();
    if (!configured()) {
      status("Log saved locally. Cloud sync needs Supabase public URL/key configuration.");
      return;
    }
    if (!user() || !isOnline()) {
      status(user() ? "Offline. Log cached for later sync." : "Log saved locally. Sign in to sync.");
      return;
    }

    try {
      const rows = await uploadLogs([log]);
      if (rows.length) status("Log saved to Supabase.");
      persistAndRender();
    } catch (error) {
      setLogSyncState(log, ERROR);
      status(`Log saved locally. Supabase sync failed: ${error?.message || "unknown error"}`);
      if (typeof save === "function") save();
    }
  }

  function syncLogsForDay(key) {
    const logs = allLogs().filter(log => {
      const date = dateFromLog(log);
      return date && typeof todayKey === "function" && todayKey(date) === key;
    });
    logs.forEach(log => {
      if (log.syncStatus === SYNCED) log.syncStatus = PENDING;
    });
    return syncNow();
  }

  async function deleteLog(log) {
    const id = log?.cloudId || log?.id;
    if (!isUuid(id)) return;
    const gap = gapState();
    if (!configured() || !user() || !isOnline()) {
      if (gap && !gap.cloud.pendingDeleteIds.includes(id)) gap.cloud.pendingDeleteIds.push(id);
      status("Delete cached locally and will sync when online.");
      if (typeof save === "function") save();
      return;
    }

    try {
      const { error } = await client.from(TABLE).delete().eq("id", id).eq("user_id", user().id);
      if (error) throw error;
      status("Log deleted from Supabase.");
    } catch (error) {
      if (gap && !gap.cloud.pendingDeleteIds.includes(id)) gap.cloud.pendingDeleteIds.push(id);
      status(`Delete cached locally. Supabase delete failed: ${error?.message || "unknown error"}`);
      if (typeof save === "function") save();
    }
  }

  async function clearCloudLogs() {
    const currentUser = user();
    const gap = gapState();
    const ids = allLogs().map(log => log.cloudId || log.id).filter(isUuid);
    if (!configured() || !currentUser) return;
    if (!isOnline()) {
      ids.forEach(id => {
        if (gap && !gap.cloud.pendingDeleteIds.includes(id)) gap.cloud.pendingDeleteIds.push(id);
      });
      status("Cloud clear queued until this device is online.");
      return;
    }

    const { error } = await client.from(TABLE).delete().eq("user_id", currentUser.id);
    if (error) {
      ids.forEach(id => {
        if (gap && !gap.cloud.pendingDeleteIds.includes(id)) gap.cloud.pendingDeleteIds.push(id);
      });
      throw error;
    }
    status("Cloud logs cleared.");
  }

  async function signIn(email, password) {
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    session = data.session;
    status(`Signed in as ${data.user?.email || email}.`);
    await syncNow();
    return data;
  }

  async function signUp(email, password) {
    if (!client) throw new Error("Supabase is not configured.");
    const redirectUrl = window.location.origin;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });
    if (error) throw error;
    session = data.session;
    status(data.session ? `Account created for ${email}.` : "Confirmation email sent. Check your inbox.");
    if (data.session) await syncNow();
    return data;
  }

  async function sendPasswordReset(email) {
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: recoveryRedirectUrl()
    });
    if (error) throw error;
    status("Reset email sent. You can request another later.");
    return data;
  }

  async function updatePassword(newPassword) {
    if (!client) throw new Error("Supabase is not configured.");
    const { data, error } = await client.auth.updateUser({ password: newPassword });
    if (error) throw error;
    setRecoveryMode(false, "Password updated successfully.");
    cleanRecoveryUrl();
    return data;
  }

  function cancelPasswordRecovery() {
    setRecoveryMode(false, "Password reset cancelled.");
    cleanRecoveryUrl();
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    session = null;
    status("Signed out. Logs remain cached on this device.");
    persistAndRender();
  }


  async function saveTargets() {
    if (!configured()) {
      status("Targets saved locally. Cloud sync needs Supabase public URL/key configuration.");
      return;
    }
    if (!user() || !isOnline()) {
      status(user() ? "Offline. Targets cached for later sync." : "Targets saved locally. Sign in to sync across devices.");
      return;
    }
    await upsertTargets();
    status("Targets synced to Supabase.");
    persistAndRender();
  }

  async function saveDemandPlanning() {
    markDemandPlanningPending();
    if (typeof save === "function") save();
    if (!configured()) {
      status("Demand plan saved locally. Cloud sync needs Supabase public URL/key configuration.");
      return;
    }
    if (!user() || !isOnline()) {
      status(user() ? "Offline. Demand plan cached for later sync." : "Demand plan saved locally. Sign in to sync across devices.");
      return;
    }
    try {
      await syncDemandPlanning();
      status("Demand plan synced to Supabase.");
      persistAndRender();
    } catch (error) {
      status(demandPlanningTableMissing(error)
        ? "Demand plan saved locally. Apply the Supabase demand-planning SQL to sync it."
        : `Demand plan saved locally. Supabase planning sync failed: ${error?.message || "unknown error"}`);
      if (typeof save === "function") save();
    }
  }

  function accountView() {
    const gap = gapState();
    const pending = allLogs().filter(log => log.syncStatus !== SYNCED).length;
    return {
      configured: configured(),
      signedIn: Boolean(user()),
      recovering: recoveryMode || urlRequestsRecovery(),
      email: user()?.email || "",
      pending,
      lastSyncedAt: gap?.cloud.lastSyncedAt || "",
      status: lastStatus
    };
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    if (!configured()) {
      status(window.supabase?.createClient ? "Cloud sync needs Supabase public URL/key configuration." : "Cloud sync library is offline; local cache is active.");
      return;
    }

    recoveryMode = urlRequestsRecovery();
    const nextConfig = config();
    client = window.supabase.createClient(nextConfig.url, nextConfig.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });

    const { data, error } = await client.auth.getSession();
    if (error) status(`Auth session check failed: ${error.message}`);
    session = data?.session || null;
    status(recoveryMode
      ? "You're resetting your password. Enter a new password below."
      : session?.user
        ? `Signed in as ${session.user.email}.`
        : "Not signed in. Logs are cached on this device.");

    client.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true, "You're resetting your password. Enter a new password below.");
      } else if (recoveryMode) {
        status("You're resetting your password. Enter a new password below.");
      } else if (session?.user && !recoveryMode) syncNow();
      else status("Signed out. Logs are cached on this device.");
      if (typeof renderAll === "function") renderAll();
    });

    if (recoveryMode) setRecoveryMode(true);
    else if (session?.user) await syncNow();
  }

  window.addEventListener("online", () => syncNow());
  document.addEventListener("DOMContentLoaded", () => init());
  requestAnimationFrame(() => init());

  window.fuelGuardCloud = {
    init,
    saveLog,
    syncNow,
    syncLogsForDay,
    saveDemandPlanning,
    syncDemandPlanning,
    deleteLog,
    clearCloudLogs,
    saveTargets,
    signIn,
    signUp,
    sendPasswordReset,
    updatePassword,
    cancelPasswordRecovery,
    signOut,
    accountView,
    get client() {
      return client;
    },
    get user() {
      return user();
    },
    get configured() {
      return configured();
    },
    get signedIn() {
      return Boolean(user());
    }
  };
})();
