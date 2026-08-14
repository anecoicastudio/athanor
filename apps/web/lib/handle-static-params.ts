import { createAnonClient } from '@/utils/supabase/server';

/**
 * Shared generateStaticParams body for the /[handle] segment — the page AND its
 * opengraph-image sibling. A metadata image route does not inherit the page's
 * generateStaticParams (verified against the 16.2.12 build output: without its
 * own export the image route builds with zero prerendered params, and on
 * Workers "render on demand" means the redirect branch — every card generic).
 * One list, two exports, so the two routes cannot prerender different sets.
 *
 * ⚠ Unbounded select, same as before the extraction — #335 tracks the scale
 * seam, and it now costs one Satori render (~0.3 s) per handle at build too.
 */
export async function handleStaticParams(): Promise<{ handle: string }[]> {
  try {
    const supabase = createAnonClient();
    const { data, error } = await supabase
      .from('profiles')
      .select('handle')
      .not('handle', 'is', null);
    if (error) throw error;
    return (
      (data ?? [])
        .filter((p): p is { handle: string } => Boolean(p.handle))
        // The route rejects a segment without the leading @ (lib/resolve-handle.ts).
        .map((p) => ({ handle: `@${p.handle}` }))
    );
  } catch (e) {
    // env/network unavailable at build → prerender nothing, serve every handle on
    // demand. Loud on purpose: silently returning [] looks identical to "no
    // profiles exist" and would quietly un-prerender the whole route.
    console.warn('[handle] generateStaticParams failed, prerendering no profiles:', e);
    return [];
  }
}
