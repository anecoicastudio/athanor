import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createContributionSession } from './logic.ts';

/**
 * POST { editionId, amountCents } → { url }. Creates a Stripe Checkout Session for a Dream-Fund
 * contribution. The amount is validated server-side (≥ €1, no max) and the legal flag is re-asserted —
 * the app never sends an amount Stripe trusts blindly (rule #6). The contribution row + aggregate are
 * written by the webhook (W3), never here. Auth: caller JWT → getUser() derives profile_id.
 * Transport shell only — the floor + gates + session construction live in ./logic.ts (unit-tested);
 * this file wires auth, body parse, env, and the Stripe capability closure.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  let editionId: string;
  let amountCents: number;
  try {
    ({ editionId, amountCents } = await req.json());
  } catch {
    return error('invalid body', 400);
  }
  if (!editionId) return error('editionId required', 400);

  return createContributionSession(
    {
      userClient: auth.userClient,
      createCheckoutSession: (params) => stripe.checkout.sessions.create(params),
      appBase: Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
    },
    { profileId: auth.user.id, editionId, amountCents },
  );
});
