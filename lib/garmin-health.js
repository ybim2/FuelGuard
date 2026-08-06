const {
  authenticatedDevice,
  boundedString,
  duplicateSupabaseError,
  envReady,
  getUserFromBearer,
  jsonResponse,
  methodNotAllowed,
  parseTimestamp,
  supabaseRequest
} = require("./garmin-auth.js");

const SOURCE = "garmin_connect_iq_local";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DEVICE_ID_LENGTH = 80;
const MAX_SNAPSHOT_ID_LENGTH = 160;
const MAX_TIMEZONE_LENGTH = 64;
const MAX_HEART_RATE_SAMPLES = 96;
const MAX_STRESS_SAMPLES = 96;
const MAX_BODY_BATTERY_SAMPLES = 96;
const MAX_ACTIVITY_SUMMARIES = 20;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_SAMPLE_AGE_MS = 35 * 24 * 60 * 60 * 1000;
const DEFAULT_PREFERRED_FUEL_GAP_MINUTES = 240;

function testNow(env) {
  const forced = env?.FUEL_GUARD_TEST_NOW ? new Date(env.FUEL_GUARD_TEST_NOW) : null;
  return forced && !Number.isNaN(forced.getTime()) ? forced : new Date();
}

function normalizeTimezone(value) {
  const text = boundedString(value || "UTC", MAX_TIMEZONE_LENGTH) || "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: text }).format(new Date());
    return text;
  } catch {
    return "UTC";
  }
}

function localParts(value, timeZone = "UTC") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: normalizeTimezone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((memo, part) => {
    memo[part.type] = part.value;
    return memo;
  }, {});
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function localDateKey(value, timeZone = "UTC") {
  return localParts(value, timeZone)?.dateKey || "";
}

function dateKeyFromDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addDaysDateKey(localDate, days) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return dateKeyFromDate(date);
}

function weekStartDateKey(localDate) {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return dateKeyFromDate(date);
}

function localHour(value, timeZone = "UTC") {
  const parts = localParts(value, timeZone);
  return parts ? parts.hour + parts.minute / 60 : null;
}

async function readLimitedJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    const size = Buffer.byteLength(JSON.stringify(request.body), "utf8");
    if (size > maxBytes) {
      const error = new Error("payload_too_large");
      error.statusCode = 413;
      throw error;
    }
    return request.body;
  }

  if (typeof request.body === "string" || Buffer.isBuffer(request.body)) {
    const body = Buffer.from(request.body);
    if (body.byteLength > maxBytes) {
      const error = new Error("payload_too_large");
      error.statusCode = 413;
      throw error;
    }
    return JSON.parse(body.toString("utf8") || "{}");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      const error = new Error("payload_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function validateObservedAt(value, now) {
  const date = parseTimestamp(value);
  if (!date) return { error: "timestamp_invalid" };
  if (date.getTime() > now.getTime() + FUTURE_SKEW_MS) return { error: "timestamp_in_future" };
  if (date.getTime() < now.getTime() - MAX_SAMPLE_AGE_MS) return { error: "timestamp_too_old" };
  return { value: date.toISOString(), date };
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validRange(value, min, max) {
  const number = asNumber(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  return Math.round(number);
}

function validIntegerRange(value, min, max) {
  const number = asNumber(value);
  if (!Number.isInteger(number) || number < min || number > max) return null;
  return number;
}

function validatePayloadEnvelope(payload, now) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object." };
  }
  if (Number(payload.schema_version) !== 1) {
    return { error: "schema_version must be 1." };
  }
  const deviceId = boundedString(payload.device_id, MAX_DEVICE_ID_LENGTH);
  if (!deviceId) return { error: "device_id must be a non-empty bounded string." };
  const collected = validateObservedAt(payload.collected_at || now.toISOString(), now);
  if (collected.error) return { error: "collected_at must be a recent valid timestamp." };
  return {
    value: {
      device_id: deviceId,
      snapshot_external_id: boundedString(payload.snapshot_external_id, MAX_SNAPSHOT_ID_LENGTH) || null,
      collected_at: collected.value,
      timezone: normalizeTimezone(payload.timezone),
      capabilities: sanitizeCapabilities(payload.capabilities || {})
    }
  };
}

function sanitizeCapabilities(value) {
  const capabilities = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    sensor_history: Boolean(capabilities.sensor_history),
    heart_rate_history: Boolean(capabilities.heart_rate_history),
    stress_history: Boolean(capabilities.stress_history),
    body_battery_history: Boolean(capabilities.body_battery_history),
    user_profile: Boolean(capabilities.user_profile),
    activity_history: Boolean(capabilities.activity_history),
    resting_heart_rate: Boolean(capabilities.resting_heart_rate),
    average_resting_heart_rate: Boolean(capabilities.average_resting_heart_rate)
  };
}

function emptySectionStats() {
  return { accepted: 0, duplicate: 0, invalid: 0, error: 0, truncated: 0 };
}

function limitArray(value, max) {
  if (!Array.isArray(value)) return { items: [], truncated: 0 };
  return { items: value.slice(0, max), truncated: Math.max(0, value.length - max) };
}

