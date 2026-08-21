import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPublicHandles = vi.fn();
const listUpcomingEventIds = vi.fn();

vi.mock('@athanor/api', () => ({
  listPublicHandles: (...a: unknown[]) => listPublicHandles(...a),
  listUpcomingEventIds: (...a: unknown[]) => listUpcomingEventIds(...a),
}));
vi.mock('@/utils/supabase/server', () => ({ createAnonClient: () => ({ tag: 'anon-client' }) }));
vi.mock('@/lib/site', () => ({ SITE_URL: 'https://athanor.test' }));

const { default: sitemap } = await import('./sitemap');
const { SITEMAP_EVENT_LIMIT, SITEMAP_HANDLE_LIMIT } = await import('@/lib/prerender-limits');

const EVENT_ID = '00000000-0000-0000-0000-0000000000e1';

beforeEach(() => {
  listPublicHandles.mockReset();
  listUpcomingEventIds.mockReset();
});

describe('sitemap', () => {
  it('lists the static pages, then the BOUNDED handle and event indexes (#335)', async () => {
    listPublicHandles.mockResolvedValue({
      entries: [{ handle: 'sole', updated_at: '2026-08-01T10:00:00Z' }],
      excluded: 0,
    });
    listUpcomingEventIds.mockResolvedValue({
      entries: [{ id: EVENT_ID, updated_at: '2026-08-02T10:00:00Z' }],
      excluded: 0,
    });

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      'https://athanor.test/',
      'https://athanor.test/privacy',
      'https://athanor.test/terms',
      'https://athanor.test/@sole',
      `https://athanor.test/event/${EVENT_ID}`,
    ]);
    expect(entries[3]!.lastModified).toEqual(new Date('2026-08-01T10:00:00Z'));
    expect(entries[4]).toMatchObject({ changeFrequency: 'daily', priority: 0.6 });
    expect(listPublicHandles).toHaveBeenCalledWith(
      { tag: 'anon-client' },
      { limit: SITEMAP_HANDLE_LIMIT },
    );
    expect(listUpcomingEventIds).toHaveBeenCalledWith(
      { tag: 'anon-client' },
      { limit: SITEMAP_EVENT_LIMIT, now: expect.any(Date) },
    );
  });

  it('pins the caps — a larger sitemap is a generateSitemaps() job, not a bigger number', () => {
    expect(SITEMAP_HANDLE_LIMIT).toBe(1000);
    expect(SITEMAP_EVENT_LIMIT).toBe(500);
  });

  it('ships the static entries alone — and says so — when the lookups fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listPublicHandles.mockRejectedValue(new Error('ENOTFOUND'));
    listUpcomingEventIds.mockResolvedValue({ entries: [], excluded: 0 });

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      'https://athanor.test/',
      'https://athanor.test/privacy',
      'https://athanor.test/terms',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('shipping static entries only'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('warns about withheld rows but still ships what parsed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listPublicHandles.mockResolvedValue({
      entries: [{ handle: 'sole', updated_at: '2026-08-01T10:00:00Z' }],
      excluded: 1,
    });
    listUpcomingEventIds.mockResolvedValue({ entries: [], excluded: 2 });

    const entries = await sitemap();

    expect(entries).toHaveLength(4);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('1 profile and 2 event row(s)'));
    warn.mockRestore();
  });
});
