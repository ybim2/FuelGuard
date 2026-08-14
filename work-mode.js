// Automatic, athlete-owned work context inferred from a saved weekly pattern.
(() => {
  "use strict";

  const PATTERNS = "fuel_work_patterns";
  const DAYS = "fuel_work_pattern_days";
  const DAY_LABELS = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);
  const ANALYTICS_DAYS = 28;
  let owner = "";
  let pattern = null;
  let patternDays = [];
  let message = "";
  let busy = false;

  function cloud() { return window.fuelGuardCloud; }
  function domain() { return window.FuelGuardDomain; }
  function escape(value) { return domain()?.escapeHtml?.(value) || String(value ?? ""); }
  function timezoneName() {
    return pattern?.timezone_name || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }
  function timeMinutes(value) {
    const match = /^(\d{2}):(\d{2})/.exec(String(value || ""));
    if (!match) return NaN;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function localParts(value, timeZone = timezoneName()) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    return {
      year,
      month,
      day,
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
      minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
  }
  function previousDayOfWeek(day) { return (Number(day) + 6) % 7; }
  function dayRow(dayOfWeek) { return patternDays.find(row => Number(row.day_of_week) === Number(dayOfWeek)) || null; }
  function rowContains(row, minutes, { previousDayTail = false } = {}) {
    if (!row?.is_work_day) return false;
    const start = timeMinutes(row.start_time);
    const end = timeMinutes(row.end_time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
    if (start < end) return !previousDayTail && minutes >= start && minutes < end;
    return previousDayTail ? minutes < end : minutes >= start;
  }
  function isDuringPattern(value, rows, timeZone, active = true) {
    if (!active || !Array.isArray(rows) || !rows.length) return false;
    const local = localParts(value, timeZone);
    if (!local) return false;
    const findDay = day => rows.find(row => Number(row.day_of_week) === Number(day)) || null;
    return rowContains(findDay(local.dayOfWeek), local.minutes)
      || rowContains(findDay(previousDayOfWeek(local.dayOfWeek)), local.minutes, { previousDayTail: true });
  }
  function isDuringWork(value = new Date()) {
    return isDuringPattern(value, patternDays, timezoneName(), pattern?.active);
  }
  function classifyEvent(value, log = null) {
    if (log && (log.trainingModeSessionId || log.training_mode_session_id || log.trainingSession || log.training_session)) return "training";
    return isDuringWork(value) ? "work" : "everyday";
  }
  function contextForEvent() {
    // Work is deliberately inferred at read time. New logs must not create or attach
    // manual Work Mode sessions, so there is no persisted Work identifier to return.
    return {};
  }
  function activeSession() { return null; }
  async function ensureSessionSyncedForLog() { return null; }

  function formatTime(minutes) {
    if (!Number.isFinite(minutes)) return "—";
    const date = new Date(2000, 0, 1, Math.floor(minutes / 60), Math.round(minutes % 60));
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  function formatDuration(minutes) {
    if (!Number.isFinite(minutes)) return "—";
    const rounded = Math.round(minutes);
    const hours = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return hours ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
  }
  function average(values) { return values.length ? values.reduce((total, value) => total + value, 0) / values.length : NaN; }
  function median(values) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function fuelLogs() {
    const cutoff = Date.now() - ANALYTICS_DAYS * 86400000;
    const logs = typeof fuelGapState === "function" ? fuelGapState()?.logs || [] : [];
    return logs.map(log => ({ log, date: domain()?.logDate?.(log) || new Date(log.timestamp || log.logged_at || "") }))
      .filter(item => item.date.getTime() >= cutoff && item.date.getTime() <= Date.now() && domain()?.isFuelLog?.(item.log))
      .map(item => ({ ...item, local: localParts(item.date), context: classifyEvent(item.date, item.log) }))
      .filter(item => item.local && item.context !== "training")
      .sort((a, b) => a.date - b.date);
  }
  function contextMetrics(items, context) {
    const selected = items.filter(item => item.context === context);
    const gaps = [];
    for (let index = 1; index < selected.length; index += 1) {
      const before = selected[index - 1];
      const after = selected[index];
      const gap = (after.date - before.date) / 60000;
      if (before.local.dateKey === after.local.dateKey && gap > 0 && gap <= 18 * 60) gaps.push(gap);
    }
    const observedDates = new Set(selected.map(item => item.local.dateKey));
    return {
      count: selected.length,
      days: observedDates.size,
      frequency: observedDates.size ? selected.length / observedDates.size : NaN,
      averageGap: average(gaps),
      longestGap: gaps.length ? Math.max(...gaps) : NaN,
      firstTime: median([...observedDates].map(key => selected.find(item => item.local.dateKey === key)?.local.minutes).filter(Number.isFinite)),
      lastTime: median([...observedDates].map(key => selected.filter(item => item.local.dateKey === key).at(-1)?.local.minutes).filter(Number.isFinite))
    };
  }
  function analytics() {
    const items = fuelLogs();
    return { sample: items.length, work: contextMetrics(items, "work"), everyday: contextMetrics(items, "everyday") };
  }

  function renderSettings() {
    const target = document.getElementById("athleteWorkPatternManagement");
    if (!target) return;
    const rows = DAY_LABELS.map((label, dayOfWeek) => {
      const row = dayRow(dayOfWeek);
      const checked = Boolean(row?.is_work_day);
      return `<fieldset class="work-pattern-day" data-work-pattern-day="${dayOfWeek}"><legend>${label}</legend><label class="work-pattern-toggle"><input type="checkbox" data-work-enabled ${checked ? "checked" : ""}><span>${checked ? "Working day" : "Day off"}</span></label><div class="work-pattern-times" ${checked ? "" : "hidden"}><label>Start<input type="time" data-work-start value="${escape(String(row?.start_time || "09:00").slice(0, 5))}"></label><label>Finish<input type="time" data-work-end value="${escape(String(row?.end_time || "17:00").slice(0, 5))}"></label></div></fieldset>`;
    }).join("");
    target.innerHTML = `<div class="section-heading-row"><div><h2>Working pattern</h2><p class="muted">Set your usual weekly hours once. Fuel Guard uses the event time to compare fuelling at work with fuelling outside work—there is no Work Mode to start or stop.</p></div></div><form id="workPatternForm" class="work-pattern-form"><p class="work-pattern-timezone">Times use <strong>${escape(timezoneName())}</strong>. Overnight shifts are supported.</p><div class="work-pattern-days">${rows}</div><button class="primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "Saving…" : "Save working pattern"}</button></form>${message ? `<p class="row-note" role="status">${escape(message)}</p>` : ""}`;
  }
  function metricCard(label, workValue, everydayValue) {
    return `<article><span>${escape(label)}</span><div><strong>${escape(workValue)}</strong><small>Work</small></div><div><strong>${escape(everydayValue)}</strong><small>Outside work</small></div></article>`;
  }
  function renderAnalytics() {
    const target = document.getElementById("athleteWorkContextAnalytics");
    if (!target) return;
    if (!pattern?.active || !patternDays.some(row => row.is_work_day)) {
      target.innerHTML = `<article class="card work-context-card"><span>Automatic context</span><h2>Work and Everyday</h2><p>Add your usual hours in Settings to compare fuelling patterns at work with the rest of your day. Historical events will be classified from their timestamps.</p><button class="secondary" type="button" data-open-work-settings>Add working pattern</button></article>`;
      return;
    }
    const result = analytics();
    const work = result.work;
    const everyday = result.everyday;
    target.innerHTML = `<article class="card work-context-card"><div class="section-heading-row"><div><span>Last ${ANALYTICS_DAYS} days</span><h2>Work and Everyday</h2><p class="muted">Training events are kept in Training context. These comparisons update if your working pattern changes.</p></div><button class="secondary" type="button" data-open-work-settings>Edit pattern</button></div>${result.sample ? `<div class="work-context-metrics">${metricCard("Average fuel gap", formatDuration(work.averageGap), formatDuration(everyday.averageGap))}${metricCard("Longest fuel gap", formatDuration(work.longestGap), formatDuration(everyday.longestGap))}${metricCard("Fuel event frequency", Number.isFinite(work.frequency) ? `${work.frequency.toFixed(1)} / observed day` : "—", Number.isFinite(everyday.frequency) ? `${everyday.frequency.toFixed(1)} / observed day` : "—")}</div><div class="work-context-boundaries"><span>Typical first work fuel <strong>${formatTime(work.firstTime)}</strong></span><span>Typical last work fuel <strong>${formatTime(work.lastTime)}</strong></span></div>` : `<p class="muted">No Fuel events fall within this comparison period yet.</p>`}</article>`;
  }
  function render() { renderSettings(); renderAnalytics(); }

  async function load() {
    const userId = String(cloud()?.user?.id || "");
    if (!userId || !cloud()?.client) { owner = ""; pattern = null; patternDays = []; message = ""; render(); return; }
    if (owner && owner !== userId) { pattern = null; patternDays = []; }
    owner = userId;
    const [patternResult, daysResult] = await Promise.all([
      cloud().client.from(PATTERNS).select("user_id,timezone_name,active,created_at,updated_at").eq("user_id", userId).maybeSingle(),
      cloud().client.from(DAYS).select("user_id,day_of_week,is_work_day,start_time,end_time,created_at,updated_at").eq("user_id", userId).order("day_of_week")
    ]);
    const error = patternResult.error || daysResult.error;
    if (error) {
      message = /does not exist|schema cache/i.test(error.message || "") ? "Working pattern is waiting for its release migration." : "Working pattern could not sync.";
      render();
      return;
    }
    if (String(cloud()?.user?.id || "") !== userId) return;
    pattern = patternResult.data || null;
    patternDays = daysResult.data || [];
    message = "";
    render();
  }
  async function savePattern(event) {
    event.preventDefault();
    if (busy || !owner || !cloud()?.client) return;
    const rows = [...document.querySelectorAll("[data-work-pattern-day]")].map(fieldset => {
      const isWorkDay = Boolean(fieldset.querySelector("[data-work-enabled]")?.checked);
      return {
        user_id: owner,
        day_of_week: Number(fieldset.dataset.workPatternDay),
        is_work_day: isWorkDay,
        start_time: isWorkDay ? fieldset.querySelector("[data-work-start]")?.value || "09:00" : null,
        end_time: isWorkDay ? fieldset.querySelector("[data-work-end]")?.value || "17:00" : null
      };
    });
    if (rows.some(row => row.is_work_day && row.start_time === row.end_time)) { message = "A working day needs different start and finish times."; render(); return; }
    busy = true;
    message = "";
    render();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const patternResult = await cloud().client.from(PATTERNS).upsert({ user_id: owner, timezone_name: timeZone, active: true }, { onConflict: "user_id" }).select().single();
    const daysResult = patternResult.error ? null : await cloud().client.from(DAYS).upsert(rows, { onConflict: "user_id,day_of_week" }).select();
    busy = false;
    const error = patternResult.error || daysResult?.error;
    if (error) { message = `Working pattern could not save: ${error.message}`; render(); return; }
    pattern = patternResult.data;
    patternDays = daysResult.data || rows;
    message = "Working pattern saved. Past and future events now use this schedule automatically.";
    render();
    window.dispatchEvent?.(new CustomEvent("fuelguard:work-pattern-updated", { detail: { timezoneName: pattern.timezone_name } }));
  }

  document.addEventListener("change", event => {
    const toggle = event.target.closest("[data-work-enabled]");
    if (!toggle) return;
    const row = toggle.closest("[data-work-pattern-day]");
    const times = row?.querySelector(".work-pattern-times");
    if (times) times.hidden = !toggle.checked;
    const label = row?.querySelector(".work-pattern-toggle span");
    if (label) label.textContent = toggle.checked ? "Working day" : "Day off";
  });
  document.addEventListener("submit", event => { if (event.target.id === "workPatternForm") savePattern(event); });
  document.addEventListener("click", event => {
    if (!event.target.closest("[data-open-work-settings]")) return;
    document.querySelector('[data-open-screen="checklist"]')?.click();
    window.FuelGuardSettingsNavigation?.showCategory?.("work");
  });
  window.addEventListener("fuelguard:auth-state", load);
  window.addEventListener("fuelguard:private-app-ready", load);
  window.addEventListener("fuelguard:cloud-status", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
  document.addEventListener("DOMContentLoaded", load);

  const api = Object.freeze({
    load,
    render,
    activeSession,
    contextForEvent,
    isDuringWork,
    classifyEvent,
    analytics,
    ensureSessionSyncedForLog,
    syncCloud: load,
    _test: Object.freeze({ timeMinutes, localParts, rowContains, isDuringPattern, previousDayOfWeek, contextMetrics, formatDuration, formatTime })
  });
  window.FuelGuardWorkContext = api;
  window.FuelGuardWorkMode = api;
})();
