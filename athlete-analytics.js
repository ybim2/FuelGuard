// Athlete-owned behavioural Analytics derived from canonical Fuel and Training records.
(() => {
  "use strict";

  const PERIODS = Object.freeze([
    { key: "7d", label: "7D" },
    { key: "30d", label: "30D" },
    { key: "90d", label: "90D" },
    { key: "all", label: "ALL" }
  ]);
  let selectedPeriod = "30d";

  function domain() {
    return window.FuelGuardDomain;
  }

  function gapState() {
    return typeof fuelGapState === "function" ? fuelGapState() : { logs: [], trainingMode: { sessions: [] } };
  }

  function escape(value) {
    return domain()?.escapeHtml?.(value) || String(value ?? "");
  }

  function clockFromMinute(value) {
    const minutes = Math.max(0, Math.min(1439, Math.round(Number(value) || 0)));
    const date = new Date(2026, 0, 1, Math.floor(minutes / 60), minutes % 60);
    return domain()?.formatClock?.(date) || "";
  }

  function model({ period = selectedPeriod, now = new Date() } = {}) {
    const gap = gapState();
    const rhythm = domain().athleteFuelRhythm({ logs: gap.logs || [], period, now });
    const timing = domain().athleteFuelTimingObservations({ logs: gap.logs || [], period, now });
    const training = domain().athleteTrainingFuelAnalytics({
      sessions: gap.trainingMode?.sessions || [],
      logs: gap.logs || [],
      period,
      now
    });
    const preparation = domain().athletePreparationRhythm({ checks: gap.fuelKit?.checks || [], period, now });
    const insights = [];
    if (rhythm.peak) insights.push({ label: "Most common fuel time", value: rhythm.peak.label, detail: `${rhythm.peak.sampleCount} recorded Fuel moments in this window.` });
    if (rhythm.typicalGap) insights.push({
      label: "Longest recurring gap",
      value: domain().duration(rhythm.typicalGap.averageMinutes),
      detail: `${clockFromMinute(rhythm.typicalGap.averageStartMinute)} → ${clockFromMinute(rhythm.typicalGap.averageEndMinute)} across ${rhythm.typicalGap.dayCount} days.`
    });
    if (timing.firstFuel) insights.push({ label: "Most common first fuel time", value: timing.firstFuel.label, detail: `Based on the first recorded Fuel moment across ${timing.loggedDays} logged days.` });
    if (timing.firstSnackOrBrunch) insights.push({ label: "First Snack / Brunch time", value: timing.firstSnackOrBrunch.label, detail: `Based only on ${timing.snackOrBrunchSampleCount} logs explicitly classified as Snack or Brunch.` });
    if (timing.lastMeal) insights.push({ label: "Most common last meal time", value: timing.lastMeal.label, detail: `Based on the last recorded Fuel moment across ${timing.loggedDays} logged days.` });
    if (training.sufficient && Number(training.metrics.carbsG.perHour) > 0) insights.push({
      label: "Training carb intake",
      value: `${Math.round(training.metrics.carbsG.perHour)} g/hr`,
      detail: `Across ${training.workoutCount} valid completed workout${training.workoutCount === 1 ? "" : "s"}.`
    });
    return { period, rhythm, timing, training, preparation, insights };
  }

  function rhythmMarkup(rhythm) {
    if (!rhythm.sufficient) return `
      <div class="athlete-analytics-empty rhythm">
        <div class="athlete-analytics-placeholder-bars" aria-hidden="true">${Array.from({ length: 12 }, (_, index) => `<i style="--placeholder:${24 + (index % 5) * 11}%"></i>`).join("")}</div>
        <h3>Your Fuel Rhythm starts here</h3>
        <p>Keep logging fuel and Fuel Guard will begin mapping when you naturally fuel.</p>
      </div>`;
    return `
      <div class="athlete-rhythm-chart" role="img" aria-label="Typical Fuel events by local hour across ${rhythm.loggedDays} logged days">
        <div class="athlete-rhythm-bars">
          ${rhythm.bars.map(item => `<i style="--rhythm-height:${Math.max(item.relativeHeight ? 8 : 2, item.relativeHeight)}%" aria-label="${escape(domain().hourWindowLabel(item.hour))}: ${item.averagePerLoggedDay} Fuel moments per logged day"><b></b></i>`).join("")}
        </div>
        <div class="athlete-rhythm-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>
      </div>
      <div class="athlete-rhythm-evidence">
        <span><small>Logged days</small><strong>${rhythm.loggedDays}</strong></span>
        <span><small>Typical day</small><strong>${rhythm.typicalEventsPerLoggedDay} Fuel moments</strong></span>
      </div>`;
  }

  function trainingMetricMarkup(key, label, unit, secondaryUnit, metric) {
    const perHour = Number(metric?.perHour || 0);
    const average = Number(metric?.averagePerWorkout || 0);
    const maximum = Math.max(perHour, Number(metric?.observedMaxPerHour || 0), 1);
    const width = Math.max(perHour > 0 ? 8 : 0, Math.min(100, Math.round(perHour / maximum * 100)));
    return `<article class="athlete-training-intake-metric ${escape(key)}">
      <div><span>${escape(label)}</span><strong>${Math.round(perHour).toLocaleString("en-GB")} <small>${escape(unit)}/hr</small></strong><p>${Math.round(average).toLocaleString("en-GB")} ${escape(secondaryUnit)} average / workout</p></div>
      <div class="athlete-training-intake-track" aria-label="${escape(label)} average rate; relative to this athlete's highest included workout"><i style="width:${width}%"></i></div>
    </article>`;
  }

  function trainingMarkup(training) {
    if (!training.sufficient) return `
      <div class="athlete-analytics-empty training">
        <div class="athlete-training-placeholder" aria-hidden="true"><i></i><i></i><i></i></div>
        <h3>Build your training fuel profile</h3>
        <p>Use Training Mode and log what you consume to see how you fuel your sessions.</p>
      </div>`;
    return `<div class="athlete-training-intake-system">
      ${trainingMetricMarkup("carbs", "Carbohydrate", "g", "g", training.metrics.carbsG)}
      ${trainingMetricMarkup("sodium", "Sodium", "mg", "mg", training.metrics.sodiumMg)}
      ${trainingMetricMarkup("fluid", "Fluid", "ml", "ml", training.metrics.fluidMl)}
      <p class="athlete-training-intake-note">Bar lengths compare each rate with your highest valid included workout. They are not targets or percentages.</p>
    </div>`;
  }

  function preparationMarkup(preparation) {
    if (!preparation.sufficient) return `
      <div class="athlete-preparation-empty">
        <h3>Build your Preparation Rhythm</h3>
        <p>Complete at least three Ready Checks and Fuel Guard will show how often you were prepared in this period.</p>
        <button type="button" class="secondary" data-open-screen="tools">Open Ready Check</button>
      </div>`;
    const clearDifference = preparation.strongestWeekday && preparation.weakestWeekday
      && preparation.strongestWeekday.day !== preparation.weakestWeekday.day
      && preparation.strongestWeekday.percentage !== preparation.weakestWeekday.percentage;
    return `<div class="athlete-preparation-rhythm">
      <div class="athlete-preparation-total"><strong>${preparation.preparedPercentage}%</strong><span>prepared</span><small>${preparation.preparedDays} of ${preparation.checkedDays} checked days</small></div>
      <div class="athlete-preparation-weekdays">
        ${clearDifference ? `<span><small>Stronger day</small><strong>${escape(preparation.strongestWeekday.label)}</strong><b>${preparation.strongestWeekday.percentage}% prepared</b></span><span><small>Day to make easier</small><strong>${escape(preparation.weakestWeekday.label)}</strong><b>${preparation.weakestWeekday.percentage}% prepared</b></span>` : `<p>No clear weekday difference yet. Keep using Ready Check and the pattern will become more useful.</p>`}
      </div>
      <div class="athlete-preparation-day-list" aria-label="Preparation by weekday">
        ${preparation.weekdays.map(day => `<span><small>${escape(day.label.slice(0, 3))}</small><strong>${day.percentage == null ? "—" : `${day.percentage}%`}</strong><b>${day.checked ? `${day.prepared}/${day.checked}` : "No checks"}</b></span>`).join("")}
      </div>
      <button type="button" class="secondary" data-open-screen="tools">Open Ready Check</button>
    </div>`;
  }

  function render() {
    const target = document.getElementById("athleteAnalyticsSurface");
    if (!target || !domain()) return null;
    const data = model();
    const periodLabel = PERIODS.find(item => item.key === data.period)?.label || "30D";
    target.innerHTML = `
      <header class="athlete-analytics-header">
        <div><span>Understand the behaviour</span><h1>Analytics</h1><p>See when you fuel and how recorded intake changes across real Training Mode sessions.</p></div>
      </header>
      <nav class="athlete-analytics-period" aria-label="Analytics period">
        ${PERIODS.map(item => `<button type="button" data-analytics-period="${item.key}" class="${item.key === data.period ? "active" : ""}" aria-pressed="${item.key === data.period}">${item.label}</button>`).join("")}
      </nav>
      <section class="athlete-analytics-hero" aria-labelledby="fuelRhythmHeading">
        <header><div><span>YOUR FUEL RHYTHM</span><h2 id="fuelRhythmHeading">When you normally fuel across an average day</h2></div><b>${periodLabel}</b></header>
        ${rhythmMarkup(data.rhythm)}
      </section>
      <section class="athlete-training-analytics" aria-labelledby="trainingFuelHeading">
        <header><div><span>HOW YOU FUEL TRAINING</span><h2 id="trainingFuelHeading">Your average intake while Training Mode is active</h2></div><b>${data.training.workoutCount || "—"} workouts</b></header>
        ${trainingMarkup(data.training)}
      </section>
      <section class="athlete-preparation-analytics" aria-labelledby="preparationRhythmHeading">
        <header><div><span>PREPARATION RHYTHM</span><h2 id="preparationRhythmHeading">Ready for the Day</h2></div><b>${periodLabel}</b></header>
        ${preparationMarkup(data.preparation)}
      </section>
      ${data.insights.length ? `<section class="athlete-analytics-insights" aria-labelledby="analyticsInsightsHeading"><header><span>Useful observations</span><h2 id="analyticsInsightsHeading">What stands out</h2></header><div>${data.insights.map(insight => `<article><small>${escape(insight.label)}</small><strong>${escape(insight.value)}</strong><p>${escape(insight.detail)}</p></article>`).join("")}</div></section>` : ""}
      <footer class="athlete-analytics-share"><button id="athleteAnalyticsShareButton" type="button" class="athlete-analytics-share-button"><span aria-hidden="true">↗</span> Share analytics</button><p id="athleteAnalyticsShareStatus" role="status" aria-live="polite"></p></footer>
    `;
    target.querySelector("#athleteAnalyticsShareButton")?.addEventListener("click", () => window.FuelGuardAthleteShare?.shareAnalyticsStory?.());
    return data;
  }

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-analytics-period]");
    if (!button) return;
    selectedPeriod = PERIODS.some(item => item.key === button.dataset.analyticsPeriod) ? button.dataset.analyticsPeriod : "30d";
    render();
  });
  window.addEventListener("fuelguard:cloud-status", render);
  window.addEventListener("fuelguard:training-session-ended", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

  window.FuelGuardAthleteAnalytics = Object.freeze({
    render,
    model,
    period: () => selectedPeriod,
    _test: Object.freeze({ clockFromMinute, rhythmMarkup, trainingMarkup, preparationMarkup, PERIODS })
  });
})();
