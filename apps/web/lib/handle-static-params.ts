import { listPublicHandles } from '@athanor/api';
import { createAnonClient } from '@/utils/supabase/server';
import { PRERENDER_HANDLE_LIMIT } from '@/lib/prerender-limits';

/**
 * Shared generateStaticParams body for the /[handle] segment — the page AND its
 * opengraph-image sibling. A metadata image route does not inherit the page's
 * generateStaticParams (verified against the 16.2.12 build output: without its
 * own export the image route builds with zero prerendered params, and on
 * Workers "render on demand" means the redirect branch — every card generic).
 * One list, two exports, so the two routes cannot prerender different sets.
 *
 * Bounded to the PRERENDER_HANDLE_LIMIT most recently changed handles (#335) —
 * lib/prerender-limits.ts says why and what it costs. The query itself lives in
 * @athanor/api (`listPublicHandles`): this app no longer names a table. A row the
 * reader could not validate is withheld and logged by the reader itself (api.md),
 * so one odd row never un-prerenders the route.
 */
export async function handleStaticParams(): Promise<{ handle: string }[]> {
  try {
    const { entries } = await listPublicHandles(createAnonClient(), {
      limit: PRERENDER_HANDLE_LIMIT,
    });
    // The route rejects a segment without the leading @ (lib/resolve-handle.ts).
    return entries.map((p) => ({ handle: `@${p.handle}` }));
  } catch (e) {
    // env/network unavailable at build → prerender nothing, serve every handle on
    // demand. Loud on purpose: silently returning [] looks identical to "no
    // profiles exist" and would quietly un-prerender the whole route.
    console.warn('[handle] generateStaticParams failed, prerendering no profiles:', e);
    return [];
  }
}
