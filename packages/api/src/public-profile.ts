import {
  type PublicHandleEntry,
  type PublicProfile,
  publicHandleEntrySchema,
  publicProfileSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';
import { signMediaUrls } from './storage';
import { parseOrWithhold } from './parse-or-withhold';

/**
 * The public @handle read-model (frontend 02 §6): assembled from anon, visibility-gated
 * reads. Returns null when no row resolves — the handle does not exist, or the member set
 * their `identity` facet to 'members' and the row is anon-invisible (#251: the default
 * shell is opt-out, so this is the explicit opt-out case). Plumbing only — no business
 * logic, no Aura.
 *
 * The shell columns (handle, display_name, avatar_path) are anon-granted since
 * 20260814151601. `bio` is still always null on this anon path: content columns are not
 * granted to anon at the trust boundary (migration 20260614153620 — column-level GRANT),
 * so public bio (when bio:public) stays deferred to a future SECURITY DEFINER RPC that
 * projects only the allowed columns server-side. Dream + tappe are whole-row-public (RLS
 * exposes them only when dream:public AND the owner keeps the shell), so they need no
 * column shaping.
 *
 * The avatar is returned as a SIGNED url (the bucket is private; the anon storage policy
 * `avatars_select_anon_shell` is what authorises the signing). A key that fails to sign
 * degrades to null — initials — but a failed signing CALL rethrows like the other reads:
 * an infrastructure fault must not publish a page that looks like «this member has no
 * photo».
 */
export async function getPublicProfileByHandle(
  client: AthanorClient,
  handle: string,
): Promise<PublicProfile | null> {
  const { data: profile, error: pErr } = await client
    .from('profiles')
    .select('id, handle, display_name, avatar_path')
    .eq('handle', handle)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile || !profile.handle) return null;

  let avatarUrl: string | null = null;
  if (profile.avatar_path) {
    const signed = await signMediaUrls(client, 'avatars', [profile.avatar_path]);
    avatarUrl = signed[profile.avatar_path] ?? null;
  }

  // Public bio deferred to a SECURITY DEFINER RPC (see doc comment) — never read here.
  const bio: string | null = null;

  // RLS only returns the active dream when the owner's dream section is public.
  const { data: dreamRow, error: dErr } = await client
    .from('dreams')
    .select('id, text')
    .eq('profile_id', profile.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .maybeSingle();
  if (dErr) throw dErr;

  let dream: PublicProfile['dream'] = null;
  if (dreamRow) {
    const { data: tappe, error: mErr } = await client
      .from('dream_milestones')
      .select('id, body, status')
      .eq('dream_id', dreamRow.id)
      .is('deleted_at', null)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (mErr) throw mErr;
    dream = {
      text: dreamRow.text,
      milestones: (tappe ?? []).map((m) => ({ id: m.id, body: m.body, status: m.status })),
    };
  }

  return publicProfileSchema.parse({
    handle: profile.handle,
    displayName: profile.display_name ?? null,
    avatarUrl,
    bio,
    dream,
  });
}

/**
 * The N most recently changed public handles, newest change first — what `/[handle]`
 * prerenders and what the sitemap lists (#335).
 *
 * Bounded on purpose, and the caller names the bound: on the web deployment a prerendered
 * route is a build-time render plus a KV write per deploy and a Worker invocation plus a KV
 * read per view, so an unbounded list scales the build and the free-plan quota 1:1 with
 * signups. `dynamicParams` serves everything past the cap on demand. Ordered by `updated_at`
 * rather than `created_at` so an active member stays in the set; the `id` tie-break keeps
 * the order total, which is what makes the cut deterministic between two builds of the same
 * data.
 *
 * Anon-gated like every read here: RLS hides members whose identity facet is 'members', so a
 * handle outside the set is simply not returned. Rows the schema rejects are withheld and
 * counted, never thrown (api.md): one odd row must not un-prerender the route, and a silent
 * drop would be the failure that looks like success. `id` is selected only so a withheld
 * row is findable in the warning.
 */
export async function listPublicHandles(
  client: AthanorClient,
  opts: { limit: number },
): Promise<{ entries: PublicHandleEntry[]; excluded: number }> {
  const { data, error } = await client
    .from('profiles')
    .select('id, handle, updated_at')
    .not('handle', 'is', null)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(opts.limit);
  if (error) throw error;
  const { parsed, excluded } = parseOrWithhold(
    data,
    publicHandleEntrySchema,
    'profiles',
    'the public handle index',
  );
  return { entries: parsed, excluded };
}