function validateHeartRateSamples(samples, envelope, userId, deviceTokenId, now) {
  const limited = limitArray(samples, MAX_HEART_RATE_SAMPLES);
  const rows = [];
  const stats = emptySectionStats();
  stats.truncated = limited.truncated;
  limited.items.forEach(sample => {
    const observed = validateObservedAt(sample?.observed_at || sample?.when, now);
    const value = validRange(sample?.value_bpm ?? sample?.value, 25, 240);
    if (observed.error || value === null) {
      stats.invalid += 1;
      return;
    }
    rows.push({
      user_id: userId,
      device_token_id: deviceTokenId,
      device_id: envelope.device_id,
      source: SOURCE,
      observed_at: observed.value,
      value_bpm: value,
      snapshot_external_id: envelope.snapshot_external_id
    });
  });
  return { rows, stats };
}

function validateStressSamples(samples, envelope, userId, deviceTokenId, now) {
  const limited = limitArray(samples, MAX_STRESS_SAMPLES);
  const rows = [];
  const stats = emptySectionStats();
  stats.truncated = limited.truncated;
  limited.items.forEach(sample => {
    const observed = validateObservedAt(sample?.observed_at || sample?.when, now);
    const rawValue = sample?.value;
    const value = rawValue === null || rawValue === undefined ? null : validRange(rawValue, 0, 100);
    const status = boundedString(sample?.status || (value === null ? "invalid" : "valid"), 24) || "valid";
    if (observed.error || (value === null && !["invalid", "rest", "unavailable"].includes(status)) || (rawValue !== null && rawValue !== undefined && value === null)) {
      stats.invalid += 1;
      return;
    }
    rows.push({
      user_id: userId,
      device_token_id: deviceTokenId,
      device_id: envelope.device_id,
      source: SOURCE,
      observed_at: observed.value,
      value,
      sample_status: ["valid", "rest", "invalid", "unavailable"].includes(status) ? status : "valid",
      snapshot_external_id: envelope.snapshot_external_id
    });
  });
  return { rows, stats };
}

function validateBodyBatterySamples(samples, envelope, userId, deviceTokenId, now) {
  const limited = limitArray(samples, MAX_BODY_BATTERY_SAMPLES);
  const rows = [];
  const stats = emptySectionStats();
  stats.truncated = limited.truncated;
  limited.items.forEach(sample => {
    const observed = validateObservedAt(sample?.observed_at || sample?.when, now);
    const value = validRange(sample?.value, 0, 100);
    if (observed.error || value === null) {
      stats.invalid += 1;
      return;
    }
    rows.push({
      user_id: userId,
      device_token_id: deviceTokenId,
      device_id: envelope.device_id,
      source: SOURCE,
      observed_at: observed.value,
      value,
      snapshot_external_id: envelope.snapshot_external_id
    });
  });
  return { rows, stats };
}

function validateProfileSnapshot(profile, envelope, userId, deviceTokenId, now) {
  const stats = emptySectionStats();
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return { rows: [], stats };
  const observed = validateObservedAt(profile.observed_at || envelope.collected_at, now);
  const resting = profile.resting_heart_rate === null || profile.resting_heart_rate === undefined
    ? null
    : validRange(profile.resting_heart_rate, 25, 240);
  const average = profile.average_resting_heart_rate === null || profile.average_resting_heart_rate === undefined
    ? null
    : validRange(profile.average_resting_heart_rate, 25, 240);
  if (observed.error || (profile.resting_heart_rate !== null && profile.resting_heart_rate !== undefined && resting === null) || (profile.average_resting_heart_rate !== null && profile.average_resting_heart_rate !== undefined && average === null)) {
    stats.invalid = 1;
    return { rows: [], stats };
  }
  if (resting === null && average === null) return { rows: [], stats };
  return {
    rows: [{
      user_id: userId,
      device_token_id: deviceTokenId,
      device_id: envelope.device_id,
      source: SOURCE,
      observed_at: observed.value,
      resting_heart_rate: resting,
      average_resting_heart_rate: average,
      snapshot_external_id: envelope.snapshot_external_id
    }],
    stats
  };
}

function validateActivitySummaries(activities, envelope, userId, deviceTokenId, now) {
  const limited = limitArray(activities, MAX_ACTIVITY_SUMMARIES);
  const rows = [];
  const stats = emptySectionStats();
  stats.truncated = limited.truncated;
  limited.items.forEach(activity => {
    const started = validateObservedAt(activity?.started_at || activity?.start_time, now);
    const type = boundedString(activity?.activity_type || activity?.type || "activity", 48);
    const durationSeconds = validRange(activity?.duration_seconds ?? activity?.duration, 1, 24 * 60 * 60);
    const distance = activity?.distance_metres ?? activity?.distance_meters ?? activity?.distance;
    const distanceMetres = distance === null || distance === undefined ? null : validRange(distance, 0, 1000000);
    const calories = activity?.calories === null || activity?.calories === undefined ? null : validRange(activity.calories, 0, 20000);
    if (started.error || !type || durationSeconds === null || (distance !== null && distance !== undefined && distanceMetres === null) || (activity?.calories !== null && activity?.calories !== undefined && calories === null)) {
      stats.invalid += 1;
      return;
    }
    rows.push({
      user_id: userId,
      device_token_id: deviceTokenId,
      device_id: envelope.device_id,
      source: SOURCE,
      source_activity_id: boundedString(activity?.source_activity_id || activity?.id, 160) || null,
      activity_type: type,
      started_at: started.value,
      duration_seconds: durationSeconds,
      distance_metres: distanceMetres,
      calories,
      snapshot_external_id: envelope.snapshot_external_id
    });
  });
  return { rows, stats };
}

function eqFilter(value) {
  return `eq.${value}`;
}

