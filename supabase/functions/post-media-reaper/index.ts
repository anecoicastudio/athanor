// post-media-reaper (#589) — internal service-role: frees the bytes of post-media objects no
// `post_media` row references, from either `storage_path` or `thumb_path`. Called nightly
// (04:29 UTC) by `invoke_post_media_reaper()` via pg_net, and by the operator. Deletes through
// the Storage API only — a `storage.objects` row delete would orphan the physical file.
// Transport shell only — the loop lives in ../_shared/reap.ts (unit-tested, DI'd); the
// candidate predicate lives in SQL (`post_media_reap_candidates`, pgTAP 0139) so it sits next
// to the table it diffs.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { POST_MEDIA_BUCKET, reapPostMedia } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return reapPostMedia({
    listCandidates: (limit) => db.rpc('post_media_reap_candidates', { p_limit: limit }),
    remove: (paths) => db.storage.from(POST_MEDIA_BUCKET).remove(paths),
  });
});
