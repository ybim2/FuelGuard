const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const domain = require("../fuel-guard-domain.js");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function log(userId, timestamp, type = "fuel") {
  return domain.normalizeLog({
    id: `${userId}-${timestamp}-${type}`,
    user_id: userId,
    logged_at: timestamp,
    type,
    source: "manual"
  });
}

test("week-to-date reporting stays live from Monday through today and keeps future day cards", () => {
  const period = domain.weekToDateReportingPeriod({ now: new Date("2026-08-11T12:00:00Z"), timeZone: "UTC" });
  assert.deepEqual([period.startKey, period.endKey, period.totalDays], ["2026-08-10", "2026-08-11", 2]);

  const brief = domain.buildWeekToDateCoachBrief({
    now: new Date("2026-08-11T12:00:00Z"),
    timeZone: "UTC",
    athletes: [
      { userId: "a", displayName: "Alex Athlete" },
      { userId: "b", displayName: "Blair Runner" }
    ],
    logs: [
      log("a", "2026-08-10T08:00:00Z"),
      log("a", "2026-08-10T11:00:00Z"),
      log("a", "2026-08-10T11:05:00Z", "hydration"),
      log("a", "2026-08-11T09:00:00Z"),
      log("b", "2026-08-11T08:00:00Z"),
      log("b", "2026-08-11T12:00:00Z")
    ],
    targetsByUser: {
      a: { maximumFuelGapMinutes: 180 },
      b: { maximumFuelGapMinutes: 180 }
    }
  });

  assert.equal(brief.dailyEvidence.length, 7);
  assert.deepEqual(brief.dailyEvidence.map(day => day.future), [false, false, true, true, true, true, true]);
  assert.deepEqual(brief.dailyEvidence[0].findings.goingWell.map(item => item.athleteName), ["Alex Athlete"]);
  assert.deepEqual(brief.dailyEvidence[1].findings.needsAttention.map(item => item.athleteName), ["Blair Runner"]);
  assert.deepEqual(brief.dailyEvidence[0].findings.loggingGaps.map(item => item.athleteName), ["Blair Runner"]);
  assert.deepEqual(brief.evidence, {
    loggedAthleteDays: 3,
    missingAthleteDays: 1,
    fuelMoments: 5,
    hydrationMoments: 1,
    sleepyMoments: 0,
    exceededTargetDays: 1,
    withinTargetDays: 1,
    metricDays: 2
  });
  assert.match(brief.summary, /1 measurable athlete-day included a recorded fuel gap beyond target/);
  const reportPeriod = domain.reviewPeriodRange({ preset: "week_to_date", now: new Date("2026-08-11T12:00:00Z"), timeZone: "UTC" });
  assert.deepEqual([reportPeriod.startKey, reportPeriod.endKey], ["2026-08-10", "2026-08-11"]);
});

test("Coach mobile shell exposes exactly the five operational destinations", () => {
  const html = read("coach/index.html");
  const tabs = [...html.matchAll(/data-coach-tab="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(tabs, ["home", "athletes", "briefs", "schedule", "settings"]);
  for (const panel of ["coachHomePanel", "coachAthletesPanel", "coachBriefsPanel", "coachSchedulePanel", "coachSettingsPanel"]) {
    assert.match(html, new RegExp(`id="${panel}"`));
  }
  assert.doesNotMatch(html, /data-coach-tab="dashboard"|data-coach-tab="reports"/);
});

test("Coach Home leads with today's brief, upcoming session and week-to-date evidence", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");
  assert.match(html, /id="coachHomeOverview"/);
  assert.match(js, /Today’s Brief/);
  assert.match(js, /Upcoming Session/);
  assert.match(js, /Week-to-Date Brief/);
  assert.match(js, /Fuel soon/);
  assert.match(js, /Eat now/);
  assert.match(js, /Not logged/);
  assert.match(js, /data-open-weekly-report/);
  assert.match(js, /state\.reportPeriod = "week_to_date"/);
  assert.match(html, /Week-to-date live brief/);
});

test("Briefs separates daily action groups from a live evidence-rich weekly view", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");
  assert.match(html, /data-coach-brief="daily"/);
  assert.match(html, /data-coach-brief="weekly"/);
  for (const label of ["Needs attention", "Going well", "Logging \/ data gaps", "Today’s sessions"]) {
    assert.match(js, new RegExp(label));
  }
  assert.match(js, /dailyEvidence\.map/);
  assert.match(js, /<details class=/);
  assert.match(js, /Scheduled sessions/);
  assert.match(js, /Post-session recovery evidence is not yet available/);
  assert.match(js, /Available nutrition evidence/);
  assert.match(js, /every available count is shown/);
  assert.match(html, /Generate Weekly Review/);
  assert.match(js, /data-export-report-pdf/);
  assert.match(js, /data-export-report-csv/);
});

test("Athlete roster stays high-level until profile selection and uses full names", () => {
  const js = read("coach/coach-beta.js");
  const rosterSource = js.slice(js.indexOf("function rosterRow"), js.indexOf("function relationshipStatusCopy"));
  assert.match(js, /\[profile\?\.first_name, profile\?\.last_name\]/);
  assert.match(rosterSource, /Not enough recent logging data/);
  assert.match(rosterSource, /Open the athlete profile to review shared evidence/);
  assert.doesNotMatch(rosterSource, /item\.fuelLogs\.length|item\.hydrationLogs\.length|item\.sleepyLogs\.length|minutesSinceFuel/);
  assert.match(js, /function renderAthleteDetail[\s\S]*Current Status[\s\S]*Last fuel[\s\S]*Last hydration/);
});

