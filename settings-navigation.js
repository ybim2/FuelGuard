(() => {
  const STORAGE_KEY = "fuelGuardSettingsCategory";
  const CATEGORIES = Object.freeze({
    account: "Account & Profile",
    garmin: "Garmin & Devices",
    notifications: "Notifications",
    work: "Working pattern",
    supplements: "Supplementation",
    social: "Social Media",
    sharing: "Coach & Sharing",
    support: "App & Support"
  });

  function savedCategory() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY) || "";
      return Object.hasOwn(CATEGORIES, value) ? value : "";
    } catch (_error) {
      return "";
    }
  }

  function saveCategory(category) {
    try {
      if (category) window.localStorage.setItem(STORAGE_KEY, category);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch (_error) {
      // Settings navigation still works when storage is unavailable.
    }
  }

  function showCategory(category, { focus = false } = {}) {
    const selected = Object.hasOwn(CATEGORIES, category) ? category : "";
    const menu = document.querySelector("[data-settings-category-menu]");
    const intro = document.querySelector("[data-settings-menu-intro]");
    const header = document.querySelector("[data-settings-category-header]");
    const title = document.querySelector("[data-settings-category-title]");

    if (menu) menu.hidden = Boolean(selected);
    if (intro) intro.hidden = Boolean(selected);
    if (header) header.hidden = !selected;
    if (title && selected) title.textContent = CATEGORIES[selected];
    document.querySelectorAll("[data-settings-category]").forEach(element => {
      element.classList.toggle("settings-category-filtered", !selected || element.dataset.settingsCategory !== selected);
    });

    saveCategory(selected);
    if (focus) {
      const destination = selected ? title : menu?.querySelector("button");
      destination?.focus?.();
    }
  }

  document.addEventListener("click", event => {
    const open = event.target.closest("[data-settings-category-open]");
    if (open) {
      event.preventDefault();
      showCategory(open.dataset.settingsCategoryOpen, { focus: true });
      return;
    }
    if (event.target.closest("[data-settings-category-back]")) {
      event.preventDefault();
      showCategory("", { focus: true });
    }
  });

  window.addEventListener("DOMContentLoaded", () => showCategory(savedCategory()));
  window.FuelGuardSettingsNavigation = Object.freeze({ showCategory, categories: CATEGORIES });
})();
