// close-cycle (#221) — internal service-role: closure and rollover (FUND-45/D33/D35).
// op 'close' calls public.close_cycle() — end an open cycle ('realized' or
// 'realization_failed', an admin act with evidence) and open its successor in the same
// transaction, carried_in = greatest(carried_in + raised − disbursed, 0). op 'rollover'
// calls public.rollover_voided() — the successor for a cycle the #220 voids already
// closed; the whole pool carries. Contributors are refunded in no branch. Each SQL
// function does its writes + the audit rows in one transaction and refuses before any
// write. Zero Aura (rule #1).
// Transport shell only — parse, rpc and refusal mapping live in ./logic.ts (unit-tested).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { closeCycle } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return closeCycle({ rpc: async (fn, args) => await db.rpc(fn, args) }, req);
});
