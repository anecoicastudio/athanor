import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Metadata } from 'next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Every indexable page is its own canonical (#792).
 *
 * The bug this pins: the root layout declared `alternates: { canonical: '/' }`, and Next merges
 * metadata shallowly, so every page that did not override the key inherited it — /privacy,
 * /@handle and /event/{id} all told crawlers they were duplicates of the homepage. The fix is
 * structural (the layout declares no canonical, each page declares its own), and so is the
 * guard: the sweep below reads app/ from disk, so a page added later is unclassified and fails
 * here until someone decides which bucket it belongs in. The route lists are literal on
 * purpose — a test derived from lib/legal-routes.ts would pass with an entry missing.
 */

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const SITE = 'https://athanor.test';

vi.mock('@/lib/site', () => ({ SITE_URL: 'https://athanor.test' }));

const getPublicProfileByHandle = vi.fn();
const getPublicEventById = vi.fn();
const getPublicDreamById = vi.fn();
vi.mock('@athanor/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@athanor/api')>()),
  getPublicProfileByHandle: (...a: unknown[]) => getPublicProfileByHandle(...a),
  getPublicEventById: (...a: unknown[]) => getPublicEventById(...a),
  getPublicDreamById: (...a: unknown[]) => getPublicDreamById(...a),
}));
vi.mock('@/utils/supabase/server', () => ({ createAnonClient: () => ({ tag: 'anon-client' }) }));
// The layout's two self-hosted faces: next/font/local is a compile-time transform with no
// runtime of its own, and only the metadata export is under test here.
vi.mock('next/font/local', () => ({ default: () => ({ variable: '--font' }) }));

/** Static pages → the path each must name as its own canonical. */
const STATIC_SELF_CANONICAL: Record<string, string> = {
  'page.tsx': '/',
  'privacy/page.tsx': '/privacy',
  'terms/page.tsx': '/terms',
  'delete-account/page.tsx': '/delete-account',
  'child-safety/page.tsx': '/child-safety',
  'support/page.tsx': '/support',
};
/** Dynamic pages — canonical built in generateMetadata, exercised below. */
const DYNAMIC_SELF_CANONICAL = ['[handle]/page.tsx', 'event/[id]/page.tsx', 'dream/[id]/page.tsx'];
/**
 * Hand-off pages the app opens and a crawler has no business indexing. A canonical next to
 * `noindex` is a contradictory signal, so these must declare none.
 */
const NOINDEX = [
  'invite/[code]/page.tsx',
  'post/page.tsx',
  'app/verify/page.tsx',
  'app/payout/refresh/page.tsx',
  'app/payout/return/page.tsx',
];
/** The moderation panel sits behind a sign-in; it is not a public page and is out of scope. */
const isAdmin = (file: string) => file.startsWith('admin/');

const pageFiles = () =>
  readdirSync(APP_DIR, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => f === 'page.tsx' || f.endsWith('/page.tsx'))
    .sort();

const load = (file: string) =>
  import(/* @vite-ignore */ `./${file}`) as Promise<{
    metadata?: Metadata;
    generateMetadata?: (a: { params: Promise<Record<string, string>> }) => Promise<Metadata>;
  }>;

beforeEach(() => {
  getPublicProfileByHandle.mockReset();
  getPublicEventById.mockReset();
  getPublicDreamById.mockReset();
});

describe('canonical URLs (#792)', () => {
  it('classifies every page.tsx under app/ — a new page must pick a bucket', () => {
    const known = new Set([
      ...Object.keys(STATIC_SELF_CANONICAL),
      ...DYNAMIC_SELF_CANONICAL,
      ...NOINDEX,
    ]);
    const unclassified = pageFiles().filter((f) => !known.has(f) && !isAdmin(f));
    expect(unclassified).toEqual([]);
    // …and the lists name nothing that no longer exists.
    for (const f of known) expect(pageFiles(), f).toContain(f);
  });

  it('the root layout declares no canonical and no og:url for pages to inherit', async () => {
    const { metadata } = await load('layout.tsx');
    expect(metadata?.alternates).toBeUndefined();
    expect(metadata?.openGraph).not.toHaveProperty('url');
    // metadataBase stays: relative OG image paths resolve against it.
    expect(metadata?.metadataBase?.toString()).toBe(`${SITE}/`);
  });

  it.each(Object.entries(STATIC_SELF_CANONICAL))(
    '%s is self-canonical at %s',
    async (file, path) => {
      const { metadata } = await load(file);
      expect(metadata?.alternates?.canonical).toBe(`${SITE}${path}`);
    },
  );

  it.each(NOINDEX)('%s is noindex and claims no canonical', async (file) => {
    const { metadata } = await load(file);
    expect(metadata?.robots).toMatchObject({ index: false });
    expect(metadata?.alternates).toBeUndefined();
  });

  it('/@handle canonicalises onto the stored handle, whatever spelling reached it', async () => {
    getPublicProfileByHandle.mockResolvedValue({ handle: 'sole', bio: null, dream: null });
    const { generateMetadata } = await load('[handle]/page.tsx');
    const meta = await generateMetadata!({ params: Promise.resolve({ handle: '%40Sole' }) });
    expect(meta.alternates?.canonical).toBe(`${SITE}/@sole`);
  });

  it('/event/{id} is self-canonical', async () => {
    const id = '00000000-0000-0000-0000-0000000000e1';
    getPublicEventById.mockResolvedValue({
      id,
      title: 'Cerchio',
      starts_at: '2026-10-01T18:00:00Z',
      ends_at: null,
      is_online: false,
      venue: 'Studio',
      city: 'Milano',
    });
    const { generateMetadata } = await load('event/[id]/page.tsx');
    const meta = await generateMetadata!({ params: Promise.resolve({ id }) });
    expect(meta.alternates?.canonical).toBe(`${SITE}/event/${id}`);
  });

  /*
   * A page about to 404 must not inherit a canonical either — before #792 these branches
   * fell through to the layout's '/'. /dream's own found branch is pinned in its
   * metadata.test.ts.
   */
  it.each([
    ['[handle]/page.tsx', { handle: 'nessuno' }, getPublicProfileByHandle],
    ['event/[id]/page.tsx', { id: 'x' }, getPublicEventById],
    ['dream/[id]/page.tsx', { id: 'x' }, getPublicDreamById],
  ] as const)('%s claims no canonical for a missing row', async (file, params, reader) => {
    reader.mockResolvedValue(null);
    const { generateMetadata } = await load(file);
    const meta = await generateMetadata!({ params: Promise.resolve(params) });
    expect(meta.alternates).toBeUndefined();
  });
});
