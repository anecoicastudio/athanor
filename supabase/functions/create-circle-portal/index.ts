import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { stripeClient } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createCirclePortal } from './logic.ts';

/**
 * POST {} → { url }. Creates a Stripe Billing Customer Portal session for the caller. Plan change, card
 * update, and cancellation happen ONLY in the portal; the resulting state lands via W6/W7 webhooks.
 * Auth: caller JWT → getUser() → profile_id → own circle_memberships.stripe_customer_id (RLS select-own),
 * or — no row yet (#759) — the Stripe Customer tagged with that profile_id (by auth email and tag).
 * Transport shell only — the membership gate + portal params live in ./logic.ts (unit-tested);
 * this file wires auth, env, and the Stripe capability closures.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  return createCirclePortal(
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
      listSubscriptions: async (customer) => {
        const out = [];
        for await (const s of stripeClient().subscriptions.list({ customer, limit: 100 })) {
          out.push(s);
        }
        return out;
      },
      createPortalSession: (params) => stripeClient().billingPortal.sessions.create(params),
      appBase: Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
    },
    { profileId: auth.user.id, email: auth.user.email ?? undefined },
  );
});
