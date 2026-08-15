// announce-cycle (#220) — internal service-role: the announcement transitions (FUND-42/44).
// op 'enter' calls public.enter_announcement() — snapshot the pool into confirmed_pool_cents,
// or void the cycle (voided_quorum / voided_underfunded) when the two-part shortfall gate
// fails; op 'confirm' / 'decline' call public.record_winner_decision() — the winner's
// viability decision at the snapshotted figure, operator-relayed per D41's cycle-1 runbook.
// Each SQL function does its writes + the audit row in one transaction and refuses before
// any write. Zero Aura (rule #1).
// Transport shell only — parse, rpc and refusal mapping live in ./logic.ts (unit-tested).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { announceCycle } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return announceCycle({ rpc: async (fn, args) => await db.rpc(fn, args) }, req);
});
