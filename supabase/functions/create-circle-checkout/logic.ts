import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CirclePlan } from '@athanor/schemas';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';
import { logPriceRefusal, servableAmount, type PriceRefusalSink } from '../_shared/circle-price.ts';
import type { CirclePriceIds } from '../_shared/stripe.ts';

// Circle-checkout construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// body parse, env + singleton wiring) and injects everything here (repo convention:
// DI over mocks). Deliberately does NOT import ../_shared/stripe.ts — only type-level
// `npm:stripe`: the Stripe capabilities arrive injected. #541 made that module lazy, so the
// import would no longer demand STRIPE_SECRET_KEY in a test env; the boundary stays because
// DI is the point.

export type { CirclePlan };

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
  /**
   * stripe.prices.retrieve — the Price is read and gated BEFORE a session is built on it
   * (#674 item 7), so Checkout refuses exactly what the quote path refuses.
   */
  retrievePrice: (id: string) => Promise<Stripe.Price>;
  /** Price IDs from secrets, via `circlePriceIds()` — amounts never hardcoded in logic (rule #6) */
  priceIds: CirclePriceIds;
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
  /** Where a refused gate is logged; production leaves the default (function logs). */
  refusalSink?: PriceRefusalSink;
};

const FN = 'create-circle-checkout';

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
 * Gates in order: plan enum → price configured → Price servable (`servableAmount`, the same
 * gate get-circle-prices quotes through). Reuses the caller's existing Stripe Customer if a
 * membership row already exists (RLS select-own), else creates one tagged with profile_id.
 * The membership row is written by the webhook (W5/W11), never here (rule #6). Returns the
 * { kind:'url' } indirection; { kind:'iap' } is M10 (S-IAP-1 OPEN).
 *
 * The Price gate puts one Stripe read in front of `sessions.create`, so a Stripe read outage
 * now blocks subscribing where it used to block only the quote. That is the trade, chosen
 * deliberately for the money path (#674 item 7): a checkout that cannot verify what it is
 * about to charge must not charge it — the opposite of `version-gate.ts`, whose courtesy
 * check fails open because it protects nothing that money depends on.
 */
export async function createCircleCheckout(
  ctx: CircleCheckoutCtx,
  input: CircleCheckoutInput,
): Promise<Response> {
  const {
    userClient,
    createCustomer,
    createCheckoutSession,
    retrievePrice,
    priceIds,
    appBase,
    refusalSink,
  } = ctx;
  const { profileId, email, plan } = input;

  if (!isCirclePlan(plan)) return error('plan must be monthly or annual', 400);

  // Price IDs from secrets — amounts never hardcoded in logic (rule #6).
  const priceId = priceIds[plan];
  if (!priceId) {
    logPriceRefusal({ fn: FN, plan, reason: 'unset' }, refusalSink);
    return error('price not configured', 500);
  }

  // The Price must be one this plan can bill on — active, recurring on the plan's own
  // interval, once per period, with a unit amount. Refused here it is refused before any
  // Customer exists and before Stripe is asked to build a session on it.
  let price: Stripe.Price;
  try {
    price = await retrievePrice(priceId);
  } catch (e) {
    logStripeFailure(`${FN}: prices.retrieve`, e);
    return error('could not start checkout', 500);
  }
  const servable = servableAmount(plan, price);
  if (!servable.ok) {
    logPriceRefusal({ fn: FN, plan, reason: servable.reason, priceId }, refusalSink);
    return error('price not configured', 500);
  }

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
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('create-circle-checkout: customers.create|checkout.sessions.create', e);
    return error('could not start checkout', 500);
  }
}
