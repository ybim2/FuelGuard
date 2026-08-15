const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20260815080754_product_usage_analytics.sql");
const clientSource = read("product-analytics.js");
const adminSource = read("performance/product-analytics.js");
const performanceSource = read("performance/performance.js");
const performanceHtml = read("performance/index.html");
const performanceCss = read("performance/performance.css");
const athleteHtml = read("index.html");
const worker = read("sw.js");
const definitions = read("docs/PRODUCT_ANALYTICS_DEFINITIONS.md");

const analytics = require("../product-analytics.js");
const admin = require("../performance/product-analytics.js");

test("analytics tables are minimal, indexed and tied to authenticated users", () => {
  assert.match(migration, /create table public\.fuel_product_events/);
  assert.match(migration, /user_id uuid not null references auth\.users\(id\) on delete cascade/);
  assert.match(migration, /create unique index fuel_product_events_user_dedupe_idx/);
  assert.match(migration, /create index fuel_product_events_user_occurred_idx/);
  assert.match(migration, /metadata jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /pg_column_size\(metadata\) <= 2048/);
});

test("event and attribution rows use owner-only RLS without direct client writes", () => {
  for (const table of ["fuel_product_events", "fuel_product_attribution"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
    assert.match(migration, new RegExp(`grant select on table public\\.${table} to authenticated`));
  }
  assert.doesNotMatch(migration, /grant insert on table public\.fuel_product_(?:events|attribution) to authenticated/);
  assert.match(migration, /using \(\(select auth\.uid\(\)\) = user_id\)/);
});

test("event ingestion derives identity and time on the server", () => {
  const fn = migration.match(/create or replace function public\.fuel_track_product_event[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(fn, /caller_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /occurred_at timestamptz not null default now\(\)/);
  assert.doesNotMatch(fn, /p_occurred_at/);
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = ''/);
  assert.doesNotMatch(fn, /p_user_id/);
});

test("event ingestion rejects arbitrary events and rich metadata", () => {
  assert.match(migration, /Unsupported Fuel Guard product event/);
  assert.match(migration, /Analytics metadata contains an unsupported field/);
  assert.match(migration, /Analytics metadata values must be scalar/);
  assert.match(migration, /'failure_category'/);
  assert.doesNotMatch(clientSource, /journal|reflection_text|password|access_token|refresh_token/i);
});

test("first-touch attribution is immutable and campaign-limited", () => {
  const fn = migration.match(/create or replace function public\.fuel_capture_first_touch_attribution[\s\S]*?\$\$;/)?.[0] || "";
  assert.match(fn, /on conflict \(user_id\) do nothing/);
  for (const field of ["source", "medium", "campaign", "creator", "content", "landing_variant"]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
  assert.match(clientSource, /fuelGuardProductAnalytics:firstTouch/);
  assert.match(clientSource, /utm_source/);
  assert.match(clientSource, /utm_creator/);
});

test("historical meaningful actions come from canonical domain records", () => {
  for (const table of [
    "fuel_logs",
    "fuel_supplement_events",
    "fuel_training_mode_sessions",
    "fuel_everyday_reflections",
    "fuel_performance_results",
    "fuel_training_feedback",
    "fuel_work_patterns"
  ]) assert.match(migration, new RegExp(`public\\.${table}`));
  assert.match(migration, /create or replace view private\.fuel_product_meaningful_actions/);
});

test("activation excludes passive account and screen events", () => {
  const activation = migration.match(/activation as \([\s\S]*?\),\n  usage as/)?.[0] || "";
  assert.match(activation, /from actions action/);
  assert.doesNotMatch(activation, /app_open|session_started|daily_mode_viewed/);
  assert.match(definitions, /Account creation, sign-in, app open and page view do not activate/);
});

test("local-day activity and aged retention windows are explicit", () => {
  assert.match(migration, /timezone\(user_timezone\.timezone_name, action\.occurred_at\)::date as local_day/);
  assert.match(migration, /action\.local_day = account\.today_local/);
  assert.match(migration, /activation\.activation_day \+ 7 and activation\.activation_day \+ 13/);
  assert.match(migration, /activation\.activation_day \+ 30 and activation\.activation_day \+ 36/);
  assert.match(definitions, /Only cohorts old enough to reach a window enter its denominator/);
});

test("founder summary exposes samples and unavailable funnel stages honestly", () => {
  assert.match(migration, /'d1'.*'denominator'/s);
  assert.match(migration, /'d7'.*'denominator'/s);
  assert.match(migration, /'d30'.*'denominator'/s);
  assert.match(migration, /'visitors', null/);
  assert.match(migration, /'paid', null/);
  assert.match(migration, /'signedUpNotActivated'/);
  assert.match(migration, /'activatedNotRetained'/);
  assert.match(migration, /'failures'/);
  assert.match(adminSource, /Funnel &amp; failures/);
  assert.match(adminSource, /Historical app opens are not invented/);
});

test("all founder analytics operations require platform-admin identity", () => {
  for (const name of [
    "fuel_product_analytics_summary",
    "fuel_product_analytics_user",
    "fuel_product_analytics_set_exclusion"
  ]) {
    const fn = migration.match(new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`))?.[0] || "";
    assert.match(fn, /private\.fuel_is_active_platform_admin/);
    assert.match(fn, /Fuel Guard product analytics access denied/);
  }
});

test("test-account exclusions are reversible and audited", () => {
  assert.match(migration, /create table private\.fuel_product_analytics_exclusions/);
  assert.match(migration, /test_account_excluded/);
  assert.match(migration, /test_account_included/);
  assert.match(migration, /delete from private\.fuel_product_analytics_exclusions/);
  assert.match(performanceHtml, /Include test accounts/);
  assert.match(adminSource, /Mark as test account/);
});

test("client metadata strips unapproved and non-scalar values", () => {
  const safe = analytics._test.safeMetadata({
    source: "daily_mode",
    count: 3,
    secret: "must-not-leave",
    note: { private: true }
  });
  assert.equal(safe.source, "daily_mode");
  assert.equal(safe.count, 3);
  assert.equal(safe.secret, undefined);
  assert.equal(safe.note, undefined);
  assert.equal(safe.environment, "preview");
});

test("client failure reporting uses privacy-safe categories", () => {
  assert.equal(analytics._test.failureCategory(new Error("Failed to fetch")), "network");
  assert.equal(analytics._test.failureCategory(new Error("row-level permission denied")), "authorization");
  assert.equal(analytics._test.failureCategory(new Error("PGRST schema cache")), "database");
  assert.equal(analytics._test.failureCategory(new Error("raw message")), "unknown");
});

test("client tracking never accepts a user id and treats analytics errors as non-blocking", async () => {
  const calls = [];
  global.fuelGuardCloud = {
    user: { id: "11111111-1111-4111-8111-111111111111" },
    client: { rpc: async (name, params) => { calls.push({ name, params }); return { data: "event-id", error: null }; } }
  };
  try {
    const result = await analytics.track("app_open", { metadata: { source: "test" } });
    assert.equal(result.status, "recorded");
    assert.equal(calls[0].name, "fuel_track_product_event");
    assert.equal("p_user_id" in calls[0].params, false);
    global.fuelGuardCloud.client.rpc = async () => { throw new Error("offline"); };
    assert.deepEqual(await analytics.track("app_open"), { status: "error", category: "network" });
  } finally {
    delete global.fuelGuardCloud;
  }
});

test("confirmed actions, account switching and lifecycle are instrumented", () => {
  for (const event of [
    "fuelguard:private-app-ready",
    "fuelguard:auth-state",
    "fuelguard:logging-confirmed",
    "fuelguard:supplement-logged",
    "fuelguard:training-session-synced",
    "pagehide"
  ]) assert.match(clientSource, new RegExp(event.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(clientSource, /requestUserId !== userId\(\)/);
  assert.match(clientSource, /getItem\?\.\(ACCOUNT_CREATED_KEY\) === nextUserId/);
  assert.match(read("fuel-auth.js"), /markAccountCreatedPending\?\.\(result\?\.user\?\.id\)/);
});

test("founder dashboard is hidden from ordinary Performance users", () => {
  assert.match(performanceHtml, /id="productAnalyticsNavButton"[^>]*hidden/);
  assert.match(performanceSource, /FuelGuardProductAnalyticsAdmin\?\.configure/);
  assert.match(performanceSource, /authorised: isPlatformAdmin/);
  assert.match(performanceSource, /tab === "productAnalytics" && !state\.platformAdmin\.isPlatformAdmin/);
});

test("platform admins without organisation membership can still open founder analytics", () => {
  assert.match(performanceSource, /if \(isPlatformAdmin\)[\s\S]*showTab\("productAnalytics"\)/);
  assert.match(performanceSource, /Founder analytics/);
  assert.match(performanceSource, /organisationPickerLabel[^\n]*!state\.contexts\.length/);
});

test("dashboard renders activation, retention, cohorts, attribution and user timelines", () => {
  for (const label of ["Usage &amp; Retention", "Individual usage", "Weekly signup cohorts", "Acquisition"]) {
    assert.match(`${performanceHtml}\n${adminSource}`, new RegExp(label));
  }
  assert.match(adminSource, /fuel_product_analytics_summary/);
  assert.match(adminSource, /fuel_product_analytics_user/);
  assert.match(adminSource, /Product activity timeline/);
  assert.match(performanceCss, /\.product-analytics-metric-grid/);
});

test("retention labels include sample numerators and denominators", () => {
  assert.equal(admin._test.retentionLabel({ percentage: 25, numerator: 2, denominator: 8 }), "25% (2/8)");
  assert.equal(admin._test.retentionLabel({ percentage: null, numerator: 0, denominator: 0 }), "Not enough eligible users");
});

test("canonical PWA loads and caches the analytics modules with a fresh shell", () => {
  assert.match(athleteHtml, /product-analytics\.js\?v=mobile-pwa-v155-training-nutrition-analytics/);
  assert.match(performanceHtml, /performance\.js\?v=mobile-pwa-v155-training-nutrition-analytics/);
  assert.match(worker, /\.\/product-analytics\.js/);
  assert.match(worker, /\.\/performance\/product-analytics\.js/);
  assert.match(worker, /fuel-guard-mobile-pwa-v155-training-nutrition-analytics-20260815T175813Z/);
});

test("analytics definitions document privacy, exclusions and known unavailable metrics", () => {
  assert.match(definitions, /Visitor totals and visitor-to-signup conversion are unavailable/);
  assert.match(definitions, /Paid conversion is also unavailable/);
  assert.match(definitions, /Analytics write failures are swallowed/);
  assert.match(definitions, /exclusion is auditable and reversible/i);
});
