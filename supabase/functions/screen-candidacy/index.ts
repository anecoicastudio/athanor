// screen-candidacy (#218) — internal service-role: the ONE path that moves a candidacy
// through screening (FUND-52; D4/D5/D6). Calls public.screen_candidacy(), which does the
// status write + the audit row in one transaction and refuses — before any write — out of
// phase, once the ballot opens, on an invalid transition, and on a rejection without
// reasons drawn from the published criteria. Zero Aura (rule #1).
// Transport shell only — parse, rpc and refusal mapping live in ./logic.ts (unit-tested).
import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { screenCandidacy } from './logic.ts';

Deno.serve((req) => {
  // Caller gate: service-role only, first statement (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  const db = supabaseAdmin();

  return screenCandidacy({ rpc: async (fn, args) => await db.rpc(fn, args) }, req);
});
