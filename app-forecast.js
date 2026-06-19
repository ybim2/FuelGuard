
function renderForecastIdentity(row) {
  if (!row.imported) {
    return `
      <div class="item-name">${escapeHtml(row.label)}</div>
      <div class="row-note">${escapeHtml(row.unit)}</div>
    `;
  }

  const categoryOptions = forecastGroupOptions()
    .map(group => `<option value="${group.key}" ${row.group === group.key ? "selected" : ""}>${escapeHtml(group.label)}</option>`)
    .join("");

  return `
    <label class="forecast-field">
      <span>Item Name</span>
      <input value="${escapeHtml(row.label)}" data-forecast-label="${row.key}">
    </label>
    <label class="forecast-field">
      <span>Category</span>
      <select data-forecast-group="${row.key}">${categoryOptions}</select>
    </label>
    <label class="forecast-field">
      <span>Unit</span>
      <input value="${escapeHtml(row.unit)}" data-forecast-unit="${row.key}">
    </label>
    ${row.notes ? `<div class="row-note">${escapeHtml(row.notes)}</div>` : ""}
  `;
}

function dailyConsumptionLabel(row) {
  return row.imported ? "Daily Consumption Rate (g/day)" : "Daily Consumption Rate";
}

function dailyConsumptionUnit(row) {
  return row.imported ? "grams/day" : (row.dailyUseUnit || "per day");
}

function buyPrepByDate(row) {
  if (!Number.isFinite(row.daysUntilRunOut)) return "No date";
  if (row.status === "green") return "No immediate action";
  return row.runOutShortDate;
}

function confirmationRiskText(row) {
  if (row.status === "red") return "Urgent. Likely under-fuelling risk if no action is taken.";
  if (row.status === "amber") return "Running low soon. Plan to buy or prep.";
  return "Enough stock. No immediate action.";
}

function renderFuelConfirmationRow(row, complete) {
  return `
    <div class="confirmation-row">
      <div>
        ${renderForecastIdentity(row)}
        <div class="row-note">${escapeHtml(labelForForecastGroup(row.group))}</div>
      </div>
      <label class="forecast-field">
        <span>Current Stock</span>
        <input type="number" min="0" step="0.01" value="${row.currentStock}" data-forecast-stock="${row.key}">
        <span>${escapeHtml(row.unit)}</span>
      </label>
      <label class="forecast-field">
        <span>${dailyConsumptionLabel(row)}</span>
        <input type="number" min="0" step="${row.imported ? "1" : "0.01"}" value="${row.dailyBurnRate}" data-forecast-burn="${row.key}">
        <span>${dailyConsumptionUnit(row)}</span>
      </label>
      <div>
        <strong>${Number.isFinite(row.daysUntilRunOut) ? row.runOutShortDate : "No run-out date"}</strong>
        <div class="row-note">${formatDays(row.daysUntilRunOut)}</div>
      </div>
      <div>
        <strong>${escapeHtml(buyPrepByDate(row))}</strong>
        <div class="row-note">${row.status === "green" ? "Monitor only" : "Action window"}</div>
      </div>
      <div>
        <span class="status-pill ${row.status}">${row.status.toUpperCase()}</span>
        <div class="row-note">${escapeHtml(confirmationRiskText(row))}</div>
      </div>
      <div>
        <span class="category-status ${complete ? "complete" : ""}">${complete ? "Confirmed" : "Pending"}</span>
      </div>
    </div>
  `;
}

function renderFuelConfirmationCategorySections({ reviewMode = false } = {}) {
  const nextCategory = nextForecastCategory();

  return forecastGroupsForPantry()
    .map(group => {
      const rows = forecastRows().filter(row => row.group === group.key);
      const complete = isForecastCategoryComplete(group.key);
      const shouldOpen = !reviewMode && !complete && nextCategory?.key === group.key;
      const openAttribute = shouldOpen ? "open" : "";
      const worstStatus = rows.length
        ? rows.map(row => row.status).sort((a, b) => forecastRank(b) - forecastRank(a))[0]
        : "green";

      return `
        <details class="forecast-confirmation ${complete ? "complete" : ""}" ${openAttribute}>
          <summary>
            <span>${group.label}</span>
            <span class="category-status ${complete ? "complete" : ""}">${complete ? "Complete" : "Confirm next"}</span>
          </summary>
          <div class="forecast-confirmation-body">
            <div class="fuel-confirmation-scroll">
              <div class="fuel-confirmation-table">
                <div class="confirmation-row confirmation-heading">
                  <span>Category / Food Item</span>
                  <span>Current Stock</span>
                  <span>Daily Use</span>
                  <span>Run-Out Date</span>
                  <span>Buy / Prep By</span>
                  <span>Risk</span>
                  <span>Confirm</span>
                </div>
                ${rows.length
                  ? rows.map(row => renderFuelConfirmationRow(row, complete)).join("")
                  : `<div class="confirmation-row empty-confirmation-row"><p class="muted empty-category-note">No items in this pantry section.</p></div>`}
              </div>
            </div>
            <div class="button-row forecast-section-actions">
              <button type="button" class="primary" data-confirm-forecast-category="${group.key}">
                ${complete ? "Category Confirmed" : `Confirm ${group.label}`}
              </button>
              <button type="button" class="secondary danger-secondary" data-clear-forecast-category="${group.key}">
                Clear ${group.label}
              </button>
              <span class="status-pill ${worstStatus} category-fuel-status">Fuel status is: ${worstStatus.toUpperCase()}</span>
            </div>
          </div>
        </details>
      `;
    })
    .join("");
}

