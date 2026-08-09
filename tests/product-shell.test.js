const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadProductShell() {
  const elements = new Map([
    ["mainAccountIdentity", { attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }],
    ["mainAccountIdentityLabel", { textContent: "" }],
    ["mainAccountIdentityValue", { textContent: "" }]
  ]);
  const listeners = new Map();
  const window = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    fuelGuardCloud: { accountView: () => ({ signedIn: false, email: "" }) }
  };
  const document = {
    addEventListener() {},
    getElementById(id) { return elements.get(id) || null; }
  };
  const context = { window, document, requestAnimationFrame() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, "product-shell.js"), "utf8"), context);
  return { elements, listeners, window };
}

test("main identity clears User A before displaying User B", () => {
  const { elements, window } = loadProductShell();
  const render = window.fuelGuardProductShell.renderMainAccountIdentity;

  render({ signedIn: true, email: "user-a@example.com" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Signed in as");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "user-a@example.com");

  render({ signedIn: false, email: "user-a@example.com" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Not signed in");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "Log in");
  assert.doesNotMatch(elements.get("mainAccountIdentity").attributes["aria-label"], /user-a/i);

  render({ signedIn: true, email: "user-b@example.com" });
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "user-b@example.com");
  assert.doesNotMatch(elements.get("mainAccountIdentityValue").textContent, /user-a/i);
});

test("main shell exposes Athlete, Coach and Performance without granting access", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(html, /aria-label="Fuel Guard products"/);
  assert.match(html, /href="\/" aria-current="page">Athlete<\/a>/);
  assert.match(html, /href="\/coach\/">Coach<\/a>/);
  assert.match(html, /href="\/performance\/">Performance<\/a>/);
  assert.match(html, /product-shell\.js\?v=mobile-pwa-v115-athlete-training-access/);
  assert.match(sw, /\.\/product-shell\.js/);
});
