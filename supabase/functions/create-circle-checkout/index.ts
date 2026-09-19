import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { circlePriceIds, stripeClient } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createCircleCheckout } from './logic.ts';

/**
 * POST { plan: 'monthly'|'annual' } → { kind:'url', url }. Creates a Stripe Checkout Session in
 * subscription mode for the Circle Price — read and gated first through the same
 * `servableAmount` the quote path uses, so nothing is charged that could not be quoted (#674).
 * The Customer is the one the membership row names, else the newest one Stripe holds tagged
 * with profile_id, else a new one. Refuses `409 circle already subscribed` when Stripe holds a
 * live subscription for any Customer the member holds, and keeps at most one open Circle
 * Session per Customer (#759). The membership row is written by the webhook (W5/W11), never
 * here (rule #6). Auth: caller JWT → getUser() derives profile_id. Returns the { kind:'url' }
 * indirection; the { kind:'iap' } branch is M10 (S-IAP-1 OPEN). Transport shell only — the
 * gates, the Customer lookup and session construction live in ./logic.ts (unit-tested); this
 * file wires auth, body parse, env, and the Stripe closures.
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
      listCustomersByEmail: async (email) => {
        const out = [];
        for await (const c of stripeClient().customers.list({ email, limit: 100 })) out.push(c);
        return out;
      },
      searchCustomersByTag: async (query) => {
        const out = [];
        for await (const c of stripeClient().customers.search({ query, limit: 100 })) out.push(c);
        return out;
      },
      createCustomer: (params, opts) => stripeClient().customers.create(params, opts),
      createCheckoutSession: (params, opts) =>
        stripeClient().checkout.sessions.create(params, opts),
      // Auto-paginate both listings: the guard must see EVERY live subscription and the sweep
      // EVERY open Session, not the first page. With no `status`, Stripe lists every
      // subscription that is not canceled.
      listSubscriptions: async (customer) => {
        const out = [];
        for await (const s of stripeClient().subscriptions.list({ customer, limit: 100 })) {
          out.push(s);
        }
        return out;
      },
      latestCheckoutSession: async (customer) =>
        (await stripeClient().checkout.sessions.list({ customer, limit: 1 })).data[0] ?? null,
      listOpenCheckoutSessions: async (customer) => {
        const out = [];
        for await (const s of stripeClient().checkout.sessions.list({
          customer,
          status: 'open',
          limit: 100,
        })) {
          out.push(s);
        }
        return out;
      },
      expireCheckoutSession: (id) => stripeClient().checkout.sessions.expire(id),
      retrievePrice: (id) => stripeClient().prices.retrieve(id),
      priceIds: circlePriceIds(),
      appBase: Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
      now: () => new Date(),
    },
    { profileId: auth.user.id, email: auth.user.email ?? undefined, plan },
  );
});
