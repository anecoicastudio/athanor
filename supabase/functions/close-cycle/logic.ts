import { z } from 'zod';
import { error, json } from '../_shared/respond.ts';

// The transitions themselves — the refusal ladders, the carry arithmetic, the successor
// creation — are TWO SQL functions (public.close_cycle and public.rollover_voided,
// migrations 20260815193158 + 20260815215924, pgTAP 0110): atomicity and authority are the database's job,
// not this layer's. What lives here: strict parse (the op-specific shape included, so a
// malformed call dies 400 before any rpc), the single rpc per op, refusal → status
// mapping, and the response. Transport shell in index.ts (requireServiceRole first); the
// db port is injected so this is unit-testable (repo convention: DI over mocks).

/** The successor's operator-declared shape: FUND-SPEC §5's deferred minimums + #232's
 * declared economics — none of them has a default, someone must choose them here. */
const successor = z.object({
  targetAt: z.string().datetime({ offset: true }),
  goalCents: z.number().int().positive(),
  minFundingCents: z.number().int().nonnegative(),
  minVoters: z.number().int().positive(),
  minCandidacies: z.number().int().positive(),
  splitPct: z.number().int().min(0).max(100),
  costFeeStatement: z.string().trim().min(1),
  equityDeclared: z.string().trim().min(1),
});

// op-discriminated: 'close' carries the declared outcome + evidence; 'rollover' carries
// only the successor. No released amount travels here since #247 — on the D33 failure the
// SQL reads disbursed from fund_payout_ledger (released-net), never from the caller: the
// figure must not live in two places. The SQL re-checks the rest behind this parse.
// Strict members: a caller still sending the pre-#247 releasedCents (or any unknown key)
// dies 400 instead of having the figure silently stripped and ignored — the operator must
// learn the parameter is gone, not believe it was honoured.
const payload = z.discriminatedUnion('op', [
  z
    .object({
      editionId: z.string().uuid(),
      op: z.literal('close'),
      outcome: z.enum(['realized', 'realization_failed']),
      evidence: z.string().trim().min(1),
      successor,
    })
    .strict(),
  z
    .object({
      editionId: z.string().uuid(),
      op: z.literal('rollover'),
      successor,
    })
    .strict(),
]);

/** The one row close_cycle() returns: the successor and what the closure carried. */
export type CloseRow = {
  successor_id: string;
  closure_reason: 'realized' | 'realization_failed';
  carried_in_cents: number;
};

/** The one row rollover_voided() returns. */
export type RolloverRow = {
  successor_id: string;
  carried_in_cents: number;
};

type SuccessorArgs = {
  p_target_at: string;
  p_goal_cents: number;
  p_min_funding_cents: number;
  p_min_voters: number;
  p_min_candidacies: number;
  p_split_pct: number;
  p_cost_fee_statement: string;
  p_equity_declared: string;
};

export type CloseCycleDb = {
  /** supabaseAdmin().rpc — the only database calls this function makes. */
  rpc: ((
    fn: 'close_cycle',
    args: {
      p_edition_id: string;
      p_outcome: 'realized' | 'realization_failed';
      p_evidence: string;
    } & SuccessorArgs,
  ) => Promise<{ data: CloseRow[] | null; error: { code?: string; message: string } | null }>) &
    ((
      fn: 'rollover_voided',
      args: { p_edition_id: string } & SuccessorArgs,
    ) => Promise<{ data: RolloverRow[] | null; error: { code?: string; message: string } | null }>);
};

/**
 * The SQL refusals arrive as P0001 with a fixed message; each maps to a status here.
 * Anything outside this table is not a refusal — it is a failure (502).
 * 4xx split: 404 unknown row, 400 caller-shape errors the SQL re-checks behind zod,
 * 409 state conflicts a well-formed caller can hit.
 */
const REFUSALS: Record<string, number> = {
  'edition not found': 404,
  'unknown outcome': 400,
  'closure out of phase': 409, // close: only from 'announcement'/'realization'
  'no winner declared': 409, // close: declare_winner has not run
  'viability not confirmed': 409, // close: nothing to realize or to fail without the confirmation
  'evidence required': 400,
  'cycle not closed': 409, // rollover: the predecessor must be at its end-state
  'predecessor not voided': 409, // rollover: realized/failed cycles rolled over inside close_cycle
  'already rolled over': 409, // rollover: one successor per predecessor
  'another cycle is open': 409, // rollover: fund_editions_one_active would refuse anyway
};

export async function closeCycle(db: CloseCycleDb, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);

  const p = parsed.data;
  const successorArgs: SuccessorArgs = {
    p_target_at: p.successor.targetAt,
    p_goal_cents: p.successor.goalCents,
    p_min_funding_cents: p.successor.minFundingCents,
    p_min_voters: p.successor.minVoters,
    p_min_candidacies: p.successor.minCandidacies,
    p_split_pct: p.successor.splitPct,
    p_cost_fee_statement: p.successor.costFeeStatement,
    p_equity_declared: p.successor.equityDeclared,
  };

  if (p.op === 'close') {
    const { data, error: dbErr } = await db.rpc('close_cycle', {
      p_edition_id: p.editionId,
      p_outcome: p.outcome,
      p_evidence: p.evidence,
      ...successorArgs,
    });
    if (dbErr) {
      const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
      if (refusal) return error(dbErr.message, refusal);
      return error('closure failed', 502);
    }
    const row = data?.[0];
    if (!row) return error('closure returned no outcome', 502);
    return json({
      editionId: p.editionId,
      outcome: row.closure_reason,
      successorId: row.successor_id,
      carriedInCents: row.carried_in_cents,
    });
  }

  const { data, error: dbErr } = await db.rpc('rollover_voided', {
    p_edition_id: p.editionId,
    ...successorArgs,
  });
  if (dbErr) {
    const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
    if (refusal) return error(dbErr.message, refusal);
    return error('rollover failed', 502);
  }
  const row = data?.[0];
  if (!row) return error('rollover returned no outcome', 502);
  return json({
    editionId: p.editionId,
    successorId: row.successor_id,
    carriedInCents: row.carried_in_cents,
  });
}
