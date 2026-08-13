// erasure-job (11 §3.9 8b) — service-role, nightly pg_cron over gdpr_erasure_requests status='requested'.
// Cascade order is SECURITY-CRITICAL (10 §5.4):
//   (1) revoke all sessions for the user (deleting the user does NOT invalidate live tokens),
//   (2) soft/hard-delete user content honoring FK on delete cascade,
//   (3) PSEUDONYMIZE (never delete) legally-retained money rows (fund_contributions / event_tickets /
//       circle_memberships) — TODO(legal-gate): retention window needs counsel (10 §5 line 383),
//   (4) delete the auth.users row (cascades profiles), and purge any matching email_waitlist row.
// LEGAL-GATED: deployed, but the retention-gated cascade steps stay commented in ./logic.ts until
// counsel clears the retention window — a claimed request is recorded, not yet erased.
// Transport shell only — the loop (and the gated cascade steps, still commented) lives in
// ./logic.ts (unit-tested); this file wires auth, the service-role client, and the auth port.
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { processErasureRequests } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return processErasureRequests({
    db,
    auth: { signOut: (profileId, scope) => db.auth.admin.signOut(profileId, scope) },
  });
});
