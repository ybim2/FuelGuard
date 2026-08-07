// Extension boundary for scheduled reviews and reports.
(() => {
  window.FuelGuardCoachPlatform?.registerFeature({
    id: "review-scheduling",
    host: "reports",
    order: 400
  });
})();
