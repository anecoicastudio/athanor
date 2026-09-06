import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { circlePriceIds, stripeClient } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { getCirclePrices } from './logic.ts';

/**
 * POST {} → { monthly: { unitAmount, currency }, annual: { … } }. Reads the two Circle Prices
 * behind STRIPE_PRICE_CIRCLE_MONTHLY/_ANNUAL (`circlePriceIds`, the one resolver both this and
 * create-circle-checkout read, #674) — the same ids create-circle-checkout charges —
 * so the app renders what Stripe bills instead of a catalog literal (#644, rule #6).
 * Reads only: no Customer is created, no membership is written, no Aura is touched.
 * Auth: caller JWT → requireUser(). Nothing here is caller-specific, but the amounts are the
 * commercial terms of a members-only product and the whole user-callable family gates alike.
 * Transport shell only — the price gates live in ./logic.ts (unit-tested); this file wires
 * auth, env, and the Stripe closure.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  return getCirclePrices({
    retrievePrice: (id) => stripeClient().prices.retrieve(id),
    priceIds: circlePriceIds(),
  });
});
