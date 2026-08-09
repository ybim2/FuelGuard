// Restrained Athlete milestone recognition derived from trustworthy log history.
(() => {
  const TABLE = "fuel_milestone_achievements";
  let syncing = false;
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
    return domain()?.activityUsageSummary?.(gap.logs || [], new Date()) || { dayStreak: 0, fuelMoments: 0, hydrationMoments: 0 };
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

  function renderHistory(currentSummary = summary()) {
    const target = document.getElementById("athleteMilestones");
    if (!target || !domain()) return;
    const earned = domain().earnedMilestones(currentSummary);
    const byKey = new Map((milestoneState()?.achievements || []).map(item => [item.key, item]));
    target.innerHTML = earned.length ? `
      <div class="beta-milestone-history">
        ${earned.map(item => `<span data-milestone-key="${domain().escapeHtml(item.key)}"><b aria-hidden="true">${item.category === "streak" ? "🔥" : item.category === "fuel" ? "🍽" : "💧"}</b>${domain().escapeHtml(item.label)}${byKey.has(item.key) ? "" : ""}</span>`).join("")}
      </div>
      <p class="row-note">Milestones recognise consistent Fuel Guard use. There are no points, rankings or streak pressure.</p>
    ` : `<p class="row-note">Your first milestones begin at a 5-day streak, 50 fuelling moments or 50 hydration moments.</p>`;
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
    target.innerHTML = `<b aria-hidden="true">${achievement.category === "streak" ? "🔥" : achievement.category === "fuel" ? "🍽" : "💧"}</b><span><strong>${domain().escapeHtml(label)}</strong><small>Milestone reached</small></span>`;
    target.hidden = false;
    acknowledgeLocal(achievement.key);
    const updated = milestoneState()?.achievements.find(item => item.key === achievement.key);
    acknowledgeCloud(updated).catch(() => {});
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { target.hidden = true; }, 5000);
  }

  function evaluate({ allowToast = true } = {}) {
    const state = milestoneState();
    if (!state || !domain()) return [];
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
    if (allowToast && crossed.length) {
      const next = state.achievements.find(item => item.key === crossed[crossed.length - 1].key);
      if (next && !next.acknowledgedAt) showToast(next);
    }
    return crossed;
  }

  async function syncCloud() {
    if (syncing || !domain()) return;
    const cloud = window.fuelGuardCloud;
    if (!cloud?.client || !cloud.user?.id) return;
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
    } catch {
      // Local acknowledgement remains authoritative until the next safe sync.
    } finally {
      syncing = false;
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
    renderHistory,
    _test: { mergeAchievements }
  };
})();
