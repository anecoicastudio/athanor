import {
  type PublicDream,
  type PublicDreamEntry,
  publicDreamEntrySchema,
  publicDreamSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { signMediaUrls } from './storage';
import { parseOrWithhold } from './parse-or-withhold';

export const publicDreamKeys = {
  all: ['publicDream'] as const,
  detail: (id: string) => ['publicDream', 'detail', id] as const,
};

/*
 * The route segment is user input. A non-uuid reaches Postgres as 22P02 and comes back as a
 * PostgREST error, so /dream/<anything> would 500 where it should 404. Matched here rather
 * than in the page so both callers of this read-model are guarded once — the same guard, for
 * the same reason, as public-event.ts.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The public dream read-model (issue #159): assembled from anon, RLS-gated reads for the SSR
 * `/dream/{id}` page. Returns null when the segment is not a uuid, or when no row resolves —
 * both are a 404, not an error.
 *
 * What "no row resolves" covers is wider here than elsewhere, and every case is a 404 on
 * purpose: `dreams_select_anon_public` (20260614144747:24) returns the row only while it is
 * undeleted, `status = 'active'`, and its owner keeps `visibility.dream = 'public'` — and
 * 20260818114947 cascades a ban through the same EXISTS. So archiving a dream, soft-deleting
 * it, flipping the facet back to 'members' or being banned all un-publish the page through
 * one code path, with no branch here to keep in step.
 *
 * The byline is a second, independent read: `profiles_select_anon_public` gates on the
 * *identity* facet, so dream:public + identity:members is a reachable state that yields a
 * dream with no author. Null is that member's answer, not a fault — but a failed lookup
 * still rethrows, because an unattributed page would state «this member chose to stay
 * private» when the truth is «the database was down».
 *
 * `profile_id` is read only to resolve the byline and never returned; `publicDreamSchema` is
 * `.strict()`, so a widened select here fails loudly instead of leaking. The avatar is a
 * short-lived SIGNED url (the avatars bucket is private; `avatars_select_anon_shell`
 * authorises the signing) and degrades to null on a key that will not sign — initials — while
 * a failed signing CALL rethrows, exactly as `getPublicProfileByHandle` does.
 *
 * Plumbing only — no business logic, no Aura.
 */
export async function getPublicDreamById(
  client: AthanorClient,
  id: string,
): Promise<PublicDream | null> {
  if (!UUID.test(id)) return null;

  const { data: dream, error: dErr } = await client
    .from('dreams')
    .select('id, text, profile_id')
    .eq('id', id)
    // RLS already hides deleted and non-active rows from anon; repeated here so the query is
    // correct under any client, and so it uses the `deleted_at is null` partial indexes.
    .is('deleted_at', null)
    .eq('status', 'active')
    .maybeSingle();
  if (dErr) throw dErr;
  if (!dream) return null;

  const { data: profile, error: pErr } = await client
    .from('profiles')
    .select('handle, display_name, avatar_path')
    .eq('id', dream.profile_id)
    .maybeSingle();
  if (pErr) throw pErr;

  let avatarUrl: string | null = null;
  if (profile?.avatar_path) {
    const signed = await signMediaUrls(client, 'avatars', [profile.avatar_path]);
    avatarUrl = signed[profile.avatar_path] ?? null;
  }

  const { data: tappe, error: mErr } = await client
    .from('dream_milestones')
    .select('id, body, status')
    .eq('dream_id', dream.id)
    .is('deleted_at', null)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (mErr) throw mErr;

  return publicDreamSchema.parse({
    id: dream.id,
    text: dream.text,
    milestones: (tappe ?? []).map((m) => ({ id: m.id, body: m.body, status: m.status })),
    // A profile row with a null handle cannot be linked to, so it is no byline at all —
    // handleSchema would reject it anyway, and rejecting it here says why.
    author: profile?.handle
      ? {
          handle: profile.handle,
          displayName: profile.display_name ?? null,
          avatarUrl,
        }
      : null,
  });
}

/**
 * The N most recently changed public dreams, newest change first — what the sitemap lists
 * (#335).
 *
 * Bounded like every other index here, but for one reason rather than two: `/dream/[id]`
 * prerenders no params at all (`apps/web/lib/prerender-limits.ts` records the arithmetic), so
 * this bound protects the Worker that serialises the sitemap hourly, not a build. Ordered by
 * `updated_at` with an `id` tie-break so the cut is total and therefore deterministic between
 * two runs over the same data.
 *
 * Anon-gated like every read here: RLS returns only active, undeleted dreams whose owner
 * published the facet, so a dream outside that set is simply not returned and needs no filter
 * of its own — beyond the two repeated for the partial indexes. Rows the schema rejects are
 * withheld and counted, never thrown (api.md): one odd row must not empty the sitemap, and a
 * silent drop would be the failure that looks like success.
 */
export async function listPublicDreamIds(
  client: AthanorClient,
  opts: { limit: number },
): Promise<{ entries: PublicDreamEntry[]; excluded: number }> {
  const { data, error } = await client
    .from('dreams')
    .select('id, updated_at')
    .is('deleted_at', null)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
  const { parsed, excluded } = parseOrWithhold(
    data,
    publicDreamEntrySchema,
    'dreams',
    'the public dream index',
  );
  return { entries: parsed, excluded };
}
