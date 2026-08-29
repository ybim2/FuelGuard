// Fuel Guard day type compatibility layer.
(() => {
  const ALLOWED_VALUES=new Set(["competition","work","holiday"]),DEPRECATED_VALUES=new Set(["travel"]),MAP={"competition/race day":"competition","competition day":"competition",race:"competition",shift:"work","shift day":"work","training + work day":"work","training-work":"work","work day":"work","working day":"work","travelling day":"travel","traveling day":"travel",travel:"travel",holiday:"holiday",training:"","training day":"",rest:"","rest day":"","double-training":"","standalone-training":""},LABELS={competition:"Competition Day",work:"Working Day",holiday:"Holiday"};let applying=false;
  function norm(v){const raw=String(v||"").trim(),key=raw.toLowerCase();if(!raw)return"";if(Object.prototype.hasOwnProperty.call(MAP,key))return MAP[key];return ALLOWED_VALUES.has(raw)?raw:""}
  function removed(v){const raw=String(v||"").trim();return !!raw&&(norm(raw)!==raw||DEPRECATED_VALUES.has(norm(raw)))}
  function stored(){if(typeof fuelGapState!=="function")return;const g=fuelGapState();let changed=false;if(g.dayTypes&&typeof g.dayTypes==="object")Object.keys(g.dayTypes).forEach(k=>{const n=norm(g.dayTypes[k]);if(n&&n!==g.dayTypes[k]){g.dayTypes[k]=n;changed=true}else if(!n&&g.dayTypes[k]){delete g.dayTypes[k];changed=true}});if(g.archive&&typeof g.archive==="object")Object.values(g.archive).forEach(e=>{if(!e||typeof e!=="object")return;const n=norm(e.dayType);if(n!==e.dayType){e.dayType=n;changed=true}const l=n&&!DEPRECATED_VALUES.has(n)?LABELS[n]:"Not set";if(e.dayTypeLabel!==l){e.dayTypeLabel=l;changed=true}});if(Array.isArray(g.logs))g.logs.forEach(l=>{if(!l)return;const n=norm(l.dayType);if(n!==l.dayType){l.dayType=n;changed=true}});if(changed&&typeof save==="function")save()}
  function options(){document.querySelectorAll("#fuelDayType option").forEach(o=>{if(!o.value)return;const n=norm(o.value||o.textContent);if(!n||!ALLOWED_VALUES.has(n)||DEPRECATED_VALUES.has(n)){o.remove();return}o.value=n;o.textContent=LABELS[n]});const d=document.getElementById("fuelDayType");if(d&&removed(d.value))d.value=""}
  function copy(root=document.body){if(!root)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(n){const p=n.parentElement;if(!p||["SCRIPT","STYLE","NOSCRIPT"].includes(p.tagName))return NodeFilter.FILTER_REJECT;return /training \+ work day|training day|race day|competition\/race day|shift day|work day|rest day/i.test(n.nodeValue||"")?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}}),nodes=[];while(w.nextNode())nodes.push(w.currentNode);nodes.forEach(n=>{const x=n.nodeValue.replace(/Training \+ work day/g,"Working Day").replace(/training \+ work day/g,"working day").replace(/Training Day/g,"day").replace(/Training day/g,"day").replace(/training day/g,"day").replace(/Competition\/Race Day/g,"Competition Day").replace(/Competition\/race day/g,"Competition Day").replace(/race day/g,"competition day").replace(/Rest day/g,"day").replace(/rest day/g,"day").replace(/Shift Day/g,"Working Day").replace(/Shift day/g,"Working Day").replace(/shift day/g,"working day").replace(/Work Day/g,"Working Day").replace(/Work day/g,"Working Day").replace(/similar work days/g,"similar working days").replace(/similar shift days/g,"similar working days").replace(/on work days/g,"on working days").replace(/on shift days/g,"on working days").replace(/work days\./g,"working days.").replace(/shift days\./g,"working days.");if(n.nodeValue!==x)n.nodeValue=x})}
  function apply(){if(applying)return;applying=true;stored();options();copy();applying=false}function schedule(){requestAnimationFrame(apply)}function wrap(name){const o=window[name];if(typeof o!=="function"||o.__fuelGuardDayTypeWrapped)return;window[name]=function(){const r=o.apply(this,arguments);schedule();return r};window[name].__fuelGuardDayTypeWrapped=true}
  document.addEventListener("DOMContentLoaded",()=>{apply();wrap("renderFuelGap");wrap("renderAll");document.getElementById("fuelDayType")?.addEventListener("change",e=>{if(removed(e.target.value))e.target.value=norm(e.target.value);schedule()})});schedule();
})();

// Human-scale elapsed time: keep precision below 24h, switch to days at 24h+.
(() => {
  function humanDuration(minutes){if(!Number.isFinite(minutes))return"No limit";const safeMinutes=Math.max(0,Math.round(minutes));if(safeMinutes>=1440){const days=Math.floor(safeMinutes/1440);return`${days} day${days===1?"":"s"}`;}return`${Math.floor(safeMinutes/60)}h ${String(safeMinutes%60).padStart(2,"0")}m`;}
  globalThis.duration=humanDuration;
  const refresh=()=>{if(typeof renderFuelGap==="function")renderFuelGap();else if(typeof renderAll==="function")renderAll();};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",refresh,{once:true});else requestAnimationFrame(refresh);
})();

// Load Routines v3 and the unified Daily timeline after the canonical shell exists.
(() => {
  const VERSION="mobile-pwa-v164-daily-routines-timeline";
  function addCss(href,key){if(document.querySelector(`link[data-fg-${key}]`))return;const css=document.createElement("link");css.rel="stylesheet";css.href=`${href}?v=${VERSION}`;css.dataset[`fg${key[0].toUpperCase()+key.slice(1)}`]="1";document.head.appendChild(css)}
  function addScript(src,key,onload){if(document.querySelector(`script[data-fg-${key}]`)){onload?.();return;}const script=document.createElement("script");script.src=`${src}?v=${VERSION}`;script.dataset[`fg${key[0].toUpperCase()+key.slice(1)}`]="1";if(onload)script.addEventListener("load",onload,{once:true});document.body.appendChild(script)}
  function load(){
    addCss("routine-manager.css","routines-base");addCss("routine-manager-v3.css","routines-v3");addCss("daily-unified-v164.css","daily-v164");
    addScript("routine-manager-v3.js","routines-v3",()=>window.FuelGuardRoutinesV3?.init?.());
    addScript("daily-unified-v164.js","daily-v164",()=>window.FuelGuardDailyUnifiedV164?.refresh?.());
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",load,{once:true});else load();
})();