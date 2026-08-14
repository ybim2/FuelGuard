const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const domain = require("../fuel-guard-domain.js");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadSupplement({ logs = [] } = {}) {
  const window = { FuelGuardDomain: domain, addEventListener() {}, fuelGuardCloud: {} };
  const document = { hidden: false, addEventListener() {}, getElementById() { return null; }, querySelectorAll() { return []; } };
  const context = { window, document, fuelGapState: () => ({ logs }), Date, Intl, Math, Number, String, Boolean, Array, Object, Blob, URL, crypto: { randomUUID: () => "a1400000-0000-4000-8000-000000000001" }, globalThis: {} };
  context.globalThis.crypto = context.crypto;
  vm.runInNewContext(read("supplement-rhythm.js"), context, { filename: "supplement-rhythm.js" });
  return window.FuelGuardSupplementRhythm._test;
}

test("authentication exposes Apple, Google and immediate email/password sign-in without an email code path", () => {
  const html = read("index.html");
  const cloud = read("fuel-supabase.js");
  const auth = read("fuel-auth.js");
  assert.match(html, /Continue with Apple/);
  assert.match(html, /Continue with Google/);
  assert.match(html, /id="fuelGuardAuthEmail"/);
  assert.match(html, /id="fuelGuardAuthPassword"/);
  assert.match(html, /id="fuelGuardEmailSignIn"[^>]*>Sign in</);
  assert.doesNotMatch(html, /Use password|fuelGuardAuthOtp|Email me a code|Continue with code/);
  assert.match(cloud, /provider: "apple"/);
  assert.match(cloud, /provider: "google"/);
  assert.match(cloud, /signInWithPassword/);
  assert.doesNotMatch(cloud + auth, /signInWithOtp|verifyOtp|sendEmailOtp|verifyEmailOtp/);
  assert.match(cloud, /flowType: "pkce"/);
  assert.match(cloud, /resetPasswordForEmail/);
  assert.match(auth, /minimumLoadingMs: MIN_LOADING_MS/);
  assert.equal(require("../fuel-auth.js")._test.minimumLoadingMs, 1500);
});

