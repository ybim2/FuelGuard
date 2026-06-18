
function renderShopping() {
  const nextShopOpportunity = document.getElementById("nextShopOpportunity");
  if (nextShopOpportunity) nextShopOpportunity.value = state.nextShopOpportunity;

  const allConfirmed = allForecastCategoriesConfirmed();
  const nextCategory = nextForecastCategory();
  const confirmationFlow = document.getElementById("forecastConfirmationFlow");

  if (confirmationFlow) {
    confirmationFlow.innerHTML = FORECAST_GROUPS
      .map(group => {
        const rows = forecastRows().filter(row => row.group === group.key);
        const complete = isForecastCategoryComplete(group.key);
        const shouldOpen = !complete && nextCategory?.key === group.key;

        return `
          <details class="forecast-confirmation ${complete ? "complete" : ""}" ${shouldOpen ? "open" : ""}>
            <summary>
              <span>${group.label}</span>
              <span class="category-status ${complete ? "complete" : ""}">${complete ? "Complete" : "Confirm next"}</span>
            </summary>
            <div class="forecast-confirmation-body">
              ${rows
                .map(row => `
                  <div class="confirmation-row">
                    <div>
                      <div class="item-name">${row.label}</div>
                      <div class="row-note">${row.unit}</div>
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
              <button class="primary" data-confirm-forecast-category="${group.key}" ${complete ? "disabled" : ""}>
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
      forecastList.innerHTML = FORECAST_GROUPS
        .map(group => {
          const rows = forecastRows().filter(row => row.group === group.key);
          if (!rows.length) return "";

          return `
            <section class="forecast-section">
              <h3>${group.label}</h3>
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
                      <div class="item-name">${row.label}</div>
                      <div class="row-note">${row.unit}</div>
                    </div>
                    <div>
                      <strong>${row.currentStock}</strong>
                      <div class="row-note">${row.unit}</div>
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
                      <div class="row-note">${row.nextAction}</div>
                    </div>
                  </div>
                `)
                .join("")}
            </section>
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

  if (!state.nextShopOpportunity) {
    shoppingList.innerHTML = `
      <div class="row">
        <div>
          <div class="item-name">Set next shopping opportunity</div>
          <div class="row-note">Forecast status needs a target shopping date.</div>
        </div>
        <strong>Required</strong>
      </div>
    `;
    return;
  }

  if (!needsAttention.length) {
    shoppingList.innerHTML = `
      <div class="row">
        <div>
          <div class="item-name">All tracked food is green</div>
          <div class="row-note">Enough stock until ${formatShortDate(dateFromInput(state.nextShopOpportunity))}.</div>
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
          <div class="item-name">${row.label}</div>
          <div class="row-note">${row.nextAction}</div>
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
