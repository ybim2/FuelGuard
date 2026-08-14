const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const domain = require("../fuel-guard-domain.js");

test("recency progressively uses minutes, hours, yesterday, days and a date", () => {
  const now = new Date("2026-08-11T12:00:00Z");
  assert.equal(domain.formatRecency("2026-08-11T11:18:00Z", { now }), "Last logged 42 min ago");
  assert.equal(domain.formatRecency("2026-08-11T06:00:00Z", { now }), "Last logged 6 hours ago");
  assert.equal(domain.formatRecency("2026-08-10T11:59:00Z", { now }), "Last logged yesterday");
  assert.equal(domain.formatRecency("2026-08-07T12:00:00Z", { now }), "Last logged 4 days ago");
  assert.equal(domain.formatRecency("2026-08-03T12:00:00Z", { now }), "Last logged 3 Aug");
  assert.equal(domain.formatRecency("invalid", { now }), "");
});

test("logging acknowledgement only uses evidence supported context", () => {
  const first = domain.loggingAcknowledgement({ type: "fuel", logsBefore: [], loggedAt: "2026-08-11T08:00:00Z" });
  assert.deepEqual(first, { headline: "Fuel logged", context: "First Fuel Guard log recorded.", level: "milestone", reason: "first_log" });

  const withinGap = domain.loggingAcknowledgement({
    type: "fuel",
    logsBefore: [{ type: "fuel", timestamp: "2026-08-11T08:00:00Z" }],
    loggedAt: "2026-08-11T10:30:00Z",
    targets: { maximumFuelGapMinutes: 180 }
  });
  assert.equal(withinGap.context, "Keeping the gap under control.");

  const firstFuelToday = domain.loggingAcknowledgement({
    type: "fuel",
    logsBefore: [{ type: "fuel", timestamp: "2026-08-10T18:00:00Z" }],
    loggedAt: "2026-08-11T08:00:00Z"
  });
  assert.equal(firstFuelToday.context, "First fuel of the day logged.");

  const recovery = domain.loggingAcknowledgement({
    type: "fuel",
    logsBefore: [{ type: "hydration", timestamp: "2026-08-11T09:00:00Z" }],
    loggedAt: "2026-08-11T11:24:00Z",
    completedSessions: [{ id: "session-1", status: "completed", endedAt: "2026-08-11T11:00:00Z" }]
  });
  assert.equal(recovery.context, "Recovery logged within 24 minutes of training.");

  const unsupported = domain.loggingAcknowledgement({
    type: "hydration",
    logsBefore: [{ type: "fuel", timestamp: "2026-08-10T08:00:00Z" }],
    loggedAt: "2026-08-11T11:24:00Z"
  });
  assert.equal(unsupported.context, "");
});

test("Athlete feedback distinguishes micro action, training completion and milestones", () => {
  const html = read("index.html");
  const athlete = read("fuel-beta.js");
  const training = read("training-mode.js");
  const css = read("fuel-beta.css");
  const feedback = read("logging-feedback.js");
  assert.match(html, /id="athleteActionFeedback"/);
  assert.match(athlete, /FuelGuardLoggingFeedback\?\.confirm/);
  assert.match(feedback, /persistenceSucceeded/);
  assert.match(feedback, /Sleepy logged/);
  assert.match(athlete, /loggingAcknowledgement/);
  assert.doesNotMatch(athlete, /\+1 Fuel Momentum/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(training, /Training complete/);
  assert.match(training, /fuelEventCount/);
  assert.match(training, /hydrationEventCount/);
  assert.match(training, /Synced from Garmin/);
  assert.match(training, /data-training-completion-dismiss/);
});

test("Coach feedback frames action and progress without causal claims or screen-time points", () => {
  const html = read("coach/index.html");
  const coach = read("coach/coach-beta.js");
  assert.match(html, /id="coachCompletionMoment"/);
  assert.match(coach, /Where you can make a difference/);
  assert.match(coach, /Positive change this week/);
  assert.match(coach, /do not establish that a coach caused the change/);
  assert.match(coach, /Daily review complete/);
  assert.match(coach, /Weekly review complete/);
  assert.match(coach, /const attentionAthletes = new Set/);
  assert.doesNotMatch(coach, /Weekly review completed[\s\S]{0,180}Current coach points/);
});

test("Garmin success feedback requires acknowledgement and Training completion is authoritative", () => {
  const api = read("garmin/FuelGuard/shared/source/FuelGuardApi.mc");
  const quick = read("garmin/FuelGuard/quick-log/source/FuelGuardQuickLogView.mc");
  const activity = read("garmin/FuelGuard/activity-logger/source/FuelGuardActivityLoggerField.mc");
  const training = read("garmin/FuelGuard/shared/source/FuelGuardTraining.mc");
  assert.match(api, /function eventAcknowledged/);
  assert.match(api, /_lastAcknowledgedEventId = context as String/);
  assert.match(quick, /updateAcknowledgedConfirmation/);
  assert.doesNotMatch(quick, /FuelGuardQueue\.enqueue\(event\);\s*_confirmStartedAt/);
  assert.match(activity, /FuelGuardApi\.eventAcknowledged/);
  assert.match(training, /recordConfirmedTransition/);
  assert.match(training, /completionActive/);
  assert.match(quick, /TRAINING COMPLETE/);
});

test("PWA app shell is versioned for the feedback release", () => {
  assert.match(read("build-info.js"), /mobile-pwa-v153-supplement-one-tap-timeline/);
  assert.match(read("sw.js"), /fuel-guard-mobile-pwa-v153-supplement-one-tap-timeline-20260814T154015Z/);
  assert.match(read("index.html"), /Canonical app: mobile-pwa-v153-supplement-one-tap-timeline/);
});
