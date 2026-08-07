import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';

// Circle-checkout construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// body parse, env + singleton wiring) and injects everything here (repo convention:
// DI over mocks). Deliberately does NOT import ../_shared/stripe.ts — only type-level
// `npm:stripe` — so tests typecheck without STRIPE_SECRET_KEY in the env.

export type CirclePlan = 'monthly' | 'annual';

/** Pure plan-enum guard — anything else never reaches the price map. */
export function isCirclePlan(plan: unknown): plan is CirclePlan {
  return plan === 'monthly' || plan === 'annual';
}

export type CircleCheckoutCtx = {
  /** the caller's own client — circle_memberships is RLS select-own */
  userClient: SupabaseClient;
  /** stripe.customers.create — tagged with profile_id so webhooks can map back */
  createCustomer: (params: Stripe.CustomerCreateParams) => Promise<Stripe.Customer>;
  /** stripe.checkout.sessions.create */
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
  ) => Promise<Stripe.Checkout.Session>;
  /** Price IDs from secrets — amounts never hardcoded in logic (rule #6); undefined when unset */
  priceIds: { monthly?: string; annual?: string };
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
};

export type CircleCheckoutInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
  /** the caller's auth email, for the new-Customer branch */
  email?: string;
  /** raw plan from the body — validated here */
  plan: string;
};

/**
 * Pure params builder. line_items carries ONLY the pre-configured Price ID (no amounts);
 * metadata.kind routes the shared webhook (W11); subscription_data.metadata carries
 * profile_id onto every customer.subscription.* event (W5/W6/W7).
 */
export function buildCircleSessionParams(
  priceId: string,
  customerId: string,
  profileId: string,
  appBase: string,
): Stripe.Checkout.SessionCreateParams {
  return {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // metadata.kind routes the shared webhook (W11); subscription_data.metadata carries profile_id onto
    // every customer.subscription.* event (W5/W6/W7).
    metadata: { kind: 'subscription', profile_id: profileId },
    subscription_data: { metadata: { profile_id: profileId } },
    success_url: `${appBase}circle?checkout=success`,
    cancel_url: `${appBase}circle?checkout=cancel`,
  };
}

/**
 * Gates in order: plan enum → price configured. Reuses the caller's existing Stripe
 * Customer if a membership row already exists (RLS select-own), else creates one tagged
 * with profile_id. The membership row is written by the webhook (W5/W11), never here
 * (rule #6). Returns the { kind:'url' } indirection; { kind:'iap' } is M10 (S-IAP-1 OPEN).
 */
export async function createCircleCheckout(
  ctx: CircleCheckoutCtx,
  input: CircleCheckoutInput,
): Promise<Response> {
  const { userClient, createCustomer, createCheckoutSession, priceIds, appBase } = ctx;
  const { profileId, email, plan } = input;

  if (!isCirclePlan(plan)) return error('plan must be monthly or annual', 400);

  // Price IDs from secrets — amounts never hardcoded in logic (rule #6).
  const priceId = priceIds[plan];
  if (!priceId) return error('price not configured', 500);

  // Reuse the existing Stripe Customer if a membership row exists (RLS select-own); else create one.
  const { data: existing } = await userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', profileId)
    .maybeSingle();

  try {
    let customerId = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await createCustomer({
        email,
        metadata: { profile_id: profileId },
      });
      customerId = customer.id;
    }

    const session = await createCheckoutSession(
      buildCircleSessionParams(priceId, customerId, profileId, appBase),
    );
    if (!session.url) return error('could not start checkout', 500);
    return json({ kind: 'url', url: session.url });
  } catch {
    return error('could not start checkout', 500);
  }
}
