import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { circlePriceIds, stripeClient } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createCircleCheckout } from './logic.ts';

/**
 * POST { plan: 'monthly'|'annual' } → { kind:'url', url }. Creates a Stripe Checkout Session in
 * subscription mode for the Circle Price — read and gated first through the same
 * `servableAmount` the quote path uses, so nothing is charged that could not be quoted (#674). Reuses the caller's existing Stripe Customer if a membership
 * row already exists, else creates one tagged with profile_id. The membership row is written by the
 * webhook (W5/W11), never here (rule #6). Auth: caller JWT → getUser() derives profile_id.
 * Returns the { kind:'url' } indirection; the { kind:'iap' } branch is M10 (S-IAP-1 OPEN).
 * Transport shell only — plan/price gates + customer reuse + session construction live in
 * ./logic.ts (unit-tested); this file wires auth, body parse, env, and the Stripe closures.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  let plan: string;
  try {
    ({ plan } = await req.json());
  } catch {
    return error('invalid body', 400);
  }

  return createCircleCheckout(
    {
      userClient: auth.userClient,
      createCustomer: (params) => stripeClient().customers.create(params),
      createCheckoutSession: (params) => stripeClient().checkout.sessions.create(params),
      retrievePrice: (id) => stripeClient().prices.retrieve(id),
      priceIds: circlePriceIds(),
      appBase: Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
    },
    { profileId: auth.user.id, email: auth.user.email ?? undefined, plan },
  );
});
