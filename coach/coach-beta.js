// Fuel Guard Coach Beta. Read-only coach views over explicitly shared athlete data.
(() => {
  const domain = window.FuelGuardDomain;
  const TABLES = {
    profiles: "fuel_user_profiles",
    relationships: "fuel_coach_athletes",
    logs: "fuel_logs",
    targets: "fuel_targets",
    reports: "fuel_coach_reports",
    interventions: "fuel_coach_interventions",
    attentionActions: "fuel_coach_attention_actions",
    notes: "fuel_coach_notes",
    nudges: "fuel_coach_nudges",
    schedules: "fuel_coach_review_schedules",
    organisations: "fuel_organisations",
    teams: "fuel_teams",
    teamStaff: "fuel_team_staff",
    teamAthletes: "fuel_team_athletes",
    staffNotes: "fuel_staff_notes",
    savedGroups: "fuel_saved_groups",
    savedGroupMembers: "fuel_saved_group_members",
    garminActivities: "garmin_activity_summaries",
    trainingModeSessions: "fuel_training_mode_sessions",
    demandBlocks: "fuel_demand_blocks",
    trainingSessions: "fuel_training_sessions",
    trainingAssignments: "fuel_training_session_athletes",
    trainingContext: "fuel_training_operational_context",
    trainingSessionNotes: "fuel_training_session_coach_notes"
  };
  const PATTERN_TYPES = [
    { id: "fuel", label: "Fuel", empty: "No fuel logged today", noun: "fuel log" },
    { id: "hydration", label: "Hydration", empty: "No hydration logged today", noun: "hydration log" },
    { id: "sleepy", label: "Sleepy", empty: "No Sleepy events logged today", noun: "Sleepy event" }
  ];
  const BUCKETS = [
    { label: "06:00", start: 6, end: 9 },
    { label: "09:00", start: 9, end: 12 },
    { label: "12:00", start: 12, end: 15 },
    { label: "15:00", start: 15, end: 18 },
    { label: "18:00", start: 18, end: 21 },
    { label: "21:00", start: 21, end: 24 }
  ];
  const COACH_SIGNUP_EMAIL_KEY = "fuel_guard_coach_signup_email";
  const ATHLETE_CODE_RE = /^FG-[A-Z0-9]{6}$/;

  const state = {
    client: null,
    session: null,
    profile: null,
    pointsProfile: null,
    relationships: [],
    athleteProfiles: [],
    logs: [],
    targets: [],
    reports: [],
    interventions: [],
    attentionActions: [],
    notes: [],
    nudges: [],
    dataHealthRows: [],
    teamDataHealth: { items: [], summary: {} },
    attentionItems: [],
    attentionComposer: null,
    pendingInterventionAttention: null,
    interventionReview: null,
    schedules: [],
    organisations: [],
    teams: [],
    teamStaff: [],
    teamAthletes: [],
    staffNotes: [],
    savedGroups: [],
    savedGroupMembers: [],
    garminActivities: [],
    trainingModeSessions: [],
    demandBlocks: [],
    trainingSessions: [],
    trainingAssignments: [],
    trainingSessionNotes: [],
    trainingContext: [],
    workoutFuelContexts: [],
    workoutFuelSummaries: [],
    organisationFeaturesReady: true,
    selectedGroupId: "",
    roster: [],
    weeklyBrief: null,
    teamSessionBrief: null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    currentTab: "dashboard",
    selectedAthleteId: "",
    selectedReportAthleteId: "",
    selectedScheduleId: "",
    selectedTrainingSessionId: "",
    editingTrainingSessionId: "",
    reportPeriod: "week",
    generatedReport: null,
    savedWeeklyReportId: "",
    reportSaved: false,
    selectedPattern: "fuel",
    athleteCodeQuery: "",
    athleteCodeResult: null,
    athleteCodeStatus: "",
    athleteCodeStatusDetail: "",
    authResolved: false,
    coachLoading: true,
    busy: false,
    coachAccessBlocked: false,
    status: ""
  };

  const platformController = window.FuelGuardCoachPlatformBridge?.connect({
    readState: () => state,
    getClient: () => state.client,
    refresh: ({ reason } = {}) => loadCoachData({ reason }),
    selectAthlete: athleteId => selectCoachAthlete(athleteId)
  }) || null;
  try {
    delete window.FuelGuardCoachPlatformBridge;
  } catch (_error) {}

  function $(id) {
    return document.getElementById(id);
  }

  function safe(value) {
    return domain.escapeHtml(value);
  }

  function configured() {
    const config = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    return Boolean(config.url && config.anonKey && window.supabase?.createClient);
  }

  function coachUser() {
    return state.session?.user || null;
  }

  function isCoachEnabled(profile = state.profile) {
    const role = String(profile?.role || "").toLowerCase();
    return Boolean(profile?.coach_enabled) || role === "coach";
  }

  function normalizeAthleteCode(value) {
    const compact = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
    const match = compact.match(/^FG[-_]?([A-Z0-9]{6})$/);
    return match ? `FG-${match[1]}` : compact;
  }

  function profileSelect() {
    return "user_id,role,coach_enabled,display_name,first_name,last_name,avatar_url,job_title,athlete_code,created_at,updated_at";
  }

  function setStatus(message) {
    state.status = message || "";
    const target = $("coachGlobalStatus");
    if (target) target.textContent = state.status;
    const authStatus = $("coachAuthStatus");
    if (authStatus && !authStatus.hidden) authStatus.textContent = state.status;
    const accessStatus = $("coachAccessStatus");
    if (accessStatus && !accessStatus.hidden) accessStatus.textContent = state.status;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Something went wrong.");
    if (/invalid login credentials/i.test(message)) return "Those login details did not work. Check the email and password, then try again.";
    if (/email not confirmed|confirm/i.test(message)) return "Please confirm your email address before logging in.";
    if (/already registered|already exists|user already/i.test(message)) return "This coach account may already exist. Try logging in, or wait before requesting another email.";
    if (/rate limit|email rate|over_email_send_rate_limit|exceeded/i.test(message)) return "Too many auth emails were requested while testing. Please wait around an hour before trying again.";
    if (/failed to fetch|network|load failed/i.test(message)) return "Could not reach Supabase. Check your connection and try again.";
    if (/supabase public url|anon key|configuration/i.test(message)) return "Coach Beta needs Supabase public URL/key configuration.";
    if (/enter an email and password|enter your email before|sign in first|select an assigned athlete|choose a valid|custom cadence|custom report period|assemble a review|scheduled review is no longer available|enter a group name|enter an organisation name|enter a team name|choose a team|choose an actively shared athlete|choose at least one authorised athlete|valid session start and end|local time does not exist|find an athlete by athlete code|can't add your own athlete|attention action unavailable|attention item has changed|attention action is no longer available|enter a nudge message|enter a note|enter a shared staff note|shared note access is no longer available|intervention not found|open an intervention review first/i.test(message)) return message;
    if (/weekly review|already completed|no longer editable|coach access denied/i.test(message)) return message;
    if (/fuel_user_profiles|fuel_coach_athletes|fuel_coach_reports|fuel_coach_interventions|fuel_coach_attention_actions|fuel_coach_notes|fuel_coach_nudges|fuel_coach_review_schedules|fuel_organisations|fuel_teams|fuel_team_|fuel_staff_notes|fuel_saved_group|fuel_training_|fuel_demand_blocks|garmin_activity_summaries|fuel_coach_find_athlete_by_code|fuel_coach_data_health|fuel_coach_refresh_due_interventions|athlete_code|coach_label|maximum_fuel_gap_minutes|does not exist|schema cache/i.test(message)) {
      return "Coach access is still warming up. Refresh and try again in a moment.";
    }
    return "Coach Beta could not complete that request. Try again in a moment.";
  }

  function rememberCoachSignup(email) {
    try {
      window.localStorage?.setItem(COACH_SIGNUP_EMAIL_KEY, String(email || "").toLowerCase());
    } catch (_error) {}
  }

  function consumeCoachSignup(user) {
    try {
      const saved = window.localStorage?.getItem(COACH_SIGNUP_EMAIL_KEY) || "";
      const matches = saved && String(user?.email || "").toLowerCase() === saved;
      if (matches) window.localStorage?.removeItem(COACH_SIGNUP_EMAIL_KEY);
      return matches;
    } catch (_error) {
      return false;
    }
  }

  function coachSignupIntent(user) {
    const metadata = user?.user_metadata || {};
    const localSignup = consumeCoachSignup(user);
    return Boolean(metadata.fuel_guard_coach_signup || metadata.coach_signup || localSignup);
  }

  function profileName(profile, relation) {
    return relation?.athlete_label || profile?.display_name || `Athlete ${String(relation?.athlete_id || profile?.user_id || "").slice(0, 8)}`;
  }

  function athleteRows() {
    const profileById = new Map(state.athleteProfiles.map(profile => [profile.user_id, profile]));
    return state.relationships
      .filter(relation => relation.status === "active")
      .map(relation => {
        const profile = profileById.get(relation.athlete_id) || {};
        return {
          userId: relation.athlete_id,
          displayName: profileName(profile, relation),
          relationId: relation.id,
          relationStatus: relation.status,
          sharingStartedAt: relation.accepted_at || relation.created_at || "",
          profile
        };
      });
  }

  function selectedGroup() {
    return state.savedGroups.find(group => String(group.id) === String(state.selectedGroupId)) || null;
  }

  function groupAthleteIds(groupId = state.selectedGroupId) {
    if (!groupId) return null;
    return new Set(state.savedGroupMembers
      .filter(member => String(member.group_id) === String(groupId))
      .map(member => String(member.athlete_id)));
  }

  function scopedAthleteRows() {
    const athletes = athleteRows();
    const allowed = groupAthleteIds();
    if (!allowed) return athletes;
    return athletes.filter(athlete => allowed.has(String(athlete.userId)));
  }

  function relationshipRows() {
    const profileById = new Map(state.athleteProfiles.map(profile => [profile.user_id, profile]));
    return state.relationships.map(relation => {
      const profile = profileById.get(relation.athlete_id) || {};
      return {
        userId: relation.athlete_id,
        displayName: profileName(profile, relation),
        relationId: relation.id,
        relationStatus: relation.status,
        profile
      };
    });
  }

  function targetsByUser() {
    return state.targets.reduce((map, row) => {
      map[row.user_id] = {
        dailyFuelLogs: row.daily_fuel_logs,
        dailyHydrationLogs: row.daily_hydration_logs,
        maximumFuelGapMinutes: row.maximum_fuel_gap_minutes
      };
      return map;
    }, {});
  }

  function rebuildRoster() {
    const previousAthleteId = state.selectedAthleteId;
    if (state.selectedGroupId && !selectedGroup()) state.selectedGroupId = "";
    const athletes = scopedAthleteRows();
    state.roster = domain.buildCoachRoster({
      athletes,
      logs: state.logs,
      targetsByUser: targetsByUser(),
      now: new Date()
    });
    state.weeklyBrief = domain.buildWeeklyCoachBrief({
      athletes,
      relationships: state.relationships,
      coachId: coachUser()?.id || "",
      logs: state.logs,
      targetsByUser: targetsByUser(),
      now: new Date(),
      timeZone: state.timeZone
    });
    state.teamSessionBrief = domain.buildTeamSessionCoachBrief({
      contexts: state.trainingContext,
      period: state.weeklyBrief.period,
      comparisonPeriod: state.weeklyBrief.comparisonPeriod,
      timeZone: state.timeZone
    });
    if (!state.roster.some(item => item.athlete.userId === state.selectedAthleteId)) {
      state.selectedAthleteId = state.roster[0]?.athlete.userId || "";
    }
    return previousAthleteId !== state.selectedAthleteId;
  }

  function rebuildWorkoutFuelData() {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 14 * 86400000);
    const sessionById = new Map(state.trainingSessions.map(session => [String(session.id), session]));
    const seenTeamWorkout = new Set();
    const teamWorkouts = state.trainingContext.map(context => {
      const session = sessionById.get(String(context.session_id));
      if (!session) return null;
      const athleteId = context.athlete_id;
      const identity = `${session.id}:${athleteId}`;
      if (!athleteId || seenTeamWorkout.has(identity)) return null;
      seenTeamWorkout.add(identity);
      return {
        ...session,
        athleteId,
        source: session.source === "external_provider" ? session.source_provider : "coach_schedule",
        sourceActivityId: session.external_session_id || "",
        type: session.session_type,
        title: session.session_name,
        startAt: session.starts_at,
        endAt: session.ends_at,
        timeZone: session.timezone_name
      };
    }).filter(Boolean);
    const workouts = domain.normalizeWorkouts([
      ...state.garminActivities,
      ...state.trainingModeSessions.map(session => ({
        id: session.id,
        athleteId: session.user_id,
        source: "training_mode",
        sourceActivityId: session.id,
        type: session.session_type,
        title: session.title,
        startAt: session.started_at,
        endAt: session.ended_at
      })),
      ...state.demandBlocks.map(block => ({
        ...block,
        athleteId: block.user_id,
        source: "manual",
        type: block.session_type || "training",
        title: block.title,
        startAt: block.start_time,
        endAt: block.end_time
      })),
      ...teamWorkouts
    ]).filter(workout => workout.endAt <= now && workout.endAt >= windowStart);
    state.workoutFuelContexts = domain.getWorkoutFuelContexts(workouts, state.logs);
    state.workoutFuelSummaries = domain.workoutFuelSummariesByAthlete({
      contexts: state.workoutFuelContexts,
      targetsByUser: targetsByUser(),
      timeZone: state.timeZone
    });
  }

  function rebuildOperationalData() {
    state.teamDataHealth = domain.buildTeamDataHealth({
      athletes: scopedAthleteRows(),
      rows: state.dataHealthRows,
      now: new Date()
    });
    state.attentionItems = domain.buildCoachAttentionItems({
      roster: state.roster,
      dataHealth: state.teamDataHealth,
      interventions: state.interventions,
      trainingContext: state.trainingContext,
      workoutFuelSummaries: state.workoutFuelSummaries,
      actions: state.attentionActions,
      now: new Date()
    });
  }

  function currentStatusCopy(item) {
    if (!item.lastFuel) return "No fuel logged today yet.";
    if (item.beyondFuelGapMinutes !== null) return `${domain.duration(item.beyondFuelGapMinutes)} beyond target`;
    if (item.remainingFuelGapMinutes !== null) return `${domain.duration(item.remainingFuelGapMinutes)} until target`;
    return "Fuel timing visible";
  }

  function flagTone(flag) {
    if (!flag) return "steady";
    if (flag.id === "gap_exceeded") return "critical";
    if (flag.id === "gap_approaching") return "warning";
    return "steady";
  }

  function rosterRow(item, { compact = false } = {}) {
    const topFlag = item.flags[0] || null;
    const tone = topFlag ? flagTone(topFlag) : "steady";
    const id = safe(item.athlete.userId);
    return `
      <article class="coach-roster-row ${safe(tone)}">
        <div>
          <div class="coach-athlete-title">
            <strong>${safe(item.athlete.displayName)}</strong>
            <span class="coach-status-chip ${safe(item.status)}">${safe(item.statusLabel)}</span>
          </div>
          <div class="coach-row-meta">
            <span>${safe(currentStatusCopy(item))}</span>
            <span>${safe(item.fuelLogs.length)} fuel</span>
            <span>${safe(item.hydrationLogs.length)} hydration</span>
            <span>${safe(item.sleepyLogs.length)} Sleepy</span>
          </div>
          ${topFlag ? `<p class="coach-note">${safe(topFlag.detail)}</p>` : compact ? "" : `<p class="coach-note">No attention flag right now.</p>`}
        </div>
        <button type="button" data-open-athlete="${id}">View</button>
      </article>
    `;
  }

  function relationshipStatusCopy(status) {
    if (status === "active") return "Sharing active";
    if (status === "pending") return "Waiting for athlete approval";
    if (status === "declined") return "Request declined";
    if (status === "revoked") return "Sharing revoked";
    return "Not connected";
  }

  function relationshipSearchRow(item) {
    const id = safe(item.userId);
    const canOpen = item.relationStatus === "active";
    return `
      <article class="coach-roster-row ${safe(item.relationStatus === "active" ? "steady" : "warning")}">
        <div>
          <div class="coach-athlete-title">
            <strong>${safe(item.displayName)}</strong>
            <span class="coach-status-chip ${safe(item.relationStatus)}">${safe(item.relationStatus)}</span>
          </div>
          <div class="coach-row-meta">
            <span>${safe(relationshipStatusCopy(item.relationStatus))}</span>
          </div>
        </div>
        ${canOpen ? `<button type="button" data-open-athlete="${id}">View</button>` : `<button type="button" disabled>${safe(item.relationStatus === "declined" ? "Declined" : "Invitation pending")}</button>`}
      </article>
    `;
  }

  function renderAthleteCodeResult() {
    const target = $("coachAthleteCodeResult");
    if (!target) return;
    const result = state.athleteCodeResult;
    if (state.athleteCodeStatus && !result) {
      target.innerHTML = `
        <div class="coach-code-message" role="status">
          <strong>${safe(state.athleteCodeStatus)}</strong>
          ${state.athleteCodeStatusDetail ? `<p>${safe(state.athleteCodeStatusDetail)}</p>` : ""}
        </div>
      `;
      return;
    }
    if (!result) {
      target.innerHTML = `<p class="coach-note">Ask an athlete for their Fuel Guard Athlete Code to connect.</p>`;
      return;
    }
    const status = result.relationship_status || "not_connected";
    const alreadyConnected = status === "active";
    const pending = status === "pending";
    const declined = status === "declined";
    target.innerHTML = `
      <article class="coach-code-match ${safe(alreadyConnected ? "steady" : declined ? "urgent" : "warning")}">
        <div>
          <div class="coach-athlete-title">
            <strong>${safe(result.display_name || "Fuel Guard Athlete")}</strong>
            <span class="coach-status-chip ${safe(status)}">${safe(alreadyConnected ? "connected" : pending ? "pending" : declined ? "declined" : "not connected")}</span>
          </div>
          <div class="coach-row-meta">
            <span>Fuel Guard Athlete</span>
            <span>${safe(result.athlete_code || state.athleteCodeQuery)}</span>
          </div>
        </div>
        ${alreadyConnected
          ? `<button type="button" data-open-athlete="${safe(result.athlete_id)}">View</button>`
          : pending
            ? `<button type="button" disabled>Invitation pending</button>`
            : `<button type="button" data-send-code-request>Send Connection Request</button>`}
      </article>
      ${state.athleteCodeStatus ? `<p class="coach-note">${safe(state.athleteCodeStatus)}</p>` : ""}
    `;
  }

  function briefMetric(label, value, detail = "") {
    return `
      <article class="coach-brief-metric">
        <span>${safe(label)}</span>
        <strong>${safe(value)}</strong>
        ${detail ? `<small>${safe(detail)}</small>` : ""}
      </article>
    `;
  }

  function renderGroupFilter() {
    const target = $("coachGroupFilter");
    if (!target) return;
    const group = selectedGroup();
    const visibleMembers = group ? scopedAthleteRows().length : state.roster.length;
    target.innerHTML = `
      <div>
        <label for="coachActiveGroupFilter">Roster scope</label>
        <select id="coachActiveGroupFilter">
          <option value="">All active athletes</option>
          ${state.savedGroups.map(item => `<option value="${safe(item.id)}"${String(item.id) === String(state.selectedGroupId) ? " selected" : ""}>${safe(item.name)}</option>`).join("")}
        </select>
      </div>
      <p>${group ? `${safe(group.name)} · ${safe(visibleMembers)} currently authorised athlete${visibleMembers === 1 ? "" : "s"}` : `${safe(state.roster.length)} active athlete${state.roster.length === 1 ? "" : "s"}`} · Group membership never overrides sharing access.</p>
    `;
  }

  function renderWeeklyBrief() {
    const target = $("coachWeeklyBrief");
    if (!target) return;
    const brief = state.weeklyBrief;
    if (!brief) {
      target.innerHTML = `<section class="coach-card"><div class="coach-empty">Weekly team intelligence is loading.</div></section>`;
      return;
    }
    const coverage = Number.isFinite(brief.loggingCoveragePct) ? `${brief.loggingCoveragePct}%` : "Not enough data";
    const gapWindow = brief.biggestGapWindow?.label || "No repeated window yet";
    const gapDetail = brief.biggestGapWindow
      ? `${brief.biggestGapWindow.count} gaps · ${brief.biggestGapWindow.athleteCount} athletes`
      : "Requires repeated >target gaps across athletes";
    const sessions = state.teamSessionBrief;
    const sessionPercent = value => Number.isFinite(value) ? `${value}%` : "Not enough data";
    target.innerHTML = `
      <section class="coach-card coach-weekly-brief">
        <div class="coach-card-heading">
          <span class="coach-icon">W</span>
          <div>
            <p class="coach-kicker">Weekly Coach Brief</p>
            <h1>${safe(brief.period.display)}</h1>
            <p>Previous complete Monday-Sunday · ${safe(state.timeZone)}</p>
          </div>
        </div>
        <div class="coach-brief-grid">
          ${briefMetric("Active athletes", brief.athleteCount)}
          ${briefMetric("Logging coverage", coverage, `${brief.analytics.loggingCoverage.loggedAthleteDays} of ${brief.analytics.loggingCoverage.eligibleAthleteDays} eligible athlete-days`)}
          ${briefMetric("Frequently exceeded", brief.frequentlyExceededCount, "At least 2 days and half of measurable days")}
          ${briefMetric("Biggest gap window", gapWindow, gapDetail)}
          ${briefMetric("Improved", brief.improvedCount, "Comparable week-to-week data")}
          ${briefMetric("Deteriorated", brief.deterioratedCount, "Material adherence or gap change")}
          ${briefMetric("Need review", brief.reviewCount, "Evidence-based review candidates")}
        </div>
        ${sessions?.sessionCount ? `
          <div class="coach-team-session-brief">
            <div><span>Shared team sessions</span><strong>${safe(sessions.sessionCount)}</strong></div>
            <div><span>Logging coverage</span><strong>${safe(sessionPercent(sessions.loggingCoveragePct))}</strong></div>
            <div><span>Pre-session consistency</span><strong>${safe(sessionPercent(sessions.preConsistencyPct))}</strong></div>
            <div><span>Prompt post-session fuel</span><strong>${safe(sessionPercent(sessions.postPromptPct))}</strong></div>
            <div><span>Team consistency streak</span><strong>${safe(`${sessions.teamSessionStreak} session${sessions.teamSessionStreak === 1 ? "" : "s"}`)}</strong></div>
          </div>
          <p class="coach-note">${safe(sessions.milestone || `${sessions.improving.length} improving · ${sessions.deteriorating.length} deteriorating · ${sessions.missingPatterns.length} with missing session patterns`)}</p>
        ` : ""}
        ${brief.limited ? `<p class="coach-limited-note">Small squad or limited logging coverage - counts are shown, but team percentages and patterns are withheld until the sample is meaningful.</p>` : ""}
        <div class="coach-button-row">
          <button class="primary" type="button" data-review-team>Review Team</button>
        </div>
      </section>
    `;
  }

  function renderTeamPatterns() {
    const target = $("coachTeamPatterns");
    if (!target) return;
    const analytics = state.weeklyBrief?.analytics;
    if (!analytics) {
      target.innerHTML = "";
      return;
    }
    const candidates = analytics.reviewCandidates;
    target.innerHTML = `
      <section class="coach-card coach-team-intelligence">
        <div class="coach-card-heading compact">
          <div>
            <h2>Team Intelligence</h2>
            <p>Repeated squad patterns are separated from individual review signals.</p>
          </div>
        </div>
        <div class="coach-intelligence-grid">
          <section class="coach-intelligence-column">
            <div class="coach-intelligence-title"><span class="coach-chip team">Team pattern</span><strong>Operational signals</strong></div>
            ${analytics.patterns.length ? `
              <div class="coach-pattern-list">
                ${analytics.patterns.map(pattern => `<article><p>${safe(pattern.label)}</p></article>`).join("")}
              </div>
            ` : `<div class="coach-empty compact">Not enough repeated multi-athlete data to identify a team-level pattern this week.</div>`}
          </section>
          <section class="coach-intelligence-column">
            <div class="coach-intelligence-title"><span class="coach-chip individual">Individual</span><strong>Review candidates</strong></div>
            ${candidates.length ? `
              <div class="coach-candidate-list">
                ${candidates.map(candidate => `
                  <article>
                    <div><strong>${safe(candidate.athlete.displayName || "Fuel Guard Athlete")}</strong><p>${safe(candidate.reasons.join(" · "))}</p></div>
                    <button type="button" data-open-athlete="${safe(candidate.athleteId)}">Review</button>
                  </article>
                `).join("")}
              </div>
            ` : `<div class="coach-empty compact">No athlete meets the weekly review threshold.</div>`}
          </section>
        </div>
        <p class="coach-note">Patterns describe shared timing and context. They do not establish cause, blame athletes, or provide a medical interpretation of Sleepy events.</p>
      </section>
    `;
  }

  function scheduleAthlete(schedule) {
    return state.roster.find(item => String(item.athlete.userId) === String(schedule?.athlete_id)) || null;
  }

  function scheduleLabel(schedule) {
    return domain.reviewScheduleDefinition(schedule?.review_type).label;
  }

  function sortedSchedules() {
    const rosterIds = new Set(state.roster.map(item => String(item.athlete.userId)));
    return state.schedules.filter(schedule => !state.selectedGroupId || rosterIds.has(String(schedule.athlete_id))).sort((a, b) => {
      const aState = domain.scheduledReviewState(a, { now: new Date(), timeZone: state.timeZone });
      const bState = domain.scheduledReviewState(b, { now: new Date(), timeZone: state.timeZone });
      if (aState.due !== bState.due) return aState.due ? -1 : 1;
      return String(aState.dueKey || "9999-12-31").localeCompare(String(bState.dueKey || "9999-12-31"));
    });
  }

  function scheduleRow(schedule, { compact = false } = {}) {
    const athlete = scheduleAthlete(schedule);
    const due = domain.scheduledReviewState(schedule, { now: new Date(), timeZone: state.timeZone });
    return `
      <article class="coach-schedule-row ${safe(due.state)}">
        <div>
          <div class="coach-athlete-title">
            <strong>${safe(athlete?.athlete.displayName || "Shared athlete")}</strong>
            <span class="coach-status-chip ${safe(due.state)}">${safe(due.label)}</span>
          </div>
          <div class="coach-row-meta">
            <span>${safe(scheduleLabel(schedule))}</span>
            <span>${safe(due.dueKey ? `Due ${due.dueKey}` : "No next due date")}</span>
            <span>${safe(schedule.cadence === "none" ? "One-off" : schedule.cadence === "8_weeks" ? "Every 8 weeks" : schedule.cadence === "custom_days" ? `Every ${schedule.cadence_days} days` : "Monthly")}</span>
          </div>
          ${!compact && schedule.coach_notes ? `<p class="coach-note">${safe(schedule.coach_notes)}</p>` : ""}
        </div>
        ${schedule.status === "active" ? `<button class="${due.due ? "primary" : "secondary"}" type="button" data-open-scheduled-review="${safe(schedule.id)}">${safe(due.due ? "Review due" : "Open review")}</button>` : ""}
      </article>
    `;
  }

  function renderDueReviews() {
    const target = $("coachDueReviews");
    if (!target) return;
    const due = sortedSchedules().filter(schedule => domain.scheduledReviewState(schedule, { now: new Date(), timeZone: state.timeZone }).due);
    if (!due.length) {
      target.innerHTML = state.schedules.length ? `
        <section class="coach-card coach-due-clear">
          <div class="coach-card-heading compact"><div><h2>Scheduled Reviews</h2><p>No review is due today.</p></div></div>
        </section>
      ` : "";
      return;
    }
    target.innerHTML = `
      <section class="coach-card coach-due-reviews">
        <div class="coach-card-heading compact">
          <div><p class="coach-kicker">Review due</p><h2>${safe(due.length)} scheduled review${due.length === 1 ? "" : "s"} ready</h2><p>Open a due review to assemble the relevant athlete report from shared Fuel Guard data.</p></div>
        </div>
        <div class="coach-scheduled-review-list">${due.map(schedule => scheduleRow(schedule, { compact: true })).join("")}</div>
      </section>
    `;
  }

  function renderScheduledReviews() {
    const target = $("coachScheduledReviewList");
    if (!target) return;
    const schedules = sortedSchedules();
    target.innerHTML = schedules.length
      ? schedules.map(schedule => scheduleRow(schedule)).join("")
      : `<div class="coach-empty compact">No scheduled reviews yet.</div>`;
  }

  function renderScheduleDraftContext() {
    const target = $("coachScheduleDraftContext");
    const save = $("coachSaveReviewButton");
    const complete = $("coachCompleteReviewButton");
    const schedule = state.schedules.find(row => row.id === state.selectedScheduleId) || null;
    if (target) {
      target.hidden = !schedule;
      target.innerHTML = schedule ? `<strong>${safe(scheduleLabel(schedule))}</strong><span>Due ${safe(schedule.next_due_date)} · saving this report will complete the due review and ${schedule.cadence === "none" ? "close the schedule" : "advance the next due date"}.</span>` : "";
    }
    if (save) {
      save.hidden = !state.generatedReport || state.reportSaved;
      save.textContent = state.generatedReport?.reviewKind === "weekly" ? "Save weekly review draft" : schedule ? "Save & complete review" : "Save report";
    }
    if (complete) complete.hidden = !state.savedWeeklyReportId;
  }

  function renderWeeklyReviewHistory() {
    const target = $("coachWeeklyReviewHistory");
    if (!target) return;
    const rows = state.reports.filter(report => report.review_kind === "weekly");
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact"><div><h2>Weekly review history</h2><p>Completed reviews remain part of the coach/athlete record.</p></div></div>
        ${rows.length ? `<div class="coach-weekly-history">${rows.map(report => `
          <article>
            <div><strong>${safe(profileName(state.athleteProfiles.find(profile => profile.user_id === report.athlete_id), state.relationships.find(relation => relation.athlete_id === report.athlete_id)))}</strong><span>${safe(report.week_start)}–${safe(report.week_end)}</span></div>
            <span class="coach-review-state ${safe(report.status)}">${safe(report.status)}</span>
            <p>${safe(report.summary)}</p>
            ${report.completion_note ? `<small>${safe(report.completion_note)}</small>` : ""}
          </article>`).join("")}</div>` : `<div class="coach-empty compact">No weekly reviews saved yet.</div>`}
      </section>
    `;
  }

  function renderNeedsAttention() {
    const target = $("coachNeedsAttention");
    if (!target) return;
    const summary = domain.attentionSummary(state.attentionItems);
    target.innerHTML = `
      <section class="coach-card coach-inbox-card">
        <div class="coach-card-heading coach-inbox-heading">
          <span class="coach-icon">!</span>
          <div>
            <h2>Needs Attention</h2>
            <p>Your daily exception inbox. Deal with what changed, then leave.</p>
          </div>
          <button class="secondary coach-refresh-button" type="button" data-refresh-coach-inbox>Refresh</button>
        </div>
        <div class="coach-inbox-summary" aria-label="Attention summary">
          <strong>${safe(summary.needAttention)} need attention</strong>
          <span>${safe(summary.approachingGap)} approaching gap</span>
          <span>${safe(summary.repeatedSleepy)} repeated Sleepy</span>
          <span>${safe(summary.notLogging)} not logging</span>
        </div>
        <div class="coach-alert-list coach-inbox-list">
          ${state.attentionItems.length ? state.attentionItems.map(renderAttentionItem).join("") : `
            <div class="coach-empty coach-inbox-zero">
              <strong>Inbox clear</strong>
              <span>No new exceptions need action right now.</span>
            </div>
          `}
        </div>
      </section>
    `;
  }

  function attentionTone(item) {
    if (item.type === "gap_exceeded" || item.type === "garmin_reconnect") return "critical";
    if (item.type === "gap_approaching"
      || item.type === "intervention_review_due"
      || item.type === "training_repeated_long_pre_gap"
      || item.type === "training_missing_post_fuel") return "warning";
    return "steady";
  }

  function attentionComposer(item) {
    const composer = state.attentionComposer;
    if (!composer || composer.occurrenceKey !== item.occurrenceKey) return "";
    const isNudge = composer.kind === "nudge";
    return `
      <div class="coach-attention-composer">
        <label>${isNudge ? "Nudge message" : "Coach note"}
          <textarea id="coachAttentionComposerText" rows="3" maxlength="${isNudge ? "280" : "2000"}" placeholder="${isNudge ? "A short Fuel Guard check-in" : "Add a factual note for this athlete"}">${safe(isNudge ? domain.DEFAULT_NUDGE_MESSAGE : "")}</textarea>
        </label>
        <div class="coach-button-row">
          <button class="primary" type="button" data-submit-attention-composer>${isNudge ? "Send nudge" : "Save note"}</button>
          <button class="secondary" type="button" data-cancel-attention-composer>Cancel</button>
        </div>
      </div>
    `;
  }

  function renderAttentionItem(item) {
    const occurrence = safe(item.occurrenceKey);
    const athleteId = safe(item.athleteId);
    const reviewButton = item.interventionId
      ? `<button class="secondary" type="button" data-review-intervention="${safe(item.interventionId)}">Review follow-up</button>`
      : `<button class="secondary" type="button" data-create-attention-intervention="${occurrence}">Create intervention</button>`;
    return `
      <article class="coach-alert-row coach-inbox-item ${safe(attentionTone(item))}" data-attention-occurrence="${occurrence}">
        <div class="coach-inbox-item-main">
          <div class="coach-athlete-title">
            <strong>${safe(item.athlete?.displayName || "Athlete")}</strong>
            <span class="coach-chip">${safe(item.label)}</span>
          </div>
          <p>${safe(item.detail)}</p>
        </div>
        <div class="coach-inbox-actions" aria-label="Actions for ${safe(item.athlete?.displayName || "athlete")}">
          <button class="primary" type="button" data-attention-status="reviewed" data-occurrence-key="${occurrence}">Reviewed</button>
          <button class="secondary" type="button" data-add-attention-note="${occurrence}">Add note</button>
          ${reviewButton}
          ${item.canNudge ? `<button class="secondary" type="button" data-nudge-attention="${occurrence}">Nudge athlete</button>` : ""}
          <button class="secondary" type="button" data-open-athlete="${athleteId}">Open athlete</button>
          <button class="coach-dismiss-button" type="button" data-attention-status="dismissed" data-occurrence-key="${occurrence}">Dismiss</button>
        </div>
        ${attentionComposer(item)}
      </article>
    `;
  }

  function renderDataHealth() {
    const target = $("coachDataHealth");
    if (!target) return;
    const summary = state.teamDataHealth.summary || {};
    const items = state.teamDataHealth.items || [];
    const problems = items.filter(item => item.id !== "reporting_normally");
    target.innerHTML = `
      <section class="coach-card coach-data-health-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Team data health</h2>
            <p>Is today’s shared Fuel Guard information trustworthy?</p>
          </div>
        </div>
        <div class="coach-data-health-summary">
          <strong>${safe(summary.reportingNormally || 0)}/${safe(summary.total || 0)} athletes reporting normally</strong>
          <span>${safe(summary.noLogsToday || 0)} haven’t logged today</span>
          <span>${safe(summary.garminReconnect || 0)} Garmin ${(summary.garminReconnect || 0) === 1 ? "needs" : "connections need"} reconnecting</span>
        </div>
        ${problems.length ? `
          <details class="coach-data-health-details">
            <summary>${safe(problems.length)} data-health issue${problems.length === 1 ? "" : "s"}</summary>
            <div class="coach-data-health-list">
              ${problems.map(item => `
                <article>
                  <strong>${safe(item.athlete?.displayName || "Athlete")}</strong>
                  <span>${safe(item.label)}</span>
                  <small>${safe(item.detail)}</small>
                </article>
              `).join("")}
            </div>
          </details>
        ` : `<p class="coach-note">No shared logging or connection issues detected.</p>`}
      </section>
    `;
  }

  function renderRoster() {
    const target = $("coachRoster");
    if (!target) return;
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Roster</h2>
            <p>Sorted by current urgency: gap exceeded, approaching, repeated Sleepy events, then steady.</p>
          </div>
        </div>
        <div class="coach-list">
          ${state.roster.length ? state.roster.map(item => rosterRow(item, { compact: true })).join("") : `<div class="coach-empty">No athletes connected yet. Ask an athlete for their Fuel Guard Athlete Code to connect.</div>`}
        </div>
      </section>
    `;
  }

  function renderAthleteList() {
    const target = $("coachAthleteList");
    if (!target) return;
    const activeById = new Map(state.roster.map(item => [item.athlete.userId, item]));
    const rows = relationshipRows().map(item => activeById.get(item.userId) || item);
    renderAthleteCodeResult();
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Athletes</h2>
            <p>Approved athletes appear with full read-only detail. Pending requests stay private until the athlete approves.</p>
          </div>
        </div>
        <div class="coach-list">
          ${rows.length ? rows.map(item => item.athlete ? rosterRow(item) : relationshipSearchRow(item)).join("") : `<div class="coach-empty">No athletes connected yet. Ask an athlete for their Fuel Guard Athlete Code to connect.</div>`}
        </div>
      </section>
    `;
  }

  function selectedAthleteStatus() {
    return state.roster.find(item => item.athlete.userId === state.selectedAthleteId) || state.roster[0] || null;
  }

  function selectCoachAthlete(athleteId) {
    const id = String(athleteId || "");
    if (!state.roster.some(item => item.athlete.userId === id)) return false;
    state.selectedAthleteId = id;
    state.currentTab = "athletes";
    render();
    return true;
  }

  function eventIcon(log) {
    if (domain.isSleepyLog(log)) return "S";
    if (domain.isHydrationLog(log) && !domain.isFuelLog(log)) return "H";
    return "F";
  }

  function renderTimeline(logs) {
    const items = domain.logsWithDates(logs)
      .filter(log => domain.isFuelLog(log) || domain.isHydrationLog(log) || domain.isSleepyLog(log))
      .sort((a, b) => a.date - b.date);
    if (!items.length) return `<div class="coach-empty">No Fuel, Hydration, or Sleepy logs today.</div>`;
    return `
      <div class="coach-event-timeline" role="list">
        ${items.map(log => {
          const displayType = domain.isSleepyLog(log) ? "sleepy" : domain.isHydrationLog(log) && !domain.isFuelLog(log) ? "hydration" : "fuel";
          return `
            <article class="coach-event-row ${safe(displayType)}" role="listitem">
              <span class="coach-timeline-dot" aria-hidden="true">${safe(eventIcon(log))}</span>
              <div>
                <strong>${safe(domain.logTypeLabel(log))}</strong>
                <p class="coach-note">${safe(log.source === "garmin" ? "Garmin" : log.source === "csv_import" ? "Imported" : "Manual")}</p>
              </div>
              <time>${safe(domain.formatClock(log.date))}</time>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function patternDefinition() {
    return PATTERN_TYPES.find(type => type.id === state.selectedPattern) || PATTERN_TYPES[0];
  }

  function patternLogs(item) {
    const type = patternDefinition().id;
    return item.logs
      .filter(log => {
        if (type === "hydration") return domain.isHydrationLog(log);
        if (type === "sleepy") return domain.isSleepyLog(log);
        return domain.isFuelLog(log);
      })
      .map(log => ({ ...log, minute: domain.minutesIntoDay(log.date) }))
      .filter(log => Number.isFinite(log.minute))
      .sort((a, b) => a.minute - b.minute);
  }

  function patternBuckets(logs) {
    return BUCKETS.map(bucket => {
      const start = bucket.start * 60;
      const end = bucket.end * 60;
      const bucketLogs = logs.filter(log => log.minute >= start && log.minute < end);
      return {
        ...bucket,
        count: bucketLogs.length,
        times: bucketLogs.map(log => domain.formatClock(log.date))
      };
    });
  }

  function ticks(maxValue) {
    const max = Math.max(1, Math.ceil(Number(maxValue) || 0));
    const step = Math.max(1, Math.ceil(max / 3));
    const values = [];
    for (let value = 0; value <= max; value += step) values.push(value);
    if (values[values.length - 1] !== max) values.push(max);
    return values;
  }

  function renderPatternChart(item) {
    const pattern = patternDefinition();
    const logs = patternLogs(item);
    const buckets = patternBuckets(logs);
    const yTicks = ticks(Math.max(...buckets.map(bucket => bucket.count), 1));
    const yMax = yTicks[yTicks.length - 1] || 1;
    const width = 520;
    const height = 230;
    const padding = { top: 18, right: 18, bottom: 46, left: 42 };
    const bottom = height - padding.bottom;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = bottom - padding.top;
    const slot = plotWidth / buckets.length;
    const barWidth = Math.min(38, Math.max(20, slot * .52));
    const yFor = value => bottom - (Math.max(0, value) / yMax) * plotHeight;
    return `
      <div class="coach-pattern-chart" role="img" aria-label="${safe(pattern.label)} logs by time of day">
        <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${bottom}" x2="${width - padding.right}" y2="${bottom}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${bottom}"></line>
          ${yTicks.map(tick => {
            const y = yFor(tick);
            return `
              <line class="grid" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}"></line>
              <text x="${padding.left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end">${safe(String(tick))}</text>
            `;
          }).join("")}
          ${buckets.map((bucket, index) => {
            const x = padding.left + slot * index + slot / 2;
            const barHeight = bucket.count ? Math.max(4, bottom - yFor(bucket.count)) : 0;
            const y = bottom - barHeight;
            const title = bucket.count
              ? `${bucket.label}: ${bucket.count} ${bucket.count === 1 ? pattern.noun : `${pattern.noun}s`} (${bucket.times.join(", ")})`
              : `${bucket.label}: 0`;
            return `
              <rect class="bar ${safe(pattern.id)}" x="${(x - barWidth / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="8">
                <title>${safe(title)}</title>
              </rect>
              <text x="${x.toFixed(1)}" y="${height - 22}" text-anchor="middle">${safe(bucket.label)}</text>
            `;
          }).join("")}
        </svg>
        <p class="coach-note">${logs.length ? `${logs.length} ${logs.length === 1 ? pattern.noun : `${pattern.noun}s`} today.` : pattern.empty}</p>
      </div>
    `;
  }

  function recordsForAthlete(records, item) {
    const athleteId = String(item?.athlete?.userId || "");
    return (records || [])
      .filter(record => String(record.athlete_id || "") === athleteId)
      .sort((a, b) => new Date(b.created_at || b.sent_at || b.acted_at || 0) - new Date(a.created_at || a.sent_at || a.acted_at || 0));
  }

  function nextActionText(item) {
    if (item.beyondFuelGapMinutes !== null) return "Check in and plan a gentle fuel moment before the next long gap.";
    if (item.flags.some(flag => flag.id === "sleepy_cluster")) return "Ask whether Sleepy events are clustering around a particular work, training, or rest window.";
    if (item.remainingFuelGapMinutes !== null) return "Support the athlete to fuel before the current gap reaches their target.";
    return "Keep observing the shared rhythm and agree the next practical support step.";
  }

  function round1(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  }

  function pct(value) {
    return Number.isFinite(value) ? `${Math.round(value)}%` : "Not enough data";
  }

  function metricNumber(value, suffix = "") {
    return Number.isFinite(value) ? `${round1(value)}${suffix}` : "Not enough data";
  }

  function reportPeriodFromControls() {
    return domain.reviewPeriodRange({
      preset: $("coachReportPeriod")?.value || state.reportPeriod,
      customStart: $("coachReportStart")?.value,
      customEnd: $("coachReportEnd")?.value,
      now: new Date(),
      timeZone: state.timeZone
    });
  }

  function selectedReportAthlete() {
    const id = state.selectedReportAthleteId || state.selectedAthleteId || state.roster[0]?.athlete.userId || "";
    return state.roster.find(item => item.athlete.userId === id) || state.roster[0] || null;
  }

  function reportPayload(report) {
    return {
      coverage: report.coverage,
      consistency: report.consistency,
      fuelling: {
        averageFirstFuel: timeFromMinutes(report.fuelling.averageFirstFuelMinutes),
        averageFinalFuel: timeFromMinutes(report.fuelling.averageFinalFuelMinutes),
        averageGapMinutes: report.fuelling.averageGapMinutes,
        longestGapMinutes: report.fuelling.longestGapMinutes,
        gapsExceedingTarget: report.fuelling.gapsExceedingTarget,
        commonGapWindow: report.fuelling.commonGapWindow?.label || null,
        commonFuellingWindow: report.fuelling.commonFuellingWindow?.label || null
      },
      sleepy: report.sleepy,
      contexts: report.contexts,
      executiveSummary: report.executiveSummary,
      comparison: report.comparison,
      weekly: report.weekly,
      weeklyReview: report.weeklyReview || null
    };
  }

  function reportMetricRows(report) {
    return [
      ["Logging coverage", `${report.coverage.loggedDays} / ${report.coverage.totalDays} days`, pct(report.coverage.loggedPct)],
      ["Fuel logs / active day", metricNumber(report.consistency.avgFuelLogsPerActiveDay), "Average"],
      ["Hydration logs / active day", metricNumber(report.consistency.avgHydrationLogsPerActiveDay), "Average"],
      ["Days within gap target", pct(report.consistency.targetAdherencePct), `${report.consistency.daysExceedingTarget} days exceeded`],
      ["Average first fuel", timeFromMinutes(report.fuelling.averageFirstFuelMinutes), "Period average"],
      ["Average final fuel", timeFromMinutes(report.fuelling.averageFinalFuelMinutes), "Period average"],
      ["Average fuel gap", domain.duration(report.fuelling.averageGapMinutes), "Between fuel logs"],
      ["Longest fuel gap", domain.duration(report.fuelling.longestGapMinutes), "Longest meaningful gap"],
      ["Most common gap window", report.fuelling.commonGapWindow?.label || "Not enough gap data yet.", "Recurring gap"],
      ["Most common fuelling window", report.fuelling.commonFuellingWindow?.label || "Not enough log data yet.", "Recurring fuel time"],
      ["Sleepy events", String(report.sleepy.total), `${metricNumber(report.sleepy.averagePerActiveWeek, " / week")}`],
      ["Most common Sleepy window", report.sleepy.commonWindow?.label || "Not enough Sleepy data yet.", "Recurring Sleepy time"],
      ["Sleepy after long gap", report.sleepy.total ? `${report.sleepy.afterLongGapCount} / ${report.sleepy.total}` : "No Sleepy events", `>${domain.duration(report.sleepy.targetMinutes || 0)} target gap`]
    ];
  }

  function timeFromMinutes(minutes) {
    if (!Number.isFinite(minutes)) return "Not enough data";
    const date = domain.startOfLocalDay();
    date.setMinutes(Math.round(minutes));
    return domain.formatClock(date);
  }

  function reportTrendClass(direction) {
    if (direction === "improved") return "improved";
    if (direction === "declined") return "declined";
    return "stable";
  }

  function comparisonValue(item, value) {
    if (!Number.isFinite(value)) return "Not enough data";
    if (item.unit === "%") return `${Math.round(value)}%`;
    if (item.unit === "minutes") return domain.duration(value);
    return String(Math.round(value));
  }

  function comparisonDelta(item) {
    if (!Number.isFinite(item.difference)) return "";
    const sign = item.difference > 0 ? "+" : item.difference < 0 ? "-" : "";
    if (item.unit === "minutes") return `${sign}${domain.duration(Math.abs(item.difference))}`;
    if (item.unit === "%") return `${item.difference > 0 ? "+" : ""}${Math.round(item.difference)} percentage points`;
    return `${sign}${Math.abs(Math.round(item.difference))}`;
  }

  function renderMiniTrendChart(report) {
    const width = 620;
    const height = 220;
    const padding = { top: 20, right: 18, bottom: 42, left: 48 };
    const weekly = report.weekly || [];
    if (!weekly.length) return `<div class="coach-empty">Not enough weekly data to chart yet.</div>`;
    const gapValues = weekly.map(point => point.averageGapMinutes).filter(Number.isFinite);
    const maxGap = Math.max(60, ...gapValues, report.sleepy.total || 0);
    const xFor = index => padding.left + (weekly.length === 1 ? 0 : index * ((width - padding.left - padding.right) / (weekly.length - 1)));
    const yForGap = value => height - padding.bottom - (Math.max(0, value) / maxGap) * (height - padding.top - padding.bottom);
    const path = weekly.map((point, index) => Number.isFinite(point.averageGapMinutes) ? `${index ? "L" : "M"} ${xFor(index).toFixed(1)} ${yForGap(point.averageGapMinutes).toFixed(1)}` : "").filter(Boolean).join(" ");
    return `
      <div class="coach-report-chart" role="img" aria-label="Weekly average fuel gap trend">
        <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}"></line>
          <line class="axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}"></line>
          <text class="axis-title" x="${padding.left}" y="14">Average fuel gap</text>
          <path class="trend-line" d="${safe(path)}"></path>
          ${weekly.map((point, index) => Number.isFinite(point.averageGapMinutes) ? `
            <circle class="trend-point" cx="${xFor(index).toFixed(1)}" cy="${yForGap(point.averageGapMinutes).toFixed(1)}" r="5">
              <title>${safe(`${point.label}: ${domain.duration(point.averageGapMinutes)}`)}</title>
            </circle>
            <text x="${xFor(index).toFixed(1)}" y="${height - 17}" text-anchor="middle">${safe(point.label.replace(/ .*$/, ""))}</text>
          ` : "").join("")}
        </svg>
      </div>
    `;
  }

  function renderReport(report) {
    if (!report) return `<section class="coach-card"><div class="coach-empty">Generate a review to preview structured report sections.</div></section>`;
    return `
      <section class="coach-report-document coach-card" data-report-document>
        <div class="coach-report-header">
          <div>
            <p class="coach-kicker">Athlete Review</p>
            <h2>${safe(report.title)}</h2>
            <p>${safe(report.period.display)}</p>
          </div>
          <div class="coach-report-meta">
            <span>Coach: ${safe(report.coachName)}</span>
            <span>Team: ${safe(report.organisationName || "Not set")}</span>
            <span>Generated: ${safe(domain.formatClock(report.generatedAt))} · ${safe(domain.dateKey(report.generatedAt))}</span>
          </div>
        </div>

        <section class="coach-report-section">
          <h3>Executive Summary</h3>
          <ul class="coach-report-list">
            ${report.executiveSummary.map(point => `<li>${safe(point)}</li>`).join("")}
          </ul>
        </section>

        ${report.weeklyReview ? `<section class="coach-report-section coach-weekly-review-evidence">
          <h3>Weekly evidence and discussion</h3>
          <div class="coach-weekly-evidence-grid">
            <article><span>Strongest recorded day</span><p>${safe(report.weeklyReview.strongestDay)}</p></article>
            <article><span>Weakest recorded day</span><p>${safe(report.weeklyReview.weakestDay)}</p></article>
            <article><span>Pre/post training</span><p>${safe(`${report.weeklyReview.training.preFuelRecorded} of ${report.weeklyReview.training.workoutCount} workouts had prior Fuel recorded; ${report.weeklyReview.training.postFuelRecorded} had post-session Fuel recorded.`)}</p>${report.weeklyReview.training.observations?.length ? `<ul>${report.weeklyReview.training.observations.map(observation => `<li>${safe(observation)}</li>`).join("")}</ul>` : ""}</article>
          </div>
          <h4>Long recorded gaps</h4>
          ${report.weeklyReview.longGaps.length ? `<ul class="coach-report-list">${report.weeklyReview.longGaps.map(gap => `<li>${safe(`${gap.date} · ${gap.window} · ${domain.duration(gap.minutes)}`)}</li>`).join("")}</ul>` : `<p>No recorded fuel gap exceeded the configured target.</p>`}
          <h4>Recurring patterns</h4>
          <ul class="coach-report-list">${report.weeklyReview.recurringPatterns.map(pattern => `<li>${safe(pattern)}</li>`).join("")}</ul>
          <h4>Discussion prompts</h4>
          <ul class="coach-report-list">${report.weeklyReview.discussionPrompts.map(prompt => `<li>${safe(prompt)}</li>`).join("")}</ul>
          <p class="coach-note">These statements describe shared records only. Missing logs are not evidence of intake.</p>
        </section>` : ""}

        <section class="coach-report-section">
          <h3>Data Coverage</h3>
          <div class="coach-detail-grid">
            <article class="coach-metric"><span>Total days</span><strong>${safe(report.coverage.totalDays)}</strong></article>
            <article class="coach-metric"><span>Logged days</span><strong>${safe(report.coverage.loggedDays)}</strong></article>
            <article class="coach-metric"><span>Coverage</span><strong>${safe(pct(report.coverage.loggedPct))}</strong></article>
            <article class="coach-metric"><span>Gap metric days</span><strong>${safe(report.coverage.metricDays)}</strong></article>
          </div>
          ${report.coverage.limited ? `<p class="coach-limited-note">Limited data coverage - interpret this period cautiously.</p>` : ""}
        </section>

        <section class="coach-report-section">
          <h3>Consistency and Fuelling Behaviour</h3>
          <div class="coach-report-table">
            ${reportMetricRows(report).map(row => `
              <div class="coach-report-row">
                <span>${safe(row[0])}</span>
                <strong>${safe(row[1])}</strong>
                <em>${safe(row[2])}</em>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="coach-report-section">
          <h3>Sleepy Patterns</h3>
          <p>${safe(report.sleepy.total ? `${report.sleepy.total} Sleepy event${report.sleepy.total === 1 ? " was" : "s were"} recorded in this period.` : "No Sleepy events were recorded in this period.")}</p>
          <p>${safe(report.sleepy.commonWindow ? `Most common Sleepy window: ${report.sleepy.commonWindow.label}.` : "Not enough Sleepy data to identify a recurring window yet.")}</p>
          ${report.sleepy.total ? `<p>${safe(`${report.sleepy.afterLongGapCount} of ${report.sleepy.total} Sleepy events occurred following fuel gaps longer than ${domain.duration(report.sleepy.targetMinutes || 0)}.`)}</p>` : ""}
          <p class="coach-note">Sleepy logs are observational markers. Fuel Guard does not infer a medical cause.</p>
        </section>

        <section class="coach-report-section">
          <h3>Context</h3>
          ${report.contexts.length ? `
            <div class="coach-context-bars">
              ${report.contexts.map(context => `
                <div class="coach-context-bar">
                  <span>${safe(context.label)}</span>
                  <div><i style="width:${safe(context.adherencePct)}%"></i></div>
                  <strong>${safe(context.adherencePct)}%</strong>
                </div>
              `).join("")}
            </div>
          ` : `<div class="coach-empty compact">Not enough context-specific data yet.</div>`}
        </section>

        <section class="coach-report-section">
          <h3>Previous Period Comparison</h3>
          <p class="coach-note">Current ${safe(report.period.display)} compared with ${safe(report.previousPeriod.display)}.</p>
          <div class="coach-comparison-grid">
            ${report.comparison.map(item => `
              <article class="coach-comparison-card ${safe(reportTrendClass(item.direction))}">
                <span>${safe(item.label)}</span>
                <strong>${safe(comparisonValue(item, item.current))}</strong>
                <p>Previous: ${safe(comparisonValue(item, item.previous))}</p>
                <em>${safe(item.trendLabel || "Not enough data")}</em>
                <small>${safe(comparisonDelta(item))}</small>
              </article>
            `).join("")}
          </div>
        </section>

        <section class="coach-report-section">
          <h3>Report Trends</h3>
          ${renderMiniTrendChart(report)}
        </section>

        <section class="coach-report-section">
          <h3>Coach Observations</h3>
          <p>${safe(report.coachNotes || "No coach observations added yet.")}</p>
        </section>

        <section class="coach-report-section">
          <h3>Interventions</h3>
          ${renderInterventionList(report.interventions, report)}
        </section>

        <div class="coach-button-row coach-export-actions">
          <button class="secondary" type="button" data-export-report-pdf>Export PDF</button>
          <button class="secondary" type="button" data-export-report-csv>Export CSV</button>
        </div>
      </section>
    `;
  }

  function renderInterventionList(interventions = [], report = null) {
    if (!interventions.length) return `<div class="coach-empty compact">No interventions recorded for this athlete yet.</div>`;
    return `
      <div class="coach-intervention-timeline">
        ${interventions.map(intervention => {
          const comparison = report ? domain.interventionComparison({
            intervention,
            logs: report.sourceLogs || [],
            targets: { maximumFuelGapMinutes: report.sleepy?.targetMinutes || report.targetMinutes }
          }) : null;
          return `
            <details class="coach-intervention-item">
              <summary>
                <span>${safe(intervention.intervention_date || domain.dateKey(intervention.created_at))}</span>
                <strong>${safe(intervention.category || "Intervention")}</strong>
                <em>${safe(intervention.status || "active")}</em>
              </summary>
              <p><strong>Observation:</strong> ${safe(intervention.observation || intervention.notes || "Not recorded")}</p>
              <p><strong>Action:</strong> ${safe(intervention.action_text || "Not recorded")}</p>
              ${intervention.review_date ? `<p><strong>Review date:</strong> ${safe(intervention.review_date)}</p>` : ""}
              ${comparison ? `<p class="coach-note">${safe(comparison.label)}</p>` : ""}
            </details>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderReportPreview() {
    const target = $("coachReportPreview");
    if (!target) return;
    target.innerHTML = renderReport(state.generatedReport);
  }

  function interventionMetricValue(value, unit = "") {
    if (!Number.isFinite(value)) return "Not enough data";
    if (unit === "minutes") return domain.duration(value);
    if (unit === "%") return `${Math.round(value)}%`;
    return String(Math.round(value * 10) / 10);
  }

  function interventionMetricSnapshot(metrics = {}) {
    return {
      averageGapMinutes: metrics.fuelling?.averageGapMinutes,
      longestGapMinutes: metrics.fuelling?.longestGapMinutes,
      targetAdherencePct: metrics.consistency?.targetAdherencePct,
      gapsExceedingTarget: metrics.fuelling?.gapsExceedingTarget,
      loggingCoveragePct: metrics.coverage?.loggedPct,
      sleepyEvents: metrics.sleepy?.total
    };
  }

  function renderInterventionReview() {
    const target = $("coachInterventionReview");
    if (!target) return;
    const review = state.interventionReview;
    if (!review) {
      target.innerHTML = "";
      return;
    }
    const comparison = review.comparison;
    const before = interventionMetricSnapshot(comparison.before);
    const after = interventionMetricSnapshot(comparison.after);
    const metrics = [
      ["Average fuel gap", "averageGapMinutes", "minutes"],
      ["Longest fuel gap", "longestGapMinutes", "minutes"],
      ["Within configured target", "targetAdherencePct", "%"],
      ["Gaps exceeding target", "gapsExceedingTarget", ""],
      ["Logging coverage", "loggingCoveragePct", "%"],
      ["Sleepy events", "sleepyEvents", ""]
    ];
    target.innerHTML = `
      <section class="coach-card coach-intervention-review-card">
        <div class="coach-card-heading compact">
          <div>
            <p class="coach-kicker">Review due</p>
            <h2>${safe(review.intervention.action_text || review.intervention.category || "Intervention")}</h2>
            <p>Equivalent ${safe(comparison.windowDays)}-day periods before and after ${safe(review.intervention.intervention_date)}.</p>
          </div>
        </div>
        <p class="coach-intervention-comparison-label">${safe(comparison.label)}</p>
        <div class="coach-before-after-table">
          <div class="coach-before-after-row heading"><span>Metric</span><strong>Before</strong><strong>After</strong></div>
          ${metrics.map(([label, key, unit]) => `
            <div class="coach-before-after-row">
              <span>${safe(label)}</span>
              <strong>${safe(interventionMetricValue(before[key], unit))}</strong>
              <strong>${safe(interventionMetricValue(after[key], unit))}</strong>
            </div>
          `).join("")}
        </div>
        ${comparison.enoughData ? "" : `<p class="coach-limited-note">Insufficient comparable gap data. Keep the intervention open and review again when coverage improves.</p>`}
        <p class="coach-note">Before/after changes are observational. Fuel Guard does not claim the intervention caused an outcome.</p>
        <label class="coach-textarea-label">Review note<textarea id="coachInterventionReviewNotes" rows="3" maxlength="1200" placeholder="What changed, what stayed the same, and what should happen next?">${safe(review.intervention.review_notes || "")}</textarea></label>
        <div class="coach-button-row">
          <button class="primary" type="button" data-complete-intervention-review="reviewed">Mark reviewed</button>
          <button class="secondary" type="button" data-complete-intervention-review="closed">Close intervention</button>
          <button class="secondary" type="button" data-cancel-intervention-review>Back</button>
        </div>
      </section>
    `;
  }

  function renderReportControls() {
    const select = $("coachReportAthlete");
    if (select) {
      const current = state.selectedReportAthleteId || state.selectedAthleteId || state.roster[0]?.athlete.userId || "";
      select.innerHTML = state.roster.length
        ? state.roster.map(item => `<option value="${safe(item.athlete.userId)}"${item.athlete.userId === current ? " selected" : ""}>${safe(item.athlete.displayName)}</option>`).join("")
        : `<option value="">No assigned athletes</option>`;
      if (current) {
        select.value = current;
        state.selectedReportAthleteId = current;
      }
    }
    const today = domain.dateKey(new Date());
    const scheduleSelect = $("coachScheduleAthlete");
    if (scheduleSelect) {
      scheduleSelect.innerHTML = state.roster.length
        ? state.roster.map(item => `<option value="${safe(item.athlete.userId)}">${safe(item.athlete.displayName)}</option>`).join("")
        : `<option value="">No assigned athletes</option>`;
    }
    const periodSelect = $("coachReportPeriod");
    if (periodSelect) periodSelect.value = state.reportPeriod;
    if ($("coachReportEnd") && !$("coachReportEnd").value) {
      const defaultPeriod = state.reportPeriod === "week"
        ? domain.weeklyReportingPeriod({ now: new Date(), timeZone: state.timeZone })
        : null;
      $("coachReportStart").value = defaultPeriod?.startKey || "";
      $("coachReportEnd").value = defaultPeriod?.endKey || today;
    }
    if ($("coachGenerateReviewButton")) {
      $("coachGenerateReviewButton").textContent = state.reportPeriod === "week" ? "Generate Weekly Review" : "Assemble review";
    }
    if ($("coachInterventionDate") && !$("coachInterventionDate").value) $("coachInterventionDate").value = today;
    if ($("coachInterventionReviewDate") && !$("coachInterventionReviewDate").value) $("coachInterventionReviewDate").value = defaultReviewDate(today);
    if ($("coachScheduleDueDate") && !$("coachScheduleDueDate").value) $("coachScheduleDueDate").value = today;
    renderScheduledReviews();
    renderScheduleDraftContext();
    renderReportPreview();
    renderWeeklyReviewHistory();
  }

  function renderCoachActions(item) {
    const reports = recordsForAthlete(state.reports, item);
    const interventions = recordsForAthlete(state.interventions, item);
    const notes = recordsForAthlete(state.notes, item).slice(0, 3);
    const nudges = recordsForAthlete(state.nudges, item).slice(0, 3);
    const latestReport = reports[0];
    const openInterventions = interventions.filter(record => record.status === "active" || record.status === "open");
    return `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Coach Actions</h2>
            <p>Create read-only follow-up records from this athlete's shared timing data.</p>
          </div>
        </div>
        <div class="coach-action-grid">
          <article class="coach-action-panel">
            <strong>Athlete Review Report</strong>
            <p class="coach-note">${safe(latestReport ? latestReport.summary : "No structured review report generated for this athlete yet.")}</p>
            <button class="secondary" type="button" data-open-report-builder="${safe(item.athlete.userId)}">Generate Weekly Review</button>
          </article>
          <article class="coach-action-panel">
            <strong>Intervention</strong>
            <p class="coach-note">${safe(openInterventions[0]?.action_text || nextActionText(item))}</p>
            <button class="secondary" type="button" data-open-intervention-builder="${safe(item.athlete.userId)}">Record intervention</button>
          </article>
        </div>
      </section>
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Coach Interventions</h2>
            <p>Simple timeline of practical support steps logged by this coach.</p>
          </div>
        </div>
        ${renderInterventionList(interventions)}
      </section>
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Recent coach activity</h2>
            <p>Private notes and auditable Fuel Guard nudges from this coach.</p>
          </div>
        </div>
        <div class="coach-activity-list">
          ${notes.map(note => `
            <article><span>Note</span><strong>${safe(note.body)}</strong><time>${safe(domain.dateKey(note.created_at))} · ${safe(domain.formatClock(note.created_at))}</time></article>
          `).join("")}
          ${nudges.map(nudge => `
            <article><span>Nudge</span><strong>${safe(nudge.message)}</strong><time>${safe(domain.dateKey(nudge.sent_at))} · ${safe(domain.formatClock(nudge.sent_at))}</time></article>
          `).join("")}
          ${notes.length || nudges.length ? "" : `<div class="coach-empty compact">No coach activity recorded yet.</div>`}
        </div>
      </section>
    `;
  }

  function workoutFuelSummaryForAthlete(athleteId) {
    return state.workoutFuelSummaries.find(summary => String(summary.athleteId) === String(athleteId)) || null;
  }

  function workoutTitle(workout) {
    return String(workout.title || workout.type || "Training session")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function renderCoachWorkoutFuel(item) {
    const summary = workoutFuelSummaryForAthlete(item.athlete.userId);
    if (!summary?.contexts?.length) {
      return `
        <section class="coach-card coach-training-fuel-card">
          <div class="coach-card-heading compact"><div><h2>Pre/Post Training Fuel</h2><p>Completed sessions from shared Garmin, manual, and team-schedule data.</p></div></div>
          <div class="coach-empty compact">No completed training sessions are available in the last 14 days.</div>
        </section>
      `;
    }
    const metrics = [
      ["Sessions", String(summary.sessionCount)],
      ["Avg pre-session gap", Number.isFinite(summary.averagePreFuelGapMinutes) ? domain.duration(summary.averagePreFuelGapMinutes) : "More data needed"],
      ["Avg post-session fuel", Number.isFinite(summary.averagePostFuelGapMinutes) ? domain.duration(summary.averagePostFuelGapMinutes) : "More data needed"],
      ...(Number.isFinite(summary.targetMinutes)
        ? [["After configured gap target", String(summary.extendedPreFuelGapCount)]]
        : []),
      ["No subsequent fuel that day", String(summary.noPostFuelSameDayCount)]
    ];
    return `
      <section class="coach-card coach-training-fuel-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Pre/Post Training Fuel</h2>
            <p>Workout-relative timing from the athlete's shared records. No calories or medical interpretation.</p>
          </div>
        </div>
        <div class="coach-training-fuel-metrics">
          ${metrics.map(([label, value]) => `<article><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("")}
        </div>
        <div class="coach-training-fuel-list">
          ${summary.contexts.slice(0, 5).map(context => `
            <article>
              <div>
                <strong>${safe(workoutTitle(context.workout))}</strong>
                <span>${safe(`${domain.dateKeyInTimeZone(context.workout.startAt, state.timeZone)} · ${domain.formatClockInTimeZone(context.workout.startAt, state.timeZone)}–${domain.formatClockInTimeZone(context.workout.endAt, state.timeZone)}`)}</span>
              </div>
              <dl>
                <div><dt>Before</dt><dd>${safe(context.hasPreviousFuel ? domain.duration(context.preFuelGapMinutes) : "No prior fuel logged")}</dd></div>
                <div><dt>After</dt><dd>${safe(context.hasPostFuel ? domain.duration(context.postFuelGapMinutes) : "No post-session fuel logged")}</dd></div>
              </dl>
            </article>
          `).join("")}
        </div>
        ${summary.enoughForPatterns ? "" : `<p class="coach-note">More sessions are needed before Fuel Guard can identify a pattern.</p>`}
      </section>
    `;
  }

  function trainingModeSessionsForAthlete(athleteId) {
    return state.trainingModeSessions
      .filter(session => String(session.user_id) === String(athleteId) && session.status === "completed" && session.ended_at)
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  function trainingModeSessionModel(row) {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      sessionType: row.session_type,
      status: row.status,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      plan: {
        carbsG: row.plan_carbs_g_per_hour,
        fluidMl: row.plan_fluid_ml_per_hour,
        sodiumMg: row.plan_sodium_mg_per_hour,
        caffeineMg: row.plan_caffeine_mg_per_hour
      }
    };
  }

  function coachTrainingSessionContext(row) {
    const session = trainingModeSessionModel(row);
    const logs = state.logs.filter(log => String(log.userId) === String(row.user_id));
    const summary = domain.trainingSessionIntakeSummary({ session, logs, now: new Date(session.endedAt) });
    const context = domain.getWorkoutFuelContext({
      id: session.id,
      athleteId: session.userId,
      source: "training_mode",
      type: session.sessionType,
      title: session.title,
      startAt: session.startedAt,
      endAt: session.endedAt
    }, logs);
    return { session, summary, context, progress: domain.trainingPlanProgress(summary, session.plan) };
  }

  function renderCoachTrainingFuel(item) {
    const sessions = trainingModeSessionsForAthlete(item.athlete.userId);
    if (!sessions.length) {
      return `<section class="coach-card coach-training-mode-card"><div class="coach-card-heading compact"><div><h2>Training Fuel</h2><p>Completed Training Mode sessions shared by this athlete.</p></div></div><div class="coach-empty compact">No completed Training Mode sessions are available in the last 14 days.</div></section>`;
    }
    const quantities = [
      ["Carbohydrate", "carbsG", "g"],
      ["Fluid", "fluidMl", "ml"],
      ["Sodium", "sodiumMg", "mg"],
      ["Caffeine", "caffeineMg", "mg"]
    ];
    return `
      <section class="coach-card coach-training-mode-card">
        <div class="coach-card-heading compact"><div><h2>Training Fuel</h2><p>Pre, during, and post-session execution from the athlete’s actively shared Training Mode records.</p></div></div>
        <div class="coach-training-mode-list">
          ${sessions.slice(0, 5).map(row => {
            const { session, summary, context, progress } = coachTrainingSessionContext(row);
            const fuelEvents = summary.logs.filter(domain.isFuelLog).length;
            const hydrationEvents = summary.logs.filter(domain.isHydrationLog).length;
            return `
              <article class="coach-training-mode-session">
                <header>
                  <div><strong>${safe(session.title)}</strong><span>${safe(workoutTitle({ type: session.sessionType }))} · ${safe(domain.dateKeyInTimeZone(session.startedAt, state.timeZone))}</span></div>
                  <span>${safe(domain.formatClockInTimeZone(session.startedAt, state.timeZone))}–${safe(domain.formatClockInTimeZone(session.endedAt, state.timeZone))} · ${safe(domain.duration(summary.durationSeconds / 60))}</span>
                </header>
                <div class="coach-training-phase-row">
                  <span>Before<strong>${safe(context?.hasPreviousFuel ? `Pre-training fuel · ${domain.duration(context.preFuelGapMinutes)} before` : "No pre-training fuel recorded")}</strong></span>
                  <span>During<strong>${safe(`${fuelEvents} Fuel · ${hydrationEvents} Hydrate`)}</strong></span>
                  <span>After<strong>${safe(context?.hasPostFuel ? `Post-training fuel · ${domain.duration(context.postFuelGapMinutes)} after` : "No post-training fuel recorded yet")}</strong></span>
                </div>
                <div class="coach-training-quantity-grid">
                  ${quantities.map(([label, field, unit]) => {
                    const plan = progress[field];
                    const execution = plan.plannedRate > 0
                      ? `${domain.wholeMeasurement(plan.plannedRate, `${unit}/h`)} planned · ${plan.state === "on_plan" ? "on plan" : plan.state === "behind" ? "behind plan" : "ahead of plan"}`
                      : "No plan set";
                    return `<span>${safe(label)}<strong>${safe(domain.wholeMeasurement(summary.totals[field], unit))} · ${safe(domain.wholeMeasurement(summary.perHour[field], `${unit}/h`))}</strong><small>${safe(execution)}</small></span>`;
                  }).join("")}
                </div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderCoachBehaviourPatterns(item) {
    const athleteId = item.athlete.userId;
    const sessions = trainingModeSessionsForAthlete(athleteId).map(trainingModeSessionModel);
    const logs = state.logs.filter(log => String(log.userId) === String(athleteId));
    const insights = domain.behaviouralPatternInsights({ logs, sessions, timeZone: state.timeZone }).insights;
    if (sessions.length >= 3) {
      const plannedStates = sessions.flatMap(session => {
        const summary = domain.trainingSessionIntakeSummary({ session, logs, now: new Date(session.endedAt) });
        return Object.values(domain.trainingPlanProgress(summary, session.plan)).filter(metric => metric.plannedRate > 0);
      });
      if (plannedStates.length >= 3) {
        const onPlan = plannedStates.filter(metric => metric.state === "on_plan").length;
        insights.push({
          label: "Training Mode execution",
          value: `${Math.round((onPlan / plannedStates.length) * 100)}% within plan tolerance`,
          detail: `Observed across ${plannedStates.length} planned session measurements; no causal claim is made.`
        });
      }
    }
    return `
      <section class="coach-card coach-behaviour-patterns-card">
        <div class="coach-card-heading compact"><div><h2>Recent patterns</h2><p>Thresholded behavioural observations from actively shared data.</p></div></div>
        ${insights.length ? `<div class="coach-behaviour-pattern-grid">${insights.map(insight => `<article><span>${safe(insight.label)}</span><strong>${safe(insight.value)}</strong><small>${safe(insight.detail)}</small></article>`).join("")}</div>` : `<div class="coach-empty compact">More shared observations are needed before a pattern is shown.</div>`}
      </section>
    `;
  }

  function renderAthleteDetail() {
    const target = $("coachAthleteDetail");
    if (!target) return;
    const item = selectedAthleteStatus();
    if (!item) {
      target.innerHTML = `<section class="coach-card"><div class="coach-empty">Select an assigned athlete to review today's shared logs.</div></section>`;
      return;
    }
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>${safe(item.athlete.displayName)}</h2>
            <p>Read-only view for ${safe(domain.dateKey(new Date()))}. Coaches cannot edit or fabricate logs.</p>
          </div>
        </div>
        <div class="coach-detail-grid">
          <article class="coach-metric">
            <span>Current Status</span>
            <strong>${safe(item.statusLabel)}</strong>
          </article>
          <article class="coach-metric">
            <span>Last fuel</span>
            <strong>${safe(item.lastFuel ? `${domain.duration(item.minutesSinceFuel)} ago` : "No fuel today")}</strong>
          </article>
          <article class="coach-metric">
            <span>Fuel-gap target</span>
            <strong>${safe(item.beyondFuelGapMinutes !== null ? `${domain.duration(item.beyondFuelGapMinutes)} beyond` : item.remainingFuelGapMinutes !== null ? `${domain.duration(item.remainingFuelGapMinutes)} left` : `${domain.duration(item.maximumFuelGapMinutes)} target`)}</strong>
          </article>
          <article class="coach-metric">
            <span>Last hydration</span>
            <strong>${safe(item.lastHydration ? `${domain.duration(item.minutesSinceHydration)} ago` : "No hydration today")}</strong>
          </article>
        </div>
      </section>

      ${renderCoachBehaviourPatterns(item)}

      ${renderCoachTrainingFuel(item)}

      ${renderCoachWorkoutFuel(item)}

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Today</h2>
            <p>Timing and frequency only. No calories, weight, or medical interpretation.</p>
          </div>
        </div>
        <div class="coach-count-grid">
          <article class="coach-metric"><span>Fuel</span><strong>${safe(item.fuelLogs.length)}</strong></article>
          <article class="coach-metric"><span>Hydration</span><strong>${safe(item.hydrationLogs.length)}</strong></article>
          <article class="coach-metric"><span>Sleepy</span><strong>${safe(item.sleepyLogs.length)}</strong></article>
          <article class="coach-metric"><span>Source mix</span><strong>${safe(sourceSummary(item.logs))}</strong></article>
        </div>
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Timeline</h2>
            <p>Chronological Fuel, Hydration, and Sleepy events shared by the athlete.</p>
          </div>
        </div>
        ${renderTimeline(item.logs)}
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Today's Patterns</h2>
            <p>Switch between event types to see when they happened today.</p>
          </div>
        </div>
        <nav class="coach-pattern-tabs" aria-label="Pattern type">
          ${PATTERN_TYPES.map(type => `
            <button class="${state.selectedPattern === type.id ? "active" : ""}" type="button" data-coach-pattern="${safe(type.id)}" aria-pressed="${state.selectedPattern === type.id ? "true" : "false"}">${safe(type.label)}</button>
          `).join("")}
        </nav>
        ${renderPatternChart(item)}
      </section>

      <section class="coach-card">
        <div class="coach-card-heading compact">
          <div>
            <h2>Context</h2>
            <p>Context comes from shared day labels and Garmin-derived records when available.</p>
          </div>
        </div>
        <div class="coach-context-grid">
          <article class="coach-metric"><span>Day</span><strong>${safe(item.context.dayTypeLabel)}</strong></article>
          <article class="coach-metric"><span>Session</span><strong>${safe(item.context.trainingSessionLabel)}</strong></article>
          <article class="coach-metric"><span>Garmin logs</span><strong>${safe(item.logs.filter(log => log.source === "garmin").length)}</strong></article>
          <article class="coach-metric"><span>Flags</span><strong>${safe(item.flags.length ? item.flags.map(flag => flag.label).join(", ") : "None")}</strong></article>
        </div>
      </section>

      ${renderCoachActions(item)}
      ${renderSharedStaffContext(item)}
    `;
  }

  function sourceSummary(logs) {
    const garmin = logs.filter(log => log.source === "garmin").length;
    const manual = logs.length - garmin;
    if (garmin && manual) return "Mixed";
    if (garmin) return "Garmin";
    return manual ? "Manual" : "None";
  }

  function renderRelationships() {
    const target = $("coachRelationshipList");
    if (!target) return;
    target.innerHTML = state.relationships.length
      ? state.relationships.map(relation => `
        <article class="coach-relationship-row">
          <div>
            <strong>${safe(relation.athlete_label || `Athlete ${String(relation.athlete_id).slice(0, 8)}`)}</strong>
            <p class="coach-note">${safe(relationshipStatusCopy(relation.status))}</p>
          </div>
          <div class="coach-row-meta">
            <span>Status: ${safe(relation.status)}</span>
            <span>${safe(relation.status === "active" ? "Sharing active" : relation.status === "pending" ? "Waiting for athlete approval" : relation.status === "declined" ? "Request declined" : "Revoked")}</span>
          </div>
          <div class="coach-button-row">
            <button class="secondary" type="button" data-revoke-relationship="${safe(relation.id)}">Remove</button>
          </div>
        </article>
      `).join("")
      : `<div class="coach-empty">No relationships yet. Ask an athlete for their Fuel Guard Athlete Code to connect.</div>`;
  }

  function organisationForTeam(team) {
    return state.organisations.find(item => String(item.id) === String(team?.organisation_id)) || null;
  }

  function currentStaffForTeam(teamId) {
    const userId = coachUser()?.id || "";
    return state.teamStaff.find(staff => String(staff.team_id) === String(teamId) && String(staff.user_id) === String(userId) && staff.status === "active") || null;
  }

  function canContributeToTeam(teamId) {
    return ["contributor", "manager"].includes(currentStaffForTeam(teamId)?.access_level);
  }

  function activeTeamAthletes(teamId) {
    const authorised = new Set(athleteRows().map(athlete => String(athlete.userId)));
    return state.teamAthletes.filter(member => (
      String(member.team_id) === String(teamId)
      && member.status === "active"
      && authorised.has(String(member.athlete_id))
    ));
  }

  function athleteName(athleteId) {
    return athleteRows().find(item => String(item.userId) === String(athleteId))?.displayName || `Athlete ${String(athleteId || "").slice(0, 8)}`;
  }

  function renderTeamSetup() {
    const target = $("coachTeamSetup");
    if (!target) return;
    if (!state.organisationFeaturesReady) {
      target.innerHTML = `<section class="coach-card"><div class="coach-empty">Team, shared-note, group, and schedule storage is not available in this Supabase environment yet.</div></section>`;
      return;
    }
    const organisationOptions = state.organisations.map(item => `<option value="${safe(item.id)}">${safe(item.name)}</option>`).join("");
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact"><div><h2>Team setup</h2><p>Teams provide context for shared staff notes and training schedules. Direct athlete sharing is still required.</p></div></div>
        <div class="coach-form-grid">
          <label>New organisation<input id="coachNewOrganisationName" type="text" maxlength="160" placeholder="Organisation name"></label>
          <div class="coach-code-action"><button class="secondary" type="button" data-create-organisation>Create organisation</button></div>
          <label>Organisation<select id="coachNewTeamOrganisation">${organisationOptions || `<option value="">Create an organisation first</option>`}</select></label>
          <label>Team name<input id="coachNewTeamName" type="text" maxlength="160" placeholder="Team name"></label>
          <label>Team timezone<input id="coachNewTeamTimezone" type="text" maxlength="80" value="${safe(state.timeZone)}" placeholder="Europe/London"></label>
          <div class="coach-code-action"><button class="secondary" type="button" data-create-team ${state.organisations.length ? "" : "disabled"}>Create team</button></div>
        </div>
        <div class="coach-team-list">
          ${state.teams.length ? state.teams.map(team => {
            const assigned = new Set(activeTeamAthletes(team.id).map(member => String(member.athlete_id)));
            return `
              <article class="coach-team-card">
                <div><strong>${safe(team.name)}</strong><p>${safe(organisationForTeam(team)?.name || "Organisation")} · ${safe(team.timezone_name)}</p></div>
                <div class="coach-membership-list">
                  ${athleteRows().length ? athleteRows().map(athlete => `
                    <label><input type="checkbox" data-team-athlete-team="${safe(team.id)}" data-team-athlete-id="${safe(athlete.userId)}" ${assigned.has(String(athlete.userId)) ? "checked" : ""} ${canContributeToTeam(team.id) ? "" : "disabled"}> ${safe(athlete.displayName)}</label>
                  `).join("") : `<span class="coach-note">Connect an athlete before assigning the team roster.</span>`}
                </div>
              </article>
            `;
          }).join("") : `<div class="coach-empty compact">No teams yet.</div>`}
        </div>
      </section>
    `;
  }

  function renderSavedGroups() {
    const target = $("coachSavedGroups");
    if (!target) return;
    if (!state.organisationFeaturesReady) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading compact"><div><h2>Saved groups</h2><p>Create reusable roster scopes for the dashboard, Needs Attention, and team analytics.</p></div></div>
        <div class="coach-form-grid coach-group-create-grid">
          <label>Group name<input id="coachNewGroupName" type="text" maxlength="100" placeholder="e.g. Academy squad"></label>
          <div class="coach-code-action"><button class="secondary" type="button" data-create-saved-group>Create group</button></div>
        </div>
        <div class="coach-group-list">
          ${state.savedGroups.length ? state.savedGroups.map(group => {
            const members = groupAthleteIds(group.id) || new Set();
            const editable = group.scope === "personal" || canContributeToTeam(group.team_id);
            return `
              <article class="coach-group-card">
                <div class="coach-group-heading">
                  <input type="text" maxlength="100" value="${safe(group.name)}" aria-label="Group name" data-group-name-input="${safe(group.id)}" ${editable ? "" : "readonly"}>
                  <span>${safe(group.scope === "team" ? "Team group" : "Personal group")}</span>
                </div>
                <div class="coach-membership-list">
                  ${athleteRows().length ? athleteRows().map(athlete => `
                    <label><input type="checkbox" data-group-member-group="${safe(group.id)}" data-group-member-athlete="${safe(athlete.userId)}" ${members.has(String(athlete.userId)) ? "checked" : ""} ${editable ? "" : "disabled"}> ${safe(athlete.displayName)}</label>
                  `).join("") : `<span class="coach-note">No actively shared athletes are available.</span>`}
                </div>
                ${editable ? `<div class="coach-button-row"><button class="secondary" type="button" data-rename-saved-group="${safe(group.id)}">Save name</button><button class="secondary danger-secondary" type="button" data-delete-saved-group="${safe(group.id)}">Delete group</button></div>` : ""}
              </article>
            `;
          }).join("") : `<div class="coach-empty compact">No saved groups yet.</div>`}
        </div>
      </section>
    `;
  }

  function renderSharedStaffContext(item) {
    if (!state.organisationFeaturesReady) return "";
    const memberships = state.teamAthletes.filter(member => member.status === "active" && String(member.athlete_id) === String(item.athlete.userId));
    const teams = memberships.map(member => state.teams.find(team => String(team.id) === String(member.team_id))).filter(Boolean);
    if (!teams.length) return `
      <section class="coach-card"><div class="coach-card-heading compact"><div><h2>Shared staff context</h2><p>Add this athlete to an authorised team in Settings to share immutable staff notes.</p></div></div><div class="coach-empty compact">No authorised team context for this athlete.</div></section>
    `;
    const notes = state.staffNotes.filter(note => String(note.athlete_id) === String(item.athlete.userId));
    const contributorTeams = teams.filter(team => canContributeToTeam(team.id));
    return `
      <section class="coach-card">
        <div class="coach-card-heading compact"><div><h2>Shared staff context</h2><p>Immutable notes visible only to authorised team staff who also retain direct athlete sharing.</p></div></div>
        ${contributorTeams.length ? `
          <div class="coach-form-grid">
            <label>Team<select id="coachStaffNoteTeam">${contributorTeams.map(team => `<option value="${safe(team.id)}">${safe(team.name)}</option>`).join("")}</select></label>
            <label>Category<select id="coachStaffNoteCategory"><option value="general">General</option><option value="nutrition_reviewed">Nutrition reviewed</option><option value="coach_contact">Coach contact</option><option value="travel_plan">Travel plan</option><option value="training">Training</option><option value="other">Other</option></select></label>
          </div>
          <label class="coach-textarea-label">Shared note<textarea id="coachStaffNoteText" rows="3" maxlength="4000" placeholder="Factual context for authorised staff"></textarea></label>
          <div class="coach-button-row"><button class="secondary" type="button" data-create-staff-note="${safe(item.athlete.userId)}">Add shared note</button></div>
        ` : `<p class="coach-note">You have view-only team access. Existing notes remain visible, but you cannot add one.</p>`}
        <div class="coach-staff-note-list">
          ${notes.length ? notes.map(note => {
            const team = state.teams.find(row => String(row.id) === String(note.team_id));
            const organisation = state.organisations.find(row => String(row.id) === String(note.organisation_id));
            return `<article><div><strong>${safe(note.author_display_name || "Fuel Guard Staff")}</strong><span>${safe(note.category.replace(/_/g, " "))}</span></div><p>${safe(note.note_text)}</p><time>${safe(organisation?.name || "Organisation")} · ${safe(team?.name || "Team")} · ${safe(domain.dateKey(note.created_at))} ${safe(domain.formatClock(note.created_at))}</time></article>`;
          }).join("") : `<div class="coach-empty compact">No shared staff notes yet.</div>`}
        </div>
      </section>
    `;
  }

  function sessionContexts(sessionId) {
    return state.trainingContext.filter(context => String(context.session_id) === String(sessionId));
  }

  function sessionCoachNote(sessionId) {
    return state.trainingSessionNotes.find(note => String(note.session_id) === String(sessionId)) || null;
  }

  function sessionTypeLabel(value) {
    const type = String(value || "other").toLowerCase();
    return type === "game" ? "Game" : type === "training" ? "Training" : "Other";
  }

  function trainingSessionTriage(session) {
    if (!session || String(state.selectedTrainingSessionId) !== String(session.id)) return "";
    const rows = sessionContexts(session.id);
    const completed = new Date(session.ends_at) <= new Date();
    const statusLabel = status => ({
      green: "Green",
      yellow: "Amber",
      amber: "Amber",
      red: "Red",
      no_logging: "Grey",
      grey: "Grey",
      prompt: "Fuelled promptly",
      late: "Fuelled late",
      no_fuel: "No fuel recorded",
      pending: "Session pending"
    })[status] || status;
    const preSummary = domain.prePracticeTeamSummary(rows);
    const preStatusDetail = row => {
      const status = domain.normalizePrePracticeStatus(row.pre_session_status);
      if (status === "green") return "Fuelled recently";
      if (status === "amber") return "Eat soon";
      if (status === "red" && row.last_fuel_at) {
        return `No fuel since ${domain.formatClockInTimeZone(row.last_fuel_at, row.timezone_name || state.timeZone)}`;
      }
      if (status === "red") return "Recorded fuel gap is beyond the Daily target";
      return "Not enough logging data";
    };
    return `
      <div class="coach-team-session-triage">
        <div class="coach-card-heading compact"><div><h3>${safe(completed ? "Post-session summary" : "Pre-session triage")}</h3><p>${safe(rows.length ? `${rows.length} actively shared athlete${rows.length === 1 ? "" : "s"}` : "No actively shared athletes are visible for this session.")}</p></div></div>
        ${!completed && rows.length ? `<div class="coach-pre-practice-summary" aria-label="Pre-practice fuelling status summary">
          <div class="coach-pre-practice-counts">
            <span class="green"><b>${safe(preSummary.counts.green)}</b> Green</span>
            <span class="amber"><b>${safe(preSummary.counts.amber)}</b> Amber</span>
            <span class="red"><b>${safe(preSummary.counts.red)}</b> Red</span>
            <span class="grey"><b>${safe(preSummary.counts.grey)}</b> Grey</span>
          </div>
          <p>${safe(preSummary.insight)}</p>
        </div>` : ""}
        ${rows.length ? rows.map(row => {
          const status = completed ? row.post_session_status : row.pre_session_status;
          const detail = completed
            ? Number.isFinite(Number(row.post_fuel_gap_minutes)) ? `${domain.duration(Number(row.post_fuel_gap_minutes))} after the session` : "No Fuel event is available in the post-session window."
            : preStatusDetail(row);
          const visualStatus = completed ? status : domain.normalizePrePracticeStatus(status);
          return `<article><div><strong>${safe(row.athlete_name || "Fuel Guard Athlete")}</strong><span>${safe(detail)}</span></div><span class="coach-session-status ${safe(visualStatus)}">${safe(statusLabel(visualStatus))}</span><button type="button" data-open-athlete="${safe(row.athlete_id)}">View</button></article>`;
        }).join("") : `<div class="coach-empty compact">Team membership never bypasses direct Athlete sharing.</div>`}
      </div>
    `;
  }

  function trainingSessionList(title, sessions, now) {
    return `
      <section class="coach-team-session-group">
        <div class="coach-card-heading compact"><div><h3>${safe(title)}</h3><p>${safe(sessions.length ? `${sessions.length} session${sessions.length === 1 ? "" : "s"}` : "None")}</p></div></div>
        <div class="coach-training-list">
          ${sessions.length ? sessions.map(session => {
            const contexts = sessionContexts(session.id);
            const note = sessionCoachNote(session.id);
            const team = state.teams.find(item => String(item.id) === String(session.team_id));
            const cancelled = session.status === "cancelled";
            const deletable = canContributeToTeam(session.team_id) && new Date(session.starts_at) > now;
            const mutable = !cancelled && deletable;
            return `<article class="coach-team-session-row ${cancelled ? "cancelled" : ""}">
              <div><strong>${safe(session.session_name || sessionTypeLabel(session.session_type))}</strong><p>${safe(team?.name || "Team")} · ${safe(sessionTypeLabel(session.session_type))}${cancelled ? " · Cancelled" : ""}</p>${note ? `<small>${safe(note.note_text)}</small>` : ""}</div>
              <time>${safe(session.session_date)} · ${safe(domain.formatClockInTimeZone(session.starts_at, session.timezone_name))}–${safe(domain.formatClockInTimeZone(session.ends_at, session.timezone_name))}</time>
              <span>${safe(contexts.length)} shared athlete${contexts.length === 1 ? "" : "s"} visible</span>
              <div class="coach-team-session-actions">
                <button class="secondary" type="button" data-view-team-session="${safe(session.id)}">${String(state.selectedTrainingSessionId) === String(session.id) ? "Hide" : "View"}</button>
                ${mutable ? `<button class="secondary" type="button" data-edit-team-session="${safe(session.id)}">Edit</button><button class="secondary" type="button" data-cancel-team-session="${safe(session.id)}">Cancel</button>` : ""}
                ${deletable ? `<button class="secondary danger-secondary" type="button" data-delete-team-session="${safe(session.id)}">Delete</button>` : ""}
              </div>
              ${trainingSessionTriage(session)}
            </article>`;
          }).join("") : `<div class="coach-empty compact">No ${safe(title.toLowerCase())}.</div>`}
        </div>
      </section>
    `;
  }

  function renderTrainingSchedule() {
    const target = $("coachTrainingSchedule");
    if (!target) return;
    if (!state.organisationFeaturesReady) {
      target.innerHTML = "";
      return;
    }
    const writableTeams = state.teams.filter(team => canContributeToTeam(team.id));
    const editing = state.trainingSessions.find(session => String(session.id) === String(state.editingTrainingSessionId)) || null;
    const firstTeam = state.teams.find(team => String(team.id) === String(editing?.team_id)) || writableTeams[0] || state.teams[0] || null;
    const start = editing ? new Date(editing.starts_at) : new Date(Date.now() + 3600000);
    if (!editing) start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
    const end = editing ? new Date(editing.ends_at) : new Date(start.getTime() + 90 * 60000);
    const initialTimeZone = editing?.timezone_name || firstTeam?.timezone_name || state.timeZone;
    const localValue = date => {
      const parts = domain.zonedDateParts(date, initialTimeZone);
      return `${domain.dateKeyInTimeZone(date, initialTimeZone)}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
    };
    const now = new Date();
    const upcoming = state.trainingSessions.filter(session => session.status === "scheduled" && new Date(session.ends_at) >= now).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    const recent = state.trainingSessions.filter(session => session.status === "cancelled" || new Date(session.ends_at) < now).sort((a, b) => new Date(b.starts_at) - new Date(a.starts_at));
    const note = editing ? sessionCoachNote(editing.id)?.note_text || "" : "";
    target.innerHTML = `
      <section class="coach-card coach-team-sessions">
        <div class="coach-card-heading compact"><div><h2>Sessions</h2><p>Shared team context for Training, Games and Other sessions. Athlete logging stays unchanged.</p></div></div>
        ${writableTeams.length ? `
          <div class="coach-form-grid">
            <label>Team<select id="coachTrainingTeam" ${editing ? "disabled" : ""}>${writableTeams.map(team => `<option value="${safe(team.id)}"${String(team.id) === String(firstTeam?.id) ? " selected" : ""}>${safe(team.name)}</option>`).join("")}</select></label>
            <label>Session type<select id="coachTrainingType"><option value="training"${editing?.session_type === "training" ? " selected" : ""}>Training</option><option value="game"${editing?.session_type === "game" ? " selected" : ""}>Game</option><option value="other"${editing?.session_type === "other" ? " selected" : ""}>Other</option></select></label>
            <label>Title<input id="coachTrainingName" type="text" maxlength="160" value="${safe(editing?.session_name || "")}" placeholder="Evening training"></label>
            <label>Starts<input id="coachTrainingStarts" type="datetime-local" value="${safe(localValue(start))}"></label>
            <label>Ends<input id="coachTrainingEnds" type="datetime-local" value="${safe(localValue(end))}"></label>
            <label>Timezone<input id="coachTrainingTimezone" type="text" maxlength="80" value="${safe(initialTimeZone)}"></label>
            <label>Location<input id="coachTrainingLocation" type="text" maxlength="160" value="${safe(editing?.location || "")}" placeholder="Optional"></label>
            <label class="coach-form-wide">Coach note<textarea id="coachTrainingNote" maxlength="2000" placeholder="Internal note, never shown to athletes">${safe(note)}</textarea></label>
          </div>
          <div class="coach-button-row"><button class="secondary" type="button" data-create-training-session>${editing ? "Save changes" : "Create session"}</button>${editing ? `<button class="secondary" type="button" data-cancel-training-edit>Cancel edit</button>` : ""}</div>
        ` : `<div class="coach-empty compact">Create a team with contributor access in Settings before adding a session.</div>`}
        ${trainingSessionList("Upcoming", upcoming, now)}
        ${trainingSessionList("Recent", recent, now)}
      </section>
    `;
  }

  function renderSettings() {
    const user = coachUser();
    const displayName = $("coachDisplayName");
    const firstName = $("coachFirstName");
    const lastName = $("coachLastName");
    const email = $("coachProfileEmail");
    const jobTitle = $("coachJobTitle");
    const avatarUrl = $("coachAvatarUrl");
    const userId = $("coachUserId");
    if (displayName && document.activeElement !== displayName) displayName.value = state.profile?.display_name || "";
    if (firstName && document.activeElement !== firstName) firstName.value = state.profile?.first_name || "";
    if (lastName && document.activeElement !== lastName) lastName.value = state.profile?.last_name || "";
    if (email) email.value = user?.email || "";
    if (jobTitle && document.activeElement !== jobTitle) jobTitle.value = state.profile?.job_title || "";
    if (avatarUrl && document.activeElement !== avatarUrl) avatarUrl.value = state.profile?.avatar_url || "";
    if (userId) userId.value = user?.id || "";
    const points = $("coachPointsProfile");
    if (points) {
      const profile = state.pointsProfile || {};
      const coachAwards = (profile.recentAwards || []).filter(item => item.roleContext === "coach");
      const coachMilestones = Array.isArray(profile.coachMilestones) ? profile.coachMilestones : [];
      const nextMilestone = coachMilestones
        .filter(item => !item.earnedAt && Number(item.threshold) > Number(item.currentValue || 0))
        .sort((a, b) => (Number(a.threshold) - Number(a.currentValue || 0)) - (Number(b.threshold) - Number(b.currentValue || 0)))[0] || null;
      points.innerHTML = `
        <div><span>Coach points</span><strong>${Number(profile.coachPoints || 0).toLocaleString("en-GB")}</strong></div>
        <div><span>Review streak</span><strong>${Number(profile.currentReviewStreak || 0)} week${Number(profile.currentReviewStreak || 0) === 1 ? "" : "s"}</strong></div>
        <div><span>Reviews completed</span><strong>${Number(profile.completedWeeklyReviews || 0).toLocaleString("en-GB")}</strong></div>
        <div><span>Roles</span><strong>${safe((profile.roles || ["coach"]).join(" · "))}</strong></div>
        <div><span>Recent award</span><strong>${safe(coachAwards[0]?.reason || "Complete a weekly review to begin")}</strong></div>
        <div><span>Next milestone</span><strong>${nextMilestone ? `${safe(nextMilestone.title)} · ${Number(nextMilestone.currentValue || 0)} / ${Number(nextMilestone.threshold || 0)} · +${Number(nextMilestone.points || 0)}` : "All current milestones reached"}</strong></div>
        <p>Points recognise completed support workflows. Rewards are coming soon.</p>
      `;
    }
    renderRelationships();
    renderTeamSetup();
    renderSavedGroups();
  }

  function renderAuth() {
    const loadingPanel = $("coachLoadingPanel");
    const authPanel = $("coachAuthPanel");
    const accessPanel = $("coachAccessPanel");
    const appShell = $("coachAppShell");
    const globalStatus = $("coachGlobalStatus");
    const signedIn = Boolean(coachUser());
    const coachReady = signedIn && isCoachEnabled();
    const loading = !state.authResolved || state.coachLoading;
    if (loadingPanel) loadingPanel.hidden = !loading;
    if (authPanel) authPanel.hidden = loading || signedIn;
    if (accessPanel) accessPanel.hidden = loading || !signedIn || coachReady || !state.coachAccessBlocked;
    if (appShell) appShell.hidden = loading || !coachReady;
    if (globalStatus) globalStatus.hidden = loading || !coachReady;
  }

  function renderTabs() {
    document.querySelectorAll("[data-coach-tab]").forEach(button => {
      button.classList.toggle("active", button.dataset.coachTab === state.currentTab);
    });
    document.querySelectorAll(".coach-panel").forEach(panel => {
      panel.classList.toggle("active", panel.id === `coach${state.currentTab[0].toUpperCase()}${state.currentTab.slice(1)}Panel`);
    });
  }

  function render() {
    renderAuth();
    renderTabs();
    renderGroupFilter();
    renderWeeklyBrief();
    renderTeamPatterns();
    renderDueReviews();
    renderNeedsAttention();
    renderDataHealth();
    renderRoster();
    renderAthleteList();
    renderAthleteDetail();
    renderReportControls();
    renderInterventionReview();
    renderTrainingSchedule();
    renderSettings();
  }

  async function ensureCoachProfile({ enableCoach = false } = {}) {
    const user = coachUser();
    if (!state.client || !user) return;

    const { data: profile, error: profileError } = await state.client
      .from(TABLES.profiles)
      .select(profileSelect())
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (!profile) {
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .upsert({
          user_id: user.id,
          role: "athlete",
          coach_enabled: Boolean(enableCoach),
          display_name: user.email || "Coach",
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })
        .select(profileSelect())
        .single();
      if (error) throw error;
      state.profile = data;
    } else {
      state.profile = profile;
    }

    if (enableCoach && !isCoachEnabled()) {
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .update({ coach_enabled: true, updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select(profileSelect())
        .single();
      if (error) throw error;
      state.profile = data;
    }

    return state.profile;
  }

  function resetOrganisationData() {
    state.organisations = [];
    state.teams = [];
    state.teamStaff = [];
    state.teamAthletes = [];
    state.staffNotes = [];
    state.savedGroups = [];
    state.savedGroupMembers = [];
    state.trainingSessions = [];
    state.trainingAssignments = [];
    state.trainingSessionNotes = [];
    state.trainingContext = [];
    state.teamSessionBrief = null;
    state.organisationFeaturesReady = true;
    state.selectedGroupId = "";
  }

  function organisationFoundationMissing(error) {
    return /fuel_organisations|fuel_teams|fuel_team_staff|fuel_team_athletes|fuel_staff_notes|fuel_saved_groups|fuel_saved_group_members|fuel_training_sessions|fuel_training_session_athletes|fuel_training_session_coach_notes|fuel_team_session_context|does not exist|schema cache/i.test(String(error?.message || ""));
  }

  async function loadOrganisationData(user, athleteIds) {
    const previousGroupId = state.selectedGroupId;
    resetOrganisationData();
    try {
      const organisationsResult = await state.client.from(TABLES.organisations).select("*").order("name", { ascending: true });
      if (organisationsResult.error) throw organisationsResult.error;
      state.organisations = organisationsResult.data || [];

      const teamsResult = await state.client.from(TABLES.teams).select("*").order("name", { ascending: true });
      if (teamsResult.error) throw teamsResult.error;
      state.teams = teamsResult.data || [];

      const groupsResult = await state.client.from(TABLES.savedGroups).select("*").order("name", { ascending: true });
      if (groupsResult.error) throw groupsResult.error;
      state.savedGroups = groupsResult.data || [];
      state.selectedGroupId = state.savedGroups.some(group => String(group.id) === String(previousGroupId)) ? previousGroupId : "";

      const groupIds = state.savedGroups.map(group => group.id);
      if (groupIds.length) {
        const membersResult = await state.client.from(TABLES.savedGroupMembers).select("*").in("group_id", groupIds);
        if (membersResult.error) throw membersResult.error;
        state.savedGroupMembers = membersResult.data || [];
      }

      const teamIds = state.teams.map(team => team.id);
      if (!teamIds.length) return;

      const staffResult = await state.client.from(TABLES.teamStaff).select("*").in("team_id", teamIds);
      if (staffResult.error) throw staffResult.error;
      state.teamStaff = staffResult.data || [];

      const teamAthletesResult = await state.client.from(TABLES.teamAthletes).select("*").in("team_id", teamIds);
      if (teamAthletesResult.error) throw teamAthletesResult.error;
      state.teamAthletes = teamAthletesResult.data || [];

      if (athleteIds.length) {
        const notesResult = await state.client
          .from(TABLES.staffNotes)
          .select("*")
          .in("team_id", teamIds)
          .in("athlete_id", athleteIds)
          .order("created_at", { ascending: false })
          .limit(200);
        if (notesResult.error) throw notesResult.error;
        state.staffNotes = notesResult.data || [];
      }

      const from = new Date(Date.now() - 28 * 86400000).toISOString();
      const to = new Date(Date.now() + 14 * 86400000).toISOString();
      const sessionsResult = await state.client
        .from(TABLES.trainingSessions)
        .select("*")
        .in("team_id", teamIds)
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at", { ascending: true });
      if (sessionsResult.error) throw sessionsResult.error;
      state.trainingSessions = sessionsResult.data || [];

      const sessionIds = state.trainingSessions.map(session => session.id);
      if (sessionIds.length) {
        const assignmentsResult = await state.client.from(TABLES.trainingAssignments).select("*").in("session_id", sessionIds);
        if (assignmentsResult.error) throw assignmentsResult.error;
        state.trainingAssignments = assignmentsResult.data || [];

        const notesResult = await state.client.from(TABLES.trainingSessionNotes).select("*").in("session_id", sessionIds);
        if (notesResult.error) throw notesResult.error;
        state.trainingSessionNotes = notesResult.data || [];

        const contextResult = await state.client.rpc("fuel_team_session_context", {
          p_from: from,
          p_to: to
        });
        if (contextResult.error) throw contextResult.error;
        const visibleSessionIds = new Set(sessionIds.map(String));
        state.trainingContext = (contextResult.data || []).filter(row => visibleSessionIds.has(String(row.session_id)));
      }
    } catch (error) {
      if (!organisationFoundationMissing(error)) throw error;
      resetOrganisationData();
      state.organisationFeaturesReady = false;
    }
  }

  async function loadCoachData({ enableCoach = false, reason = "coach-data" } = {}) {
    const user = coachUser();
    if (!state.client || !user) return;
    state.authResolved = true;
    state.coachLoading = true;
    state.coachAccessBlocked = false;
    setStatus("Loading coach data...");
    renderAuth();

    try {
      await ensureCoachProfile({ enableCoach });

      if (!isCoachEnabled()) {
        state.coachAccessBlocked = true;
        state.relationships = [];
        state.athleteProfiles = [];
        state.logs = [];
        state.targets = [];
        state.reports = [];
        state.interventions = [];
        state.attentionActions = [];
        state.notes = [];
        state.nudges = [];
        state.dataHealthRows = [];
        state.garminActivities = [];
        state.trainingModeSessions = [];
        state.demandBlocks = [];
        state.workoutFuelContexts = [];
        state.workoutFuelSummaries = [];
        state.teamDataHealth = { items: [], summary: {} };
        state.attentionItems = [];
        state.schedules = [];
        resetOrganisationData();
        state.roster = [];
        state.weeklyBrief = null;
        state.pointsProfile = null;
        state.coachLoading = false;
        platformController?.reset();
        setStatus("This account is signed in, but Coach Beta is not enabled for it yet.");
        render();
        return;
      }

      const pointsResult = await state.client.rpc("fuel_points_profile", { p_time_zone: state.timeZone });
      state.pointsProfile = pointsResult.error ? null : pointsResult.data;

      const { data: relationships, error: relationshipError } = await state.client
        .from(TABLES.relationships)
        .select("id,coach_id,athlete_id,status,athlete_label,coach_label,created_at,accepted_at,revoked_at")
        .eq("coach_id", user.id)
        .in("status", ["pending", "active", "declined"])
        .order("created_at", { ascending: false });
      if (relationshipError) throw relationshipError;
      state.relationships = relationships || [];

      const athleteIds = state.relationships.filter(relation => relation.status === "active").map(relation => relation.athlete_id);
      state.athleteProfiles = [];
      state.logs = [];
      state.targets = [];
      state.reports = [];
      state.interventions = [];
      state.attentionActions = [];
      state.notes = [];
      state.nudges = [];
      state.dataHealthRows = [];
      state.schedules = [];
      state.garminActivities = [];
      state.trainingModeSessions = [];
      state.demandBlocks = [];
      state.workoutFuelContexts = [];
      state.workoutFuelSummaries = [];

      if (athleteIds.length) {
        const { data: profiles, error: profilesError } = await state.client
          .from(TABLES.profiles)
          .select(profileSelect())
          .in("user_id", athleteIds);
        if (profilesError) throw profilesError;
        state.athleteProfiles = profiles || [];

        const weeklyPeriod = domain.weeklyReportingPeriod({ now: new Date(), timeZone: state.timeZone });
        const comparisonPeriod = domain.previousPeriodRange(weeklyPeriod);
        const workoutWindowStart = new Date(Date.now() - 15 * 86400000);
        const dashboardStartKey = [
          comparisonPeriod.startKey,
          domain.dateKeyInTimeZone(workoutWindowStart, state.timeZone)
        ].sort()[0];
        const dashboardPeriod = domain.periodFromKeys(
          dashboardStartKey,
          domain.dateKeyInTimeZone(new Date(), state.timeZone),
          "coach_dashboard",
          state.timeZone
        );
        const dashboardBounds = domain.periodQueryBounds(dashboardPeriod, state.timeZone);
        const { data: logs, error: logsError } = await state.client
          .from(TABLES.logs)
          .select("id,user_id,logged_at,type,source,external_event_id,day_type,training_session,training_mode_session_id,training_mode_preset_id,carbs_g,fluid_ml,sodium_mg,caffeine_mg,notes,created_at")
          .in("user_id", athleteIds)
          .gte("logged_at", dashboardBounds.start.toISOString())
          .lt("logged_at", dashboardBounds.endExclusive.toISOString())
          .order("logged_at", { ascending: true });
        if (logsError) throw logsError;
        state.logs = (logs || []).map(domain.normalizeLog).filter(Boolean);

        const workoutWindowEnd = new Date();
        const [garminResult, demandResult, trainingModeResult] = await Promise.all([
          state.client
            .from(TABLES.garminActivities)
            .select("id,user_id,source,source_activity_id,activity_type,started_at,duration_seconds")
            .in("user_id", athleteIds)
            .gte("started_at", workoutWindowStart.toISOString())
            .lte("started_at", workoutWindowEnd.toISOString())
            .order("started_at", { ascending: false }),
          state.client
            .from(TABLES.demandBlocks)
            .select("id,user_id,type,start_time,end_time,title,session_type")
            .in("user_id", athleteIds)
            .eq("type", "training")
            .gte("end_time", workoutWindowStart.toISOString())
            .lte("end_time", workoutWindowEnd.toISOString())
            .order("start_time", { ascending: false }),
          state.client
            .from(TABLES.trainingModeSessions)
            .select("*")
            .in("user_id", athleteIds)
            .eq("status", "completed")
            .gte("started_at", workoutWindowStart.toISOString())
            .lte("started_at", workoutWindowEnd.toISOString())
            .order("started_at", { ascending: false })
        ]);
        if (garminResult.error) throw garminResult.error;
        if (demandResult.error) throw demandResult.error;
        if (trainingModeResult.error) throw trainingModeResult.error;
        state.garminActivities = garminResult.data || [];
        state.demandBlocks = demandResult.data || [];
        state.trainingModeSessions = trainingModeResult.data || [];

        const { data: targets, error: targetsError } = await state.client
          .from(TABLES.targets)
          .select("user_id,daily_fuel_logs,daily_hydration_logs,maximum_fuel_gap_minutes,updated_at")
          .in("user_id", athleteIds);
        if (targetsError && /maximum_fuel_gap_minutes|schema cache|does not exist/i.test(targetsError.message || "")) {
          const legacy = await state.client
            .from(TABLES.targets)
            .select("user_id,daily_fuel_logs,daily_hydration_logs,updated_at")
            .in("user_id", athleteIds);
          if (legacy.error) throw legacy.error;
          state.targets = legacy.data || [];
        } else if (targetsError) {
          throw targetsError;
        } else {
          state.targets = targets || [];
        }

        const { data: reports, error: reportsError } = await state.client
          .from(TABLES.reports)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("created_at", { ascending: false });
        if (reportsError) throw reportsError;
        state.reports = reports || [];

        const { data: interventions, error: interventionsError } = await state.client
          .from(TABLES.interventions)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("created_at", { ascending: false });
        if (interventionsError) throw interventionsError;
        state.interventions = interventions || [];

        const { error: dueError } = await state.client.rpc("fuel_coach_refresh_due_interventions");
        if (dueError) throw dueError;
        const refreshedInterventions = await state.client
          .from(TABLES.interventions)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("created_at", { ascending: false });
        if (refreshedInterventions.error) throw refreshedInterventions.error;
        state.interventions = refreshedInterventions.data || [];

        const { data: attentionActions, error: attentionError } = await state.client
          .from(TABLES.attentionActions)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("acted_at", { ascending: false });
        if (attentionError) throw attentionError;
        state.attentionActions = attentionActions || [];

        const { data: notes, error: notesError } = await state.client
          .from(TABLES.notes)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("created_at", { ascending: false })
          .limit(100);
        if (notesError) throw notesError;
        state.notes = notes || [];

        const { data: nudges, error: nudgesError } = await state.client
          .from(TABLES.nudges)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("sent_at", { ascending: false })
          .limit(100);
        if (nudgesError) throw nudgesError;
        state.nudges = nudges || [];

        const { data: dataHealth, error: dataHealthError } = await state.client.rpc("fuel_coach_data_health");
        if (dataHealthError) throw dataHealthError;
        state.dataHealthRows = dataHealth || [];

        const { data: schedules, error: schedulesError } = await state.client
          .from(TABLES.schedules)
          .select("*")
          .eq("coach_id", user.id)
          .in("athlete_id", athleteIds)
          .order("next_due_date", { ascending: true, nullsFirst: false });
        if (schedulesError) throw schedulesError;
        state.schedules = schedules || [];
      }

      await loadOrganisationData(user, athleteIds);

      const selectionChanged = rebuildRoster();
      rebuildWorkoutFuelData();
      rebuildOperationalData();
      state.coachLoading = false;
      setStatus(`Loaded ${state.roster.length} active athlete${state.roster.length === 1 ? "" : "s"}.`);
      render();
      platformController?.publishData(reason);
      if (selectionChanged && state.selectedAthleteId) platformController?.athleteSelected(state.selectedAthleteId);
    } catch (error) {
      state.coachLoading = false;
      throw error;
    }
  }

  async function withBusy(button, callback) {
    if (state.busy) return;
    state.busy = true;
    const originalText = button?.textContent || "";
    if (button) button.disabled = true;
    if (button?.id === "coachSignInButton") button.textContent = "Signing in...";
    if (button?.id === "coachSignUpButton") button.textContent = "Sending...";
    if (button?.id === "coachForgotPasswordButton") button.textContent = "Sending...";
    if (button?.id === "coachFindAthleteButton") button.textContent = "Finding...";
    if (button?.dataset?.sendCodeRequest !== undefined) button.textContent = "Sending...";
    try {
      await callback();
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
      if (button && originalText) button.textContent = originalText;
    }
  }

  async function signIn() {
    await withBusy($("coachSignInButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      const password = $("coachPassword")?.value || "";
      if (!email || !password) throw new Error("Enter an email and password.");
      setStatus("Signing in...");
      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (!data?.session?.access_token || !data?.user?.id) throw new Error("Supabase signed in, but no session was created.");
      state.session = data.session;
      state.authResolved = true;
      state.coachLoading = true;
      renderAuth();
      await loadCoachData({ reason: "sign-in" });
    });
  }

  async function signUp() {
    await withBusy($("coachSignUpButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      const password = $("coachPassword")?.value || "";
      if (!email || !password) throw new Error("Enter an email and password.");
      setStatus("Sending coach invitation...");
      rememberCoachSignup(email);
      const { data, error } = await state.client.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/coach/`,
          data: { fuel_guard_coach_signup: true }
        }
      });
      if (error) throw error;
      state.session = data.session || state.session;
      setStatus(data.session ? "Coach account created." : "Coach invitation sent. Check your inbox.");
      if (data.session) {
        state.authResolved = true;
        state.coachLoading = true;
        renderAuth();
        await loadCoachData({ enableCoach: true, reason: "coach-sign-up" });
      }
    });
  }

  async function forgotPassword() {
    await withBusy($("coachForgotPasswordButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      if (!email) throw new Error("Enter your email before requesting a password reset.");
      const { error } = await state.client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/coach/`
      });
      if (error) throw error;
      setStatus("Password reset email sent. Check your inbox before requesting another one.");
    });
  }

  async function signOut() {
    await state.client?.auth.signOut();
    state.session = null;
    state.profile = null;
    state.pointsProfile = null;
    state.authResolved = true;
    state.coachLoading = false;
    state.coachAccessBlocked = false;
    state.relationships = [];
    state.athleteProfiles = [];
    state.logs = [];
    state.targets = [];
    state.reports = [];
    state.interventions = [];
    state.attentionActions = [];
    state.notes = [];
    state.nudges = [];
    state.dataHealthRows = [];
    state.garminActivities = [];
    state.trainingModeSessions = [];
    state.demandBlocks = [];
    state.workoutFuelContexts = [];
    state.workoutFuelSummaries = [];
    state.teamDataHealth = { items: [], summary: {} };
    state.attentionItems = [];
    state.attentionComposer = null;
    state.pendingInterventionAttention = null;
    state.interventionReview = null;
    state.roster = [];
    resetOrganisationData();
    state.athleteCodeQuery = "";
    state.athleteCodeResult = null;
    state.athleteCodeStatus = "";
    platformController?.reset();
    setStatus("Signed out.");
    render();
  }

  async function saveProfile() {
    await withBusy($("coachSaveProfileButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const firstName = $("coachFirstName")?.value?.trim() || "";
      const lastName = $("coachLastName")?.value?.trim() || "";
      const displayName = $("coachDisplayName")?.value?.trim() || [firstName, lastName].filter(Boolean).join(" ") || user.email || "Coach";
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .upsert({
          user_id: user.id,
          role: state.profile?.role || "athlete",
          coach_enabled: isCoachEnabled(),
          display_name: displayName,
          first_name: firstName || null,
          last_name: lastName || null,
          avatar_url: $("coachAvatarUrl")?.value?.trim() || null,
          job_title: $("coachJobTitle")?.value?.trim() || null,
          updated_at: new Date().toISOString()
        }, { onConflict: "user_id" })
        .select(profileSelect())
        .single();
      if (error) throw error;
      state.profile = data;
      setStatus("Coach profile saved.");
      renderSettings();
      platformController?.publishData("profile-saved");
    });
  }

  async function createOrganisation(button) {
    await withBusy(button, async () => {
      const user = coachUser();
      const name = $("coachNewOrganisationName")?.value?.trim() || "";
      if (!user || !name) throw new Error("Enter an organisation name.");
      const { error } = await state.client.from(TABLES.organisations).insert({ name, created_by: user.id });
      if (error) throw error;
      setStatus("Organisation created. You are its owner.");
      await loadCoachData({ reason: "organisation-created" });
    });
  }

  async function createTeam(button) {
    await withBusy(button, async () => {
      const user = coachUser();
      const organisationId = $("coachNewTeamOrganisation")?.value || "";
      const name = $("coachNewTeamName")?.value?.trim() || "";
      const timeZone = $("coachNewTeamTimezone")?.value?.trim() || state.timeZone;
      if (!user || !organisationId) throw new Error("Choose a team organisation.");
      if (!name) throw new Error("Enter a team name.");
      try {
        new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
      } catch (_error) {
        throw new Error("Choose a valid IANA team timezone.");
      }
      const { error } = await state.client.from(TABLES.teams).insert({
        organisation_id: organisationId,
        name,
        timezone_name: timeZone,
        created_by: user.id
      });
      if (error) throw error;
      setStatus("Team created. Add only actively shared athletes to its roster.");
      await loadCoachData({ reason: "team-created" });
    });
  }

  async function toggleTeamAthlete(input) {
    await withBusy(input, async () => {
      const user = coachUser();
      const teamId = input.dataset.teamAthleteTeam || "";
      const athleteId = input.dataset.teamAthleteId || "";
      const team = state.teams.find(item => String(item.id) === String(teamId));
      const existing = state.teamAthletes.find(item => String(item.team_id) === String(teamId) && String(item.athlete_id) === String(athleteId));
      if (!user || !team || !athleteRows().some(athlete => String(athlete.userId) === String(athleteId))) throw new Error("Choose an actively shared athlete.");
      const now = new Date().toISOString();
      if (existing) {
        const patch = input.checked
          ? { status: "active", joined_at: now, revoked_at: null }
          : { status: "revoked", revoked_at: now };
        const { error } = await state.client.from(TABLES.teamAthletes).update(patch).eq("id", existing.id);
        if (error) throw error;
      } else {
        if (!input.checked) return;
        const { error } = await state.client.from(TABLES.teamAthletes).insert({
          organisation_id: team.organisation_id,
          team_id: team.id,
          athlete_id: athleteId,
          status: "active",
          added_by: user.id,
          joined_at: now
        });
        if (error) throw error;
      }
      setStatus(input.checked ? "Athlete added to team." : "Athlete removed from team context.");
      await loadCoachData({ reason: "team-roster-updated" });
    });
  }

  async function createSavedGroup(button) {
    await withBusy(button, async () => {
      const user = coachUser();
      const name = $("coachNewGroupName")?.value?.trim() || "";
      if (!user || !name) throw new Error("Enter a group name.");
      const { error } = await state.client.from(TABLES.savedGroups).insert({
        scope: "personal",
        coach_id: user.id,
        name,
        created_by: user.id
      });
      if (error) throw error;
      setStatus("Saved group created.");
      await loadCoachData({ reason: "saved-group-created" });
    });
  }

  async function renameSavedGroup(groupId, button) {
    await withBusy(button, async () => {
      const name = document.querySelector(`[data-group-name-input="${CSS.escape(groupId)}"]`)?.value?.trim() || "";
      if (!name) throw new Error("Enter a group name.");
      const { error } = await state.client.from(TABLES.savedGroups).update({ name }).eq("id", groupId);
      if (error) throw error;
      setStatus("Saved group renamed.");
      await loadCoachData({ reason: "saved-group-renamed" });
    });
  }

  async function deleteSavedGroup(groupId, button) {
    if (!window.confirm("Delete this saved group? Athlete sharing and logs will not be changed.")) return;
    await withBusy(button, async () => {
      const { error } = await state.client.from(TABLES.savedGroups).delete().eq("id", groupId);
      if (error) throw error;
      if (String(state.selectedGroupId) === String(groupId)) state.selectedGroupId = "";
      setStatus("Saved group deleted. Athlete access was unchanged.");
      await loadCoachData({ reason: "saved-group-deleted" });
    });
  }

  async function toggleSavedGroupMember(input) {
    await withBusy(input, async () => {
      const user = coachUser();
      const groupId = input.dataset.groupMemberGroup || "";
      const athleteId = input.dataset.groupMemberAthlete || "";
      if (!user || !state.savedGroups.some(group => String(group.id) === String(groupId)) || !athleteRows().some(athlete => String(athlete.userId) === String(athleteId))) throw new Error("Choose an actively shared athlete.");
      if (input.checked) {
        const { error } = await state.client.from(TABLES.savedGroupMembers).insert({ group_id: groupId, athlete_id: athleteId, added_by: user.id });
        if (error) throw error;
      } else {
        const { error } = await state.client.from(TABLES.savedGroupMembers).delete().eq("group_id", groupId).eq("athlete_id", athleteId);
        if (error) throw error;
      }
      setStatus(input.checked ? "Athlete added to saved group." : "Athlete removed from saved group.");
      await loadCoachData({ reason: "saved-group-membership-updated" });
    });
  }

  async function createStaffNote(athleteId, button) {
    await withBusy(button, async () => {
      const user = coachUser();
      const teamId = $("coachStaffNoteTeam")?.value || "";
      const team = state.teams.find(item => String(item.id) === String(teamId));
      const noteText = $("coachStaffNoteText")?.value?.trim() || "";
      if (!user || !team || !noteText) throw new Error("Enter a shared staff note.");
      if (!canContributeToTeam(teamId) || !activeTeamAthletes(teamId).some(member => String(member.athlete_id) === String(athleteId))) throw new Error("Shared note access is no longer available for this athlete.");
      const { error } = await state.client.from(TABLES.staffNotes).insert({
        organisation_id: team.organisation_id,
        team_id: team.id,
        athlete_id: athleteId,
        author_id: user.id,
        category: $("coachStaffNoteCategory")?.value || "general",
        note_text: noteText
      });
      if (error) throw error;
      setStatus("Shared staff note saved with author and team context.");
      await loadCoachData({ reason: "staff-note-created" });
    });
  }

  function trainingDateTime(value, timeZone) {
    const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
    if (!match) return null;
    try {
      new Intl.DateTimeFormat("en-GB", { timeZone }).format(new Date());
    } catch (_error) {
      return null;
    }
    const date = domain.zonedDateTimeToUtc(match[1], timeZone, Number(match[2]), Number(match[3]));
    const parts = domain.zonedDateParts(date, timeZone);
    if (!date || !parts || domain.dateKeyInTimeZone(date, timeZone) !== match[1] || parts.hour !== Number(match[2]) || parts.minute !== Number(match[3])) {
      throw new Error("That local time does not exist in the selected timezone.");
    }
    return date;
  }

  async function createTrainingSession(button) {
    await withBusy(button, async () => {
      const teamId = $("coachTrainingTeam")?.value || "";
      const team = state.teams.find(item => String(item.id) === String(teamId));
      const timeZone = $("coachTrainingTimezone")?.value?.trim() || team?.timezone_name || state.timeZone;
      const startsAt = trainingDateTime($("coachTrainingStarts")?.value, timeZone);
      const endsAt = trainingDateTime($("coachTrainingEnds")?.value, timeZone);
      if (!coachUser() || !team) throw new Error("Choose a team for this session.");
      if (!startsAt || !endsAt || endsAt <= startsAt || endsAt - startsAt > 86400000) throw new Error("Choose a valid session start and end within 24 hours.");
      const editingId = state.editingTrainingSessionId || null;
      const { data: sessionId, error } = await state.client.rpc("fuel_save_team_session", {
        p_session_id: editingId,
        p_team_id: team.id,
        p_starts_at: startsAt.toISOString(),
        p_ends_at: endsAt.toISOString(),
        p_timezone_name: timeZone,
        p_session_type: $("coachTrainingType")?.value || "training",
        p_session_name: $("coachTrainingName")?.value?.trim() || "",
        p_location: $("coachTrainingLocation")?.value?.trim() || "",
        p_coach_note: $("coachTrainingNote")?.value?.trim() || ""
      });
      if (error) throw error;
      state.editingTrainingSessionId = "";
      state.selectedTrainingSessionId = sessionId || editingId || "";
      setStatus(editingId ? "Team session updated." : "Team session created for the active roster without duplicate athlete assignments.");
      await loadCoachData({ reason: editingId ? "team-session-updated" : "team-session-created" });
    });
  }

  async function cancelTrainingSession(sessionId, button) {
    if (!window.confirm("Cancel this session? Athletes will retain the cancelled schedule context.")) return;
    await withBusy(button, async () => {
      const { data: changed, error } = await state.client.rpc("fuel_cancel_team_session", { p_session_id: sessionId });
      if (error) throw error;
      if (!changed) throw new Error("This scheduled session is no longer available to cancel.");
      state.editingTrainingSessionId = "";
      setStatus("Team session cancelled. Historical context was preserved.");
      await loadCoachData({ reason: "team-session-cancelled" });
    });
  }

  async function deleteTrainingSession(sessionId, button) {
    if (!window.confirm("Delete this future session permanently? Use Cancel if its history should remain visible.")) return;
    await withBusy(button, async () => {
      const { error, count } = await state.client.from(TABLES.trainingSessions).delete({ count: "exact" }).eq("id", sessionId);
      if (error) throw error;
      if (!count) throw new Error("Only an authorised future session can be deleted.");
      if (String(state.selectedTrainingSessionId) === String(sessionId)) state.selectedTrainingSessionId = "";
      if (String(state.editingTrainingSessionId) === String(sessionId)) state.editingTrainingSessionId = "";
      setStatus("Future team session deleted.");
      await loadCoachData({ reason: "team-session-deleted" });
    });
  }

  async function findAthleteByCode() {
    await withBusy($("coachFindAthleteButton"), async () => {
      const code = normalizeAthleteCode($("coachAthleteCodeInput")?.value || state.athleteCodeQuery);
      state.athleteCodeQuery = code;
      state.athleteCodeResult = null;
      state.athleteCodeStatus = "";
      state.athleteCodeStatusDetail = "";
      if (!ATHLETE_CODE_RE.test(code)) {
        state.athleteCodeStatus = "Enter an Athlete Code like FG-7K42P.";
        renderAthleteCodeResult();
        return;
      }
      const { data, error } = await state.client.rpc("fuel_coach_find_athlete_by_code", {
        search_code: code
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result?.athlete_id) {
        state.athleteCodeStatus = "Athlete code not found";
        state.athleteCodeStatusDetail = "Check the code and try again.";
        renderAthleteCodeResult();
        return;
      }
      if (result.relationship_status === "self" || result.athlete_id === coachUser()?.id) {
        state.athleteCodeStatus = "This is your Athlete Code";
        state.athleteCodeStatusDetail = "You can't add your own athlete account as a coached athlete.";
        renderAthleteCodeResult();
        return;
      }
      state.athleteCodeResult = result;
      state.athleteCodeStatus = result.relationship_status === "active"
        ? "This athlete is already connected."
        : result.relationship_status === "pending"
          ? "A connection request is already waiting for athlete approval."
          : result.relationship_status === "declined"
            ? "The previous request was declined. You can send a new request if the athlete asked you to."
            : "Athlete found. Send a connection request when you are ready.";
      renderAthleteCodeResult();
    });
  }

  async function requestSharing(button = document.querySelector("[data-send-code-request]")) {
    await withBusy(button, async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const result = state.athleteCodeResult;
      const athleteId = String(result?.athlete_id || "");
      if (!athleteId) throw new Error("Find an athlete by Athlete Code before requesting access.");
      if (athleteId === user.id || result?.relationship_status === "self") {
        throw new Error("You can't add your own athlete account as a coached athlete.");
      }
      const mutableRelationship = {
        status: "pending",
        athlete_label: result?.display_name || null,
        coach_label: state.profile?.display_name || user.email || "Fuel Guard Coach",
        accepted_at: null,
        revoked_at: null,
        updated_at: new Date().toISOString()
      };
      const existingResult = await state.client
        .from(TABLES.relationships)
        .select("id,status")
        .eq("coach_id", user.id)
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (existingResult.error) throw existingResult.error;
      const write = existingResult.data
        ? state.client.from(TABLES.relationships).update(mutableRelationship).eq("id", existingResult.data.id)
        : state.client.from(TABLES.relationships).insert({
          coach_id: user.id,
          athlete_id: athleteId,
          ...mutableRelationship
        });
      const { data: savedRelationship, error } = await write.select("id").single();
      if (error) throw error;
      state.athleteCodeResult = { ...result, relationship_status: "pending" };
      try {
        await window.FuelGuardTransactionalEmail.sendInvitation({
          accessToken: state.session?.access_token,
          kind: "coach_athlete",
          entityId: savedRelationship.id
        });
        state.athleteCodeStatus = "Connection request sent and email delivered. Athlete data stays private until they approve.";
        state.athleteCodeStatusDetail = "";
      } catch (emailError) {
        console.error("Coach connection email delivery failed", { relationshipId: savedRelationship.id, error: String(emailError?.message || emailError) });
        state.athleteCodeStatus = "Connection request saved. Athlete data stays private until they approve.";
        state.athleteCodeStatusDetail = "The email could not be delivered, but the request remains available in Fuel Guard.";
      }
      setStatus(state.athleteCodeStatus);
      await loadCoachData({ reason: "sharing-requested" });
      renderAthleteCodeResult();
    });
  }

  async function revokeRelationship(id) {
    await withBusy(null, async () => {
      const { error } = await state.client
        .from(TABLES.relationships)
        .update({ status: "revoked", revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      setStatus("Relationship removed.");
      await loadCoachData({ reason: "relationship-revoked" });
    });
  }

  function attentionItemForKey(occurrenceKey) {
    return state.attentionItems.find(item => item.occurrenceKey === occurrenceKey) || null;
  }

  async function saveAttentionDisposition(item, status) {
    const user = coachUser();
    if (!user || !item || !["reviewed", "dismissed"].includes(status)) throw new Error("Attention action unavailable.");
    const now = new Date().toISOString();
    const { data, error } = await state.client
      .from(TABLES.attentionActions)
      .upsert({
        coach_id: user.id,
        athlete_id: item.athleteId,
        item_type: item.type,
        occurrence_key: item.occurrenceKey,
        status,
        acted_at: now,
        updated_at: now
      }, { onConflict: "coach_id,athlete_id,occurrence_key" })
      .select("*")
      .single();
    if (error) throw error;
    if (data) state.attentionActions = [data, ...state.attentionActions.filter(row => row.id !== data.id && row.occurrence_key !== data.occurrence_key)];
    state.attentionComposer = null;
    rebuildOperationalData();
  }

  async function updateAttentionStatus(button) {
    await withBusy(button, async () => {
      const item = attentionItemForKey(button?.dataset?.occurrenceKey || "");
      if (!item) throw new Error("This attention item has changed. Refresh the inbox.");
      const status = button.dataset.attentionStatus;
      await saveAttentionDisposition(item, status);
      setStatus(status === "reviewed" ? "Attention item reviewed." : "Attention item dismissed.");
      renderNeedsAttention();
    });
  }

  function openAttentionComposer(kind, occurrenceKey) {
    const item = attentionItemForKey(occurrenceKey);
    if (!item) return;
    state.attentionComposer = { kind, occurrenceKey };
    renderNeedsAttention();
    setTimeout(() => $("coachAttentionComposerText")?.focus(), 0);
  }

  async function submitAttentionComposer(button) {
    await withBusy(button, async () => {
      const composer = state.attentionComposer;
      const item = attentionItemForKey(composer?.occurrenceKey || "");
      const user = coachUser();
      const text = $("coachAttentionComposerText")?.value?.trim() || "";
      if (!composer || !item || !user) throw new Error("This attention action is no longer available.");
      if (!text) throw new Error(composer.kind === "nudge" ? "Enter a nudge message." : "Enter a note.");
      if (composer.kind === "nudge") {
        const { data, error } = await state.client
          .from(TABLES.nudges)
          .insert({
            coach_id: user.id,
            athlete_id: item.athleteId,
            attention_occurrence_key: item.occurrenceKey,
            message: text,
            sent_at: new Date().toISOString()
          })
          .select("*")
          .single();
        if (error) throw error;
        if (data) state.nudges = [data, ...state.nudges];
        await saveAttentionDisposition(item, "reviewed");
        setStatus(`Nudge sent to ${item.athlete?.displayName || "athlete"}.`);
      } else {
        const { data, error } = await state.client
          .from(TABLES.notes)
          .insert({
            coach_id: user.id,
            athlete_id: item.athleteId,
            attention_occurrence_key: item.occurrenceKey,
            body: text
          })
          .select("*")
          .single();
        if (error) throw error;
        if (data) state.notes = [data, ...state.notes];
        await saveAttentionDisposition(item, "reviewed");
        setStatus("Coach note saved and item reviewed.");
      }
      render();
    });
  }

  function defaultReviewDate(interventionDate = domain.dateKey(new Date()), days = 28) {
    const date = domain.startOfLocalDay(interventionDate);
    date.setDate(date.getDate() + days);
    return domain.dateKey(date);
  }

  function openAttentionIntervention(occurrenceKey) {
    const item = attentionItemForKey(occurrenceKey);
    if (!item) return;
    state.pendingInterventionAttention = item;
    openInterventionBuilder(item.athleteId);
    if ($("coachInterventionObservation")) $("coachInterventionObservation").value = item.detail;
    if ($("coachInterventionAction")) $("coachInterventionAction").value = nextActionText(state.roster.find(row => row.athlete.userId === item.athleteId));
    if ($("coachInterventionReviewDate")) $("coachInterventionReviewDate").value = defaultReviewDate();
  }

  async function openInterventionReview(interventionId, button = null) {
    await withBusy(button, async () => {
      const intervention = state.interventions.find(row => row.id === interventionId);
      if (!intervention) throw new Error("Intervention not found.");
      const start = domain.startOfLocalDay(intervention.intervention_date);
      start.setDate(start.getDate() - Number(intervention.review_window_days || 28));
      const end = domain.startOfLocalDay(intervention.intervention_date);
      end.setDate(end.getDate() + Number(intervention.review_window_days || 28) - 1);
      const logs = await fetchAthleteLogs(intervention.athlete_id, start, end);
      const comparison = domain.interventionComparison({
        intervention,
        logs,
        targets: targetForAthlete(intervention.athlete_id)
      });
      state.interventionReview = { intervention, comparison };
      state.selectedReportAthleteId = intervention.athlete_id;
      state.currentTab = "reports";
      render();
      $("coachInterventionReview")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function completeInterventionReview(status, button = null) {
    await withBusy(button, async () => {
      const review = state.interventionReview;
      if (!review || !["reviewed", "closed"].includes(status)) throw new Error("Open an intervention review first.");
      const now = new Date().toISOString();
      const patch = {
        status,
        review_notes: $("coachInterventionReviewNotes")?.value?.trim() || null,
        review_snapshot: review.comparison,
        updated_at: now
      };
      if (status === "reviewed") patch.reviewed_at = now;
      if (status === "closed") patch.closed_at = now;
      const { data, error } = await state.client
        .from(TABLES.interventions)
        .update(patch)
        .eq("id", review.intervention.id)
        .select("*")
        .single();
      if (error) throw error;
      const attention = state.attentionItems.find(item => item.interventionId === review.intervention.id);
      if (attention) await saveAttentionDisposition(attention, "reviewed");
      if (data) state.interventions = [data, ...state.interventions.filter(row => row.id !== data.id)];
      state.interventionReview = null;
      setStatus(status === "reviewed" ? "Intervention review saved." : "Intervention closed.");
      await loadCoachData();
    });
  }

  function targetForAthlete(athleteId) {
    return targetsByUser()[athleteId] || {};
  }

  async function fetchAthleteLogs(athleteId, start, end) {
    const period = domain.periodFromKeys(
      typeof start === "string" ? start : domain.dateKeyInTimeZone(start, state.timeZone),
      typeof end === "string" ? end : domain.dateKeyInTimeZone(end, state.timeZone),
      "fetch",
      state.timeZone
    );
    const bounds = domain.periodQueryBounds(period, state.timeZone);
    const { data, error } = await state.client
      .from(TABLES.logs)
      .select("id,user_id,logged_at,type,source,external_event_id,day_type,training_session,notes,created_at")
      .eq("user_id", athleteId)
      .gte("logged_at", bounds.start.toISOString())
      .lt("logged_at", bounds.endExclusive.toISOString())
      .order("logged_at", { ascending: true });
    if (error) throw error;
    return (data || []).map(domain.normalizeLog).filter(Boolean);
  }

  async function assembleReportDraft(period) {
    const user = coachUser();
    if (!user) throw new Error("Sign in first.");
    const item = selectedReportAthlete();
    if (!item) throw new Error("Select an assigned athlete first.");
    const reportPeriod = period || reportPeriodFromControls();
    const previous = domain.previousPeriodRange(reportPeriod);
    const currentLogs = await fetchAthleteLogs(item.athlete.userId, reportPeriod.startKey, reportPeriod.endKey);
    const previousLogs = await fetchAthleteLogs(item.athlete.userId, previous.startKey, previous.endKey);
    const interventions = recordsForAthlete(state.interventions, item);
    const reportBuilder = reportPeriod.preset === "week" ? domain.buildWeeklyCoachReview : domain.buildAthleteReviewReport;
    const report = reportBuilder({
      athlete: item.athlete,
      coach: { ...state.profile, email: user.email, id: user.id },
      organisationName: $("coachOrganisationName")?.value?.trim() || "",
      logs: currentLogs,
      previousLogs,
      targets: targetForAthlete(item.athlete.userId),
      period: reportPeriod,
      interventions,
      coachNotes: $("coachReportNotes")?.value || "",
      generatedAt: new Date(),
      timeZone: state.timeZone,
      workoutSummary: workoutFuelSummaryForAthlete(item.athlete.userId)
    });
    report.sourceLogs = currentLogs.concat(previousLogs);
    state.generatedReport = report;
    state.reportSaved = false;
    state.savedWeeklyReportId = "";
    setStatus("Review assembled. Interpret the evidence, add factual notes, then save.");
    renderReportPreview();
    renderScheduleDraftContext();
    return report;
  }

  async function generateReport() {
    await withBusy($("coachGenerateReviewButton"), async () => {
      state.selectedScheduleId = "";
      await assembleReportDraft(reportPeriodFromControls());
    });
  }

  async function saveReport() {
    await withBusy($("coachSaveReviewButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const item = selectedReportAthlete();
      if (!item || !state.generatedReport) throw new Error("Assemble a review before saving.");
      const report = {
        ...state.generatedReport,
        coachNotes: $("coachReportNotes")?.value?.trim() || "",
        organisationName: $("coachOrganisationName")?.value?.trim() || state.generatedReport.organisationName || ""
      };
      state.generatedReport = report;
      const now = new Date().toISOString();
      let data;
      let error;
      if (report.reviewKind === "weekly") {
        const organisationId = state.organisations.length === 1 ? state.organisations[0].id : null;
        const result = await state.client.rpc("fuel_save_weekly_review", {
          p_athlete_id: item.athlete.userId,
          p_week_start: report.period.startKey,
          p_summary: report.executiveSummary.join(" "),
          p_coach_note: report.coachNotes || null,
          p_metrics: reportPayload(report),
          p_organisation_id: organisationId
        });
        data = result.data;
        error = result.error;
      } else {
        const result = await state.client
          .from(TABLES.reports)
          .insert({
            coach_id: user.id,
            athlete_id: item.athlete.userId,
            report_date: domain.dateKeyInTimeZone(new Date(), state.timeZone),
            period_start: report.period.startKey,
            period_end: report.period.endKey,
            period_type: report.period.preset,
            title: report.title,
            summary: report.executiveSummary.join(" "),
            coach_notes: report.coachNotes || null,
            organisation_name: report.organisationName || null,
            metrics: reportPayload(report),
            previous_metrics: {
              period: report.previousPeriod,
              comparison: report.comparison
            },
            created_at: now,
            updated_at: now
          })
          .select("*")
          .single();
        data = result.data;
        error = result.error;
      }
      if (error) throw error;
      if (data) state.reports = [data, ...state.reports.filter(row => row.id !== data.id)];

      if (report.reviewKind === "weekly") {
        state.savedWeeklyReportId = data?.id || "";
        state.reportSaved = true;
        setStatus("Weekly review draft saved. Check the evidence and mark it complete when the coach conversation is recorded.");
        renderScheduleDraftContext();
        renderWeeklyReviewHistory();
        return;
      }

      const schedule = state.schedules.find(row => row.id === state.selectedScheduleId) || null;
      if (schedule) {
        const updates = domain.completeScheduledReview(schedule, {
          completedOn: new Date(),
          timeZone: state.timeZone,
          reportId: data?.id || null
        });
        const { data: updatedSchedule, error: scheduleError } = await state.client
          .from(TABLES.schedules)
          .update(updates)
          .eq("id", schedule.id)
          .eq("coach_id", user.id)
          .select("*")
          .single();
        if (scheduleError) throw scheduleError;
        if (updatedSchedule) state.schedules = state.schedules.map(row => row.id === updatedSchedule.id ? updatedSchedule : row);
        setStatus(updates.next_due_date ? `Review saved. Next review due ${updates.next_due_date}.` : "Review saved and one-off schedule completed.");
      } else {
        setStatus("Athlete review report saved.");
      }
      state.reportSaved = true;
      state.selectedScheduleId = "";
      renderScheduleDraftContext();
      renderScheduledReviews();
      renderDueReviews();
      renderReportPreview();
      await loadCoachData({ reason: "report-created" });
    });
  }

  async function completeWeeklyReview() {
    await withBusy($("coachCompleteReviewButton"), async () => {
      if (!state.savedWeeklyReportId) throw new Error("Save the weekly review draft first.");
      const athleteFeedback = $("coachReviewAthleteFeedback")?.value?.trim() || null;
      const { data, error } = await state.client.rpc("fuel_complete_weekly_review_with_feedback", {
        p_report_id: state.savedWeeklyReportId,
        p_completion_note: $("coachReviewCompletionNote")?.value?.trim() || null,
        p_athlete_feedback: athleteFeedback
      });
      if (error) throw error;
      state.pointsProfile = data?.points || state.pointsProfile;
      state.savedWeeklyReportId = "";
      state.reportSaved = true;
      if ($("coachReviewCompletionNote")) $("coachReviewCompletionNote").value = "";
      if ($("coachReviewAthleteFeedback")) $("coachReviewAthleteFeedback").value = "";
      setStatus(`Weekly review completed${athleteFeedback ? " and athlete-visible feedback shared" : ""}. Current coach points: ${Number(state.pointsProfile?.coachPoints || 0).toLocaleString("en-GB")}.`);
      await loadCoachData({ reason: "weekly-review-completed" });
    });
  }

  async function createReviewSchedule() {
    await withBusy($("coachCreateScheduleButton"), async () => {
      const user = coachUser();
      const athleteId = $("coachScheduleAthlete")?.value || "";
      const type = $("coachScheduleType")?.value || "custom";
      const dueDate = domain.validDateKey($("coachScheduleDueDate")?.value);
      const reportPeriodType = $("coachSchedulePeriod")?.value || domain.reviewScheduleDefinition(type).reportPeriod;
      const cadence = $("coachScheduleCadence")?.value || domain.reviewScheduleDefinition(type).cadence;
      const cadenceDays = cadence === "custom_days" ? Number($("coachScheduleCadenceDays")?.value) : null;
      const reportPeriodStart = reportPeriodType === "custom" ? domain.validDateKey($("coachSchedulePeriodStart")?.value) : "";
      const reportPeriodEnd = reportPeriodType === "custom" ? domain.validDateKey($("coachSchedulePeriodEnd")?.value) : "";
      if (!user || !athleteId) throw new Error("Select an assigned athlete first.");
      if (!dueDate) throw new Error("Choose a valid next due date.");
      if (cadence === "custom_days" && (!Number.isInteger(cadenceDays) || cadenceDays < 1 || cadenceDays > 3650)) throw new Error("Custom cadence must be between 1 and 3650 days.");
      if (reportPeriodType === "custom" && (!reportPeriodStart || !reportPeriodEnd || reportPeriodStart > reportPeriodEnd)) throw new Error("Choose a valid custom report period.");
      const now = new Date().toISOString();
      const { data, error } = await state.client
        .from(TABLES.schedules)
        .insert({
          coach_id: user.id,
          athlete_id: athleteId,
          review_type: type,
          report_period_type: reportPeriodType,
          report_period_start: reportPeriodStart || null,
          report_period_end: reportPeriodEnd || null,
          cadence,
          cadence_days: cadenceDays,
          due_date: dueDate,
          next_due_date: dueDate,
          status: "active",
          coach_notes: $("coachScheduleNotes")?.value?.trim() || null,
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single();
      if (error) throw error;
      if (data) state.schedules = [...state.schedules.filter(row => row.id !== data.id), data];
      setStatus("Review scheduled. Due state will update automatically when Coach Beta loads.");
      if ($("coachScheduleNotes")) $("coachScheduleNotes").value = "";
      renderScheduledReviews();
      renderDueReviews();
    });
  }

  async function openScheduledReview(scheduleId, button) {
    await withBusy(button, async () => {
      const schedule = state.schedules.find(row => row.id === scheduleId);
      const item = scheduleAthlete(schedule);
      if (!schedule || !item) throw new Error("This scheduled review is no longer available for an active shared athlete.");
      const period = domain.reportPeriodForSchedule(schedule, { timeZone: state.timeZone });
      state.selectedScheduleId = schedule.id;
      state.selectedReportAthleteId = item.athlete.userId;
      state.selectedAthleteId = item.athlete.userId;
      state.reportPeriod = period.preset;
      state.generatedReport = null;
      state.reportSaved = false;
      state.savedWeeklyReportId = "";
      state.currentTab = "reports";
      render();
      if ($("coachReportAthlete")) $("coachReportAthlete").value = item.athlete.userId;
      if ($("coachReportPeriod")) $("coachReportPeriod").value = period.preset;
      if ($("coachReportStart")) $("coachReportStart").value = period.startKey;
      if ($("coachReportEnd")) $("coachReportEnd").value = period.endKey;
      if ($("coachReportNotes")) $("coachReportNotes").value = schedule.coach_notes || "";
      await assembleReportDraft(period);
      $("coachScheduleDraftContext")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function createIntervention() {
    await withBusy(null, async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const item = selectedReportAthlete();
      if (!item) throw new Error("Select an assigned athlete first.");
      const now = new Date().toISOString();
      const observation = $("coachInterventionObservation")?.value?.trim() || nextActionText(item);
      const action = $("coachInterventionAction")?.value?.trim() || "Agree one practical support step and review the next logging pattern.";
      const interventionDate = $("coachInterventionDate")?.value || domain.dateKey(new Date());
      const sourceAttention = state.pendingInterventionAttention;
      const { data, error } = await state.client
        .from(TABLES.interventions)
        .insert({
          coach_id: user.id,
          athlete_id: item.athlete.userId,
          status: "active",
          category: $("coachInterventionCategory")?.value || "fuelling_routine",
          observation,
          action_text: action,
          target_window: item.beyondFuelGapMinutes !== null ? "current gap" : "next support window",
          intervention_date: interventionDate,
          review_date: $("coachInterventionReviewDate")?.value || defaultReviewDate(interventionDate),
          review_window_days: 28,
          source_attention_occurrence_key: sourceAttention?.occurrenceKey || null,
          notes: sourceAttention ? "Created from the daily Needs Attention inbox." : "Created from Coach Beta athlete review.",
          created_at: now,
          updated_at: now
        })
        .select("*")
        .single();
      if (error) throw error;
      if (data) state.interventions = [data, ...state.interventions.filter(row => row.id !== data.id)];
      if (sourceAttention) await saveAttentionDisposition(sourceAttention, "reviewed");
      state.pendingInterventionAttention = null;
      setStatus("Intervention created.");
      if ($("coachInterventionObservation")) $("coachInterventionObservation").value = "";
      if ($("coachInterventionAction")) $("coachInterventionAction").value = "";
      await loadCoachData({ reason: "intervention-created" });
    });
  }

  function openReportBuilder(athleteId) {
    state.selectedReportAthleteId = athleteId || state.selectedReportAthleteId;
    state.selectedScheduleId = "";
    state.reportPeriod = "week";
    state.generatedReport = null;
    state.reportSaved = false;
    state.currentTab = "reports";
    render();
    const period = domain.weeklyReportingPeriod({ now: new Date(), timeZone: state.timeZone });
    if ($("coachReportStart")) $("coachReportStart").value = period.startKey;
    if ($("coachReportEnd")) $("coachReportEnd").value = period.endKey;
    $("coachReportNotes")?.focus();
  }

  function openInterventionBuilder(athleteId) {
    state.selectedReportAthleteId = athleteId || state.selectedReportAthleteId;
    state.currentTab = "reports";
    render();
    $("coachInterventionObservation")?.focus();
  }

  function reportCsv(report) {
    const rows = [
      ["section", "metric", "value", "detail"],
      ["header", "athlete", report.athleteName, report.period.display],
      ["header", "coach", report.coachName, report.organisationName || ""],
      ["coverage", "total_days", report.coverage.totalDays, ""],
      ["coverage", "logged_days", report.coverage.loggedDays, ""],
      ["coverage", "coverage_percent", report.coverage.loggedPct, ""],
      ["coverage", "gap_metric_days", report.coverage.metricDays, ""],
      ["consistency", "fuel_logs_per_active_day", round1(report.consistency.avgFuelLogsPerActiveDay), ""],
      ["consistency", "hydration_logs_per_active_day", round1(report.consistency.avgHydrationLogsPerActiveDay), ""],
      ["consistency", "days_within_gap_target_percent", report.consistency.targetAdherencePct, ""],
      ["fuelling", "average_first_fuel", timeFromMinutes(report.fuelling.averageFirstFuelMinutes), ""],
      ["fuelling", "average_final_fuel", timeFromMinutes(report.fuelling.averageFinalFuelMinutes), ""],
      ["fuelling", "average_gap_minutes", round1(report.fuelling.averageGapMinutes), ""],
      ["fuelling", "longest_gap_minutes", round1(report.fuelling.longestGapMinutes), ""],
      ["fuelling", "most_common_gap_window", report.fuelling.commonGapWindow?.label || "", ""],
      ["fuelling", "most_common_fuelling_window", report.fuelling.commonFuellingWindow?.label || "", ""],
      ["sleepy", "sleepy_events", report.sleepy.total, ""],
      ["sleepy", "sleepy_events_per_active_week", round1(report.sleepy.averagePerActiveWeek), ""],
      ["sleepy", "most_common_sleepy_window", report.sleepy.commonWindow?.label || "", ""],
      ["sleepy", "sleepy_after_long_gap", report.sleepy.afterLongGapCount, `${report.sleepy.afterLongGapPct || 0}%`]
    ];
    report.contexts.forEach(context => rows.push(["context", context.label, `${context.adherencePct}%`, `${context.metricDays} metric days`]));
    report.comparison.forEach(item => rows.push(["comparison", item.label, item.trendLabel, comparisonDelta(item)]));
    report.executiveSummary.forEach((point, index) => rows.push(["executive_summary", `point_${index + 1}`, point, ""]));
    if (report.coachNotes) rows.push(["coach_observations", "notes", report.coachNotes, ""]);
    report.interventions.forEach(intervention => {
      rows.push(["intervention", intervention.category || "intervention", intervention.action_text || "", intervention.observation || intervention.notes || ""]);
    });
    return rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportReportCsv() {
    const report = state.generatedReport;
    if (!report) {
      setStatus("Generate a review before exporting.");
      return;
    }
    const filename = `fuel-guard-athlete-review-${report.period.startKey}-${report.period.endKey}.csv`;
    downloadBlob(new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" }), filename);
    setStatus("Report CSV exported.");
  }

  function exportReportPdf() {
    const report = state.generatedReport;
    if (!report) {
      setStatus("Generate a review before exporting.");
      return;
    }
    const printable = window.open("", "_blank");
    if (!printable) {
      setStatus("Allow pop-ups to export the report PDF.");
      return;
    }
    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${safe(report.title)}</title>
        <style>
          body { margin: 0; padding: 32px; color: #102019; font-family: Arial, sans-serif; background: #fffdf7; }
          h1, h2, h3 { margin: 0 0 10px; color: #102019; }
          h1 { font-size: 28px; }
          h2 { margin-top: 26px; font-size: 18px; border-bottom: 1px solid #d8d0c2; padding-bottom: 6px; }
          p, li, td, th { font-size: 12px; line-height: 1.45; }
          .brand { display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: #d99024; color: #07130f; font-weight: 900; margin-bottom: 16px; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 18px; margin: 12px 0 18px; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; }
          th, td { text-align: left; border-bottom: 1px solid #e4ded1; padding: 7px 4px; }
          ul { padding-left: 18px; }
          .note { color: #667085; }
          @media print { body { background: #fff; } }
        </style>
      </head>
      <body>
        <div class="brand">FG</div>
        <h1>${safe(report.title)}</h1>
        <p>${safe(report.period.display)}</p>
        <div class="meta">
          <span>Coach: ${safe(report.coachName)}</span>
          <span>Team: ${safe(report.organisationName || "Not set")}</span>
          <span>Athlete: ${safe(report.athleteName)}</span>
          <span>Generated: ${safe(domain.dateKey(report.generatedAt))}</span>
          <span>Logging coverage: ${safe(`${report.coverage.loggedDays} / ${report.coverage.totalDays} days`)}</span>
          <span>Gap metric days: ${safe(report.coverage.metricDays)}</span>
        </div>
        <h2>Executive Summary</h2>
        <ul>${report.executiveSummary.map(point => `<li>${safe(point)}</li>`).join("")}</ul>
        <h2>Consistency and Fuelling Behaviour</h2>
        <table><tbody>${reportMetricRows(report).map(row => `<tr><th>${safe(row[0])}</th><td>${safe(row[1])}</td><td>${safe(row[2])}</td></tr>`).join("")}</tbody></table>
        <h2>Sleepy Patterns</h2>
        <p>${safe(report.sleepy.total ? `${report.sleepy.total} Sleepy event${report.sleepy.total === 1 ? " was" : "s were"} recorded in this period.` : "No Sleepy events were recorded in this period.")}</p>
        <p>${safe(report.sleepy.commonWindow ? `Most common Sleepy window: ${report.sleepy.commonWindow.label}.` : "Not enough Sleepy data to identify a recurring window yet.")}</p>
        ${report.sleepy.total ? `<p>${safe(`${report.sleepy.afterLongGapCount} of ${report.sleepy.total} Sleepy events occurred following fuel gaps longer than ${domain.duration(report.sleepy.targetMinutes || 0)}.`)}</p>` : ""}
        <p class="note">Sleepy logs are observational markers. Fuel Guard does not infer a medical cause.</p>
        <h2>Context</h2>
        ${report.contexts.length ? `<table><tbody>${report.contexts.map(context => `<tr><th>${safe(context.label)}</th><td>${safe(context.adherencePct)}% within target</td><td>${safe(context.metricDays)} metric days</td></tr>`).join("")}</tbody></table>` : `<p>Not enough context-specific data yet.</p>`}
        <h2>Previous Period Comparison</h2>
        <table><tbody>${report.comparison.map(item => `<tr><th>${safe(item.label)}</th><td>Current: ${safe(comparisonValue(item, item.current))}</td><td>Previous: ${safe(comparisonValue(item, item.previous))}</td><td>${safe(item.trendLabel || "Not enough data")}</td></tr>`).join("")}</tbody></table>
        <h2>Coach Observations</h2>
        <p>${safe(report.coachNotes || "No coach observations added yet.")}</p>
        <h2>Interventions</h2>
        ${report.interventions.length ? `<table><tbody>${report.interventions.map(intervention => `<tr><th>${safe(intervention.intervention_date || domain.dateKey(intervention.created_at))}</th><td>${safe(intervention.category || "Intervention")}</td><td>${safe(intervention.action_text || "")}</td></tr>`).join("")}</tbody></table>` : `<p>No interventions recorded for this athlete yet.</p>`}
      </body>
      </html>
    `;
    printable.document.open();
    printable.document.write(html);
    printable.document.close();
    printable.focus();
    printable.print();
    setStatus("Report PDF export opened.");
  }

  async function init() {
    if (!domain) {
      state.authResolved = true;
      state.coachLoading = false;
      setStatus("Coach Beta could not load Fuel Guard analytics helpers.");
      return;
    }
    if (!configured()) {
      state.authResolved = true;
      state.coachLoading = false;
      setStatus("Coach Beta needs Supabase public URL/key configuration.");
      renderAuth();
      return;
    }

    const config = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    state.client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });

    const { data, error } = await state.client.auth.getSession();
    state.authResolved = true;
    if (error) {
      state.coachLoading = false;
      setStatus(error.message);
      render();
      return;
    }
    state.session = data.session;
    if (state.session?.user) {
      const enableCoach = coachSignupIntent(state.session.user);
      state.coachLoading = true;
      renderAuth();
      await loadCoachData({ enableCoach, reason: "initial-auth" }).catch(error => {
        state.coachLoading = false;
        setStatus(friendlyError(error));
        render();
      });
    } else {
      state.coachLoading = false;
      setStatus("Sign in to open Coach Beta.");
      render();
    }

    state.client.auth.onAuthStateChange((_event, session) => {
      const previousUserId = state.session?.user?.id || "";
      state.session = session;
      state.authResolved = true;
      if (session?.user) {
        if (state.coachLoading && previousUserId === session.user.id) return;
        const enableCoach = coachSignupIntent(session.user);
        state.coachLoading = true;
        renderAuth();
        loadCoachData({ enableCoach, reason: "auth-state-change" }).catch(error => {
          state.coachLoading = false;
          setStatus(friendlyError(error));
          render();
        });
      }
      else {
        state.coachLoading = false;
        state.coachAccessBlocked = false;
        platformController?.reset();
        render();
      }
    });
  }

  document.addEventListener("click", event => {
    if (event.target.closest("[data-review-team]")) {
      state.currentTab = "athletes";
      render();
      $("coachAthleteList")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const tab = event.target.closest("[data-coach-tab]");
    if (tab) {
      state.currentTab = tab.dataset.coachTab;
      renderTabs();
      return;
    }

    const openAthlete = event.target.closest("[data-open-athlete]");
    if (openAthlete) {
      if (selectCoachAthlete(openAthlete.dataset.openAthlete)) {
        platformController?.athleteSelected(state.selectedAthleteId);
      }
      return;
    }

    const pattern = event.target.closest("[data-coach-pattern]");
    if (pattern) {
      state.selectedPattern = pattern.dataset.coachPattern;
      renderAthleteDetail();
      return;
    }

    const revoke = event.target.closest("[data-revoke-relationship]");
    if (revoke) {
      revokeRelationship(revoke.dataset.revokeRelationship);
      return;
    }

    const codeRequest = event.target.closest("[data-send-code-request]");
    if (codeRequest) {
      requestSharing(codeRequest);
      return;
    }

    const scheduledReview = event.target.closest("[data-open-scheduled-review]");
    if (scheduledReview) {
      openScheduledReview(scheduledReview.dataset.openScheduledReview, scheduledReview);
      return;
    }

    const reportBuilder = event.target.closest("[data-open-report-builder]");
    if (reportBuilder) {
      openReportBuilder(reportBuilder.dataset.openReportBuilder);
      return;
    }

    const interventionBuilder = event.target.closest("[data-open-intervention-builder]");
    if (interventionBuilder) {
      openInterventionBuilder(interventionBuilder.dataset.openInterventionBuilder);
      return;
    }

    const attentionStatus = event.target.closest("[data-attention-status]");
    if (attentionStatus) {
      updateAttentionStatus(attentionStatus);
      return;
    }

    const attentionNote = event.target.closest("[data-add-attention-note]");
    if (attentionNote) {
      openAttentionComposer("note", attentionNote.dataset.addAttentionNote);
      return;
    }

    const attentionNudge = event.target.closest("[data-nudge-attention]");
    if (attentionNudge) {
      openAttentionComposer("nudge", attentionNudge.dataset.nudgeAttention);
      return;
    }

    const attentionIntervention = event.target.closest("[data-create-attention-intervention]");
    if (attentionIntervention) {
      openAttentionIntervention(attentionIntervention.dataset.createAttentionIntervention);
      return;
    }

    const submitComposer = event.target.closest("[data-submit-attention-composer]");
    if (submitComposer) {
      submitAttentionComposer(submitComposer);
      return;
    }

    if (event.target.closest("[data-cancel-attention-composer]")) {
      state.attentionComposer = null;
      renderNeedsAttention();
      return;
    }

    const reviewIntervention = event.target.closest("[data-review-intervention]");
    if (reviewIntervention) {
      openInterventionReview(reviewIntervention.dataset.reviewIntervention, reviewIntervention);
      return;
    }

    const completeReview = event.target.closest("[data-complete-intervention-review]");
    if (completeReview) {
      completeInterventionReview(completeReview.dataset.completeInterventionReview, completeReview);
      return;
    }

    if (event.target.closest("[data-cancel-intervention-review]")) {
      state.interventionReview = null;
      renderInterventionReview();
      return;
    }

    const refreshInbox = event.target.closest("[data-refresh-coach-inbox]");
    if (refreshInbox) {
      withBusy(refreshInbox, () => loadCoachData());
      return;
    }

    if (event.target.closest("[data-export-report-pdf]")) {
      exportReportPdf();
      return;
    }

    if (event.target.closest("[data-export-report-csv]")) {
      exportReportCsv();
      return;
    }

    const createOrganisationButton = event.target.closest("[data-create-organisation]");
    if (createOrganisationButton) {
      createOrganisation(createOrganisationButton);
      return;
    }

    const createTeamButton = event.target.closest("[data-create-team]");
    if (createTeamButton) {
      createTeam(createTeamButton);
      return;
    }

    const createGroupButton = event.target.closest("[data-create-saved-group]");
    if (createGroupButton) {
      createSavedGroup(createGroupButton);
      return;
    }

    const renameGroupButton = event.target.closest("[data-rename-saved-group]");
    if (renameGroupButton) {
      renameSavedGroup(renameGroupButton.dataset.renameSavedGroup, renameGroupButton);
      return;
    }

    const deleteGroupButton = event.target.closest("[data-delete-saved-group]");
    if (deleteGroupButton) {
      deleteSavedGroup(deleteGroupButton.dataset.deleteSavedGroup, deleteGroupButton);
      return;
    }

    const staffNoteButton = event.target.closest("[data-create-staff-note]");
    if (staffNoteButton) {
      createStaffNote(staffNoteButton.dataset.createStaffNote, staffNoteButton);
      return;
    }

    const trainingButton = event.target.closest("[data-create-training-session]");
    if (trainingButton) {
      createTrainingSession(trainingButton);
      return;
    }

    const viewTeamSession = event.target.closest("[data-view-team-session]");
    if (viewTeamSession) {
      const id = viewTeamSession.dataset.viewTeamSession;
      state.selectedTrainingSessionId = String(state.selectedTrainingSessionId) === String(id) ? "" : id;
      renderTrainingSchedule();
      return;
    }

    const editTeamSession = event.target.closest("[data-edit-team-session]");
    if (editTeamSession) {
      state.editingTrainingSessionId = editTeamSession.dataset.editTeamSession;
      renderTrainingSchedule();
      $("coachTrainingName")?.focus();
      return;
    }

    if (event.target.closest("[data-cancel-training-edit]")) {
      state.editingTrainingSessionId = "";
      renderTrainingSchedule();
      return;
    }

    const cancelTeamSession = event.target.closest("[data-cancel-team-session]");
    if (cancelTeamSession) {
      cancelTrainingSession(cancelTeamSession.dataset.cancelTeamSession, cancelTeamSession);
      return;
    }

    const deleteTeamSession = event.target.closest("[data-delete-team-session]");
    if (deleteTeamSession) {
      deleteTrainingSession(deleteTeamSession.dataset.deleteTeamSession, deleteTeamSession);
      return;
    }
  });

  document.addEventListener("change", event => {
    if (event.target.id === "coachActiveGroupFilter") {
      state.selectedGroupId = event.target.value || "";
      state.generatedReport = null;
      state.reportSaved = false;
      rebuildRoster();
      rebuildOperationalData();
      render();
      platformController?.publishData("saved-group-filtered");
      return;
    }
    if (event.target.id === "coachTrainingTeam") {
      const team = state.teams.find(item => String(item.id) === String(event.target.value));
      if (team && $("coachTrainingTimezone")) $("coachTrainingTimezone").value = team.timezone_name || state.timeZone;
      return;
    }
    if (event.target.matches("[data-team-athlete-team]")) {
      toggleTeamAthlete(event.target);
      return;
    }
    if (event.target.matches("[data-group-member-group]")) {
      toggleSavedGroupMember(event.target);
    }
  });

  $("coachSignInButton")?.addEventListener("click", signIn);
  $("coachSignUpButton")?.addEventListener("click", signUp);
  $("coachForgotPasswordButton")?.addEventListener("click", forgotPassword);
  $("coachAccessSignOutButton")?.addEventListener("click", signOut);
  $("coachSignOutButton")?.addEventListener("click", signOut);
  $("coachSaveProfileButton")?.addEventListener("click", saveProfile);
  $("coachFindAthleteButton")?.addEventListener("click", findAthleteByCode);
  $("coachGenerateReviewButton")?.addEventListener("click", generateReport);
  $("coachSaveReviewButton")?.addEventListener("click", saveReport);
  $("coachCompleteReviewButton")?.addEventListener("click", completeWeeklyReview);
  $("coachCreateScheduleButton")?.addEventListener("click", createReviewSchedule);
  $("coachCreateInterventionButton")?.addEventListener("click", createIntervention);
  $("coachReportAthlete")?.addEventListener("change", event => {
    state.selectedReportAthleteId = event.target.value || "";
    state.selectedScheduleId = "";
    state.generatedReport = null;
    state.reportSaved = false;
    state.savedWeeklyReportId = "";
    renderScheduleDraftContext();
    renderReportPreview();
  });
  $("coachReportPeriod")?.addEventListener("change", event => {
    state.reportPeriod = event.target.value || "12_weeks";
    state.selectedScheduleId = "";
    state.generatedReport = null;
    state.reportSaved = false;
    state.savedWeeklyReportId = "";
    if (state.reportPeriod === "week") {
      const period = domain.weeklyReportingPeriod({ now: new Date(), timeZone: state.timeZone });
      if ($("coachReportStart")) $("coachReportStart").value = period.startKey;
      if ($("coachReportEnd")) $("coachReportEnd").value = period.endKey;
    }
    const generateButton = $("coachGenerateReviewButton");
    if (generateButton) {
      generateButton.textContent = state.reportPeriod === "week" ? "Generate Weekly Review" : "Assemble review";
    }
    renderScheduleDraftContext();
    renderReportPreview();
  });
  $("coachScheduleType")?.addEventListener("change", event => {
    const definition = domain.reviewScheduleDefinition(event.target.value);
    if ($("coachSchedulePeriod")) $("coachSchedulePeriod").value = definition.reportPeriod;
    if ($("coachScheduleCadence")) $("coachScheduleCadence").value = definition.cadence;
  });
  $("coachReportNotes")?.addEventListener("input", event => {
    if (!state.generatedReport) return;
    state.generatedReport = { ...state.generatedReport, coachNotes: event.target.value || "" };
    renderReportPreview();
  });
  $("coachOrganisationName")?.addEventListener("input", event => {
    if (!state.generatedReport) return;
    state.generatedReport = { ...state.generatedReport, organisationName: event.target.value || "" };
    renderReportPreview();
  });
  $("coachAthleteCodeInput")?.addEventListener("input", event => {
    state.athleteCodeQuery = normalizeAthleteCode(event.target.value || "");
    state.athleteCodeResult = null;
    state.athleteCodeStatus = "";
    state.athleteCodeStatusDetail = "";
    renderAthleteCodeResult();
  });
  $("coachAthleteCodeInput")?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      findAthleteByCode();
    }
  });

  document.addEventListener("DOMContentLoaded", init);
})();
