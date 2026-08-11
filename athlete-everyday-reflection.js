// Universal owner-only Everyday Reflection baseline and later check-ins.
(() => {
  "use strict";

  const TABLE = "fuel_everyday_reflections";
  const COLUMNS = "id,user_id,entry_type,observed_on,meal_prep_organisation,healthy_snacking_ability,work_mood_before,work_mood_during,work_mood_after,work_energy_before,work_energy_during,work_energy_after,training_energy_before,training_energy_during,training_energy_after,work_applicable,training_applicable,completed_at,created_at,updated_at";
  const FIELDS = Object.freeze([
    { key: "mealPrepOrganisation", column: "meal_prep_organisation", label: "Meal prep organisation", low: "Very disorganised", high: "Very organised", group: "everyday" },
    { key: "healthySnackingAbility", column: "healthy_snacking_ability", label: "Healthy snacking ability", low: "Very difficult", high: "Very easy", group: "everyday" },
    { key: "workMoodBefore", column: "work_mood_before", label: "Mood before work", low: "Very low", high: "Very good", group: "work" },
    { key: "workMoodDuring", column: "work_mood_during", label: "Mood during work", low: "Very low", high: "Very good", group: "work" },
    { key: "workMoodAfter", column: "work_mood_after", label: "Mood after work", low: "Very low", high: "Very good", group: "work" },
    { key: "workEnergyBefore", column: "work_energy_before", label: "Energy before work", low: "Very low", high: "Very high", group: "work" },
    { key: "workEnergyDuring", column: "work_energy_during", label: "Energy during work", low: "Very low", high: "Very high", group: "work" },
    { key: "workEnergyAfter", column: "work_energy_after", label: "Energy after work", low: "Very low", high: "Very high", group: "work" },
    { key: "trainingEnergyBefore", column: "training_energy_before", label: "Energy before training", low: "Very low", high: "Very high", group: "training" },
    { key: "trainingEnergyDuring", column: "training_energy_during", label: "Energy during training", low: "Very low", high: "Very high", group: "training" },
    { key: "trainingEnergyAfter", column: "training_energy_after", label: "Energy after training", low: "Very low", high: "Very high", group: "training" }
  ]);
  let entries = [];
  let editor = null;
  let loadingFor = "";
  let saving = false;
  let message = "";

  function domain() { return window.FuelGuardDomain; }
  function cloud() { return window.fuelGuardCloud; }
  function escape(value) { return domain()?.escapeHtml?.(value) || String(value ?? ""); }
  function uuid() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (typeof uid === "function") return uid();
    throw new Error("A secure Reflection identifier is unavailable.");
  }

  function entryFromRow(row = {}) {
    const entry = {
      id: row.id,
      userId: row.user_id,
      entryType: row.entry_type,
      observedOn: row.observed_on,
      workApplicable: row.work_applicable !== false,
      trainingApplicable: row.training_applicable !== false,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
    FIELDS.forEach(field => { entry[field.key] = row[field.column] == null ? null : Number(row[field.column]); });
    return entry;
  }

  function blankEntry(entryType = "baseline", now = new Date()) {
    const entry = {
      id: uuid(),
      entryType,
      observedOn: domain().dateKey(now),
      workApplicable: true,
      trainingApplicable: true,
      completedAt: null
    };
    FIELDS.forEach(field => { entry[field.key] = null; });
    return entry;
  }

  function baseline() {
    return entries.find(entry => entry.entryType === "baseline" && entry.completedAt) || null;
  }

  function draftBaseline() {
    return entries.find(entry => entry.entryType === "baseline" && !entry.completedAt) || null;
  }

  function completedCheckins() {
    return entries.filter(entry => entry.entryType === "checkin" && entry.completedAt)
      .sort((left, right) => String(left.observedOn).localeCompare(String(right.observedOn)));
  }

  function latestCheckin() {
    return completedCheckins().at(-1) || null;
  }

  function dueState(now = new Date()) {
    const base = baseline();
    const latest = latestCheckin();
    const anchor = latest?.observedOn || base?.observedOn || "";
    const dueOn = anchor ? domain().shiftDateKey(anchor, 14) : "";
    return { dueOn, due: Boolean(base && dueOn && domain().dateKey(now) >= dueOn) };
  }

  function reviewPrompt(now = new Date()) {
    const state = dueState(now);
    if (!state.due) return null;
    return {
      id: "everyday_reflection_review",
      occurrenceKey: `everyday-reflection-review:${state.dueOn}`,
      title: "Your Everyday check-in is ready",
      detail: "It has been around two weeks. Compare the same organisation, mood and energy ratings."
    };
  }

  function fieldsForEntry(entry = {}) {
    return FIELDS.filter(field => field.group === "everyday"
      || (field.group === "work" && entry.workApplicable)
      || (field.group === "training" && entry.trainingApplicable));
  }

  function entryComplete(entry = {}) {
    return fieldsForEntry(entry).every(field => Number.isInteger(Number(entry[field.key])) && Number(entry[field.key]) >= 1 && Number(entry[field.key]) <= 5);
  }

  function comparisons(base = baseline(), current = latestCheckin()) {
    if (!base || !current) return [];
    return FIELDS.flatMap(field => {
      const before = Number(base[field.key]);
      const after = Number(current[field.key]);
      if (!Number.isFinite(before) || !Number.isFinite(after)) return [];
      return [{ key: field.key, label: field.label, baseline: before, current: after, change: after - before }];
    });
  }

  function strongestChanges(items = comparisons()) {
    return [...items].filter(item => item.change !== 0).sort((left, right) => Math.abs(right.change) - Math.abs(left.change)).slice(0, 3);
  }

  function ratingButtons(field, value) {
    return `<div class="everyday-rating" role="group" aria-label="${escape(field.label)} from 1 to 5">${Array.from({ length: 5 }, (_, index) => index + 1).map(rating => `<button type="button" data-everyday-field="${field.key}" data-everyday-rating="${rating}" class="${Number(value) === rating ? "selected" : ""}" aria-label="${rating} out of 5" aria-pressed="${Number(value) === rating}">${rating}</button>`).join("")}</div>`;
  }

  function singleRating(field) {
    return `<section class="everyday-single-rating"><header><strong>${escape(field.label)}</strong><small>${escape(field.low)} → ${escape(field.high)}</small></header>${ratingButtons(field, editor?.entry?.[field.key])}</section>`;
  }

  function compactGroup(title, fields, applicableKey) {
    const applicable = editor?.entry?.[applicableKey] !== false;
    return `<section class="everyday-compact-group ${applicable ? "" : "not-applicable"}">
      <header><div><strong>${escape(title)}</strong><small>1 is very low · 5 is very high</small></div><button type="button" data-everyday-applicable="${applicableKey}" aria-pressed="${!applicable}">${applicable ? "Not applicable" : "Use ratings"}</button></header>
      ${applicable ? `<div class="everyday-group-rows">${fields.map(field => `<article><span>${escape(field.label.replace(" work", ""))}</span>${ratingButtons(field, editor?.entry?.[field.key])}</article>`).join("")}</div>` : `<p>This section will be stored as not applicable and excluded from comparisons.</p>`}
    </section>`;
  }

  function trainingGroup() {
    const applicable = editor?.entry?.trainingApplicable !== false;
    const fields = FIELDS.filter(field => field.group === "training");
    return `<section class="everyday-compact-group training ${applicable ? "" : "not-applicable"}">
      <header><div><strong>Training energy</strong><small>1 is very low · 5 is very high</small></div><button type="button" data-everyday-applicable="trainingApplicable" aria-pressed="${!applicable}">${applicable ? "Not applicable" : "Use ratings"}</button></header>
      ${applicable ? `<div class="everyday-group-rows">${fields.map(field => `<article><span>${escape(field.label.replace(" training", ""))}</span>${ratingButtons(field, editor?.entry?.[field.key])}</article>`).join("")}</div>` : `<p>This section will be stored as not applicable and excluded from comparisons.</p>`}
    </section>`;
  }

  function editorMarkup() {
    if (!editor?.entry) return "";
    const entry = editor.entry;
    const isBaseline = entry.entryType === "baseline";
    const everyday = FIELDS.filter(field => field.group === "everyday");
    const work = FIELDS.filter(field => field.group === "work");
    return `<div class="everyday-editor-backdrop" data-everyday-close-backdrop><section class="everyday-editor" role="dialog" aria-modal="true" aria-labelledby="everydayEditorHeading">
      <button type="button" class="everyday-editor-close" data-everyday-close aria-label="Close Everyday Reflection">×</button>
      <header><span>${isBaseline ? "Give Fuel Guard a starting point" : "Everyday check-in"}</span><h2 id="everydayEditorHeading">${isBaseline ? "Where are you today?" : "How are things going now?"}</h2><p>Tap 1–5. Today’s date is recorded automatically; unfinished progress can be saved.</p></header>
      ${everyday.map(singleRating).join("")}
      ${compactGroup("Work mood & energy", work, "workApplicable")}
      ${trainingGroup()}
      <footer><button type="button" class="secondary" data-everyday-save="draft" ${saving ? "disabled" : ""}>Save progress</button><button type="button" class="primary" data-everyday-save="complete" ${saving || !entryComplete(entry) ? "disabled" : ""}>${isBaseline ? "Complete baseline" : "Complete check-in"}</button></footer>
      ${!entryComplete(entry) ? `<p class="everyday-editor-help">Complete the applicable ratings before finishing. You can save progress and return later.</p>` : ""}
    </section></div>`;
  }

  function comparisonMarkup() {
    const items = comparisons();
    const strongest = strongestChanges(items);
    return `<section class="everyday-comparison" aria-labelledby="everydayComparisonHeading">
      <header><span>Since you started Fuel Guard</span><h3 id="everydayComparisonHeading">What’s changed most</h3><p>These are your own ratings over time. They do not show what caused a change.</p></header>
      ${strongest.length ? `<div class="everyday-strongest">${strongest.map(item => `<article><span>${escape(item.label)}</span><strong>${item.change > 0 ? "+" : ""}${item.change}</strong><small>Your rating has ${item.change > 0 ? "increased" : "decreased"} since baseline.</small></article>`).join("")}</div>` : `<p class="everyday-stable">Your latest applicable ratings match your baseline.</p>`}
      <div class="everyday-comparison-rail" tabindex="0" aria-label="Everyday baseline and current comparisons; swipe horizontally to browse">${items.map(item => `<article><span>${escape(item.label)}</span><div><b>${item.baseline}</b><i>→</i><b>${item.current}</b></div><strong>${item.change > 0 ? "+" : ""}${item.change}</strong><small>Baseline → current</small></article>`).join("")}</div>
    </section>`;
  }

  function render() {
    const target = document.getElementById("athleteEverydayReflection");
    if (!target || !domain()) return;
    const base = baseline();
    const latest = latestCheckin();
    const draft = draftBaseline();
    const due = dueState();
    target.innerHTML = `
      <section class="everyday-reflection-shell" aria-labelledby="everydayReflectionHeading">
        <header><div><span>EVERYDAY</span><h2 id="everydayReflectionHeading">Has life become easier to fuel?</h2><p>Track organisation, mood and energy separately from sport performance.</p></div><b aria-hidden="true">LIFE</b></header>
        ${!base ? `<article class="everyday-baseline-start"><span>Your Everyday baseline</span><h3>Give Fuel Guard a starting point</h3><p>Record where you are now. It will not block Daily logging, and you can save progress for later.</p><button type="button" class="primary" data-everyday-start="baseline">${draft ? "Continue baseline" : "Set Everyday baseline"}</button></article>` : `
          <div class="everyday-summary-row"><span><small>Baseline</small><strong>${escape(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${base.observedOn}T12:00:00`)))}</strong></span><span><small>Latest check-in</small><strong>${latest ? escape(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${latest.observedOn}T12:00:00`))) : "Not yet"}</strong></span><span><small>Next review</small><strong>${due.due ? "Ready now" : escape(new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(`${due.dueOn}T12:00:00`)))}</strong></span></div>
          ${latest ? comparisonMarkup() : `<article class="everyday-baseline-wait"><span>Starting point saved</span><h3>Your baseline stays preserved</h3><p>A later check-in will compare the same applicable ratings. Nothing is presented as improvement before then.</p>${due.due ? `<button type="button" class="primary" data-everyday-start="checkin">Check in</button>` : ""}</article>`}
          ${latest && due.due ? `<button type="button" class="everyday-checkin-action" data-everyday-start="checkin">New Everyday check-in</button>` : ""}
        `}
        ${message ? `<p class="everyday-status" role="status">${escape(message)}</p>` : ""}
      </section>
      ${editorMarkup()}
    `;
  }

  function resetIdentity() {
    entries = [];
    editor = null;
    loadingFor = "";
    saving = false;
    message = "";
    render();
  }

  async function load({ force = false } = {}) {
    const user = cloud()?.user;
    const client = cloud()?.client;
    const userId = String(user?.id || "");
    if (!userId || !client?.from) return resetIdentity();
    if (!force && loadingFor === userId) return render();
    loadingFor = userId;
    const requestedUser = userId;
    const result = await client.from(TABLE).select(COLUMNS).eq("user_id", userId).order("observed_on", { ascending: true }).order("created_at", { ascending: true });
    if (String(cloud()?.user?.id || "") !== requestedUser) return;
    if (result.error) {
      loadingFor = "";
      message = /fuel_everyday_reflections|schema cache|does not exist/i.test(String(result.error.message || ""))
        ? "Everyday Reflection is waiting for its additive release migration."
        : `Everyday Reflection could not load: ${result.error.message || "unknown error"}`;
    } else {
      entries = (result.data || []).map(entryFromRow);
      message = "";
    }
    render();
  }

  function rowFromEntry(entry, userId, { complete = false } = {}) {
    const row = {
      id: entry.id,
      user_id: userId,
      entry_type: entry.entryType,
      observed_on: entry.observedOn,
      work_applicable: entry.workApplicable,
      training_applicable: entry.trainingApplicable,
      completed_at: complete ? (entry.completedAt || new Date().toISOString()) : entry.completedAt,
      updated_at: new Date().toISOString()
    };
    FIELDS.forEach(field => { row[field.column] = Number.isInteger(Number(entry[field.key])) ? Number(entry[field.key]) : null; });
    return row;
  }

  async function saveEntry(complete = false) {
    const user = cloud()?.user;
    const client = cloud()?.client;
    if (saving || !user?.id || !client?.from || !editor?.entry) return;
    if (complete && !entryComplete(editor.entry)) return;
    saving = true;
    render();
    const entry = editor.entry;
    try {
      const result = await client.from(TABLE).upsert(rowFromEntry(entry, user.id, { complete }), { onConflict: "id" }).select(COLUMNS).single();
      if (result.error) throw result.error;
      const saved = entryFromRow(result.data);
      entries = [saved, ...entries.filter(item => item.id !== saved.id)].sort((left, right) => String(left.observedOn).localeCompare(String(right.observedOn)));
      message = complete
        ? saved.entryType === "baseline" ? "Everyday baseline preserved. Your first review will be ready in around two weeks." : "Everyday check-in saved."
        : "Everyday baseline progress saved.";
      editor = complete ? null : { entry: { ...saved } };
    } catch (error) {
      message = `Everyday Reflection could not save: ${error?.message || "unknown error"}`;
    } finally {
      saving = false;
      render();
    }
  }

  document.addEventListener("click", event => {
    const start = event.target.closest("[data-everyday-start]");
    if (start) {
      const type = start.dataset.everydayStart;
      const existingDraft = type === "baseline" ? draftBaseline() : entries.find(entry => entry.entryType === "checkin" && !entry.completedAt && entry.observedOn === domain().dateKey(new Date()));
      editor = { entry: { ...(existingDraft || blankEntry(type)) } };
      return render();
    }
    const rating = event.target.closest("[data-everyday-rating]");
    if (rating && editor?.entry) {
      editor.entry[rating.dataset.everydayField] = Number(rating.dataset.everydayRating);
      return render();
    }
    const applicable = event.target.closest("[data-everyday-applicable]");
    if (applicable && editor?.entry) {
      const key = applicable.dataset.everydayApplicable;
      editor.entry[key] = !editor.entry[key];
      return render();
    }
    const saveButton = event.target.closest("[data-everyday-save]");
    if (saveButton) return saveEntry(saveButton.dataset.everydaySave === "complete");
    if (event.target.closest("[data-everyday-close]")) { editor = null; return render(); }
    if (event.target.matches("[data-everyday-close-backdrop]")) { editor = null; return render(); }
  });
  window.addEventListener("fuelguard:cloud-status", () => load());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load({ force: true }); });
  document.addEventListener("DOMContentLoaded", () => load());

  window.FuelGuardEverydayReflection = Object.freeze({
    render,
    load,
    dueState,
    reviewPrompt,
    _test: Object.freeze({ entryFromRow, blankEntry, entryComplete, comparisons, strongestChanges, rowFromEntry, FIELDS })
  });
})();
