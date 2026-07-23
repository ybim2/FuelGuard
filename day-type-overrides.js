// Fuel Guard day type compatibility layer.
// Keeps older saved day-type entries safe while training session remains separate.
(() => {
  const ALLOWED_VALUES = new Set(["competition", "work", "travel", "holiday"]);
  const DEPRECATED_VALUES = new Set([]);
  const LEGACY_DAY_TYPE_MAP = {
    "competition/race day": "competition",
    "competition day": "competition",
    race: "competition",
    shift: "work",
    "shift day": "work",
    "training + work day": "work",
    "training-work": "work",
    "work day": "work",
    "working day": "work",
    "travelling day": "travel",
    "traveling day": "travel",
    travel: "travel",
    holiday: "holiday",
    training: "",
    "training day": "",
    rest: "",
    "rest day": "",
    "double-training": "",
    "standalone-training": ""
  };
  const LABELS = {
    competition: "Competition Day",
    work: "Working Day",
    travel: "Travel",
    holiday: "Holiday"
  };
  let applying = false;

  function isRemovedDayTypeValue(value) {
    const raw = String(value || "").trim();
    if (!raw) return false;
    const next = normalizeDayTypeValue(raw);
    return next !== raw || DEPRECATED_VALUES.has(next);
  }

  function normalizeDayTypeValue(value) {
    const raw = String(value || "").trim();
    const key = raw.toLowerCase();
    if (!raw) return "";
    if (Object.prototype.hasOwnProperty.call(LEGACY_DAY_TYPE_MAP, key)) return LEGACY_DAY_TYPE_MAP[key];
    return ALLOWED_VALUES.has(raw) ? raw : "";
  }

  function normalizeStoredDayTypes() {
    if (typeof fuelGapState !== "function") return;
    const gap = fuelGapState();
    let changed = false;

    if (gap.dayTypes && typeof gap.dayTypes === "object") {
      Object.keys(gap.dayTypes).forEach(key => {
        const next = normalizeDayTypeValue(gap.dayTypes[key]);
        if (next && next !== gap.dayTypes[key]) {
          gap.dayTypes[key] = next;
          changed = true;
        } else if (!next && gap.dayTypes[key]) {
          delete gap.dayTypes[key];
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
        const nextLabel = next && !DEPRECATED_VALUES.has(next) ? LABELS[next] : "Not set";
        if (entry.dayTypeLabel !== nextLabel) {
          entry.dayTypeLabel = nextLabel;
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
    document.querySelectorAll("#fuelDayType option").forEach(option => {
      if (!option.value) return;
      const next = normalizeDayTypeValue(option.value || option.textContent);
      if (!next || !ALLOWED_VALUES.has(next) || DEPRECATED_VALUES.has(next)) {
        option.remove();
        return;
      }
      option.value = next;
      option.textContent = LABELS[next];
    });

    const dayType = document.getElementById("fuelDayType");
    if (dayType && isRemovedDayTypeValue(dayType.value)) dayType.value = "";
  }

  function replaceDayTypeCopy(root = document.body) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return /training \+ work day|training day|race day|competition\/race day|shift day|work day|rest day/i.test(node.nodeValue || "")
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    });

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const next = node.nodeValue
        .replace(/Training \+ work day/g, "Working Day")
        .replace(/training \+ work day/g, "working day")
        .replace(/Training Day/g, "day")
        .replace(/Training day/g, "day")
        .replace(/training day/g, "day")
        .replace(/Competition\/Race Day/g, "Competition Day")
        .replace(/Competition\/race day/g, "Competition Day")
        .replace(/race day/g, "competition day")
        .replace(/Rest day/g, "day")
        .replace(/rest day/g, "day")
        .replace(/Shift Day/g, "Working Day")
        .replace(/Shift day/g, "Working Day")
        .replace(/shift day/g, "working day")
        .replace(/Work Day/g, "Working Day")
        .replace(/Work day/g, "Working Day")
        .replace(/similar work days/g, "similar working days")
        .replace(/similar shift days/g, "similar working days")
        .replace(/on work days/g, "on working days")
        .replace(/on shift days/g, "on working days")
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
    wrapRender("renderHistory");

    document.getElementById("fuelDayType")?.addEventListener("change", event => {
      if (isRemovedDayTypeValue(event.target.value)) event.target.value = normalizeDayTypeValue(event.target.value);
      scheduleApply();
    });
  });

  scheduleApply();
})();
