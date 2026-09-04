import { beforeEach, describe, expect, it, vi } from 'vitest';

const listPublicHandles = vi.fn();
const listUpcomingEventIds = vi.fn();
const listPublicDreamIds = vi.fn();
const createAnonClient = vi.fn(() => ({ tag: 'anon-client' }));

vi.mock('@athanor/api', () => ({
  listPublicHandles: (...a: unknown[]) => listPublicHandles(...a),
  listUpcomingEventIds: (...a: unknown[]) => listUpcomingEventIds(...a),
  listPublicDreamIds: (...a: unknown[]) => listPublicDreamIds(...a),
}));
vi.mock('@/utils/supabase/server', () => ({ createAnonClient: () => createAnonClient() }));
vi.mock('@/lib/site', () => ({ SITE_URL: 'https://athanor.test' }));

const { default: sitemap } = await import('./sitemap');
const { SITEMAP_DREAM_LIMIT, SITEMAP_EVENT_LIMIT, SITEMAP_HANDLE_LIMIT } =
  await import('@/lib/prerender-limits');

const EVENT_ID = '00000000-0000-0000-0000-0000000000e1';
const DREAM_ID = '00000000-0000-0000-0000-0000000000d1';
const STATIC = [
  'https://athanor.test/',
  'https://athanor.test/privacy',
  'https://athanor.test/terms',
];

const oneHandle = () =>
  listPublicHandles.mockResolvedValue({
    entries: [{ handle: 'sole', updated_at: '2026-08-01T10:00:00Z' }],
    excluded: 0,
  });
const oneEvent = () =>
  listUpcomingEventIds.mockResolvedValue({
    entries: [{ id: EVENT_ID, updated_at: '2026-08-02T10:00:00Z' }],
    excluded: 0,
  });
const oneDream = () =>
  listPublicDreamIds.mockResolvedValue({
    entries: [{ id: DREAM_ID, updated_at: '2026-08-03T10:00:00Z' }],
    excluded: 0,
  });

beforeEach(() => {
  listPublicHandles.mockReset();
  listUpcomingEventIds.mockReset();
  listPublicDreamIds.mockReset().mockResolvedValue({ entries: [], excluded: 0 });
  createAnonClient.mockReset().mockImplementation(() => ({ tag: 'anon-client' }));
});

describe('sitemap', () => {
  it('lists the static pages, then the BOUNDED handle, event and dream indexes (#335)', async () => {
    oneHandle();
    oneEvent();
    oneDream();

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC,
      'https://athanor.test/@sole',
      `https://athanor.test/event/${EVENT_ID}`,
      `https://athanor.test/dream/${DREAM_ID}`,
    ]);
    expect(entries[3]!.lastModified).toEqual(new Date('2026-08-01T10:00:00Z'));
    expect(entries[4]).toMatchObject({ changeFrequency: 'daily', priority: 0.6 });
    // A dream republishes text already indexed at /@handle (#159), so it asks for less crawl
    // budget than an event that is about to happen.
    expect(entries[5]).toMatchObject({ changeFrequency: 'weekly', priority: 0.5 });
    expect(entries[5]!.lastModified).toEqual(new Date('2026-08-03T10:00:00Z'));
    expect(listPublicDreamIds).toHaveBeenCalledWith(
      { tag: 'anon-client' },
      { limit: SITEMAP_DREAM_LIMIT },
    );
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
    expect(SITEMAP_DREAM_LIMIT).toBe(500);
  });

  it('one failing index does not empty the others for the whole revalidate window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    listPublicHandles.mockRejectedValue(new Error('ENOTFOUND'));
    oneEvent();
    oneDream();

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC,
      `https://athanor.test/event/${EVENT_ID}`,
      `https://athanor.test/dream/${DREAM_ID}`,
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('profile lookup failed'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('and the other way round', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    oneHandle();
    listUpcomingEventIds.mockRejectedValue(new Error('timeout'));
    oneDream();

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC,
      'https://athanor.test/@sole',
      `https://athanor.test/dream/${DREAM_ID}`,
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('event lookup failed'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('and a failing dream index leaves the handle and event entries standing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    oneHandle();
    oneEvent();
    listPublicDreamIds.mockRejectedValue(new Error('timeout'));

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual([
      ...STATIC,
      'https://athanor.test/@sole',
      `https://athanor.test/event/${EVENT_ID}`,
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('dream lookup failed'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('ships the static entries alone — and says so — when no client can be made at build', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createAnonClient.mockImplementation(() => {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
    });

    const entries = await sitemap();

    expect(entries.map((e) => e.url)).toEqual(STATIC);
    expect(listPublicHandles).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('shipping static entries only'),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
