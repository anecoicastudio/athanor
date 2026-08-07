import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createTicketCheckout } from './logic.ts';

/**
 * POST { eventId } → { url }. Builds a Stripe Checkout Session priced from the EVENT ROW
 * (never client-supplied). The buyer's ticket is issued by the webhook (W1), not here.
 * Auth: the caller's JWT (verify_jwt=true) → getUser() derives profile_id; never trusted from the body.
 * Transport shell only — the guard ladder + session construction live in ./logic.ts (unit-tested);
 * this file wires auth, body parse, env, and the Stripe capability closure.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  // Identify the caller from their JWT (anon-key client + the forwarded Authorization header).
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  let eventId: string;
  try {
    ({ eventId } = await req.json());
  } catch {
    return error('invalid body', 400);
  }
  if (!eventId) return error('eventId required', 400);

  return createTicketCheckout(
    {
      userClient: auth.userClient,
      createCheckoutSession: (params) => stripe.checkout.sessions.create(params),
      appBase: Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
    },
    { profileId: auth.user.id, eventId },
  );
});
