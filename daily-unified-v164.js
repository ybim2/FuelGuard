(() => {
  "use strict";
  if (window.FuelGuardDailyUnifiedV164) return;
  let selectedAll = false;
  let enhancing = false;

  const esc = value => window.FuelGuardDomain?.escapeHtml?.(String(value ?? "")) || String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const logDate = log => window.FuelGuardDomain?.logDate?.(log) || new Date(log?.timestamp || log?.logged_at || log?.date || "");
  const minute = date => date.getHours()*60 + date.getMinutes();
  const xFor = date => `${Math.max(0,Math.min(100,minute(date)/1440*100)).toFixed(2)}%`;
  const clock = date => date.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
  const typeOfLog = log => {
    if (window.FuelGuardDomain?.isHydrationLog?.(log)) return "hydration";
    if (window.FuelGuardDomain?.isFuelLog?.(log)) return "fuel";
    return String(log?.type || log?.logType || "fuel").toLowerCase();
  };

  function planned() {
    return (window.FuelGuardRoutines?.plannedItemsForDay?.(dateKey()) || []).filter(item => item?.date instanceof Date && !Number.isNaN(item.date.getTime()));
  }

  function actualItems() {
    const today = dateKey();
    const gap = typeof window.fuelGapState === "function" ? window.fuelGapState() : { logs:[] };
    const logs = (gap?.logs || []).map(log => ({ log, date:logDate(log) })).filter(x => x.date && !Number.isNaN(x.date.getTime()) && dateKey(x.date) === today).map(({log,date}) => ({ date, type:typeOfLog(log), label: log.label || (typeOfLog(log)==="hydration"?"Hydration":"Fuel"), status:"logged" }));
    const supplements = (window.FuelGuardSupplementRhythm?.eventsForDay?.(today) || []).map(event => ({ date:new Date(event.date || event.takenAt), type:"supplement", label:event.supplementLabel || "Supplement", status:"logged" })).filter(x => !Number.isNaN(x.date.getTime()));
    return [...logs,...supplements].sort((a,b)=>a.date-b.date);
  }

  function moveRoutines() {
    const status = document.getElementById("fuelTodayStatus");
    const routines = document.getElementById("fuelGuardRoutineToday");
    if (status && routines && status.nextElementSibling !== routines) status.insertAdjacentElement("afterend", routines);
  }

  function plannedSupplementMarkup() {
    const items = planned().filter(item => item.type === "supplement" && item.status === "planned");
    if (!items.length) return `<div class="fg-pattern-planned"><header><strong>Planned supplements</strong><span>No planned supplement times today</span></header></div>`;
    return `<div class="fg-pattern-planned" data-fg-planned-supplements><header><strong>Planned supplements</strong><span>${items.length} planned</span></header><div class="fg-pattern-planned-track" role="img" aria-label="Planned supplement times today">${items.map(item => `<button type="button" class="fg-pattern-point" style="--x:${xFor(item.date)}" title="${esc(item.label)} · ${esc(clock(item.date))}" aria-label="${esc(item.label)} planned for ${esc(clock(item.date))}"></button>`).join("")}</div><div class="fg-pattern-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div></div>`;
  }

  function allTimelineMarkup() {
    const actual = actualItems();
    const futurePlans = planned().filter(item => item.status === "planned");
    const items = [...actual, ...futurePlans].sort((a,b)=>a.date-b.date);
    const rowMap = { fuel:"28%", hydration:"43%", supplement:"58%", coffee:"73%" };
    return `<div class="fg-all-timeline"><div class="fg-all-timeline-head"><div><h4>Timeline</h4><p>Logged moments plus what is planned for today.</p></div><strong>All</strong></div><div class="fg-all-timeline-track" role="img" aria-label="All Fuel Guard moments across today">${items.map(item => `<button type="button" class="fg-all-timeline-point ${esc(item.type)} ${item.status === "planned" ? "planned" : ""}" style="--x:${xFor(item.date)};--row:${rowMap[item.type] || "58%"}" title="${esc(item.label)} · ${esc(clock(item.date))}${item.status === "planned" ? " · planned" : ""}" aria-label="${esc(item.label)} at ${esc(clock(item.date))}${item.status === "planned" ? ", planned" : ", logged"}"></button>`).join("")}</div><div class="fg-all-timeline-axis"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div><div class="fg-all-timeline-legend"><span><i></i>Fuel</span><span><i></i>Hydration</span><span><i></i>Supplements</span><span><i></i>Planned = hollow</span></div><div class="fg-all-timeline-list">${items.length ? items.map(item => `<article><time>${esc(clock(item.date))}</time><span>${esc(item.label)}</span><small>${item.status === "planned" ? "Planned" : "Logged"}</small></article>`).join("") : `<article><span>No timeline data yet.</span></article>`}</div></div>`;
  }

  function enhancePatterns() {
    if (enhancing) return;
    const root = document.getElementById("fuelLogPatterns");
    if (!root) return;
    enhancing = true;
    try {
      const nav = root.querySelector(".beta-log-pattern-tabs");
      if (!nav) return;
      let allButton = nav.querySelector('[data-log-pattern-type="all"]');
      if (!allButton) {
        allButton = document.createElement("button");
        allButton.type = "button";
        allButton.dataset.logPatternType = "all";
        allButton.textContent = "All";
        nav.appendChild(allButton);
      }
      if (selectedAll) {
        nav.querySelectorAll("button").forEach(button => { const active = button.dataset.logPatternType === "all"; button.classList.toggle("active",active); button.setAttribute("aria-pressed",active?"true":"false"); });
        root.querySelectorAll(".beta-fuelling-pattern-chart-card,.athlete-training-pattern-lanes,.fg-all-timeline").forEach(node => node.remove());
        nav.insertAdjacentHTML("afterend", allTimelineMarkup());
        return;
      }
      const active = nav.querySelector("button.active")?.dataset.logPatternType;
      if (active === "supplements") {
        const card = root.querySelector(".beta-fuelling-pattern-chart-card");
        if (card) { card.querySelector("[data-fg-planned-supplements]")?.remove(); card.insertAdjacentHTML("beforeend", plannedSupplementMarkup()); }
      }
    } finally { enhancing = false; }
  }

  function refresh() { moveRoutines(); requestAnimationFrame(enhancePatterns); }

  document.addEventListener("click", event => {
    const tab = event.target.closest?.("[data-log-pattern-type]");
    if (!tab) return;
    if (tab.dataset.logPatternType === "all") {
      event.preventDefault(); event.stopImmediatePropagation(); selectedAll = true; enhancePatterns();
    } else selectedAll = false;
  }, true);

  ["fuelguard:routines-changed","fuelguard:supplement-events-changed","fuelguard:supplement-logged","fuelguard:private-app-ready","fuelguard:training-mode-changed"].forEach(name => window.addEventListener(name, refresh));
  const observer = new MutationObserver(() => refresh());
  function init() { const app = document.getElementById("fuelGuardPrivateApp") || document.body; observer.observe(app,{childList:true,subtree:true}); refresh(); }
  window.FuelGuardDailyUnifiedV164 = Object.freeze({ refresh });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once:true}); else init();
})();
