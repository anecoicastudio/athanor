import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { t } from '@athanor/i18n';
import { getPublicEventById, listUpcomingEventIds } from '@athanor/api';
import { DEFAULT_LOCALE } from '@/lib/default-locale';
import { SITE_URL } from '@/lib/site';
import { eventDateTime, eventIsPast } from '@/lib/event-format';
import { eventJsonLd } from '@/lib/event-jsonld';
import { PRERENDER_EVENT_LIMIT } from '@/lib/prerender-limits';
import { createAnonClient } from '@/utils/supabase/server';
import { PublicEventClient } from '@/components/public-event-client';

/*
 * `/event/{id}` is one of the universal-link paths the association files already declare
 * (apple-app-site-association, assetlinks), so someone with the app installed lands in it
 * and everyone else — crawlers included — gets this page instead of nothing.
 *
 * Prerender the next PRERENDER_EVENT_LIMIT upcoming events (#335, lib/prerender-limits.ts)
 * and serve the rest on demand: a past event is still a live permalink someone may have
 * shared, and `dynamicParams: false` would 404 both it and any event created since the
 * last build. Same trade as /@handle.
 */
export const dynamicParams = true;
export const revalidate = 300;

export async function generateStaticParams() {
  try {
    // A row the reader could not validate is withheld and logged by the reader itself
    // (api.md) — one odd row must not un-prerender the route.
    const { entries } = await listUpcomingEventIds(createAnonClient(), {
      limit: PRERENDER_EVENT_LIMIT,
    });
    return entries.map((e) => ({ id: e.id }));
  } catch (e) {
    // env/network unavailable at build → prerender nothing, serve every event on demand.
    // Loud on purpose: returning [] silently is indistinguishable from "no upcoming
    // events" and would quietly un-prerender the whole route.
    console.warn('[event] generateStaticParams failed, prerendering no events:', e);
    return [];
  }
}

async function load(id: string) {
  // createAnonClient, not createClient: this page is public and RLS-gated, so it has no
  // session to read — and awaiting cookies() would opt the route back into dynamic
  // rendering for every request, prerendered params included.
  const event = await getPublicEventById(createAnonClient(), id);
  if (!event) return null;
  // The clock is read here, not in the component body: reading it during render is
  // impure (react-hooks/purity), and the point of `isPast` is that one render decides
  // it once and hydration agrees.
  return { event, isPast: eventIsPast(event.starts_at, event.ends_at) };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  // DEFAULT_LOCALE throughout: crawlers carry no locale cookie, so this metadata was only
  // ever IT anyway.
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) {
    return {
      title: `${t('publicEvent.unavailable', DEFAULT_LOCALE)} — ${t('app.name', DEFAULT_LOCALE)}`,
    };
  }
  const { event } = loaded;
  const where = event.is_online
    ? t('event.whereOnline', DEFAULT_LOCALE, { kind: t('event.streamKind', DEFAULT_LOCALE) })
    : [event.venue, event.city].filter(Boolean).join(' · ');
  const description = [eventDateTime(event.starts_at, DEFAULT_LOCALE), where]
    .filter(Boolean)
    .join(' · ');
  return {
    title: `${event.title} — ${t('app.name', DEFAULT_LOCALE)}`,
    description,
    // Name the site-wide card explicitly. Next replaces `openGraph` rather than merging
    // it, so declaring this object at all drops the parent's image — and the layout's
    // `summary_large_image` would then promise a card with no picture. Per-event Satori
    // images are out for the same reason /@handle dropped them (10 ms CPU budget).
    openGraph: { title: event.title, description, images: ['/opengraph-image'] },
    twitter: { images: ['/opengraph-image'] },
    robots: { index: true, follow: true },
  };
}

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) notFound();
  const { event, isPast } = loaded;
  return (
    <>
      {/* schema.org/Event — what puts the event in Google's event results rather than in
          a list of blue links. Server-rendered so it is in the static HTML a crawler
          reads, and built from the same read-model the page renders. */}
      <script
        type="application/ld+json"
        // The payload is our own JSON.stringify of a typed object, not user HTML; `<` in
        // a title would still break out of the script element, so escape it.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(eventJsonLd(event, `${SITE_URL}/event/${event.id}`)).replace(
            /</g,
            '\\u003c',
          ),
        }}
      />
      <PublicEventClient event={event} isPast={isPast} />
    </>
  );
}
