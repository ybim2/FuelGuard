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
    ["mainAccountIdentityValue", { textContent: "" }],
    ["coachProductLink", { hidden: false }],
    ["performanceProductLink", { hidden: false }]
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

test("main identity prefers the saved first name and clears User A before displaying User B", () => {
  const { elements, window } = loadProductShell();
  const render = window.fuelGuardProductShell.renderMainAccountIdentity;

  render({ signedIn: true, email: "user-a@example.com" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Signed in as");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "user-a@example.com");

  render({ signedIn: true, email: "user-a@example.com" }, { first_name: "Alex" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "user-a@example.com");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "Alex");
  assert.match(elements.get("mainAccountIdentity").attributes["aria-label"], /Alex.*user-a@example\.com/);

  render({ signedIn: false, email: "user-a@example.com" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Not signed in");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "Log in");
  assert.doesNotMatch(elements.get("mainAccountIdentity").attributes["aria-label"], /user-a/i);

  render({ signedIn: true, email: "user-b@example.com" });
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "user-b@example.com");
  assert.doesNotMatch(elements.get("mainAccountIdentityValue").textContent, /user-a/i);
});

test("main shell keeps Coach and Performance links hidden until server-authorised", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(html, /aria-label="Fuel Guard products"/);
  assert.match(html, /href="\/" aria-current="page">Athlete<\/a>/);
  assert.match(html, /id="coachProductLink" href="\/coach\/" hidden>Coach<\/a>/);
  assert.match(html, /id="performanceProductLink" href="\/performance\/" hidden>Performance<\/a>/);
  assert.match(html, /product-shell\.js\?v=mobile-pwa-v138-reflection-journey/);
  assert.match(sw, /\.\/product-shell\.js/);
});

test("product access is derived from the user profile and Performance context RPC", async () => {
  const { window } = loadProductShell();
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { coach_enabled: true, first_name: "Alex", display_name: "Alex Athlete" }, error: null }; }
      };
    },
    async rpc(name) {
      calls.push(["rpc", name]);
      return { data: [{ organisation_id: "org-1" }], error: null };
    }
  };
  const result = await window.fuelGuardProductShell._test.authorisedProducts(client, { id: "user-1" });
  assert.deepEqual({ ...result }, {
    coach: true,
    performance: true,
    profile: { coach_enabled: true, first_name: "Alex", display_name: "Alex Athlete" }
  });
  assert.deepEqual(calls, [["from", "fuel_user_profiles"], ["rpc", "fuel_performance_context"]]);
});

test("athlete-only access keeps enterprise product links hidden", async () => {
  const { elements, window } = loadProductShell();
  window.fuelGuardProductShell.renderProductAccess({ coach: false, performance: false });
  assert.equal(elements.get("coachProductLink").hidden, true);
  assert.equal(elements.get("performanceProductLink").hidden, true);
});
