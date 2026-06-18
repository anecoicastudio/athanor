import { createClient } from 'npm:@supabase/supabase-js@2';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error, json } from '../_shared/respond.ts';

/**
 * POST { editionId, amountCents } → { url }. Creates a Stripe Checkout Session for a Dream-Fund
 * contribution. The amount is validated server-side (≥ €1, no max) and the legal flag is re-asserted —
 * the app never sends an amount Stripe trusts blindly (rule #6). The contribution row + aggregate are
 * written by the webhook (W3), never here. Auth: caller JWT → getUser() derives profile_id.
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

  let editionId: string;
  let amountCents: number;
  try {
    ({ editionId, amountCents } = await req.json());
  } catch {
    return error('invalid body', 400);
  }
  if (!editionId) return error('editionId required', 400);
  // Server-side floor (rule #10 / PRD §4.11): never trust the client amount; ≥ €1, no max.
  if (!Number.isInteger(amountCents) || amountCents < 100)
    return error('amount must be at least €1', 400);

  // Load the edition (public read) and re-assert the legal flag — the app shouldn't have called when off.
  const { data: edition, error: edErr } = await userClient
    .from('fund_editions')
    .select('id,contributions_enabled,phase')
    .eq('id', editionId)
    .maybeSingle();
  if (edErr) return error('edition lookup failed', 500);
  if (!edition) return error('edition not found', 404);
  if (!edition.contributions_enabled) return error('contributions are not open', 403);

  const appBase = Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://';

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: amountCents, // minor units, server-validated
            product_data: { name: 'Dai Vita al Tuo Sogno — contributo' },
          },
        },
      ],
      // Webhook routing (W3) keys on metadata.kind. profile_id is the verified caller, never the body.
      metadata: { kind: 'contribution', edition_id: edition.id, profile_id: profileId },
      success_url: `${appBase}annual?contrib=success`,
      cancel_url: `${appBase}annual?contrib=cancel`,
    });
    if (!session.url) return error('could not start checkout', 500);
    return json({ url: session.url });
  } catch {
    return error('could not start checkout', 500);
  }
});
