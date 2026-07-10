function switchScreen(screen) {
  const target = ["dashboard", "logs", "impact", "trends", "ride", "runway", "checklist"].includes(screen) ? screen : "dashboard";
  const targetElement = document.getElementById(target);
  if (!targetElement) return;

  document.querySelectorAll(".screen").forEach(section => {
    section.classList.toggle("active", section.id === target);
  });

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.screen === target);
  });

  document.querySelectorAll(".mobile-nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.mobileScreen === target);
  });
}

function renderAll() {
  if (typeof renderFuelGap === "function") renderFuelGap();
}

document.querySelectorAll(".nav-item").forEach(button => {
  button.onclick = () => switchScreen(button.dataset.screen);
});

document.addEventListener("click", event => {
  const fuelActionButton = event.target.closest("[data-fuel-action]");
  if (!fuelActionButton || fuelActionButton.disabled) return;

  const fuelActions = {
    "log-fuel": recordFuelled,
    "end-day": endFuelDayAndStartFasting,
    "continue-tracking": continueFuelDayTracking
  };
  const action = fuelActions[fuelActionButton.dataset.fuelAction];
  if (!action) return;

  event.preventDefault();
  action();
}, true);

document.addEventListener("click", event => {
  const tipId = event.target.dataset.closeTip;
  if (!tipId) return;

  const tip = document.getElementById(tipId);
  if (tip) tip.remove();
});

renderAll();