test("Schedule reuses accepted team-session readiness and makes end time optional", () => {
  const js = read("coach/coach-beta.js");
  const domainSource = read("fuel-guard-domain.js");
  const retention = read("athlete-retention.js");
  assert.match(js, /fuel_save_team_session/);
  assert.match(js, /Practice<\/option>/);
  assert.match(js, /Ends \(optional\)/);
  assert.match(js, /requestedEnd \|\| \(startsAt \? new Date\(startsAt\.getTime\(\) \+ 90 \* 60000\)/);
  assert.match(js, /prePracticeTeamSummary\(rows\)/);
  assert.match(domainSource, /function prePracticeFuelState/);
  assert.match(retention, /teamSessions: sharedTeamSessions\(\)/);
  assert.match(retention, /dismissedKeys/);
});

test("Coach settings uses category drill-downs without weakening athlete preferences", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");
  for (const category of ["profile", "team", "sessions", "notifications", "reports", "account"]) {
    assert.match(html, new RegExp(`data-coach-settings-open="${category}"`));
    assert.match(html, new RegExp(`data-coach-settings-section="${category}"`));
  }
  assert.match(html, /Each athlete’s existing notification preference, dismissal and deduplication rules remain authoritative/);
  assert.match(js, /function renderSettingsNavigation/);
  assert.doesNotMatch(js, /update\(\{[^}]*maximum_gap_enabled|update\(\{[^}]*post_training_enabled/);
});

test("Coach Settings and Add Athlete controls keep visible accessible labels on light surfaces", () => {
  const html = read("coach/index.html");
  const js = read("coach/coach-beta.js");
  const css = read("coach/coach-beta.css");

  assert.match(html, /data-coach-settings-back>← Settings<\/button>/);
  assert.match(html, /id="coachFindAthleteButton"[^>]*data-busy-label="Adding…"[^>]*disabled[^>]*>Add athlete<\/button>/);
  assert.equal((html.match(/>Add athlete<\/button>/g) || []).length, 1);
  assert.match(html, /The athlete can find their athlete code in Settings → Coach &amp; Sharing\./);
  assert.match(html, /aria-describedby="coachAthleteCodeHelp"/);
  assert.match(html, /placeholder="FG-7K42P9"/);
  assert.match(html, /id="coachAthleteCodeInput"[\s\S]*class="coach-code-action"[\s\S]*id="coachFindAthleteButton"[\s\S]*id="coachAthleteCodeHelp"/);
  assert.match(js, /Enter an Athlete Code like FG-7K42P9\./);
  assert.match(js, /const disabled = state\.busy \|\| !ATHLETE_CODE_RE\.test\(code\);[\s\S]*button\.disabled = disabled;/);
  assert.match(css, /\.coach-code-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.coach-code-action button \{[\s\S]*width: auto;[\s\S]*white-space: nowrap;/);
  assert.match(css, /body\.coach-beta \.coach-form-grid\.coach-code-grid \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /body\.coach-beta button\.secondary \{[\s\S]*background: var\(--coach-surface\);[\s\S]*color: var\(--coach-text\);/);
  assert.match(css, /body\.coach-beta button:focus-visible[\s\S]*outline: 3px solid #d99024/);

  assert.match(js, /function syncAddAthleteButtonState/);
  assert.match(js, /const disabled = state\.busy \|\| !ATHLETE_CODE_RE\.test\(code\)/);
  assert.match(js, /function addAthleteByCode\(\)[\s\S]*lookupAthleteByCode\(\)[\s\S]*saveSharingRequest\(result\)/);
  assert.match(js, /button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(js, /Athlete could not be added\./);
  assert.match(js, /Connection request (sent|saved)/);
  assert.match(js, /loadCoachData\(\{ reason: "sharing-requested" \}\)/);
});

test("Coach visual system is light, card-based and mobile-safe at the required widths", () => {
  const css = read("coach/coach-beta.css");
  assert.match(css, /v133 Coach workflow redesign:[\s\S]*background: var\(--coach-bg\)/);
  assert.match(css, /#coachAppShell \.coach-card \{[\s\S]*border-radius: 20px;[\s\S]*background: var\(--coach-surface\)/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\) !important/);
  assert.match(css, /padding-bottom: calc\(112px \+ env\(safe-area-inset-bottom/);
  assert.match(css, /overflow-x: clip/);
  assert.doesNotMatch(css, /gradient\(/);
});

test("redesign is schema-neutral and retains the accepted organisation and team RLS suites", () => {
  const migrationNames = fs.readdirSync(path.join(root, "supabase", "migrations"));
  assert.equal(migrationNames.some(name => /coach_workflow_redesign|coach_schedule_redesign/.test(name)), false);
  const teamPgTap = read("supabase/tests/team_sport_sessions_rls_test.sql");
  const organisationPgTap = read("supabase/tests/coach_organisation_foundations_rls_test.sql");
  assert.match(teamPgTap, /select plan\(34\)/);
  assert.match(teamPgTap, /Cross-organisation coach cannot read Team A session context/);
  assert.match(teamPgTap, /Coach relationship revocation removes athlete timing context/);
  assert.match(organisationPgTap, /select plan\(/);
  assert.match(organisationPgTap, /direct-ID|Cross-organisation|cross-organisation/i);
});
