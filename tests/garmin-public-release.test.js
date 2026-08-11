const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const EXPECTED_PRODUCTS = [
  "fr165", "fr165m",
  "fr245", "fr245m",
  "fr255", "fr255m", "fr255s", "fr255sm",
  "fr265", "fr265s",
  "fr945", "fr945lte", "fr955", "fr965",
  "fenix7s", "fenix7", "fenix7x",
  "fenix7spro", "fenix7pro", "fenix7xpro", "fenix7pronowifi", "fenix7xpronowifi",
  "fenix843mm", "fenix847mm", "fenix8solar47mm", "fenix8solar51mm", "fenix8pro47mm",
  "epix2", "epix2pro42mm", "epix2pro47mm", "epix2pro51mm"
];

function manifestProducts(source) {
  return [...source.matchAll(/<iq:product id="([^"]+)"\/>/g)].map(match => match[1]);
}

function pngDimensions(relativePath) {
  const buffer = fs.readFileSync(path.join(ROOT, relativePath));
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test("public manifests preserve the 0.5.4 production identities and exact 31-device matrix", () => {
  const quick = read("garmin/FuelGuard/quick-log/manifest.xml");
  const activity = read("garmin/FuelGuard/activity-logger/manifest.xml");

  assert.match(quick, /id="2F3B7C5E9F2D4A6B8C1D0E7F0F255002"/);
  assert.match(quick, /type="watch-app" version="0\.5\.4"/);
  assert.match(activity, /id="9C8A41410F0A4D46A7F7D1C68F0F2551"/);
  assert.match(activity, /type="datafield" version="0\.5\.4"/);
  assert.deepEqual(manifestProducts(quick), EXPECTED_PRODUCTS);
  assert.deepEqual(manifestProducts(activity), EXPECTED_PRODUCTS);

  assert.match(quick, /uses-permission id="Communications"/);
  assert.match(quick, /uses-permission id="SensorHistory"/);
  assert.match(quick, /uses-permission id="UserProfile"/);
  assert.match(activity, /uses-permission id="Communications"/);
  assert.doesNotMatch(activity, /SensorHistory|UserProfile/);
});

test("private-beta and public application identities remain separate", () => {
  const quickPublic = read("garmin/FuelGuard/quick-log/manifest.xml");
  const activityPublic = read("garmin/FuelGuard/activity-logger/manifest.xml");
  const quickBeta = read("garmin/FuelGuard/quick-log/manifest.beta.xml");
  const activityBeta = read("garmin/FuelGuard/activity-logger/manifest.beta.xml");

  assert.match(quickBeta, /id="70220497B9784B6D8D66CB25A32BF7B0"/);
  assert.match(activityBeta, /id="5D34775D0DE84E388CC2BF0F2A8EB4DA"/);
  assert.deepEqual(manifestProducts(quickBeta), ["fr255"]);
  assert.deepEqual(manifestProducts(activityBeta), ["fr255"]);
  assert.doesNotMatch(quickPublic, /70220497B9784B6D8D66CB25A32BF7B0/);
  assert.doesNotMatch(activityPublic, /5D34775D0DE84E388CC2BF0F2A8EB4DA/);
});

test("public build and simulator tooling use the exact manifest device matrix", () => {
  for (const scriptPath of ["scripts/build-garmin-public.sh", "scripts/test-garmin-public-matrix.sh"]) {
    const source = read(scriptPath);
    const deviceBlock = source.match(/declare -a DEVICES=\(([\s\S]*?)\n\)/);
    assert.ok(deviceBlock, `${scriptPath} should declare its device matrix`);
    const declared = deviceBlock[1].trim().split(/\s+/);
    assert.deepEqual(declared, EXPECTED_PRODUCTS);
  }

  const build = read("scripts/build-garmin-public.sh");
  assert.match(build, /fuel-guard-quick-log-public-\$VERSION/);
  assert.match(build, /fuel-guard-activity-logger-public-\$VERSION/);
  assert.match(build, /Public package contains a forbidden secret-like/);
  assert.match(build, /https:\/\/fuelguardapp\.com/);
});

test("expanded-device layout and pairing UX retain canonical Garmin Training Mode", () => {
  const quickApp = read("garmin/FuelGuard/quick-log/source/FuelGuardQuickLogApp.mc");
  const activityApp = read("garmin/FuelGuard/activity-logger/source/FuelGuardActivityLoggerApp.mc");
  const view = read("garmin/FuelGuard/quick-log/source/FuelGuardQuickLogView.mc");
  const connection = read("garmin/FuelGuard/shared/source/FuelGuardConnection.mc");

  assert.match(quickApp, /public function onAuthenticationRequest\(\)[\s\S]*APP_QUICK_LOG[\s\S]*registerForOAuthMessages\(\)/);
  assert.match(activityApp, /public function onAuthenticationRequest\(\)[\s\S]*APP_ACTIVITY_LOGGER[\s\S]*registerForOAuthMessages\(\)/);
  assert.match(view, /ACTION_COUNT = 4/);
  assert.match(view, /ACTION_TRAINING = 3/);
  assert.match(view, /FuelGuardTraining\.toggle\(\)/);
  assert.match(view, /FuelGuardTraining\.refresh\(true\)/);
  assert.match(view, /rowGap = \(actionBottom - actionTop\) \/ \(ACTION_COUNT - 1\)/);
  assert.match(connection, /TRAINING_PATH = "\/api\/garmin\/training"/);
  assert.match(connection, /function trainingEndpoint\(\)/);
  assert.match(connection, /Open Connect IQ on phone/);
  assert.match(connection, /Connection returned invalid data/);
  assert.match(connection, /Approval expired; retry connection/);
  assert.match(connection, /Network error; retry connection/);
});

test("both public apps share the physical START and ENTER connect-action mapping", () => {
  const view = read("garmin/FuelGuard/quick-log/source/FuelGuardQuickLogView.mc");
  const quickTests = read("garmin/FuelGuard/quick-log/source/FuelGuardQuickLogViewTests.mc");
  const activity = read("garmin/FuelGuard/activity-logger/source/FuelGuardActivityLoggerApp.mc");
  const activityTests = read("garmin/FuelGuard/activity-logger/source/FuelGuardActivityLoggerFieldTests.mc");
  const connection = read("garmin/FuelGuard/shared/source/FuelGuardConnection.mc");

  assert.match(view, /public function onKey\(keyEvent as WatchUi\.KeyEvent\)[\s\S]*activateKey\(keyEvent\.getKey\(\)\)/);
  assert.match(view, /FuelGuardConnection\.isConnectActionKey\(key\)/);
  assert.match(view, /activateKey[\s\S]*_view\.logSelection\(\)/);
  assert.match(quickTests, /testFuelGuardQuickLogDisconnectedRawStartInitiatesAuth/);
  assert.match(activity, /public function onKey\(keyEvent as WatchUi\.KeyEvent\)[\s\S]*activateKey\(keyEvent\.getKey\(\)\)/);
  assert.match(activity, /FuelGuardConnection\.isConnectActionKey\(key\)/);
  assert.match(activityTests, /testFuelGuardActivityLoggerSettingsRawStartInitiatesAuth/);
  assert.match(connection, /function isConnectActionKey\(key as WatchUi\.Key\)[\s\S]*key == WatchUi\.KEY_START \|\| key == WatchUi\.KEY_ENTER/);
});

test("public release documentation and 500px Store assets are present", () => {
  const supported = read("garmin/FuelGuard/public-release/SUPPORTED_DEVICES.md");
  const physical = read("garmin/FuelGuard/public-release/PHYSICAL_ACCEPTANCE.md");
  assert.match(supported, /31 Connect IQ product IDs/);
  assert.match(supported, /1,953 passed; 0 failed; 0 errors/);
  assert.match(physical, /Forerunner 255 physical release acceptance/);
  assert.deepEqual(pngDimensions("garmin/FuelGuard/public-release/assets/quick-log/store-icon-500.png"), [500, 500]);
  assert.deepEqual(pngDimensions("garmin/FuelGuard/public-release/assets/activity-logger/store-icon-500.png"), [500, 500]);
});
