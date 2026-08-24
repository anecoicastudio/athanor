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
/**
 * Dynamic families that must stay prerenderable — present in `dynamicRoutes`.
 *
 * `/dream/[id]` earns its place here for a second reason on top of the cookie regression
 * below: it prerenders no params at all (#159), and the difference between an EMPTY
 * `generateStaticParams` and an absent one is invisible in review — both look like "nothing
 * is prerendered". Only the absent one drops the route out of this manifest, and with it the
 * incremental cache and `revalidate`, turning every crawler hit into a fresh render.
 */
const DYNAMIC_FAMILIES = ['/[handle]', '/[handle]/opengraph-image', '/event/[id]', '/dream/[id]'];
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
const isDreamPage = (route: string) => /^\/dream\//.test(route);

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

  it('keeps the four dynamic families prerenderable', () => {
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

  it('prerenders NO dream at all — the #159 decision, not an empty database (#335)', () => {
    // There is no PRERENDER_DREAM_LIMIT to compare against, because the cap is zero: a
    // prerendered dream would cost a KV write per deploy to publish text already prerendered
    // inside the owner's /@handle page (lib/prerender-limits.ts). A build that started
    // emitting them would be spending the free-plan write budget for nothing, quietly.
    expect(Object.keys(readManifest().routes).filter(isDreamPage)).toEqual([]);
  });
});
