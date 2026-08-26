import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { stripeClient } from '../_shared/stripe.ts';
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
      createVerificationSession: (params) =>
        stripeClient().identity.verificationSessions.create(params),
      // IDENTITY_RETURN_BASE, not APP_DEEPLINK_BASE, and its own var rather than a repoint of
      // the shared one: Identity needs an https base (logic.ts), while create-circle-checkout,
      // create-circle-portal, create-contribution-session and create-ticket-checkout all read
      // APP_DEEPLINK_BASE to build success/cancel URLs that MUST stay `athanor://` — that is
      // the redirect openAuthSessionAsync matches on to close the sheet. Widening the shared
      // var to https would restore this redirect by breaking those four.
      // Unset is the safe state: stripeReturnUrl then omits return_url entirely, which is
      // exactly the behaviour #417 shipped. Points at apps/web `/app/verify` (#418).
      appBase:
        Deno.env.get('IDENTITY_RETURN_BASE') ?? Deno.env.get('APP_DEEPLINK_BASE') ?? 'athanor://',
    },
    { profileId: auth.user.id },
  );
});