async function lookupExisting(table, filters, env) {
  const params = new URLSearchParams({ select: "id", limit: "1" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value === null || value === undefined) params.set(key, "is.null");
    else params.set(key, eqFilter(String(value)));
  });
  const result = await supabaseRequest(`/rest/v1/${table}?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error(`${table}_lookup_failed`);
  return Array.isArray(result.data) ? result.data[0] || null : null;
}

async function insertDedupeRow(table, row, filters, env) {
  const existing = await lookupExisting(table, filters, env);
  if (existing) return "duplicate";
  const result = await supabaseRequest(`/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  }, env);
  if (result.response.ok) return "accepted";
  if (duplicateSupabaseError(result)) return "duplicate";
  throw new Error(`${table}_insert_failed`);
}

async function insertRows(table, rows, uniqueFilterForRow, baseStats, env) {
  const stats = { ...emptySectionStats(), ...baseStats };
  for (const row of rows) {
    try {
      const result = await insertDedupeRow(table, row, uniqueFilterForRow(row), env);
      if (result === "accepted") stats.accepted += 1;
      else stats.duplicate += 1;
    } catch {
      stats.error += 1;
    }
  }
  return stats;
}

async function upsertCapabilities(envelope, userId, deviceTokenId, env) {
  const row = {
    user_id: userId,
    device_token_id: deviceTokenId,
    device_id: envelope.device_id,
    source: SOURCE,
    collected_at: envelope.collected_at,
    capabilities: envelope.capabilities
  };
  const existing = await lookupExisting("garmin_device_capabilities", {
    user_id: userId,
    device_id: envelope.device_id,
    source: SOURCE
  }, env);
  const path = existing
    ? `/rest/v1/garmin_device_capabilities?id=eq.${encodeURIComponent(existing.id)}`
    : "/rest/v1/garmin_device_capabilities";
  const result = await supabaseRequest(path, {
    method: existing ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  }, env);
  if (!result.response.ok) throw new Error("capabilities_upsert_failed");
  return { accepted: existing ? 0 : 1, duplicate: existing ? 1 : 0, invalid: 0, error: 0, truncated: 0 };
}

function wideDateRange(localDate) {
  const center = new Date(`${localDate}T12:00:00.000Z`);
  return {
    start: new Date(center.getTime() - 36 * 60 * 60 * 1000).toISOString(),
    end: new Date(center.getTime() + 36 * 60 * 60 * 1000).toISOString()
  };
}

