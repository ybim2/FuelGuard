// Canonical Athlete shell identity. Supabase session state remains authoritative.
(() => {
  function identityModel(account = {}) {
    const email = typeof account.email === "string" ? account.email.trim() : "";
    if (account.signedIn && email) {
      return {
        label: "Signed in as",
        value: email,
        ariaLabel: `Signed in as ${email}. Open account settings.`
      };
    }
    return {
      label: "Not signed in",
      value: "Log in",
      ariaLabel: "Log in to Fuel Guard"
    };
  }

  function renderMainAccountIdentity(account = window.fuelGuardCloud?.accountView?.() || {}) {
    const model = identityModel(account);
    const control = document.getElementById("mainAccountIdentity");
    const label = document.getElementById("mainAccountIdentityLabel");
    const value = document.getElementById("mainAccountIdentityValue");
    if (control) control.setAttribute("aria-label", model.ariaLabel);
    if (label) label.textContent = model.label;
    if (value) value.textContent = model.value;
    return model;
  }

  window.addEventListener("fuelguard:cloud-status", () => renderMainAccountIdentity());
  document.addEventListener("DOMContentLoaded", () => renderMainAccountIdentity());
  requestAnimationFrame(() => renderMainAccountIdentity());

  window.fuelGuardProductShell = {
    renderMainAccountIdentity,
    _test: { identityModel }
  };
})();
