(function attachFuelGuardProductAnalyticsAdmin(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardProductAnalyticsAdmin = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardProductAnalyticsAdmin(root) {
  "use strict";

  let client = null;
  let session = null;
  let authorised = false;
  let summary = null;
  let busy = false;
  let selectedUserId = "";

  const $ = id => root?.document?.getElementById?.(id) || null;
  const safe = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "—";
  const percent = value => value == null ? "—" : `${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}%`;
  const dateTime = value => {
    if (!value) return "Not yet";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Unknown" : parsed.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  };
  const shortDate = value => {
    if (!value) return "—";
    const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString([], { day: "numeric", month: "short" });
  };

  function retentionLabel(metric) {
    if (!metric || !metric.denominator) return "Not enough eligible users";
    return `${percent(metric.percentage)} (${number(metric.numerator)}/${number(metric.denominator)})`;
  }

  function engagementLabel(value) {
    return ({
      signed_up: "Signed up",
      activated: "Activated",
      active: "Active",
      retained: "Retained",
      at_risk: "At risk",
      dormant: "Dormant"
    })[value] || "Unknown";
  }

  function eventLabel(value) {
    return String(value || "Activity").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function metric(label, value, note = "") {
    return `<article class="product-analytics-metric"><span>${safe(label)}</span><strong>${safe(value)}</strong><small>${safe(note)}</small></article>`;
  }

  function empty(title, copy) {
    return `<div class="empty-state"><strong>${safe(title)}</strong><p>${safe(copy)}</p></div>`;
  }

  async function rpc(name, params = {}) {
    if (!authorised || !client?.rpc || !session?.user?.id) throw new Error("Founder analytics access is not available.");
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  function renderOverview(data) {
    const overview = data.overview || {};
    const retention = data.retention || {};
    const engagement = data.engagement || {};
    return `
      <section class="product-analytics-section">
        <div class="section-heading"><div><h2>Overview</h2><p>Account, activation and meaningful usage.</p></div><span class="status-badge available">${safe(data.definitionsVersion || "v1")}</span></div>
        <div class="product-analytics-metric-grid">
          ${metric("Total users", number(overview.totalUsers), `${number(overview.newUsers7d)} joined in 7 days`)}
          ${metric("Activated", number(overview.activatedUsers), `${percent(overview.activationRate)} of accounts`)}
          ${metric("DAU", number(overview.dau), "Meaningfully active today")}
          ${metric("WAU", number(overview.wau), "Meaningfully active in 7 days")}
          ${metric("MAU", number(overview.mau), `${percent(overview.dauMau)} DAU / MAU`)}
          ${metric("Median activation", overview.medianHoursToActivation == null ? "—" : `${overview.medianHoursToActivation}h`, "Signup to first meaningful action")}
        </div>
      </section>
      <section class="product-analytics-section">
        <div class="section-heading"><div><h2>Retention</h2><p>Only aged, activated cohorts enter each denominator.</p></div></div>
        <div class="product-analytics-metric-grid retention">
          ${metric("D1", retentionLabel(retention.d1), "Returned the next local day")}
          ${metric("D7", retentionLabel(retention.d7), "Returned 7–13 local days later")}
          ${metric("D30", retentionLabel(retention.d30), "Returned 30–36 local days later")}
          ${metric("Week 1", retentionLabel(retention.week1), "Meaningful action on days 1–7")}
          ${metric("Week 2", retentionLabel(retention.week2), "Meaningful action on days 8–14")}
          ${metric("Week 4", retentionLabel(retention.week4), "Meaningful action on days 22–28")}
        </div>
      </section>
      <section class="product-analytics-section">
        <div class="section-heading"><div><h2>Engagement</h2><p>Behaviour rather than passive authentication refreshes.</p></div></div>
        <div class="product-analytics-metric-grid">
          ${metric("Active days / user", number(engagement.averageActiveDays30d), "Average in 30 days")}
          ${metric("Actions / active day", number(engagement.averageActionsPerActiveDay30d), "Average in 30 days")}
          ${metric("Median actions", number(engagement.medianActionsLifetime), "Lifetime per account")}
          ${metric("3+ days this week", number(engagement.usersActive3DaysThisWeek), "Meaningfully active users")}
          ${metric("5+ days this week", number(engagement.usersActive5DaysThisWeek), "Meaningfully active users")}
          ${metric("Inactive 30d", number(overview.inactive30d), `${number(overview.inactive7d)} inactive 7d`)}
        </div>
      </section>`;
  }

  function renderFeatureUsage(data) {
    const features = Array.isArray(data.featureUsage) ? data.featureUsage : [];
    return `<section class="product-analytics-section">
      <div class="section-heading"><div><h2>Feature usage</h2><p>Unique users and total events prevent one power user distorting adoption.</p></div></div>
      <div class="product-analytics-feature-list">${features.map(feature => `<article>
        <strong>${safe(feature.feature)}</strong>
        <span>${number(feature.users)} users</span>
        <small>${number(feature.events)} events</small>
      </article>`).join("")}</div>
    </section>`;
  }

  function renderFunnelAndFailures(data) {
    const funnel = data.funnel || {};
    const failures = Array.isArray(data.failures) ? data.failures : [];
    const steps = [
      ["Visitors", funnel.visitors, "Unavailable until anonymous acquisition tracking exists"],
      ["Signups", funnel.signups, `${number(funnel.signedUpNotActivated)} have not activated`],
      ["Activated", funnel.activated, `${number(funnel.activatedNotRetained)} have not yet retained`],
      ["Retained", funnel.retained, "Meaningful action at least seven local days later"],
      ["Paid", funnel.paid, "Unavailable until a canonical billing source exists"]
    ];
    return `<section class="product-analytics-section">
      <div class="section-heading"><div><h2>Funnel &amp; failures</h2><p>Drop-off is separated from product errors; unavailable stages are never shown as zero.</p></div></div>
      <div class="product-analytics-funnel">${steps.map(([label, value, note]) => `<article><span>${safe(label)}</span><strong>${value == null ? "Unavailable" : number(value)}</strong><small>${safe(note)}</small></article>`).join("")}</div>
      <div class="product-analytics-failures">
        <h3>Failed actions</h3>
        ${failures.length ? failures.map(failure => `<article><strong>${safe(eventLabel(failure.eventName))}</strong><span>${safe(eventLabel(failure.category))}</span><small>${number(failure.events)} attempts · ${number(failure.users)} users · latest ${safe(dateTime(failure.lastOccurredAt))}</small></article>`).join("") : '<p class="product-analytics-footnote">No privacy-minimised failure events have been recorded.</p>'}
      </div>
    </section>`;
  }

  function renderCohorts(data) {
    const cohorts = Array.isArray(data.cohorts) ? data.cohorts : [];
    return `<section class="product-analytics-section">
      <div class="section-heading"><div><h2>Weekly signup cohorts</h2><p>Unaged retention cells remain unavailable.</p></div></div>
      <div class="product-analytics-table-wrap"><table class="product-analytics-table">
        <thead><tr><th>Cohort</th><th>Users</th><th>Activated</th><th>D1</th><th>D7</th><th>D30</th></tr></thead>
        <tbody>${cohorts.map(cohort => `<tr>
          <td>${safe(shortDate(cohort.cohortWeek))}</td>
          <td>${number(cohort.users)}</td>
          <td>${number(cohort.activated)}</td>
          <td>${cohort.d1 == null ? "—" : `${percent(cohort.d1)} (${number(cohort.d1Sample)})`}</td>
          <td>${cohort.d7 == null ? "—" : `${percent(cohort.d7)} (${number(cohort.d7Sample)})`}</td>
          <td>${cohort.d30 == null ? "—" : `${percent(cohort.d30)} (${number(cohort.d30Sample)})`}</td>
        </tr>`).join("") || '<tr><td colspan="6">No cohorts yet.</td></tr>'}</tbody>
      </table></div>
    </section>`;
  }

  function renderAcquisition(data) {
    const rows = Array.isArray(data.acquisition) ? data.acquisition : [];
    const coverage = data.eventCoverage || {};
    return `<section class="product-analytics-section">
      <div class="section-heading"><div><h2>Acquisition</h2><p>First-touch source, campaign and creator; visitors remain unavailable until anonymous acquisition tracking exists.</p></div></div>
      <div class="product-analytics-table-wrap"><table class="product-analytics-table">
        <thead><tr><th>Source</th><th>Campaign / creator</th><th>Signups</th><th>Activated</th><th>Retained</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${safe(row.source)}</td><td>${safe([row.campaign, row.creator].filter(Boolean).join(" · ") || "—")}</td><td>${number(row.signups)}</td><td>${number(row.activated)}</td><td>${number(row.retained)}</td></tr>`).join("")}</tbody>
      </table></div>
      <p class="product-analytics-footnote">${number(coverage.explicitEvents)} explicit events from ${number(coverage.usersWithExplicitEvents)} users. Historical app opens are not invented.</p>
    </section>`;
  }

  function renderUsers(data) {
    const users = Array.isArray(data.users) ? data.users : [];
    return `<section class="product-analytics-section">
      <div class="section-heading"><div><h2>Individual usage</h2><p>Open an account to understand product activity without querying Supabase manually.</p></div><label class="product-analytics-search">Search<input id="productAnalyticsUserSearch" type="search" placeholder="Name or email" /></label></div>
      <div id="productAnalyticsUserRows" class="product-analytics-user-list">${userRows(users)}</div>
    </section>`;
  }

  function userRows(users, query = "") {
    const normalized = String(query || "").trim().toLowerCase();
    const filtered = users.filter(user => !normalized || `${user.displayName} ${user.email}`.toLowerCase().includes(normalized));
    return filtered.map(user => `<button type="button" data-product-analytics-user="${safe(user.userId)}">
      <span><strong>${safe(user.displayName)}</strong><small>${safe(user.email)}</small></span>
      <span><b class="engagement-state ${safe(user.engagementState)}">${safe(engagementLabel(user.engagementState))}</b><small>${number(user.activeDays30d)} active days · ${number(user.totalActions)} actions</small></span>
      <span><strong>${safe(dateTime(user.lastActivityAt))}</strong><small>Last meaningful activity</small></span>
    </button>`).join("") || empty("No matching users", "Try another name or email.");
  }

  function render() {
    const target = $("productAnalyticsContent");
    if (!target) return;
    if (!authorised) {
      target.innerHTML = empty("Founder access required", "This view is available only to an active Fuel Guard platform administrator.");
      return;
    }
    if (!summary) {
      target.innerHTML = empty("Loading product analytics", "Deriving activation, retention and feature usage from Fuel Guard records…");
      return;
    }
    target.innerHTML = `${renderOverview(summary)}${renderFunnelAndFailures(summary)}${renderFeatureUsage(summary)}${renderCohorts(summary)}${renderAcquisition(summary)}${renderUsers(summary)}`;
  }

  async function load({ force = false } = {}) {
    if (!authorised || busy || (summary && !force)) return summary;
    busy = true;
    if (!summary) render();
    try {
      summary = await rpc("fuel_product_analytics_summary", {
        p_include_excluded: Boolean($("productAnalyticsIncludeExcluded")?.checked)
      });
      render();
      return summary;
    } catch (error) {
      const target = $("productAnalyticsContent");
      if (target) target.innerHTML = empty("Product analytics unavailable", error?.message || "The founder analytics RPC could not be loaded.");
      return null;
    } finally {
      busy = false;
    }
  }

  function timelineMarkup(items = []) {
    return items.map(item => `<li><time>${safe(dateTime(item.occurredAt))}</time><span><strong>${safe(eventLabel(item.eventName))}</strong><small>${safe(item.source === "derived_core_action" ? "Authoritative Fuel Guard record" : item.context?.failureCategory || item.context?.platform || "Explicit product event")}</small></span></li>`).join("") || "<li>No activity recorded.</li>";
  }

  async function openUser(userId) {
    selectedUserId = String(userId || "");
    const target = $("productAnalyticsUserDetail");
    if (!target || !selectedUserId) return;
    target.hidden = false;
    target.innerHTML = empty("Loading user activity", "Resolving the privacy-minimised product timeline…");
    try {
      const detail = await rpc("fuel_product_analytics_user", { p_user_id: selectedUserId });
      const account = detail.account || {};
      const usage = detail.usage || {};
      target.innerHTML = `
        <div class="section-heading"><div><p class="eyebrow">Individual product usage</p><h2>${safe(account.displayName || "Fuel Guard user")}</h2><p>${safe(account.email || "")}</p></div><button type="button" class="text-button" data-product-analytics-close>Close</button></div>
        <div class="product-analytics-metric-grid compact">
          ${metric("Joined", dateTime(account.joinedAt), account.timezoneName || "UTC")}
          ${metric("Activated", dateTime(detail.activation?.activationAt), detail.activation?.hoursToActivation == null ? "No meaningful action" : `${detail.activation.hoursToActivation}h after signup`)}
          ${metric("Active days", number(usage.activeDaysLifetime), `${number(usage.activeDays30d)} in 30 days`)}
          ${metric("Meaningful actions", number(usage.totalMeaningfulActions), `${number(usage.fuelLogs)} fuel · ${number(usage.hydrationLogs)} hydration`)}
          ${metric("Training", number(usage.trainingSessions), `${number(usage.reflections)} reflections`)}
          ${metric("Connections", `${usage.garminConnected ? "Garmin" : "No Garmin"} · ${usage.coachConnected ? "Coach" : "No Coach"}`, "Current active connections")}
        </div>
        <div class="product-analytics-detail-actions">
          <button type="button" class="secondary-button" data-product-analytics-exclusion="${account.excludedFromMetrics ? "include" : "exclude"}">${account.excludedFromMetrics ? "Include in metrics" : "Mark as test account"}</button>
          ${account.exclusionReason ? `<small>${safe(account.exclusionReason)}</small>` : ""}
        </div>
        <h3>Product activity timeline</h3>
        <ol class="product-analytics-timeline">${timelineMarkup(detail.timeline || [])}</ol>`;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      target.innerHTML = empty("User activity unavailable", error?.message || "The user detail could not be loaded.");
    }
  }

  async function setExclusion(action) {
    if (!selectedUserId) return;
    const excluded = action === "exclude";
    const reason = excluded ? "Test or development account" : "Included in founder metrics";
    await rpc("fuel_product_analytics_set_exclusion", {
      p_user_id: selectedUserId,
      p_excluded: excluded,
      p_reason: reason
    });
    summary = null;
    await load({ force: true });
    await openUser(selectedUserId);
  }

  function configure(options = {}) {
    client = options.client || null;
    session = options.session || null;
    authorised = Boolean(options.authorised && client && session?.user?.id);
    if (!authorised) {
      summary = null;
      selectedUserId = "";
      const detail = $("productAnalyticsUserDetail");
      if (detail) detail.hidden = true;
    }
    return authorised;
  }

  root?.document?.addEventListener?.("click", event => {
    const user = event.target.closest?.("[data-product-analytics-user]");
    if (user) { void openUser(user.dataset.productAnalyticsUser); return; }
    if (event.target.closest?.("[data-product-analytics-close]")) {
      selectedUserId = "";
      $("productAnalyticsUserDetail").hidden = true;
      return;
    }
    const exclusion = event.target.closest?.("[data-product-analytics-exclusion]");
    if (exclusion) void setExclusion(exclusion.dataset.productAnalyticsExclusion);
  });
  root?.document?.addEventListener?.("input", event => {
    if (event.target.id !== "productAnalyticsUserSearch" || !summary) return;
    const target = $("productAnalyticsUserRows");
    if (target) target.innerHTML = userRows(summary.users || [], event.target.value);
  });
  root?.document?.addEventListener?.("change", event => {
    if (event.target.id !== "productAnalyticsIncludeExcluded") return;
    summary = null;
    void load({ force: true });
  });

  return Object.freeze({
    configure,
    load,
    render,
    openUser,
    _test: Object.freeze({ retentionLabel, engagementLabel, eventLabel, userRows })
  });
});
