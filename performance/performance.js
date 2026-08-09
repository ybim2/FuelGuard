(() => {
  const CAPABILITIES = [
    ["view_performance", "Open Performance"],
    ["view_org_aggregates", "View organisational aggregates"],
    ["view_athlete_detail", "View athlete/client detail"],
    ["view_staff_activity", "View staff activity"],
    ["view_interventions", "View intervention status"],
    ["manage_structure", "Manage organisation structure"],
    ["manage_staff_access", "Manage staff access"],
    ["manage_reports", "Manage reporting controls"],
    ["manage_interventions", "Manage interventions"]
  ];
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const STORAGE_ORG = "fuel_guard_performance_organisation";
  const state = {
    client: null,
    session: null,
    contexts: [],
    organisationId: "",
    overview: null,
    pathway: null,
    staff: null,
    shares: [],
    reports: null,
    staffAccounts: {},
    platformAdmin: { isPlatformAdmin: false, organisations: [] },
    athleteDetail: null,
    tab: "overview",
    busy: false,
    recovering: false,
    toastTimer: null
  };

  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const number = value => value == null || value === ""
    ? "—"
    : Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";
  const percent = value => value == null ? "Suppressed" : `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`;
  const minutes = value => {
    if (value == null || !Number.isFinite(Number(value))) return "Insufficient data";
    const total = Math.round(Number(value));
    return total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total}m`;
  };
  const dateTime = value => {
    if (!value) return "No activity recorded";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };
  const dateInput = date => {
    const shifted = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
    return shifted.toISOString().slice(0, 10);
  };
  const currentContext = () => state.contexts.find(item => item.organisation_id === state.organisationId) || null;
  const hasCapability = capability => currentContext()?.capabilities?.includes(capability) || false;
  const units = () => Array.isArray(state.pathway?.units) ? state.pathway.units : [];

  function resetOrganisationData() {
    state.overview = null;
    state.pathway = null;
    state.staff = null;
    state.shares = [];
    state.reports = null;
    state.staffAccounts = {};
    state.athleteDetail = null;
    $("athleteDetailPanel").hidden = true;
  }

  function setPanelVisibility(name) {
    $("loadingPanel").hidden = name !== "loading";
    $("authPanel").hidden = name !== "auth";
    $("recoveryPanel").hidden = name !== "recovery";
    $("accessPanel").hidden = name !== "access";
    $("appShell").hidden = name !== "app";
    $("organisationPickerLabel").hidden = name !== "app";
    $("refreshButton").hidden = name !== "app";
    $("platformAdminBanner").hidden = name !== "app" || !state.platformAdmin.isPlatformAdmin;
  }

  function toast(message) {
    const target = $("globalStatus");
    target.textContent = message || "";
    target.classList.toggle("visible", Boolean(message));
    window.clearTimeout(state.toastTimer);
    if (message) state.toastTimer = window.setTimeout(() => target.classList.remove("visible"), 5200);
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "The request could not be completed.");
    if (/invalid login credentials/i.test(message)) return "Those login details did not work.";
    if (/no fuel guard account matches|email address|organisation name/i.test(message)) return message;
    if (/failed to fetch|network|load failed/i.test(message)) return "Fuel Guard could not reach Supabase. Check your connection and try again.";
    if (/access denied|permission|row-level|42501/i.test(message)) return "Your current scope or capability does not allow that action.";
    if (/cohort|unit|staff member|athlete|organisation|reporting period|sharing request/i.test(message)) return message;
    if (/does not exist|schema cache|fuel_performance/i.test(message)) return "Performance database setup is not available in this environment yet.";
    return "Fuel Guard Performance could not complete that request. Try again.";
  }

  async function rpc(name, params = {}) {
    const { data, error } = await state.client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  function unitOptions({ includeAll = false, includeRoot = false } = {}) {
    const options = [];
    if (includeAll) options.push('<option value="">All permitted units</option>');
    if (includeRoot) options.push('<option value="">Organisation root</option>');
    units().forEach(unit => options.push(`<option value="${safe(unit.id)}">${safe(unit.name)}${unit.type ? ` · ${safe(unit.type)}` : ""}</option>`));
    return options.join("");
  }

  function renderOrganisationPicker() {
    $("organisationPicker").innerHTML = state.contexts.map(context =>
      `<option value="${safe(context.organisation_id)}">${safe(context.organisation_name)}</option>`
    ).join("");
    $("organisationPicker").value = state.organisationId;
    $("sidebarOrganisation").textContent = currentContext()?.organisation_name || "Organisation";
    $("reportingMinimumInput").value = currentContext()?.minimum_reporting_cohort ?? 5;
    $("saveReportingMinimumButton").disabled = !currentContext()?.can_manage_reports;
    $("unitManager").hidden = !currentContext()?.can_manage_structure;
    $("accessManager").hidden = !currentContext()?.can_manage_access;
    $("platformAdminOrganisation").textContent = currentContext()?.organisation_name || "organisation";
    $("platformAdminBanner").hidden = !state.platformAdmin.isPlatformAdmin;
  }

  function empty(title, copy) {
    return `<div class="empty-state"><strong>${safe(title)}</strong><p>${safe(copy)}</p></div>`;
  }

  function metric(label, value, note, className = "") {
    return `<article class="metric-card ${safe(className)}"><span>${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(note)}</small></article>`;
  }

  function renderOverview() {
    const data = state.overview;
    if (!data || data.status === "empty") {
      $("overviewContent").innerHTML = empty("No actively shared athletes", "Add units, invite athletes or clients to share, and assign them before organisational status can be calculated.");
      return;
    }
    const health = data.organisationHealth || {};
    const accountability = data.accountability || {};
    const dataHealth = data.dataHealth || {};
    const behaviour = data.behaviour || {};
    const details = Array.isArray(data.attentionItems) ? data.attentionItems : [];
    const grouped = Array.isArray(data.attentionByUnit) ? data.attentionByUnit : [];
    const brief = Array.isArray(data.weeklyBrief) ? data.weeklyBrief : [];
    const healthKnown = behaviour.status !== "suppressed";
    const attentionRows = details.length
      ? details.map(item => `<li class="attention-row">
          <div><strong>${safe(item.athleteName)}</strong><small>${safe(item.issue)}</small></div>
          <div><strong>${safe(item.unitName || "Unassigned unit")}</strong><small>${safe(item.responsibleStaffName || "Unassigned staff")}</small></div>
          <div><strong>${item.lastLogAt ? `Last log ${safe(dateTime(item.lastLogAt))}` : "No logging data"}</strong><small>${item.followUpDue ? "Follow-up due" : "Operational signal"}</small></div>
          <div class="attention-actions"><span class="status-badge ${safe(item.status)}">${safe(String(item.status || "open").replaceAll("_", " "))}</span><button class="text-button compact-button" type="button" data-athlete-detail="${safe(item.athleteId)}">Open athlete</button></div>
        </li>`).join("")
      : grouped.length
        ? grouped.map(item => `<li class="unit-row"><div><strong>${safe(item.unitName)}</strong><small>Organisational unit</small></div><div><strong>${number(item.athletesNeedingAttention)}</strong><small>Athletes needing attention</small></div><span class="status-badge open">Review unit</span></li>`).join("")
        : empty("No current operational signals", "No actively shared athlete in your scope currently meets the server-side attention conditions.");

    $("overviewContent").innerHTML = `
      <div class="metric-grid">
        ${metric("Active athletes / clients", number(health.activeAthletes), "Actively shared in your scope", "protected")}
        ${metric("Active staff", number(health.activeStaff), "With active organisational access")}
        ${metric("Logging coverage", percent(health.loggingCoverage), healthKnown ? "During this reporting period" : "Insufficient cohort size")}
        ${metric("Wearable coverage", percent(health.wearableCoverage), healthKnown ? "Active Garmin connection" : "Insufficient cohort size")}
        ${metric("Needs attention", number(health.athletesNeedingAttention), "Operational signals, not diagnoses", "attention")}
        ${metric("Open interventions", number(health.openInterventions), `${number(accountability.followUpDue)} follow-up due`)}
      </div>
      <div class="overview-grid">
        <div class="stack">
          <section class="performance-card">
            <div class="section-heading"><div><h2>Needs Attention oversight</h2><p>Issue → athlete/client where permitted → responsible staff → unit → status</p></div><span class="status-badge open">${number(health.athletesNeedingAttention)} current</span></div>
            <ul class="attention-list">${attentionRows}</ul>
          </section>
          <section class="performance-card">
            <div class="section-heading"><div><h2>Response and intervention</h2><p>Operational visibility without staff ranking.</p></div></div>
            <div class="report-metrics">
              <div class="report-metric"><span>Reviewed this period</span><strong>${number(accountability.reviewedThisPeriod)}</strong></div>
              <div class="report-metric"><span>Interventions created</span><strong>${number(accountability.interventionsCreated)}</strong></div>
              <div class="report-metric"><span>Follow-up due</span><strong>${number(accountability.followUpDue)}</strong></div>
              <div class="report-metric"><span>Resolved this period</span><strong>${number(accountability.resolvedThisPeriod)}</strong></div>
              <div class="report-metric"><span>Fuel events</span><strong>${behaviour.status === "suppressed" ? "Suppressed" : number(behaviour.fuelEvents)}</strong></div>
            </div>
          </section>
        </div>
        <div class="stack">
          <section class="performance-card">
            <div class="section-heading"><div><h2>Data health</h2><p>Can this view be trusted?</p></div><span class="status-badge ${healthKnown ? "available" : "suppressed"}">${healthKnown ? "Visible" : "Protected"}</span></div>
            ${healthKnown ? `
              <div class="health-bar"><span style="width:${Math.max(0, Math.min(100, Number(health.wearableCoverage || 0)))}%"></span></div>
              <div class="health-detail"><span>${number(dataHealth.connectedWearables)} connected</span><span>${number(dataHealth.disconnectedOrNotConnected)} disconnected or not connected</span></div>
              <div class="callout" style="margin-top:16px">${number(dataHealth.staleOrNoLogs)} athlete${Number(dataHealth.staleOrNoLogs) === 1 ? " has" : "s have"} stale or missing log data; ${number(dataHealth.staleIntegrations)} active Garmin connection${Number(dataHealth.staleIntegrations) === 1 ? " appears" : "s appear"} stale. Missing data is not treated as a healthy pattern.</div>
            ` : `<div class="callout">Insufficient cohort size. Behavioural coverage rates are hidden rather than represented as zero.</div>`}
          </section>
          <section class="performance-card">
            <div class="section-heading"><div><h2>Weekly organisation brief</h2><p>Only statements supported by current data.</p></div></div>
            <ul class="brief-list">${brief.map(line => `<li>${safe(line)}</li>`).join("")}</ul>
          </section>
        </div>
      </div>`;
  }

  function unitDepth(unit, byId, seen = new Set()) {
    if (!unit?.parentId || seen.has(unit.id)) return 0;
    seen.add(unit.id);
    return 1 + unitDepth(byId.get(unit.parentId), byId, seen);
  }

  function renderPathway() {
    const data = state.pathway;
    if (!data || data.status === "empty" || !units().length) {
      $("pathwayContent").innerHTML = empty("No organisation units", "An authorised structure manager can add a root unit, then nest locations, programmes, squads, departments, or other generic units beneath it.");
    } else {
      const byId = new Map(units().map(unit => [unit.id, unit]));
      $("pathwayContent").innerHTML = `<div class="tree" role="tree" aria-label="Organisation units">${units().map(unit => {
        const depth = unitDepth(unit, byId);
        return `<article class="tree-row" role="treeitem" aria-level="${depth + 1}" style="--depth:${depth}">
          <div class="unit-name"><strong>${safe(unit.name)}</strong><small>${safe(unit.type || "Organisation unit")}</small></div>
          <div class="tree-metric"><span>Athletes</span><strong>${number(unit.athleteCount)}</strong></div>
          <div class="tree-metric"><span>Staff</span><strong>${number(unit.staffCount)}</strong></div>
          <div class="tree-metric"><span>Attention</span><strong>${unit.reportingStatus === "suppressed" ? "Protected" : number(unit.attentionCount)}</strong></div>
          <div class="tree-metric"><span>Logging</span><strong>${percent(unit.loggingCoverage)}</strong></div>
        </article>`;
      }).join("")}</div>`;
    }
    const selectedParent = $("unitParentPicker").value;
    $("unitParentPicker").innerHTML = unitOptions({ includeRoot: true });
    if ([...$("unitParentPicker").options].some(option => option.value === selectedParent)) $("unitParentPicker").value = selectedParent;
  }

  function capabilityLabel(value) {
    return CAPABILITIES.find(([id]) => id === value)?.[1] || String(value || "").replaceAll("_", " ");
  }

  function renderStaff() {
    const people = Array.isArray(state.staff?.staff) ? state.staff.staff : [];
    if (!state.staff || state.staff.status === "empty" || !people.length) {
      $("staffContent").innerHTML = empty("No active staff", "Add organisation members before assigning independent scope and capability grants.");
    } else {
      $("staffContent").innerHTML = `<div class="staff-list">${people.map(person => {
        const capabilities = (person.capabilities || []).map(item => `<span class="capability-chip ${item.status === "active" ? "" : "revoked"}">${safe(capabilityLabel(item.capability))}</span>`).join("");
        const scopes = (person.scopes || []).map(item => {
          const label = item.type === "organisation" ? "Entire organisation" : item.type === "unit" ? `${item.unitName || "Unit"}${item.includeDescendants ? " + descendants" : ""}` : item.athleteName || "Individual athlete/client";
          return `<span class="scope-chip ${item.status === "active" ? "" : "revoked"}">${safe(label)}</span>`;
        }).join("");
        return `<article class="staff-row">
          <div><strong>${safe(person.displayName)}</strong><small>${safe(state.staffAccounts[person.userId] || "Fuel Guard account")} · ${safe(person.membershipRole)} · ${safe(person.status)}</small></div>
          <div><strong>Who they can access</strong><div class="chip-list">${scopes || '<span class="scope-chip revoked">No active scope</span>'}</div></div>
          <div><strong>What they can do</strong><div class="chip-list">${capabilities || '<span class="capability-chip revoked">No capabilities</span>'}</div></div>
          <div><strong>Last meaningful activity</strong><small>${safe(dateTime(person.lastMeaningfulActivityAt))}</small></div>
        </article>`;
      }).join("")}</div>`;
    }

    const staffOptions = people.map(person => `<option value="${safe(person.userId)}">${safe(person.displayName)}</option>`).join("");
    $("capabilityStaffPicker").innerHTML = staffOptions;
    $("scopeStaffPicker").innerHTML = staffOptions;
    $("capabilityPicker").innerHTML = CAPABILITIES.map(([id, label]) => `<option value="${safe(id)}">${safe(label)}</option>`).join("");
    $("scopeUnitPicker").innerHTML = unitOptions();
    $("scopeAthletePicker").innerHTML = state.shares.filter(share => share.status === "active").map(share => `<option value="${safe(share.athleteId)}">${safe(share.athleteName)}</option>`).join("");
    $("athleteUnitAthletePicker").innerHTML = state.shares.filter(share => share.status === "active").map(share => `<option value="${safe(share.athleteId)}">${safe(share.athleteName)}</option>`).join("");
    $("athleteUnitPicker").innerHTML = unitOptions();
  }

  function renderReports() {
    const data = state.reports;
    if (!data) {
      $("reportsContent").innerHTML = empty("Report unavailable", "Choose a valid date period and try again.");
      return;
    }
    if (data.status === "suppressed") {
      $("reportsContent").innerHTML = `<section class="performance-card"><div class="empty-state"><span class="status-badge suppressed">Protected</span><strong>${safe(data.reason || "Insufficient cohort size")}</strong><p>${number(data.cohort?.count)} athletes or clients are in this permitted view; at least ${number(data.cohort?.minimum)} are required. Metrics are returned as unavailable, not zero.</p></div></section>`;
      return;
    }
    const fuel = data.fuelling || {};
    const training = data.trainingContext || {};
    const comparison = Array.isArray(data.units) ? data.units : [];
    $("reportsContent").innerHTML = `<div class="report-card-grid">
      <section class="performance-card">
        <div class="section-heading"><div><h2>Fuelling behaviour</h2><p>Server-side aggregates for ${number(data.cohort?.count)} actively shared athletes or clients.</p></div></div>
        <div class="report-metrics">
          <div class="report-metric"><span>Fuel events</span><strong>${number(fuel.fuelEvents)}</strong></div>
          <div class="report-metric"><span>Average fuel gap</span><strong>${safe(minutes(fuel.averageFuelGapMinutes))}</strong></div>
          <div class="report-metric"><span>Extended gaps</span><strong>${number(fuel.extendedGapCount)}</strong></div>
          <div class="report-metric"><span>Sleepy / low-energy events</span><strong>${number(fuel.sleepyEventCount)}</strong></div>
        </div>
      </section>
      <section class="performance-card">
        <div class="section-heading"><div><h2>Training context</h2><p>Aggregated from the shared normalized workout feature store.</p></div><span class="status-badge ${training.status === "available" ? "available" : "suppressed"}">${safe(training.status === "available" ? "Available" : "Insufficient data")}</span></div>
        ${training.status === "available" ? `<div class="report-metrics">
          <div class="report-metric"><span>Workouts</span><strong>${number(training.workoutCount)}</strong></div>
          <div class="report-metric"><span>Missing pre-session fuel</span><strong>${number(training.missingPreFuelCount)}</strong></div>
          <div class="report-metric"><span>Missing post-session fuel</span><strong>${number(training.missingPostFuelCount)}</strong></div>
        </div>` : `<div class="callout">${safe(training.reason || "No normalized workouts are available for this period.")}</div>`}
      </section>
      <section class="performance-card wide">
        <div class="section-heading"><div><h2>Permitted unit context</h2><p>Contextual comparison only; small cohorts stay suppressed and no ranking is applied.</p></div></div>
        ${comparison.length ? `<div class="comparison-list">${comparison.map(unit => `<article class="comparison-row">
          <div><strong>${safe(unit.unitName)}</strong><small>${number(unit.cohortCount)} athletes or clients</small></div>
          <div><strong>${unit.status === "suppressed" ? "Protected" : percent(unit.loggingCoverage)}</strong><small>Logging coverage</small></div>
          <div><strong>${unit.status === "suppressed" ? "Protected" : number(unit.attentionCount)}</strong><small>Needs attention</small></div>
          <span class="status-badge ${safe(unit.status)}">${safe(unit.status)}</span>
        </article>`).join("")}</div>` : empty("No comparable units", "No permitted unit has reportable data for this period.")}
      </section>
    </div>`;
  }

  function trainingSourceLabel(source) {
    if (source === "garmin") return "Garmin activity";
    if (source === "coach_schedule") return "Team schedule";
    return String(source || "Training").replace(/[_-]+/g, " ");
  }

  function workoutTitle(workout) {
    return String(workout.title || workout.type || "Training session")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function timingLabel(value, suffix) {
    return Number.isFinite(value) ? `${window.FuelGuardDomain.duration(value)} ${suffix}` : "Insufficient data";
  }

  function renderAthleteDetail() {
    const detail = state.athleteDetail;
    if (!detail) return;
    const domain = window.FuelGuardDomain;
    const athlete = detail.athlete || {};
    const workouts = domain.normalizeWorkouts(detail.workouts || [])
      .filter(workout => workout.endAt <= new Date());
    const contexts = domain.getWorkoutFuelContexts(workouts, detail.fuelEvents || []);
    const sessions = contexts.length ? contexts.slice(0, 6).map(context => {
      const workout = context.workout;
      const before = context.previousFuelEvent;
      const after = context.nextFuelEvent;
      return `<article class="training-context-row">
        <div class="training-context-head"><div><strong>${safe(workoutTitle(workout))}</strong><small>${safe(dateTime(workout.startAt))} · ${safe(trainingSourceLabel(workout.source))}</small></div></div>
        <div class="training-context-pair">
          <section><span>Pre-training fuel</span><strong>${before ? safe(timingLabel(context.preFuelGapMinutes, "before training")) : "No pre-training fuel recorded"}</strong><small>${before ? `Fuel logged ${safe(dateTime(before.date))}` : "No earlier fuel event is available in the shared period."}</small></section>
          <section><span>Post-training fuel</span><strong>${after ? safe(timingLabel(context.postFuelGapMinutes, "after training")) : "No post-training fuel recorded"}</strong><small>${after ? `Fuel logged ${safe(dateTime(after.date))}` : "No later fuel event is available in the shared period."}</small></section>
        </div>
      </article>`;
    }).join("") : empty("Insufficient training data", "No completed Garmin activity or team training session is available in the last 28 days.");
    const interventions = Array.isArray(detail.interventions) ? detail.interventions : [];
    const interventionRows = interventions.length ? interventions.map(intervention => `<article class="intervention-row">
      <div><strong>${safe(intervention.actionText)}</strong><small>${safe(intervention.observation || "Follow-up action")} · ${safe(intervention.responsibleStaffName || "Unassigned")}</small></div>
      <div><span class="status-badge ${safe(intervention.status)}">${safe(intervention.status)}</span><small>Review ${safe(intervention.reviewDate || "not scheduled")}</small></div>
      ${intervention.source === "performance" && intervention.status === "active" && hasCapability("manage_interventions") ? `<button class="text-button compact-button" type="button" data-review-intervention="${safe(intervention.id)}">Mark reviewed</button>` : ""}
    </article>`).join("") : empty("No intervention follow-ups", "Record a clear operational action and review date when follow-up is needed.");
    const people = Array.isArray(state.staff?.staff) ? state.staff.staff : [];
    const staffOptions = people.map(person => `<option value="${safe(person.userId)}"${person.userId === athlete.responsibleStaffId ? " selected" : ""}>${safe(person.displayName)}</option>`).join("");
    const reviewDate = dateInput(new Date(Date.now() + 28 * 86400000));
    $("athleteDetailTitle").textContent = athlete.name || "Athlete detail";
    $("athleteDetailContent").innerHTML = `
      <div class="athlete-detail-meta"><span>${safe(athlete.unitName || "Unassigned unit")}</span><span>Responsible: ${safe(athlete.responsibleStaffName || "Unassigned")}</span></div>
      <section class="detail-section"><div class="section-heading"><div><h3>Pre/Post Training Fuel</h3><p>Did this athlete fuel before training, and how quickly did they refuel afterward?</p></div></div><div class="training-context-list">${sessions}</div><p class="detail-note">Timing awareness only. Fuel Guard does not assess calories, nutritional adequacy or medical risk.</p></section>
      <section class="detail-section"><div class="section-heading"><div><h3>Intervention follow-up</h3><p>Organisation-scoped actions remain attributed and reviewable.</p></div></div><div class="intervention-list">${interventionRows}</div>
        ${hasCapability("manage_interventions") ? `<form id="performanceInterventionForm" class="management-form intervention-form">
          <h3>Record follow-up</h3>
          <label>Observation<input id="interventionObservationInput" maxlength="1000" placeholder="What needs operational follow-up?" /></label>
          <label>Action<input id="interventionActionInput" maxlength="1000" required placeholder="Agreed action" /></label>
          <label>Responsible staff<select id="interventionStaffPicker"><option value="">Unassigned</option>${staffOptions}</select></label>
          <label>Review date<input id="interventionReviewDateInput" type="date" value="${reviewDate}" /></label>
          <button class="secondary-button" type="submit">Record follow-up</button>
          <p id="interventionStatus" class="status-line" aria-live="polite"></p>
        </form>` : ""}
      </section>`;
    $("athleteDetailPanel").hidden = false;
    $("performanceInterventionForm")?.addEventListener("submit", createIntervention);
  }

  async function openAthleteDetail(athleteId) {
    $("athleteDetailContent").innerHTML = empty("Loading athlete detail", "Resolving permissioned training and fuelling context…");
    $("athleteDetailPanel").hidden = false;
    try {
      state.athleteDetail = await rpc("fuel_performance_athlete_detail", {
        p_organisation_id: state.organisationId,
        p_athlete_id: athleteId
      });
      renderAthleteDetail();
    } catch (error) {
      $("athleteDetailContent").innerHTML = empty("Athlete detail unavailable", friendlyError(error));
    }
  }

  async function createIntervention(event) {
    event.preventDefault();
    const athleteId = state.athleteDetail?.athlete?.id;
    try {
      await rpc("fuel_performance_create_intervention", {
        p_organisation_id: state.organisationId,
        p_athlete_id: athleteId,
        p_responsible_staff_user_id: $("interventionStaffPicker").value || null,
        p_observation: $("interventionObservationInput").value.trim(),
        p_action_text: $("interventionActionInput").value.trim(),
        p_review_date: $("interventionReviewDateInput").value
      });
      $("interventionStatus").textContent = "Follow-up recorded with an explicit review date.";
      await openAthleteDetail(athleteId);
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("interventionStatus").textContent = friendlyError(error); }
  }

  async function reviewIntervention(interventionId) {
    const athleteId = state.athleteDetail?.athlete?.id;
    try {
      await rpc("fuel_performance_update_intervention", {
        p_organisation_id: state.organisationId,
        p_intervention_id: interventionId,
        p_status: "reviewed",
        p_review_notes: "Reviewed in Fuel Guard Performance."
      });
      await openAthleteDetail(athleteId);
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { toast(friendlyError(error)); }
  }

  function syncUnitPickers() {
    const overview = $("overviewUnitPicker").value;
    const report = $("reportUnitPicker").value;
    $("overviewUnitPicker").innerHTML = unitOptions({ includeAll: true });
    $("reportUnitPicker").innerHTML = unitOptions({ includeAll: true });
    if (units().some(unit => unit.id === overview)) $("overviewUnitPicker").value = overview;
    if (units().some(unit => unit.id === report)) $("reportUnitPicker").value = report;
  }

  function renderAll() {
    renderOrganisationPicker();
    renderPathway();
    syncUnitPickers();
    renderOverview();
    renderStaff();
    renderReports();
    $("signedInIdentity").textContent = state.session?.user?.email ? `Signed in as ${state.session.user.email}` : "Signed in with Supabase";
    $("buildVersion").textContent = window.FUEL_GUARD_BUILD?.buildVersion || "Unknown";
  }

  async function loadOrganisation({ preserveStatus = false } = {}) {
    const context = currentContext();
    if (!context) return;
    state.busy = true;
    $("refreshButton").disabled = true;
    if (!preserveStatus) toast("Refreshing permissioned organisational data…");
    try {
      state.pathway = await rpc("fuel_performance_pathway", { p_organisation_id: state.organisationId });
      syncUnitPickers();
      const today = new Date();
      const reportTo = $("reportToInput").value || dateInput(today);
      const reportFrom = $("reportFromInput").value || dateInput(new Date(today.getTime() - 27 * 86400000));
      $("reportToInput").value = reportTo;
      $("reportFromInput").value = reportFrom;
      const overviewUnit = $("overviewUnitPicker").value || null;
      const reportUnit = $("reportUnitPicker").value || null;
      const requests = [
        rpc("fuel_performance_overview", { p_organisation_id: state.organisationId, p_unit_id: overviewUnit }),
        rpc("fuel_performance_reports", { p_organisation_id: state.organisationId, p_unit_id: reportUnit, p_from: reportFrom, p_to: reportTo })
      ];
      requests.push(hasCapability("view_staff_activity") || hasCapability("manage_staff_access")
        ? rpc("fuel_performance_staff_access", { p_organisation_id: state.organisationId })
        : Promise.resolve({ status: "unavailable", staff: [] }));
      requests.push(hasCapability("manage_staff_access") || hasCapability("view_athlete_detail")
        ? rpc("fuel_performance_athlete_shares", { p_organisation_id: state.organisationId })
        : Promise.resolve({ shares: [] }));
      requests.push(hasCapability("manage_staff_access")
        ? rpc("fuel_performance_staff_accounts", { p_organisation_id: state.organisationId })
        : Promise.resolve([]));
      const [overview, reports, staff, shareData, staffAccounts] = await Promise.all(requests);
      state.overview = overview;
      state.reports = reports;
      state.staff = staff;
      state.shares = Array.isArray(shareData?.shares) ? shareData.shares : [];
      state.staffAccounts = Object.fromEntries((Array.isArray(staffAccounts) ? staffAccounts : []).map(account => [account.user_id, account.email]));
      renderAll();
      toast("Performance data refreshed.");
    } catch (error) {
      toast(friendlyError(error));
      throw error;
    } finally {
      state.busy = false;
      $("refreshButton").disabled = false;
    }
  }

  async function resolveAccess() {
    if (state.recovering) {
      setPanelVisibility("recovery");
      return;
    }
    setPanelVisibility("loading");
    if (!state.session) {
      setPanelVisibility("auth");
      return;
    }
    try {
      const [contexts, platformAdmin] = await Promise.all([
        rpc("fuel_performance_context"),
        rpc("fuel_platform_admin_context").catch(() => ({ isPlatformAdmin: false, organisations: [] }))
      ]);
      state.contexts = contexts;
      state.platformAdmin = platformAdmin || { isPlatformAdmin: false, organisations: [] };
      if (!Array.isArray(state.contexts) || !state.contexts.length) {
        $("accessIdentity").textContent = state.session?.user?.email || "your Fuel Guard account";
        setPanelVisibility("access");
        return;
      }
      const saved = window.localStorage?.getItem(STORAGE_ORG) || "";
      state.organisationId = state.contexts.some(item => item.organisation_id === saved) ? saved : state.contexts[0].organisation_id;
      setPanelVisibility("app");
      renderOrganisationPicker();
      await loadOrganisation({ preserveStatus: true });
    } catch (error) {
      toast(friendlyError(error));
      $("accessIdentity").textContent = state.session?.user?.email || "your Fuel Guard account";
      setPanelVisibility("access");
    }
  }

  async function signIn() {
    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;
    if (!email || !password) {
      $("authStatus").textContent = "Enter your email and password.";
      return;
    }
    $("signInButton").disabled = true;
    $("authStatus").textContent = "Signing in…";
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    $("signInButton").disabled = false;
    if (error) $("authStatus").textContent = friendlyError(error);
  }

  async function createAccount() {
    const email = $("emailInput").value.trim();
    const password = $("passwordInput").value;
    if (!email || !password) {
      $("authStatus").textContent = "Enter your email and a password to create your Fuel Guard account.";
      return;
    }
    $("createAccountButton").disabled = true;
    $("authStatus").textContent = "Creating your Fuel Guard account…";
    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/performance/` }
    });
    $("createAccountButton").disabled = false;
    if (error) {
      $("authStatus").textContent = friendlyError(error);
      return;
    }
    $("authStatus").textContent = data?.session
      ? "Account created. Performance access is checked separately."
      : "Account created. Check your email to confirm it, then sign in here. Performance access is granted separately.";
  }

  async function forgotPassword() {
    const email = $("emailInput").value.trim();
    if (!email) {
      $("authStatus").textContent = "Enter your Fuel Guard account email first.";
      return;
    }
    $("forgotPasswordButton").disabled = true;
    $("authStatus").textContent = "Sending password reset email…";
    const { error } = await state.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/performance/`
    });
    $("forgotPasswordButton").disabled = false;
    $("authStatus").textContent = error
      ? friendlyError(error)
      : "If that Fuel Guard account exists, a password reset email has been sent.";
  }

  async function updatePassword() {
    const password = $("newPasswordInput").value;
    const confirmation = $("confirmPasswordInput").value;
    if (password.length < 8) {
      $("recoveryStatus").textContent = "Use at least 8 characters.";
      return;
    }
    if (password !== confirmation) {
      $("recoveryStatus").textContent = "The passwords do not match.";
      return;
    }
    $("updatePasswordButton").disabled = true;
    const { error } = await state.client.auth.updateUser({ password });
    $("updatePasswordButton").disabled = false;
    if (error) {
      $("recoveryStatus").textContent = friendlyError(error);
      return;
    }
    state.recovering = false;
    $("newPasswordInput").value = "";
    $("confirmPasswordInput").value = "";
    await resolveAccess();
  }

  async function createOrganisation() {
    const name = $("newOrganisationInput").value.trim();
    if (!name) {
      $("bootstrapStatus").textContent = "Enter an organisation name.";
      return;
    }
    $("createOrganisationButton").disabled = true;
    $("bootstrapStatus").textContent = "Creating the organisation workspace…";
    try {
      await rpc("fuel_performance_create_organisation", { p_name: name });
      $("newOrganisationInput").value = "";
      $("bootstrapStatus").textContent = "Organisation created. Resolving your scoped administrator access…";
      await resolveAccess();
    } catch (error) {
      $("bootstrapStatus").textContent = friendlyError(error);
    } finally {
      $("createOrganisationButton").disabled = false;
    }
  }

  async function signOut() {
    await state.client.auth.signOut();
    state.contexts = [];
    state.organisationId = "";
    state.staffAccounts = {};
    state.platformAdmin = { isPlatformAdmin: false, organisations: [] };
    state.recovering = false;
    state.tab = "overview";
    showTab("overview");
    setPanelVisibility("auth");
  }

  async function saveCapability(event) {
    event.preventDefault();
    try {
      await rpc("fuel_performance_set_capability", {
        p_organisation_id: state.organisationId,
        p_user_id: $("capabilityStaffPicker").value,
        p_capability: $("capabilityPicker").value,
        p_active: $("capabilityStatusPicker").value === "active"
      });
      $("accessStatus").textContent = "Capability saved. Access is recalculated immediately.";
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("accessStatus").textContent = friendlyError(error); }
  }

  async function saveMembership(event) {
    event.preventDefault();
    const email = $("membershipEmailInput").value.trim();
    const active = $("membershipStatusPicker").value === "active";
    if (!email) {
      $("accessStatus").textContent = "Enter the staff member’s Fuel Guard account email.";
      return;
    }
    try {
      const staffUserId = await rpc("fuel_performance_set_staff_membership_by_email", {
        p_organisation_id: state.organisationId,
        p_email: email,
        p_role: $("membershipRolePicker").value,
        p_active: active
      });
      $("membershipEmailInput").value = "";
      if (active) {
        try {
          await window.FuelGuardTransactionalEmail.sendInvitation({
            accessToken: state.session?.access_token,
            kind: "organisation_staff",
            entityId: staffUserId,
            contextId: state.organisationId
          });
          $("accessStatus").textContent = "Staff account added and email delivered. Now assign scope and only the capabilities they need; membership alone grants no athlete-data access.";
        } catch (emailError) {
          console.error("Organisation staff email delivery failed", { staffUserId, organisationId: state.organisationId, error: String(emailError?.message || emailError) });
          $("accessStatus").textContent = "Staff account added. Its email could not be delivered; now assign scope and only the capabilities they need.";
        }
      } else {
        $("accessStatus").textContent = "Staff membership revoked. Access is recalculated immediately.";
      }
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("accessStatus").textContent = friendlyError(error); }
  }

  async function saveScope(event) {
    event.preventDefault();
    const type = $("scopeTypePicker").value;
    try {
      await rpc("fuel_performance_set_scope", {
        p_organisation_id: state.organisationId,
        p_user_id: $("scopeStaffPicker").value,
        p_scope_type: type,
        p_unit_id: type === "unit" ? $("scopeUnitPicker").value : null,
        p_athlete_id: type === "athlete" ? $("scopeAthletePicker").value : null,
        p_include_descendants: type === "unit" && $("scopeDescendantsInput").checked,
        p_active: $("scopeStatusPicker").value === "active"
      });
      $("accessStatus").textContent = "Scope saved. Server-side visibility is updated immediately.";
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("accessStatus").textContent = friendlyError(error); }
  }

  async function inviteAthlete(event) {
    event.preventDefault();
    const athleteId = $("athleteInviteInput").value.trim();
    if (!UUID_RE.test(athleteId)) {
      $("accessStatus").textContent = "Enter a valid athlete account UUID.";
      return;
    }
    try {
      const shareId = await rpc("fuel_performance_invite_athlete", { p_organisation_id: state.organisationId, p_athlete_id: athleteId });
      $("athleteInviteInput").value = "";
      try {
        await window.FuelGuardTransactionalEmail.sendInvitation({
          accessToken: state.session?.access_token,
          kind: "organisation_athlete",
          entityId: shareId
        });
        $("accessStatus").textContent = "Sharing invitation created and email delivered. No athlete data is available until the athlete accepts.";
      } catch (emailError) {
        console.error("Organisation sharing email delivery failed", { shareId, error: String(emailError?.message || emailError) });
        $("accessStatus").textContent = "Sharing invitation created. Its email could not be delivered, but no athlete data is available until the athlete accepts.";
      }
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("accessStatus").textContent = friendlyError(error); }
  }

  async function saveAthleteUnit(event) {
    event.preventDefault();
    try {
      await rpc("fuel_performance_set_athlete_unit", {
        p_organisation_id: state.organisationId,
        p_athlete_id: $("athleteUnitAthletePicker").value,
        p_unit_id: $("athleteUnitPicker").value,
        p_active: $("athleteUnitStatusPicker").value === "active"
      });
      $("accessStatus").textContent = "Athlete/client unit assignment saved. Organisation sharing remains a separate requirement.";
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("accessStatus").textContent = friendlyError(error); }
  }

  async function saveUnit() {
    try {
      await rpc("fuel_performance_save_unit", {
        p_organisation_id: state.organisationId,
        p_unit_id: null,
        p_parent_unit_id: $("unitParentPicker").value || null,
        p_name: $("unitNameInput").value.trim(),
        p_unit_type: $("unitTypeInput").value.trim() || null,
        p_timezone_name: $("unitTimezoneInput").value.trim() || "UTC",
        p_display_order: units().length
      });
      $("unitNameInput").value = "";
      $("unitTypeInput").value = "";
      $("unitStatus").textContent = "Organisation unit added.";
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("unitStatus").textContent = friendlyError(error); }
  }

  async function createDemoStructure() {
    if (units().length) {
      $("unitStatus").textContent = "Demo structure is available only in an empty organisation, preventing duplicate or destructive changes.";
      return;
    }
    $("createDemoStructureButton").disabled = true;
    $("unitStatus").textContent = "Creating the demo group and location hierarchy…";
    try {
      await rpc("fuel_performance_create_demo_structure", {
        p_organisation_id: state.organisationId
      });
      $("unitStatus").textContent = "Demo hierarchy created. Add staff, then assign explicit scope and capability grants.";
      await loadOrganisation({ preserveStatus: true });
    } catch (error) {
      $("unitStatus").textContent = friendlyError(error);
    } finally {
      $("createDemoStructureButton").disabled = false;
    }
  }

  async function saveReportingMinimum(event) {
    event.preventDefault();
    const minimum = Number($("reportingMinimumInput").value);
    try {
      await rpc("fuel_performance_set_reporting_minimum", { p_organisation_id: state.organisationId, p_minimum: minimum });
      currentContext().minimum_reporting_cohort = minimum;
      $("settingsStatus").textContent = `Reporting minimum set to ${minimum}. All aggregates will be recalculated with this threshold.`;
      await loadOrganisation({ preserveStatus: true });
    } catch (error) { $("settingsStatus").textContent = friendlyError(error); }
  }

  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll("[data-performance-tab]").forEach(button => button.classList.toggle("active", button.dataset.performanceTab === tab));
    document.querySelectorAll(".performance-panel").forEach(panel => panel.classList.toggle("active", panel.id === `${tab}Panel`));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateScopeFields() {
    const type = $("scopeTypePicker").value;
    $("scopeUnitLabel").hidden = type !== "unit";
    $("scopeDescendantsLabel").hidden = type !== "unit";
    $("scopeAthleteLabel").hidden = type !== "athlete";
  }

  function bind() {
    $("signInButton").addEventListener("click", signIn);
    $("createAccountButton").addEventListener("click", createAccount);
    $("forgotPasswordButton").addEventListener("click", forgotPassword);
    $("updatePasswordButton").addEventListener("click", updatePassword);
    $("cancelRecoveryButton").addEventListener("click", () => {
      state.recovering = false;
      setPanelVisibility(state.session ? "access" : "auth");
    });
    $("passwordInput").addEventListener("keydown", event => { if (event.key === "Enter") signIn(); });
    $("accessSignOutButton").addEventListener("click", signOut);
    $("signOutButton").addEventListener("click", signOut);
    $("retryAccessButton").addEventListener("click", resolveAccess);
    $("createOrganisationButton").addEventListener("click", createOrganisation);
    $("refreshButton").addEventListener("click", () => loadOrganisation());
    $("organisationPicker").addEventListener("change", async event => {
      resetOrganisationData();
      state.organisationId = event.target.value;
      window.localStorage?.setItem(STORAGE_ORG, state.organisationId);
      $("overviewUnitPicker").value = "";
      $("reportUnitPicker").value = "";
      $("overviewContent").innerHTML = empty("Switching organisation", "Resolving the newly selected organisation and clearing the previous context…");
      await loadOrganisation();
    });
    document.addEventListener("click", event => {
      const athleteButton = event.target.closest("[data-athlete-detail]");
      if (athleteButton) openAthleteDetail(athleteButton.dataset.athleteDetail);
      const reviewButton = event.target.closest("[data-review-intervention]");
      if (reviewButton) reviewIntervention(reviewButton.dataset.reviewIntervention);
    });
    $("closeAthleteDetailButton").addEventListener("click", () => {
      state.athleteDetail = null;
      $("athleteDetailPanel").hidden = true;
    });
    document.querySelectorAll("[data-performance-tab]").forEach(button => button.addEventListener("click", () => showTab(button.dataset.performanceTab)));
    $("overviewUnitPicker").addEventListener("change", () => loadOrganisation());
    $("reportFilters").addEventListener("submit", event => { event.preventDefault(); loadOrganisation(); });
    $("capabilityForm").addEventListener("submit", saveCapability);
    $("membershipForm").addEventListener("submit", saveMembership);
    $("scopeForm").addEventListener("submit", saveScope);
    $("scopeTypePicker").addEventListener("change", updateScopeFields);
    $("athleteInviteForm").addEventListener("submit", inviteAthlete);
    $("athleteUnitForm").addEventListener("submit", saveAthleteUnit);
    $("saveUnitButton").addEventListener("click", saveUnit);
    $("createDemoStructureButton").addEventListener("click", createDemoStructure);
    $("reportingMinimumForm").addEventListener("submit", saveReportingMinimum);
  }

  async function init() {
    bind();
    updateScopeFields();
    const today = new Date();
    $("reportToInput").value = dateInput(today);
    $("reportFromInput").value = dateInput(new Date(today.getTime() - 27 * 86400000));
    const config = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey || !window.supabase?.createClient) {
      setPanelVisibility("auth");
      $("authStatus").textContent = "Performance needs the public Supabase URL and publishable key configuration.";
      $("signInButton").disabled = true;
      return;
    }
    state.client = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
    const { data } = await state.client.auth.getSession();
    state.session = data?.session || null;
    state.client.auth.onAuthStateChange((event, session) => {
      const changed = state.session?.user?.id !== session?.user?.id;
      state.session = session;
      if (event === "PASSWORD_RECOVERY") {
        state.recovering = true;
        setPanelVisibility("recovery");
        return;
      }
      if (event === "SIGNED_OUT") state.recovering = false;
      if (changed) window.setTimeout(resolveAccess, 0);
    });
    await resolveAccess();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
