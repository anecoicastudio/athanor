import { describe, expect, it, vi } from 'vitest';

// The flag is module-level state → fresh module instance per test.
async function load() {
  vi.resetModules();
  return import('./outdated-client');
}

describe('outdated-client', () => {
  it('starts not outdated', async () => {
    const mod = await load();
    expect(mod.isClientOutdated()).toBe(false);
  });

  it('markClientOutdated is sticky and notifies subscribers', async () => {
    const mod = await load();
    const cb = vi.fn();
    mod.subscribeClientOutdated(cb);

    mod.markClientOutdated();
    expect(mod.isClientOutdated()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('setting twice is idempotent — no second notification', async () => {
    const mod = await load();
    const cb = vi.fn();
    mod.subscribeClientOutdated(cb);

    mod.markClientOutdated();
    mod.markClientOutdated();
    expect(mod.isClientOutdated()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', async () => {
    const mod = await load();
    const cb = vi.fn();
    const unsubscribe = mod.subscribeClientOutdated(cb);
    unsubscribe();

    mod.markClientOutdated();
    expect(cb).not.toHaveBeenCalled();
  });
});
