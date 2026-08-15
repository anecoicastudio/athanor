import { z } from 'zod';
import { error, json } from '../_shared/respond.ts';

// The transition itself — the refusal ladder, the D4 ballot-open freeze, the D5 pass
// re-checks, the D6 reason validation — is ONE SQL function (public.screen_candidacy,
// migration 20260815164809, pgTAP 0107): atomicity and authority are the database's job,
// not this layer's. What lives here: strict parse, the single rpc, refusal → status
// mapping, and the response. Transport shell in index.ts (requireServiceRole first); the
// db port is injected so this is unit-testable (repo convention: DI over mocks).

const payload = z
  .object({
    candidacyId: z.string().uuid(),
    decision: z.enum(['start', 'pass', 'reject', 'reopen']),
    reasons: z.array(z.string().min(1)).min(1).optional(),
  })
  // Mirror of the SQL ladder's shape refusals, so a malformed call dies at the edge
  // without a db round-trip; the SQL re-checks both regardless.
  .refine((v) => v.decision !== 'reject' || v.reasons !== undefined, {
    message: 'reject requires reasons',
    path: ['reasons'],
  })
  .refine((v) => v.decision === 'reject' || v.reasons === undefined, {
    message: 'reasons only on rejection',
    path: ['reasons'],
  });

export type ScreenCandidacyDb = {
  /** supabaseAdmin().rpc — the only database call this function makes. */
  rpc: (
    fn: 'screen_candidacy',
    args: { p_candidacy_id: string; p_decision: string; p_reasons?: string[] },
  ) => Promise<{ data: string | null; error: { code?: string; message: string } | null }>;
};

/**
 * screen_candidacy()'s refusals arrive as P0001 with a fixed message; each maps to a
 * status here. Anything outside this table is not a refusal — it is a failure (502).
 * 4xx split: 404 unknown row, 400 caller-shape errors the SQL re-checks behind zod,
 * 409 state conflicts a well-formed caller can hit.
 */
const REFUSALS: Record<string, number> = {
  'candidacy not found': 404,
  'screening out of phase': 409, // D4: the field is fixed from 'voting' on
  'ballot already open': 409, // D4: a passed voting_starts_at freezes screening
  'unknown decision': 400,
  'reasons only on rejection': 400,
  'rejection requires reasons': 400,
  'unknown criterion': 400, // D6: reasons come from screening_criteria only
  'invalid transition': 409,
  'identity not verified': 409, // D5 pass re-check
  'moderation sanction active': 409, // D5 pass re-check
};

export async function screenCandidacy(db: ScreenCandidacyDb, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);

  const { candidacyId, decision, reasons } = parsed.data;
  const { data, error: dbErr } = await db.rpc('screen_candidacy', {
    p_candidacy_id: candidacyId,
    p_decision: decision,
    ...(reasons === undefined ? {} : { p_reasons: reasons }),
  });
  if (dbErr) {
    const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
    if (refusal) return error(dbErr.message, refusal);
    return error('screening failed', 502);
  }
  if (!data) return error('screening returned no status', 502);

  return json({ candidacyId, status: data });
}
