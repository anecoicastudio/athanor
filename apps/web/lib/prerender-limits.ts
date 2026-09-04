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
 * Dreams prerender NOTHING (#159), and the absence of a `PRERENDER_DREAM_LIMIT` is the
 * decision rather than an omission — `app/dream/[id]/page.tsx` exports an EMPTY
 * `generateStaticParams`, which prerenders nothing while keeping the route in the build's
 * prerender manifest so it still ISR-caches on demand (omitting the export instead makes
 * every request a fresh dynamic render, uncached).
 *
 * The arithmetic, on the same free-plan budget of 1,000 KV writes/day the caps above are
 * measured against: today a deploy writes ≈300 entries (100 handles × 2, plus 100 events), so
 * two deploys in a day already spend 600. A capped dream set at the same 100 would add 100
 * more — for text that is ALREADY prerendered inside the owner's `/@handle` page, since
 * `getPublicProfileByHandle` returns the active dream and its tappe and the page renders
 * both. The build-time write would therefore publish nothing a crawler cannot already reach,
 * while moving two deploys in a day from 600 to 800 writes.
 *
 * What on-demand costs instead: the first request for a given dream renders in the Worker and
 * writes one KV entry; every request after it, for five minutes at a time, is a Worker
 * invocation and a KV read — the same per-view cost a prerendered route pays. So the whole
 * trade is a slower first hit per dream, in exchange for a deploy that writes nothing and a
 * write bill that scales with what people actually open rather than with the table.
 */

/**
 * The sitemap is regenerated hourly inside the Worker and serialised in memory, so it is
 * bounded too — far under the 50,000-URL ceiling of one sitemap file, and by the time
 * either cap binds the answer is `generateSitemaps()` (one file per slice), not a bigger
 * number here. Most recently changed first, so a truncated list drops the quietest pages.
 */
export const SITEMAP_HANDLE_LIMIT = 1000;
export const SITEMAP_EVENT_LIMIT = 500;
/**
 * Dreams have a sitemap bound even though they have no prerender one: this bound protects the
 * Worker that serialises the list hourly, not a build. Sized under the handle limit because a
 * dream is at most one per member (PRD §4.3, one active dream per profile) and only the
 * members who published the `dream` facet have a page at all.
 */
export const SITEMAP_DREAM_LIMIT = 500;
