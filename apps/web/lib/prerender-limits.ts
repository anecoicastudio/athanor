/**
 * How much of the database a build and the sitemap may read (#335).
 *
 * On this deployment a prerendered route is not a free static file: `.open-next/assets`
 * holds no HTML, so every one is a build-time render + a KV write per deploy (two per
 * handle — the page and its og card) and a Worker invocation + a KV read per view.
 * Unbounded, the set grows 1:1 with signups. Capped, it is the N most recently changed
 * handles and the next N events, and `dynamicParams = true` renders everything else on its
 * first request, cached by the incremental cache from then on.
 *
 * 100 handles ≈ 200 KV writes per deploy against the free plan's 1,000 writes/day, and
 * ≈ 30 s of Satori at the measured 0.3 s per card. What being past the cap costs a member:
 * a first-hit render for the page (then cached five minutes at a time), and the generic
 * site card for og:image on every request — app/[handle]/opengraph-image.tsx never renders
 * in the Worker. Editing the profile moves it back into the set at the next build.
 * build-checks/prerender-manifest.test.ts asserts a build never exceeds these.
 */
export const PRERENDER_HANDLE_LIMIT = 100;
export const PRERENDER_EVENT_LIMIT = 100;

/**
 * The sitemap is regenerated hourly inside the Worker and serialised in memory, so it is
 * bounded too — far under the 50,000-URL ceiling of one sitemap file, and by the time
 * either cap binds the answer is `generateSitemaps()` (one file per slice), not a bigger
 * number here. Most recently changed first, so a truncated list drops the quietest pages.
 */
export const SITEMAP_HANDLE_LIMIT = 1000;
export const SITEMAP_EVENT_LIMIT = 500;
