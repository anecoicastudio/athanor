// erasure-job (11 §3.9 8b) — service-role, over gdpr_erasure_requests status='requested'.
// Runs nightly at 03:47 UTC under pg_cron (erasure-nightly, 20260908071807), which posts here
// through invoke_erasure_job() with the key on the `apikey` header.
// Cascade order is SECURITY-CRITICAL (10 §5.4):
//   (1) revoke all sessions for the user (deleting the user does NOT invalidate live tokens),
//   (2) soft/hard-delete user content honoring FK on delete cascade,
//   (3) PSEUDONYMIZE (never delete) legally-retained money rows — fund_contributions
//       (#240: tombstone reassignment + candidacy/vote deletion),
//   (3a) delete the subject's BYTES from every declared storage bucket (#573, ./sweep.ts over
//       gdpr_storage_footprint). Until #573 this reached candidacy-videos alone, so an erased
//       member's photos, chat images, avatar and their own exported archives all survived,
//   (3b) purge the subject's cached public web pages from Cloudflare KV — apps/web's OpenNext
//       incremental cache outlives the rows it renders and a deploy strands rather than
//       replaces its entries, so erasure sweeps every build prefix (#515, ./kv.ts). Runs after
//       (3) and before (4) because it needs the handle, which (4) cascades away,
//   (3b-bis) CANCEL the Circle subscription at Stripe (#107) — before (3c) hides who was being
//       billed. Pseudonymising the row stops us knowing; it does not stop Stripe charging,
//   (3c) PSEUDONYMIZE event_tickets + circle_memberships (#107, the controller's 2026-09-07
//       ruling in #184): identity nulled, erased_at stamped, money columns and Stripe ids kept.
//       Both identity columns are ON DELETE CASCADE, so this MUST precede (4b) — otherwise the
//       account delete does not fail, it destroys the records the ruling retains for ten years,
//   (3d) release the three NO ACTION references that would make (4b) raise 23503 (#107),
//   (4) delete the auth.users row (cascades profiles), and purge any matching email_waitlist row.
// A clean pass ends status='done'. There is no legal gate left: #184 was ruled by the controller
// on 2026-09-07 and #107 implemented it. 'failed' means a step actually failed, which includes a
// deliberate skip of (4) when (3c)/(3d) did not succeed; 'partial' is historical and this job no
// longer writes it.
// Transport shell only — the loop lives in ./logic.ts (unit-tested); this file wires auth, the
// service-role client, and the three ports. The step-(1) wiring itself lives in ./revoke.ts, not
// inline here: nothing in the suite ever executes this file, so an inline port is a contract no
// test can reach (#542).
import { requireServiceRole } from '../_shared/auth.ts';
import { stripeClient, stripeConfigured } from '../_shared/stripe.ts';
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
    auth: {
      // By id, through ./revoke.ts — NOT db.auth.admin.signOut, which takes a JWT and 401'd on
      // every profile id it was handed until #542 (./revoke.ts has the whole account).
      revokeSessions: sessionRevoker(db),
      // Read for the waitlist purge's email and nothing else (#107, step 4a), and read before
      // deleteUser because afterwards there is no auth row to read it from.
      getUserById: (profileId: string) => db.auth.admin.getUserById(profileId),
      // The irreversible one. Gated in ./logic.ts on the payment tables being pseudonymised
      // first — see the deletionSafe flag there.
      deleteUser: (profileId: string) => db.auth.admin.deleteUser(profileId),
    },
    // Bucket chosen per call, never pre-bound: #573's sweep reaches every declared bucket, and
    // a port bound to one was how five buckets' bytes survived an erasure.
    storage: { remove: (bucket, paths) => db.storage.from(bucket).remove(paths) },
    // Reads CF_KV_PURGE_TOKEN / CF_KV_ACCOUNT_ID / CF_KV_NAMESPACE_ID — behind the gate, like
    // every other env read here, and null when the trio is absent. The loop records that null
    // rather than skipping on it (#515); it never resolves the env itself.
    kv: cloudflareKvFromEnv(),
    // Null when STRIPE_SECRET_KEY is absent, exactly as `kv` is null without the CF_KV trio:
    // the loop must be able to RECORD an unconfigured deployment rather than discover it as a
    // thrown client construction. The client itself is still resolved on first use inside the
    // closure, never at import (#541).
    stripe: stripeConfigured()
      ? { cancelSubscription: (id: string) => stripeClient().subscriptions.cancel(id) }
      : null,
  });
});
