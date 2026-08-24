// erasure-job (11 §3.9 8b) — service-role, nightly pg_cron over gdpr_erasure_requests status='requested'.
// Cascade order is SECURITY-CRITICAL (10 §5.4):
//   (1) revoke all sessions for the user (deleting the user does NOT invalidate live tokens),
//   (2) soft/hard-delete user content honoring FK on delete cascade,
//   (3) PSEUDONYMIZE (never delete) legally-retained money rows — fund_contributions is LIVE
//       (#240: tombstone reassignment + candidacy/vote deletion + blob removal); event_tickets /
//       circle_memberships stay TODO(legal-gate): retention window needs counsel (#184),
//   (2b) purge the subject's cached public web pages from Cloudflare KV — apps/web's OpenNext
//       incremental cache outlives the rows it renders and a deploy strands rather than
//       replaces its entries, so erasure sweeps every build prefix (#515, ./kv.ts),
//   (4) delete the auth.users row (cascades profiles), and purge any matching email_waitlist row.
// LEGAL-GATED: deployed but UNSCHEDULED, and the (3-gated)/(4) cascade steps stay commented in
// ./logic.ts until counsel clears the retention window — a claimed request has its fund footprint
// erased and then lands on status='partial' (#515), never 'done', so a partial erasure is never
// reported complete. 'failed' is reserved for a step that actually failed.
// Transport shell only — the loop (and the gated cascade steps, still commented) lives in
// ./logic.ts (unit-tested); this file wires auth, the service-role client, and the two ports.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { cloudflareKvFromEnv } from './kv.ts';
import { CANDIDACY_VIDEOS_BUCKET, processErasureRequests } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return processErasureRequests({
    db,
    auth: { signOut: (profileId, scope) => db.auth.admin.signOut(profileId, scope) },
    storage: { remove: (paths) => db.storage.from(CANDIDACY_VIDEOS_BUCKET).remove(paths) },
    // Reads CF_KV_PURGE_TOKEN / CF_KV_ACCOUNT_ID / CF_KV_NAMESPACE_ID — behind the gate, like
    // every other env read here, and null when the trio is absent. The loop records that null
    // rather than skipping on it (#515); it never resolves the env itself.
    kv: cloudflareKvFromEnv(),
  });
});
