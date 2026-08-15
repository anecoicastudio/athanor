import { requireUser } from '../_shared/auth.ts';
import { requireSupportedVersion } from '../_shared/version-gate.ts';
import { stripe } from '../_shared/stripe.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { error } from '../_shared/respond.ts';
import { createPayoutOnboarding } from './logic.ts';

/**
 * POST {} → { url }. Creates or reuses the caller's Connect Express account (ruling #244:
 * Stripe carries KYC) and returns a fresh Account Link URL, opened with expo-web-browser like
 * Circle and Identity. The payout_accounts row is inserted here via the service-role client —
 * the one deliberate write: #245 grants clients no write path, and the capability flags are
 * maintained only by stripe-webhook's account.updated arm (rule #6). Identity-gated, NOT
 * winner-gated — onboarding moves no money; the winner gate binds at #247's transfer path.
 * Auth: caller JWT → getUser() derives profile_id (never trust the body).
 * return/refresh URLs come from env, not APP_DEEPLINK_BASE: Account Links reject non-HTTPS
 * URLs in live mode, so the athanor:// deep link the sibling functions use cannot work here.
 * Transport shell only — gates, create-or-reuse, race handling and link params live in
 * ./logic.ts (unit-tested); this file wires auth, env, and the Stripe capability closures.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return error('method not allowed', 405);

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const vg = await requireSupportedVersion(req, auth.userClient);
  if (!vg.ok) return vg.response;

  return createPayoutOnboarding(
    {
      userClient: auth.userClient,
      admin: supabaseAdmin(),
      createAccount: (params) => stripe.accounts.create(params),
      createAccountLink: (params) => stripe.accountLinks.create(params),
      deleteAccount: (id) => stripe.accounts.del(id),
      urls: {
        returnUrl: Deno.env.get('PAYOUT_ONBOARDING_RETURN_URL'),
        refreshUrl: Deno.env.get('PAYOUT_ONBOARDING_REFRESH_URL'),
      },
    },
    { profileId: auth.user.id, email: auth.user.email ?? undefined },
  );
});
