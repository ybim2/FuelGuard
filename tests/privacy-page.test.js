const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.join(__dirname, "..");
const privacyPath = path.join(repoRoot, "privacy", "index.html");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("privacy page exists with required public-policy facts", () => {
  assert.equal(fs.existsSync(privacyPath), true);
  const html = read(privacyPath);

  assert.match(html, /<title>Fuel Guard Privacy Policy<\/title>/);
  assert.match(html, /Effective date:\s*6 August 2026/);
  assert.match(html, /Last updated:\s*14 August 2026/);
  assert.match(html, /Supabase/);
  assert.match(html, /Vercel/);
  assert.match(html, /Garmin \/ Connect IQ/);
  assert.match(html, /Access, correction, deletion and objection requests/);
  assert.match(html, /How to delete individual fuel logs/);
  assert.match(html, /How to request account and associated-data deletion/);
  assert.doesNotMatch(html, /TODO|INSERT EMAIL|example\.com/i);
});

test("privacy route is a standalone page, not the main app shell", () => {
  const html = read(privacyPath);

  assert.match(html, /<h1>Fuel Guard Privacy Policy<\/h1>/);
  assert.doesNotMatch(html, /app-boot-splash/);
  assert.doesNotMatch(html, /<section id="dashboard"/);
});

test("main app exposes a low-profile privacy link", () => {
  const html = read(path.join(repoRoot, "index.html"));

  assert.match(html, /href="\/privacy\/"/);
  assert.match(html, /Privacy policy/);
});
