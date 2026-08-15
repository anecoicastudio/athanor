import { z } from 'zod';
import { error, json } from '../_shared/respond.ts';

// The transitions themselves — the refusal ladders, the shortfall gate, the void writes,
// the confirmation stamp — are TWO SQL functions (public.enter_announcement and
// public.record_winner_decision, migration 20260815183252, pgTAP 0109): atomicity and
// authority are the database's job, not this layer's. What lives here: strict parse, the
// single rpc per op, refusal → status mapping, and the response. Transport shell in
// index.ts (requireServiceRole first); the db port is injected so this is unit-testable
// (repo convention: DI over mocks).

const payload = z.object({
  editionId: z.string().uuid(),
  op: z.enum(['enter', 'confirm', 'decline']),
});

/** The one row enter_announcement() returns: what happened and the figures it happened at. */
export type EntryRow = {
  outcome: 'announced' | 'voided_quorum' | 'voided_underfunded';
  pool_cents: number;
  voters: number;
};

export type AnnounceCycleDb = {
  /** supabaseAdmin().rpc — the only database calls this function makes. */
  rpc: ((
    fn: 'enter_announcement',
    args: { p_edition_id: string },
  ) => Promise<{ data: EntryRow[] | null; error: { code?: string; message: string } | null }>) &
    ((
      fn: 'record_winner_decision',
      args: { p_edition_id: string; p_decision: 'confirm' | 'decline' },
    ) => Promise<{ data: string | null; error: { code?: string; message: string } | null }>);
};

/**
 * The SQL refusals arrive as P0001 with a fixed message; each maps to a status here.
 * Anything outside this table is not a refusal — it is a failure (502).
 * 4xx split: 404 unknown row, 400 caller-shape errors the SQL re-checks behind zod,
 * 409 state conflicts a well-formed caller can hit.
 */
const REFUSALS: Record<string, number> = {
  'edition not found': 404,
  'announcement out of phase': 409, // enter: only from 'voting' — no re-entry, no re-snapshot
  'ballot not closed': 409, // enter: fail-closed on an undeclared window too
  'unknown decision': 400,
  'decision out of phase': 409, // confirm/decline: only during 'announcement'
  'no winner declared': 409, // confirm/decline: declare_winner has not run yet
  'viability already confirmed': 409, // the confirmation is the point of no return
};

export async function announceCycle(db: AnnounceCycleDb, req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error('invalid json', 400);
  }
  const parsed = payload.safeParse(body);
  if (!parsed.success) return error('invalid payload', 400);

  const { editionId, op } = parsed.data;

  if (op === 'enter') {
    const { data, error: dbErr } = await db.rpc('enter_announcement', {
      p_edition_id: editionId,
    });
    if (dbErr) {
      const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
      if (refusal) return error(dbErr.message, refusal);
      return error('announcement entry failed', 502);
    }
    const row = data?.[0];
    if (!row) return error('announcement entry returned no outcome', 502);
    // outcome 'announced' carries the snapshot; a void carries the figures it failed at.
    return json({ editionId, outcome: row.outcome, poolCents: row.pool_cents, voters: row.voters });
  }

  const { data, error: dbErr } = await db.rpc('record_winner_decision', {
    p_edition_id: editionId,
    p_decision: op,
  });
  if (dbErr) {
    const refusal = dbErr.code === 'P0001' ? REFUSALS[dbErr.message] : undefined;
    if (refusal) return error(dbErr.message, refusal);
    return error('winner decision failed', 502);
  }
  if (!data) return error('winner decision returned no outcome', 502);

  return json({ editionId, outcome: data });
}
