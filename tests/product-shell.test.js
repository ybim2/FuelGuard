const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadProductShell() {
  const identityClasses = new Set();
  const elements = new Map([
    ["mainAccountIdentity", {
      attributes: {},
      classList: { toggle(name, enabled) { if (enabled) identityClasses.add(name); else identityClasses.delete(name); } },
      setAttribute(name, value) { this.attributes[name] = value; }
    }],
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
  return { elements, identityClasses, listeners, window };
}

test("main identity renders only a resolved canonical username and never exposes account email", () => {
  const { elements, window } = loadProductShell();
  const render = window.fuelGuardProductShell.renderMainAccountIdentity;

  render({ signedIn: true, email: "user-a@example.com" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Fuel Guard Athlete");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "");

  render({ signedIn: true, email: "user-a@example.com" }, { first_name: "Alex" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Fuel Guard Athlete");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "");
  assert.doesNotMatch(elements.get("mainAccountIdentity").attributes["aria-label"], /user-a@example\.com/);

  render({ signedIn: true, email: "user-a@example.com" }, { username: "alex_runs", first_name: "Alex" });
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "alex_runs");

  render({ signedIn: false, email: "user-a@example.com" });
  assert.equal(elements.get("mainAccountIdentityLabel").textContent, "Not signed in");
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "Log in");
  assert.doesNotMatch(elements.get("mainAccountIdentity").attributes["aria-label"], /user-a/i);

  render({ signedIn: true, email: "user-b@example.com" });
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "");
  assert.doesNotMatch(elements.get("mainAccountIdentityValue").textContent, /user-a/i);
});

test("username resolution stays blank across account switches and stable across same-user refreshes", async () => {
  const { elements, identityClasses, window } = loadProductShell();
  const pending = new Map();
  const profileResult = userId => new Promise(resolve => pending.set(userId, resolve));
  let selectedUserId = "user-a";
  const client = {
    from() {
      let userId = "";
      return {
        select() { return this; },
        eq(_column, value) { userId = value; return this; },
        maybeSingle() { return profileResult(userId); }
      };
    },
    async rpc() { return { data: [], error: null }; }
  };
  window.fuelGuardCloud = {
    accountView: () => ({ signedIn: true }),
    client,
    get user() { return { id: selectedUserId }; }
  };

  const firstResolution = window.fuelGuardProductShell.resolveProductAccess();
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "");
  assert.equal(identityClasses.has("resolving"), true);
  pending.get("user-a")({ data: { username: "runner_a", first_name: "Alex" }, error: null });
  await firstResolution;
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "runner_a");

  const backgroundResolution = window.fuelGuardProductShell.resolveProductAccess();
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "runner_a");
  pending.get("user-a")({ data: { username: "runner_a", first_name: "Alex" }, error: null });
  await backgroundResolution;

  selectedUserId = "user-b";
  const switchedResolution = window.fuelGuardProductShell.resolveProductAccess();
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "");
  assert.equal(identityClasses.has("resolving"), true);
  pending.get("user-b")({ data: { username: "runner_b", first_name: "Blair" }, error: null });
  await switchedResolution;
  assert.equal(elements.get("mainAccountIdentityValue").textContent, "runner_b");
  assert.equal(identityClasses.has("resolving"), false);
});

test("main shell keeps Coach and Performance links hidden until server-authorised", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(html, /aria-label="Fuel Guard products"/);
  assert.match(html, /href="\/" aria-current="page">Athlete<\/a>/);
  assert.match(html, /id="coachProductLink" href="\/coach\/" hidden>Coach<\/a>/);
  assert.match(html, /id="performanceProductLink" href="\/performance\/" hidden>Performance<\/a>/);
  assert.match(html, /product-shell\.js\?v=mobile-pwa-v152-supplement-setup-save/);
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
