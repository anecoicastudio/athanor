import type { MetadataRoute } from 'next';
import { listPublicDreamIds, listPublicHandles, listUpcomingEventIds } from '@athanor/api';
import { SITE_URL } from '@/lib/site';
import {
  SITEMAP_DREAM_LIMIT,
  SITEMAP_EVENT_LIMIT,
  SITEMAP_HANDLE_LIMIT,
} from '@/lib/prerender-limits';

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
  let dreamEntries: MetadataRoute.Sitemap = [];
  try {
    // createAnonClient, not createClient: the latter awaits cookies(), which kept
    // /sitemap.xml server-rendered on every crawl.
    const { createAnonClient } = await import('@/utils/supabase/server');
    const supabase = createAnonClient();
    // All three bounded (#335, lib/prerender-limits.ts): this runs in the Worker once an hour
    // and serialises the whole list in memory. Most recently changed first, so the cap
    // drops the quietest pages, not the newest. Upcoming events only: a past event keeps
    // its permalink and still renders, but asking a crawler to keep revisiting an evening
    // that already happened spends the crawl budget the upcoming ones need.
    //
    // Settled independently, so one failing index does not empty the others for a whole
    // revalidate window — a transient error on profiles must not advertise zero upcoming
    // events for an hour. A row any reader withheld is logged by that reader (api.md).
    const [handles, events, dreams] = await Promise.allSettled([
      listPublicHandles(supabase, { limit: SITEMAP_HANDLE_LIMIT }),
      listUpcomingEventIds(supabase, { limit: SITEMAP_EVENT_LIMIT, now: lastModified }),
      listPublicDreamIds(supabase, { limit: SITEMAP_DREAM_LIMIT }),
    ]);
    if (handles.status === 'fulfilled') {
      handleEntries = handles.value.entries.map((p) => ({
        url: `${SITE_URL}/@${p.handle}`,
        lastModified: new Date(p.updated_at),
      }));
    } else {
      console.warn('sitemap: profile lookup failed, shipping no profile entries:', handles.reason);
    }
    if (events.status === 'fulfilled') {
      eventEntries = events.value.entries.map((e) => ({
        url: `${SITE_URL}/event/${e.id}`,
        lastModified: new Date(e.updated_at),
        // An event page changes little but matters most right before it happens, and the
        // hourly revalidate above means a new one appears here within the hour.
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }));
    } else {
      console.warn('sitemap: event lookup failed, shipping no event entries:', events.reason);
    }
    if (dreams.status === 'fulfilled') {
      dreamEntries = dreams.value.entries.map((d) => ({
        url: `${SITE_URL}/dream/${d.id}`,
        lastModified: new Date(d.updated_at),
        // A dream changes when its owner edits the one sentence, which is rare — and unlike
        // an event it has no date it stops mattering after. `weekly` asks for less crawl
        // budget than the event entries take, which is the right split: this is the only
        // family here that republishes text already indexed at /@handle (#159).
        changeFrequency: 'weekly' as const,
        priority: 0.5,
      }));
    } else {
      console.warn('sitemap: dream lookup failed, shipping no dream entries:', dreams.reason);
    }
  } catch (e) {
    // env unavailable at build (no client can be made) → ship the static sitemap only.
    // Logged because a silent empty sitemap is indistinguishable from "no profiles yet".
    console.warn('sitemap: index lookups failed, shipping static entries only:', e);
  }

  return [...staticEntries, ...handleEntries, ...eventEntries, ...dreamEntries];
}
