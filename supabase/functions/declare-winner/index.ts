// declare-winner (#219) — internal service-role: the ONE path that writes a cycle's winner
// (FUND-16/D9). Calls public.declare_winner(), which does both writes + the audit row in one
// transaction and refuses below min_voters (FUND-43) or min_funding_cents (FUND-42) without
// touching either column. Quorum gates HERE, deliberately not in cast_vote (#217).
// Transport shell only — parse, rpc and refusal mapping live in ./logic.ts (unit-tested).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { declareWinner } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return declareWinner({ rpc: async (fn, args) => await db.rpc(fn, args) }, req);
});