test("OAuth uses one PKCE callback and rejects external next destinations", () => {
  const auth = require("../fuel-auth.js");
  const callback = read("auth/callback/auth-callback.js");
  assert.equal(auth._test.safeNextPath("https://evil.example"), "/");
  assert.equal(auth._test.safeNextPath("/coach/"), "/coach/");
  assert.match(auth.oauthRedirectUrl.toString(), /\/auth\/callback\//);
  assert.match(callback, /exchangeCodeForSession\(code\)/);
  assert.match(callback, /SAFE_DESTINATIONS = new Set\(\["\/", "\/coach\/", "\/performance\/"\]\)/);
  assert.match(callback, /if \(!config\.url \|\| !config\.anonKey \|\| !window\.supabase\?\.createClient \|\| !code\) throw/);
});

test("Apple relay email is never used as the preferred Athlete name", () => {
  const auth = read("fuel-auth.js");
  const cloud = read("fuel-supabase.js");
  assert.match(auth, /What should Fuel Guard call you|fuelGuardNameOnboarding/);
  assert.match(cloud, /savePreferredName/);
  assert.doesNotMatch(cloud.slice(cloud.indexOf("async function savePreferredName"), cloud.indexOf("async function signUp")), /user\(\)\.email|relay/);
});

test("login methods use real Supabase identities and protect the only usable method", () => {
  const cloud = read("fuel-supabase.js");
  const ui = read("account-identities.js");
  assert.match(cloud, /auth\.getUserIdentities\(\)/);
  assert.match(cloud, /auth\.linkIdentity/);
  assert.match(cloud, /auth\.unlinkIdentity/);
  assert.match(cloud, /identities\.length <= 1/);
  assert.match(ui, /manualIdentityLinkingEnabled/);
  for (const method of ["apple", "google", "email"]) assert.match(ui, new RegExp(`"${method}"`));
});

test("Supplement Rhythm schema is additive, private and deliberately outside fuel logs", () => {
  const sql = read("supabase/migrations/20260814120000_supplement_rhythm_recovery_layer.sql");
  const extension = read("supabase/migrations/20260814130000_automatic_work_context_supplement_catalogue.sql");
  for (const table of ["fuel_supplement_plans", "fuel_supplement_schedule_slots", "fuel_supplement_events", "fuel_recovery_focus_sessions"]) {
    assert.match(sql, new RegExp(`create table public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(sql, /supplement_type in \('iron', 'creatine', 'vitamin_c', 'custom'\)/);
  for (const type of ["vitamin_d", "vitamin_b12", "multivitamin", "magnesium", "calcium", "zinc", "electrolytes", "omega_3", "protein_supplement"]) assert.match(extension, new RegExp(`'${type}'`));
  assert.match(extension, /add column event_local_date date/);
  assert.match(extension, /add column timezone_name text/);
  assert.match(sql, /routine_source.*self_selected.*clinician.*dietitian.*coach.*prefer_not_to_say/s);
  assert.match(sql, /context_mode in \('everyday', 'work', 'training'\)/);
  assert.match(sql, /source in \('manual', 'reminder', 'watch', 'import'\)/);
  assert.doesNotMatch(sql, /alter table public\.fuel_logs\s+add column.*supplement/is);
  assert.doesNotMatch(sql, /create policy[^\n]*(coach|organisation)/i);
});

test("scheduled occurrence idempotency and immutable relationship identity are database-enforced", () => {
  const sql = read("supabase/migrations/20260814120000_supplement_rhythm_recovery_layer.sql");
  assert.match(sql, /unique index fuel_supplement_events_idempotency_idx/);
  assert.match(sql, /old\.supplement_plan_id is distinct from new\.supplement_plan_id/);
  assert.match(sql, /old\.schedule_slot_id is distinct from new\.schedule_slot_id/);
  assert.match(sql, /foreign key \(supplement_plan_id, user_id\)/);
  assert.match(sql, /foreign key \(recovery_focus_id, user_id\)/);
});

test("iron overlap uses only explicit before and after preferences and never blocks persistence silently", () => {
  const at = new Date("2026-08-14T12:00:00Z");
  const helpers = loadSupplement({ logs: [{ type: "hydration", caffeineMg: 80, timestamp: "2026-08-14T11:30:00Z" }] });
  assert.equal(helpers.ironWindowConflict({ supplement_type: "iron", track_caffeine_separation: false }, at), false);
  assert.equal(helpers.ironWindowConflict({ supplement_type: "iron", track_caffeine_separation: true, caffeine_separation_before_minutes: 45, caffeine_separation_after_minutes: 0 }, at), true);
  assert.equal(helpers.ironWindowConflict({ supplement_type: "iron", track_caffeine_separation: true, caffeine_separation_before_minutes: 15, caffeine_separation_after_minutes: 0 }, at), false);
  assert.match(read("supplement-rhythm.js"), /overlaps the personal caffeine timing window you set\. Record it anyway\?/);
});

test("local planned times remain local across timezone and daylight-saving construction", () => {
  const helpers = loadSupplement();
  const winter = new Date(2026, 0, 14, 10, 0, 0);
  const summer = new Date(2026, 6, 14, 10, 0, 0);
  for (const date of [winter, summer]) {
    const planned = new Date(helpers.plannedFor({ local_time: "08:15:00" }, date));
    assert.equal(planned.getHours(), 8);
    assert.equal(planned.getMinutes(), 15);
  }
  assert.equal(helpers.localDateKey(new Date(2026, 7, 14, 23, 30)), "2026-08-14");
});

test("Supplementation is a first-class 2x2 Daily action with direct and multi-select quick logging", () => {
  const source = read("supplement-rhythm.js");
  const html = read("index.html");
  const quickLog = source.slice(source.indexOf("async function openQuickLog"), source.indexOf("function closeQuickLog"));
  assert.match(html, /id="graphLogSupplementButton"[\s\S]*<span>Supplementation<\/span>/);
  assert.match(html, /id="supplementQuickChoices"/);
  assert.match(quickLog, /available\.length === 1/);
  assert.match(quickLog, /await recordNow\(available\[0\]\)/);
  assert.match(quickLog, /No supplements configured yet/);
  assert.doesNotMatch(quickLog, /data-open-screen="checklist"|showCategory/);
  assert.match(source, /data-supplement-quick-plan/);
  assert.match(source, /planIds\.map\(planFor\)/);
  assert.match(source, /await persistEvents\(\[plan\.id\], new Date\(\)\)/);
  assert.match(source, /fuelguard:supplement-events-changed/);
  assert.match(source, /data-supplement-add-slot/);
  assert.match(html, /supplementQuickTakenAt/);
  assert.match(source, /data-supplement-edit-slot/);
  assert.match(source, /data-supplement-toggle-reminder/);
  assert.match(source, /data-supplement-undo/);
  assert.doesNotMatch(html + source, /supplementQuickWithFood|supplementQuickLinkFuel|name="(?:dose|dosage|quantity)"/i);
  assert.match(read("fuel-beta.css"), /beta-quick-actions-card \.beta-log-actions \{[\s\S]*grid-template-columns: repeat\(2/);
});

test("Supplementation parses local schedule days and keeps contextual reminders private", () => {
  const helpers = loadSupplement();
  assert.deepEqual(Array.from(helpers.parseDays("Mon, Wednesday, fri, Mon")), [1, 3, 5]);
  const source = read("supplement-rhythm.js");
  assert.match(source, /reminderPrompt/);
  assert.match(source, /Only you can access these records/);
});

test("supplement events do not enter points, milestones, Coach or sharing paths", () => {
  const source = read("supplement-rhythm.js");
  assert.doesNotMatch(source, /FuelGuardMilestones\?\.|fuel_milestone_achievements|fuel_points_ledger|FuelGuardAthleteShare\?\./i);
  assert.doesNotMatch(read("athlete-share-card.js"), /fuel_supplement/);
  assert.doesNotMatch(read("coach/coach-beta.js"), /fuel_supplement/);
});

test("Everyday, Work and Training remain primary while Recovery is a secondary explicit layer", () => {
  const context = read("athlete-context-layer.js");
  const work = read("work-mode.js");
  assert.match(context, /training\(\)\?\.activeSession\?\.\(\) \? "training" : work\(\)\?\.isDuringWork\?\.\(at\) \? "work" : "everyday"/);
  assert.match(context, /fuelguard:training-session-ended/);
  assert.match(context, /data-recovery-start/);
  assert.match(context, /fuelguard:training-session-started/);
  assert.match(context, /fuelguard:work-pattern-updated/);
  assert.match(work, /function isDuringWork/);
  assert.doesNotMatch(context, /data-primary-context|work\(\)\?\.start|work\(\)\?\.end/);
  assert.match(context, /end\("new_training"\)/);
  assert.match(context, /planned supplement moments logged/);
  assert.equal((context.match(/24 \* 60 \* 60 \* 1000/g) || []).length, 1);
  assert.doesNotMatch(context, /\d+% recovered|fully recovered|recovery quality|you are ready to train/i);
});

test("PWA shell versions every new private surface and preserves callback navigation", () => {
  const html = read("index.html");
  const sw = read("sw.js");
  for (const asset of ["account-identities.js", "athlete-context-layer.js", "supplement-rhythm.js", "supplement-rhythm.css"]) {
    assert.match(html, new RegExp(asset.replace(".", "\\.") + "\\?v=mobile-pwa-v151-supplement-daily-patterns"));
    assert.match(sw, new RegExp(asset.replace(".", "\\.")));
  }
  assert.match(sw, /requestUrl\.pathname\.startsWith\("\/auth\/callback"\)/);
  assert.match(sw, /\.\/auth\/callback\/index\.html/);
});
