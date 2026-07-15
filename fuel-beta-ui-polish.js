// Fuel Guard beta UI polish layer.
// Event-driven UI adjustments only: no extra one-second render loop.
(() => {
  const RISK_LABELS = {
    green: "Steady",
    amber: "Eat soon",
    red: "Eat now",
    crash: "Recovery needed"
  };

  const RISK_ACTIONS = {
    green: "Steady",
    amber: "Eat soon",
    red: "Eat now",
    crash: "Recovery needed"
  };

  let applying = false;
  function trimHour(value) {
    if (!Number.isFinite(value)) return "";
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  }

  function gapState() {
    return typeof fuelGapState === "function" ? fuelGapState() : (window.state?.fuelGap || {});
  }

  function limits() {
    const gap = gapState();
    if (!gap.thresholds || typeof gap.thresholds !== "object") gap.thresholds = {};
    gap.thresholds.greenMinutes = Number(gap.thresholds.greenMinutes || 150);
    gap.thresholds.redMinutes = Number(gap.thresholds.redMinutes || 180);
    if (gap.thresholds.redMinutes <= gap.thresholds.greenMinutes) gap.thresholds.redMinutes = gap.thresholds.greenMinutes + 30;
    gap.thresholds.crashMinutes = Number(gap.thresholds.crashMinutes || 220);
    if (gap.thresholds.crashMinutes <= gap.thresholds.redMinutes) gap.thresholds.crashMinutes = gap.thresholds.redMinutes + 15;
    return gap.thresholds;
  }

  function riskLabel(status) {
    return RISK_LABELS[status] || RISK_LABELS.red;
  }

  function riskAction(status, hasLog) {
    if (!hasLog) return RISK_LABELS.green;
    return RISK_ACTIONS[status] || RISK_ACTIONS.red;
  }

  function moveElementBefore(element, target) {
    if (element && target && element.nextElementSibling !== target) target.parentNode.insertBefore(element, target);
  }

  function orderLiveRhythm() {
    const todayLog = document.querySelector(".beta-today-log");
    const dayControls = document.querySelector(".beta-day-controls");
    moveElementBefore(todayLog, dayControls);
  }

  function updateDayControlsCopy() {
  }

  function updateRiskCopy() {
    const snapshot = typeof fuelGapSnapshot === "function" ? fuelGapSnapshot() : null;
    if (!snapshot) return;

    const risk = document.getElementById("fuelGapNextAction");
    const lastBadge = document.getElementById("fuelGraphLastAte");

    const status = snapshot.status || "red";
    const hasLog = snapshot.lastFuelled && !/no fuel logged/i.test(snapshot.lastFuelled);
    const nextText = `Status: ${riskAction(status, hasLog)}`;
    const nextClass = `fuel-next-action beta-risk-pill ${status}`;
    if (risk) {
      if (risk.className !== nextClass) risk.className = nextClass;
      if (risk.textContent !== nextText) risk.textContent = nextText;
    }
    if (lastBadge && snapshot.timeSinceFuel) {
      const lastText = hasLog ? `Last fuel: ${snapshot.timeSinceFuel} ago` : "Last fuel: not logged yet";
      if (lastBadge.textContent !== lastText) lastBadge.textContent = lastText;
    }

    document.querySelectorAll(".fuel-gap-insight").forEach(card => {
      const label = card.querySelector("span")?.textContent?.trim().toLowerCase();
      if (label !== "status") return;
      const strong = card.querySelector("strong");
      const small = card.querySelector("small");
      if (strong && strong.textContent !== riskLabel(status)) strong.textContent = riskLabel(status);
      if (small) {
        const greenHours = trimHour(limits().greenMinutes / 60);
        const redHours = trimHour(limits().redMinutes / 60);
        const crashHours = trimHour(Number(limits().crashMinutes || limits().redMinutes + 60) / 60);
        const copy = `Steady before ${greenHours}h. Eat soon from ${greenHours}-${redHours}h. Eat now from ${redHours}-${crashHours}h. Recovery needed starts after ${crashHours}h.`;
        if (small.textContent !== copy) small.textContent = copy;
      }
    });
  }

  function ensureHourSettingsUi() {
    const settingsCopy = document.querySelector("#checklist article.card > p.muted");
    if (settingsCopy) settingsCopy.textContent = "Adjust the estimated support thresholds for fuel and hydration gaps.";
  }

  function updateMediumRange() {
  }

  function renderHourSettings() {
    ensureHourSettingsUi();
  }

  function saveHourSettings(event) {
  }

  function installHourSettingsHandler() {
  }

  function wrapRenderFuelGapPolish() {
    if (typeof window.renderFuelGap !== "function" || window.renderFuelGap.__betaPolishWrapped) return;
    const original = window.renderFuelGap;
    window.renderFuelGap = function renderFuelGapWithPolish() {
      const result = original.apply(this, arguments);
      requestAnimationFrame(() => {
        updateRiskCopy();
        renderHourSettings();
      });
      return result;
    };
    window.renderFuelGap.__betaPolishWrapped = true;
  }

  function applyUiPolish() {
    if (applying) return;
    applying = true;
    wrapRenderFuelGapPolish();
    orderLiveRhythm();
    updateDayControlsCopy();
    updateRiskCopy();
    renderHourSettings();
    installHourSettingsHandler();
    applying = false;
  }

  function observeElement(id, callback) {
    const target = document.getElementById(id);
    if (!target) return;
    const observer = new MutationObserver(() => requestAnimationFrame(callback));
    observer.observe(target, { childList: true, subtree: true, characterData: true });
  }

  document.addEventListener("DOMContentLoaded", applyUiPolish);
  document.querySelectorAll(".mobile-nav-item, .nav-item").forEach(button => {
    button.addEventListener("click", () => requestAnimationFrame(applyUiPolish));
  });
  document.getElementById("fuelDayType")?.addEventListener("change", () => requestAnimationFrame(applyUiPolish));
  document.getElementById("clearFuelBetaData")?.addEventListener("click", () => setTimeout(applyUiPolish, 50));
  window.addEventListener("resize", applyUiPolish);

  observeElement("checklist", renderHourSettings);

  wrapRenderFuelGapPolish();
  requestAnimationFrame(applyUiPolish);
})();
