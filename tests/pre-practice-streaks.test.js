const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const domain = require("../fuel-guard-domain.js");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const session = overrides => ({
  id: "practice-a",
  status: "scheduled",
  session_name: "Practice",
  starts_at: "2026-08-10T19:00:00Z",
  ends_at: "2026-08-10T21:00:00Z",
  timezone_name: "UTC",
  ...overrides
});
const fuel = timestamp => ({ id: timestamp, type: "fuel", logged_at: timestamp, source: "manual" });

test("pre-practice evaluation distinguishes recent, approaching, exceeded and missing evidence", () => {
  const options = { targets: { maximumFuelGapMinutes: 180 }, now: new Date("2026-08-10T17:00:00Z"), timeZone: "UTC" };
  const green = domain.prePracticeFuelState({ ...options, session: session(), logs: [fuel("2026-08-10T17:00:00Z")] });
  const amber = domain.prePracticeFuelState({ ...options, session: session(), logs: [fuel("2026-08-10T16:30:00Z")] });
  const red = domain.prePracticeFuelState({ ...options, session: session(), logs: [fuel("2026-08-10T15:30:00Z")] });
  const grey = domain.prePracticeFuelState({ ...options, session: session(), logs: [] });
  assert.deepEqual([green.status, amber.status, red.status, grey.status], ["green", "amber", "red", "grey"]);
  assert.deepEqual([green.reminderEligible, amber.reminderEligible, red.reminderEligible, grey.reminderEligible], [false, true, true, false]);
  assert.equal(amber.gapMinutesAtStart, 150);
  assert.equal(red.gapMinutesAtStart, 210);
  assert.equal(grey.gapMinutesAtStart, null);
});

test("pre-practice reminder is limited to the approaching window and reuses maximum-gap preferences", () => {
  const upcoming = session();
  const logs = [fuel("2026-08-10T16:30:00Z")];
  const early = domain.athleteNudgeEligibility({
    logs,
    teamSessions: [upcoming],
    targets: { maximumFuelGapMinutes: 180 },
    now: new Date("2026-08-10T15:30:00Z"),
    timeZone: "UTC"
  });
  assert.equal(early.some(item => item.id === "pre_practice_fuel"), false);
  const approaching = domain.athleteNudgeEligibility({
    logs,
    teamSessions: [upcoming],
    targets: { maximumFuelGapMinutes: 180 },
    now: new Date("2026-08-10T17:00:00Z"),
    timeZone: "UTC"
  }).find(item => item.id === "pre_practice_fuel");
  assert.equal(approaching.status, "amber");
  assert.equal(approaching.title, "Practice starts at 7:00 PM");
  assert.equal(approaching.occurrenceKey, "pre_practice:practice-a");
  assert.equal(domain.athleteNudgeEligibility({
    logs,
    teamSessions: [upcoming],
    targets: { maximumFuelGapMinutes: 180 },
    preferences: { maximumGap: false },
    now: new Date("2026-08-10T17:00:00Z")
  }).some(item => item.id === "pre_practice_fuel"), false);
});

test("coach pre-practice summary derives exact four-state counts and evidence-based insight", () => {
  const summary = domain.prePracticeTeamSummary([
    { pre_session_status: "green" },
    { pre_session_status: "green" },
    { pre_session_status: "yellow" },
    { pre_session_status: "red" },
    { pre_session_status: "no_logging" }
  ]);
  assert.deepEqual(summary.counts, { green: 2, amber: 1, red: 1, grey: 1 });
  assert.equal(summary.needsFuel, 2);
  assert.equal(summary.insight, "2 athletes may need to fuel before this session.");
  assert.match(domain.prePracticeTeamSummary([{ pre_session_status: "no_logging" }]).insight, /not yet have enough logging data/);
});

test("Daily keeps Day streak separate and presents four cumulative activity milestones", () => {
  const html = read("index.html");
  const dashboard = html.slice(html.indexOf('<section id="dashboard"'), html.indexOf('<section id="training"'));
  const milestones = read("athlete-milestones.js");
  assert.match(dashboard, /id="athleteMilestones"/);
  assert.match(dashboard, /Your milestones/);
  assert.match(milestones, /Fuel moments/);
  assert.match(milestones, /Hydration moments/);
  assert.match(milestones, /Training moments/);
  assert.match(milestones, /Work moments/);
  assert.doesNotMatch(dashboard, /athleteDailyPoints|FG Points|reward|next-day streak/i);
  assert.match(read("fuel-beta.css"), /\.beta-milestone-carousel[\s\S]*overflow-x: auto/);
});

test("separate Fuel and Hydration streaks preserve the existing Day streak definition", () => {
  const summary = domain.activityUsageSummary([
    fuel("2026-08-07T08:00:00Z"),
    { ...fuel("2026-08-08T08:00:00Z"), type: "hydration" },
    { ...fuel("2026-08-09T08:00:00Z"), type: "fuel_hydration" },
    fuel("2026-08-10T08:00:00Z")
  ], new Date("2026-08-10T12:00:00Z"));
  assert.deepEqual(summary, { dayStreak: 4, fuelStreak: 2, hydrationStreak: 2, fuelMoments: 3, hydrationMoments: 2 });
});

test("Coach and Athlete surfaces reuse server-authorized team context without new client IDs or push infrastructure", () => {
  const coach = read("coach/coach-beta.js");
  const retention = read("athlete-retention.js");
  const migration = read("supabase/migrations/20260810101351_team_sport_sessions.sql");
  assert.match(coach, /prePracticeTeamSummary\(rows\)/);
  assert.match(coach, /Not enough logging data/);
  assert.match(coach, /data-open-athlete/);
  assert.match(retention, /teamSessions: sharedTeamSessions\(\)/);
  assert.match(retention, /dismissedKeys/);
  assert.doesNotMatch(retention, /Notification\(|PushManager|serviceWorker\.ready/);
  assert.match(migration, /private\.fuel_can_access_team_athlete\([\s\S]*'viewer'/);
});
