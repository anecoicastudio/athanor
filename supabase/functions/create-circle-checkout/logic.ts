import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { CirclePlan } from '@athanor/schemas';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure, type StripeFailureSink } from '../_shared/stripe-error.ts';
import {
  consoleRefusalSink,
  logPriceRefusal,
  servableAmount,
  type PriceRefusalSink,
} from '../_shared/circle-price.ts';
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
  /**
   * stripe.customers.create — tagged with profile_id so webhooks can map back. Keyed
   * (`customerIdempotencyKey`) so a retry before the first webhook lands gets the same Customer.
   */
  createCustomer: (
    params: Stripe.CustomerCreateParams,
    opts: { idempotencyKey: string },
  ) => Promise<Stripe.Customer>;
  /** stripe.checkout.sessions.create, keyed by `sessionIdempotencyKey` (#759) */
  createCheckoutSession: (
    params: Stripe.Checkout.SessionCreateParams,
    opts: { idempotencyKey: string },
  ) => Promise<Stripe.Checkout.Session>;
  /**
   * stripe.subscriptions.list — EVERY non-canceled subscription the Customer holds (index.ts
   * auto-paginates). Stripe, not the cached row, decides whether one is live (rule #6, #759).
   */
  listSubscriptions: (customerId: string) => Promise<Stripe.Subscription[]>;
  /** stripe.checkout.sessions.list, limit 1 — the Customer's newest Session, any status */
  latestCheckoutSession: (customerId: string) => Promise<Stripe.Checkout.Session | null>;
  /** stripe.checkout.sessions.list, status open — EVERY one (index.ts auto-paginates) */
  listOpenCheckoutSessions: (customerId: string) => Promise<Stripe.Checkout.Session[]>;
  /** stripe.checkout.sessions.expire */
  expireCheckoutSession: (id: string) => Promise<Stripe.Checkout.Session>;
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
  /** Where a failed Stripe call is logged, named by the step that failed; production leaves the default. */
  stripeFailureSink?: StripeFailureSink;
};

const FN = 'create-circle-checkout';

/**
 * The remote_config row that opens Circle checkout (#747) — the same key the app's
 * `useCircleCheckoutGate` reads. Absent on production until the Stripe cutover
 * (RELEASE-RUNBOOK §4.2 step 7).
 */
export const CIRCLE_CHECKOUT_FLAG = 'circle_checkout_enabled';

/**
 * Whether checkout is open: `true` only on a clean read of `{"enabled": true}`. FAILS CLOSED on
 * every doubt — absent row, malformed value, read error — the deliberate opposite of
 * `version-gate.ts`, which fails open because it guards nothing money depends on. This one
 * guards a Checkout that may point at test-mode keys.
 *
 * Read through the CALLER's client: `remote_config` is SELECT-granted to `authenticated` with a
 * public-read policy, and `_shared/auth-posture.test.ts` forbids the service role in a
 * user-callable function. It is the same read `version-gate.ts` makes.
 */
export type CheckoutGate =
  | { open: true }
  | { open: false; reason: 'read-error' | 'absent' | 'malformed' | 'off' };

export async function readCircleCheckoutGate(userClient: SupabaseClient): Promise<CheckoutGate> {
  const { data, error: readError } = await userClient
    .from('remote_config')
    .select('value')
    .eq('key', CIRCLE_CHECKOUT_FLAG)
    .maybeSingle();
  // The error wins over any payload that came with it: a read that failed proved nothing.
  if (readError) return { open: false, reason: 'read-error' };
  if (data == null) return { open: false, reason: 'absent' };
  const value = (data as { value?: unknown }).value;
  if (typeof value !== 'object' || value === null) return { open: false, reason: 'malformed' };
  const enabled = (value as { enabled?: unknown }).enabled;
  if (typeof enabled !== 'boolean') return { open: false, reason: 'malformed' };
  return enabled ? { open: true } : { open: false, reason: 'off' };
}

/**
 * One line per closed refusal, naming the function and why — the logPriceRefusal convention.
 * Configuration only: no profile id, no email, nothing a member typed. `off` is the expected
 * state on production before the cutover, so it logs the same one line and nothing louder.
 */
