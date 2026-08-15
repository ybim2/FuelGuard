(function attachFuelGuardAuthBoundary(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardAuthBoundary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardAuthBoundary(root) {
  "use strict";

  const SETUP_GUIDE_URL = "https://app.notion.com/p/Fuel-Guard-Setup-HQ-3b7ab7791e2081c0bf99dc4c34cb7501";
  const SAFE_DESTINATIONS = new Set(["/", "/coach/", "/performance/"]);
  const MIN_LOADING_MS = 1500;
  const LOADING_QUOTES = Object.freeze([
    "Fuel the work before the work asks for it.",
    "Don't wait for empty.",
    "Consistency starts with the next fuel.",
    "Your body can't use fuel you forgot to give it.",
    "Stay ahead of the gap.",
    "Fuel now. Perform later.",
    "Small fuel decisions compound."
  ]);
  let initialized = false;
  let busy = false;
  let currentPanel = "loading";
  let activeUserId = "";
  let loadingQuoteTimer = 0;
  let loadingTransitionTimer = 0;
  let loadingStartedAt = Date.now();
  let transitionRevision = 0;
  let onboardingUserId = "";

  function documentRef() {
    return root?.document || null;
  }

  function element(id) {
    return documentRef()?.getElementById?.(id) || null;
  }

  function safeNextPath(value) {
    const path = String(value || "").trim();
    return SAFE_DESTINATIONS.has(path) ? path : "/";
  }

  function requestedDestination() {
    try {
      return safeNextPath(new URLSearchParams(root.location.search).get("next"));
    } catch (_error) {
      return "/";
    }
  }

  function oauthRedirectUrl() {
    const url = new URL("/auth/callback/", root.location.origin);
    const next = requestedDestination();
    if (next !== "/") url.searchParams.set("next", next);
    return url.toString();
  }

  function status(message = "", tone = "") {
    [element("fuelGuardAuthStatus"), element("fuelGuardRecoveryStatus")].filter(Boolean).forEach(target => {
      target.textContent = message;
      target.dataset.tone = tone;
    });
  }

  function setBusy(active, message = "") {
    busy = Boolean(active);
    documentRef()?.querySelectorAll?.("[data-fuel-auth-action]").forEach(control => {
      control.disabled = busy;
      control.setAttribute("aria-busy", busy ? "true" : "false");
    });
    if (message) status(message);
  }

  function privateSurfaces() {
    return Array.from(documentRef()?.querySelectorAll?.("[data-private-ui]:not([data-managed-visibility])") || []);
  }

  function managedPrivateSurfaces() {
    return Array.from(documentRef()?.querySelectorAll?.("[data-private-ui][data-managed-visibility]") || []);
  }

  function hideManagedPrivateSurfaces() {
    managedPrivateSurfaces().forEach(surface => {
      surface.hidden = true;
      surface.setAttribute("inert", "");
    });
  }

  function setPrivateVisibility(visible) {
    privateSurfaces().forEach(surface => {
      surface.hidden = !visible;
      if (visible) surface.removeAttribute("inert");
      else surface.setAttribute("inert", "");
    });
    if (!visible) hideManagedPrivateSurfaces();
  }

  function stopLoadingQuotes() {
    if (loadingQuoteTimer && typeof root?.clearInterval === "function") root.clearInterval(loadingQuoteTimer);
    loadingQuoteTimer = 0;
  }

  function startLoadingQuotes() {
    const target = element("fuelGuardAuthLoadingQuote");
    stopLoadingQuotes();
    if (!target || !LOADING_QUOTES.length) return;
    let index = 0;
    try {
      index = Number(root.sessionStorage?.getItem?.("fuelGuardLoadingHookIndex") || 0) % LOADING_QUOTES.length;
    } catch (_error) {
      index = 0;
    }
    const showNext = () => {
      target.textContent = LOADING_QUOTES[index];
      index = (index + 1) % LOADING_QUOTES.length;
      try { root.sessionStorage?.setItem?.("fuelGuardLoadingHookIndex", String(index)); } catch (_error) {}
    };
    showNext();
    if (typeof root?.setInterval === "function") loadingQuoteTimer = root.setInterval(showNext, 2200);
  }

  function panel(name) {
    if (name === "loading" && currentPanel !== "loading") loadingStartedAt = Date.now();
    currentPanel = name;
    const boundary = element("fuelGuardAuthBoundary");
    const loading = element("fuelGuardAuthLoading");
    const login = element("fuelGuardAuthPanel");
    const recovery = element("fuelGuardRecoveryPanel");
    if (boundary) boundary.hidden = name === "app";
    if (loading) loading.hidden = name !== "loading";
    if (login) login.hidden = name !== "login";
    if (recovery) recovery.hidden = name !== "recovery";
    if (name === "loading") startLoadingQuotes();
    else stopLoadingQuotes();
    setPrivateVisibility(name === "app");
    documentRef()?.body?.classList.toggle("auth-pending", name === "loading");
    documentRef()?.body?.classList.toggle("auth-logged-out", name === "login" || name === "recovery");
    documentRef()?.body?.classList.toggle("auth-authenticated", name === "app");
  }

  function afterMinimumLoading(callback) {
    const revision = ++transitionRevision;
    if (loadingTransitionTimer && typeof root?.clearTimeout === "function") root.clearTimeout(loadingTransitionTimer);
    loadingTransitionTimer = 0;
    const complete = () => {
      if (revision !== transitionRevision) return;
      loadingTransitionTimer = 0;
      callback();
    };
    const remaining = currentPanel === "loading" ? Math.max(0, MIN_LOADING_MS - (Date.now() - loadingStartedAt)) : 0;
    if (remaining > 0 && typeof root?.setTimeout === "function") loadingTransitionTimer = root.setTimeout(complete, remaining);
    else complete();
  }

  function showLogin(message = "") {
    afterMinimumLoading(() => {
      activeUserId = "";
      panel("login");
      const cloud = root.fuelGuardCloud;
      const configured = Boolean(cloud?.configured);
      const appleButton = element("fuelGuardAppleButton");
      if (appleButton) appleButton.hidden = root.FUEL_GUARD_SUPABASE_CONFIG?.appleAuthEnabled === false;
      documentRef()?.querySelectorAll?.("[data-fuel-auth-action]").forEach(control => {
        control.disabled = !configured;
      });
      status(message || (configured ? "" : "Fuel Guard authentication is not configured in this environment."), configured ? "" : "error");
      root.requestAnimationFrame?.(() => element("fuelGuardAuthEmail")?.focus?.());
    });
  }

  function showRecovery(message = "") {
    afterMinimumLoading(() => {
      activeUserId = "";
      panel("recovery");
      status(message || "Choose a new password for your Fuel Guard account.");
      root.requestAnimationFrame?.(() => element("fuelGuardNewPassword")?.focus?.());
    });
  }

  function showApp(user) {
    afterMinimumLoading(() => {
      const userId = String(user?.id || "");
      const newlyReady = currentPanel !== "app" || activeUserId !== userId;
      activeUserId = userId;
      panel("app");
      status("");
      if (newlyReady && typeof root.dispatchEvent === "function") {
        const detail = { userId };
        const EventConstructor = root.CustomEvent || globalThis.CustomEvent;
        root.dispatchEvent(typeof EventConstructor === "function"
          ? new EventConstructor("fuelguard:private-app-ready", { detail })
          : { type: "fuelguard:private-app-ready", detail });
      }
      const destination = requestedDestination();
      if (destination !== "/" && root.location.pathname !== destination) root.location.replace(destination);
      ensurePreferredName(user);
    });
  }

  async function ensurePreferredName(user) {
    const userId = String(user?.id || "");
    if (!userId || onboardingUserId === userId) return;
    onboardingUserId = userId;
    try {
      const profile = await root.fuelGuardCloud?.authProfile?.();
      if (String(profile?.first_name || profile?.display_name || "").trim()) return;
      const panel = element("fuelGuardNameOnboarding");
      if (panel) {
        panel.hidden = false;
        panel.removeAttribute("inert");
        root.dispatchEvent?.(new CustomEvent("fuelguard:onboarding-started", { detail: { userId } }));
        root.requestAnimationFrame?.(() => element("fuelGuardPreferredName")?.focus?.());
      }
    } catch (_error) {
      onboardingUserId = "";
    }
  }

  function applyState(detail = null) {
    const account = detail || root.fuelGuardCloud?.accountView?.() || {};
    if (account.recovering) {
      showRecovery();
      return "recovery";
    }
    if (account.signedIn || root.fuelGuardCloud?.user) {
      showApp(root.fuelGuardCloud?.user || detail?.user || null);
      return "app";
    }
    showLogin();
    return "login";
  }

  function credentials() {
    return {
      email: element("fuelGuardAuthEmail")?.value?.trim() || "",
      password: element("fuelGuardAuthPassword")?.value || ""
    };
  }

  function friendlyError(error, fallback) {
    const message = String(error?.message || error || "");
    if (/invalid login credentials/i.test(message)) return "Those login details did not work.";
    if (/provider.*not enabled|unsupported provider/i.test(message)) return "That sign-in method is not available yet. Use another method or contact Fuel Guard support.";
    if (/rate limit|too many requests|over_email_send_rate_limit/i.test(message)) return "Please wait before requesting another authentication email.";
    if (/failed to fetch|network|load failed/i.test(message)) return "Fuel Guard could not reach authentication. Check your connection and try again.";
    return message || fallback;
  }

  async function withBusy(message, callback) {
    if (busy) return;
    try {
      setBusy(true, message);
      await callback();
    } catch (error) {
      status(friendlyError(error, "Authentication could not be completed."), "error");
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    await withBusy("Opening Google sign-in…", async () => {
      await root.fuelGuardCloud?.signInWithGoogle?.({ redirectTo: oauthRedirectUrl() });
    });
  }

  async function apple() {
    await withBusy("Opening Apple sign-in…", async () => {
      await root.fuelGuardCloud?.signInWithApple?.({ redirectTo: oauthRedirectUrl() });
    });
  }

  async function savePreferredName() {
    await withBusy("Saving your name…", async () => {
      const value = element("fuelGuardPreferredName")?.value || "";
      const profile = await root.fuelGuardCloud?.savePreferredName?.(value);
      const panel = element("fuelGuardNameOnboarding");
      if (panel) { panel.hidden = true; panel.setAttribute("inert", ""); }
      root.dispatchEvent?.(new CustomEvent("fuelguard:profile-name-ready", { detail: profile }));
    });
  }

  async function signIn() {
    await withBusy("Signing in…", async () => {
      const { email, password } = credentials();
      if (!email || !password) throw new Error("Enter your email and password.");
      await root.fuelGuardCloud?.signIn?.(email, password);
      applyState();
    });
  }

  async function signUp() {
    await withBusy("Creating your Fuel Guard account…", async () => {
      const { email, password } = credentials();
      if (!email || !password) throw new Error("Enter your email and a password to create an account.");
      const result = await root.fuelGuardCloud?.signUp?.(email, password);
      root.FuelGuardProductAnalytics?.markAccountCreatedPending?.(result?.user?.id);
      if (result?.session) applyState();
      else status("Account created. Check your inbox to confirm your email, then return to Fuel Guard.", "success");
    });
  }

  async function resetPassword() {
    await withBusy("Sending password reset email…", async () => {
      const { email } = credentials();
      if (!email) throw new Error("Enter your email address first.");
      await root.fuelGuardCloud?.sendPasswordReset?.(email);
      status("Password reset email sent. Check your inbox before requesting another one.", "success");
    });
  }

  async function updatePassword() {
    await withBusy("Updating your password…", async () => {
      const password = element("fuelGuardNewPassword")?.value || "";
      const confirmation = element("fuelGuardConfirmPassword")?.value || "";
      if (!password || !confirmation) throw new Error("Enter and confirm your new password.");
      if (password !== confirmation) throw new Error("The passwords do not match.");
      if (password.length < 8) throw new Error("Use at least 8 characters.");
      await root.fuelGuardCloud?.updatePassword?.(password);
      applyState();
    });
  }

  function bind() {
    element("fuelGuardAppleButton")?.addEventListener("click", apple);
    element("fuelGuardGoogleButton")?.addEventListener("click", google);
    element("fuelGuardSavePreferredName")?.addEventListener("click", savePreferredName);
    element("fuelGuardEmailSignIn")?.addEventListener("click", signIn);
    element("fuelGuardEmailSignUp")?.addEventListener("click", signUp);
    element("fuelGuardForgotPassword")?.addEventListener("click", resetPassword);
    element("fuelGuardUpdatePassword")?.addEventListener("click", updatePassword);
    element("fuelGuardCancelRecovery")?.addEventListener("click", () => {
      root.fuelGuardCloud?.cancelPasswordRecovery?.();
      showLogin();
    });
    element("fuelGuardAuthPassword")?.addEventListener("keydown", event => {
      if (event.key === "Enter") signIn();
    });
  }

  async function init() {
    if (initialized) return applyState();
    initialized = true;
    panel("loading");
    bind();
    root.addEventListener?.("fuelguard:auth-state", event => applyState(event.detail));
    root.addEventListener?.("fuelguard:password-recovery", event => {
      if (event.detail?.active) showRecovery();
      else applyState();
    });
    try {
      await root.fuelGuardCloud?.init?.();
      return applyState();
    } catch (error) {
      showLogin(friendlyError(error, "Fuel Guard authentication could not be loaded."));
      return "login";
    }
  }

  if (documentRef()?.readyState === "loading") documentRef().addEventListener("DOMContentLoaded", init, { once: true });
  else root.requestAnimationFrame?.(init);

  return Object.freeze({
    init,
    applyState,
    oauthRedirectUrl,
    setupGuideUrl: SETUP_GUIDE_URL,
    _test: Object.freeze({ safeNextPath, friendlyError, loadingQuotes: LOADING_QUOTES, minimumLoadingMs: MIN_LOADING_MS })
  });
});
