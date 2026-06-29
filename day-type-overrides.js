// Fuel Guard day type compatibility layer.
// Keeps older saved Shift Day and Training Day entries safe while the UI now uses Working Day.
(() => {
  const SHIFT_VALUES = new Set(["shift", "Shift day", "Shift Day", "shift day"]);
  const TRAINING_DAY_VALUES = new Set([
    "training",
    "Training day",
    "Training Day",
    "training day",
    "double-training",
    "standalone-training"
  ]);
  let applying = false;

  function isShiftValue(value) {
    return SHIFT_VALUES.has(String(value || "").trim());
  }

  function isTrainingDayValue(value) {
    return TRAINING_DAY_VALUES.has(String(value || "").trim());
  }

  function isRemovedDayTypeValue(value) {
    return isShiftValue(value) || isTrainingDayValue(value);
  }

  function normalizeDayTypeValue(value) {
    return isRemovedDayTypeValue(value) ? "work" : value;
  }

  function normalizeStoredDayTypes() {
    if (typeof fuelGapState !== "function") return;
    const gap = fuelGapState();
    let changed = false;

    if (gap.dayTypes && typeof gap.dayTypes === "object") {
      Object.keys(gap.dayTypes).forEach(key => {
        const next = normalizeDayTypeValue(gap.dayTypes[key]);
        if (next !== gap.dayTypes[key]) {
          gap.dayTypes[key] = next;
          changed = true;
        }
      });
    }

    if (gap.archive && typeof gap.archive === "object") {
      Object.values(gap.archive).forEach(entry => {
        if (!entry || typeof entry !== "object") return;
        const next = normalizeDayTypeValue(entry.dayType);
        if (next !== entry.dayType) {
          entry.dayType = next;
          changed = true;
        }
        if (/^(shift|training|work) day$/i.test(String(entry.dayTypeLabel || "").trim())) {
          entry.dayTypeLabel = "Working Day";
          changed = true;
        }
      });
    }

    if (Array.isArray(gap.logs)) {
      gap.logs.forEach(log => {
        if (!log) return;
        const next = normalizeDayTypeValue(log.dayType);
        if (next !== log.dayType) {
          log.dayType = next;
          changed = true;
        }
      });
    }

    if (changed && typeof save === "function") save();
  }

  function cleanDayTypeOptions() {
    document.querySelectorAll("select option").forEach(option => {
      const label = option.textContent.trim();
      if (option.value === "work" || /^work day$/i.test(label)) {
        option.value = "work";
        option.textContent = "Working Day";
      }
      if (option.value === "shift" || /^shift day$/i.test(label) || option.value === "training" || /^training day$/i.test(label)) {
        option.remove();
      }
    });

    const dayType = document.getElementById("fuelDayType");
    if (dayType && isRemovedDayTypeValue(dayType.value)) dayType.value = "work";
  }

  function replaceDayTypeCopy(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return /shift day|work day|training day|shift days|work days|training days/i.test(node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const next = node.nodeValue
        .replace(/Shift Day/g, "Working Day")
        .replace(/Shift day/g, "Working Day")
        .replace(/shift day/g, "working day")
        .replace(/Training Day/g, "Working Day")
        .replace(/Training day/g, "Working Day")
        .replace(/training day/g, "working day")
        .replace(/Work Day/g, "Working Day")
        .replace(/Work day/g, "Working Day")
        .replace(/similar work days/g, "similar working days")
        .replace(/similar shift days/g, "similar working days")
        .replace(/similar training days/g, "similar working days")
        .replace(/on work days/g, "on working days")
        .replace(/on shift days/g, "on working days")
        .replace(/on training days/g, "on working days")
        .replace(/work days\./g, "working days.")
        .replace(/shift days\./g, "working days.")
        .replace(/training days\./g, "working days.");
      if (node.nodeValue !== next) node.nodeValue = next;
    });
  }

  function applyDayTypeOverrides() {
    if (applying) return;
    applying = true;
    normalizeStoredDayTypes();
    cleanDayTypeOptions();
    replaceDayTypeCopy();
    applying = false;
  }

  function scheduleApply() {
    requestAnimationFrame(applyDayTypeOverrides);
  }

  function wrapRender(name) {
    const original = window[name];
    if (typeof original !== "function" || original.__fuelGuardDayTypeWrapped) return;
    window[name] = function fuelGuardDayTypeWrapped() {
      const result = original.apply(this, arguments);
      scheduleApply();
      return result;
    };
    window[name].__fuelGuardDayTypeWrapped = true;
  }

  document.addEventListener("DOMContentLoaded", () => {
    applyDayTypeOverrides();
    wrapRender("renderFuelGap");
    wrapRender("renderAll");

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    document.getElementById("fuelDayType")?.addEventListener("change", event => {
      if (isRemovedDayTypeValue(event.target.value)) event.target.value = "work";
      scheduleApply();
    });
  });

  scheduleApply();
})();
