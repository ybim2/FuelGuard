// Prevent removed History UI from entering the DOM during beta refresh renders.
// Also keeps beta canvas labels focused on key day anchors without changing graph data.
(() => {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
  if (descriptor?.get && descriptor?.set) {
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
  }

  const canvasContext = window.CanvasRenderingContext2D?.prototype;
  if (!canvasContext || canvasContext.__fuelGuardTimeAnchors) return;
  const baseFillText = canvasContext.fillText;
  canvasContext.__fuelGuardTimeAnchors = true;

  canvasContext.fillText = function fuelGuardFillText(text, x, y, maxWidth) {
    if (this.canvas?.id === "fuelRhythmGraph") {
      if (text === "6am") return baseFillText.call(this, "12am", 8, y, maxWidth);
      if (text === "6pm") return undefined;
    }
    return baseFillText.call(this, text, x, y, maxWidth);
  };
})();