async function fetchRangeRows(table, select, filters, rangeColumn, range, env) {
  const params = new URLSearchParams({ select, limit: "1000" });
  Object.entries(filters).forEach(([key, value]) => params.set(key, eqFilter(String(value))));
  if (rangeColumn && range) {
    params.set(rangeColumn, `gte.${range.start}`);
    params.append(rangeColumn, `lte.${range.end}`);
  }
  const result = await supabaseRequest(`/rest/v1/${table}?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error(`${table}_range_lookup_failed`);
  return Array.isArray(result.data) ? result.data : [];
}

function average(values) {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function median(values) {
  const valid = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) / 2;
}

function fuelGaps(logs) {
  const sorted = logs.map(row => new Date(row.logged_at)).filter(date => !Number.isNaN(date.getTime())).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < sorted.length; i += 1) {
    gaps.push((sorted[i] - sorted[i - 1]) / 60000);
  }
  return gaps;
}

function gapWindows(logs) {
  const sorted = logs.map(row => new Date(row.logged_at)).filter(date => !Number.isNaN(date.getTime())).sort((a, b) => a - b);
  const windows = [];
  for (let i = 1; i < sorted.length; i += 1) {
    windows.push({
      start: sorted[i - 1],
      end: sorted[i],
      minutes: (sorted[i] - sorted[i - 1]) / 60000
    });
  }
  return windows;
}

function activityWindows(activities) {
  return activities.map(activity => {
    const start = new Date(activity.started_at);
    const durationMs = Number(activity.duration_seconds || 0) * 1000;
    if (Number.isNaN(start.getTime()) || durationMs <= 0) return null;
    return { start, end: new Date(start.getTime() + durationMs) };
  }).filter(Boolean);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function trainingFuelSummary(fuelLogs, activities) {
  const fuelDates = fuelLogs.map(row => new Date(row.logged_at)).filter(date => !Number.isNaN(date.getTime()));
  const activityRanges = activityWindows(activities);
  const preWindowMs = 3 * 60 * 60 * 1000;
  const postWindowMs = 3 * 60 * 60 * 1000;
  let before = 0;
  let after = 0;
  let missingBefore = 0;
  let missingAfter = 0;
  activityRanges.forEach(activity => {
    const beforeCount = fuelDates.filter(date => date < activity.start && activity.start - date <= preWindowMs).length;
    const afterCount = fuelDates.filter(date => date > activity.end && date - activity.end <= postWindowMs).length;
    before += beforeCount;
    after += afterCount;
    if (!beforeCount) missingBefore += 1;
    if (!afterCount) missingAfter += 1;
  });
  const longGapOverlapCount = gapWindows(fuelLogs)
    .filter(gap => gap.minutes > DEFAULT_PREFERRED_FUEL_GAP_MINUTES)
    .filter(gap => activityRanges.some(activity => overlaps(gap.start, gap.end, activity.start, activity.end)))
    .length;
  return {
    fuel_events_before_training: before,
    fuel_events_after_training: after,
    workouts_missing_pre_fuel: missingBefore,
    workouts_missing_post_fuel: missingAfter,
    long_gap_activity_overlap_count: longGapOverlapCount
  };
}

function localDayRows(rows, timestampKey, localDate, timezone) {
  return rows.filter(row => localDateKey(row[timestampKey], timezone) === localDate);
}

function hourRows(rows, timestampKey, timezone, startHour, endHour) {
  return rows.filter(row => {
    const hour = localHour(row[timestampKey], timezone);
    return Number.isFinite(hour) && hour >= startHour && hour < endHour;
  });
}

async function upsertFeatureRow(row, env) {
  const existing = await lookupExisting("garmin_daily_features", {
    user_id: row.user_id,
    local_date: row.local_date,
    source: row.source
  }, env);
  const path = existing
    ? `/rest/v1/garmin_daily_features?id=eq.${encodeURIComponent(existing.id)}`
    : "/rest/v1/garmin_daily_features";
  const result = await supabaseRequest(path, {
    method: existing ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  }, env);
  if (!result.response.ok) throw new Error("feature_upsert_failed");
}

async function upsertWeeklyFeatureRow(row, env) {
  const existing = await lookupExisting("garmin_weekly_features", {
    user_id: row.user_id,
    week_start_date: row.week_start_date,
    source: row.source
  }, env);
  const path = existing
    ? `/rest/v1/garmin_weekly_features?id=eq.${encodeURIComponent(existing.id)}`
    : "/rest/v1/garmin_weekly_features";
  const result = await supabaseRequest(path, {
    method: existing ? "PATCH" : "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(row)
  }, env);
  if (!result.response.ok) throw new Error("weekly_feature_upsert_failed");
}

async function fetchDailyFeatureRowsForWeek(userId, weekStartDate, env) {
  const params = new URLSearchParams({
    select: "*",
    user_id: `eq.${userId}`,
    source: `eq.${SOURCE}`,
    local_date: `gte.${weekStartDate}`,
    order: "local_date.asc",
    limit: "7"
  });
  params.append("local_date", `lte.${addDaysDateKey(weekStartDate, 6)}`);
  const result = await supabaseRequest(`/rest/v1/garmin_daily_features?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("daily_features_week_lookup_failed");
  return Array.isArray(result.data) ? result.data : [];
}

async function generateWeeklyFeature({ userId, weekStartDate, timezone, env }) {
  const rows = await fetchDailyFeatureRowsForWeek(userId, weekStartDate, env);
  const activeRows = rows.filter(row => Number(row.activity_count || 0) > 0);
  const sensorRows = rows.filter(row =>
    Number(row.heart_rate_sample_count || 0)
    + Number(row.stress_sample_count || 0)
    + Number(row.body_battery_sample_count || 0) >= 12
  );
  const row = {
    user_id: userId,
    week_start_date: weekStartDate,
    source: SOURCE,
    timezone,
    total_fuel_events: rows.reduce((sum, item) => sum + Number(item.fuel_event_count || 0), 0),
    average_daily_fuel_events: rows.length ? Number((rows.reduce((sum, item) => sum + Number(item.fuel_event_count || 0), 0) / rows.length).toFixed(2)) : null,
    median_longest_gap_minutes: median(rows.map(item => item.longest_fuel_gap_minutes)),
    days_exceeding_preferred_gap: rows.filter(item => Number(item.excessive_fuel_gap_count || 0) > 0).length,
    workout_count: rows.reduce((sum, item) => sum + Number(item.activity_count || 0), 0),
    training_minutes: rows.reduce((sum, item) => sum + Number(item.activity_duration_minutes || 0), 0),
    active_days: activeRows.length,
    workouts_missing_pre_fuel: rows.reduce((sum, item) => sum + Number(item.workouts_missing_pre_fuel || 0), 0),
    workouts_missing_post_fuel: rows.reduce((sum, item) => sum + Number(item.workouts_missing_post_fuel || 0), 0),
    long_gap_activity_overlap_count: rows.reduce((sum, item) => sum + Number(item.long_gap_activity_overlap_count || 0), 0),
    average_afternoon_stress: average(rows.map(item => item.afternoon_median_stress)),
    average_body_battery_daytime_change: average(rows.map(item => item.body_battery_daytime_change)),
    data_quality_status: sensorRows.length >= 5 ? "good" : sensorRows.length >= 2 ? "partial" : "limited",
    generated_at: new Date().toISOString()
  };
  await upsertWeeklyFeatureRow(row, env);
  return row;
}

async function generateDailyFeature({ userId, localDate, timezone, env }) {
  const range = wideDateRange(localDate);
  const filters = { user_id: userId };
  const fuelLogRows = await fetchRangeRows("fuel_logs", "id,logged_at,type,source", filters, "logged_at", range, env);
  const heartRows = await fetchRangeRows("garmin_heart_rate_samples", "observed_at,value_bpm", filters, "observed_at", range, env);
  const stressRows = await fetchRangeRows("garmin_stress_samples", "observed_at,value,sample_status", filters, "observed_at", range, env);
  const batteryRows = await fetchRangeRows("garmin_body_battery_samples", "observed_at,value", filters, "observed_at", range, env);
  const activityRows = await fetchRangeRows("garmin_activity_summaries", "started_at,activity_type,duration_seconds,distance_metres,calories", filters, "started_at", range, env);

  const fuelLogs = localDayRows(fuelLogRows, "logged_at", localDate, timezone)
    .filter(row => row.type === "fuel" || row.type === "fuel_hydration");
  const gaps = fuelGaps(fuelLogs);
  const heart = localDayRows(heartRows, "observed_at", localDate, timezone);
  const stress = localDayRows(stressRows, "observed_at", localDate, timezone).filter(row => row.sample_status === "valid" && row.value !== null);
  const battery = localDayRows(batteryRows, "observed_at", localDate, timezone);
  const activities = localDayRows(activityRows, "started_at", localDate, timezone);
  const morningBattery = hourRows(battery, "observed_at", timezone, 4, 10);
  const eveningBattery = hourRows(battery, "observed_at", timezone, 17, 23);
  const trainingFuel = trainingFuelSummary(fuelLogs, activities);

  const row = {
    user_id: userId,
    local_date: localDate,
    source: SOURCE,
    timezone,
    fuel_event_count: fuelLogs.length,
    first_fuel_at: fuelLogs.map(item => item.logged_at).sort()[0] || null,
    final_fuel_at: fuelLogs.map(item => item.logged_at).sort().at(-1) || null,
    longest_fuel_gap_minutes: Math.round(Math.max(0, ...gaps)),
    average_fuel_gap_minutes: average(gaps) === null ? null : Math.round(average(gaps)),
    fuel_debt_minutes: Math.round(gaps.reduce((sum, gap) => sum + Math.max(0, gap - DEFAULT_PREFERRED_FUEL_GAP_MINUTES), 0)),
    excessive_fuel_gap_count: gaps.filter(gap => gap > DEFAULT_PREFERRED_FUEL_GAP_MINUTES).length,
    fuel_events_before_training: trainingFuel.fuel_events_before_training,
    fuel_events_after_training: trainingFuel.fuel_events_after_training,
    workouts_missing_pre_fuel: trainingFuel.workouts_missing_pre_fuel,
    workouts_missing_post_fuel: trainingFuel.workouts_missing_post_fuel,
    long_gap_activity_overlap_count: trainingFuel.long_gap_activity_overlap_count,
    heart_rate_sample_count: heart.length,
    stress_sample_count: stress.length,
    body_battery_sample_count: battery.length,
    morning_median_heart_rate: median(hourRows(heart, "observed_at", timezone, 4, 10).map(row => row.value_bpm)),
    afternoon_median_stress: median(hourRows(stress, "observed_at", timezone, 12, 17).map(row => row.value)),
    evening_median_stress: median(hourRows(stress, "observed_at", timezone, 17, 23).map(row => row.value)),
    morning_body_battery: median(morningBattery.map(row => row.value)),
    evening_body_battery: median(eveningBattery.map(row => row.value)),
    body_battery_daytime_change: median(morningBattery.map(row => row.value)) === null || median(eveningBattery.map(row => row.value)) === null
      ? null
      : Math.round(median(eveningBattery.map(row => row.value)) - median(morningBattery.map(row => row.value))),
    activity_count: activities.length,
    activity_duration_minutes: Math.round(activities.reduce((sum, row) => sum + Number(row.duration_seconds || 0), 0) / 60),
    data_quality_status: heart.length + stress.length + battery.length >= 12 ? "partial" : "limited",
    generated_at: new Date().toISOString()
  };
  await upsertFeatureRow(row, env);
  return row;
}

async function generateDailyFeaturesFromRows(userId, envelope, rowsBySection, env) {
  const dateKeys = new Set([localDateKey(envelope.collected_at, envelope.timezone)]);
  [...rowsBySection.heart, ...rowsBySection.stress, ...rowsBySection.bodyBattery, ...rowsBySection.activities]
    .forEach(row => dateKeys.add(localDateKey(row.observed_at || row.started_at, envelope.timezone)));
  const generated = [];
  for (const localDate of Array.from(dateKeys).filter(Boolean)) {
    try {
      generated.push(await generateDailyFeature({ userId, localDate, timezone: envelope.timezone, env }));
    } catch {
      // Feature generation must not make ingestion fail; raw accepted samples remain persisted.
    }
  }
  return generated;
}

async function generateWeeklyFeaturesFromDailyRows(userId, timezone, dailyRows, env) {
  const weekStarts = new Set((Array.isArray(dailyRows) ? dailyRows : [])
    .map(row => weekStartDateKey(row.local_date))
    .filter(Boolean));
  const generated = [];
  for (const weekStartDate of Array.from(weekStarts)) {
    try {
      generated.push(await generateWeeklyFeature({ userId, weekStartDate, timezone, env }));
    } catch {
      // Weekly features are useful but must not make raw ingestion fail.
    }
  }
  return generated;
}

async function garminHealthHandler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  let device;
  try { device = await authenticatedDevice(request, env); } catch { return jsonResponse(response, 500, { error: "server_error" }); }
  if (!device) return jsonResponse(response, 401, { error: "unauthorized" });

  let payload;
  try {
    payload = await readLimitedJsonBody(request);
  } catch (error) {
    return jsonResponse(response, error.statusCode || 400, { error: error.statusCode === 413 ? "payload_too_large" : "invalid_json" });
  }

  const now = testNow(env);
  const envelopeValidation = validatePayloadEnvelope(payload, now);
  if (envelopeValidation.error) {
    return jsonResponse(response, 400, { error: "invalid_payload", message: envelopeValidation.error });
  }
  const envelope = envelopeValidation.value;
  const userId = device.user_id;
  const deviceTokenId = device.id;
  const heart = validateHeartRateSamples(payload.heart_rate_samples, envelope, userId, deviceTokenId, now);
  const stress = validateStressSamples(payload.stress_samples, envelope, userId, deviceTokenId, now);
  const bodyBattery = validateBodyBatterySamples(payload.body_battery_samples, envelope, userId, deviceTokenId, now);
  const profile = validateProfileSnapshot(payload.profile_snapshot, envelope, userId, deviceTokenId, now);
  const activities = validateActivitySummaries(payload.activity_summaries, envelope, userId, deviceTokenId, now);
  const sections = {};

  try {
    sections.capabilities = await upsertCapabilities(envelope, userId, deviceTokenId, env);
    sections.heart_rate_samples = await insertRows("garmin_heart_rate_samples", heart.rows, row => ({
      user_id: row.user_id,
      source: row.source,
      device_id: row.device_id,
      observed_at: row.observed_at
    }), heart.stats, env);
    sections.stress_samples = await insertRows("garmin_stress_samples", stress.rows, row => ({
      user_id: row.user_id,
      source: row.source,
      device_id: row.device_id,
      observed_at: row.observed_at
    }), stress.stats, env);
    sections.body_battery_samples = await insertRows("garmin_body_battery_samples", bodyBattery.rows, row => ({
      user_id: row.user_id,
      source: row.source,
      device_id: row.device_id,
      observed_at: row.observed_at
    }), bodyBattery.stats, env);
    sections.profile_snapshots = await insertRows("garmin_profile_snapshots", profile.rows, row => ({
      user_id: row.user_id,
      source: row.source,
      device_id: row.device_id,
      observed_at: row.observed_at
    }), profile.stats, env);
    sections.activity_summaries = await insertRows("garmin_activity_summaries", activities.rows, row => ({
      user_id: row.user_id,
      source: row.source,
      device_id: row.device_id,
      ...(row.source_activity_id
        ? { source_activity_id: row.source_activity_id }
        : { started_at: row.started_at, activity_type: row.activity_type })
    }), activities.stats, env);
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }

  const featureRows = await generateDailyFeaturesFromRows(userId, envelope, {
    heart: heart.rows,
    stress: stress.rows,
    bodyBattery: bodyBattery.rows,
    activities: activities.rows
  }, env);
  const weeklyFeatureRows = await generateWeeklyFeaturesFromDailyRows(userId, envelope.timezone, featureRows, env);

  const accepted = Object.values(sections).reduce((sum, section) => sum + Number(section.accepted || 0), 0);
  const duplicates = Object.values(sections).reduce((sum, section) => sum + Number(section.duplicate || 0), 0);
  return jsonResponse(response, 200, {
    result: accepted ? "ok" : "duplicate",
    source: SOURCE,
    accepted,
    duplicates,
    sections,
    features_generated: featureRows.length,
    weekly_features_generated: weeklyFeatureRows.length
  });
}

