(() => {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get("app") || "";
  const state = params.get("state") || "";
  const appLabels = {
    quick_log: "Fuel Guard Quick Log",
    activity_logger: "Fuel Guard Activity Logger"
  };
  const title = document.getElementById("connectTitle");
  const intro = document.getElementById("connectIntro");
  const status = document.getElementById("connectStatus");
  const authPanel = document.getElementById("authPanel");
  const approvalPanel = document.getElementById("approvalPanel");
  const approvalCopy = document.getElementById("approvalCopy");
  const email = document.getElementById("connectEmail");
  const password = document.getElementById("connectPassword");
  const signIn = document.getElementById("connectSignIn");
  const signUp = document.getElementById("connectSignUp");
  const approve = document.getElementById("approveButton");
  const deny = document.getElementById("denyButton");
  let client = null;
  let session = null;
  let busy = false;

  function setBusy(next) {
    busy = next;
    [signIn, signUp, approve, deny].forEach(button => {
      if (button) button.disabled = busy;
    });
  }

  function setStatus(message) {
    if (status) status.textContent = message || "";
  }

  function appLabel() {
    return appLabels[appId] || "Fuel Guard Garmin app";
  }

  function configured() {
    const cfg = window.FUEL_GUARD_SUPABASE_CONFIG || {};
    return Boolean(cfg.url && cfg.anonKey && window.supabase?.createClient);
  }

  async function refreshSession() {
    const result = await client.auth.getSession();
    session = result.data?.session || null;
    render();
  }

  function render() {
    if (!appLabels[appId] || !state) {
      title.textContent = "Connection request not recognised";
      intro.textContent = "Open this page from the Fuel Guard Garmin app and try again.";
      authPanel.hidden = true;
      approvalPanel.hidden = true;
      return;
    }

    title.textContent = `Connect ${appLabel()}`;
    intro.textContent = "Approve this request to let your Garmin app create fuel and hydration timestamps in your Fuel Guard account.";
    authPanel.hidden = Boolean(session?.user);
    approvalPanel.hidden = !session?.user;
    if (approvalCopy) {
      approvalCopy.textContent = session?.user
        ? `Signed in as ${session.user.email || "your Fuel Guard account"}. Your watch will receive its own revocable device token. The token is not shown to you.`
        : "Sign in to Fuel Guard before approving this Garmin connection.";
    }
  }

  async function authAction(mode) {
    if (busy) return;
    const address = email.value.trim();
    const secret = password.value;
    if (!address || !secret) {
      setStatus("Enter your email and password first.");
      return;
    }
    try {
      setBusy(true);
      setStatus(mode === "signUp" ? "Creating account..." : "Signing in...");
      const result = mode === "signUp"
        ? await client.auth.signUp({ email: address, password: secret, options: { emailRedirectTo: window.location.href } })
        : await client.auth.signInWithPassword({ email: address, password: secret });
      if (result.error) throw result.error;
      await refreshSession();
      setStatus(session?.user ? "Signed in. You can approve the Garmin connection." : "Check your email, then return here to approve the Garmin connection.");
    } catch (error) {
      setStatus(error?.message || "Fuel Guard sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function approvalAction(approved) {
    if (busy || !session?.access_token) return;
    try {
      setBusy(true);
      setStatus(approved ? "Approving Garmin connection..." : "Denying Garmin connection...");
      const response = await fetch(approved ? "/api/garmin/auth/approve" : "/api/garmin/auth/deny", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ app_id: appId, state })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || "Garmin connection failed.");
      if (data.redirect_url) {
        setStatus(approved ? "Connection approved. Returning to Garmin..." : "Connection denied. Returning to Garmin...");
        window.location.href = data.redirect_url;
        return;
      }
      setStatus("Connection response did not include a Garmin redirect. Open the Garmin app and try again.");
    } catch (error) {
      setStatus(error?.message || "Garmin connection failed.");
    } finally {
      setBusy(false);
    }
  }

  async function init() {
    if (!configured()) {
      title.textContent = "Cloud sync not configured";
      intro.textContent = "Fuel Guard needs Supabase public URL/key configuration before Garmin pairing can be approved.";
      authPanel.hidden = true;
      approvalPanel.hidden = true;
      return;
    }
    const cfg = window.FUEL_GUARD_SUPABASE_CONFIG;
    client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    client.auth.onAuthStateChange((_event, nextSession) => {
      session = nextSession;
      render();
    });
    signIn?.addEventListener("click", () => authAction("signIn"));
    signUp?.addEventListener("click", () => authAction("signUp"));
    approve?.addEventListener("click", () => approvalAction(true));
    deny?.addEventListener("click", () => approvalAction(false));
    await refreshSession();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
