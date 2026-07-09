import { requireUser } from '../_shared/auth.ts';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error, json } from '../_shared/respond.ts';

/**
 * POST {} → { url }. Creates a Stripe Billing Customer Portal session for the caller. Plan change, card
 * update, and cancellation happen ONLY in the portal; the resulting state lands via W6/W7 webhooks.
 * Auth: caller JWT → getUser() → profile_id → own circle_memberships.stripe_customer_id (RLS select-own).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const { data: membership, error: mErr } = await auth.userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', auth.user.id)
    .maybeSingle();
  if (mErr) return error('membership lookup failed', 500);
  if (!membership?.stripe_customer_id) return error('no membership', 404);

  const appBase = Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://';

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: membership.stripe_customer_id,
      return_url: `${appBase}circle?portal=return`,
    });
    return json({ url: session.url });
  } catch {
    return error('could not open portal', 500);
  }
});