function featureRowsForPatterns(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      ...row,
      date: new Date(`${row.local_date}T12:00:00.000Z`)
    }))
    .filter(row => row.local_date && !Number.isNaN(row.date.getTime()))
    .sort((a, b) => a.date - b.date);
}

function groupRows(rows, predicate) {
  return rows.filter(predicate);
}

function meaningfulDifference(a, b, min) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) >= min;
}

function confidenceForCount(count) {
  if (count >= 10) return "moderate";
  if (count >= 5) return "early";
  return "limited";
}

function patternCandidate({ id, text, detail, metric, count, magnitude, tone = "neutral", action = "" }) {
  return {
    id,
    text,
    detail,
    metric,
    count,
    confidence: confidenceForCount(count),
    limitation: "Based on Connect IQ-local watch samples only; this is an association, not a medical conclusion.",
    action,
    tone,
    rank: count * 3 + Math.min(40, Math.abs(magnitude || 0)) + (action ? 6 : 0)
  };
}

function buildGarminPatternInsights(rows) {
  const features = featureRowsForPatterns(rows);
  const candidates = [];
  const longGapDays = groupRows(features, row => Number(row.longest_fuel_gap_minutes || 0) >= 300);
  const steadierGapDays = groupRows(features, row => Number(row.longest_fuel_gap_minutes || 0) > 0 && Number(row.longest_fuel_gap_minutes || 0) < 300);
  if (longGapDays.length >= 3 && steadierGapDays.length >= 3) {
    const longStress = average(longGapDays.map(row => row.afternoon_median_stress));
    const steadyStress = average(steadierGapDays.map(row => row.afternoon_median_stress));
    if (meaningfulDifference(longStress, steadyStress, 5)) {
      const diff = Math.round(longStress - steadyStress);
      candidates.push(patternCandidate({
        id: "long-gap-stress",
        text: diff > 0
          ? `On days with long fuel gaps, your afternoon stress samples trend ${Math.abs(diff)} points higher.`
          : `On days with long fuel gaps, your afternoon stress samples trend ${Math.abs(diff)} points lower.`,
        detail: `${longGapDays.length} long-gap days compared with ${steadierGapDays.length} steadier-gap days.`,
        metric: "stress",
        count: Math.min(longGapDays.length, steadierGapDays.length),
        magnitude: diff,
        tone: diff > 0 ? "elevated" : "steady",
        action: diff > 0 ? "Try adding a small fuel opportunity before the recurring long gap." : "Keep comparing this as more watch data comes in."
      }));
    }
  }

  const activityDays = groupRows(features, row => Number(row.activity_count || 0) > 0);
  const nonActivityDays = groupRows(features, row => Number(row.activity_count || 0) === 0);
  if (activityDays.length >= 2 && nonActivityDays.length >= 2) {
    const activityGap = average(activityDays.map(row => row.longest_fuel_gap_minutes));
    const nonActivityGap = average(nonActivityDays.map(row => row.longest_fuel_gap_minutes));
    if (meaningfulDifference(activityGap, nonActivityGap, 30)) {
      const diff = Math.round(activityGap - nonActivityGap);
      candidates.push(patternCandidate({
        id: "activity-day-gap",
        text: diff > 0
          ? `Your longest fuel gaps are about ${Math.abs(diff)} minutes longer on days with Garmin activities.`
          : `Your longest fuel gaps are about ${Math.abs(diff)} minutes shorter on days with Garmin activities.`,
        detail: `${activityDays.length} activity days compared with ${nonActivityDays.length} non-activity days.`,
        metric: "fuel_gap",
        count: Math.min(activityDays.length, nonActivityDays.length),
        magnitude: diff,
        tone: diff > 0 ? "elevated" : "steady",
        action: diff > 0 ? "Plan one reliable fuel moment around the activity window." : "This pattern currently looks supportive."
      }));
    }
  }

  const workoutCount = features.reduce((sum, row) => sum + Number(row.activity_count || 0), 0);
  const missingPreFuel = features.reduce((sum, row) => sum + Number(row.workouts_missing_pre_fuel || 0), 0);
  if (workoutCount >= 5 && missingPreFuel >= 3 && missingPreFuel / workoutCount >= 0.5) {
    candidates.push(patternCandidate({
      id: "pre-training-fuel",
      text: `On ${missingPreFuel} of your last ${workoutCount} Garmin activities, no fuel event was logged within 3 hours before starting.`,
      detail: "This is a concrete logging pattern around training, not a claim about performance.",
      metric: "training",
      count: workoutCount,
      magnitude: missingPreFuel,
      tone: "elevated",
      action: "Consider planning one small fuel opportunity before recurring training windows."
    }));
  }

  const missingPostFuel = features.reduce((sum, row) => sum + Number(row.workouts_missing_post_fuel || 0), 0);
  if (workoutCount >= 5 && missingPostFuel >= 3 && missingPostFuel / workoutCount >= 0.5) {
    candidates.push(patternCandidate({
      id: "post-training-fuel",
      text: `On ${missingPostFuel} of your last ${workoutCount} Garmin activities, no fuel event was logged within 3 hours after finishing.`,
      detail: "This can help you notice whether post-training fuel moments are getting missed.",
      metric: "training",
      count: workoutCount,
      magnitude: missingPostFuel,
      tone: "elevated",
      action: "Use this as a prompt to protect an easy post-training fuel moment."
    }));
  }

  const batteryDays = features.filter(row => Number.isFinite(Number(row.body_battery_daytime_change)));
  const highFuelDays = batteryDays.filter(row => Number(row.fuel_event_count || 0) >= 4);
  const lowFuelDays = batteryDays.filter(row => Number(row.fuel_event_count || 0) > 0 && Number(row.fuel_event_count || 0) < 4);
  if (highFuelDays.length >= 3 && lowFuelDays.length >= 3) {
    const highChange = average(highFuelDays.map(row => row.body_battery_daytime_change));
    const lowChange = average(lowFuelDays.map(row => row.body_battery_daytime_change));
    if (meaningfulDifference(highChange, lowChange, 8)) {
      const diff = Math.round(highChange - lowChange);
      candidates.push(patternCandidate({
        id: "fuel-count-body-battery",
        text: diff > 0
          ? `Days with more fuel logs show a ${Math.abs(diff)} point steadier Body Battery pattern.`
          : `Days with more fuel logs show a ${Math.abs(diff)} point lower Body Battery pattern.`,
        detail: `${highFuelDays.length} higher-log days compared with ${lowFuelDays.length} lower-log days.`,
        metric: "body_battery",
        count: Math.min(highFuelDays.length, lowFuelDays.length),
        magnitude: diff,
        tone: diff > 0 ? "steady" : "neutral",
        action: "Use this as a gentle planning signal, not a score to chase."
      }));
    }
  }

  const afterDebtDays = features.filter((row, index) => index > 0 && Number(features[index - 1].fuel_debt_minutes || 0) >= 60 && Number.isFinite(Number(row.morning_median_heart_rate)));
  const normalPreviousDays = features.filter((row, index) => index > 0 && Number(features[index - 1].fuel_debt_minutes || 0) < 60 && Number.isFinite(Number(row.morning_median_heart_rate)));
  if (afterDebtDays.length >= 3 && normalPreviousDays.length >= 3) {
    const afterHr = average(afterDebtDays.map(row => row.morning_median_heart_rate));
    const normalHr = average(normalPreviousDays.map(row => row.morning_median_heart_rate));
    if (meaningfulDifference(afterHr, normalHr, 5)) {
      const diff = Math.round(afterHr - normalHr);
      candidates.push(patternCandidate({
        id: "next-morning-heart-rate",
        text: diff > 0
          ? `Morning heart-rate samples tend to be ${Math.abs(diff)} bpm higher after days with more time beyond your fuel window.`
          : `Morning heart-rate samples tend to be ${Math.abs(diff)} bpm lower after days with more time beyond your fuel window.`,
        detail: `${afterDebtDays.length} next-day samples after longer-gap days compared with ${normalPreviousDays.length} other samples.`,
        metric: "heart_rate",
        count: Math.min(afterDebtDays.length, normalPreviousDays.length),
        magnitude: diff,
        tone: diff > 0 ? "elevated" : "neutral",
        action: "Watch whether this remains true after a few more weeks of data."
      }));
    }
  }

  return candidates
    .sort((a, b) => b.rank - a.rank)
    .filter((candidate, index, list) => list.findIndex(item => item.metric === candidate.metric) === index)
    .slice(0, 3);
}

