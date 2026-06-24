// Prevent removed History UI from entering the DOM during beta refresh renders.
// Also keeps beta canvas labels focused on a full-day timeline without changing graph data.
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
        const cleaned = cleanHistoryMarkup(value, this);
        if (this?.id === "fuelHistoryArchiveDetail" && descriptor.get.call(this) === cleaned) return;
        descriptor.set.call(this, cleaned);
      }
    });
  }

  const canvasContext = window.CanvasRenderingContext2D?.prototype;
  if (!canvasContext || canvasContext.__fuelGuardTimeAnchors) return;
  const baseFillText = canvasContext.fillText;
  canvasContext.__fuelGuardTimeAnchors = true;

  function drawFuelRhythmTimeLabels(ctx, y) {
    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect?.();
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = Math.max(320, Math.round(rect?.width || canvas.width / dpr || canvas.width));
    const paddingLeft = 34;
    const paddingRight = 18;
    const plotWidth = cssWidth - paddingLeft - paddingRight;
    const labels = [
      { minute: 0, label: "12am", align: "left" },
      { minute: 240, label: "4am", align: "center" },
      { minute: 480, label: "8am", align: "center" },
      { minute: 720, label: "12pm", align: "center" },
      { minute: 960, label: "4pm", align: "center" },
      { minute: 1200, label: "8pm", align: "center" },
      { minute: 1440, label: "12am", align: "right" }
    ];

    ctx.save();
    labels.forEach(item => {
      const x = paddingLeft + (item.minute / 1440) * plotWidth;
      ctx.textAlign = item.align;
      baseFillText.call(ctx, item.label, x, y);
    });
    ctx.restore();
  }

  canvasContext.fillText = function fuelGuardFillText(text, x, y, maxWidth) {
    if (this.canvas?.id === "fuelRhythmGraph") {
      if (text === "6am") {
        drawFuelRhythmTimeLabels(this, y);
        return undefined;
      }
      if (text === "12pm" || text === "6pm") return undefined;
    }
    return baseFillText.call(this, text, x, y, maxWidth);
  };
})();
