import type { MetadataRoute } from 'next';
import { listPublicHandles, listUpcomingEventIds } from '@athanor/api';
import { SITE_URL } from '@/lib/site';
import { SITEMAP_EVENT_LIMIT, SITEMAP_HANDLE_LIMIT } from '@/lib/prerender-limits';

/*
 * Hourly, not build-frozen. This route now prerenders (it stopped awaiting cookies),
 * and without a TTL every profile created after a deploy would be missing from the
 * sitemap until the next one — the opposite of what making it static was for.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
  ];

  let handleEntries: MetadataRoute.Sitemap = [];
  let eventEntries: MetadataRoute.Sitemap = [];
  try {
    // createAnonClient, not createClient: the latter awaits cookies(), which kept
    // /sitemap.xml server-rendered on every crawl.
    const { createAnonClient } = await import('@/utils/supabase/server');
    const supabase = createAnonClient();
    // Both bounded (#335, lib/prerender-limits.ts): this runs in the Worker once an hour
    // and serialises the whole list in memory. Most recently changed first, so the cap
    // drops the quietest pages, not the newest. Upcoming events only: a past event keeps
    // its permalink and still renders, but asking a crawler to keep revisiting an evening
    // that already happened spends the crawl budget the upcoming ones need.
    const [handles, events] = await Promise.all([
      listPublicHandles(supabase, { limit: SITEMAP_HANDLE_LIMIT }),
      listUpcomingEventIds(supabase, { limit: SITEMAP_EVENT_LIMIT, now: lastModified }),
    ]);
    if (handles.excluded + events.excluded > 0) {
      console.warn(
        `sitemap: ${handles.excluded} profile and ${events.excluded} event row(s) withheld (schema mismatch)`,
      );
    }
    handleEntries = handles.entries.map((p) => ({
      url: `${SITE_URL}/@${p.handle}`,
      lastModified: new Date(p.updated_at),
    }));
    eventEntries = events.entries.map((e) => ({
      url: `${SITE_URL}/event/${e.id}`,
      lastModified: new Date(e.updated_at),
      // An event page changes little but matters most right before it happens, and the
      // hourly revalidate above means a new one appears here within the hour.
      changeFrequency: 'daily' as const,
      priority: 0.6,
    }));
  } catch (e) {
    // env/network unavailable at build → ship the static sitemap only. Logged
    // because a silent empty sitemap is indistinguishable from "no profiles yet".
    console.warn('sitemap: profile/event lookup failed, shipping static entries only:', e);
  }

  return [...staticEntries, ...handleEntries, ...eventEntries];
}