export function logCheckoutClosed(
  reason: Exclude<CheckoutGate, { open: true }>['reason'],
  sink: PriceRefusalSink = consoleRefusalSink,
): void {
  sink(`[circle] ${FN}: checkout closed ${JSON.stringify({ flag: CIRCLE_CHECKOUT_FLAG, reason })}`);
}

/**
 * #759 — whether a subscription in this Stripe status stops the member from starting another.
 * A deny-list of the two TERMINAL statuses, so anything else blocks, including a status Stripe
 * adds after this was written: on the money path an unknown answer is a no.
 *
 * What blocks, and why: Stripe's own «limit customers to one subscription» treats `active`,
 * `past_due`, `unpaid` and `paused` as live (docs.stripe.com/payments/checkout/limit-subscriptions,
 * read 2026-09-18). `trialing` bills when the trial ends. `incomplete` is a first payment still
 * settling (a PaymentIntent in `processing`) — it turns `active` within 23 hours or expires, and
 * a second subscription started meanwhile is a second charge when both settle. Only `canceled`
 * and `incomplete_expired` can never bill again.
 *
 * The cached `circle_memberships.status` cannot answer this: `mapSubStatus` folds `unpaid` and
 * `paused` into `canceled`, and the row lags any webhook that has not landed yet.
 */
export function blocksNewSubscription(status: string): boolean {
  return status !== 'canceled' && status !== 'incomplete_expired';
}

/**
 * #759 — keyed on the member, so every attempt before their first webhook lands (and so before
 * any membership row exists to name the Customer) gets the SAME Customer back from Stripe for as
 * long as Stripe keeps the key (at least 24h — as long as a Checkout Session can stay open).
 * Without it, each attempt minted a Customer of its own: two Customers, two payable Sessions,
 * and the second subscription's webhook hitting `unique (profile_id)` on every retry.
 *
 * The trade: Stripe errors when a key is reused with different parameters, so a member whose
 * auth email changed between two attempts inside that window is refused (500) until the key
 * expires — fails closed, never a second Customer.
 */
export const customerIdempotencyKey = (profileId: string): string => `circle-customer:${profileId}`;

/**
 * #759 — anchored to the newest Session the Customer has (any status), read BEFORE the sweep.
 * Requests racing past every other gate observe the same newest Session, so they send the same
 * key and Stripe answers all of them with ONE Session. The moment that Session exists it is the
 * newest, so the next attempt keys differently and gets a fresh one — a completed or expired
 * Session is never replayed to a later attempt. The Price id, not the plan name: a reused key
 * must mean identical parameters, or Stripe refuses the request.
 */
