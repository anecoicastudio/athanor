import { createClient } from 'npm:@supabase/supabase-js@2';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error, json } from '../_shared/respond.ts';

/**
 * POST { plan: 'monthly'|'annual' } → { kind:'url', url }. Creates a Stripe Checkout Session in
 * subscription mode for the Circle Price. Reuses the caller's existing Stripe Customer if a membership
 * row already exists, else creates one tagged with profile_id. The membership row is written by the
 * webhook (W5/W11), never here (rule #6). Auth: caller JWT → getUser() derives profile_id.
 * Returns the { kind:'url' } indirection; the { kind:'iap' } branch is M10 (S-IAP-1 OPEN).
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return error('unauthorized', 401);
  const profileId = userData.user.id;

  let plan: string;
  try {
    ({ plan } = await req.json());
  } catch {
    return error('invalid body', 400);
  }
  if (plan !== 'monthly' && plan !== 'annual') return error('plan must be monthly or annual', 400);

  // Price IDs from secrets — amounts never hardcoded in logic (rule #6).
  const priceId =
    plan === 'monthly'
      ? Deno.env.get('STRIPE_PRICE_CIRCLE_MONTHLY')
      : Deno.env.get('STRIPE_PRICE_CIRCLE_ANNUAL');
  if (!priceId) return error('price not configured', 500);

  // Reuse the existing Stripe Customer if a membership row exists (RLS select-own); else create one.
  const { data: existing } = await userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  const appBase = Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://';

  try {
    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email ?? undefined,
        metadata: { profile_id: profileId },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // metadata.kind routes the shared webhook (W11); subscription_data.metadata carries profile_id onto
      // every customer.subscription.* event (W5/W6/W7).
      metadata: { kind: 'subscription', profile_id: profileId },
      subscription_data: { metadata: { profile_id: profileId } },
      success_url: `${appBase}circle?checkout=success`,
      cancel_url: `${appBase}circle?checkout=cancel`,
    });
    if (!session.url) return error('could not start checkout', 500);
    return json({ kind: 'url', url: session.url });
  } catch {
    return error('could not start checkout', 500);
  }
});
