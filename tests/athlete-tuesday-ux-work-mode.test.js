const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadState(saved) {
  const storage = new Map(saved ? [["fuelGuardStateV20", JSON.stringify(saved)]] : []);
  const sandbox = {
    console,
    Date,
    Intl,
    crypto: { randomUUID: () => "b9000000-0000-4000-8000-000000000001" },
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    }
  };
  vm.runInNewContext(read("app-state.js"), sandbox, { filename: "app-state.js" });
  return { sandbox, storage };
}

function loadMilestoneTests() {
  const target = { innerHTML: "" };
  const sandbox = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    requestAnimationFrame() {},
    document: {
      addEventListener() {},
      getElementById() { return target; }
    },
    fuelGapState: () => ({ logs: [], milestones: { achievements: [] } }),
    FuelGuardDomain: domain,
    addEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("athlete-milestones.js"), sandbox, { filename: "athlete-milestones.js" });
  return sandbox.FuelGuardMilestones._test;
}

function loadMilestoneRuntime({ historyReady }) {
  const target = { innerHTML: "" };
  const gap = {
    logs: [{ id: "today", type: "fuel", timestamp: new Date().toISOString(), source: "manual" }],
    milestones: { achievements: [], lastSummary: null }
  };
  const sandbox = {
    console,
    Date,
    setTimeout,
    clearTimeout,
    requestAnimationFrame() {},
    document: { addEventListener() {}, getElementById(id) { return id === "athleteMilestones" ? target : null; } },
    fuelGapState: () => gap,
    FuelGuardDomain: domain,
    fuelGuardCloud: { historyReadiness: () => ({ ready: historyReady, status: historyReady ? "ready" : "loading" }) },
    addEventListener() {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(read("athlete-milestones.js"), sandbox, { filename: "athlete-milestones.js" });
  return { api: sandbox.FuelGuardMilestones, gap, target };
}

test("service-worker acquisition never reloads the visible app until Settings explicitly activates an update", async () => {
  const workerMessages = [];
  const serviceWorkerListeners = {};
  const windowListeners = {};
  const registration = {
    waiting: { postMessage(message) { workerMessages.push(message); } },
    installing: null,
    update: async () => {},
    addEventListener() {}
  };
  let reloads = 0;
  const sandbox = {
    console,
    CustomEvent: class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    navigator: {
      serviceWorker: {
        controller: null,
        addEventListener(type, listener) { serviceWorkerListeners[type] = listener; },
        register: async () => registration
      }
    },
    FUEL_GUARD_BUILD: { buildVersion: "test", serviceWorkerUrl: "/sw.js?v=test", serviceWorkerScope: "/" },
    location: { reload() { reloads += 1; } },
    dispatchEvent() {},
    addEventListener(type, listener) { windowListeners[type] = listener; }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("app-pwa.js"), sandbox, { filename: "app-pwa.js" });

  windowListeners.load();
  await new Promise(resolve => setImmediate(resolve));
  serviceWorkerListeners.controllerchange();
  assert.equal(reloads, 0);
  assert.equal(workerMessages.length, 0);

  const result = await sandbox.fuelGuardPwaUpdates.checkForUpdate();
  assert.equal(result.status, "activating");
  assert.equal(workerMessages.length, 1);
  assert.equal(workerMessages[0].type, "SKIP_WAITING");
  serviceWorkerListeners.controllerchange();
  assert.equal(reloads, 1);
});

test("the authentication boundary owns startup and private Daily starts once authorised", () => {
  const html = read("index.html");
  const beta = read("fuel-beta.js");
  assert.equal((html.match(/class="beta-mvp auth-pending"/g) || []).length, 1);
  assert.match(html, /id="fuelGuardPrivateApp"[^>]*hidden inert/);
  assert.equal((beta.match(/fuelguard:private-app-ready/g) || []).length, 1);
  assert.equal((beta.match(/classList\.add\("app-booting"\)/g) || []).length, 0);
  const worker = read("sw.js");
  const installHandler = worker.slice(worker.indexOf('addEventListener("install"'), worker.indexOf('addEventListener("message"'));
  assert.doesNotMatch(installHandler, /skipWaiting\(\)/);
});

test("authentication screen keeps one concise permanent product explanation", () => {
  const html = read("index.html");
  const beta = read("fuel-beta.js");
  assert.match(html, /Fuel Guard helps athletes stay aware of fuelling, hydration and sleepy moments throughout the day/);
  assert.equal((html.match(/Fuel Guard helps athletes stay aware of fuelling, hydration and sleepy moments throughout the day/g) || []).length, 1);
  assert.doesNotMatch(beta, /fuelGuardLoadingHooks/);
});

test("Training Mode uses behaviour language and Settings contains the subtle Hal tribute", () => {
  assert.match(read("training-mode.js"), /How often do you intend to fuel\?/);
  assert.doesNotMatch(read("training-mode.js"), /How often do you intend to tap\?/);
  const html = read("index.html");
  const css = read("fuel-beta.css");
  assert.match(html, /id="halTributeButton"[\s\S]*id="halTributeMessage"[^>]*hidden>For H 🧡 — thanks for the push\./);
  assert.match(css, /\.beta-hal-tribute-button span[\s\S]*background: #e77a2d/);
});

test("Daily streak milestones expose 3, 7, 14, 30, 60 and 100 day lock states", () => {
  const milestones = loadMilestoneTests().streakMilestoneProgress(14);
  assert.deepEqual(Array.from(milestones, item => item.threshold), [3, 7, 14, 30, 60, 100]);
  assert.deepEqual(Array.from(milestones, item => item.state), ["unlocked", "unlocked", "unlocked", "next", "locked", "locked"]);
  const css = read("fuel-beta.css");
  assert.match(css, /\.beta-streak-milestone-track \{[\s\S]*overflow-x: auto;[\s\S]*scroll-snap-type: inline proximity;/);
  assert.match(css, /\.beta-streak-visuals \{[\s\S]*margin-top: 6px;/);
  assert.doesNotMatch(read("index.html").slice(read("index.html").indexOf('id="dashboard"'), read("index.html").indexOf('id="training"')), /FG Points|next reward/i);
});

test("Daily streaks do not publish or persist a partial local value before canonical history is ready", () => {
  const pending = loadMilestoneRuntime({ historyReady: false });
  assert.deepEqual(Array.from(pending.api.evaluate({ allowToast: false })), []);
  assert.equal(pending.gap.milestones.lastSummary, null);
  assert.match(pending.target.innerHTML, /Checking full history/);

  const ready = loadMilestoneRuntime({ historyReady: true });
  ready.api.evaluate({ allowToast: false });
  assert.equal(ready.gap.milestones.lastSummary.dayStreak, 1);
  assert.match(ready.target.innerHTML, /Fuel moments/);
});

test("primary Athlete navigation is Daily, Training, Reflection, Analytics and Tools", () => {
  const html = read("index.html");
  const nav = html.slice(html.indexOf('<nav class="mobile-bottom-nav'), html.indexOf('<script src="build-info.js'));
  const impact = nav.indexOf('data-mobile-tab="impact"');
  const daily = nav.indexOf('data-mobile-tab="log"');
  const training = nav.indexOf('data-mobile-tab="training"');
  const analytics = nav.indexOf('data-mobile-tab="analytics"');
  const tools = nav.indexOf('data-mobile-tab="tools"');
  assert.ok(daily < training && training < impact && impact < analytics && analytics < tools);
  assert.match(nav.slice(daily, training), /m6 15 3-4 3 3 5-7/);
  assert.match(nav.slice(training, impact), /circle cx="14" cy="4"[\s\S]*m8 21 3-6/);
  assert.match(nav.slice(impact), /<span>Reflection<\/span>/);
  assert.match(nav.slice(impact), /<circle[\s\S]*m14 10 5-5/);
  assert.match(read("fuel-beta.css"), /min-height: calc\(52px \+ env\(safe-area-inset-bottom/);
});

test("Work Mode summary uses only associated canonical Fuel, Hydration and Sleepy records", () => {
  const session = { id: "work-current", status: "completed", startedAt: "2026-08-10T08:00:00Z", endedAt: "2026-08-10T17:00:00Z" };
  const logs = [
    { type: "fuel", timestamp: "2026-08-10T08:30:00Z", workModeSessionId: "work-current" },
    { type: "fuel", timestamp: "2026-08-10T12:00:00Z", workModeSessionId: "work-current" },
    { type: "fuel", timestamp: "2026-08-10T16:30:00Z", workModeSessionId: "work-current" },
    { type: "hydration", timestamp: "2026-08-10T09:00:00Z", workModeSessionId: "work-current" },
    { type: "hydration", timestamp: "2026-08-10T13:00:00Z", workModeSessionId: "work-current" },
    { type: "fuel", timestamp: "2026-08-10T14:00:00Z", notes: 'fuel_guard_checkin:{"checkinType":"sleepy"}', workModeSessionId: "work-current" },
    { type: "fuel", timestamp: "2026-08-10T10:00:00Z", workModeSessionId: "other-work" }
  ];
  const result = domain.workSessionSummary({ session, sessions: [session], logs });
  assert.equal(result.durationMinutes, 540);
  assert.deepEqual(
    { fuel: result.fuelCount, hydration: result.hydrationCount, sleepy: result.sleepyCount },
    { fuel: 3, hydration: 2, sleepy: 1 }
  );
  assert.equal(result.longestFuelGapMinutes, 270);
  assert.equal(result.longestHydrationGapMinutes, 240);
  assert.deepEqual(result.sleepyTimes.length, 1);
  assert.equal(result.comparison, null);
});

test("Work Mode comparisons require three completed historical periods", () => {
  const current = { id: "current", status: "completed", startedAt: "2026-08-10T08:00:00Z", endedAt: "2026-08-10T17:00:00Z" };
  const previous = [1, 2, 3].map(day => ({ id: `past-${day}`, status: "completed", startedAt: `2026-08-0${day}T08:00:00Z`, endedAt: `2026-08-0${day}T17:00:00Z` }));
  const logs = [current, ...previous].flatMap(session => [
    { type: "fuel", timestamp: session.startedAt, workModeSessionId: session.id },
    { type: "hydration", timestamp: session.endedAt, workModeSessionId: session.id }
  ]);
  const result = domain.workSessionSummary({ session: current, sessions: [current, ...previous], logs });
  assert.equal(result.comparison.sampleCount, 3);
  assert.equal(result.comparison.fuelDifference, 0);
  assert.equal(result.comparison.hydrationDifference, 0);
});

test("Work and Training contexts can coexist and survive local refresh without changing normal logs", () => {
  const normalized = domain.normalizeLog({
    type: "fuel",
    logged_at: "2026-08-10T10:00:00Z",
    training_mode_session_id: "training-a",
    work_mode_session_id: "work-a"
  });
  assert.equal(normalized.trainingModeSessionId, "training-a");
  assert.equal(normalized.workModeSessionId, "work-a");

  const first = loadState();
  first.sandbox.fuelGapState().workMode = {
    ownerUserId: "athlete-a",
    activeSession: { id: "work-a", status: "active", startedAt: "2026-08-10T08:00:00Z" },
    sessions: [{ id: "work-a", status: "active", startedAt: "2026-08-10T08:00:00Z" }],
    lastSyncedAt: "",
    lastError: ""
  };
  first.sandbox.save();
  const refreshed = loadState(JSON.parse(first.storage.get("fuelGuardStateV20")));
  assert.equal(refreshed.sandbox.fuelGapState().workMode.activeSession.id, "work-a");
  assert.equal(refreshed.sandbox.fuelGapState().workMode.ownerUserId, "athlete-a");
  const workMode = read("work-mode.js");
  assert.match(workMode, /if \(!userId && state\(\)\?\.ownerUserId\) resetForIdentity\(""\)/);
  assert.match(workMode, /previousOwner && previousOwner !== String\(userId \|\| ""\)[\s\S]*log\.workModeSessionId = ""/);
});

test("Work Mode migration enforces one active owner-scoped session and composite log ownership", () => {
  const migration = read("supabase/migrations/20260810223802_work_mode_sessions.sql");
  const rls = read("supabase/tests/work_mode_sessions_rls_test.sql");
  assert.match(migration, /unique index fuel_work_mode_sessions_one_active_idx[\s\S]*where status = 'active'/);
  assert.match(migration, /foreign key \(work_mode_session_id, user_id\)[\s\S]*on delete restrict/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /with check \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.doesNotMatch(migration, /grant delete/i);
  assert.match(rls, /Cross-athlete Work Mode direct-ID reads are blocked/);
  assert.match(rls, /Composite ownership prevents linking a log to another athlete/);
});

test("Training completion has one transient summary and remains represented once in history", () => {
  const training = read("training-mode.js");
  assert.doesNotMatch(training, /function completionSummaryMarkup/);
  assert.match(training, /function trainingCompletionMarkup/);
  assert.equal((training.match(/<h1>Training complete<\/h1>/g) || []).length, 1);
  assert.match(training, /fuelEventCount/);
  assert.match(training, /hydrationEventCount/);
  assert.match(training, /Recent Training Mode sessions/);
  assert.match(training, /training-mode-review-time/);
  assert.match(training, /training-mode-review-actual/);
  assert.match(training, /training-mode-review-events/);
  const css = read("training-mode.css");
  assert.match(css, /\.training-mode-review-time \{/);
  assert.match(css, /\.training-mode-review-actual,[\s\S]*\.training-mode-review-events \{/);
  assert.match(css, /\.training-completion-moment \{/);
});

test("Reflection keeps the accepted Performance journey beneath the universal Everyday baseline", () => {
  const impact = read("athlete-impact.js");
  const css = read("athlete-impact.css");
  for (const label of ["Your Journey", "Your baseline", "Performance check-in", "Choose performance areas", "How satisfied are you currently with your", "Check in"]) assert.match(impact, new RegExp(label));
  assert.match(impact, /athleteEverydayReflection/);
  assert.doesNotMatch(impact, /Impact summary|Training experience|function feedbackMarkup/);
  assert.match(impact, /Edit latest check-in/);
  assert.match(impact, /Edit baseline/);
  assert.match(impact, /Change area/);
  assert.match(impact, /Stop tracking/);
  assert.doesNotMatch(impact, /reflection-dashboard-rail|Tracked outcomes/);
  assert.match(impact, /age <= 72 \* 60 \* 60 \* 1000/);
  assert.match(impact, /noImpactData[\s\S]*localLogs\(\)\.length === 0/);
  assert.match(css, /body\.beta-mvp #impact[\s\S]*background: #fff/);
  assert.match(css, /\.reflection-editor-backdrop/);
});

test("the PWA cache advances once and includes every new Work Mode asset", () => {
  const html = read("index.html");
  const worker = read("sw.js");
  const build = read("build-info.js");
  [html, worker, build].forEach(source => assert.match(source, /mobile-pwa-v145-auth-onboarding/));
  assert.doesNotMatch(html + worker + build, /mobile-pwa-v132-athlete-ux-impact-fix/);
  for (const file of ["work-mode.css", "work-mode.js"]) {
    assert.match(html, new RegExp(file.replace(".", "\\.")));
    assert.match(worker, new RegExp(file.replace(".", "\\.")));
  }
});
