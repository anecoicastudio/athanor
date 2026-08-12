import { type PublicProfile, publicProfileSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

/**
 * The public @handle read-model (frontend 02 §6): assembled from anon, visibility-gated
 * reads. Returns null when no public row resolves (RLS returns 0 rows for a private/
 * members-only profile, or the handle does not exist). Plumbing only — no business
 * logic, no Aura.
 *
 * `bio` is always null on this anon path: members/private columns are not granted to
 * anon at the trust boundary (migration 20260614153620 — column-level GRANT), so public
 * bio (when bio:public) is deferred to a future SECURITY DEFINER RPC that projects only
 * the allowed columns server-side. Dream + tappe are whole-row-public (RLS exposes them
 * only when dream:public), so they need no column shaping.
 */
export async function getPublicProfileByHandle(
  client: AthanorClient,
  handle: string,
): Promise<PublicProfile | null> {
  const { data: profile, error: pErr } = await client
    .from('profiles')
    .select('id, handle')
    .eq('handle', handle)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile || !profile.handle) return null;

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

  return publicProfileSchema.parse({ handle: profile.handle, bio, dream });
}
