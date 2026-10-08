import { onMounted, onUnmounted, ref } from 'vue';

// Track input modality before Vue click handlers run. Keyboard interaction is instant.
export function useMotion() {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  const motionEnabled = ref(!reduced.matches);
  function finishRunningMotion() {
    // CSS transitions already in flight must also settle when input mode changes.
    document.getAnimations().forEach(animation => {
      try { animation.finish(); } catch { animation.cancel(); }
    });
  }
  const keyboard = () => {
    document.documentElement.dataset.input = 'keyboard';
    motionEnabled.value = false;
    animations.forEach(animation => animation.cancel());
    finishRunningMotion();
  };
  const pointer = () => {
    if (document.documentElement.dataset.input !== 'pointer') document.documentElement.dataset.input = 'pointer';
    motionEnabled.value = !reduced.matches;
  };
  const pointerMove = event => { if (event.pointerType === 'mouse') pointer(); };
  function animateSurface(element, { exit = false, axis = 'y', distance = 8, duration = 220 } = {}) {
    if (!element) return Promise.resolve();
    animations.get(element)?.cancel();
    if (reduced.matches || document.documentElement.dataset.input === 'keyboard') return Promise.resolve();
    const resting = { opacity: 1, transform: 'translate3d(0,0,0)' };
    const offset = { opacity: 0, transform: axis === 'x' ? `translate3d(${distance}px,0,0)` : `translate3d(0,${distance}px,0)` };
    const animation = element.animate(exit ? [resting, offset] : [offset, resting], {
      duration: exit ? 140 : duration, easing: 'cubic-bezier(.23,1,.32,1)',
    });
    animations.set(element, animation);
    return animation.finished.catch(() => {}).finally(() => {
      if (animations.get(element) === animation) animations.delete(element);
    });
  }
  function cancelOnPreference(event) {
    motionEnabled.value = !event.matches && document.documentElement.dataset.input !== 'keyboard';
    if (event.matches) {
      animations.forEach(animation => animation.cancel());
      finishRunningMotion();
    }
  }
  onMounted(() => {
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('pointerdown', pointer, true);
    window.addEventListener('pointermove', pointerMove, true);
    reduced.addEventListener('change', cancelOnPreference);
  });
  onUnmounted(() => {
    window.removeEventListener('keydown', keyboard, true);
    window.removeEventListener('pointerdown', pointer, true);
    window.removeEventListener('pointermove', pointerMove, true);
    reduced.removeEventListener('change', cancelOnPreference);
    animations.forEach(animation => animation.cancel());
  });
  return { animateSurface, motionEnabled };
}
