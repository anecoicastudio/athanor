import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getPublicDreamById } from '@athanor/api';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { SITE_URL } from '@/lib/site';
import { createAnonClient } from '@/utils/supabase/server';
import { PublicDreamClient } from '@/components/public-dream-client';

/*
 * `/dream/{id}` — the last public SEO surface (#159; URL shape ruled 2026-08-23: the English
 * path, family of `/event/*` and `/post/*`). It is one of the universal-link paths the
 * association files declare, so someone with the app installed lands in it and everyone else
 * — crawlers included — gets this page instead of nothing.
 *
 * An EMPTY generateStaticParams, and that is the deliberate half of this file (#335,
 * lib/prerender-limits.ts). Handles and events prerender a capped set; dreams prerender none
 * and render on demand, cached by the incremental cache from the first request on. The
 * arithmetic is in prerender-limits.ts; the short version is that a prerendered dream costs a
 * KV write per deploy to publish text that is ALREADY prerendered inside the owner's
 * `/@handle` page, so the build-time write buys a crawler nothing it cannot already reach.
 *
 * Empty rather than absent, and the difference is not cosmetic: OMITTING the export makes
 * Next render this route dynamically on every request (`ƒ` in the build output), which drops
 * it out of `prerender-manifest.json` entirely — no incremental cache entry, no `revalidate`,
 * a Worker render and a fresh set of database reads for every crawler hit. Exporting it empty
 * keeps the route in `dynamicRoutes` with a blocking fallback: nothing is written at build
 * time, and the first request for a given dream renders once and caches. Measured on this
 * build, not assumed — the two shapes differ in the manifest.
 *
 * The 5-minute TTL matters more here than anywhere else, for the reason `/@handle` records:
 * nothing in this repo can invalidate a cache entry (revalidatePath is only ever called for
 * /admin), and a dream un-publishes four ways — archived, soft-deleted, the `dream` facet
 * flipped back to 'members', the owner banned. Each of those is a 404 from the reader within
 * one window, with no branch here to keep in step.
 */
export const dynamicParams = true;
export const revalidate = 300;

/**
 * Deliberately empty — see the module doc. No database read at build time either, so a build
 * against an unreachable database behaves exactly like a build against a full one.
 */
export function generateStaticParams(): { id: string }[] {
  return [];
}

/*
 * `cache()` because this route is the one that never prerenders. generateMetadata and the page
 * body both need the dream, and the reader makes three round-trips (dream, byline, tappe); on
 * /@handle and /event that doubling is paid once at build time for most rows, but here it
 * would be paid on every on-demand render — six queries where three will do. React dedupes
 * within one request pass, which is exactly the scope of the two calls.
 */
const load = cache(async (id: string) => {
  // createAnonClient, not createClient: this page is public and RLS-gated, so it has no
  // session to read — and awaiting cookies() would opt the route back into dynamic rendering
  // for every request, which is the regression build-checks/prerender-manifest.test.ts exists
  // to catch.
  return getPublicDreamById(createAnonClient(), id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // DEFAULT_LOCALE throughout: crawlers carry no locale cookie, so this metadata was only
  // ever IT anyway.
  const { id } = await params;
  const dream = await load(id);
  if (!dream) {
    return {
      title: `${t('publicDream.unavailable', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
    };
  }
  const title = dream.author
    ? t('publicDream.titleWithAuthor', DEFAULT_LOCALE, { handle: dream.author.handle })
    : t('publicDream.title', DEFAULT_LOCALE);
  // The dream itself is the description — it is at most 500 chars (dreamSchema) and is the
  // one sentence the member chose to be known by.
  const description = dream.text;
  return {
    title: `${title} — ${t('app.name', DEFAULT_LOCALE)}`,
    description,
    /*
     * Self-canonical, and the only page here that declares one. This is the single surface
     * that republishes content already indexed at another URL: `/@handle` renders the same
     * dream text and the same tappe (packages/api public-profile.ts). The two are not the
     * same page — that one is the member, this one is the dream — so neither should point at
     * the other, but saying so explicitly is what keeps a crawler from picking one at random
     * and consolidating the wrong way.
     */
    alternates: { canonical: `${SITE_URL}/dream/${dream.id}` },
    // Name the site-wide card explicitly. Next replaces `openGraph` rather than merging it,
    // so declaring this object at all drops the parent's image — and the layout's
    // `summary_large_image` would then promise a card with no picture. A per-dream Satori
    // image is out for the reason /event/[id] records: this route never prerenders, so the
    // card would render in the Worker on every request, against a 10 ms CPU budget.
    openGraph: { title, description, images: ['/opengraph-image'] },
    twitter: { images: ['/opengraph-image'] },
    robots: { index: true, follow: true },
  };
}

export default async function DreamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dream = await load(id);
  if (!dream) notFound();
  /*
   * No JSON-LD, unlike /event/[id]. That page emits schema.org/Event because Google has an
   * event rich result to put it in; a dream maps to nothing better than CreativeWork, which
   * buys no surface and would be a second copy of the text to keep in step.
   */
  return <PublicDreamClient dream={dream} />;
}
