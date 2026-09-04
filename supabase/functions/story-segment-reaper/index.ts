// story-segment-reaper (#31) — internal service-role: frees the bytes of story segments whose
// descriptor row is expired or soft-deleted (and not pinned). Called nightly by
// `prune_expired_story_segments()` via pg_net right after the row-side soft-delete, and by the
// operator. Deletes through the Storage API only — a `storage.objects` row delete would orphan
// the physical file. Transport shell only — the loop lives in ./logic.ts (unit-tested, DI'd);
// the candidate predicate lives in SQL (`story_segment_reap_candidates`, pgTAP 0126) so it
// sits next to the SELECT policy it inverts.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { reapStorySegments, STORY_SEGMENTS_BUCKET } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return reapStorySegments({
    listCandidates: (limit) => db.rpc('story_segment_reap_candidates', { p_limit: limit }),
    remove: (paths) => db.storage.from(STORY_SEGMENTS_BUCKET).remove(paths),
  });
});
