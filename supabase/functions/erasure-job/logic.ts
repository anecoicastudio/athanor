import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// Erasure loop extracted from index.ts so the status transitions are unit-testable
// (deno test): index.ts keeps the transport shell (requireServiceRole, client + auth
// port wiring) and injects everything here (repo convention: DI over mocks). Auth
// arrives as a capability port because the fake db has no .auth namespace. The port
// exposes ONLY signOut — getUserById/deleteUser join it when the legal-gated cascade
// below goes live.

export type ErasureAuth = {
  /** db.auth.admin.signOut — global revoke, MUST run before any delete (see step 1) */
  signOut: (profileId: string, scope: 'global') => Promise<unknown>;
};

export type ErasureCtx = {
  /** service role — owns the request status column (+ the gated cascade, when live) */
  db: SupabaseClient;
  auth: ErasureAuth;
};

export async function processErasureRequests(ctx: ErasureCtx): Promise<Response> {
  const { db, auth } = ctx;

  const { data: reqs, error } = await db
    .from('gdpr_erasure_requests')
    .select('id, profile_id')
    .eq('status', 'requested')
    .limit(20);
  if (error) return new Response(error.message, { status: 500 });

  for (const erasureReq of reqs ?? []) {
    await db.from('gdpr_erasure_requests').update({ status: 'processing' }).eq('id', erasureReq.id);

    // (1) revoke sessions before deleting — deleting a user does not invalidate live tokens [SKILL].
    await auth.signOut(erasureReq.profile_id, 'global').catch(() => undefined);

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
}
