const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file));
const text = file => read(file).toString("utf8");
const hash = file => crypto.createHash("sha256").update(read(file)).digest("hex");

function pngDimensions(file) {
  const data = read(file);
  assert.equal(data.toString("ascii", 1, 4), "PNG", `${file} should be a PNG`);
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

test("approved Fuel Guard master is preserved byte-for-byte with deterministic derivatives", () => {
  assert.equal(hash("brand/fuel-guard-mark.png"), "54e1c20b7c04937729f3bee4d2e085477003b2fbdb5d091790942bd0e0466be8");
  assert.deepEqual(pngDimensions("brand/fuel-guard-mark.png"), [1254, 1254]);
  assert.deepEqual(pngDimensions("brand/fuel-guard-mark-512.png"), [512, 512]);
  assert.deepEqual(pngDimensions("brand/fuel-guard-mark-192.png"), [192, 192]);
  assert.deepEqual(pngDimensions("brand/apple-touch-icon.png"), [180, 180]);
  assert.deepEqual(pngDimensions("brand/favicon-32.png"), [32, 32]);
  assert.deepEqual(pngDimensions("brand/fuel-guard-mark-64.png"), [64, 64]);
});

test("Athlete, Coach, Performance, Privacy and Garmin connect surfaces share one mark", () => {
  for (const file of ["index.html", "coach/index.html", "performance/index.html", "privacy/index.html", "garmin/connect/index.html"]) {
    const source = text(file);
    assert.match(source, /fuel-guard-mark-192\.png/);
    assert.match(source, /fuel-guard-brand\.css/);
    assert.match(source, /brand\/favicon-32\.png/);
    assert.doesNotMatch(source, />\s*FG\s*</);
    assert.doesNotMatch(source, /icons\/icon\.svg/);
  }
  assert.match(text("athlete-tools.js"), /fuel-guard-mark-192\.png/);
  assert.match(text("coach/coach-beta.js"), /fuel-guard-mark-64\.png/);
  assert.doesNotMatch(text("athlete-share-card.js"), /fillText\(["']FG["']/);
  assert.doesNotMatch(text("fuel-beta.js"), /fillText\(["']FG["']/);
});

test("favicon, Apple and installable PWA identity use canonical PNG derivatives", () => {
  const html = text("index.html");
  const manifest = JSON.parse(text("manifest.webmanifest"));
  const worker = text("sw.js");
  assert.match(html, /rel="icon"[^>]+brand\/favicon-32\.png/);
  assert.match(html, /rel="apple-touch-icon"[^>]+brand\/apple-touch-icon\.png/);
  assert.deepEqual(manifest.icons.map(icon => [icon.src, icon.sizes, icon.type]), [
    ["brand/fuel-guard-mark-192.png", "192x192", "image/png"],
    ["brand/fuel-guard-mark-512.png", "512x512", "image/png"]
  ]);
  for (const asset of ["fuel-guard-brand.css", "fuel-guard-mark-192.png", "fuel-guard-mark-512.png", "fuel-guard-mark-64.png", "apple-touch-icon.png", "favicon-32.png"]) {
    assert.match(worker, new RegExp(asset.replaceAll(".", "\\.")));
  }
  assert.match(worker, /mobile-pwa-v153-supplement-one-tap-timeline/);
  assert.equal(fs.existsSync(path.join(ROOT, "icons/icon.svg")), false);
});

test("Fuel Guard-owned Garmin icons use the same canonical geometry at required dimensions", () => {
  const launcher = [
    "garmin/FuelGuard/quick-log/resources/icon.png",
    "garmin/FuelGuard/activity-logger/resources/icon.png"
  ];
  const store = [
    "garmin/FuelGuard/public-release/assets/quick-log/store-icon-500.png",
    "garmin/FuelGuard/public-release/assets/activity-logger/store-icon-500.png",
    "garmin/FuelGuard/private-beta/quick-log/store-icon-500.png",
    "garmin/FuelGuard/private-beta/activity-logger/store-icon-500.png"
  ];
  launcher.forEach(file => assert.deepEqual(pngDimensions(file), [40, 40]));
  store.forEach(file => assert.deepEqual(pngDimensions(file), [500, 500]));
  assert.equal(hash(launcher[0]), hash(launcher[1]));
  store.slice(1).forEach(file => assert.equal(hash(file), hash(store[0])));
  assert.match(text("garmin/FuelGuard/quick-log/manifest.xml"), /version="0\.5\.5"/);
  assert.match(text("garmin/FuelGuard/activity-logger/manifest.xml"), /version="0\.5\.5"/);
});
