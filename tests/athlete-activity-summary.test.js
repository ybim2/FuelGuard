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
  assert.deepEqual(summary, { dayStreak: 4, fuelMoments: 3, hydrationMoments: 2 });
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
  assert.deepEqual(summary, { dayStreak: 0, fuelMoments: 2, hydrationMoments: 0 });
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
});
