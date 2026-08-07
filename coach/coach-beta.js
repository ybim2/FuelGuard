// Fuel Guard Coach Beta. Read-only coach views over explicitly shared athlete data.
(() => {
  const domain = window.FuelGuardDomain;
  const TABLES = {
    profiles: "fuel_user_profiles",
    relationships: "fuel_coach_athletes",
    logs: "fuel_logs",
    targets: "fuel_targets"
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

  const state = {
    client: null,
    session: null,
    profile: null,
    relationships: [],
    athleteProfiles: [],
    logs: [],
    targets: [],
    roster: [],
    currentTab: "dashboard",
    selectedAthleteId: "",
    selectedPattern: "fuel",
    search: "",
    busy: false,
    status: ""
  };

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

  function setStatus(message) {
    state.status = message || "";
    const target = $("coachGlobalStatus");
    if (target) target.textContent = state.status;
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Something went wrong.");
    if (/fuel_user_profiles|fuel_coach_athletes|maximum_fuel_gap_minutes|does not exist|schema cache/i.test(message)) {
      return "Coach Beta database setup is not applied yet. Apply supabase/fuel_coach_beta.sql in the Fuel Guard Supabase project.";
    }
    return message;
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
    state.roster = domain.buildCoachRoster({
      athletes: athleteRows(),
      logs: state.logs,
      targetsByUser: targetsByUser(),
      now: new Date()
    });
    if (!state.selectedAthleteId && state.roster[0]) state.selectedAthleteId = state.roster[0].athlete.userId;
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

  function renderNeedsAttention() {
    const target = $("coachNeedsAttention");
    if (!target) return;
    const flagged = state.roster.filter(item => item.flags.length);
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-card-heading">
          <span class="coach-icon">!</span>
          <div>
            <h2>Needs Attention</h2>
            <p>Behavioural timing signals from athletes who have shared Fuel Guard logs with you.</p>
          </div>
        </div>
        <div class="coach-alert-list">
          ${flagged.length ? flagged.map(item => {
            const flag = item.flags[0];
            const tone = flagTone(flag);
            return `
              <article class="coach-alert-row ${safe(tone)}">
                <div class="coach-athlete-title">
                  <strong>${safe(item.athlete.displayName)}</strong>
                  <span class="coach-chip">${safe(flag.label)}</span>
                </div>
                <p>${safe(flag.detail)}</p>
                <div class="coach-mini-metrics">
                  <span>Status: ${safe(item.statusLabel)}</span>
                  <span>Last fuel: ${safe(item.lastFuel ? `${domain.duration(item.minutesSinceFuel)} ago` : "No fuel today")}</span>
                  <span>Sleepy: ${safe(item.sleepyLogs.length)}</span>
                </div>
              </article>
            `;
          }).join("") : `<div class="coach-empty">No athletes need attention right now.</div>`}
        </div>
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
          ${state.roster.length ? state.roster.map(item => rosterRow(item, { compact: true })).join("") : `<div class="coach-empty">No active athlete sharing relationships yet.</div>`}
        </div>
      </section>
    `;
  }

  function renderAthleteList() {
    const target = $("coachAthleteList");
    if (!target) return;
    const query = state.search.trim().toLowerCase();
    const rows = state.roster.filter(item => {
      if (!query) return true;
      return `${item.athlete.displayName} ${item.athlete.userId}`.toLowerCase().includes(query);
    });
    target.innerHTML = `
      <section class="coach-card">
        <div class="coach-list">
          ${rows.length ? rows.map(item => rosterRow(item)).join("") : `<div class="coach-empty">No assigned athlete matches that search.</div>`}
        </div>
      </section>
    `;
  }

  function selectedAthleteStatus() {
    return state.roster.find(item => item.athlete.userId === state.selectedAthleteId) || state.roster[0] || null;
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
            <p class="coach-note">${safe(relation.athlete_id)}</p>
          </div>
          <div class="coach-row-meta">
            <span>Status: ${safe(relation.status)}</span>
            <span>${relation.status === "active" ? "Sharing active" : relation.status === "pending" ? "Waiting for athlete approval" : "Revoked"}</span>
          </div>
          <div class="coach-button-row">
            <button class="secondary" type="button" data-revoke-relationship="${safe(relation.id)}">Remove</button>
          </div>
        </article>
      `).join("")
      : `<div class="coach-empty">No relationships yet. Add an athlete user ID to request sharing.</div>`;
  }

  function renderSettings() {
    const user = coachUser();
    const displayName = $("coachDisplayName");
    const userId = $("coachUserId");
    if (displayName && document.activeElement !== displayName) displayName.value = state.profile?.display_name || "";
    if (userId) userId.value = user?.id || "";
    renderRelationships();
  }

  function renderAuth() {
    const authPanel = $("coachAuthPanel");
    const appShell = $("coachAppShell");
    const signedIn = Boolean(coachUser());
    if (authPanel) authPanel.hidden = signedIn;
    if (appShell) appShell.hidden = !signedIn;
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
    renderNeedsAttention();
    renderRoster();
    renderAthleteList();
    renderAthleteDetail();
    renderSettings();
  }

  async function loadCoachData() {
    const user = coachUser();
    if (!state.client || !user) return;
    setStatus("Loading coach data...");

    const { data: profile, error: profileError } = await state.client
      .from(TABLES.profiles)
      .select("user_id,role,display_name,created_at,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (!profile) {
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .upsert({ user_id: user.id, role: "coach", display_name: user.email || "Coach" }, { onConflict: "user_id" })
        .select("user_id,role,display_name,created_at,updated_at")
        .single();
      if (error) throw error;
      state.profile = data;
    } else {
      state.profile = profile;
    }

    if (state.profile?.role !== "coach") {
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .update({ role: "coach", updated_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .select("user_id,role,display_name,created_at,updated_at")
        .single();
      if (error) throw error;
      state.profile = data;
    }

    const { data: relationships, error: relationshipError } = await state.client
      .from(TABLES.relationships)
      .select("id,coach_id,athlete_id,status,athlete_label,created_at,accepted_at,revoked_at")
      .eq("coach_id", user.id)
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false });
    if (relationshipError) throw relationshipError;
    state.relationships = relationships || [];

    const athleteIds = state.relationships.filter(relation => relation.status === "active").map(relation => relation.athlete_id);
    state.athleteProfiles = [];
    state.logs = [];
    state.targets = [];

    if (athleteIds.length) {
      const { data: profiles, error: profilesError } = await state.client
        .from(TABLES.profiles)
        .select("user_id,role,display_name,created_at,updated_at")
        .in("user_id", athleteIds);
      if (profilesError) throw profilesError;
      state.athleteProfiles = profiles || [];

      const start = domain.startOfLocalDay().toISOString();
      const end = domain.endOfLocalDay().toISOString();
      const { data: logs, error: logsError } = await state.client
        .from(TABLES.logs)
        .select("id,user_id,logged_at,type,source,external_event_id,day_type,training_session,notes,created_at")
        .in("user_id", athleteIds)
        .gte("logged_at", start)
        .lt("logged_at", end)
        .order("logged_at", { ascending: true });
      if (logsError) throw logsError;
      state.logs = (logs || []).map(domain.normalizeLog).filter(Boolean);

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
    }

    rebuildRoster();
    setStatus(`Loaded ${state.roster.length} active athlete${state.roster.length === 1 ? "" : "s"}.`);
    render();
  }

  async function withBusy(button, callback) {
    if (state.busy) return;
    state.busy = true;
    if (button) button.disabled = true;
    try {
      await callback();
    } catch (error) {
      setStatus(friendlyError(error));
    } finally {
      state.busy = false;
      if (button) button.disabled = false;
    }
  }

  async function signIn() {
    await withBusy($("coachSignInButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      const password = $("coachPassword")?.value || "";
      if (!email || !password) throw new Error("Enter an email and password.");
      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.session = data.session;
      await loadCoachData();
    });
  }

  async function signUp() {
    await withBusy($("coachSignUpButton"), async () => {
      const email = $("coachEmail")?.value?.trim();
      const password = $("coachPassword")?.value || "";
      if (!email || !password) throw new Error("Enter an email and password.");
      const { data, error } = await state.client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/coach/` }
      });
      if (error) throw error;
      state.session = data.session || state.session;
      setStatus(data.session ? "Coach account created." : "Confirmation email sent. Check your inbox.");
      if (data.session) await loadCoachData();
    });
  }

  async function signOut() {
    await state.client?.auth.signOut();
    state.session = null;
    state.profile = null;
    state.relationships = [];
    state.athleteProfiles = [];
    state.logs = [];
    state.targets = [];
    state.roster = [];
    setStatus("Signed out.");
    render();
  }

  async function saveProfile() {
    await withBusy($("coachSaveProfileButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const displayName = $("coachDisplayName")?.value?.trim() || user.email || "Coach";
      const { data, error } = await state.client
        .from(TABLES.profiles)
        .upsert({ user_id: user.id, role: "coach", display_name: displayName, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
        .select("user_id,role,display_name,created_at,updated_at")
        .single();
      if (error) throw error;
      state.profile = data;
      setStatus("Coach profile saved.");
      renderSettings();
    });
  }

  async function requestSharing() {
    await withBusy($("coachInviteButton"), async () => {
      const user = coachUser();
      if (!user) throw new Error("Sign in first.");
      const athleteId = $("coachInviteAthleteId")?.value?.trim();
      const label = $("coachInviteAthleteLabel")?.value?.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(athleteId || "")) {
        throw new Error("Enter a valid athlete Supabase user ID.");
      }
      const row = {
        coach_id: user.id,
        athlete_id: athleteId,
        status: "pending",
        athlete_label: label || null,
        updated_at: new Date().toISOString()
      };
      const { error } = await state.client
        .from(TABLES.relationships)
        .upsert(row, { onConflict: "coach_id,athlete_id" });
      if (error) throw error;
      $("coachInviteAthleteId").value = "";
      $("coachInviteAthleteLabel").value = "";
      setStatus("Sharing requested. Athlete data stays private until they approve.");
      await loadCoachData();
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
      await loadCoachData();
    });
  }

  async function init() {
    if (!domain) {
      setStatus("Coach Beta could not load Fuel Guard analytics helpers.");
      return;
    }
    if (!configured()) {
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

    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      if (session?.user) loadCoachData().catch(error => setStatus(friendlyError(error)));
      else render();
    });

    const { data, error } = await state.client.auth.getSession();
    if (error) {
      setStatus(error.message);
      render();
      return;
    }
    state.session = data.session;
    if (state.session?.user) {
      await loadCoachData().catch(error => {
        setStatus(friendlyError(error));
        render();
      });
    } else {
      setStatus("Sign in to open Coach Beta.");
      render();
    }
  }

  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-coach-tab]");
    if (tab) {
      state.currentTab = tab.dataset.coachTab;
      renderTabs();
      return;
    }

    const openAthlete = event.target.closest("[data-open-athlete]");
    if (openAthlete) {
      state.selectedAthleteId = openAthlete.dataset.openAthlete;
      state.currentTab = "athletes";
      render();
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
    }
  });

  $("coachSignInButton")?.addEventListener("click", signIn);
  $("coachSignUpButton")?.addEventListener("click", signUp);
  $("coachSignOutButton")?.addEventListener("click", signOut);
  $("coachSaveProfileButton")?.addEventListener("click", saveProfile);
  $("coachInviteButton")?.addEventListener("click", requestSharing);
  $("coachAthleteSearch")?.addEventListener("input", event => {
    state.search = event.target.value || "";
    renderAthleteList();
  });

  document.addEventListener("DOMContentLoaded", init);
})();
