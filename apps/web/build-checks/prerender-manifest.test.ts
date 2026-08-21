import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRERENDER_EVENT_LIMIT, PRERENDER_HANDLE_LIMIT } from '../lib/prerender-limits';

/**
 * Asserts the build's prerender manifest — the artefact `next build` writes and OpenNext
 * ships — against what this app promises about it. Runs AFTER a build (`pnpm test:prerender`;
 * CI's `web build` job), never in the unit suite: with no manifest every assertion here
 * fails, on purpose. A check that passes when the build did not happen is not a check.
 *
 * The regression class is real and has bitten: a `generateMetadata` cookie read once made
 * every route dynamic and left this manifest with no routes at all (see app/layout.tsx), and
 * only prose comments ("createAnonClient, not createClient", ×3) guarded it. #335 adds the
 * other direction — the per-handle and per-event caps — so a build cannot silently prerender
 * the whole world either.
 */
const MANIFEST = fileURLToPath(new URL('../.next/prerender-manifest.json', import.meta.url).href);

/** Routes that must prerender whatever the database held at build time. */
const ALWAYS_STATIC = [
  '/',
  '/privacy',
  '/terms',
  '/sitemap.xml',
  '/robots.txt',
  '/opengraph-image',
];
/** Dynamic families that must stay prerenderable — present in `dynamicRoutes`. */
const DYNAMIC_FAMILIES = ['/[handle]', '/[handle]/opengraph-image', '/event/[id]'];
/**
 * Database-independent routes measured on 2026-08-21: 19. A floor below that, so a build
 * against an empty or unreachable database still passes; zero is the regression. Ratchet
 * up only (core.md precedent).
 */
const STATIC_FLOOR = 15;

type Manifest = { routes: Record<string, unknown>; dynamicRoutes: Record<string, unknown> };
const readManifest = (): Manifest => JSON.parse(readFileSync(MANIFEST, 'utf8'));

const isHandlePage = (route: string) => /^\/@[^/]+$/.test(route);
const isHandleCard = (route: string) => /^\/@[^/]+\/opengraph-image$/.test(route);
const isEventPage = (route: string) => /^\/event\/[0-9a-f-]{36}$/.test(route);

describe('prerender manifest', () => {
  it('exists — run this after `next build`, never instead of it', () => {
    expect(existsSync(MANIFEST), `${MANIFEST} is missing`).toBe(true);
  });

  it('prerenders every always-static route', () => {
    const routes = Object.keys(readManifest().routes);
    for (const route of ALWAYS_STATIC) expect(routes, route).toContain(route);
  });

  it(`prerenders at least ${STATIC_FLOOR} routes — an empty manifest is the known regression`, () => {
    expect(Object.keys(readManifest().routes).length).toBeGreaterThanOrEqual(STATIC_FLOOR);
  });

  it('keeps the three dynamic families prerenderable', () => {
    expect(Object.keys(readManifest().dynamicRoutes)).toEqual(
      expect.arrayContaining(DYNAMIC_FAMILIES),
    );
  });

  it('prerenders no more handles and events than the caps allow (#335)', () => {
    const routes = Object.keys(readManifest().routes);
    const pages = routes.filter(isHandlePage);
    expect(pages.length).toBeLessThanOrEqual(PRERENDER_HANDLE_LIMIT);
    expect(routes.filter(isEventPage).length).toBeLessThanOrEqual(PRERENDER_EVENT_LIMIT);
    // One card per prerendered page and no card without its page: the two routes share one
    // generateStaticParams body (lib/handle-static-params.ts) precisely so they cannot drift.
    expect(routes.filter(isHandleCard).length).toBe(pages.length);
  });
});
