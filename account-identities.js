(() => {
  "use strict";
  let loadedFor = "";
  let identities = [];
  let message = "";
  let busy = false;
  function cloud() { return window.fuelGuardCloud; }
  function escape(value) { return window.FuelGuardDomain?.escapeHtml?.(value) || String(value ?? ""); }
  function providerLabel(provider) { return ({ apple: "Apple", google: "Google", email: "Email" })[String(provider || "").toLowerCase()] || "Login method"; }
  function render() {
    const card = document.getElementById("athleteLoginMethodsCard");
    const target = document.getElementById("athleteLoginMethods");
    const status = document.getElementById("athleteLoginMethodsStatus");
    const user = cloud()?.user;
    if (!card || !target) return;
    card.hidden = !user?.id;
    if (card.hidden) return;
    const enabled = Boolean(window.FUEL_GUARD_SUPABASE_CONFIG?.manualIdentityLinkingEnabled);
    const connected = new Map(identities.map(identity => [String(identity.provider || "email"), identity]));
    target.innerHTML = ["apple","google","email"].map(provider => {
      const identity = connected.get(provider);
      const availableEmail = provider === "email" && Boolean(user?.email);
      const state = identity ? "Connected" : availableEmail ? "Available" : "Not connected";
      const canRemove = enabled && identity && identities.length > 1;
      return `<article class="fuel-login-method"><span><strong>${escape(providerLabel(provider))}</strong><small>${state}</small></span>${canRemove ? `<button type="button" class="secondary" data-unlink-identity="${escape(identity.id)}">Remove</button>` : ""}</article>`;
    }).join("");
    if (enabled) {
      const providers = new Set(identities.map(identity => identity.provider));
      target.insertAdjacentHTML("beforeend", `<div class="button-row beta-settings-actions">${!providers.has("apple") ? `<button class="secondary" type="button" data-link-identity="apple">Link Apple</button>` : ""}${!providers.has("google") ? `<button class="secondary" type="button" data-link-identity="google">Link Google</button>` : ""}</div>`);
    }
    target.querySelectorAll("button").forEach(button => { button.disabled = busy; });
    if (status) status.textContent = message || (identities.length === 1 ? "This is your only usable login method, so it cannot be removed." : "Login methods belong to this authenticated account.");
  }
  async function load(force = false) {
    const userId = String(cloud()?.user?.id || "");
    if (!userId) { loadedFor = ""; identities = []; render(); return; }
    if (!force && loadedFor === userId) { render(); return; }
    try { identities = await cloud().userIdentities(); loadedFor = userId; message = ""; }
    catch (error) { message = `Login methods could not be loaded: ${error?.message || "unknown error"}`; }
    render();
  }
  document.addEventListener("click", async event => {
    const link = event.target.closest("[data-link-identity]");
    const unlink = event.target.closest("[data-unlink-identity]");
    if (!link && !unlink) return;
    busy = true; message = "Updating login methods…"; render();
    try {
      if (link) await cloud().linkIdentity(link.dataset.linkIdentity);
      else { await cloud().unlinkIdentity(identities.find(item => item.id === unlink.dataset.unlinkIdentity)); message = "Login method removed."; await load(true); }
    } catch (error) { message = error?.message || "Login method could not be updated."; }
    finally { busy = false; render(); }
  });
  window.addEventListener("fuelguard:auth-state", () => load());
  window.addEventListener("fuelguard:private-app-ready", () => load(true));
  document.addEventListener("DOMContentLoaded", () => load());
  window.FuelGuardAccountIdentities = Object.freeze({ load, _test: Object.freeze({ providerLabel }) });
})();