export const sessionIdempotencyKey = (
  customerId: string,
  priceId: string,
  latestSessionId: string | null,
): string => `circle-checkout:${customerId}:${priceId}:${latestSessionId ?? 'none'}`;

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
 * Gates in order: checkout flag (#747) → plan enum → price configured → Price servable
 * (`servableAmount`, the same gate get-circle-prices quotes through) → membership read → one
 * live subscription per member (#759). Reuses the caller's existing Stripe Customer if a
 * membership row already exists (RLS select-own), else creates one tagged with profile_id.
 * The membership row is written by the webhook (W5/W11), never here (rule #6). Returns the
 * { kind:'url' } indirection; { kind:'iap' } is M10 (S-IAP-1 OPEN).
 *
 * The Price gate puts one Stripe read in front of `sessions.create`, so a Stripe read outage
 * now blocks subscribing where it used to block only the quote. That is the trade, chosen
 * deliberately for the money path (#674 item 7): a checkout that cannot verify what it is
 * about to charge must not charge it — the opposite of `version-gate.ts`, whose courtesy
 * check fails open because it protects nothing that money depends on. #759's gates make the
 * same trade: every Stripe read they add fails closed.
 *
 * #759, in the order it runs once the Customer is known — the order is the guarantee:
 *   1. note the Customer's newest Session (the idempotency anchor, `sessionIdempotencyKey`);
 *   2. expire every open Circle Session — at most one payable Session per Customer, whatever
 *      the number of devices, taps or abandoned browsers;
 *   3. ask Stripe for the Customer's subscriptions; any that `blocksNewSubscription` → 409
 *      `circle already subscribed`, which the app maps to «already in the Circle → Manage».
 *      After step 2 on purpose: a Session paid between this listing and its own expiry would
 *      be a subscription the listing never saw. Expired first, it can no longer complete.
 *   4. mint the Session under the step-1 key.
 */
export async function createCircleCheckout(
  ctx: CircleCheckoutCtx,
  input: CircleCheckoutInput,
): Promise<Response> {
  const {
    userClient,
    createCustomer,
    createCheckoutSession,
    listSubscriptions,
    latestCheckoutSession,
    listOpenCheckoutSessions,
    expireCheckoutSession,
    retrievePrice,
    priceIds,
    appBase,
    refusalSink,
    stripeFailureSink,
  } = ctx;
  const { profileId, email, plan } = input;

  // #747 — first, before any Stripe call: a closed checkout mints no Customer and no Session,
  // whatever the client showed. 403 with a stable code the app maps to its closed line.
  const gate = await readCircleCheckoutGate(userClient);
  if (!gate.open) {
    logCheckoutClosed(gate.reason, refusalSink);
    return error('circle checkout closed', 403);
  }

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
    logStripeFailure(`${FN}: prices.retrieve`, e, stripeFailureSink);
    return error('could not start checkout', 500);
  }
  const servable = servableAmount(plan, price);
  if (!servable.ok) {
    logPriceRefusal({ fn: FN, plan, reason: servable.reason, priceId }, refusalSink);
    return error('price not configured', 500);
  }

  // Reuse the existing Stripe Customer if a membership row exists (RLS select-own); else create
  // one. Only the Customer id is read — whether a subscription is live is Stripe's answer (#759).
  // Fail closed (#759): a failed read used to pass as «no membership», minting a fresh Customer
  // and a fresh subscription for someone who may already hold one.
  const { data: existing, error: membershipError } = await userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (membershipError) return error('membership lookup failed', 500);

  // Which Stripe call is in flight, so the log names the one that failed — every call below
  // shares one catch, and the operator needs to tell a refused expiry from an outage.
  let step = 'customers.create';
  try {
    let customerId: string | null = existing?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await createCustomer(
        { email, metadata: { profile_id: profileId } },
        { idempotencyKey: customerIdempotencyKey(profileId) },
      );
      customerId = customer.id;
    }

    // #759 step 1 — the idempotency anchor, read before the sweep.
    step = 'checkout.sessions.list latest';
    const latest = await latestCheckoutSession(customerId);

    // #759 step 2 — at most one payable Session. Only subscription-mode Sessions: the sweep
    // retires what this function mints and nothing else. An expiry Stripe refuses throws into
    // the catch below — the likeliest cause is that the Session completed a moment ago, and a
    // fresh one minted now would be the double charge.
    const expired = new Set<string>();
    step = 'checkout.sessions.list open';
    for (const open of await listOpenCheckoutSessions(customerId)) {
      if (open.mode !== 'subscription') continue;
      step = 'checkout.sessions.expire';
      await expireCheckoutSession(open.id);
      expired.add(open.id);
    }

    // #759 step 3 — Stripe is the source of truth (rule #6); the cached row lags webhooks and
    // folds `unpaid`/`paused` into `canceled`.
    step = 'subscriptions.list';
    const subscriptions = await listSubscriptions(customerId);
    if (subscriptions.some((s) => blocksNewSubscription(s.status))) {
      return error('circle already subscribed', 409);
    }

    // #759 step 4.
    step = 'checkout.sessions.create';
    const session = await createCheckoutSession(
      buildCircleSessionParams(priceId, customerId, profileId, appBase),
      { idempotencyKey: sessionIdempotencyKey(customerId, priceId, latest?.id ?? null) },
    );
    // A concurrent request minted this Session under the same key and step 2 then expired it;
    // Stripe replays it anyway. A dead URL is not a checkout — say so and let the retry key anew.
    if (expired.has(session.id)) return error('could not start checkout', 500);
    if (!session.url) return error('could not start checkout', 500);
    return json({ kind: 'url', url: session.url });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure(`${FN}: ${step}`, e, stripeFailureSink);
    return error('could not start checkout', 500);
  }
}
