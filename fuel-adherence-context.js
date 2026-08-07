// Shared fuel-gap context and adherence calculations for athlete and coach views.
(function attachFuelGuardAdherence(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FuelGuardAdherence = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardAdherence() {
  const DEFAULT_TARGET_MINUTES = 180;
  const DEFAULT_MINIMUM_EXCEEDANCE_MINUTES = 15;
  const SLEEPY_AFTER_GAP_MINUTES = 120;
  const TRAINING_PERIODS = Object.freeze([
    { id: "morning", label: "Morning", startMinute: 300, endMinute: 720 },
    { id: "afternoon", label: "Afternoon", startMinute: 720, endMinute: 1020 },
    { id: "evening", label: "Evening", startMinute: 1020, endMinute: 1440 }
  ]);
  const BARRIER_OPTIONS = Object.freeze([
    { id: "training", label: "Training" },
    { id: "busy", label: "Busy" },
    { id: "no_food_available", label: "No food available" },
    { id: "travel", label: "Travel" },
    { id: "forgot", label: "Forgot" },
    { id: "plan_didnt_fit", label: "Plan didn't fit" },
    { id: "fuelled_not_logged", label: "Fuelled but forgot to log", dataQuality: "timing_uncertain" },
    { id: "other", label: "Other" }
  ]);

  function parseDate(value) {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const text = String(value || "").trim();
    if (!text) return null;
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function logDate(log) {
    if (!log || typeof log !== "object") return parseDate(log);
    for (const value of [log.date, log.timestamp, log.logged_at, log.loggedAt, log.time, log.created_at]) {
      const date = parseDate(value);
      if (date) return date;
    }
    return null;
  }

  function dateKey(value = new Date()) {
    const date = parseDate(value) || new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function logType(log) {
    const type = String(log?.type || log?.logType || "fuel").toLowerCase();
    if (type === "fuel_hydration") return type;
    if (type === "hydration") return type;
    if (type === "sleepy") return type;
    if (type === "checkin") {
      if (String(log?.checkin?.checkinType || "").toLowerCase() === "sleepy") return "sleepy";
      const note = String(log?.notes || log?.note || "");
      if (/"checkinType"\s*:\s*"sleepy"/i.test(note)) return "sleepy";
    }
    return "fuel";
  }

  function isFuelLog(log) {
    const type = logType(log);
    return type === "fuel" || type === "fuel_hydration";
  }

  function isSleepyLog(log) {
    return logType(log) === "sleepy";
  }

  function eventId(log) {
    return String(log?.cloudId || log?.id || log?.localId || log?.external_event_id || log?.externalEventId || "");
  }

  function stableGapKey(previousLog, nextLog, start, end, ongoing = false) {
    const previousId = eventId(previousLog);
    const nextId = eventId(nextLog);
    if (previousId && (nextId || ongoing)) return `${ongoing ? "ongoing" : "completed"}:${previousId}:${nextId || "current"}`;
    return `${ongoing ? "ongoing" : "completed"}:${start.toISOString()}:${end.toISOString()}`;
  }

  function safeTarget(value) {
    const target = Number(value);
    return Number.isFinite(target) && target > 0 ? Math.round(target) : DEFAULT_TARGET_MINUTES;
  }

  function fuelGapEpisodes({
    logs = [],
    targetMinutes = DEFAULT_TARGET_MINUTES,
    referenceTime = new Date(),
    includeOngoing = true,
    minimumExceedanceMinutes = DEFAULT_MINIMUM_EXCEEDANCE_MINUTES
  } = {}) {
    const target = safeTarget(targetMinutes);
    const now = parseDate(referenceTime) || new Date();
    const fuelLogs = (Array.isArray(logs) ? logs : [])
      .filter(isFuelLog)
      .map(log => ({ log, date: logDate(log) }))
      .filter(item => item.date)
      .sort((a, b) => a.date - b.date);
    const gaps = [];

    for (let index = 1; index < fuelLogs.length; index += 1) {
      const previous = fuelLogs[index - 1];
      const next = fuelLogs[index];
      if (dateKey(previous.date) !== dateKey(next.date)) continue;
      const actualMinutes = Math.max(0, (next.date - previous.date) / 60000);
      const exceededMinutes = Math.max(0, actualMinutes - target);
      gaps.push({
        gapKey: stableGapKey(previous.log, next.log, previous.date, next.date, false),
        date: dateKey(previous.date),
        start: previous.date,
        end: next.date,
        precedingFuelEventId: eventId(previous.log),
        followingFuelEventId: eventId(next.log),
        targetMinutes: target,
        actualMinutes,
        exceededMinutes,
        isExcessive: exceededMinutes > 0,
        isMeaningful: exceededMinutes >= minimumExceedanceMinutes,
        ongoing: false
      });
    }

    const latest = fuelLogs[fuelLogs.length - 1];
    if (includeOngoing && latest && dateKey(latest.date) === dateKey(now) && now > latest.date) {
      const actualMinutes = (now - latest.date) / 60000;
      const exceededMinutes = Math.max(0, actualMinutes - target);
      gaps.push({
        gapKey: stableGapKey(latest.log, null, latest.date, now, true),
        date: dateKey(latest.date),
        start: latest.date,
        end: now,
        precedingFuelEventId: eventId(latest.log),
        followingFuelEventId: "",
        targetMinutes: target,
        actualMinutes,
        exceededMinutes,
        isExcessive: exceededMinutes > 0,
        isMeaningful: exceededMinutes >= minimumExceedanceMinutes,
        ongoing: true
      });
    }

    return gaps;
  }

  function intervalOverlap(start, end, otherStart, otherEnd) {
    const leftStart = parseDate(start);
    const leftEnd = parseDate(end);
    const rightStart = parseDate(otherStart);
    const rightEnd = parseDate(otherEnd);
    if (!leftStart || !leftEnd || !rightStart || !rightEnd || leftEnd <= leftStart || rightEnd <= rightStart) return null;
    if (!(rightStart < leftEnd && rightEnd > leftStart)) return null;
    const overlapStart = new Date(Math.max(leftStart.getTime(), rightStart.getTime()));
    const overlapEnd = new Date(Math.min(leftEnd.getTime(), rightEnd.getTime()));
    return {
      start: overlapStart,
      end: overlapEnd,
      minutes: Math.max(0, (overlapEnd - overlapStart) / 60000)
    };
  }

  function normalizeExactTrainingSession(row) {
    const start = parseDate(row?.starts_at || row?.start_time || row?.startTime || row?.start);
    const end = parseDate(row?.ends_at || row?.end_time || row?.endTime || row?.end);
    if (!start || !end || end <= start) return null;
    return {
      id: String(row?.id || row?.session_id || row?.external_session_id || ""),
      start,
      end,
      source: String(row?.source || row?.source_provider || "exact").toLowerCase(),
      activityType: String(row?.activity_type || row?.session_type || row?.type || "Training"),
      exact: true
    };
  }

  function normalizePeriods(value) {
    const values = Array.isArray(value) ? value : String(value || "").split(",");
    const selected = [...new Set(values.map(item => String(item || "").trim().toLowerCase()).filter(Boolean))];
    if (selected.includes("none") || selected.includes("no_training")) return [];
    return selected.filter(id => TRAINING_PERIODS.some(period => period.id === id));
  }

  function normalizeDailyContext(row = {}) {
    return {
      id: String(row.id || row.cloudId || ""),
      userId: String(row.user_id || row.userId || ""),
      date: String(row.context_date || row.date || ""),
      environmentContext: String(row.environment_context || row.environmentContext || "").toLowerCase(),
      trainingPeriods: normalizePeriods(row.training_periods || row.trainingPeriods),
      updatedAt: String(row.updated_at || row.updatedAt || "")
    };
  }

  function minutesIntoDay(value) {
    const date = parseDate(value);
    return date ? date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60 : NaN;
  }

  function fallbackPeriodOverlap(gap, periods = []) {
    const selected = normalizePeriods(periods);
    if (!selected.length || dateKey(gap.start) !== dateKey(gap.end)) return [];
    const gapStart = minutesIntoDay(gap.start);
    const gapEnd = minutesIntoDay(gap.end);
    return TRAINING_PERIODS.filter(period => selected.includes(period.id))
      .filter(period => period.startMinute < gapEnd && period.endMinute > gapStart)
      .map(period => ({ id: period.id, label: period.label }));
  }

  function trainingContextForGap(gap, { exactSessions = [], dailyContexts = [] } = {}) {
    const sessions = (Array.isArray(exactSessions) ? exactSessions : []).map(normalizeExactTrainingSession).filter(Boolean);
    const availableDaySessions = sessions.filter(session => dateKey(session.start) === gap.date || dateKey(session.end) === gap.date);
    const garminDaySessions = availableDaySessions.filter(session => session.source.includes("garmin"));
    const daySessions = garminDaySessions.length ? garminDaySessions : availableDaySessions;
    const exactOverlaps = daySessions.map(session => {
      const overlap = intervalOverlap(gap.start, gap.end, session.start, session.end);
      return overlap ? { ...session, overlap } : null;
    }).filter(Boolean);
    if (daySessions.length) {
      const overlapMinutes = exactOverlaps.reduce((sum, session) => sum + session.overlap.minutes, 0);
      return {
        overlaps: exactOverlaps.length > 0,
        precision: "exact",
        sessions: exactOverlaps,
        periods: [],
        overlapMinutes,
        overlapPct: gap.actualMinutes > 0 ? Math.min(100, Math.round(overlapMinutes / gap.actualMinutes * 100)) : 0
      };
    }

    const context = (Array.isArray(dailyContexts) ? dailyContexts : [])
      .map(normalizeDailyContext)
      .find(item => item.date === gap.date);
    const periods = fallbackPeriodOverlap(gap, context?.trainingPeriods || []);
    return {
      overlaps: periods.length > 0,
      precision: context?.trainingPeriods?.length ? "period" : "none",
      sessions: [],
      periods,
      overlapMinutes: null,
      overlapPct: null
    };
  }

  function normalizeBarrierResponse(row = {}) {
    const barrier = String(row.barrier_reason || row.barrierReason || "unknown").toLowerCase();
    const status = String(row.response_status || row.responseStatus || (barrier === "unknown" ? "skipped" : "answered")).toLowerCase();
    return {
      id: String(row.id || row.cloudId || ""),
      userId: String(row.user_id || row.userId || ""),
      gapKey: String(row.gap_key || row.gapKey || ""),
      barrierReason: barrier,
      barrierLabel: BARRIER_OPTIONS.find(item => item.id === barrier)?.label || (barrier === "unknown" ? "Unknown" : "Other"),
      note: String(row.note || ""),
      responseStatus: status,
      dataQualityStatus: String(row.data_quality_status || row.dataQualityStatus || (barrier === "fuelled_not_logged" ? "timing_uncertain" : "confirmed")),
      createdAt: String(row.created_at || row.createdAt || "")
    };
  }

  function enrichGaps(gaps = [], { exactSessions = [], dailyContexts = [], barrierResponses = [] } = {}) {
    const responseByGap = new Map((Array.isArray(barrierResponses) ? barrierResponses : []).map(normalizeBarrierResponse).map(item => [item.gapKey, item]));
    return (Array.isArray(gaps) ? gaps : []).map(gap => ({
      ...gap,
      training: trainingContextForGap(gap, { exactSessions, dailyContexts }),
      barrier: responseByGap.get(gap.gapKey) || null
    }));
  }

  function barrierRecordFromGap(gap, { reason = "unknown", note = "", userId = "", trainingReferenceId = "" } = {}) {
    const selected = BARRIER_OPTIONS.find(item => item.id === reason);
    const barrierReason = selected?.id || "unknown";
    const training = gap.training || {};
    const trainingSession = training.sessions?.[0] || null;
    const trainingSource = String(trainingSession?.source || "").toLowerCase();
    const trainingReferenceType = !trainingSession
      ? ""
      : trainingSource.includes("garmin")
        ? "garmin_activity"
        : trainingSource.includes("team")
          ? "team_schedule"
          : trainingSource.includes("demand")
            ? "demand_block"
            : "manual_exact";
    return {
      id: "",
      userId,
      gapKey: gap.gapKey,
      gapStart: gap.start.toISOString(),
      gapEnd: gap.end.toISOString(),
      targetMinutes: Math.round(gap.targetMinutes),
      actualMinutes: Math.round(gap.actualMinutes),
      exceededMinutes: Math.round(gap.exceededMinutes),
      barrierReason,
      note: String(note || "").trim().slice(0, 240),
      responseStatus: barrierReason === "unknown" ? "skipped" : "answered",
      dataQualityStatus: selected?.dataQuality || "confirmed",
      precedingFuelEventId: gap.precedingFuelEventId || "",
      followingFuelEventId: gap.followingFuelEventId || "",
      wasOngoing: Boolean(gap.ongoing),
      trainingOverlapKind: training.overlaps ? training.precision : "none",
      trainingReferenceType,
      trainingReferenceId: trainingReferenceId || trainingSession?.id || "",
      createdAt: new Date().toISOString(),
      syncStatus: "pending"
    };
  }

  function median(values = []) {
    const numbers = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!numbers.length) return null;
    const middle = Math.floor(numbers.length / 2);
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2;
  }

  function mostCommon(items = [], valueFor) {
    const counts = new Map();
    items.forEach(item => {
      const value = valueFor(item);
      if (!value) return;
      counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0] || null;
  }

  function windowForGap(gap) {
    const start = Math.floor(minutesIntoDay(gap.start) / 60);
    const end = Math.min(24, Math.max(start + 1, Math.ceil(minutesIntoDay(gap.end) / 60)));
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "";
    return `${String(start).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00`;
  }

  function summarizeAdherence({ gaps = [], sleepyLogs = [], dailyContexts = [] } = {}) {
    const enriched = Array.isArray(gaps) ? gaps : [];
    const completed = enriched.filter(gap => !gap.ongoing);
    const excessive = completed.filter(gap => gap.exceededMinutes > 0);
    const uncertain = excessive.filter(gap => gap.barrier?.dataQualityStatus === "timing_uncertain");
    const behaviouralExcessive = excessive.filter(gap => gap.barrier?.dataQualityStatus !== "timing_uncertain");
    const measurable = completed.filter(gap => gap.barrier?.dataQualityStatus !== "timing_uncertain");
    const days = [...new Set(measurable.map(gap => gap.date))];
    const daysWithinTarget = days.filter(key => !measurable.some(gap => gap.date === key && gap.exceededMinutes > 0)).length;
    const exceedances = behaviouralExcessive.map(gap => gap.exceededMinutes);
    const trainingOverlaps = behaviouralExcessive.filter(gap => gap.training?.overlaps);
    const commonWindow = mostCommon(behaviouralExcessive, windowForGap);
    const barrierCounts = BARRIER_OPTIONS.map(option => ({
      id: option.id,
      label: option.label,
      count: behaviouralExcessive.filter(gap => gap.barrier?.barrierReason === option.id).length
    })).filter(item => item.count).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const contextByDate = new Map((Array.isArray(dailyContexts) ? dailyContexts : []).map(normalizeDailyContext).map(item => [item.date, item]));
    const contextCounts = ["travel", "competition", "shift"].map(id => ({
      id,
      count: behaviouralExcessive.filter(gap => contextByDate.get(gap.date)?.environmentContext === id).length
    })).filter(item => item.count);
    const periodCounts = TRAINING_PERIODS.map(period => ({
      id: period.id,
      label: period.label,
      count: behaviouralExcessive.filter(gap => gap.training?.periods?.some(item => item.id === period.id)).length
    })).filter(item => item.count);
    const sleepyDates = (Array.isArray(sleepyLogs) ? sleepyLogs : []).filter(isSleepyLog).map(logDate).filter(Boolean);
    const sleepyAssociations = behaviouralExcessive.map(gap => {
      const endWithFollowUp = new Date(gap.end.getTime() + SLEEPY_AFTER_GAP_MINUTES * 60000);
      const events = sleepyDates.filter(date => date >= gap.start && date <= endWithFollowUp);
      return { gapKey: gap.gapKey, count: events.length, eventTimes: events.map(date => date.toISOString()) };
    }).filter(item => item.count);

    return {
      measuredGapCount: measurable.length,
      measurableDayCount: days.length,
      daysWithinTarget,
      targetAdherencePct: days.length ? Math.round(daysWithinTarget / days.length * 100) : null,
      targetExceedanceCount: behaviouralExcessive.length,
      averageExceededMinutes: exceedances.length ? exceedances.reduce((sum, value) => sum + value, 0) / exceedances.length : null,
      medianExceededMinutes: median(exceedances),
      commonExcessiveGapWindow: commonWindow ? { label: commonWindow[0], count: commonWindow[1] } : null,
      trainingOverlapCount: trainingOverlaps.length,
      trainingOverlapDenominator: behaviouralExcessive.length,
      trainingOverlapPct: behaviouralExcessive.length ? Math.round(trainingOverlaps.length / behaviouralExcessive.length * 100) : null,
      barrierCounts,
      mostCommonBarrier: barrierCounts[0] || null,
      loggingUncertainCount: uncertain.length,
      loggingUncertainPct: excessive.length ? Math.round(uncertain.length / excessive.length * 100) : 0,
      behaviouralGapCount: behaviouralExcessive.length,
      trainingPeriodCounts: periodCounts,
      environmentContextCounts: contextCounts,
      sleepyAssociationCount: sleepyAssociations.reduce((sum, item) => sum + item.count, 0),
      sleepyAssociations
    };
  }

  function aggregateTeamAdherence(athleteSummaries = []) {
    const summaries = Array.isArray(athleteSummaries) ? athleteSummaries : [];
    const totalExcessive = summaries.reduce((sum, item) => sum + Number(item.targetExceedanceCount || 0), 0);
    const trainingOverlapCount = summaries.reduce((sum, item) => sum + Number(item.trainingOverlapCount || 0), 0);
    const barrierCounts = new Map();
    summaries.flatMap(item => item.barrierCounts || []).forEach(item => {
      barrierCounts.set(item.id, { ...item, count: (barrierCounts.get(item.id)?.count || 0) + item.count });
    });
    return {
      athleteCount: summaries.length,
      athletesWithExcessiveGaps: summaries.filter(item => item.targetExceedanceCount > 0).length,
      targetExceedanceCount: totalExcessive,
      trainingOverlapCount,
      trainingOverlapPct: totalExcessive ? Math.round(trainingOverlapCount / totalExcessive * 100) : null,
      barrierCounts: [...barrierCounts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      athletesWithInsufficientData: summaries.filter(item => !item.measurableGapCount).length
    };
  }

  return Object.freeze({
    DEFAULT_TARGET_MINUTES,
    DEFAULT_MINIMUM_EXCEEDANCE_MINUTES,
    TRAINING_PERIODS,
    BARRIER_OPTIONS,
    parseDate,
    logDate,
    dateKey,
    isFuelLog,
    isSleepyLog,
    stableGapKey,
    fuelGapEpisodes,
    intervalOverlap,
    normalizeExactTrainingSession,
    normalizePeriods,
    normalizeDailyContext,
    fallbackPeriodOverlap,
    trainingContextForGap,
    normalizeBarrierResponse,
    enrichGaps,
    barrierRecordFromGap,
    summarizeAdherence,
    aggregateTeamAdherence
  });
});
