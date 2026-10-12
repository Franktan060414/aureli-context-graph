// WheelEvent has no standard device identifier. Use continuous scrolling hints,
// retaining the classification through a trackpad's accelerated/momentum tail.
export function createCanvasWheelClassifier() {
  let lastTrackpadAt = -Infinity;
  return {
    reset() { lastTrackpadAt = -Infinity; },
    classify(event, now = performance.now()) {
      // Chromium exposes trackpad pinch as Ctrl+wheel. Preserve Ctrl+mouse zoom.
      if (event.ctrlKey || event.deltaMode !== 0) return 'zoom';
      const ticks = Math.abs(event.wheelDeltaY || 0);
      const preciseTicks = ticks > 0 && Math.abs(event.wheelDeltaY + event.deltaY * 3) < 1;
      const continuous = event.deltaX !== 0 || event.momentum === true || preciseTicks;
      // Recognizable mouse notches take precedence over the previous device.
      if (!continuous && ticks > 0 && ticks % 120 === 0) return 'zoom';
      if (continuous || Math.abs(event.deltaY) < 40 || !Number.isInteger(event.deltaY)
          || now - lastTrackpadAt < 300) {
        lastTrackpadAt = now;
        return 'pan';
      }
      return 'zoom';
    },
  };
}
