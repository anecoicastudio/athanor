import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
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
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  const { userClient } = auth;
  const profileId = auth.user.id;

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

  // P2.4 — organizer must be identity_verified before selling tickets (08 §3.1).
  // is_identity_verified is the DEFINER helper from m7_candidacy (reads the column without
  // exposing it cross-RLS); fail-closed on lookup error — never sell for an unverifiable organizer.
  const { data: organizerVerified, error: verErr } = await userClient.rpc('is_identity_verified', {
    uid: event.organizer_id,
  });
  if (verErr) return error('organizer verification lookup failed', 500);
  if (!organizerVerified) return error('organizer not verified', 403);

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
