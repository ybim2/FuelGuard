const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("shared logging feedback confirms only acknowledged persistence and covers every quick-log type", () => {
  const feedback = require(path.join(root, "logging-feedback.js"));
  assert.equal(feedback._test.persistenceSucceeded({ status: "synced", persisted: true }), true);
  assert.equal(feedback._test.persistenceSucceeded({ status: "synced", persisted: false }), false);
  assert.equal(feedback._test.persistenceSucceeded({ status: "pending", persisted: true }), false);
  assert.equal(feedback._test.persistenceSucceeded({ status: "error", persisted: false }), false);
  assert.equal(feedback._test.acknowledgementFor("fuel").headline, "Fuel logged");
  assert.equal(feedback._test.acknowledgementFor("hydration").headline, "Hydration logged");
  assert.equal(feedback._test.acknowledgementFor("sleepy").headline, "Sleepy logged");

  const athlete = read("fuel-beta.js");
  const saveIndex = athlete.indexOf("return Promise.resolve(cloud.saveLog(log)).then(result => {");
  const confirmationIndex = athlete.indexOf("window.FuelGuardLoggingFeedback?.confirm?.({", saveIndex);
  assert.ok(saveIndex >= 0 && confirmationIndex > saveIndex, "feedback follows the resolved cloud save");
  assert.doesNotMatch(athlete, /showAthleteActionFeedback/);
});

test("Athlete root starts behind a neutral auth boundary with no private navigation exposure", () => {
  const html = read("index.html");
  const auth = read("fuel-auth.js");
  const athlete = read("fuel-beta.js");
  assert.match(html, /id="fuelGuardAuthBoundary"/);
  assert.match(html, /id="fuelGuardPrivateApp" class="layout" data-private-ui hidden inert/);
  assert.match(html, /class="mobile-bottom-nav beta-mobile-nav"[^>]*data-private-ui hidden inert/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /Fuel Guard helps athletes stay aware of fuelling, hydration and sleepy moments/);
  assert.match(html, /href="\/privacy\/"/);
  assert.match(auth, /fuelguard:private-app-ready/);
  assert.match(auth, /SAFE_DESTINATIONS = new Set\(\["\/", "\/coach\/", "\/performance\/"\]\)/);
  assert.match(athlete, /fuelguard:private-app-ready/);
  assert.doesNotMatch(athlete.slice(-700), /\n  renderAll\(\);\n/);
});

test("transient authenticated feedback retains managed visibility instead of becoming persistent bars", () => {
  const html = read("index.html");
  const auth = read("fuel-auth.js");
  const feedback = read("logging-feedback.js");
  const milestones = read("athlete-milestones.js");
  for (const id of ["athleteMilestoneToast", "athleteActionFeedback"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-private-ui[^>]*data-managed-visibility[^>]*hidden[^>]*inert`));
  }
  assert.match(auth, /\[data-private-ui\]:not\(\[data-managed-visibility\]\)/);
  assert.match(auth, /\[data-private-ui\]\[data-managed-visibility\]/);
  for (const source of [feedback, milestones]) {
    assert.match(source, /removeAttribute\("inert"\)/);
    assert.match(source, /setAttribute\("inert", ""\)/);
  }
});

test("authentication loading keeps the new logo and rotates concise fuelling messages only while loading", () => {
  const html = read("index.html");
  const auth = require(path.join(root, "fuel-auth.js"));
  const authSource = read("fuel-auth.js");
  assert.match(html, /id="fuelGuardAuthLoading"[\s\S]*fuel-guard-mark-192\.png[\s\S]*id="fuelGuardAuthLoadingQuote"/);
  assert.equal(auth._test.loadingQuotes.length, 7);
  assert.equal(auth._test.loadingQuotes[0], "Fuel the work before the work asks for it.");
  assert.match(authSource, /fuelGuardLoadingHookIndex/);
  assert.match(authSource, /setInterval\(showNext, 2200\)/);
  assert.match(authSource, /if \(name === "loading"\) startLoadingQuotes\(\);\s*else stopLoadingQuotes\(\);/);
});

test("Supabase Google OAuth uses the existing auth client and email auth remains available", () => {
  const cloud = read("fuel-supabase.js");
  const coach = read("coach/coach-beta.js");
  const performance = read("performance/performance.js");
  assert.match(cloud, /signInWithOAuth\(\{\s*provider: "google"/);
  assert.match(cloud, /signInWithPassword/);
  assert.match(cloud, /fuelguard:auth-state/);
  assert.match(coach, /provider: "google"/);
  assert.match(performance, /provider: "google"/);
  assert.match(read("coach/index.html"), /id="coachAppShell" hidden/);
  assert.match(read("performance/index.html"), /id="appShell" class="performance-shell" hidden/);
});

test("Garmin onboarding is authenticated, connection-derived, dismissible and recoverable from Settings", () => {
  const html = read("index.html");
  const devices = read("garmin-connected-devices.js");
  const onboarding = read("garmin-onboarding.js");
  const setupUrl = "https://app.notion.com/p/Fuel-Guard-Setup-HQ-3b7ab7791e2081c0bf99dc4c34cb7501";
  assert.match(devices, /quickLogConnected: status === "ready" && activeDevices\("quick_log"\)\.length > 0/);
  assert.match(onboarding, /auth\.signedIn/);
  assert.match(onboarding, /garmin\.status === "ready"/);
  assert.match(onboarding, /fuelGuardQuickLogOnboardingDismissed:/);
  assert.match(html, /Get more from Fuel Guard/);
  assert.match(html, /Log fuel, hydration and sleepy moments straight from your wrist/);
  assert.match(html, /https:\/\/apps\.garmin\.com\/apps\/daa45a0d-e858-4b08-84b1-e9bb9a8196f3/);
  assert.ok(html.split(setupUrl).length >= 4, "Setup Guide is available from auth, onboarding and Settings");
  assert.match(html, /Garmin, installation and getting started/);
});

test("Privacy remains a public standalone policy with black and white product styling", () => {
  const privacy = read("privacy/index.html");
  assert.match(privacy, /<meta name="theme-color" content="#050505">/);
  assert.match(privacy, /--bg: #050505/);
  assert.match(privacy, /--panel: #ffffff/);
  for (const heading of [
    "Private beta status",
    "Who operates Fuel Guard",
    "Information collected by the web app",
    "User privacy rights",
    "Changes to this policy"
  ]) assert.match(privacy, new RegExp(heading));
  assert.doesNotMatch(privacy, /fuelGuardAuthBoundary|data-private-ui/);
});

test("new authentication assets are versioned in the offline app shell", () => {
  const sw = read("sw.js");
  for (const asset of ["fuel-auth.css", "fuel-auth.js", "garmin-onboarding.css", "garmin-onboarding.js", "logging-feedback.js"]) {
    assert.match(sw, new RegExp(asset.replace(".", "\\.")));
  }
  assert.match(read("build-info.js"), /mobile-pwa-v154-product-analytics/);
});
