// Fuel Guard Supabase Auth and cloud log sync.
(() => {
  const TABLE = "fuel_logs";
  const STATUS_EVENT = "fuelguard:cloud-status";
  const SYNCED = "synced";
  const PENDING = "pending";
  const ERROR = "error";
  const ALLOWED_TYPES = new Set(["fuel", "hydration", "fuel_hydration"]);
  const ALLOWED_SOURCES = new Set(["manual", "csv_import", "hardware", "bluetooth"]);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let client = null;
  let session = null;
  let initialized = false;
  let syncInProgress = false;
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

  function gapState() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    if (!gap) return null;
    if (!gap.cloud || typeof gap.cloud !== "object" || Array.isArray(gap.cloud)) {
      gap.cloud = {
        pendingDeleteIds: [],
        lastSyncedAt: "",
        lastError: ""
      };
    }
    if (!Array.isArray(gap.cloud.pendingDeleteIds)) gap.cloud.pendingDeleteIds = [];
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

  function normalizeSource(value) {
    const next = String(value || "manual").toLowerCase();
    return ALLOWED_SOURCES.has(next) ? next : "manual";
  }

  function dateFromLog(log) {
    const date = typeof fuelLogDate === "function" ? fuelLogDate(log) : new Date(log?.timestamp || log?.date);
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function labelForType(type) {
    if (type === "hydration") return "Hydration logged";
    if (type === "fuel_hydration") return "Fuel + hydration logged";
    return "Fuelled";
  }

  function rowToLog(row) {
    return {
      id: row.id,
      cloudId: row.id,
      timestamp: row.logged_at,
      label: labelForType(row.type),
      type: normalizeType(row.type),
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
    const row = {
      user_id: currentUser.id,
      logged_at: date.toISOString(),
      type: normalizeType(log.type),
      source: normalizeSource(log.source),
      day_type: log.dayType || null,
      training_session: log.trainingSession || null,
      notes: log.note || log.notes || null
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

  function mergeSyncedRows(rows) {
    const gap = gapState();
    if (!gap) return;
    const cloudLogs = rows.map(rowToLog);
    const cloudIds = new Set(cloudLogs.map(log => log.id));
    const pendingLocal = allLogs().filter(log => {
      if (![PENDING, ERROR].includes(log.syncStatus)) return false;
      const id = log.cloudId || log.id;
      return !id || !cloudIds.has(id);
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
    localLog.syncStatus = SYNCED;
    localLog.source = normalizeSource(row.source);
  }

  function logMatchesRow(log, row) {
    const localDate = dateFromLog(log);
    if (!localDate || !row?.logged_at) return false;
    return localDate.toISOString() === row.logged_at
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
        const localDate = dateFromLog(log);
        return localDate
          && localDate.toISOString() === row.logged_at
          && normalizeType(log.type) === normalizeType(row.type);
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
      if (gap) {
        gap.cloud.lastSyncedAt = new Date().toISOString();
        gap.cloud.lastError = "";
      }
      status(`Synced ${rows.length} cloud log${rows.length === 1 ? "" : "s"}.`);
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
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) throw error;
    session = data.session;
    status(data.session ? `Account created for ${email}.` : `Account created. Check ${email} to confirm sign-up.`);
    if (data.session) await syncNow();
    return data;
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    session = null;
    status("Signed out. Logs remain cached on this device.");
    persistAndRender();
  }

  function accountView() {
    const gap = gapState();
    const pending = allLogs().filter(log => log.syncStatus !== SYNCED).length;
    return {
      configured: configured(),
      signedIn: Boolean(user()),
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
    status(session?.user ? `Signed in as ${session.user.email}.` : "Not signed in. Logs are cached on this device.");

    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      if (session?.user) syncNow();
      else status("Signed out. Logs are cached on this device.");
      if (typeof renderAll === "function") renderAll();
    });

    if (session?.user) await syncNow();
  }

  window.addEventListener("online", () => syncNow());
  document.addEventListener("DOMContentLoaded", () => init());
  requestAnimationFrame(() => init());

  window.fuelGuardCloud = {
    init,
    saveLog,
    syncNow,
    syncLogsForDay,
    deleteLog,
    clearCloudLogs,
    signIn,
    signUp,
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
