// Canonical Athlete shell identity. Supabase session state remains authoritative.
(() => {
  let accessRequest = 0;
  let currentAthleteShareName = "";
  let resolvedIdentity = { userId: "", profile: null };
  function safeAthleteName(profile = {}) {
    const username = typeof profile.username === "string" ? profile.username.trim() : "";
    return username;
  }
  function identityModel(account = {}, profile = {}) {
    const username = typeof profile.username === "string" ? profile.username.trim() : "";
    if (account.signedIn && username) {
      return {
        label: "Fuel Guard Athlete",
        value: username,
        resolving: false,
        ariaLabel: `Athlete ${username}. Open account settings.`
      };
    }
    if (account.signedIn) return {
      label: "Fuel Guard Athlete",
      value: "",
      resolving: true,
      ariaLabel: "Athlete username is loading. Open account settings."
    };
    return {
      label: "Not signed in",
      value: "Log in",
      resolving: false,
      ariaLabel: "Log in to Fuel Guard"
    };
  }

  function renderMainAccountIdentity(account = window.fuelGuardCloud?.accountView?.() || {}, profile = {}) {
    const model = identityModel(account, profile);
    currentAthleteShareName = account.signedIn ? safeAthleteName(profile) : "";
    const control = document.getElementById("mainAccountIdentity");
    const label = document.getElementById("mainAccountIdentityLabel");
    const value = document.getElementById("mainAccountIdentityValue");
    if (control) control.setAttribute("aria-label", model.ariaLabel);
    control?.classList?.toggle?.("resolving", model.resolving);
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
        .select("coach_enabled,username,first_name,display_name")
        .eq("user_id", user.id)
        .maybeSingle(),
      client.rpc("fuel_performance_context")
    ]);
    const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
    const performance = performanceResult.status === "fulfilled" ? performanceResult.value : null;
    return {
      coach: !profile?.error && profile?.data?.coach_enabled === true,
      performance: !performance?.error && Array.isArray(performance?.data) && performance.data.length > 0,
      profile: !profile?.error ? profile?.data || null : null
    };
  }

  async function resolveProductAccess() {
    const request = ++accessRequest;
    const cloud = window.fuelGuardCloud;
    const account = cloud?.accountView?.() || {};
    if (!account.signedIn || !cloud?.user?.id) {
      resolvedIdentity = { userId: "", profile: null };
      renderMainAccountIdentity(account);
      return renderProductAccess();
    }
    const userId = String(cloud.user.id);
    renderMainAccountIdentity(account, resolvedIdentity.userId === userId ? resolvedIdentity.profile || {} : {});
    const result = await authorisedProducts(cloud.client, cloud.user);
    if (request !== accessRequest || cloud?.user?.id !== window.fuelGuardCloud?.user?.id) return result;
    resolvedIdentity = { userId, profile: result.profile || {} };
    renderMainAccountIdentity(account, result.profile || {});
    return renderProductAccess(result);
  }

  function renderShell() {
    const cloud = window.fuelGuardCloud;
    const account = cloud?.accountView?.() || {};
    const userId = String(cloud?.user?.id || "");
    const profile = account.signedIn && resolvedIdentity.userId === userId ? resolvedIdentity.profile || {} : {};
    renderMainAccountIdentity(account, profile);
    resolveProductAccess();
  }

  window.addEventListener("fuelguard:cloud-status", renderShell);
  document.addEventListener("DOMContentLoaded", renderShell);
  requestAnimationFrame(renderShell);

  window.fuelGuardProductShell = {
    renderMainAccountIdentity,
    renderProductAccess,
    resolveProductAccess,
    athleteShareName: () => currentAthleteShareName,
    _test: { identityModel, safeAthleteName, authorisedProducts }
  };
})();
