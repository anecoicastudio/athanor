import { createClient } from 'npm:@supabase/supabase-js@2';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error, json } from '../_shared/respond.ts';

/**
 * POST { eventId } → { url }. Builds a Stripe Checkout Session priced from the EVENT ROW
 * (never client-supplied). The buyer's ticket is issued by the webhook (W1), not here.
 * Auth: the caller's JWT (verify_jwt=true) → getUser() derives profile_id; never trusted from the body.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  // Identify the caller from their JWT (anon-key client + the forwarded Authorization header).
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return error('unauthorized', 401);
  const profileId = userData.user.id;

  let eventId: string;
  try {
    ({ eventId } = await req.json());
  } catch {
    return error('invalid body', 400);
  }
  if (!eventId) return error('eventId required', 400);

  // Load the event server-side (RLS lets any member read a published event).
  const { data: event, error: evErr } = await userClient
    .from('events')
    .select('id,title,price_cents,currency,organizer_id,deleted_at')
    .eq('id', eventId)
    .is('deleted_at', null)
    .maybeSingle();
  if (evErr) return error('event lookup failed', 500);
  if (!event) return error('event not found', 404);
  if (!event.price_cents || event.price_cents <= 0) return error('event is free', 400);

  // TODO(M9): assert the organizer is identity_verified before selling tickets (08 §3.1).
  // The profiles.identity_verified column does not exist until M9 — gate deferred (see plan Deferred).
  // No Stripe Connect in MVP, so funds route to the platform account, not an unverified third party.

  const appBase = Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://';

  // Wrap the Stripe call: an API error must return a clean {error} (never leak Stripe's raw error
  // body / a 500 with internals). No DB write or charge has happened, so failing here is money-safe.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: event.currency, // lowercase ISO (e.g. 'eur'); Stripe accepts lowercase
            unit_amount: event.price_cents,
            product_data: { name: event.title },
          },
        },
      ],
      // Webhook routing (W1) keys on metadata.kind. profile_id is the verified caller, never the body.
      metadata: { kind: 'ticket', event_id: event.id, profile_id: profileId },
      success_url: `${appBase}event/${event.id}?checkout=success`,
      cancel_url: `${appBase}event/${event.id}?checkout=cancel`,
    });
    if (!session.url) return error('could not start checkout', 500);
    return json({ url: session.url });
  } catch {
    return error('could not start checkout', 500);
  }
});
