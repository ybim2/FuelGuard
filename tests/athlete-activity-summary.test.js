const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const domain = require("../fuel-guard-domain.js");

const root = path.join(__dirname, "..");
const moment = (day, type, time = "09:00:00") => ({
  logged_at: `${day}T${time}`,
  type,
  source: "manual"
});

test("activity summary counts a streak through today from real fuel and hydration days", () => {
  const summary = domain.activityUsageSummary([
    moment("2026-08-06", "fuel"),
    moment("2026-08-07", "hydration"),
    moment("2026-08-08", "fuel_hydration"),
    moment("2026-08-09", "fuel")
  ], new Date("2026-08-09T12:00:00"));
  assert.deepEqual(summary, { dayStreak: 4, fuelStreak: 2, hydrationStreak: 2, fuelMoments: 3, hydrationMoments: 2 });
});

test("an in-progress empty day keeps a streak ending yesterday", () => {
  const summary = domain.activityUsageSummary([
    moment("2026-08-06", "fuel"),
    moment("2026-08-07", "fuel"),
    moment("2026-08-08", "hydration")
  ], new Date("2026-08-09T08:00:00"));
  assert.equal(summary.dayStreak, 3);
});

test("a completed gap breaks the streak and Sleepy never changes usage totals", () => {
  const summary = domain.activityUsageSummary([
    moment("2026-08-05", "fuel"),
    moment("2026-08-07", "fuel"),
    moment("2026-08-08", "checkin"),
    moment("2026-08-09", "checkin")
  ], new Date("2026-08-09T18:00:00"));
  assert.deepEqual(summary, { dayStreak: 0, fuelStreak: 0, hydrationStreak: 0, fuelMoments: 2, hydrationMoments: 0 });
});

test("invalid test deleted and revoked rows do not affect activity totals", () => {
  const summary = domain.activityUsageSummary([
    moment("2026-08-09", "fuel"),
    { ...moment("2026-08-09", "fuel"), source: "test" },
    { ...moment("2026-08-09", "hydration"), deleted_at: "2026-08-09T10:00:00Z" },
    { ...moment("2026-08-09", "hydration"), revoked_at: "2026-08-09T10:00:00Z" },
    moment("2026-08-09", "invalid")
  ], new Date("2026-08-09T12:00:00"));
  assert.deepEqual(summary, { dayStreak: 1, fuelStreak: 1, hydrationStreak: 0, fuelMoments: 1, hydrationMoments: 0 });
});

test("Normal to Holiday to Normal clears the persisted override", () => {
  const state = {
    dayTypes: {},
    archive: { "2026-08-09": { dayType: "", dayTypeLabel: "Not set" } },
    logs: [moment("2026-08-09", "fuel")]
  };
  domain.applyDayTypeState(state, "2026-08-09", "holiday");
  assert.equal(state.dayTypes["2026-08-09"], "holiday");
  assert.equal(state.archive["2026-08-09"].dayType, "holiday");
  assert.equal(state.logs[0].dayType, "holiday");
  domain.applyDayTypeState(state, "2026-08-09", "");
  assert.equal(Object.hasOwn(state.dayTypes, "2026-08-09"), false);
  assert.equal(state.archive["2026-08-09"].dayType, "");
  assert.equal(state.archive["2026-08-09"].dayTypeLabel, "Not set");
  assert.equal(state.logs[0].dayType, "");
});

test("streak milestones cross every configured threshold exactly once", () => {
  for (const threshold of [3, 5, 7, 14, 30, 50, 100]) {
    const previous = { dayStreak: threshold - 1, fuelMoments: 0, hydrationMoments: 0 };
    const current = { dayStreak: threshold, fuelMoments: 0, hydrationMoments: 0 };
    const first = domain.newlyCrossedMilestones(previous, current, []);
    assert.deepEqual(first.map(item => item.key), [`streak:${threshold}`]);
    assert.deepEqual(domain.newlyCrossedMilestones(previous, current, [`streak:${threshold}`]), []);
  }
});

test("fuel and hydration milestones are independent at every configured threshold", () => {
  for (const threshold of [10, 25, 50, 100, 250, 500, 1000]) {
    const previous = { dayStreak: 0, fuelMoments: threshold - 1, hydrationMoments: threshold - 1 };
    const fuel = domain.newlyCrossedMilestones(previous, { ...previous, fuelMoments: threshold }, []);
    const hydration = domain.newlyCrossedMilestones(previous, { ...previous, hydrationMoments: threshold }, []);
    assert.deepEqual(fuel.map(item => item.key), [`fuel:${threshold}`]);
    assert.deepEqual(hydration.map(item => item.key), [`hydration:${threshold}`]);
  }
});

test("canonical Athlete UI renders the compact real-log summary and profile identity", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(root, "fuel-beta.js"), "utf8");
  assert.match(html, /id="athleteActivitySummary"/);
  assert.match(html, /Profile &amp; Settings/);
  assert.match(html, /id="mainAccountIdentity"/);
  assert.match(js, /activityUsageSummary\(betaState\(\)\.logs/);
  assert.match(js, /day streak/);
  assert.match(js, /fuel moments/);
  assert.match(js, /hydration moments/);
  assert.match(js, /const key = todayViewKey\(\);[\s\S]*setDayType\(key, event\.target\.value\)/);
});

test("activity summary spacing is targeted and approximately halved before Status", () => {
  const css = fs.readFileSync(path.join(root, "fuel-beta.css"), "utf8");
  assert.match(css, /#dashboard \{ gap: 6px; \}/);
  assert.match(css, /\.beta-activity-summary \{ margin-bottom: 0; \}/);
});
