// Fuel Guard beta UI polish layer.
// Event-driven UI adjustments only: no extra one-second render loop.
(() => {
  const RISK_LABELS = {
    green: "Low risk",
    amber: "Medium risk",
    red: "High risk",
    crash: "Under-fuelled / crash risk"
  };

  const RISK_ACTIONS = {
    green: "timing looks okay",
    amber: "plan food soon",
    red: "get fuel available now",
    crash: "fuel and recovery may be needed now"
  };

  let applying = false;
  let historyQueued = false;

  function safeText(value) {
    if (typeof escapeHtml === "function") return escapeHtml(value || "");
    return String(value || "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));
  }

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
    gap.thresholds.greenMinutes = Number(gap.thresholds.greenMinutes || 180);
    gap.thresholds.redMinutes = Number(gap.thresholds.redMinutes || 300);
    if (gap.thresholds.redMinutes <= gap.thresholds.greenMinutes) gap.thresholds.redMinutes = gap.thresholds.greenMinutes + 60;
    return gap.thresholds;
  }

  function durationLabel(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return "Not enough data";
    return typeof duration === "function" ? duration(minutes) : `${Math.round(minutes)}m`;
  }

  function riskLabel(status) {
    return RISK_LABELS[status] || "High risk";
  }

  function riskAction(status, hasLog) {
    if (!hasLog) return "log fuel or eat a quick available option";
    return RISK_ACTIONS[status] || RISK_ACTIONS.red;
  }

  function moveElementBefore(element, target) {
    if (element && target && element.nextElementSibling !== target) target.parentNode.insertBefore(element, target);
  }

  function moveElementAfter(element, target) {
    if (element && target && element.previousElementSibling !== target) target.parentNode.insertBefore(element, target.nextSibling);
  }

  function orderLiveRhythm() {
    const header = document.querySelector(".beta-rhythm-header");
    const dayType = document.querySelector(".beta-day-type-row");
    const logActions = document.querySelector(".beta-log-actions");
    const cooldown = document.getElementById("foodLogCooldownMessage");
    const risk = document.getElementById("fuelGapNextAction");
    const status = document.getElementById("fuelStatusContext");
    const graph = document.querySelector(".beta-graph-wrap");
    const undo = document.getElementById("undoLatestFoodLog");
    const insights = document.getElementById("fuelGapInsights");
    const todayLog = document.querySelector(".beta-today-log");
    const dayControls = document.querySelector(".beta-day-controls");
    moveElementBefore(dayType, header);
    moveElementAfter(logActions, header || dayType);
    moveElementAfter(cooldown, logActions);
    moveElementAfter(graph, cooldown || logActions);
    moveElementAfter(undo, graph);
    moveElementAfter(status, risk);
    moveElementAfter(insights, undo || graph);
    moveElementBefore(todayLog, dayControls);
  }

  function updateDayControlsCopy() {
  }

  function updateRiskCopy() {
    const snapshot = typeof fuelGapSnapshot === "function" ? fuelGapSnapshot() : null;
    if (!snapshot) return;

    const risk = document.getElementById("fuelGapNextAction");
    const duplicate = document.getElementById("fuelStatusContext");
    const lastBadge = document.getElementById("fuelGraphLastAte");
    if (duplicate && !duplicate.classList.contains("beta-hidden-duplicate-risk")) duplicate.classList.add("beta-hidden-duplicate-risk");

    const status = snapshot.status || "red";
    const hasLog = snapshot.lastFuelled && !/no fuel logged/i.test(snapshot.lastFuelled);
    const nextText = `${riskLabel(status)}: ${riskAction(status, hasLog)}`;
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
      if (label !== "current gap risk") return;
      const strong = card.querySelector("strong");
      const small = card.querySelector("small");
      if (strong && strong.textContent !== riskLabel(status)) strong.textContent = riskLabel(status);
      if (small) {
        const greenHours = trimHour(limits().greenMinutes / 60);
        const redHours = trimHour(limits().redMinutes / 60);
        const crashHours = trimHour(Number(limits().crashMinutes || limits().redMinutes + 60) / 60);
        const copy = `Low risk under ${greenHours}h. Medium risk from ${greenHours}-${redHours}h. High risk from ${redHours}-${crashHours}h. Crash zone after ${crashHours}h.`;
        if (small.textContent !== copy) small.textContent = copy;
      }
    });
  }

  function archiveEntries() {
    const archive = gapState().archive || {};
    return Object.values(archive)
      .filter(entry => entry && entry.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-7);
  }

  function renderBar(label, value, max, meta, tone = "green") {
    const width = max > 0 ? Math.max(6, Math.round((value / max) * 100)) : 0;
    return `
      <div class="beta-history-bar-row">
        <div class="beta-history-bar-label"><span>${safeText(label)}</span><small>${safeText(meta)}</small></div>
        <div class="beta-history-bar-track"><i class="${tone}" style="width:${width}%"></i></div>
      </div>
    `;
  }

  function historyOverviewCard() {
    return [...document.querySelectorAll("#logs > article.card")]
      .find(card => /^insights\s*\/\s*history$/i.test(card.querySelector("h2")?.textContent?.trim() || ""));
  }

  function removeHistoryOverviewCard() {
    historyOverviewCard()?.remove();
  }

  function renameHighRiskGapLabels() {
    document.querySelectorAll("#fuelHistoryArchiveDetail .fuel-archive-stats span").forEach(label => {
      if (label.textContent.trim().toLowerCase() === "long gaps") label.textContent = "High-risk gaps";
    });
    document.querySelectorAll("#fuelHistoryArchiveDetail .fuel-archive-head .status-pill").forEach(pill => {
      if (pill.textContent.trim() === "GAPS FOUND") pill.textContent = "HIGH-RISK GAPS";
    });
  }

  function reorderHistorySections() {
    const screen = document.getElementById("logs");
    if (!screen) return;
    const cards = [...screen.querySelectorAll(":scope > article.card")];
    const daily = cards.find(card => /daily summaries/i.test(card.querySelector("h2")?.textContent || ""));
    const insight = historyOverviewCard();
    if (daily && insight && daily.compareDocumentPosition(insight) & Node.DOCUMENT_POSITION_PRECEDING) {
      screen.insertBefore(daily, insight);
    }
  }

  function removeEndOfDayAnalysis() {
    document.querySelectorAll("#fuelHistoryArchiveDetail .fuel-archive-section").forEach(section => {
      const heading = section.querySelector("h4")?.textContent?.trim().toLowerCase();
      if (heading === "end-of-day analysis") section.remove();
    });
  }

  function renderHistoryVisuals() {
    const summaryCard = historyOverviewCard();
    if (!summaryCard) return;
    let target = document.getElementById("fuelHistoryVisuals");
    if (!target) {
      target = document.createElement("div");
      target.id = "fuelHistoryVisuals";
      target.className = "beta-history-visuals";
      const summary = document.getElementById("fuelHistorySummary");
      if (summary) summary.insertAdjacentElement("afterend", target);
      else summaryCard.appendChild(target);
    }

    const entries = archiveEntries();
    if (!entries.length) {
      target.innerHTML = `<p class="muted beta-history-empty">Graphs appear here after daily summaries are saved.</p>`;
      return;
    }

    const maxGap = Math.max(...entries.map(entry => Number(entry.longestGapMinutes || 0)), 1);
    const maxLogs = Math.max(...entries.map(entry => Number(entry.fuelLogCount || 0)), 1);
    const gapBars = entries.map(entry => {
      const value = Number(entry.longestGapMinutes || 0);
      const tone = Number(entry.longGapCount || 0) ? "red" : "green";
      return renderBar(entry.dateLabel || entry.date, value, maxGap, durationLabel(value), tone);
    }).join("");
    const logBars = entries.map(entry => {
      const value = Number(entry.fuelLogCount || 0);
      return renderBar(entry.dateLabel || entry.date, value, maxLogs, `${value} fuel logs`, "blue");
    }).join("");
    const windows = entries
      .filter(entry => entry.highRiskWindow && entry.highRiskWindow !== "Not detected")
      .map(entry => `<li><strong>${safeText(entry.dateLabel || entry.date)}</strong><span>${safeText(entry.highRiskWindow)}</span></li>`)
      .join("");

    target.innerHTML = `
      <section class="beta-history-chart"><h3>Longest fuel gap by day</h3>${gapBars}</section>
      <section class="beta-history-chart"><h3>Fuel logs per day</h3>${logBars}</section>
      <section class="beta-history-chart"><h3>High Risk windows</h3>${windows ? `<ul class="beta-high-risk-window-list">${windows}</ul>` : `<p class="muted">No High Risk window detected yet.</p>`}</section>
    `;
  }

  function queueHistoryPolish() {
    if (historyQueued) return;
    historyQueued = true;
    requestAnimationFrame(() => {
      historyQueued = false;
      reorderHistorySections();
      removeHistoryOverviewCard();
      removeEndOfDayAnalysis();
      renameHighRiskGapLabels();
      renderHistoryVisuals();
    });
  }

  function ensureHourSettingsUi() {
    const settingsCopy = document.querySelector("#checklist article.card > p.muted");
    if (settingsCopy) settingsCopy.textContent = "Adjust the estimated behavioural risk thresholds for fuel and hydration gaps.";
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
    queueHistoryPolish();
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
  document.getElementById("fuelHistoryArchiveDate")?.addEventListener("change", () => requestAnimationFrame(queueHistoryPolish));
  document.getElementById("clearFuelBetaData")?.addEventListener("click", () => setTimeout(applyUiPolish, 50));
  window.addEventListener("resize", applyUiPolish);

  observeElement("fuelHistoryArchiveDetail", queueHistoryPolish);
  observeElement("fuelHistorySummary", queueHistoryPolish);
  observeElement("checklist", renderHourSettings);

  wrapRenderFuelGapPolish();
  requestAnimationFrame(applyUiPolish);
})();
