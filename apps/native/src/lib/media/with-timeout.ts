/**
 * Bound a best-effort promise, resolving to a fallback if it takes too long (#412).
 *
 * Written for the candidacy poster frame, whose extraction has no timeout of its own and can
 * hang on an HEVC clip or an iCloud-backed asset. That step is awaited AFTER the video is
 * already in Storage, so an unbounded wait does not delay a success — it hides one, leaving
 * the step-4 tile spinning at 100% forever with Continue disabled. Indistinguishable from a
 * failed upload, which is the whole family of defect this issue exists to delete.
 *
 * **Never rejects.** It wraps work whose contract is already "best effort, null on any
 * problem", so a throw resolves to the same fallback a timeout does; the caller has one
 * outcome to handle instead of three. Timers are injectable, the same convention
 * `upload-transport.ts` uses for its stall watchdog, so the deadline is testable without
 * waiting for it.
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
  timers: Timers = realTimers,
): Promise<T> {
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
    handle = timers.set(() => finish(fallback), ms);
    // A result arriving after the deadline is dropped by the `settled` latch — the caller has
    // already moved on, and resolving twice would be a lie about which outcome happened.
    work.then(
      (value) => finish(value),
      () => finish(fallback),
    );
  });
}
