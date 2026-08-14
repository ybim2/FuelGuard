// Athlete retention loop: evidence-aware weekly recap, contextual prompts and Coach review acknowledgement.
(() => {
  const PREFERENCES_TABLE = "fuel_athlete_nudge_preferences";
  const REVIEW_FEED_RPC = "fuel_athlete_coach_review_feed";
  let preferencesLoadedFor = "";
  let reviewFeedLoadedFor = "";
  let reviewFeed = [];
  let reviewFeedStatus = "";
  let syncingPreferences = false;

  function domain() {
    return window.FuelGuardDomain;
  }

  function escape(value) {
    return domain()?.escapeHtml?.(value) || String(value ?? "");
  }

  function gapState() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    if (!gap) return null;
    if (!gap.nudgePreferences || typeof gap.nudgePreferences !== "object" || Array.isArray(gap.nudgePreferences)) {
      gap.nudgePreferences = {
        maximumGap: true,
        postTraining: true,
        trainingMode: true,
        dismissedKeys: []
      };
    }
    if (!Array.isArray(gap.nudgePreferences.dismissedKeys)) gap.nudgePreferences.dismissedKeys = [];
    return gap;
  }

  function preferences() {
    const stored = gapState()?.nudgePreferences || {};
    return {
      maximumGap: stored.maximumGap !== false,
      postTraining: stored.postTraining !== false,
      trainingMode: stored.trainingMode !== false,
      dismissedKeys: stored.dismissedKeys || []
    };
  }

  function trainingSessions() {
    const training = gapState()?.trainingMode;
    return Array.isArray(training?.sessions) ? training.sessions : [];
  }

  function sharedTeamSessions() {
    return Array.isArray(window.fuelGuardCloud?.teamSessions) ? window.fuelGuardCloud.teamSessions : [];
  }

  function recapData() {
    const gap = gapState() || {};
    return domain().athleteWeeklyRecap({
      logs: gap.logs || [],
      sessions: trainingSessions(),
      targets: { ...(gap.targets || {}), maximumFuelGapMinutes: gap.maximumFuelGapMinutes },
      now: new Date(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    });
  }

  function renderWeeklyRecap() {
    const card = document.getElementById("athleteWeeklyRecapCard");
    const target = document.getElementById("athleteWeeklyRecap");
    if (!card || !target || !domain()) return;
    const signedIn = Boolean(window.fuelGuardCloud?.user?.id);
    card.hidden = !signedIn;
    if (!signedIn) return;
    const recap = recapData();
    const metrics = [
      ["Logging coverage", `${recap.coverage.loggedDays} of ${recap.coverage.totalDays} days`],
      ["Best logging streak", `${recap.loggingStreak} day${recap.loggingStreak === 1 ? "" : "s"}`],
      ["Fuel moments", recap.fuelMoments],
      ["Hydration moments", recap.hydrationMoments],
      ["Training sessions", recap.trainingSessions],
      ["With recorded activity", `${recap.trainingSessionsWithRecordedActivity} of ${recap.trainingSessions}`]
    ];
    const gapMetrics = [
      Number.isFinite(recap.longestObservedGapMinutes) ? ["Longest observed gap", domain().duration(recap.longestObservedGapMinutes)] : null,
      Number.isFinite(recap.averageObservedGapMinutes) ? ["Average observed gap", domain().duration(recap.averageObservedGapMinutes)] : null
    ].filter(Boolean);
    target.innerHTML = `
      <div class="beta-weekly-recap-heading"><div><span>Previous completed week</span><h2>Your week</h2><p>${escape(recap.period.display)}</p></div><b>${recap.coverage.loggedPct}% recorded coverage</b></div>
      <div class="beta-weekly-recap-grid">${metrics.map(([label, value]) => `<article><span>${escape(label)}</span><strong>${escape(value)}</strong></article>`).join("")}</div>
      ${gapMetrics.length || recap.commonLongGapWindow ? `<section class="beta-weekly-recap-pattern"><h3>Recorded pattern</h3><div>${gapMetrics.map(([label, value]) => `<span><small>${escape(label)}</small><strong>${escape(value)}</strong></span>`).join("")}${recap.commonLongGapWindow ? `<span><small>Most common long-gap window</small><strong>${escape(recap.commonLongGapWindow.replace("-", "–"))}</strong></span>` : ""}</div></section>` : `<p class="beta-weekly-recap-limited">Insufficient recorded Fuel intervals to calculate a reliable weekly gap pattern.</p>`}
      <section class="beta-weekly-recap-progress"><h3>Progress</h3><p>${escape(recap.comparison.available ? recap.comparison.label : `Not enough comparable data for a previous-week trend yet. ${recap.comparison.daysRemaining} more day${recap.comparison.daysRemaining === 1 ? "" : "s"} of data needed.`)}</p>${recap.improvements.length ? `<ul>${recap.improvements.map(item => `<li>${escape(item)}</li>`).join("")}</ul>` : ""}</section>
      <section class="beta-weekly-recap-focus"><h3>Useful next focus</h3><ul>${recap.areas.map(item => `<li>${escape(item)}</li>`).join("")}</ul></section>
      <p class="row-note">${escape(recap.evidenceNote)}</p>
    `;
  }

  function eligibleNudges() {
    const gap = gapState() || {};
    const currentPreferences = preferences();
    const contextual = domain().athleteNudgeEligibility({
      logs: gap.logs || [],
      sessions: trainingSessions(),
      teamSessions: sharedTeamSessions(),
      targets: { ...(gap.targets || {}), maximumFuelGapMinutes: gap.maximumFuelGapMinutes },
      preferences: currentPreferences,
      now: new Date(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    });
    const everydayReflection = window.FuelGuardEverydayReflection?.reviewPrompt?.();
    const performanceReflection = window.AthleteImpact?.reviewPrompt?.();
    const supplementReminder = window.FuelGuardSupplementRhythm?.reminderPrompt?.();
    return [supplementReminder, everydayReflection, performanceReflection, ...contextual].filter(item => item && !currentPreferences.dismissedKeys.includes(item.occurrenceKey));
  }

  function renderContextualNudge() {
    const target = document.getElementById("athleteContextualNudge");
    if (!target || !domain()) return;
    const item = eligibleNudges()[0];
    target.hidden = !item;
    if (!item) {
      target.innerHTML = "";
      return;
    }
    target.innerHTML = `<div><span>Useful now</span><strong>${escape(item.title)}</strong><small>${escape(item.detail)}</small>${String(item.id || "").includes("reflection_review") ? `<button type="button" class="beta-contextual-nudge-open" data-open-screen="impact">Open Reflection</button>` : item.id === "supplement_reminder" ? `<button type="button" class="beta-contextual-nudge-open" data-open-supplement-settings>Open Supplement Rhythm</button>` : ""}</div><button type="button" data-dismiss-athlete-nudge="${escape(item.occurrenceKey)}" aria-label="Dismiss this contextual prompt">×</button>`;
  }

  function renderPreferences() {
    const card = document.getElementById("athleteNudgePreferencesCard");
    const target = document.getElementById("athleteNudgePreferences");
    const status = document.getElementById("athleteNudgePreferencesStatus");
    if (!card || !target) return;
    const signedIn = Boolean(window.fuelGuardCloud?.user?.id);
    card.hidden = !signedIn;
    if (!signedIn) return;
    const value = preferences();
    const rows = [
      ["maximumGap", "Maximum Fuel Gap", "Show a prompt only when your recorded gap is approaching or beyond your Daily target."],
      ["postTraining", "Post-training", "Show a prompt after a completed session when no later Fuel has been recorded."],
      ["trainingMode", "Training Mode windows", "Show a prompt when a configured Training Mode Fuel interval is approaching."]
    ];
    target.innerHTML = rows.map(([key, label, detail]) => `<label><span><strong>${escape(label)}</strong><small>${escape(detail)}</small></span><input type="checkbox" data-athlete-nudge-preference="${key}" ${value[key] ? "checked" : ""}></label>`).join("");
    if (status) status.textContent = syncingPreferences
      ? "Saving reminder preferences…"
      : "Contextual in-app eligibility is active. System push notifications are not enabled in this beta.";
  }

  async function loadPreferences() {
    const cloud = window.fuelGuardCloud;
    const user = cloud?.user;
    if (!cloud?.client || !user?.id || preferencesLoadedFor === user.id) return;
    const { data, error } = await cloud.client.from(PREFERENCES_TABLE)
      .select("maximum_gap_enabled,post_training_enabled,training_mode_enabled")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) {
      if (!/does not exist|schema cache/i.test(error.message || "")) throw error;
      return;
    }
    const stored = gapState()?.nudgePreferences;
    if (data && stored) {
      stored.maximumGap = data.maximum_gap_enabled !== false;
      stored.postTraining = data.post_training_enabled !== false;
      stored.trainingMode = data.training_mode_enabled !== false;
      if (typeof save === "function") save();
    }
    preferencesLoadedFor = user.id;
    renderAllRetention();
  }

  async function savePreferences() {
    const cloud = window.fuelGuardCloud;
    const user = cloud?.user;
    if (!cloud?.client || !user?.id || syncingPreferences) return;
    syncingPreferences = true;
    renderPreferences();
    try {
      const value = preferences();
      const { error } = await cloud.client.from(PREFERENCES_TABLE).upsert({
        user_id: user.id,
        maximum_gap_enabled: value.maximumGap,
        post_training_enabled: value.postTraining,
        training_mode_enabled: value.trainingMode,
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id" });
      if (error) throw error;
      preferencesLoadedFor = user.id;
    } finally {
      syncingPreferences = false;
      renderPreferences();
    }
  }

  function renderCoachReviewFeed() {
    const target = document.getElementById("athleteCoachReviewFeed");
    if (!target) return;
    if (reviewFeedStatus) {
      target.innerHTML = `<p class="muted">${escape(reviewFeedStatus)}</p>`;
      return;
    }
    target.innerHTML = reviewFeed.length ? reviewFeed.map(item => `
      <article class="beta-coach-review-item">
        <span>Your coach reviewed your week</span>
        <strong>${escape(item.coachName || "Your Fuel Guard coach")}</strong>
        <small>${escape(item.weekStart)}–${escape(item.weekEnd)} · completed ${escape(item.completedAt ? new Date(item.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "")}</small>
        ${item.visibleFeedback ? `<blockquote><span>Athlete-visible feedback</span><p>${escape(item.visibleFeedback)}</p></blockquote>` : `<p class="muted">No athlete-visible feedback was shared with this review.</p>`}
      </article>
    `).join("") : `<p class="muted">No completed weekly Coach review is available for your active Coach relationships yet.</p>`;
  }

  async function loadCoachReviewFeed() {
    const cloud = window.fuelGuardCloud;
    const user = cloud?.user;
    if (!cloud?.client || !user?.id || reviewFeedLoadedFor === user.id) return;
    reviewFeedStatus = "Loading completed Coach reviews…";
    renderCoachReviewFeed();
    const { data, error } = await cloud.client.rpc(REVIEW_FEED_RPC, { p_limit: 8 });
    if (error) {
      reviewFeed = [];
      reviewFeedStatus = /does not exist|schema cache/i.test(error.message || "") ? "Coach review acknowledgement is waiting for the retention migration." : "Completed Coach reviews could not be loaded.";
    } else {
      reviewFeed = Array.isArray(data?.items) ? data.items : [];
      reviewFeedStatus = "";
      reviewFeedLoadedFor = user.id;
    }
    renderCoachReviewFeed();
  }

  function renderAllRetention() {
    if (!domain()) return;
    renderWeeklyRecap();
    renderContextualNudge();
    renderPreferences();
    renderCoachReviewFeed();
  }

  document.addEventListener("change", event => {
    const input = event.target.closest("[data-athlete-nudge-preference]");
    if (!input) return;
    const stored = gapState()?.nudgePreferences;
    if (!stored) return;
    stored[input.dataset.athleteNudgePreference] = input.checked;
    if (typeof save === "function") save();
    renderAllRetention();
    savePreferences().catch(() => {
      const status = document.getElementById("athleteNudgePreferencesStatus");
      if (status) status.textContent = "Saved on this device; cloud preference sync needs attention.";
    });
  });

  document.addEventListener("click", event => {
    const dismiss = event.target.closest("[data-dismiss-athlete-nudge]");
    if (!dismiss) return;
    const stored = gapState()?.nudgePreferences;
    if (!stored) return;
    stored.dismissedKeys = [...new Set([...(stored.dismissedKeys || []), dismiss.dataset.dismissAthleteNudge])].slice(-30);
    if (typeof save === "function") save();
    renderContextualNudge();
  });

  window.addEventListener("fuelguard:cloud-status", () => {
    const userId = window.fuelGuardCloud?.user?.id || "";
    if (!userId) {
      preferencesLoadedFor = "";
      reviewFeedLoadedFor = "";
      reviewFeed = [];
      reviewFeedStatus = "";
    }
    renderAllRetention();
    loadPreferences().catch(() => {});
    loadCoachReviewFeed().catch(() => {});
  });
  window.addEventListener("online", () => {
    preferencesLoadedFor = "";
    reviewFeedLoadedFor = "";
    loadPreferences().catch(() => {});
    loadCoachReviewFeed().catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      renderAllRetention();
      loadPreferences().catch(() => {});
      loadCoachReviewFeed().catch(() => {});
    }
  });
  document.addEventListener("DOMContentLoaded", renderAllRetention);
  requestAnimationFrame(renderAllRetention);

  window.FuelGuardAthleteRetention = {
    render: renderAllRetention,
    loadPreferences,
    loadCoachReviewFeed,
    _test: { recapData, eligibleNudges, preferences }
  };
})();
