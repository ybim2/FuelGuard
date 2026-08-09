(() => {
  async function sendNotification({ accessToken, kind, entityId, contextId = "" } = {}) {
    if (!accessToken || !kind || !entityId) throw new Error("Transactional email details are incomplete.");
    const response = await fetch("/api/email/invitation", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ kind, entity_id: entityId, ...(contextId ? { context_id: contextId } : {}) })
    });
    let result = null;
    try { result = await response.json(); } catch { result = null; }
    if (!response.ok) throw new Error(result?.message || "The transactional email could not be delivered.");
    return result;
  }

  window.FuelGuardTransactionalEmail = Object.freeze({
    sendNotification,
    sendInvitation: sendNotification
  });
})();
