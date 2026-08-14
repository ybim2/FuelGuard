(() => {
  "use strict";
  const SAFE_DESTINATIONS = new Set(["/", "/coach/", "/performance/"]);
  function safeNext(value) { return SAFE_DESTINATIONS.has(String(value || "")) ? String(value) : "/"; }
  async function complete() {
    const status = document.getElementById("fuelGuardCallbackStatus");
    const config = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    const params = new URLSearchParams(window.location.search);
    const next = safeNext(params.get("next"));
    const code = params.get("code") || "";
    if (!config.url || !config.anonKey || !window.supabase?.createClient || !code) throw new Error("The sign-in callback is incomplete.");
    const client = window.supabase.createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" } });
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (error) throw error;
    if (status) status.textContent = "Signed in";
    window.location.replace(next);
  }
  complete().catch(error => {
    const status = document.getElementById("fuelGuardCallbackStatus");
    if (status) status.textContent = error?.message || "Sign in could not be completed.";
    window.setTimeout(() => window.location.replace("/"), 2600);
  });
  if (typeof module === "object" && module.exports) module.exports = { safeNext };
})();
