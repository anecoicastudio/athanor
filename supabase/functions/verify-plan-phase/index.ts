// verify-plan-phase (#231) — internal service-role: the ONE path that writes
// realization_plan_phases.verified_at (FUND-53). Calls public.verify_plan_phase(), which
// stamps the phase and writes the 'verify_phase' audit row in one transaction and refuses
// (4xx, no write) on an unpublished plan, a cycle outside realization, an already-verified
// phase or missing evidence. The gate it feeds is release-fund-payout's: no verification,
// no money. Never client-callable — a winner who could verify their own phase would hold
// the gate on their own money.
// Transport shell only — parse, rpc and refusal mapping live in ./logic.ts (unit-tested).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { verifyPlanPhase } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return verifyPlanPhase({ rpc: async (fn, args) => await db.rpc(fn, args) }, req);
});
