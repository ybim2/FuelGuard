const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const domain = require("../fuel-guard-domain.js");
const root = path.join(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function fuel(userId, iso, extra = {}) {
  return domain.normalizeLog({
    user_id: userId,
    logged_at: iso,
    type: "fuel",
    source: "manual",
    ...extra
  });
}

function twoFuelDays(userId, days, times, extra = {}) {
  return days.flatMap(key => times.map(time => fuel(userId, `${key}T${time}:00.000Z`, extra)));
}

function sleepy(userId, iso) {
  return fuel(userId, iso, {
    notes: `fuel_guard_checkin:${JSON.stringify({ version: 1, checkinType: "sleepy", context: "general_day" })}`
  });
}

test("weekly reporting period is the previous complete Monday-Sunday on Monday and later in the week", () => {
  const monday = domain.weeklyReportingPeriod({ now: new Date("2026-08-10T09:00:00.000Z"), timeZone: "UTC" });
  const friday = domain.weeklyReportingPeriod({ now: new Date("2026-08-14T16:00:00.000Z"), timeZone: "UTC" });

  assert.deepEqual([monday.startKey, monday.endKey], ["2026-08-03", "2026-08-09"]);
  assert.deepEqual([friday.startKey, friday.endKey], ["2026-08-03", "2026-08-09"]);
  assert.equal(monday.totalDays, 7);
});

test("weekly boundaries and log dates honor an explicit IANA timezone", () => {
  const instant = new Date("2026-08-10T00:30:00.000Z");
  const utc = domain.weeklyReportingPeriod({ now: instant, timeZone: "UTC" });
  const newYork = domain.weeklyReportingPeriod({ now: instant, timeZone: "America/New_York" });

  assert.deepEqual([utc.startKey, utc.endKey], ["2026-08-03", "2026-08-09"]);
  assert.deepEqual([newYork.startKey, newYork.endKey], ["2026-07-27", "2026-08-02"]);
  assert.equal(domain.dateKeyInTimeZone("2026-08-03T00:30:00.000Z", "America/New_York"), "2026-08-02");

  const bounds = domain.periodQueryBounds(utc, "Europe/London");
  assert.equal(bounds.start.toISOString(), "2026-08-02T23:00:00.000Z");
  assert.equal(bounds.endExclusive.toISOString(), "2026-08-09T23:00:00.000Z");
});

test("team analytics scope logs to active coach-athlete sharing and calculate athlete-day coverage", () => {
  const period = domain.periodFromKeys("2026-08-03", "2026-08-09", "weekly", "UTC");
  const athletes = [
    { userId: "active-a", displayName: "Active A" },
    { userId: "active-b", displayName: "Active B" },
    { userId: "pending-c", displayName: "Pending C" },
    { userId: "other-d", displayName: "Other Coach" }
  ];
  const relationships = [
    { coach_id: "coach-1", athlete_id: "active-a", status: "active" },
    { coach_id: "coach-1", athlete_id: "active-b", status: "active" },
    { coach_id: "coach-1", athlete_id: "pending-c", status: "pending" },
    { coach_id: "coach-2", athlete_id: "other-d", status: "active" }
  ];
  const logs = [
    ...twoFuelDays("active-a", ["2026-08-03", "2026-08-04", "2026-08-05"], ["08:00", "11:00"]),
    ...twoFuelDays("pending-c", ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"], ["08:00", "11:00"]),
    ...twoFuelDays("other-d", ["2026-08-03"], ["08:00", "11:00"])
  ];

  const analytics = domain.buildTeamAnalytics({
    athletes,
    relationships,
    coachId: "coach-1",
    logs,
    targetsByUser: {},
    period,
    timeZone: "UTC"
  });

  assert.equal(analytics.athleteCount, 2);
  assert.equal(analytics.loggingCoverage.eligibleAthleteDays, 14);
  assert.equal(analytics.loggingCoverage.loggedAthleteDays, 3);
  assert.equal(analytics.loggingCoverage.pct, 21);
  assert.equal(analytics.summaries.some(summary => summary.athleteId === "pending-c"), false);
  assert.equal(analytics.summaries.some(summary => summary.athleteId === "other-d"), false);
});

test("team aggregation finds a repeated multi-athlete gap window and configured-target adherence", () => {
  const period = domain.periodFromKeys("2026-08-03", "2026-08-09", "weekly", "UTC");
  const athletes = [
    { userId: "athlete-a", displayName: "Athlete A" },
    { userId: "athlete-b", displayName: "Athlete B" }
  ];
  const logs = [
    ...twoFuelDays("athlete-a", ["2026-08-03", "2026-08-04"], ["13:05", "17:00"]),
    ...twoFuelDays("athlete-b", ["2026-08-03", "2026-08-05"], ["13:20", "17:10"]),
    ...twoFuelDays("athlete-a", ["2026-08-06"], ["08:00", "11:00"]),
    ...twoFuelDays("athlete-b", ["2026-08-06"], ["08:00", "11:00"])
  ];
  const analytics = domain.buildTeamAnalytics({
    athletes,
    logs,
    targetsByUser: {
      "athlete-a": { maximumFuelGapMinutes: 180 },
      "athlete-b": { maximumFuelGapMinutes: 180 }
    },
    period,
    timeZone: "UTC"
  });

  assert.equal(analytics.targetAdherence.metricDays, 6);
  assert.equal(analytics.targetAdherence.daysWithinTarget, 2);
  assert.equal(analytics.targetAdherence.pct, 33);
  assert.equal(analytics.commonGapWindow.label, "13:00-18:00");
  assert.equal(analytics.commonGapWindow.count, 4);
  assert.equal(analytics.commonGapWindow.athleteCount, 2);
  assert.equal(analytics.commonGapWindow.meaningful, true);
  assert.equal(analytics.commonGapWindow.sharePct, null, "a percentage is hidden below the five-event denominator");
  assert.match(analytics.patterns[0].label, /4 recurring >target gaps/);
});

test("weekly brief classifies improvement and deterioration only with comparable data", () => {
  const currentDays = ["2026-08-03", "2026-08-04", "2026-08-05"];
  const previousDays = ["2026-07-27", "2026-07-28", "2026-07-29"];
  const athletes = [
    { userId: "improving", displayName: "Improving" },
    { userId: "deteriorating", displayName: "Deteriorating" },
    { userId: "limited", displayName: "Limited" }
  ];
  const logs = [
    ...twoFuelDays("improving", previousDays, ["08:00", "13:00"]),
    ...twoFuelDays("improving", currentDays, ["08:00", "11:00"]),
    ...twoFuelDays("deteriorating", previousDays, ["08:00", "11:00"]),
    ...twoFuelDays("deteriorating", currentDays, ["08:00", "13:00"]),
    ...twoFuelDays("limited", ["2026-08-03"], ["08:00", "13:00"])
  ];
  const brief = domain.buildWeeklyCoachBrief({
    now: new Date("2026-08-10T09:00:00.000Z"),
    timeZone: "UTC",
    athletes,
    logs,
    targetsByUser: {
      improving: { maximumFuelGapMinutes: 180 },
      deteriorating: { maximumFuelGapMinutes: 180 },
      limited: { maximumFuelGapMinutes: 180 }
    }
  });

  assert.equal(brief.improvedCount, 1);
  assert.equal(brief.deterioratedCount, 1);
  assert.equal(brief.analytics.trends.find(trend => trend.athleteId === "limited").direction, "insufficient");
  assert.equal(brief.frequentlyExceededCount, 1);
  assert.equal(brief.analytics.reviewCandidates.some(candidate => candidate.athleteId === "deteriorating"), true);
});

test("small samples remain explicit instead of producing team-pattern percentages", () => {
  const period = domain.periodFromKeys("2026-08-03", "2026-08-09", "weekly", "UTC");
  const analytics = domain.buildTeamAnalytics({
    athletes: [{ userId: "solo", displayName: "Solo" }],
    logs: twoFuelDays("solo", ["2026-08-03", "2026-08-04"], ["13:00", "17:00"]),
    targetsByUser: { solo: { maximumFuelGapMinutes: 180 } },
    period,
    timeZone: "UTC"
  });

  assert.equal(analytics.commonGapWindow.meaningful, false);
  assert.equal(analytics.commonGapWindow.sharePct, null);
  assert.equal(analytics.patterns.length, 0);
  assert.equal(analytics.insufficientPatternData, true);
});

test("Sleepy clustering is team-scoped, sample-gated, and explicitly non-medical", () => {
  const period = domain.periodFromKeys("2026-08-03", "2026-08-09", "weekly", "UTC");
  const analytics = domain.buildTeamAnalytics({
    athletes: [{ userId: "a" }, { userId: "b" }],
    logs: [
      sleepy("a", "2026-08-03T16:10:00.000Z"),
      sleepy("a", "2026-08-04T16:20:00.000Z"),
      sleepy("a", "2026-08-05T16:30:00.000Z"),
      sleepy("b", "2026-08-03T17:00:00.000Z"),
      sleepy("b", "2026-08-05T17:15:00.000Z")
    ],
    period,
    timeZone: "UTC"
  });

  const pattern = analytics.patterns.find(item => item.id === "sleepy_window");
  assert.equal(analytics.commonSleepyWindow.label, "16:00-18:00");
  assert.equal(analytics.commonSleepyWindow.sharePct, 100);
  assert.equal(analytics.commonSleepyWindow.athleteCount, 2);
  assert.match(pattern.label, /No medical cause is inferred/);
});

test("monthly recurrence preserves the due-day anchor when a short month is skipped", () => {
  const schedule = { review_type: "monthly", cadence: "monthly", next_due_date: "2026-01-31", status: "active" };
  const february = domain.completeScheduledReview(schedule, { completedOn: "2026-02-01", timeZone: "UTC" });
  const march = domain.completeScheduledReview(schedule, { completedOn: "2026-03-01", timeZone: "UTC" });

  assert.equal(february.next_due_date, "2026-02-28");
  assert.equal(march.next_due_date, "2026-03-31");
  assert.equal(march.status, "active");
});

test("8-week and custom-day recurrence advance beyond the completion date", () => {
  const eightWeek = domain.completeScheduledReview({ review_type: "8_week", next_due_date: "2026-08-10", status: "active" }, { completedOn: "2026-08-10", timeZone: "UTC" });
  const custom = domain.completeScheduledReview({ review_type: "custom", cadence: "custom_days", cadence_days: 10, next_due_date: "2026-08-01", status: "active" }, { completedOn: "2026-08-16", timeZone: "UTC" });

  assert.equal(eightWeek.next_due_date, "2026-10-05");
  assert.equal(custom.next_due_date, "2026-08-21");
});

test("custom review dates assemble the configured report period and one-off reviews complete", () => {
  const schedule = {
    review_type: "custom",
    cadence: "none",
    next_due_date: "2026-08-20",
    report_period_start: "2026-06-01",
    report_period_end: "2026-08-15",
    status: "active"
  };
  const period = domain.reportPeriodForSchedule(schedule, { timeZone: "UTC" });
  const completed = domain.completeScheduledReview(schedule, { completedOn: "2026-08-20", timeZone: "UTC", reportId: "report-1" });

  assert.deepEqual([period.startKey, period.endKey], ["2026-06-01", "2026-08-15"]);
  assert.equal(completed.status, "completed");
  assert.equal(completed.next_due_date, null);
  assert.equal(completed.last_report_id, "report-1");
});

test("due state is deterministic without a background scheduler", () => {
  const due = domain.scheduledReviewState({ status: "active", next_due_date: "2026-08-07" }, { now: new Date("2026-08-10T00:30:00.000Z"), timeZone: "Europe/London" });
  const upcoming = domain.scheduledReviewState({ status: "active", next_due_date: "2026-08-11" }, { now: new Date("2026-08-10T00:30:00.000Z"), timeZone: "Europe/London" });

  assert.equal(due.label, "Review due");
  assert.equal(due.due, true);
  assert.equal(upcoming.state, "upcoming");
});

test("team context comparison reports association only after multi-athlete samples are sufficient", () => {
  const period = domain.periodFromKeys("2026-08-01", "2026-08-14", "custom", "UTC");
  const athletes = [{ userId: "a" }, { userId: "b" }];
  const normalDays = ["2026-08-01", "2026-08-02", "2026-08-03"];
  const travelDays = ["2026-08-08", "2026-08-09", "2026-08-10"];
  const logs = athletes.flatMap(athlete => [
    ...twoFuelDays(athlete.userId, normalDays, ["08:00", "11:00"], { day_type: "Normal" }),
    ...twoFuelDays(athlete.userId, travelDays, ["08:00", "13:00"], { day_type: "Travel" })
  ]);
  const analytics = domain.buildTeamAnalytics({
    athletes,
    logs,
    targetsByUser: { a: { maximumFuelGapMinutes: 180 }, b: { maximumFuelGapMinutes: 180 } },
    period,
    timeZone: "UTC"
  });

  assert.equal(analytics.travelComparison.travelAdherencePct, 0);
  assert.equal(analytics.travelComparison.normalAdherencePct, 100);
  assert.equal(analytics.travelComparison.differencePoints, -100);
  assert.match(analytics.patterns.find(pattern => pattern.id === "travel_adherence").label, /association, not evidence of cause/i);
});

test("scheduled review migration uses explicit grants and active-relationship RLS", () => {
  const migration = fs.readdirSync(path.join(root, "supabase", "migrations")).find(file => file.endsWith("_coach_review_schedules.sql"));
  assert.ok(migration);
  const sql = read(path.join("supabase", "migrations", migration));
  const noComments = sql.replace(/^--.*$/gm, "");

  assert.match(sql, /create table public\.fuel_coach_review_schedules/);
  assert.match(sql, /review_type in \('monthly', '8_week', 'contract', 'end_of_season', 'custom'\)/);
  assert.match(sql, /cadence in \('none', 'monthly', '8_weeks', 'custom_days'\)/);
  assert.match(sql, /next_due_date date/);
  assert.match(sql, /last_report_id uuid references public\.fuel_coach_reports/);
  assert.match(sql, /alter table public\.fuel_coach_review_schedules enable row level security/);
  assert.match(sql, /grant select, insert, update, delete on table public\.fuel_coach_review_schedules to authenticated/);
  assert.match(sql, /create policy fuel_coach_review_schedules_update_assigned_coach[\s\S]*using \([\s\S]*with check \(/);
  assert.match(sql, /relationship\.coach_id = fuel_coach_review_schedules\.coach_id/);
  assert.match(sql, /relationship\.athlete_id = fuel_coach_review_schedules\.athlete_id/);
  assert.match(sql, /relationship\.status = 'active'/);
  assert.match(sql, /\(select auth\.uid\(\)\) = coach_id/);
  assert.doesNotMatch(noComments, /service_role|auth\.role\(\)|security definer/i);
});

test("Coach Beta exposes the weekly brief, team distinction, and weekly-review-save workflow", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");

  assert.match(html, /id="coachWeeklyBrief"/);
  assert.match(html, /id="coachTeamPatterns"/);
  assert.match(html, /id="coachDueReviews"/);
  assert.match(html, /id="coachScheduledReviewList"/);
  assert.match(html, /Monthly review/);
  assert.match(html, /8-week review/);
  assert.match(html, /Contract review/);
  assert.match(html, /End-of-season review/);
  assert.match(html, /Custom review/);
  assert.match(html, /Generate Weekly Review/);
  assert.match(html, /id="coachSaveReviewButton"/);
  assert.match(js, /Week-to-Date Brief/);
  assert.match(js, /Review athletes/);
  assert.match(js, /Team pattern/);
  assert.match(js, /Individual/);
  assert.match(js, /async function assembleReportDraft/);
  assert.match(js, /async function saveReport/);
  assert.match(js, /completeScheduledReview/);
  assert.match(js, /Save & complete review/);
});