function renderMealPrepWarnings() {
  const slots = document.querySelectorAll("[data-meal-prep-warning-slot]");
  if (!slots.length) return;
  if (!state.fuelInfoConfirmed) {
    slots.forEach(slot => {
      slot.innerHTML = "";
    });
    return;
  }

  const snapshot = mealPrepWarningSnapshot();
  const checkRowsHtml = snapshot.checks
    .map(check => `
      <div class="meal-prep-check-row ${check.complete ? "complete" : "active"}">
        <div>
          <div class="item-name">${escapeHtml(check.label)}</div>
          <div class="row-note">${escapeHtml(check.question)}</div>
          <div class="row-note">${escapeHtml(check.horizon)}</div>
        </div>
        <span class="status-pill ${check.complete ? "green" : "red"}">${check.complete ? "PREPARED" : "ACTION REQUIRED"}</span>
        <div class="row-note">${check.complete ? "Preparation confirmed for today." : escapeHtml(check.consequence)}</div>
        <div>
          <strong>${check.complete ? "System stable for this check." : escapeHtml(check.action)}</strong>
          <div class="button-row meal-prep-check-actions">
            <button class="primary" type="button" data-meal-prep-check="${check.key}">Prepared</button>
            <button class="secondary danger-secondary" type="button" data-meal-prep-not-yet="${check.key}">Not Yet</button>
          </div>
          ${check.notYetToday ? `<p class="row-note prep-unresolved-note">Not Yet recorded today. This check remains unresolved.</p>` : ""}
        </div>
      </div>
    `)
    .join("");

  const html = `
    <div class="meal-prep-warning fuel-availability-panel ${snapshot.active ? "active" : "stable"} ${snapshot.severity}">
      <div class="meal-prep-warning-header">
        <div>
          <p class="label ${snapshot.active ? "warning-label" : ""}">Fuel Availability</p>
          <h3>Is tomorrow protected?</h3>
          <p>${snapshot.active ? "Confirm tomorrow and week-ahead coverage before this section clears." : "Tomorrow is protected and week-ahead coverage is stable."}</p>
        </div>
        <div class="meal-prep-status-stack">
          <span class="status-pill ${snapshot.severity}">${snapshot.active ? "ACTION REQUIRED" : "PREPARED"}</span>
          <span class="prep-state-pill">${snapshot.prepStatus}</span>
        </div>
      </div>
      <div class="meal-prep-risk-list">
        ${checkRowsHtml}
      </div>
    </div>
  `;

  slots.forEach(slot => {
    slot.innerHTML = html;
  });
}

function renderShopping() {
  renderMealPrepWarnings();

  const allConfirmed = allForecastCategoriesConfirmed();
  const confirmationFlow = document.getElementById("forecastConfirmationFlow");

  if (confirmationFlow) {
    const sectionHtml = renderFuelConfirmationCategorySections({ reviewMode: allConfirmed });
    const confirmDisabled = allConfirmed ? "" : "disabled";
    const reviewOpenAttribute = state.fuelInfoConfirmed ? "" : "open";

    confirmationFlow.innerHTML = `
      <details class="fuel-confirmation-review" ${reviewOpenAttribute}>
        <summary>Review or edit fuel confirmation table</summary>
        <div class="forecast-flow review-flow">${sectionHtml}</div>
        <div class="button-row confirmation-submit-row">
          <button id="saveShopping" class="primary" type="button" ${confirmDisabled}>Confirm Fuel Information</button>
          ${allConfirmed ? "" : `<span class="row-note">Confirm every category before continuing to Fuel Availability.</span>`}
        </div>
      </details>
    `;
  }
}

function renderBodyMind() {
  const energyToday = document.getElementById("energyToday");
  if (energyToday) energyToday.value = state.bodyMind.energy;

  const moodToday = document.getElementById("moodToday");
  if (moodToday) moodToday.value = state.bodyMind.mood;

  const hungerToday = document.getElementById("hungerToday");
  if (hungerToday) hungerToday.value = state.bodyMind.hunger;

  const recoveryNote = document.getElementById("recoveryNote");
  if (recoveryNote) recoveryNote.value = state.bodyMind.note || "";
}

function renderLogs() {
  const entries = [...(state.adherenceHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const fuelInsight = fuelGapInsight();

  const weeklyLogSummary = document.getElementById("weeklyLogSummary");
  if (weeklyLogSummary) {
    weeklyLogSummary.innerHTML = `
      <div class="mini-card"><p class="label">Longest gap today</p><h3>${duration(fuelInsight.longestGap)}</h3></div>
      <div class="mini-card"><p class="label">Fuel confirmations today</p><h3>${fuelInsight.confirmations}</h3></div>
      <div class="mini-card"><p class="label">High-risk gaps</p><h3>${fuelInsight.highRiskGaps}</h3></div>
    `;
  }

  const activityLog = document.getElementById("activityLog");
  if (activityLog) {
    activityLog.innerHTML = entries.length
      ? entries
        .map(entry => `
          <div class="row">
            <div>
              <div class="item-name">${entry.label}</div>
              <div class="row-note">${new Date(entry.date).toLocaleString()}</div>
            </div>
            <strong>Done</strong>
          </div>
        `)
        .join("")
      : `<p class="muted">No activity logged yet.</p>`;
  }
}
