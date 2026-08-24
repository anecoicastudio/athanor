import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit cover for `/dream/{id}`'s metadata (#159) — the half of that page that is plain data
 * and can run without a renderer (vitest.config.ts: components are Playwright's job).
 *
 * Worth pinning rather than eyeballing, because every assertion here is a claim a crawler
 * acts on and nothing else in the tree checks: the self-canonical that keeps `/dream/{id}`
 * from being consolidated into `/@handle`, the site-wide OG card the page must name because
 * it renders none of its own, and the fact that a dream nobody may read still returns a title
 * rather than throwing.
 */
const getPublicDreamById = vi.fn();
const createAnonClient = vi.fn(() => ({ tag: 'anon-client' }));

vi.mock('@athanor/api', () => ({
  getPublicDreamById: (...a: unknown[]) => getPublicDreamById(...a),
}));
vi.mock('@/utils/supabase/server', () => ({ createAnonClient: () => createAnonClient() }));
vi.mock('@/lib/site', () => ({ SITE_URL: 'https://athanor.test' }));

const { generateMetadata, revalidate, dynamicParams, generateStaticParams } =
  await import('./page');

const DREAM_ID = '00000000-0000-0000-0000-0000000000d1';
const params = Promise.resolve({ id: DREAM_ID });

const dream = (over: Record<string, unknown> = {}) => ({
  id: DREAM_ID,
  text: 'Aprire uno studio',
  milestones: [],
  author: { handle: 'sole', displayName: 'Sole', avatarUrl: null },
  ...over,
});

beforeEach(() => {
  getPublicDreamById.mockReset();
  createAnonClient.mockReset().mockImplementation(() => ({ tag: 'anon-client' }));
});

describe('/dream/[id] route config', () => {
  it('keeps the 5-minute TTL — nothing in this repo invalidates a cache entry', () => {
    expect(revalidate).toBe(300);
    expect(dynamicParams).toBe(true);
  });

  /*
   * The whole #159 prerender decision, in one assertion. EMPTY, not absent: an absent export
   * makes Next render the route dynamically on every request and drops it out of the
   * prerender manifest, losing the incremental cache and the TTL above. Present-and-empty
   * prerenders nothing and still caches on demand.
   */
  it('prerenders no params, and reads no database to decide that', () => {
    expect(generateStaticParams()).toEqual([]);
    expect(createAnonClient).not.toHaveBeenCalled();
  });
});

describe('/dream/[id] generateMetadata', () => {
  it('names the author in the title and self-canonicalises', async () => {
    getPublicDreamById.mockResolvedValue(dream());
    const meta = await generateMetadata({ params });

    expect(meta.title).toBe('Il sogno di @sole — Athanor');
    // The dream itself is the description: one sentence, at most 500 chars (dreamSchema).
    expect(meta.description).toBe('Aprire uno studio');
    // Self-canonical against /@handle, which republishes the same text (#159).
    expect(meta.alternates?.canonical).toBe(`https://athanor.test/dream/${DREAM_ID}`);
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it('falls back to the unattributed title when the owner carries no handle', async () => {
    getPublicDreamById.mockResolvedValue(dream({ author: null }));
    expect((await generateMetadata({ params })).title).toBe('Un sogno — Athanor');
  });

  /*
   * Next REPLACES openGraph rather than merging it, so declaring the object at all drops the
   * layout's image — and the layout promises a summary_large_image. The card named here is
   * the site-wide one: this route never prerenders, so a per-dream Satori image would render
   * in the Worker on every request against a 10 ms CPU budget.
   */
  it('names the site-wide card on both openGraph and twitter', async () => {
    getPublicDreamById.mockResolvedValue(dream());
    const meta = await generateMetadata({ params });
    expect(meta.openGraph?.images).toEqual(['/opengraph-image']);
    expect(meta.twitter?.images).toEqual(['/opengraph-image']);
  });

  it('titles a dream nobody may read, rather than throwing', async () => {
    // Archived, soft-deleted, facet flipped back to members, owner banned — all one null.
    getPublicDreamById.mockResolvedValue(null);
    const meta = await generateMetadata({ params });
    expect(meta.title).toBe('Questo sogno non è disponibile. — Athanor');
    // …and it claims no canonical for a page that is about to 404.
    expect(meta.alternates).toBeUndefined();
  });

  it('reads through the anon client — a cookie read would force dynamic rendering', async () => {
    getPublicDreamById.mockResolvedValue(dream());
    await generateMetadata({ params });
    expect(getPublicDreamById).toHaveBeenCalledWith({ tag: 'anon-client' }, DREAM_ID);
  });
});
