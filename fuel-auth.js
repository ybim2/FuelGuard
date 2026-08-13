(function attachFuelGuardAuthBoundary(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardAuthBoundary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardAuthBoundary(root) {
  "use strict";

  const SETUP_GUIDE_URL = "https://app.notion.com/p/Fuel-Guard-Setup-HQ-3b7ab7791e2081c0bf99dc4c34cb7501";
  const SAFE_DESTINATIONS = new Set(["/", "/coach/", "/performance/"]);
  let initialized = false;
  let busy = false;
  let currentPanel = "loading";
  let activeUserId = "";

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
    const url = new URL("/", root.location.origin);
    url.searchParams.set("auth", "oauth");
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

  function setPrivateVisibility(visible) {
    privateSurfaces().forEach(surface => {
      surface.hidden = !visible;
      if (visible) surface.removeAttribute("inert");
      else surface.setAttribute("inert", "");
    });
  }

  function panel(name) {
    currentPanel = name;
    const boundary = element("fuelGuardAuthBoundary");
    const loading = element("fuelGuardAuthLoading");
    const login = element("fuelGuardAuthPanel");
    const recovery = element("fuelGuardRecoveryPanel");
    if (boundary) boundary.hidden = name === "app";
    if (loading) loading.hidden = name !== "loading";
    if (login) login.hidden = name !== "login";
    if (recovery) recovery.hidden = name !== "recovery";
    setPrivateVisibility(name === "app");
    documentRef()?.body?.classList.toggle("auth-pending", name === "loading");
    documentRef()?.body?.classList.toggle("auth-logged-out", name === "login" || name === "recovery");
    documentRef()?.body?.classList.toggle("auth-authenticated", name === "app");
  }

  function showLogin(message = "") {
    activeUserId = "";
    panel("login");
    const cloud = root.fuelGuardCloud;
    const configured = Boolean(cloud?.configured);
    documentRef()?.querySelectorAll?.("[data-fuel-auth-action]").forEach(control => {
      control.disabled = !configured;
    });
    status(message || (configured ? "" : "Fuel Guard authentication is not configured in this environment."), configured ? "" : "error");
    root.requestAnimationFrame?.(() => element("fuelGuardGoogleButton")?.focus?.());
  }

  function showRecovery(message = "") {
    activeUserId = "";
    panel("recovery");
    status(message || "Choose a new password for your Fuel Guard account.");
    root.requestAnimationFrame?.(() => element("fuelGuardNewPassword")?.focus?.());
  }

  function showApp(user) {
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
    if (destination !== "/" && root.location.pathname !== destination) {
      root.location.replace(destination);
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
    if (/provider.*not enabled|unsupported provider/i.test(message)) return "Google sign-in is not available yet. Use email or contact Fuel Guard support.";
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
    element("fuelGuardGoogleButton")?.addEventListener("click", google);
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
    _test: Object.freeze({ safeNextPath, friendlyError })
  });
});
