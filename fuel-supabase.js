// Fuel Guard Supabase Auth and cloud log sync.
(() => {
  const TABLE = "fuel_logs";
  const TARGETS_TABLE = "fuel_targets";
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
      if (gap) {
        gap.cloud.lastSyncedAt = new Date().toISOString();
        gap.cloud.lastError = "";
      }
      status(`Synced ${rows.length} cloud log${rows.length === 1 ? "" : "s"}.${targetWarning}`);
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
