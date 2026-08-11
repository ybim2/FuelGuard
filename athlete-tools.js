// Fuel Kit: lightweight athlete preparation checks backed by owner-only history.
(() => {
  "use strict";

  const TABLE = "fuel_kit_checks";
  const COLUMNS = "id,user_id,checked_on,fuel_options,reserve_ready,hydration_ready,electrolytes_ready,training_today,training_fuel_ready,prepared,created_at,updated_at";
  let loadingFor = "";
  let saving = false;
  let message = "";

  function domain() { return window.FuelGuardDomain; }
  function cloud() { return window.fuelGuardCloud; }
  function gap() { return typeof fuelGapState === "function" ? fuelGapState() : null; }
  function escape(value) { return domain()?.escapeHtml?.(value) || String(value ?? ""); }
  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (typeof uid === "function") return uid();
    throw new Error("A secure Fuel Kit identifier is unavailable.");
  }

  function state() {
    const fuelGap = gap();
    if (!fuelGap) return null;
    if (!fuelGap.fuelKit || typeof fuelGap.fuelKit !== "object" || Array.isArray(fuelGap.fuelKit)) {
      fuelGap.fuelKit = { ownerUserId: "", current: null, checks: [], lastSyncedAt: "", lastError: "" };
    }
    if (!Array.isArray(fuelGap.fuelKit.checks)) fuelGap.fuelKit.checks = [];
    return fuelGap.fuelKit;
  }

  function trainingToday(now = new Date()) {
    const key = domain().dateKey(now);
    return (gap()?.trainingMode?.sessions || []).some(session => {
      const start = domain().parseDate(session.startedAt || session.started_at);
      return start && domain().dateKey(start) === key;
    });
  }

  function blankCheck(now = new Date()) {
    return {
      id: uuid(),
      checkedOn: domain().dateKey(now),
      fuelOptions: 0,
      reserveReady: false,
      hydrationReady: false,
      electrolytesReady: false,
      trainingToday: trainingToday(now),
      trainingFuelReady: false,
      prepared: false,
      dirty: true
    };
  }

  function checkFromRow(row = {}) {
    return {
      id: row.id,
      userId: row.user_id,
      checkedOn: row.checked_on,
      fuelOptions: Math.max(0, Number(row.fuel_options) || 0),
      reserveReady: Boolean(row.reserve_ready),
      hydrationReady: Boolean(row.hydration_ready),
      electrolytesReady: Boolean(row.electrolytes_ready),
      trainingToday: Boolean(row.training_today),
      trainingFuelReady: Boolean(row.training_fuel_ready),
      prepared: Boolean(row.prepared),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      dirty: false
    };
  }

  function prepared(check = {}) {
    return Number(check.fuelOptions || 0) > 0
      && Boolean(check.reserveReady)
      && Boolean(check.hydrationReady)
      && (!check.trainingToday || Boolean(check.trainingFuelReady));
  }

  function ensureCurrent(now = new Date()) {
    const kit = state();
    const key = domain().dateKey(now);
    if (!kit.current || kit.current.checkedOn !== key) {
      kit.current = kit.checks.find(check => check.checkedOn === key) || blankCheck(now);
    }
    kit.current.prepared = prepared(kit.current);
    return kit.current;
  }

  function resetIdentity(userId = "") {
    const kit = state();
    if (!kit) return;
    kit.ownerUserId = String(userId || "");
    kit.current = null;
    kit.checks = [];
    kit.lastSyncedAt = "";
    kit.lastError = "";
    loadingFor = "";
    message = "";
    if (typeof save === "function") save();
  }

  function checkedDayStats(checks = [], now = new Date()) {
    const ordered = [...checks].sort((left, right) => String(right.checkedOn).localeCompare(String(left.checkedOn)));
    const recent = ordered.slice(0, 20);
    const monthPrefix = domain().dateKey(now).slice(0, 7);
    const month = ordered.filter(check => String(check.checkedOn).startsWith(monthPrefix));
    const monthReady = month.filter(check => check.prepared).length;
    return {
      recentReady: recent.filter(check => check.prepared).length,
      recentTotal: recent.length,
      monthReady,
      monthTotal: month.length,
      monthPercentage: month.length ? Math.round(monthReady / month.length * 100) : null
    };
  }

  function rhythmRecommendation(now = new Date()) {
    const rhythm = domain().athleteFuelRhythm({ logs: gap()?.logs || [], period: "30d", now });
    if (!rhythm.sufficient || !Number.isFinite(rhythm.typicalEventsPerLoggedDay)) return null;
    return Math.max(1, Math.round(rhythm.typicalEventsPerLoggedDay));
  }

  function toggleMarkup(key, label, detail, active) {
    return `<button type="button" class="fuel-kit-toggle ${active ? "active" : ""}" data-fuel-kit-toggle="${key}" aria-pressed="${active}"><span><b>${escape(label)}</b><small>${escape(detail)}</small></span><i aria-hidden="true">${active ? "✓" : ""}</i></button>`;
  }

  function render() {
    const target = document.getElementById("athleteToolsSurface");
    if (!target || !domain()) return;
    const check = ensureCurrent();
    const stats = checkedDayStats(state().checks);
    const recommendation = rhythmRecommendation();
    const isReady = prepared(check);
    target.innerHTML = `
      <header class="fuel-tools-header"><span>Prepare before you need it</span><h1>Tools</h1><p>Remembering to fuel helps. Being ready to fuel gives you the edge.</p></header>
      <section class="fuel-kit-card ${isReady ? "ready" : ""}" aria-labelledby="fuelKitHeading">
        <header><div><span>FUEL KIT</span><h2 id="fuelKitHeading">Ready for the day?</h2></div><b aria-hidden="true">FG</b></header>
        <p class="fuel-kit-intro">A quick logistics check — no calories, recipes or food inventory.</p>
        ${recommendation ? `<aside class="fuel-kit-rhythm-note"><strong>You normally fuel around ${recommendation} time${recommendation === 1 ? "" : "s"} during a logged day.</strong><span>${recommendation} options + 1 reserve is a useful starting buffer based on your own rhythm.</span></aside>` : ""}
        <div class="fuel-kit-count-row">
          <div><span>Fuel options</span><small>Portable fuel or snacks available</small></div>
          <div class="fuel-kit-stepper" role="group" aria-label="Fuel options"><button type="button" data-fuel-kit-count="-1" aria-label="Remove one Fuel option">−</button><output>${check.fuelOptions}</output><button type="button" data-fuel-kit-count="1" aria-label="Add one Fuel option">+</button></div>
        </div>
        <div class="fuel-kit-toggles">
          ${toggleMarkup("reserveReady", "Reserve fuel", "One easy backup if the day changes", check.reserveReady)}
          ${toggleMarkup("hydrationReady", "Hydration", "Water or fluid ready", check.hydrationReady)}
          ${toggleMarkup("electrolytesReady", "Electrolytes", "Available where relevant", check.electrolytesReady)}
          ${toggleMarkup("trainingToday", "Training today", "Include session fuel in the check", check.trainingToday)}
          ${check.trainingToday ? toggleMarkup("trainingFuelReady", "Training fuel", "Ready for today's session", check.trainingFuelReady) : ""}
        </div>
        <section class="fuel-kit-verdict ${isReady ? "ready" : check.fuelOptions > 0 && !check.reserveReady ? "reserve" : "building"}">
          <span>${isReady ? "READY" : check.fuelOptions > 0 && !check.reserveReady ? "RUNNING WITHOUT A RESERVE" : "BUILD YOUR BUFFER"}</span>
          <h3>${isReady ? `${check.fuelOptions} fuel option${check.fuelOptions === 1 ? "" : "s"} + 1 reserve` : check.fuelOptions > 0 && !check.reserveReady ? "Add one easy backup option" : "Don't let the day corner you"}</h3>
          <p>${isReady ? "You're covered for the day." : check.fuelOptions > 0 && !check.reserveReady ? "Plans change. A reserve keeps the logistics easy." : "Add the practical options you can actually carry and use."}</p>
        </section>
        <button type="button" class="fuel-kit-save" data-fuel-kit-save ${saving ? "disabled" : ""}>${saving ? "Saving…" : "Save Ready Check"}</button>
        <p class="fuel-kit-status" role="status" aria-live="polite">${escape(message)}</p>
      </section>
      ${stats.recentTotal ? `<section class="fuel-kit-prepared-history" aria-label="Fuel Kit prepared days"><div><span>Prepared days</span><strong>${stats.recentReady} of your last ${stats.recentTotal} checked days</strong></div>${stats.monthPercentage !== null ? `<b>${stats.monthPercentage}% <small>ready this month</small></b>` : ""}</section>` : ""}
    `;
  }

  function updateCurrent(field, value) {
    const check = ensureCurrent();
    check[field] = value;
    check.prepared = prepared(check);
    check.dirty = true;
    if (typeof save === "function") save();
    render();
  }

  async function saveCheck() {
    if (saving) return;
    const kit = state();
    const check = ensureCurrent();
    const user = cloud()?.user;
    const client = cloud()?.client;
    saving = true;
    message = "";
    render();
    try {
      check.prepared = prepared(check);
      if (client?.from && user?.id) {
        const row = {
          id: check.id,
          user_id: user.id,
          checked_on: check.checkedOn,
          fuel_options: check.fuelOptions,
          reserve_ready: check.reserveReady,
          hydration_ready: check.hydrationReady,
          electrolytes_ready: check.electrolytesReady,
          training_today: check.trainingToday,
          training_fuel_ready: check.trainingToday ? check.trainingFuelReady : false,
          updated_at: new Date().toISOString()
        };
        const result = await client.from(TABLE).upsert(row, { onConflict: "user_id,checked_on" }).select(COLUMNS).single();
        if (result.error) throw result.error;
        kit.current = checkFromRow(result.data);
      } else {
        check.dirty = false;
      }
      kit.checks = [kit.current || check, ...kit.checks.filter(item => item.checkedOn !== check.checkedOn)]
        .sort((left, right) => String(right.checkedOn).localeCompare(String(left.checkedOn)));
      kit.lastSyncedAt = client?.from && user?.id ? new Date().toISOString() : "";
      kit.lastError = "";
      message = check.prepared ? "Fuel Kit ready. You're covered for the day." : "Ready Check saved. Add to it whenever your plans change.";
      if (typeof save === "function") save();
      window.FuelGuardMilestones?.evaluate?.({ allowToast: true });
      window.FuelGuardAthleteAnalytics?.render?.();
    } catch (error) {
      kit.lastError = error?.message || "Ready Check could not sync.";
      message = /fuel_kit_checks|schema cache|does not exist/i.test(kit.lastError)
        ? "Fuel Kit is saved on this device until the additive release migration is available."
        : `Ready Check could not sync: ${kit.lastError}`;
      check.dirty = true;
      if (typeof save === "function") save();
    } finally {
      saving = false;
      render();
    }
  }

  async function load({ force = false } = {}) {
    const user = cloud()?.user;
    const client = cloud()?.client;
    const kit = state();
    if (!kit) return;
    const userId = String(user?.id || "");
    if (kit.ownerUserId && kit.ownerUserId !== userId) resetIdentity(userId);
    if (!userId || !client?.from) {
      if (!userId && kit.ownerUserId) resetIdentity("");
      render();
      return;
    }
    if (!kit.ownerUserId) kit.ownerUserId = userId;
    if (!force && loadingFor === userId) return render();
    loadingFor = userId;
    const requestedUser = userId;
    try {
      const result = await client.from(TABLE).select(COLUMNS).eq("user_id", userId).order("checked_on", { ascending: false }).limit(120);
      if (result.error) throw result.error;
      if (String(cloud()?.user?.id || "") !== requestedUser) return;
      kit.checks = (result.data || []).map(checkFromRow);
      kit.current = kit.checks.find(check => check.checkedOn === domain().dateKey(new Date())) || blankCheck();
      kit.lastSyncedAt = new Date().toISOString();
      kit.lastError = "";
    } catch (error) {
      kit.lastError = error?.message || "Fuel Kit history could not load.";
      loadingFor = "";
    }
    if (typeof save === "function") save();
    render();
    window.FuelGuardMilestones?.evaluate?.({ allowToast: true });
    window.FuelGuardAthleteAnalytics?.render?.();
  }

  document.addEventListener("click", event => {
    const count = event.target.closest("[data-fuel-kit-count]");
    if (count) return updateCurrent("fuelOptions", Math.max(0, Math.min(20, ensureCurrent().fuelOptions + Number(count.dataset.fuelKitCount || 0))));
    const toggle = event.target.closest("[data-fuel-kit-toggle]");
    if (toggle) {
      const field = toggle.dataset.fuelKitToggle;
      const next = !Boolean(ensureCurrent()[field]);
      if (field === "trainingToday" && !next) ensureCurrent().trainingFuelReady = false;
      return updateCurrent(field, next);
    }
    if (event.target.closest("[data-fuel-kit-save]")) saveCheck();
  });
  window.addEventListener("fuelguard:cloud-status", () => load());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ force: true }); });
  document.addEventListener("DOMContentLoaded", () => load());

  window.FuelGuardAthleteTools = Object.freeze({
    render,
    load,
    _test: Object.freeze({ prepared, checkedDayStats, checkFromRow, rhythmRecommendation, resetIdentity })
  });
})();
