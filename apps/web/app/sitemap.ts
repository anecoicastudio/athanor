import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/privacy`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
    { url: `${SITE_URL}/terms`, lastModified, changeFrequency: 'yearly', priority: 0.4 },
  ];

  let handleEntries: MetadataRoute.Sitemap = [];
  try {
    const { createClient } = await import('@/utils/supabase/server');
    const supabase = await createClient();
    const { data } = await supabase
      .from('profiles')
      .select('handle, updated_at')
      .not('handle', 'is', null);
    handleEntries = (data ?? [])
      .filter((p): p is { handle: string; updated_at: string } => Boolean(p.handle))
      .map((p) => ({
        url: `${SITE_URL}/@${p.handle}`,
        lastModified: new Date(p.updated_at),
      }));
  } catch {
    // env/network unavailable at build → ship the static sitemap only
  }

  return [...staticEntries, ...handleEntries];
}
