(function attachGarminQuickLogOnboarding(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardGarminOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createGarminQuickLogOnboarding(root) {
  "use strict";

  const STORAGE_PREFIX = "fuelGuardQuickLogOnboardingDismissed:";
  let auth = { signedIn: false, userId: "" };
  let garmin = { status: "unknown", userId: "", quickLogConnected: false };

  function popup() {
    return root?.document?.getElementById?.("garminQuickLogOnboarding") || null;
  }

  function key(userId = auth.userId) {
    return `${STORAGE_PREFIX}${String(userId || "anonymous")}`;
  }

  function dismissed(userId = auth.userId) {
    if (!userId) return true;
    try { return root.localStorage?.getItem(key(userId)) === "1"; }
    catch (_error) { return false; }
  }

  function shouldShow() {
    return Boolean(
      auth.signedIn
      && auth.userId
      && garmin.status === "ready"
      && garmin.userId === auth.userId
      && !garmin.quickLogConnected
      && !dismissed(auth.userId)
    );
  }

  function render() {
    const target = popup();
    if (!target) return false;
    const visible = shouldShow();
    target.hidden = !visible;
    target.setAttribute("aria-hidden", visible ? "false" : "true");
    return visible;
  }

  function dismiss() {
    if (auth.userId) {
      try { root.localStorage?.setItem(key(auth.userId), "1"); } catch (_error) {}
    }
    render();
  }

  function updateAuth(detail = {}) {
    auth = {
      signedIn: Boolean(detail.signedIn),
      userId: String(detail.user?.id || detail.userId || "")
    };
    if (!auth.signedIn) garmin = { status: "unknown", userId: "", quickLogConnected: false };
    render();
  }

  function updateGarmin(detail = {}) {
    garmin = {
      status: String(detail.status || "unknown"),
      userId: String(detail.userId || ""),
      quickLogConnected: Boolean(detail.quickLogConnected)
    };
    render();
  }

  function init() {
    root.addEventListener?.("fuelguard:auth-state", event => updateAuth(event.detail));
    root.addEventListener?.("fuelguard:garmin-devices", event => updateGarmin(event.detail));
    root.document?.getElementById?.("garminOnboardingNotNow")?.addEventListener("click", dismiss);
    root.document?.getElementById?.("garminOnboardingDismissIcon")?.addEventListener("click", dismiss);
    const cloud = root.fuelGuardCloud;
    updateAuth({ signedIn: Boolean(cloud?.user), user: cloud?.user || null });
  }

  if (root?.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init, { once: true });
  else root?.requestAnimationFrame?.(init);

  return Object.freeze({
    init,
    dismiss,
    render,
    _test: Object.freeze({ key, dismissed, shouldShow, updateAuth, updateGarmin })
  });
});
