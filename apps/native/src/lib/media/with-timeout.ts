/**
 * Bound a best-effort promise, resolving to a fallback if it takes too long (#412).
 *
 * Written for the candidacy poster frame, whose extraction has no timeout of its own and can
 * hang on a long clip or an iCloud-backed asset (an HEVC one no longer reaches it — since #451
 * the picker transcodes before anything else runs). That step is awaited AFTER the video is
 * already in Storage, so an unbounded wait does not delay a success — it hides one, leaving
 * the step-4 tile spinning at 100% forever with Continue disabled. Indistinguishable from a
 * failed upload, which is the whole family of defect this issue exists to delete.
 *
 * **Never rejects.** It wraps work whose contract is already "best effort, null on any
 * problem", so a throw resolves to the same fallback a timeout does; the caller has one
 * outcome to handle instead of three. Timers are injectable, the same convention
 * `upload-transport.ts` uses for its stall watchdog, so the deadline is testable without
 * waiting for it.
 *
 * **Abandoning says nothing to the work itself, hence `onTimeout` (#449).** Dropping a late
 * result is the right JS-level semantics, but the work carries on: `extractVideoPoster` keeps
 * making native calls, and holds a decoder and two bitmaps until its promise settles. The
 * memory-pressure kill this hook was first written for turned out not to be the crash — that
 * was a frame time marshalled as a scalar where iOS wants an array — so what it buys is
 * narrower than first claimed and still worth having: cancelled work skips every step it has
 * not started yet. `onTimeout` fires exactly when the fallback wins on the deadline, and never
 * when the work settles first (whether it resolved or threw), so a caller can stop the work
 * rather than merely stop listening.
 */

type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  fallback: T,
  opts: {
    timers?: Timers;
    /** Called once if — and only if — the deadline is what produced the fallback. */
    onTimeout?: () => void;
  } = {},
): Promise<T> {
  const timers = opts.timers ?? realTimers;
  return new Promise<T>((resolve) => {
    let settled = false;
    // Declared before `finish` closes over it: a `const` assigned from `timers.set` would sit
    // in the temporal dead zone if an injected timer ever fired synchronously, turning a
    // bounded wait into a ReferenceError.
    let handle: unknown = null;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      timers.clear(handle);
      resolve(value);
    };
    handle = timers.set(() => {
      if (settled) return;
      // Before `finish`, so a hook that throws cannot leave the caller waiting forever — and
      // after the latch, so a cancel can never run for work that already settled.
      try {
        opts.onTimeout?.();
      } finally {
        finish(fallback);
      }
    }, ms);
    // A result arriving after the deadline is dropped by the `settled` latch — the caller has
    // already moved on, and resolving twice would be a lie about which outcome happened.
    work.then(
      (value) => finish(value),
      () => finish(fallback),
    );
  });
}
