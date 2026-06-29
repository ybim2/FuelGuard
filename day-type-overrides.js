// Fuel Guard day type compatibility layer.
// Keeps older saved Shift Day entries safe while the UI now uses Working Day.
(() => {
  const SHIFT_VALUES = new Set(["shift", "Shift day", "Shift Day", "shift day"]);
  let applying = false;

  function isShiftValue(value) {
    return SHIFT_VALUES.has(String(value || "").trim());
  }

  function normalizeDayTypeValue(value) {
    return isShiftValue(value) ? "work" : value;
  }

  function normalizeStoredDayTypes() {
    if (typeof fuelGapState !== "function") return;
    const gap = fuelGapState();
    let changed = false;

    if (gap.dayTypes && typeof gap.dayTypes === "object") {
      Object.keys(gap.dayTypes).forEach(key => {
        if (isShiftValue(gap.dayTypes[key])) {
          gap.dayTypes[key] = "work";
          changed = true;
        }
      });
    }

    if (gap.archive && typeof gap.archive === "object") {
      Object.values(gap.archive).forEach(entry => {
        if (!entry || typeof entry !== "object") return;
        if (isShiftValue(entry.dayType)) {
          entry.dayType = "work";
          changed = true;
        }
        if (/^shift day$/i.test(String(entry.dayTypeLabel || "").trim()) || /^work day$/i.test(String(entry.dayTypeLabel || "").trim())) {
          entry.dayTypeLabel = "Working Day";
          changed = true;
        }
      });
    }

    if (Array.isArray(gap.logs)) {
      gap.logs.forEach(log => {
        if (log && isShiftValue(log.dayType)) {
          log.dayType = "work";
          changed = true;
        }
      });
    }

    if (changed && typeof save === "function") save();
  }

  function cleanDayTypeOptions() {
    document.querySelectorAll("select option").forEach(option => {
      if (option.value === "work" || /^work day$/i.test(option.textContent.trim())) {
        option.value = "work";
        option.textContent = "Working Day";
      }
      if (option.value === "shift" || /^shift day$/i.test(option.textContent.trim())) {
        option.remove();
      }
    });

    const dayType = document.getElementById("fuelDayType");
    if (dayType && isShiftValue(dayType.value)) dayType.value = "work";
  }

  function replaceDayTypeCopy(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return /shift day|work day|shift days|work days/i.test(node.nodeValue || "")
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
        .replace(/Work Day/g, "Working Day")
        .replace(/Work day/g, "Working Day")
        .replace(/similar work days/g, "similar working days")
        .replace(/on work days/g, "on working days")
        .replace(/work days\./g, "working days.")
        .replace(/shift days\./g, "working days.");
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
      if (isShiftValue(event.target.value)) event.target.value = "work";
      scheduleApply();
    });
  });

  scheduleApply();
})();
