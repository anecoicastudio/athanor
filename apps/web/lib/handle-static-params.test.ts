import { beforeEach, describe, expect, it, vi } from 'vitest';

// Both resolve at module scope in the unit under test, so they are mocked before the import.
const listPublicHandles = vi.fn();
const createAnonClient = vi.fn(() => ({ tag: 'anon-client' }));

vi.mock('@athanor/api', () => ({
  listPublicHandles: (...a: unknown[]) => listPublicHandles(...a),
}));
vi.mock('@/utils/supabase/server', () => ({ createAnonClient: () => createAnonClient() }));

const { handleStaticParams } = await import('./handle-static-params');
const { PRERENDER_HANDLE_LIMIT } = await import('./prerender-limits');

beforeEach(() => {
  listPublicHandles.mockReset();
  createAnonClient.mockClear();
});

describe('handleStaticParams', () => {
  it('reads the BOUNDED handle index through the anon client and prefixes the @ the route expects', async () => {
    listPublicHandles.mockResolvedValue({
      entries: [
        { handle: 'sole', updated_at: '2026-08-01T10:00:00Z' },
        { handle: 'gio_musica', updated_at: '2026-07-01T10:00:00Z' },
      ],
      excluded: 0,
    });
    await expect(handleStaticParams()).resolves.toEqual([
      { handle: '@sole' },
      { handle: '@gio_musica' },
    ]);
    expect(listPublicHandles).toHaveBeenCalledWith(
      { tag: 'anon-client' },
      { limit: PRERENDER_HANDLE_LIMIT },
    );
  });

  it('pins the cap — changing it is a deliberate act, with the KV-write arithmetic redone (#335)', () => {
    expect(PRERENDER_HANDLE_LIMIT).toBe(100);
  });

  it('prerenders what parsed when the reader withheld rows — never nothing', async () => {
    listPublicHandles.mockResolvedValue({
      entries: [{ handle: 'sole', updated_at: '2026-08-01T10:00:00Z' }],
      excluded: 2,
    });
    await expect(handleStaticParams()).resolves.toEqual([{ handle: '@sole' }]);
  });

  it('prerenders nothing — loudly — when the database is unreachable at build time', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listPublicHandles.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(handleStaticParams()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('prerendering no profiles'),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
