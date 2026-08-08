import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The splash/reveal handoff. The failure it exists to prevent is invisible in a screenshot:
 * a Reveal already in view builds its tween at mount, finishes it behind the overlay, and the
 * entrance reads as "skipped" when the splash lifts. So the contract is asserted directly —
 * a late subscriber must still fire, and unsubscribing must actually detach.
 *
 * Module state is per-import (`let splashDone`), so each test re-imports for a clean slate.
 */
type SplashModule = typeof import('./splash-ready');

async function freshModule(): Promise<SplashModule> {
  vi.resetModules();
  return import('./splash-ready');
}

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('whenSplashDone', () => {
  it('holds the callback until the splash lifts', async () => {
    const { whenSplashDone, markSplashDone } = await freshModule();
    const cb = vi.fn();
    whenSplashDone(cb);
    expect(cb).not.toHaveBeenCalled();
    markSplashDone();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('fires immediately for a subscriber that arrives after the lift', async () => {
    // A Reveal mounted late must not wait forever for an event that already fired.
    const { whenSplashDone, markSplashDone } = await freshModule();
    markSplashDone();
    const cb = vi.fn();
    whenSplashDone(cb);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('releases every waiting subscriber, not just the first', async () => {
    const { whenSplashDone, markSplashDone } = await freshModule();
    const cbs = [vi.fn(), vi.fn(), vi.fn()];
    cbs.forEach((cb) => whenSplashDone(cb));
    markSplashDone();
    cbs.forEach((cb) => expect(cb).toHaveBeenCalledOnce());
  });

  it('returns an unsubscribe that actually detaches', async () => {
    const { whenSplashDone, markSplashDone } = await freshModule();
    const cb = vi.fn();
    whenSplashDone(cb)();
    markSplashDone();
    expect(cb).not.toHaveBeenCalled();
  });

  it('the post-lift unsubscribe is a safe no-op', async () => {
    const { whenSplashDone, markSplashDone } = await freshModule();
    markSplashDone();
    const cb = vi.fn();
    expect(() => whenSplashDone(cb)()).not.toThrow();
  });

  it('runs the callback synchronously during SSR, where there is no window', async () => {
    // Server-rendered, nothing ever dispatches the event — a gate that waited would render
    // the page with every reveal permanently hidden.
    vi.stubGlobal('window', undefined);
    const { whenSplashDone } = await freshModule();
    const cb = vi.fn();
    whenSplashDone(cb);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe('markSplashDone', () => {
  it('is idempotent — a second call releases nothing new', async () => {
    const { whenSplashDone, markSplashDone } = await freshModule();
    const cb = vi.fn();
    whenSplashDone(cb);
    markSplashDone();
    markSplashDone();
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does nothing during SSR', async () => {
    vi.stubGlobal('window', undefined);
    const { markSplashDone } = await freshModule();
    expect(() => markSplashDone()).not.toThrow();
  });
});
