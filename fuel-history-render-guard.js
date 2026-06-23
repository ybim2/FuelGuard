// Prevent removed History UI from entering the DOM during beta refresh renders.
(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (!descriptor?.get || !descriptor?.set) return;

  function cleanHistoryMarkup(markup, element) {
    if (element?.id !== "fuelHistoryArchiveDetail" || typeof markup !== "string") return markup;
    return markup
      .replace(/<div class="fuel-archive-section"><h4>End-of-day analysis<\/h4>[\s\S]*?<\/ul><\/div>/g, "")
      .replace(/<span>Long gaps<\/span>/g, "<span>High-risk gaps</span>")
      .replace(/>GAPS FOUND</g, ">HIGH-RISK GAPS<");
  }

  Object.defineProperty(Element.prototype, "innerHTML", {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      descriptor.set.call(this, cleanHistoryMarkup(value, this));
    }
  });
})();
