(function attachFuelGuardLoggingFeedback(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FuelGuardLoggingFeedback = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createFuelGuardLoggingFeedback(root) {
  "use strict";

  const LABELS = Object.freeze({
    fuel: "Fuel logged",
    hydration: "Hydration logged",
    fuel_hydration: "Fuel + hydration logged",
    sleepy: "Sleepy logged"
  });
  const shownKeys = new Set();
  let timer = 0;

  function normalizeType(value) {
    const type = String(value || "fuel").toLowerCase();
    return Object.hasOwn(LABELS, type) ? type : "fuel";
  }

  function persistenceSucceeded(result) {
    return result?.status === "synced" && result?.persisted === true;
  }

  function acknowledgementFor(type, acknowledgement = {}) {
    const normalized = normalizeType(type);
    return {
      headline: LABELS[normalized],
      context: String(acknowledgement?.context || ""),
      level: acknowledgement?.level === "milestone" ? "milestone" : "micro"
    };
  }

  function controlsFor(type) {
    if (type === "hydration") return "#graphLogHydrationButton, [data-training-log=\"hydration\"]";
    if (type === "sleepy") return "#graphLogSleepyButton";
    if (type === "fuel_hydration") return "#graphLogFoodButton, #graphLogHydrationButton, [data-training-log=\"fuel\"], [data-training-log=\"hydration\"]";
    return "#graphLogFoodButton, [data-training-log=\"fuel\"]";
  }

  function remember(key) {
    shownKeys.add(key);
    while (shownKeys.size > 80) shownKeys.delete(shownKeys.values().next().value);
  }

  function confirm({ type = "fuel", result = null, acknowledgement = null, logId = "" } = {}) {
    if (!persistenceSucceeded(result)) return false;
    const normalized = normalizeType(type);
    const key = String(logId || result?.row?.id || result?.log?.id || "");
    const dedupeKey = key ? `${normalized}:${key}` : "";
    if (dedupeKey && shownKeys.has(dedupeKey)) return false;
    if (dedupeKey) remember(dedupeKey);

    const document = root?.document;
    const target = document?.getElementById?.("athleteActionFeedback");
    if (!target) return false;
    if (timer && typeof root?.clearTimeout === "function") root.clearTimeout(timer);

    const message = acknowledgementFor(normalized, acknowledgement);
    const icon = message.level === "milestone" ? "✦" : "✓";
    target.className = `beta-action-feedback ${message.level} ${normalized}`;
    target.replaceChildren();

    const iconElement = document.createElement("b");
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.textContent = icon;
    const copy = document.createElement("span");
    const headline = document.createElement("strong");
    headline.textContent = message.headline;
    copy.append(headline);
    if (message.context) {
      const context = document.createElement("small");
      context.textContent = message.context;
      copy.append(context);
    }
    target.append(iconElement, copy);
    target.removeAttribute("inert");
    target.hidden = false;

    document.querySelectorAll(controlsFor(normalized)).forEach(button => {
      button.classList.remove("is-acknowledged");
      void button.offsetWidth;
      button.classList.add("is-acknowledged");
    });

    if (typeof root?.setTimeout === "function") {
      timer = root.setTimeout(() => {
        target.hidden = true;
        target.setAttribute("inert", "");
        target.replaceChildren();
        document.querySelectorAll(".is-acknowledged").forEach(button => button.classList.remove("is-acknowledged"));
        timer = 0;
      }, message.level === "milestone" ? 2200 : 1100);
    }
    if (typeof root?.dispatchEvent === "function") {
      const detail = { type: normalized, logId: key, headline: message.headline };
      const EventConstructor = root.CustomEvent || globalThis.CustomEvent;
      root.dispatchEvent(typeof EventConstructor === "function"
        ? new EventConstructor("fuelguard:logging-confirmed", { detail })
        : { type: "fuelguard:logging-confirmed", detail });
    }
    return true;
  }

  function reset() {
    shownKeys.clear();
    if (timer && typeof root?.clearTimeout === "function") root.clearTimeout(timer);
    timer = 0;
  }

  return Object.freeze({
    confirm,
    reset,
    _test: Object.freeze({ normalizeType, persistenceSucceeded, acknowledgementFor })
  });
});
