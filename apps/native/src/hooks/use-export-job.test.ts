import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #879: the export screen kept showing «Stiamo preparando» after the job turned ready, because
 * nothing on device ever told TanStack the app came back — `focusManager` is not wired to
 * `AppState` (its default listens for `visibilitychange`, which React Native has no source for),
 * and the query itself had no remount or foreground trigger. These pin the two halves of the
 * fix: the builder both GDPR screens share, and the `AppState` listener that re-reads on return.
 */

const h = vi.hoisted(() => ({
  listeners: [] as ((state: string) => void)[],
  removed: 0,
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_type: string, fn: (state: string) => void) => {
      h.listeners.push(fn);
      return {
        remove: () => {
          h.listeners.splice(h.listeners.indexOf(fn), 1);
          h.removed += 1;
        },
      };
    },
  },
}));

vi.mock('@/lib/supabase', () => ({ supabase: { __brand: 'mock-client' } }));

vi.mock('@athanor/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@athanor/api')>()),
  getLatestExportJob: vi.fn(),
}));

const api = await import('@athanor/api');
const { supabase } = await import('@/lib/supabase');
const { exportJobQuery } = await import('./use-export-job');
const { onAppForeground } = await import('./use-refetch-on-foreground');

beforeEach(() => {
  vi.clearAllMocks();
  h.listeners.length = 0;
  h.removed = 0;
});

describe('exportJobQuery', () => {
  it('keeps the key both GDPR screens and the request mutation invalidate', () => {
    expect(exportJobQuery().queryKey).toEqual(api.gdprKeys.exportStatus());
  });

  it('re-reads on every mount, so re-entering the screen never shows a stale status', () => {
    expect(exportJobQuery().refetchOnMount).toBe('always');
  });

  it('forwards the shared client to getLatestExportJob', () => {
    (exportJobQuery().queryFn as () => unknown)();
    expect(api.getLatestExportJob).toHaveBeenCalledWith(supabase);
  });
});

describe('onAppForeground', () => {
  it('fires when the app returns to active', () => {
    const cb = vi.fn();
    onAppForeground(cb);
    h.listeners.forEach((fn) => fn('active'));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('stays quiet on the way out — background and inactive are not a return', () => {
    const cb = vi.fn();
    onAppForeground(cb);
    h.listeners.forEach((fn) => {
      fn('inactive');
      fn('background');
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('returns a cleanup that removes the subscription', () => {
    const cb = vi.fn();
    const cleanup = onAppForeground(cb);
    cleanup();
    expect(h.removed).toBe(1);
    expect(h.listeners).toHaveLength(0);
  });
});
