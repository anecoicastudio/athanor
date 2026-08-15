import { z } from 'zod';
import { error, json } from '../_shared/respond.ts';

// The declaration itself — both writes, the refusals, the D7 tie order — is ONE SQL
// function (public.declare_winner, migration 20260815093035, pgTAP 0103): atomicity is
// the database's job, not this layer's. What lives here: strict parse, the single rpc,
// refusal → status mapping, and the response. Transport shell in index.ts
// (requireServiceRole first); the db port is injected so this is unit-testable
// (repo convention: DI over mocks).

const payload = z.object({
  editionId: z.string().uuid(),
});

/** One row of the ballot ordering declare_winner() returns — aggregates only (rule #3). */
export type TallyRow = {
  candidacy_id: string;
  vote_count: number;
  weighted_total: number;
  is_winner: boolean;
};

export type DeclareWinnerDb = {
  /** supabaseAdmin().rpc — the only database call this function makes. */
  rpc: (
    fn: 'declare_winner',
    args: { p_edition_id: string },
  ) => Promise<{ data: TallyRow[] | null; error: { code?: string; message: string } | null }>;
};

/**
 * declare_winner()'s refusals arrive as P0001 with a fixed message; each maps to a
 * status here. Anything outside this table is not a refusal — it is a failure (502).
 */
const REFUSALS: Record<string, number> = {
  'edition not found': 404,
  'winner already declared': 409,
  'declaration out of phase': 409,
  'ballot not closed': 409,
  'quorum not met': 409, // FUND-43: below min_voters
  'funding floor not met': 409, // FUND-42: below min_funding_cents
  'no votable candidacy': 409,
};

export async function declareWinner(db: DeclareWinnerDb, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);

  const { data, error: dbErr } = await db.rpc('declare_winner', {
    p_edition_id: parsed.data.editionId,
  });
  if (dbErr) {
    const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
    if (refusal) return error(dbErr.message, refusal);
    return error('declaration failed', 502);
  }

  const results = data ?? [];
  const winner = results.find((r) => r.is_winner);
  if (!winner) return error('declaration returned no winner', 502);

  // FUND-38/D9: the full ballot ordering rides the response — «risultati» publish from it.
  return json({ winnerCandidacyId: winner.candidacy_id, results });
}
