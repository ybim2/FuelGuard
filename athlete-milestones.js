// Restrained Athlete milestone recognition derived from trustworthy log history.
(() => {
  const TABLE = "fuel_milestone_achievements";
  let syncing = false;
  let pointsSyncing = false;
  let pointsProfile = null;
  let toastTimer = 0;

  function domain() {
    return window.FuelGuardDomain;
  }

  function milestoneState() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : null;
    if (!gap) return null;
    if (!gap.milestones || typeof gap.milestones !== "object" || Array.isArray(gap.milestones)) {
      gap.milestones = { lastSummary: null, achievements: [], syncedAt: "" };
    }
    if (!Array.isArray(gap.milestones.achievements)) gap.milestones.achievements = [];
    return gap.milestones;
  }

  function summary() {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : { logs: [] };
    return domain()?.activityMilestoneSummary?.({
      logs: gap.logs || [],
      trainingSessions: gap.trainingMode?.sessions || [],
      readyChecks: gap.fuelKit?.checks || [],
      now: new Date()
    }) || { dayStreak: 0, fuelMoments: 0, hydrationMoments: 0, sleepyMoments: 0, readyMoments: 0, trainingMoments: 0 };
  }

  function canonicalHistoryReady() {
    const readiness = window.fuelGuardCloud?.historyReadiness?.();
    return !readiness || readiness.ready !== false;
  }

  function renderHistoryPending() {
    const target = document.getElementById("athleteMilestones");
    if (!target) return;
    target.innerHTML = `<div class="beta-streak-history-pending" role="status"><span>Checking full history…</span><p>Your cumulative Fuel Guard milestones will appear after canonical history has loaded.</p></div>`;
  }

  function localAchievement(milestone, achievedAt = new Date().toISOString(), acknowledgedAt = null) {
    return {
      key: milestone.key,
      category: milestone.category,
      threshold: milestone.threshold,
      achievedAt,
      acknowledgedAt
    };
  }

  function mergeAchievements(existing = [], incoming = []) {
    const merged = new Map();
    [...existing, ...incoming].forEach(item => {
      if (!item) return;
      const category = String(item.category || "");
      const threshold = Number(item.threshold || 0);
      const key = item.key || domain()?.milestoneKey?.(category, threshold);
      if (!key || !threshold) return;
      const current = merged.get(key);
      const next = {
        key,
        category,
        threshold,
        achievedAt: current?.achievedAt || item.achievedAt || item.achieved_at || new Date().toISOString(),
        acknowledgedAt: item.acknowledgedAt || item.acknowledged_at || current?.acknowledgedAt || null
      };
      merged.set(key, next);
    });
    return [...merged.values()].sort((a, b) => new Date(a.achievedAt) - new Date(b.achievedAt));
  }

  const STREAK_MILESTONE_DAYS = Object.freeze([3, 7, 14, 30, 60, 100]);

  function streakMilestoneProgress(value) {
    const current = Math.max(0, Number(value) || 0);
    const next = STREAK_MILESTONE_DAYS.find(threshold => threshold > current) || null;
    return STREAK_MILESTONE_DAYS.map(threshold => ({
      threshold,
      state: current >= threshold ? "unlocked" : threshold === next ? "next" : "locked"
    }));
  }

  function cumulativeMilestoneProgress(category, value) {
    const current = Math.max(0, Number(value) || 0);
    const thresholds = domain()?.MILESTONE_THRESHOLDS?.[category] || [];
    const latest = [...thresholds].reverse().find(threshold => current >= threshold) || 0;
    const next = thresholds.find(threshold => threshold > current) || null;
    const span = next ? Math.max(1, next - latest) : 1;
    return {
      current,
      latest,
      next,
      remaining: next ? Math.max(0, next - current) : 0,
      progress: next ? Math.min(100, Math.max(0, Math.round((current - latest) / span * 100))) : 100
    };
  }

  function renderHistory(currentSummary = summary()) {
    const target = document.getElementById("athleteMilestones");
    if (!target || !domain()) return;
    const categories = [
      { id: "fuel", label: "Fuel moments", icon: "F", value: Number(currentSummary.fuelMoments || 0), detail: "Valid Fuel logs" },
      { id: "hydration", label: "Hydration moments", icon: "H", value: Number(currentSummary.hydrationMoments || 0), detail: "Valid Hydration logs" },
      { id: "sleepy", label: "Sleepy moments", icon: "S", value: Number(currentSummary.sleepyMoments || 0), detail: "Recorded Sleepy check-ins" },
      { id: "ready", label: "Ready for the Day", icon: "R", value: Number(currentSummary.readyMoments || 0), detail: "Prepared Ready Checks" },
      { id: "training", label: "Training moments", icon: "T", value: Number(currentSummary.trainingMoments || 0), detail: "Completed sessions" }
    ].map(category => ({ ...category, progress: cumulativeMilestoneProgress(category.id, category.value) }));
    target.innerHTML = `
      <div class="beta-milestone-carousel" role="list" tabindex="0" aria-label="Fuel Guard milestones; swipe horizontally to browse">
        ${categories.map(category => `<article class="beta-cumulative-milestone ${category.id}" role="listitem">
          <header><span aria-hidden="true">${category.icon}</span><div><small>${domain().escapeHtml(category.detail)}</small><h4>${domain().escapeHtml(category.label)}</h4></div></header>
          <strong class="beta-cumulative-total">${category.value.toLocaleString("en-GB")}</strong>
          <div class="beta-cumulative-status">
            <span><small>Milestone achieved</small><b>${category.progress.latest ? category.progress.latest.toLocaleString("en-GB") : "Starting"}</b></span>
            <span><small>Next</small><b>${category.progress.next ? category.progress.next.toLocaleString("en-GB") : "Complete"}</b></span>
          </div>
          <div class="beta-cumulative-progress" role="progressbar" aria-label="${domain().escapeHtml(category.label)} progress" aria-valuemin="${category.progress.latest}" aria-valuemax="${category.progress.next || category.progress.current}" aria-valuenow="${category.progress.current}"><i style="width:${category.progress.progress}%"></i></div>
          <p>${category.progress.next ? `${category.progress.remaining.toLocaleString("en-GB")} to go` : "All current milestones reached"}</p>
        </article>`).join("")}
      </div>
    `;
  }

  function localPoints(currentSummary = summary()) {
    const progress = domain()?.athletePointProgress?.(currentSummary) || { earnedPoints: 0, milestones: [], nextMilestone: null };
    return {
      totalPoints: progress.earnedPoints,
      athletePoints: progress.earnedPoints,
      coachPoints: 0,
      currentStreak: Number(currentSummary.dayStreak || 0),
      fuelMoments: Number(currentSummary.fuelMoments || 0),
      hydrationMoments: Number(currentSummary.hydrationMoments || 0),
      milestones: progress.milestones.map(item => ({
        eventType: item.eventType,
        roleContext: "athlete",
        threshold: item.threshold,
        points: item.points,
        title: item.title,
        currentValue: item.currentValue,
        earnedAt: item.earned ? "local" : null
      })),
      roles: ["athlete"],
      recentAwards: []
    };
  }

  function renderPoints(currentSummary = summary()) {
    if (!domain()) return;
    const cloud = window.fuelGuardCloud;
    const signedIn = Boolean(cloud?.client && cloud.user?.id);
    const data = pointsProfile || localPoints(currentSummary);
    const milestones = Array.isArray(data.milestones) ? data.milestones : [];
    const next = milestones
      .filter(item => !item.earnedAt && Number(item.threshold) > Number(item.currentValue || 0))
      .sort((a, b) => (Number(a.threshold) - Number(a.currentValue || 0)) - (Number(b.threshold) - Number(b.currentValue || 0)))[0] || null;
    const daily = document.getElementById("athleteDailyPoints");
    if (daily) {
      const progress = next ? Math.min(100, Math.round(Number(next.currentValue || 0) / Number(next.threshold || 1) * 100)) : 100;
      daily.innerHTML = `
        <div><span>FG Points</span><strong>${Number(data.athletePoints || 0).toLocaleString("en-GB")}</strong></div>
        <div><span>Current streak</span><strong>${Number(data.currentStreak || 0)} day${Number(data.currentStreak || 0) === 1 ? "" : "s"}</strong></div>
        <div class="beta-points-next"><span>${next ? `Next · ${domain().escapeHtml(next.title)} · +${Number(next.points || 0)}` : "All current milestones reached"}</span><strong>${next ? `${Number(next.currentValue || 0)} / ${Number(next.threshold || 0)}` : "✓"}</strong><i><b style="width:${progress}%"></b></i></div>
      `;
    }
    const profile = document.getElementById("athletePointsProfile");
    if (profile) {
      const unlocked = milestones.filter(item => item.earnedAt).length;
      const levels = domain().athletePointLevelProgress(Number(data.totalPoints || 0));
      profile.innerHTML = `
        <section class="beta-points-level" aria-label="Fuel Guard points progression">
          <div class="beta-points-level-heading"><div><span>Fuel Guard Progress</span><strong>${domain().escapeHtml(levels.current.title)}</strong></div><b>${levels.next ? `${Number(levels.remaining).toLocaleString("en-GB")} points to ${domain().escapeHtml(levels.next.title)}` : "All current levels reached"}</b></div>
          <i><b style="width:${levels.progressPct}%"></b></i>
          <div class="beta-points-level-ladder">${levels.levels.map(level => `<span class="${level.achieved ? "achieved" : "upcoming"}"><b>${level.achieved ? "✓" : "○"} ${domain().escapeHtml(level.title)}</b><small>${Number(level.threshold).toLocaleString("en-GB")} points</small></span>`).join("")}</div>
        </section>
        <section class="beta-points-profile-summary">
          <div><span>Total FG Points</span><strong>${Number(data.totalPoints || 0).toLocaleString("en-GB")}</strong></div>
          <div><span>Current streak</span><strong>${Number(data.currentStreak || 0)} day${Number(data.currentStreak || 0) === 1 ? "" : "s"}</strong></div>
          <div><span>Milestones unlocked</span><strong>${unlocked}</strong></div>
          <div><span>Fuel moments</span><strong>${Number(data.fuelMoments || 0).toLocaleString("en-GB")}</strong></div>
          <div><span>Hydration moments</span><strong>${Number((data.hydrationMoments ?? currentSummary.hydrationMoments) || 0).toLocaleString("en-GB")}</strong></div>
          <div><span>Roles</span><strong>${(data.roles || ["athlete"]).map(role => domain().escapeHtml(role)).join(" · ")}</strong></div>
        </section>
        <div class="beta-points-milestone-grid">
          ${milestones.map(item => `<article class="${item.earnedAt ? "earned" : "locked"}">
            <span>${item.earnedAt ? "Unlocked" : `${Number(item.currentValue || 0)} / ${Number(item.threshold || 0)}`}</span>
            <strong>${domain().escapeHtml(item.title || item.eventType)}</strong>
            <small>+${Number(item.points || 0)} points</small>
          </article>`).join("")}
        </div>
        <p class="row-note">${signedIn ? "Points are awarded once from verified Fuel Guard records." : "Sign in to store point awards across devices."} Rewards are coming soon.</p>
      `;
    }
  }

  function acknowledgeLocal(key) {
    const state = milestoneState();
    const achievement = state?.achievements.find(item => item.key === key);
    if (!achievement || achievement.acknowledgedAt) return;
    achievement.acknowledgedAt = new Date().toISOString();
    if (typeof save === "function") save();
  }

  async function acknowledgeCloud(achievement) {
    const cloud = window.fuelGuardCloud;
    if (!cloud?.client || !cloud.user?.id || !achievement?.acknowledgedAt) return;
    await cloud.client.from(TABLE)
      .update({ acknowledged_at: achievement.acknowledgedAt })
      .eq("user_id", cloud.user.id)
      .eq("category", achievement.category)
      .eq("threshold", achievement.threshold);
  }

  function showToast(achievement) {
    const target = document.getElementById("athleteMilestoneToast");
    if (!target || !achievement || !domain()) return;
    const label = domain().milestoneLabel(achievement.category, achievement.threshold);
    const icon = { streak: "D", fuel: "F", hydration: "H", sleepy: "S", ready: "R", training: "T", work: "W" }[achievement.category] || "•";
    target.innerHTML = `<b aria-hidden="true">${icon}</b><span><strong>${domain().escapeHtml(label)}</strong><small>Milestone reached</small></span>`;
    target.removeAttribute("inert");
    target.hidden = false;
    acknowledgeLocal(achievement.key);
    const updated = milestoneState()?.achievements.find(item => item.key === achievement.key);
    acknowledgeCloud(updated).catch(() => {});
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      target.hidden = true;
      target.setAttribute("inert", "");
    }, 5000);
  }

  function evaluate({ allowToast = true } = {}) {
    const state = milestoneState();
    if (!state || !domain()) return [];
    if (!canonicalHistoryReady()) {
      renderHistoryPending();
      return [];
    }
    const current = summary();
    const acknowledged = state.achievements.filter(item => item.acknowledgedAt).map(item => item.key);
    const crossed = domain().newlyCrossedMilestones(state.lastSummary, current, acknowledged);
    const baseline = !state.lastSummary;
    const achievedAt = new Date().toISOString();
    const earned = domain().earnedMilestones(current).map(item => localAchievement(
      item,
      achievedAt,
      baseline ? achievedAt : null
    ));
    state.achievements = mergeAchievements(state.achievements, earned);
    state.lastSummary = current;
    if (typeof save === "function") save();
    renderHistory(current);
    renderPoints(current);
    if (allowToast && crossed.length) {
      const next = state.achievements.find(item => item.key === crossed[crossed.length - 1].key);
      if (next && !next.acknowledgedAt) showToast(next);
    }
    return crossed;
  }

  async function syncCloud() {
    if (syncing || !domain()) return;
    const cloud = window.fuelGuardCloud;
    if (!cloud?.client || !cloud.user?.id || !canonicalHistoryReady()) return;
    syncing = true;
    try {
      const state = milestoneState();
      const current = summary();
      const earnedKeys = new Set(domain().earnedMilestones(current).map(item => item.key));
      const { data, error } = await cloud.client.from(TABLE)
        .select("category,threshold,achieved_at,acknowledged_at")
        .eq("user_id", cloud.user.id)
        .order("achieved_at", { ascending: true });
      if (error) throw error;
      state.achievements = mergeAchievements(state.achievements, data || []);
      const earnedRows = state.achievements.filter(item => earnedKeys.has(item.key)).map(item => ({
        user_id: cloud.user.id,
        category: item.category,
        threshold: item.threshold,
        achieved_at: item.achievedAt,
        acknowledged_at: item.acknowledgedAt
      }));
      if (earnedRows.length) {
        const upsert = await cloud.client.from(TABLE).upsert(earnedRows, { onConflict: "user_id,category,threshold" });
        if (upsert.error) throw upsert.error;
      }
      state.syncedAt = new Date().toISOString();
      if (typeof save === "function") save();
      renderHistory(current);
      const unacknowledged = state.achievements.find(item => earnedKeys.has(item.key) && !item.acknowledgedAt);
      if (unacknowledged) showToast(unacknowledged);
      await syncPoints();
    } catch {
      // Local acknowledgement remains authoritative until the next safe sync.
    } finally {
      syncing = false;
    }
  }

  async function syncPoints() {
    if (pointsSyncing) return;
    const cloud = window.fuelGuardCloud;
    if (!cloud?.client || !cloud.user?.id) {
      pointsProfile = null;
      renderPoints();
      return;
    }
    pointsSyncing = true;
    try {
      const { data, error } = await cloud.client.rpc("fuel_points_profile", {
        p_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
      });
      if (error) throw error;
      pointsProfile = data || null;
    } catch {
      // Keep the locally derived preview if the additive migration is not ready.
    } finally {
      pointsSyncing = false;
      renderPoints();
    }
  }

  window.addEventListener("fuelguard:cloud-status", () => {
    evaluate({ allowToast: true });
    syncCloud();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      evaluate({ allowToast: true });
      syncCloud();
    }
  });
  document.addEventListener("DOMContentLoaded", () => evaluate({ allowToast: false }));
  requestAnimationFrame(() => evaluate({ allowToast: false }));

  window.FuelGuardMilestones = {
    evaluate,
    syncCloud,
    syncPoints,
    renderHistory,
    renderPoints,
    _test: { mergeAchievements, streakMilestoneProgress, cumulativeMilestoneProgress, canonicalHistoryReady }
  };
})();
