// Canonical Athlete shell identity. Supabase session state remains authoritative.
(() => {
  let accessRequest = 0;
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

  function renderProductAccess({ coach = false, performance = false } = {}) {
    const coachLink = document.getElementById("coachProductLink");
    const performanceLink = document.getElementById("performanceProductLink");
    if (coachLink) coachLink.hidden = !coach;
    if (performanceLink) performanceLink.hidden = !performance;
    return { coach: Boolean(coach), performance: Boolean(performance) };
  }

  async function authorisedProducts(client, user) {
    if (!client || !user?.id) return { coach: false, performance: false };
    const [profileResult, performanceResult] = await Promise.allSettled([
      client.from("fuel_user_profiles")
        .select("coach_enabled")
        .eq("user_id", user.id)
        .maybeSingle(),
      client.rpc("fuel_performance_context")
    ]);
    const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
    const performance = performanceResult.status === "fulfilled" ? performanceResult.value : null;
    return {
      coach: !profile?.error && profile?.data?.coach_enabled === true,
      performance: !performance?.error && Array.isArray(performance?.data) && performance.data.length > 0
    };
  }

  async function resolveProductAccess() {
    const request = ++accessRequest;
    const cloud = window.fuelGuardCloud;
    const account = cloud?.accountView?.() || {};
    if (!account.signedIn || !cloud?.user?.id) return renderProductAccess();
    const result = await authorisedProducts(cloud.client, cloud.user);
    if (request !== accessRequest || cloud?.user?.id !== window.fuelGuardCloud?.user?.id) return result;
    return renderProductAccess(result);
  }

  function renderShell() {
    renderMainAccountIdentity();
    resolveProductAccess();
  }

  window.addEventListener("fuelguard:cloud-status", renderShell);
  document.addEventListener("DOMContentLoaded", renderShell);
  requestAnimationFrame(renderShell);

  window.fuelGuardProductShell = {
    renderMainAccountIdentity,
    renderProductAccess,
    resolveProductAccess,
    _test: { identityModel, authorisedProducts }
  };
})();
