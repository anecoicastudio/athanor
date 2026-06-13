/**
 * Coordinates the splash intro with the page's scroll-reveal entrances.
 *
 * On first load the hero (and anything above the fold) sits *inside* the splash
 * overlay. Without this gate a `Reveal` whose ScrollTrigger is already in view
 * would build its fade/lift tween at mount and finish it behind the splash — so
 * when the overlay lifts the content is already in place and its entrance reads
 * as "skipped". `Reveal` therefore waits for `whenSplashDone` before building
 * its tween; the splash calls `markSplashDone` as it starts to lift, handing the
 * motion off seamlessly. Client-only (touches `window`).
 */
const DONE_EVENT = 'auria:splash-done';
let splashDone = false;

/** The splash is lifting — release any waiting reveals. Idempotent. */
export function markSplashDone(): void {
  if (splashDone || typeof window === 'undefined') return;
  splashDone = true;
  window.dispatchEvent(new Event(DONE_EVENT));
}

/**
 * Run `cb` once the splash has lifted — immediately if it already has (or if
 * there is no splash this session). Returns an unsubscribe for cleanup.
 */
export function whenSplashDone(cb: () => void): () => void {
  if (splashDone || typeof window === 'undefined') {
    cb();
    return () => {};
  }
  window.addEventListener(DONE_EVENT, cb, { once: true });
  return () => window.removeEventListener(DONE_EVENT, cb);
}
