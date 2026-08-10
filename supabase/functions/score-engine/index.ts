/**
 * score-engine — M6 Aura engine (service-role only).
 *
 * SOLE writer of: aura_events, aura_scores, stars.
 * Two modes:
 *   award — called per qualifying action (per-milestone triggers, wired at each originating slice).
 *   decay — called nightly by the cron (scheduled Supabase cron or external scheduler).
 *
 * Endpoint: POST /functions/v1/score-engine
 * Body (award): { mode: 'award', profileId: string, type: ScoringType, refId?: string, ctx?: AwardContext }
 * Body (decay): { mode: 'decay' }
 *
 * Transport shell only — the award/decay engine lives in ./logic.ts (unit-tested);
 * this file wires auth, body parse, the admin client, and the real clock.
 */

import { requireServiceRole } from '../_shared/auth.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { bodySchema, runAward, runDecay } from './logic.ts';

// Deploy-asset pins, kept as a belt-and-braces for the CLI upload walker: it only follows
// extension-suffixed imports. packages/core/src/score/* now carries explicit `.ts` on every
// relative import, because the deployed edge runtime does NOT honour this function's
// `unstable: ["sloppy-imports"]` — an extension-less specifier that resolves locally boots
// as a 503 BOOT_ERROR on the hosted project.
import '../../../packages/core/src/score/clamp.ts';
import '../../../packages/core/src/score/dampen.ts';
import '../../../packages/core/src/score/weighting.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Caller gate: service-role only (see _shared/auth.ts).
  const gate = requireServiceRole(req);
  if (!gate.ok) return gate.response;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return error('invalid json', 400);
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return error(`invalid body: ${parsed.error.message}`, 400);

  const ctx = { admin: supabaseAdmin(), now: () => new Date() };
  return parsed.data.mode === 'decay' ? runDecay(ctx) : runAward(ctx, parsed.data);
});
