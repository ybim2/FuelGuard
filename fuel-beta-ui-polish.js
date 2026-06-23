// Fuel Guard beta UI polish layer.
// Keeps existing beta state/calculation logic, then adjusts the visible mobile-first layout.
(() => {
  const RISK_LABELS = {
    green: "Low risk",
    amber: "Medium risk",
    red: "High risk"
  };

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

  function actionForStatus(status, hasLog) {
    if (!hasLog) return "log food or eat a quick available option";
    if (status === "green") return "timing looks okay";
    if (status === "amber") return "plan food soon";
    return "get fuel available now";
  }

  function moveElementBefore(element, target) {
    if (element && target && element.nextElementSibling !== target) target.parentNode.insertBefore(element, target);
  }

  function moveElementAfter(element, target) {
    if (element && target && element.previousElementSibling !== target) target.parentNode.insertBefore(element, target.nextSibling);
  }

  function updateLiveRhythm() {
    const dayType = document.querySelector(".beta-day-type-row");
    const logButton = document.getElementById("graphLogFoodButton");
    const graph = document.querySelector(".beta-graph-wrap");
    const prediction = document.getElementById("fuelPredictionPanel");
    moveElementBefore(dayType, logButton);
    moveElementAfter(prediction, graph);

    const snapshot = typeof fuelGapSnapshot === "function" ? fuelGapSnapshot() : null;
    if (!snapshot) return;

    const lastBadge = document.getElementById("fuelGraphLastAte");
    const riskPill = document.getElementById("fuelGapNextAction");
    const duplicateContext = document.getElementById("fuelStatusContext");
    const header = document.querySelector(".beta-rhythm-header");

    if (riskPill && header && riskPill.parentElement !== header) header.appendChild(riskPill);
    if (header) header.classList.add("beta-rhythm-status-row");
    if (duplicateContext) duplicateContext.classList.add("beta-hidden-duplicate-risk");

    const status = snapshot.status || "red";
    const riskLabel = RISK_LABELS[status] || "High risk";
    const hasLog = snapshot.lastFuelled && !/no fuel logged/i.test(snapshot.lastFuelled);
    if (riskPill) {
      riskPill.textContent = `${riskLabel}: ${actionForStatus(status, hasLog)}`;
      riskPill.className = `fuel-next-action beta-risk-pill ${status}`;
      riskPill.hidden = false;
    }
    if (lastBadge && snapshot.timeSinceFuel) {
      lastBadge.textContent = hasLog ? `Last fuel: ${snapshot.timeSinceFuel} ago` : "Last fuel: not logged yet";
    }

    document.querySelectorAll(".fuel-gap-insight").forEach(card => {
      const label = card.querySelector("span")?.textContent?.trim().toLowerCase();
      if (label !== "current gap risk") return;
      const strong = card.querySelector("strong");
      const small = card.querySelector("small");
      if (strong) strong.textContent = riskLabel;
      if (small) {
        const greenHours = trimHour(limits().greenMinutes / 60);
        const redHours = trimHour(limits().redMinutes / 60);
        small.textContent = `Low risk under ${greenHours}h. High risk after ${redHours}h.`;
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

  function reorderHistorySections() {
    const screen = document.getElementById("logs");
    if (!screen) return;
    const cards = [...screen.querySelectorAll(":scope > article.card")];
    const daily = cards.find(card => /daily summaries/i.test(card.querySelector("h2")?.textContent || ""));
    const insight = cards.find(card => /^insights\s*\/\s*history$/i.test(card.querySelector("h2")?.textContent?.trim() || ""));
    if (daily && insight && daily.compareDocumentPosition(insight) & Node.DOCUMENT_POSITION_PRECEDING) {
      screen.insertBefore(daily, insight);
    }
  }

  function renderHistoryVisuals() {
    const summaryCard = [...document.querySelectorAll("#logs article.card")]
      .find(card => /^insights\s*\/\s*history$/i.test(card.querySelector("h2")?.textContent?.trim() || ""));
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
      .filter(entry => entry.actualDangerWindow && entry.actualDangerWindow !== "Not detected")
      .map(entry => `<li><strong>${safeText(entry.dateLabel || entry.date)}</strong><span>${safeText(entry.actualDangerWindow)}</span></li>`)
      .join("");

    target.innerHTML = `
      <section class="beta-history-chart"><h3>Longest fuel gap by day</h3>${gapBars}</section>
      <section class="beta-history-chart"><h3>Fuel logs per day</h3>${logBars}</section>
      <section class="beta-history-chart"><h3>Common danger windows</h3>${windows ? `<ul class="beta-danger-window-list">${windows}</ul>` : `<p class="muted">No repeated danger window detected yet.</p>`}</section>
    `;
  }

  function setLabelText(input, text) {
    const label = input?.closest("label");
    if (!label) return;
    const textNode = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
    if (textNode) textNode.textContent = text;
  }

  function setupHourSettings() {
    const green = document.getElementById("greenThresholdMinutes");
    const red = document.getElementById("redThresholdMinutes");
    if (green) {
      setLabelText(green, "Low risk under (hours)");
      green.min = "1";
      green.max = "6";
      green.step = "0.25";
      green.inputMode = "decimal";
      green.setAttribute("aria-label", "Low risk under hours");
    }
    if (red) {
      setLabelText(red, "High risk after (hours)");
      red.min = "2";
      red.max = "12";
      red.step = "0.25";
      red.inputMode = "decimal";
      red.setAttribute("aria-label", "High risk after hours");
    }
    const settingsCopy = document.querySelector("#checklist article.card > p.muted");
    if (settingsCopy) {
      settingsCopy.textContent = "Adjust beta gap thresholds in hours. Low risk under 3 hours, medium risk from 3-5 hours, high risk after 5+ hours.";
    }
  }

  function renderHourSettings() {
    setupHourSettings();
    const green = document.getElementById("greenThresholdMinutes");
    const red = document.getElementById("redThresholdMinutes");
    const active = document.activeElement;
    if (green && active !== green) green.value = trimHour(limits().greenMinutes / 60);
    if (red && active !== red) red.value = trimHour(limits().redMinutes / 60);
  }

  function saveHourSettings(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const greenHours = Number(document.getElementById("greenThresholdMinutes")?.value || 3);
    const redHours = Number(document.getElementById("redThresholdMinutes")?.value || 5);
    const threshold = limits();
    const lowMinutes = Math.round(Math.min(6, Math.max(1, greenHours)) * 60);
    const highMinutes = Math.round(Math.min(12, Math.max(2, Math.max(redHours, greenHours + .5))) * 60);
    threshold.greenMinutes = lowMinutes;
    threshold.redMinutes = highMinutes;
    const status = document.getElementById("fuelSettingsStatus");
    if (status) status.textContent = "Risk thresholds saved in hours.";
    if (typeof save === "function") save();
    if (typeof renderAll === "function") renderAll();
    requestAnimationFrame(applyUiPolish);
  }

  function installHourSettingsHandler() {
    const button = document.getElementById("saveFuelThresholds");
    if (!button || button.dataset.betaHourHandler === "true") return;
    button.dataset.betaHourHandler = "true";
    button.addEventListener("click", saveHourSettings, true);
  }

  function applyUiPolish() {
    updateLiveRhythm();
    reorderHistorySections();
    renderHistoryVisuals();
    renderHourSettings();
    installHourSettingsHandler();
  }

  window.addEventListener("resize", applyUiPolish);
  document.addEventListener("DOMContentLoaded", applyUiPolish);
  requestAnimationFrame(applyUiPolish);
  setInterval(applyUiPolish, 1000);
})();
