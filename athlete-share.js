(() => {
  "use strict";

  const BUTTON_ID = "athleteDailyShareButton";
  const STATUS_ID = "athleteDailyShareStatus";
  let activeIdentity = "";
  let sharing = false;

  function cloudUserId() {
    return String(window.fuelGuardCloud?.user?.id || "");
  }

  function setStatus(message = "") {
    const status = document.getElementById(STATUS_ID);
    if (status) status.textContent = message;
  }

  function setBusy(value) {
    sharing = Boolean(value);
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.disabled = sharing;
    button.setAttribute("aria-busy", sharing ? "true" : "false");
  }

  function dailyModel(now = new Date()) {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : {};
    return window.FuelGuardShareCard.buildDailyStoryModel({
      logs: Array.isArray(gap?.logs) ? gap.logs : [],
      sessions: Array.isArray(gap?.trainingMode?.sessions) ? gap.trainingMode.sessions : [],
      maximumGapMinutes: gap?.maximumFuelGapMinutes,
      domain: window.FuelGuardDomain,
      now
    });
  }

  function renderDailyStoryCanvas(now = new Date()) {
    const model = dailyModel(now);
    return {
      model,
      canvas: window.FuelGuardShareCard.renderTemplate(window.FuelGuardShareCard.DAILY_TEMPLATE, model)
    };
  }

  function dataUrlToBlob(dataUrl) {
    const [header, encoded] = String(dataUrl || "").split(",");
    const type = header.match(/^data:([^;]+)/)?.[1] || "image/png";
    if (!encoded || typeof atob !== "function") throw new Error("Story image export is not supported in this browser.");
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type });
  }

  function storyBlob(canvas) {
    if (!canvas?.toDataURL) throw new Error("Story image export is not supported in this browser.");
    return dataUrlToBlob(canvas.toDataURL("image/png"));
  }

  function downloadStory(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function fallbackDownload(blob, filename, message = "Story saved as an image. Share it from Photos.") {
    downloadStory(blob, filename);
    setStatus(message);
  }

  function finishShare() {
    setBusy(false);
  }

  function shareDailyStory() {
    if (sharing) return;
    resetForCurrentIdentity();
    const requestedIdentity = activeIdentity;
    setBusy(true);
    setStatus("Creating your story…");
    let model;
    let blob;
    let filename;
    try {
      const rendered = renderDailyStoryCanvas(new Date());
      model = rendered.model;
      blob = storyBlob(rendered.canvas);
      filename = window.FuelGuardShareCard.dailyStoryFilename(model);
    } catch (error) {
      setStatus(`Story could not be created: ${error?.message || "unknown error"}`);
      finishShare();
      return;
    }

    const file = typeof File === "function" ? new File([blob], filename, { type: "image/png" }) : null;
    let canShareFile = false;
    try {
      canShareFile = Boolean(file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }));
    } catch {
      canShareFile = false;
    }

    if (!canShareFile) {
      fallbackDownload(blob, filename);
      finishShare();
      return;
    }

    // Rendering is deliberately synchronous so navigator.share is called in
    // the original tap task and retains the browser's transient user gesture.
    Promise.resolve(navigator.share({
      files: [file],
      title: "My Fuel Guard daily rhythm",
      text: "Today’s Fuel Guard rhythm"
    })).then(() => {
      if (requestedIdentity !== activeIdentity) return;
      setStatus("Story shared.");
    }).catch(error => {
      if (requestedIdentity !== activeIdentity) return;
      if (error?.name === "AbortError") {
        setStatus("Share cancelled.");
        return;
      }
      fallbackDownload(blob, filename, "Sharing was unavailable, so your story was saved as an image.");
    }).finally(finishShare);
  }

  function resetForCurrentIdentity() {
    const nextIdentity = cloudUserId();
    if (nextIdentity === activeIdentity) return;
    activeIdentity = nextIdentity;
    sharing = false;
    setBusy(false);
    setStatus("");
  }

  function init() {
    activeIdentity = cloudUserId();
    document.getElementById(BUTTON_ID)?.addEventListener("click", shareDailyStory);
    window.addEventListener("fuelguard:cloud-status", resetForCurrentIdentity);
    window.addEventListener("pageshow", resetForCurrentIdentity);
  }

  window.FuelGuardAthleteShare = Object.freeze({
    renderDailyStoryCanvas,
    shareDailyStory,
    _test: Object.freeze({ dailyModel, storyBlob, dataUrlToBlob, resetForCurrentIdentity })
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
