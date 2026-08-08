// Workout-relative fuelling analysis for the canonical athlete PWA.
(() => {
  const WINDOW_DAYS = 14;
  const RECENT_SESSION_LIMIT = 5;
  const GARMIN_TABLE = "garmin_activity_summaries";
  const TRAINING_ASSIGNMENTS_TABLE = "fuel_training_session_athletes";
  const TRAINING_SESSIONS_TABLE = "fuel_training_sessions";

  let remoteState = {
    userId: "",
    loading: false,
    loaded: false,
    workouts: [],
    error: ""
  };

  function domain() {
    return window.FuelGuardDomain;
  }

  function localFuelState() {
    return typeof fuelGapState === "function" ? fuelGapState() : { logs: [], demandBlocks: [] };
  }

  function athleteTimeZone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  }

  function analysisWindow(now = new Date()) {
    return {
      start: new Date(now.getTime() - WINDOW_DAYS * 86400000),
      end: now
    };
  }

  function localTrainingWorkouts(now = new Date()) {
    const state = localFuelState();
    const windowRange = analysisWindow(now);
    return (Array.isArray(state.demandBlocks) ? state.demandBlocks : [])
      .filter(block => block?.type === "training")
      .map(block => ({
        id: block.id || block.cloudId,
        athleteId: window.fuelGuardCloud?.user?.id || "",
        source: "manual",
        type: block.sessionType || "training",
        title: block.title || "",
        startAt: block.startTime,
        endAt: block.endTime,
        timeZone: athleteTimeZone()
      }))
      .map(domain().normalizeWorkout)
      .filter(workout => workout && workout.endAt <= windowRange.end && workout.endAt >= windowRange.start);
  }

  function rowWorkouts(garminRows = [], assignments = [], sessions = []) {
    const athleteId = window.fuelGuardCloud?.user?.id || "";
    const sessionById = new Map(sessions.map(session => [String(session.id), session]));
    const teamWorkouts = assignments.map(assignment => {
      const session = sessionById.get(String(assignment.session_id));
      return session ? {
        ...session,
        athleteId: assignment.athlete_id || athleteId,
        source: session.source === "external_provider" ? session.source_provider : "coach_schedule",
        sourceActivityId: session.external_session_id || "",
        type: session.session_type,
        title: session.session_name,
        startAt: session.starts_at,
        endAt: session.ends_at,
        timeZone: session.timezone_name
      } : null;
    }).filter(Boolean);

    return [
      ...garminRows.map(row => ({ ...row, athleteId: row.user_id || athleteId })),
      ...teamWorkouts
    ];
  }

  async function loadRemoteWorkouts({ force = false } = {}) {
    const cloud = window.fuelGuardCloud;
    const userId = cloud?.user?.id || "";
    const client = cloud?.client;
    if (!userId || !client?.from) {
      remoteState = { userId: "", loading: false, loaded: true, workouts: [], error: "" };
      render();
      return;
    }
    if (remoteState.loading || (!force && remoteState.loaded && remoteState.userId === userId)) return;

    remoteState = { ...remoteState, userId, loading: true, error: "" };
    render();
    const windowRange = analysisWindow();
    try {
      const [garminResult, assignmentResult] = await Promise.all([
        client
          .from(GARMIN_TABLE)
          .select("id,user_id,source,source_activity_id,activity_type,started_at,duration_seconds")
          .eq("user_id", userId)
          .gte("started_at", windowRange.start.toISOString())
          .lte("started_at", windowRange.end.toISOString())
          .order("started_at", { ascending: false }),
        client
          .from(TRAINING_ASSIGNMENTS_TABLE)
          .select("session_id,athlete_id")
          .eq("athlete_id", userId)
      ]);
      if (garminResult.error) throw garminResult.error;
      if (assignmentResult.error) throw assignmentResult.error;

      const assignments = assignmentResult.data || [];
      let sessions = [];
      if (assignments.length) {
        const sessionResult = await client
          .from(TRAINING_SESSIONS_TABLE)
          .select("id,starts_at,ends_at,timezone_name,session_type,session_name,source,source_provider,external_session_id")
          .in("id", assignments.map(row => row.session_id))
          .gte("ends_at", windowRange.start.toISOString())
          .lte("ends_at", windowRange.end.toISOString())
          .order("starts_at", { ascending: false });
        if (sessionResult.error) throw sessionResult.error;
        sessions = sessionResult.data || [];
      }

      remoteState = {
        userId,
        loading: false,
        loaded: true,
        workouts: rowWorkouts(garminResult.data || [], assignments, sessions),
        error: ""
      };
    } catch (error) {
      remoteState = {
        userId,
        loading: false,
        loaded: true,
        workouts: [],
        error: error?.message || "Training data is not available yet."
      };
    }
    render();
  }

  function titleForWorkout(workout) {
    if (workout.title) return workout.title;
    return String(workout.type || "Training")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function sourceLabel(source) {
    if (source === "garmin") return "Garmin";
    if (source === "coach_schedule") return "Team schedule";
    if (source === "manual") return "Manual";
    return String(source || "Training").replace(/[_-]+/g, " ");
  }

  function dateLabel(value, timeZone) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short"
    }).format(value);
  }

  function sessionCard(context, timeZone) {
    const workout = context.workout;
    const previous = context.previousFuelEvent;
    const next = context.nextFuelEvent;
    return `
      <article class="training-fuel-session">
        <div class="training-fuel-session-head">
          <div>
            <h4>${domain().escapeHtml(titleForWorkout(workout))}</h4>
            <p>${domain().escapeHtml(`${dateLabel(workout.startAt, timeZone)} · ${domain().formatClockInTimeZone(workout.startAt, timeZone)}–${domain().formatClockInTimeZone(workout.endAt, timeZone)}`)}</p>
          </div>
          <span>${domain().escapeHtml(sourceLabel(workout.source))}</span>
        </div>
        <div class="training-fuel-pair">
          <section>
            <span>Before training</span>
            <strong>${previous ? domain().escapeHtml(domain().duration(context.preFuelGapMinutes)) : "No prior fuel logged"}</strong>
            <small>${previous ? domain().escapeHtml(`Last fuel: ${domain().formatClockInTimeZone(previous.date, timeZone)}`) : "No earlier fuel event is available."}</small>
          </section>
          <section>
            <span>After training</span>
            <strong>${next ? domain().escapeHtml(domain().duration(context.postFuelGapMinutes)) : "No post-session fuel logged"}</strong>
            <small>${next ? domain().escapeHtml(`Next fuel: ${domain().formatClockInTimeZone(next.date, timeZone)}`) : "No later fuel event is available."}</small>
          </section>
        </div>
      </article>
    `;
  }

  function summaryCards(summary) {
    const cards = [];
    if (Number.isFinite(summary.averagePreFuelGapMinutes)) {
      cards.push(["Average pre-training fuel gap", domain().duration(summary.averagePreFuelGapMinutes)]);
    }
    if (Number.isFinite(summary.averagePostFuelGapMinutes)) {
      cards.push(["Average post-training fuel gap", domain().duration(summary.averagePostFuelGapMinutes)]);
    }
    if (summary.extendedPreFuelGapCount > 0 && Number.isFinite(summary.targetMinutes)) {
      cards.push(["Longer gap before training", `${summary.extendedPreFuelGapCount} of ${summary.sessionCount} sessions`]);
    }
    if (summary.noPostFuelSameDayCount > 0) {
      cards.push(["No post-session fuel logged that day", `${summary.noPostFuelSameDayCount} session${summary.noPostFuelSameDayCount === 1 ? "" : "s"}`]);
    }
    return cards.length ? `
      <div class="training-fuel-summary-grid">
        ${cards.map(([label, value]) => `<article><span>${domain().escapeHtml(label)}</span><strong>${domain().escapeHtml(value)}</strong></article>`).join("")}
      </div>
    ` : "";
  }

  function render() {
    const target = document.getElementById("trainingFuelAnalysis");
    if (!target || !domain()) return;
    const local = localFuelState();
    const timeZone = athleteTimeZone();
    const workouts = domain().normalizeWorkouts([
      ...localTrainingWorkouts(),
      ...(remoteState.workouts || [])
    ]).filter(workout => workout.endAt <= new Date());
    const fuelLogs = Array.isArray(local.logs) ? local.logs : [];
    const contexts = domain().getWorkoutFuelContexts(workouts, fuelLogs);
    const summary = domain().aggregateWorkoutFuelContexts(contexts, {
      targetMinutes: Number(local.maximumFuelGapMinutes),
      timeZone
    });

    if (!remoteState.loaded && !remoteState.loading) requestAnimationFrame(() => loadRemoteWorkouts());

    let content = "";
    if (remoteState.loading && !contexts.length) {
      content = `<div class="training-fuel-empty" role="status">Loading recent training sessions…</div>`;
    } else if (!contexts.length) {
      content = `<div class="training-fuel-empty">${fuelLogs.some(domain().isFuelLog)
        ? "Connect your training data to see how your fuelling lines up with your sessions."
        : "Connect a workout and log fuel to start seeing pre/post training patterns."}</div>`;
    } else if (!fuelLogs.some(domain().isFuelLog)) {
      content = `<div class="training-fuel-empty">Log fuel around your training to start seeing patterns.</div>`;
    } else {
      content = `
        ${summaryCards(summary)}
        ${summary.eveningLonger ? `<p class="training-fuel-pattern">Repeated pattern: evening sessions tend to follow longer fuel gaps.</p>` : ""}
        ${summary.enoughForPatterns ? "" : `<p class="training-fuel-pattern muted">More sessions are needed before Fuel Guard can identify a pattern.</p>`}
        <div class="training-fuel-session-list">${contexts.slice(0, RECENT_SESSION_LIMIT).map(context => sessionCard(context, timeZone)).join("")}</div>
      `;
    }

    target.innerHTML = `
      <section class="training-fuel-card" aria-label="Pre/Post Training Fuel">
        <div class="training-fuel-heading">
          <div>
            <p>Analysis</p>
            <h3>Pre/Post Training Fuel</h3>
            <span>See when fuel was logged before and after each completed session.</span>
          </div>
          ${remoteState.loaded ? `<button type="button" class="secondary" data-refresh-training-fuel>Refresh</button>` : ""}
        </div>
        ${content}
        ${remoteState.error ? `<p class="training-fuel-error">${domain().escapeHtml(remoteState.error)} Manual training sessions remain available.</p>` : ""}
        <p class="training-fuel-note">Timing awareness only. Fuel Guard does not assess calories, nutritional adequacy, or medical risk.</p>
      </section>
    `;
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-refresh-training-fuel]")) loadRemoteWorkouts({ force: true });
  });
  window.addEventListener("fuelguard:cloud-status", () => {
    remoteState.loaded = false;
    render();
  });
  window.addEventListener("online", () => loadRemoteWorkouts({ force: true }));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadRemoteWorkouts({ force: true });
  });
  document.addEventListener("DOMContentLoaded", render);
  requestAnimationFrame(render);

  window.FuelGuardTrainingFuel = { render, loadRemoteWorkouts };
})();
