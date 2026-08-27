// erasure-job (11 §3.9 8b) — service-role, over gdpr_erasure_requests status='requested'.
// Intended to run nightly under pg_cron; no migration schedules it yet, so today it is invoked by
// hand (see LEGAL-GATED below and docs/RELEASE-RUNBOOK.md §7).
// Cascade order is SECURITY-CRITICAL (10 §5.4):
//   (1) revoke all sessions for the user (deleting the user does NOT invalidate live tokens),
//   (2) soft/hard-delete user content honoring FK on delete cascade,
//   (3) PSEUDONYMIZE (never delete) legally-retained money rows — fund_contributions is LIVE
//       (#240: tombstone reassignment + candidacy/vote deletion); event_tickets /
//       circle_memberships stay TODO(legal-gate): retention window needs counsel (#184),
//   (3a) delete the subject's BYTES from every declared storage bucket (#573, ./sweep.ts over
//       gdpr_storage_footprint). Until #573 this reached candidacy-videos alone, so an erased
//       member's photos, chat images, avatar and their own exported archives all survived,
//   (3b) purge the subject's cached public web pages from Cloudflare KV — apps/web's OpenNext
//       incremental cache outlives the rows it renders and a deploy strands rather than
//       replaces its entries, so erasure sweeps every build prefix (#515, ./kv.ts). Runs after
//       (3) and before (4) because it needs the handle, which (4) cascades away,
//   (4) delete the auth.users row (cascades profiles), and purge any matching email_waitlist row.
// LEGAL-GATED: deployed but UNSCHEDULED, and the (3-gated)/(4) cascade steps stay commented in
// ./logic.ts until counsel clears the retention window — a claimed request has its fund footprint
// erased and then lands on status='partial' (#515), never 'done', so a partial erasure is never
// reported complete. 'failed' is reserved for a step that actually failed.
// Transport shell only — the loop (and the gated cascade steps, still commented) lives in
// ./logic.ts (unit-tested); this file wires auth, the service-role client, and the two ports.
// The step-(1) wiring itself lives in ./revoke.ts, not inline here: nothing in the suite ever
// executes this file, so an inline port is a contract no test can reach (#542).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { cloudflareKvFromEnv } from './kv.ts';
import { processErasureRequests } from './logic.ts';
import { sessionRevoker } from './revoke.ts';

Deno.serve((req) => {
  // Caller gate: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return processErasureRequests({
    db,
    // By id, through ./revoke.ts — NOT db.auth.admin.signOut, which takes a JWT and 401'd on
    // every profile id it was handed until #542 (./revoke.ts has the whole account).
    auth: { revokeSessions: sessionRevoker(db) },
    // Bucket chosen per call, never pre-bound: #573's sweep reaches every declared bucket, and
    // a port bound to one was how five buckets' bytes survived an erasure.
    storage: { remove: (bucket, paths) => db.storage.from(bucket).remove(paths) },
    // Reads CF_KV_PURGE_TOKEN / CF_KV_ACCOUNT_ID / CF_KV_NAMESPACE_ID — behind the gate, like
    // every other env read here, and null when the trio is absent. The loop records that null
    // rather than skipping on it (#515); it never resolves the env itself.
    kv: cloudflareKvFromEnv(),
  });
});
