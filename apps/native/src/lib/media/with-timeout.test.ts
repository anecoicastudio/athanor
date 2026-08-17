import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from './with-timeout';

/** A controllable clock, same injectable-timers convention as upload-transport.test.ts. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    timers: {
      set: (fn: () => void, _ms: number) => {
        const id = next++;
        pending.set(id, fn);
        return id;
      },
      clear: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    /** Fire every armed timer — i.e. let the deadline pass. */
    fire: () => {
      for (const fn of [...pending.values()]) fn();
    },
    armed: () => pending.size,
  };
}

describe('withTimeout (#412)', () => {
  it('resolves with the real value when the work beats the deadline', async () => {
    const clock = fakeTimers();
    const result = await withTimeout(Promise.resolve('poster'), 15_000, null, clock.timers);
    expect(result).toBe('poster');
  });

  it('disarms the timer once the work has settled', async () => {
    // A timer left armed keeps a handle alive and, in RN, can outlive the screen.
    const clock = fakeTimers();
    await withTimeout(Promise.resolve('poster'), 15_000, null, clock.timers);
    expect(clock.armed()).toBe(0);
  });

  it('falls back when the deadline passes first', async () => {
    const clock = fakeTimers();
    // A promise that never settles — the hung decoder this exists for.
    const hung = new Promise<string | null>(() => {});
    const pending = withTimeout(hung, 15_000, null, clock.timers);
    clock.fire();
    await expect(pending).resolves.toBeNull();
  });

  it('a late result cannot overwrite the fallback', async () => {
    // The poster arriving after the tile already moved on must change nothing.
    const clock = fakeTimers();
    let release: (v: string) => void = () => {};
    const late = new Promise<string | null>((r) => {
      release = r as (v: string) => void;
    });
    const pending = withTimeout(late, 15_000, null, clock.timers);
    clock.fire();
    release('too-late');
    await expect(pending).resolves.toBeNull();
  });

  it('never rejects — a throwing job resolves to the fallback', async () => {
    // This wraps a best-effort step whose whole contract is that it cannot fail the upload.
    const clock = fakeTimers();
    const result = await withTimeout(
      Promise.reject(new Error('decoder died')),
      15_000,
      null,
      clock.timers,
    );
    expect(result).toBeNull();
    expect(clock.armed()).toBe(0);
  });

  it('carries a non-null fallback through', async () => {
    const clock = fakeTimers();
    const hung = new Promise<string>(() => {});
    const pending = withTimeout(hung, 1_000, 'fallback', clock.timers);
    clock.fire();
    await expect(pending).resolves.toBe('fallback');
  });

  it('survives a timer that fires synchronously', async () => {
    // Guards the temporal-dead-zone trap: `finish` closes over the timer handle, so the handle
    // must exist before the callback can possibly run.
    const sync = {
      set: (fn: () => void, _ms: number) => {
        fn();
        return 1;
      },
      clear: () => {},
    };
    await expect(withTimeout(new Promise<null>(() => {}), 0, null, sync)).resolves.toBeNull();
  });

  it('uses real timers when none are injected', async () => {
    vi.useFakeTimers();
    try {
      const hung = new Promise<string | null>(() => {});
      const pending = withTimeout(hung, 50, null);
      await vi.advanceTimersByTimeAsync(50);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
