(() => {
  "use strict";

  const BUTTON_ID = "athleteDailyShareButton";
  const STATUS_ID = "athleteDailyShareStatus";
  let activeIdentity = "";
  let sharing = false;
  let selectedTemplate = "";
  let selectedRendered = null;
  let selectedIdentity = "";

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

  function settingsStatus(message = "") {
    const status = document.getElementById("athleteShareSettingsStatus");
    if (status) status.textContent = message;
  }

  function summaryData(now = new Date()) {
    const gap = typeof fuelGapState === "function" ? fuelGapState() : {};
    return {
      logs: Array.isArray(gap?.logs) ? gap.logs : [],
      sessions: Array.isArray(gap?.trainingMode?.sessions) ? gap.trainingMode.sessions : [],
      maximumGapMinutes: gap?.maximumFuelGapMinutes,
      domain: window.FuelGuardDomain,
      now
    };
  }

  function summaryFilename(template, now = new Date()) {
    const key = window.FuelGuardDomain?.dateKey?.(now) || now.toISOString().slice(0, 10);
    return `fuel-guard-${String(template || "story").replace(/[^a-z0-9-]+/gi, "-")}-${key}.png`;
  }

  function renderSettingsStory(template, now = new Date()) {
    resetForCurrentIdentity();
    const model = window.FuelGuardShareCard.buildSummaryModel(template, summaryData(now));
    const canvas = window.FuelGuardShareCard.renderTemplate(template, model);
    selectedTemplate = template;
    selectedIdentity = activeIdentity;
    selectedRendered = { model, canvas, filename: summaryFilename(template, now) };
    const preview = document.getElementById("athleteSharePreviewCanvas");
    const panel = document.getElementById("athleteSharePreview");
    if (preview?.getContext) {
      preview.width = canvas.width;
      preview.height = canvas.height;
      preview.getContext("2d").drawImage(canvas, 0, 0);
    }
    if (panel) panel.hidden = false;
    document.querySelectorAll("[data-athlete-share-template]").forEach(button => {
      button.classList.toggle("selected", button.dataset.athleteShareTemplate === template);
    });
    settingsStatus("Preview uses your current Athlete records only.");
    return selectedRendered;
  }

  function shareSelectedStory({ downloadOnly = false } = {}) {
    if (selectedIdentity !== cloudUserId()) {
      resetForCurrentIdentity();
      settingsStatus("Your account changed. Choose a share card again.");
      return;
    }
    if (!selectedRendered || !selectedTemplate) {
      settingsStatus("Choose a share card first.");
      return;
    }
    let blob;
    try {
      blob = storyBlob(selectedRendered.canvas);
    } catch (error) {
      settingsStatus(`Card could not be exported: ${error?.message || "unknown error"}`);
      return;
    }
    if (downloadOnly) {
      downloadStory(blob, selectedRendered.filename);
      settingsStatus("Image saved. Share it from Photos or Files.");
      return;
    }
    const file = typeof File === "function" ? new File([blob], selectedRendered.filename, { type: "image/png" }) : null;
    let canShare = false;
    try {
      canShare = Boolean(file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }));
    } catch {
      canShare = false;
    }
    if (!canShare) {
      downloadStory(blob, selectedRendered.filename);
      settingsStatus("Native image sharing is unavailable, so the card was saved instead.");
      return;
    }
    settingsStatus("Opening your share sheet…");
    Promise.resolve(navigator.share({ files: [file], title: selectedRendered.model.title, text: "My Fuel Guard Athlete summary" }))
      .then(() => settingsStatus("Card shared."))
      .catch(error => settingsStatus(error?.name === "AbortError" ? "Share cancelled." : "Sharing failed. Use Save image instead."));
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
    selectedTemplate = "";
    selectedRendered = null;
    selectedIdentity = "";
    setBusy(false);
    setStatus("");
    settingsStatus("");
    const preview = document.getElementById("athleteSharePreview");
    if (preview) preview.hidden = true;
  }

  function init() {
    activeIdentity = cloudUserId();
    document.getElementById(BUTTON_ID)?.addEventListener("click", shareDailyStory);
    document.querySelectorAll("[data-athlete-share-template]").forEach(button => button.addEventListener("click", () => {
      try {
        renderSettingsStory(button.dataset.athleteShareTemplate, new Date());
      } catch (error) {
        settingsStatus(`Card could not be created: ${error?.message || "unknown error"}`);
      }
    }));
    document.getElementById("athleteShareSelectedButton")?.addEventListener("click", () => shareSelectedStory());
    document.getElementById("athleteShareDownloadButton")?.addEventListener("click", () => shareSelectedStory({ downloadOnly: true }));
    window.addEventListener("fuelguard:cloud-status", resetForCurrentIdentity);
    window.addEventListener("pageshow", resetForCurrentIdentity);
  }

  window.FuelGuardAthleteShare = Object.freeze({
    renderDailyStoryCanvas,
    shareDailyStory,
    renderSettingsStory,
    shareSelectedStory,
    _test: Object.freeze({ dailyModel, summaryData, summaryFilename, storyBlob, dataUrlToBlob, resetForCurrentIdentity })
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
