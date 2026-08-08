import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { stripe } from '../_shared/stripe.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createVerificationSession } from './logic.ts';

/**
 * POST {} → { url }. Creates a Stripe Identity VerificationSession server-side (Stripe keys never
 * on the client, rule #6) and returns the hosted URL. The verifications row + profiles.identity_verified
 * flip are written by the webhook (W9), never here (backend 06 §2.8 / 08 §3.5). No charge.
 * Auth: caller JWT → getUser() derives profile_id (never trust the body).
 * Transport shell only — the session params + failure shapes live in ./logic.ts (unit-tested);
 * this file wires auth, env, and the Stripe capability closure.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  return createVerificationSession(
    {
      createVerificationSession: (params) => stripe.identity.verificationSessions.create(params),
      appBase: Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
    },
    { profileId: auth.user.id },
  );
});
