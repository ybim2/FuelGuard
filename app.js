const fuelGuardScriptParts = [
  "app-state.js",
  "app-dashboard.js",
  "app-forecast.js",
  "app-barriers.js",
  "app-ui.js"
];

function loadFuelGuardScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(script);
  });
}

fuelGuardScriptParts
  .reduce((chain, src) => chain.then(() => loadFuelGuardScript(src)), Promise.resolve())
  .catch(error => {
    console.error(error);
    const pageSubtitle = document.getElementById("pageSubtitle");
    if (pageSubtitle) pageSubtitle.textContent = "Fuel Guard scripts could not load. Refresh and try again.";
  });
