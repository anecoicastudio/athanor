import { createClient } from 'npm:@supabase/supabase-js@2';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error, json } from '../_shared/respond.ts';

/**
 * POST {} → { url }. Creates a Stripe Identity VerificationSession server-side (Stripe keys never
 * on the client, rule #6) and returns the hosted URL. The verifications row + profiles.identity_verified
 * flip are written by the webhook (W9), never here (backend 06 §2.8 / 08 §3.5). No charge.
 * Auth: caller JWT → getUser() derives profile_id (never trust the body).
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

  const appBase = Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://';

  try {
    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { profile_id: profileId },
      return_url: `${appBase}verify?status=complete`,
    });
    if (!session.url) return error('could not start verification', 500);
    return json({ url: session.url });
  } catch {
    return error('could not start verification', 500);
  }
});
