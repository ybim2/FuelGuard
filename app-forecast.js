
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


function renderShopping() {
  const allConfirmed = allForecastCategoriesConfirmed();
  const nextCategory = nextForecastCategory();
  const confirmationFlow = document.getElementById("forecastConfirmationFlow");

  if (confirmationFlow) {
    confirmationFlow.innerHTML = forecastGroupsForPantry()
      .map(group => {
        const rows = forecastRows().filter(row => row.group === group.key);
        const complete = isForecastCategoryComplete(group.key);
        const shouldOpen = !complete && nextCategory?.key === group.key;
        const openAttribute = shouldOpen ? "open" : "";

        return `
          <details class="forecast-confirmation ${complete ? "complete" : ""}" ${openAttribute}>
            <summary>
              <span>${group.label}</span>
              <span class="category-status ${complete ? "complete" : ""}">${complete ? "Complete" : "Confirm next"}</span>
            </summary>
            <div class="forecast-confirmation-body">
              ${rows
                .map(row => `
                  <div class="confirmation-row">
                    <div>
                      ${renderForecastIdentity(row)}
                    </div>
                    <label class="forecast-field">
                      <span>Current Stock</span>
                      <input type="number" min="0" step="0.01" value="${row.currentStock}" data-forecast-stock="${row.key}">
                    </label>
                    <label class="forecast-field">
                      <span>Daily Consumption Rate</span>
                      <input type="number" min="0" step="0.01" value="${row.dailyBurnRate}" data-forecast-burn="${row.key}">
                    </label>
                  </div>
                `)
                .join("")}
              <button type="button" class="primary" data-confirm-forecast-category="${group.key}">
                ${complete ? "Category Confirmed" : `Confirm ${group.label}`}
              </button>
            </div>
          </details>
        `;
      })
      .join("");
  }

  const forecastList = document.getElementById("fuelForecastList");
  if (forecastList) {
    if (!allConfirmed) {
      forecastList.innerHTML = `
        <div class="forecast-locked">
          <strong>Run-out forecast locked</strong>
          <p>${nextCategory ? `Confirm ${nextCategory.label} next.` : "Confirm every category."} Predictions generate after meals, snacks, supplements and electrolytes are complete.</p>
        </div>
      `;
    } else {
      forecastList.innerHTML = forecastGroupsForPantry()
        .map(group => {
          const rows = forecastRows().filter(row => row.group === group.key);
          if (!rows.length) return "";

          return `
            <details class="forecast-section" open>
              <summary>${group.label}</summary>
              <div class="forecast-row forecast-heading">
                <span>Food Item</span>
                <span>Current Stock</span>
                <span>Daily Consumption Rate</span>
                <span>Run-Out Forecast</span>
                <span>Traffic Light Status / Next Action</span>
              </div>
              ${rows
                .map(row => `
                  <div class="forecast-row">
                    <div>
                      <div class="item-name">${escapeHtml(row.label)}</div>
                      <div class="row-note">${escapeHtml(row.unit)}</div>
                    </div>
                    <div>
                      <strong>${row.currentStock}</strong>
                      <div class="row-note">${escapeHtml(row.unit)}</div>
                    </div>
                    <div>
                      <strong>${row.dailyBurnRate}</strong>
                      <div class="row-note">per day</div>
                    </div>
                    <div>
                      <strong>${formatDays(row.daysUntilRunOut)}</strong>
                      <div class="row-note">${Number.isFinite(row.daysUntilRunOut) ? row.runOutShortDate : "No run-out date"}</div>
                    </div>
                    <div>
                      <span class="status-pill ${row.status}">${row.status.toUpperCase()}</span>
                      <div class="row-note">${escapeHtml(row.nextAction)}</div>
                    </div>
                  </div>
                `)
                .join("")}
            </details>
          `;
        })
        .join("");
    }
  }

  const shoppingList = document.getElementById("shoppingList");
  if (!shoppingList) return;

  if (!allConfirmed) {
    shoppingList.innerHTML = `
      <div class="row">
        <div>
          <div class="item-name">${nextCategory ? `Confirm ${nextCategory.label}` : "Confirm categories"}</div>
          <div class="row-note">Run-out predictions unlock after the category workflow is complete.</div>
        </div>
        <strong>Next</strong>
      </div>
    `;
    return;
  }

  const rows = forecastRows();
  const needsAttention = rows
    .filter(row => row.status !== "green")
    .sort((a, b) => forecastRank(b.status) - forecastRank(a.status));

  if (!needsAttention.length) {
    shoppingList.innerHTML = `
      <div class="row">
        <div>
          <div class="item-name">All tracked food is green</div>
          <div class="row-note">Next calculated shop: ${calculatedNextShopDate() ? formatShortDate(calculatedNextShopDate()) : "No burn rate"}.</div>
        </div>
        <strong>Hold</strong>
      </div>
    `;
    return;
  }

  shoppingList.innerHTML = needsAttention
    .map(row => `
      <div class="row">
        <div>
          <div class="item-name">${escapeHtml(row.label)}</div>
          <div class="row-note">${escapeHtml(row.nextAction)}</div>
        </div>
        <span class="status-pill ${row.status}">${row.status.toUpperCase()}</span>
      </div>
    `)
    .join("");
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

  const weeklyLogSummary = document.getElementById("weeklyLogSummary");
  if (weeklyLogSummary) {
    weeklyLogSummary.innerHTML = `
      <div class="mini-card"><p class="label">Steps completed</p><h3>${completedCount()}/${STEP_KEYS.length}</h3></div>
      <div class="mini-card"><p class="label">Streak</p><h3>${fuelStreak()} days</h3></div>
      <div class="mini-card"><p class="label">Physiology</p><h3>${physiologyScore()}%</h3></div>
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
