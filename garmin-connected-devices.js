(() => {
  const appLabels = {
    quick_log: "Quick Log",
    activity_logger: "Activity Logger"
  };
  let busy = false;

  function els() {
    return {
      card: document.getElementById("garminDevicesCard"),
      list: document.getElementById("garminDevicesList"),
      status: document.getElementById("garminDevicesStatus"),
      refresh: document.getElementById("garminDevicesRefresh")
    };
  }

  function cloud() {
    return window.fuelGuardCloud || null;
  }

  function token() {
    return cloud()?.accessToken?.() || "";
  }

  function fmt(value) {
    if (!value) return "Never";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function setStatus(message) {
    const { status } = els();
    if (status) status.textContent = message || "";
  }

  function renderRows(devices) {
    const { list } = els();
    if (!list) return;
    const active = devices.filter(device => !device.revoked_at);
    if (!active.length) {
      list.innerHTML = '<p class="row-note">No Garmin apps are connected yet.</p>';
      return;
    }
    list.innerHTML = active.map(device => `
      <div class="beta-garmin-device-row">
        <div>
          <strong>${appLabels[device.app_id] || "Garmin app"}</strong>
          <span>Connected ${fmt(device.created_at)} · Last used ${fmt(device.last_used_at)}</span>
        </div>
        <button class="secondary" type="button" data-garmin-revoke="${device.id}">Revoke</button>
      </div>
    `).join("");
  }

  async function loadDevices() {
    const { card, list, refresh } = els();
    if (!card || busy) return;
    const account = cloud()?.accountView?.() || {};
    card.hidden = !account.signedIn;
    if (!account.signedIn) return;
    if (!token()) {
      if (list) list.innerHTML = '<p class="row-note">Sign in again to manage Garmin connections.</p>';
      return;
    }
    try {
      busy = true;
      if (refresh) refresh.disabled = true;
      setStatus("Checking connected Garmin apps...");
      const response = await fetch("/api/garmin/devices", { headers: { Authorization: `Bearer ${token()}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load Garmin apps.");
      renderRows(data.devices || []);
      setStatus("Connected Garmin apps are shown without revealing tokens.");
    } catch (error) {
      setStatus(error?.message || "Could not load Garmin apps.");
    } finally {
      busy = false;
      if (refresh) refresh.disabled = false;
    }
  }

  async function revoke(deviceId) {
    if (busy || !deviceId || !token()) return;
    try {
      busy = true;
      setStatus("Revoking Garmin app...");
      const response = await fetch("/api/garmin/devices/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token()}`
        },
        body: JSON.stringify({ device_id: deviceId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not revoke Garmin app.");
      setStatus("Garmin app revoked.");
      await loadDevices();
    } catch (error) {
      setStatus(error?.message || "Could not revoke Garmin app.");
    } finally {
      busy = false;
    }
  }

  document.addEventListener("click", event => {
    const revokeButton = event.target.closest("[data-garmin-revoke]");
    if (revokeButton) revoke(revokeButton.getAttribute("data-garmin-revoke"));
  });

  document.addEventListener("DOMContentLoaded", () => {
    els().refresh?.addEventListener("click", loadDevices);
    loadDevices();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) loadDevices();
  });
  window.addEventListener("fuelguard:cloud-status", loadDevices);
  window.fuelGuardGarminDevices = { refresh: loadDevices };
})();
