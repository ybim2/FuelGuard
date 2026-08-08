// Athlete-controlled, explicit organisation consent. This UI uses only the
// current athlete session and the two narrow sharing RPCs.
(() => {
  const $ = id => document.getElementById(id);
  const safe = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
  let loading = false;

  function friendly(error) {
    const message = String(error?.message || error || "");
    if (/does not exist|schema cache|fuel_athlete_organisation/i.test(message)) return "Organisation sharing is not available in this environment yet.";
    if (/network|failed to fetch|load failed/i.test(message)) return "Could not refresh organisation sharing. Check your connection.";
    return "Organisation sharing could not be updated. Try again.";
  }

  async function load() {
    const card = $("organisationSharingCard");
    const list = $("organisationSharingList");
    const status = $("organisationSharingStatus");
    const cloud = window.fuelGuardCloud;
    if (!card || !list || !status || loading) return;
    if (!cloud?.signedIn || !cloud.client) {
      card.hidden = true;
      list.innerHTML = "";
      return;
    }
    loading = true;
    card.hidden = false;
    status.textContent = "Checking organisation invitations…";
    try {
      const { data, error } = await cloud.client.rpc("fuel_athlete_organisation_shares");
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        list.innerHTML = '<div class="beta-coach-sharing-empty">No organisation sharing invitations.</div>';
      } else {
        list.innerHTML = rows.map(row => {
          const active = row.status === "active";
          const invited = row.status === "invited";
          return `<article class="beta-coach-sharing-row">
            <div><strong>${safe(row.organisation_name)}</strong><span>${invited ? "Waiting for your approval" : active ? "Actively sharing" : "Sharing stopped"}</span></div>
            <div class="button-row beta-settings-actions">
              ${!active ? `<button class="secondary" type="button" data-organisation-share-id="${safe(row.share_id)}" data-organisation-share-status="active">${invited ? "Approve" : "Share again"}</button>` : ""}
              ${active ? `<button class="secondary danger-secondary" type="button" data-organisation-share-id="${safe(row.share_id)}" data-organisation-share-status="revoked">Stop sharing</button>` : ""}
            </div>
          </article>`;
        }).join("");
      }
      status.textContent = rows.length ? "Only approved, active relationships allow permissioned organisation access." : "Your personal Fuel Guard data remains private.";
    } catch (error) {
      list.innerHTML = "";
      status.textContent = friendly(error);
    } finally {
      loading = false;
    }
  }

  async function update(event) {
    const button = event.target.closest("[data-organisation-share-id]");
    if (!button) return;
    const status = $("organisationSharingStatus");
    button.disabled = true;
    status.textContent = button.dataset.organisationShareStatus === "active" ? "Approving organisation sharing…" : "Stopping organisation sharing…";
    const { error } = await window.fuelGuardCloud.client.rpc("fuel_athlete_set_organisation_sharing", {
      p_share_id: button.dataset.organisationShareId,
      p_status: button.dataset.organisationShareStatus
    });
    if (error) {
      status.textContent = friendly(error);
      button.disabled = false;
      return;
    }
    await load();
  }

  function init() {
    $("organisationSharingList")?.addEventListener("click", update);
    window.addEventListener("fuelguard:cloud-status", () => window.setTimeout(load, 0));
    window.setTimeout(load, 0);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