async function latestCapabilities(userId, env) {
  const params = new URLSearchParams({
    select: "device_id,collected_at,capabilities",
    user_id: `eq.${userId}`,
    source: `eq.${SOURCE}`,
    order: "collected_at.desc",
    limit: "1"
  });
  const result = await supabaseRequest(`/rest/v1/garmin_device_capabilities?${params.toString()}`, {
    method: "GET",
    headers: { Accept: "application/json" }
  }, env);
  if (!result.response.ok) throw new Error("capabilities_lookup_failed");
  const row = Array.isArray(result.data) ? result.data[0] || null : null;
  return row ? {
    device_id: row.device_id,
    collected_at: row.collected_at,
    capabilities: sanitizeCapabilities(row.capabilities || {})
  } : null;
}

async function garminPatternsHandler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  const user = await getUserFromBearer(request, env);
  if (!user) return jsonResponse(response, 401, { error: "supabase_session_required" });

  try {
    const params = new URLSearchParams({
      select: "*",
      user_id: `eq.${user.id}`,
      source: `eq.${SOURCE}`,
      order: "local_date.desc",
      limit: "90"
    });
    const result = await supabaseRequest(`/rest/v1/garmin_daily_features?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    }, env);
    if (!result.response.ok) throw new Error("features_lookup_failed");
    const features = Array.isArray(result.data) ? result.data.reverse() : [];
    const insights = buildGarminPatternInsights(features);
    const capabilities = await latestCapabilities(user.id, env);
    return jsonResponse(response, 200, {
      source: SOURCE,
      features_count: features.length,
      features,
      capabilities,
      insights,
      message: insights.length
        ? "Garmin patterns are based on opt-in Connect IQ-local watch data."
        : "Garmin patterns need a few repeated days before Fuel Guard shows them."
    });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

function validateCheckinPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "Body must be a JSON object." };
  }
  const localDate = boundedString(payload.local_date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return { error: "local_date must be YYYY-MM-DD." };
  const row = {
    local_date: localDate,
    checked_in_at: parseTimestamp(payload.checked_in_at)?.toISOString() || new Date().toISOString(),
    energy: validIntegerRange(payload.energy, 1, 5),
    mood: validIntegerRange(payload.mood, 1, 5),
    soreness: validIntegerRange(payload.soreness, 1, 5),
    hunger_appetite: validIntegerRange(payload.hunger_appetite, 1, 5),
    perceived_recovery: validIntegerRange(payload.perceived_recovery, 1, 5),
    notes: boundedString(payload.notes || "", 240) || null
  };
  if ([row.energy, row.mood, row.soreness, row.hunger_appetite, row.perceived_recovery].some(value => value === null)) {
    return { error: "Daily check-in values must be whole numbers from 1 to 5." };
  }
  return { value: row };
}

async function garminDailyCheckinHandler(request, response) {
  if (!["GET", "POST"].includes(request.method)) return methodNotAllowed(response, ["GET", "POST"]);
  const env = process.env || {};
  if (!envReady(env)) return jsonResponse(response, 500, { error: "server_not_configured" });
  const user = await getUserFromBearer(request, env);
  if (!user) return jsonResponse(response, 401, { error: "supabase_session_required" });
  try {
    if (request.method === "GET") {
      const params = new URLSearchParams({
        select: "*",
        user_id: `eq.${user.id}`,
        order: "local_date.desc",
        limit: "30"
      });
      const result = await supabaseRequest(`/rest/v1/garmin_daily_checkins?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" }
      }, env);
      if (!result.response.ok) throw new Error("checkins_lookup_failed");
      return jsonResponse(response, 200, { checkins: Array.isArray(result.data) ? result.data : [] });
    }
    const payload = await readLimitedJsonBody(request, 8192);
    const validation = validateCheckinPayload(payload);
    if (validation.error) return jsonResponse(response, 400, { error: "invalid_payload", message: validation.error });
    const existing = await lookupExisting("garmin_daily_checkins", {
      user_id: user.id,
      local_date: validation.value.local_date
    }, env);
    const row = { ...validation.value, user_id: user.id, source: "manual" };
    const path = existing
      ? `/rest/v1/garmin_daily_checkins?id=eq.${encodeURIComponent(existing.id)}`
      : "/rest/v1/garmin_daily_checkins";
    const result = await supabaseRequest(path, {
      method: existing ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(row)
    }, env);
    if (!result.response.ok) throw new Error("checkin_upsert_failed");
    const saved = Array.isArray(result.data) ? result.data[0] : result.data;
    return jsonResponse(response, existing ? 200 : 201, { result: "ok", checkin: saved });
  } catch {
    return jsonResponse(response, 500, { error: "server_error" });
  }
}

module.exports = {
  garminHealthHandler,
  garminPatternsHandler,
  garminDailyCheckinHandler,
  _test: {
    SOURCE,
    buildGarminPatternInsights,
    localDateKey,
    weekStartDateKey,
    validatePayloadEnvelope,
    validateHeartRateSamples,
    validateStressSamples,
    validateBodyBatterySamples,
    validateActivitySummaries,
    latestCapabilities,
    validateCheckinPayload,
    readLimitedJsonBody
  }
};
