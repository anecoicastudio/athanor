import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

// Portal-session construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// env + singleton wiring) and injects everything here (repo convention: DI over mocks).
// Deliberately does NOT import ../_shared/stripe.ts — only type-level `npm:stripe` —
// so tests typecheck without STRIPE_SECRET_KEY in the env.

export type CirclePortalCtx = {
  /** the caller's own client — circle_memberships is RLS select-own */
  userClient: SupabaseClient;
  /** stripe.billingPortal.sessions.create — the only outbound Stripe call */
  createPortalSession: (
    params: Stripe.BillingPortal.SessionCreateParams,
  ) => Promise<Stripe.BillingPortal.Session>;
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
};

export type CirclePortalInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
};

/** Pure params builder — the portal returns to the circle tab deeplink. */
export function buildPortalSessionParams(
  customerId: string,
  appBase: string,
): Stripe.BillingPortal.SessionCreateParams {
  return {
    customer: customerId,
    return_url: `${appBase}circle?portal=return`,
  };
}

/**
 * Reads the caller's own membership (RLS select-own) → 404 without one. Plan change, card
 * update, and cancellation happen ONLY in the portal; the resulting state lands via W6/W7.
 */
export async function createCirclePortal(
  ctx: CirclePortalCtx,
  input: CirclePortalInput,
): Promise<Response> {
  const { userClient, createPortalSession, appBase } = ctx;

  const { data: membership, error: mErr } = await userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', input.profileId)
    .maybeSingle();
  if (mErr) return error('membership lookup failed', 500);
  if (!membership?.stripe_customer_id) return error('no membership', 404);

  try {
    const session = await createPortalSession(
      buildPortalSessionParams(membership.stripe_customer_id, appBase),
    );
    return json({ url: session.url });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('create-circle-portal: billingPortal.sessions.create', e);
    return error('could not open portal', 500);
  }
}
