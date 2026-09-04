import { z } from 'zod';
import { error, json } from '../_shared/respond.ts';

// The verification-recording path (#231, FUND-53). The transition itself — the refusal
// ladder, the verified_at stamp and the audit row — is ONE SQL function
// (public.verify_plan_phase, migration 20260816110227, pgTAP 0117): atomicity is the
// database's job, not this layer's. What lives here: strict parse, the single rpc,
// refusal → status mapping, and the response. Transport shell in index.ts
// (requireServiceRole first); the db port is injected so this is unit-testable
// (repo convention: DI over mocks).
//
// WHY THIS IS AN OPERATOR PATH AND NOT A MEMBER ONE (RELEASE-RUNBOOK §9.2c): recording that
// a phase met its criteria is the act that unlocks that phase's tranche. A winner who could
// take it would hold the gate on their own money — so verified_at is granted to no client
// (20260816082552:80-83) and this function is service-role only, the D41 pattern every fund
// transition follows: edge function first, admin panel later.

const payload = z
  .object({
    planPhaseId: z.string().uuid(),
    // The admin act carries its evidence — what was delivered and where it can be seen.
    // Bounded to match the SQL function's own refusal rather than letting a 1001-character
    // string travel to the database only to come back as 'evidence too long'.
    evidence: z.string().trim().min(1).max(1000),
  })
  .strict();

export type VerifyPlanPhaseDb = {
  /** supabaseAdmin().rpc — the only database call this function makes. */
  rpc: (
    fn: 'verify_plan_phase',
    args: { p_phase_id: string; p_evidence: string },
  ) => Promise<{ data: string | null; error: { code?: string; message: string } | null }>;
};

/**
 * verify_plan_phase()'s refusals arrive as P0001 with a fixed message; each maps to a
 * status here. Anything outside this table is not a refusal — it is a failure (502).
 */
const REFUSALS: Record<string, number> = {
  'plan phase not found': 404,
  'plan not found': 404,
  'edition not found': 404,
  'plan not published': 409,
  'verification out of phase': 409,
  'phase already verified': 409,
  'evidence required': 400,
  'evidence too long': 400,
};

export async function verifyPlanPhase(db: VerifyPlanPhaseDb, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);

  const { data, error: dbErr } = await db.rpc('verify_plan_phase', {
    p_phase_id: parsed.data.planPhaseId,
    p_evidence: parsed.data.evidence,
  });
  if (dbErr) {
    const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
    if (refusal) return error(dbErr.message, refusal);
    return error('verification failed', 502);
  }
  if (!data) return error('verification returned no timestamp', 502);

  // The stamp is echoed because it is the fact that matters: from this moment
  // release-fund-payout will admit a tranche against this phase and not before.
  return json({ planPhaseId: parsed.data.planPhaseId, verifiedAt: data });
}
