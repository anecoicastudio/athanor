// erasure-job (11 §3.9 8b) — service-role, nightly pg_cron over gdpr_erasure_requests status='requested'.
// Cascade order is SECURITY-CRITICAL (10 §5.4):
//   (1) revoke all sessions for the user (deleting the user does NOT invalidate live tokens),
//   (2) soft/hard-delete user content honoring FK on delete cascade,
//   (3) PSEUDONYMIZE (never delete) legally-retained money rows (fund_contributions / event_tickets /
//       circle_memberships) — TODO(legal-gate): retention window needs counsel (10 §5 line 383),
//   (4) delete the auth.users row (cascades profiles), and purge any matching email_waitlist row.
// DEPLOY-DEFERRED + LEGAL-GATED: not deployed this slice; does NOT go live until the retention gate clears.
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  // Caller gate: service-role only. verify_jwt=true merely proves a valid project JWT
  // (every member has one) — assert the bearer IS the service-role key.
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || bearer !== serviceKey) return new Response('unauthorized', { status: 401 });

  const db = supabaseAdmin();

  const { data: reqs, error } = await db
    .from('gdpr_erasure_requests')
    .select('id, profile_id')
    .eq('status', 'requested')
    .limit(20);
  if (error) return new Response(error.message, { status: 500 });

  for (const erasureReq of reqs ?? []) {
    await db.from('gdpr_erasure_requests').update({ status: 'processing' }).eq('id', erasureReq.id);

    // (1) revoke sessions before deleting — deleting a user does not invalidate live tokens [SKILL].
    await db.auth.admin.signOut(erasureReq.profile_id, 'global').catch(() => undefined);

    // (3) TODO(legal-gate): pseudonymize Stripe-linked rows BEFORE deleting the user, so the
    //     on-delete-cascade does not remove legally-retained financial history. Detach profile_id to a
    //     tombstone / null per the retention policy. Confirm the exact FK behavior + retention window
    //     with counsel (10 §5 line 383, same gate as the fund PRD §13 Q1). Until then this fn stays
    //     undeployed — do NOT proceed to (4) without (3).
    //
    //     Tables to pseudonymize before (4):
    //       fund_contributions  — profile_id FK
    //       event_tickets       — profile_id FK
    //       circle_memberships  — profile_id FK
    //     Strategy (when legal gate clears): SET profile_id = '<tombstone-uuid>' WHERE profile_id = erasureReq.profile_id,
    //     so financial rows survive the auth.users cascade with a detached placeholder rather than being
    //     deleted. The tombstone profile row itself is a separate pre-seeded sentinel (no PII).

    // (2)+(4) DEPLOY-GATED: delete auth.users (cascades profiles + on-delete-cascade content), then
    //     purge waitlist by email. Left commented until the legal gate clears so a stray run can't hard-delete.
    //
    // Step (4a) — purge waitlist by the erased user's email (fetch from auth.users before deletion):
    // const { data: authUser } = await db.auth.admin.getUserById(erasureReq.profile_id);
    // if (authUser?.user?.email) {
    //   await db.from('email_waitlist').delete().eq('email', authUser.user.email);
    // }
    //
    // Step (4b) — delete auth.users row; cascades → profiles → all FK on-delete-cascade content:
    // await db.auth.admin.deleteUser(erasureReq.profile_id);

    await db.from('gdpr_erasure_requests').update({ status: 'failed' }).eq('id', erasureReq.id);
    // ^ stays 'failed' (not 'done') intentionally while legal-gated: the request is logged but the
    //   destructive cascade is NOT performed. Flip to the real cascade + status='done' at deploy-time
    //   once step (3) pseudonymization is implemented and counsel has confirmed the retention window.
  }

  return new Response(JSON.stringify({ seen: reqs?.length ?? 0 }), {
    headers: { 'content-type': 'application/json' },
  });
});
