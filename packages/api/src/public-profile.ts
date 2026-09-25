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
 * reads. Returns null when no row resolves — the handle does not exist, or the member's
 * `identity` facet is 'members' and the row is anon-invisible. Since #790 that is where a new
 * member starts; members from before keep whatever they had (the #251 shell was opt-out).
 * Plumbing only — no business logic, no Aura.
 *
 * The shell columns (handle, display_name, avatar_path) are anon-granted since
 * 20260814151601. The sign is `public_zodiac_sign` (#790): the sign when the member's `zodiac`
 * facet is 'public', NULL otherwise — anon holds no grant on `zodiac_sign` itself, because a
 * column grant cannot follow a per-member choice. `bio` is still always null on this anon path: content columns are not
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
  const profile = await readShell(client, handle);
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
    // #790 — null unless the member set the zodiac facet to «Tutti» and has a date.
    zodiacSign: profile.zodiacSign,
    bio,
    dream,
  });
}

type ShellRow = {
  id: string;
  handle: string | null;
  display_name: string | null;
  avatar_path: string | null;
  zodiacSign: string | null;
};

/**
 * The anon shell row, across the #790 schema change.
 *
 * `apps/web` builds against PRODUCTION (CI's `web build` and `deploy` read the live project),
 * and production takes migrations only at release, so for a while this code runs against a
 * database without `public_zodiac_sign`. There the select answers 42703 (undefined column),
 * and the read falls back to the pre-#790 shape, where anon still holds `zodiac_sign` and the
 * sign is public by the rule of that schema. On a migrated database the first select
 * succeeds and the fallback never runs — anon's `zodiac_sign` grant is gone there (42501),
 * so it could not leak even if it did. The fallback also makes «deploy web, then migrate» a
 * safe release order (RELEASE-RUNBOOK §4.6 rider). Remove it once production carries
 * 20260925143552.
 */
async function readShell(client: AthanorClient, handle: string): Promise<ShellRow | null> {
  const current = await client
    .from('profiles')
    .select('id, handle, display_name, avatar_path, public_zodiac_sign')
    .eq('handle', handle)
    .maybeSingle();
  if (!current.error) {
    const row = current.data;
    return row && { ...row, zodiacSign: row.public_zodiac_sign ?? null };
  }
  if (current.error.code !== '42703') throw current.error;

  const legacy = await client
    .from('profiles')
    .select('id, handle, display_name, avatar_path, zodiac_sign')
    .eq('handle', handle)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  const row = legacy.data;
  return row && { ...row, zodiacSign: row.zodiac_sign ?? null };
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
