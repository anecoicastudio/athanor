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
import {
  blocksNewSubscription,
  circleCustomerTagQuery,
  taggedCircleCustomers,
} from '../_shared/circle-customer.ts';

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
   * stripe.customers.list({ email }) — EVERY Customer for the address (index.ts auto-paginates).
   * With `searchCustomersByTag`, how a member with no membership row yet is matched to the
   * Customers they already hold (#759, `taggedCircleCustomers`).
   */
  listCustomersByEmail: (email: string) => Promise<Stripe.Customer[]>;
  /** stripe.customers.search — EVERY match for `circleCustomerTagQuery` (index.ts auto-paginates) */
  searchCustomersByTag: (query: string) => Promise<Stripe.Customer[]>;
  /**
   * stripe.customers.create — tagged with profile_id so webhooks can map back, and so
   * `taggedCircleCustomers` can find it again. Keyed by `customerIdempotencyKey` (#759).
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
   * stripe.subscriptions.list — EVERY subscription the Customer holds that is not canceled
   * (index.ts auto-paginates). Stripe, not the cached row, decides whether one is live (rule #6,
   * #759).
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
  /** the clock — only the idempotency window reads it (`IDEMPOTENCY_WINDOW_MS`) */
  now: () => Date;
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

export { blocksNewSubscription };

/**
 * #759 — how long one idempotency key lives here. Stripe keeps a key's saved result, a 500
 * included, for 24h and replays it to every request that sends the key again
 * (docs.stripe.com/error-low-level, read 2026-09-18). Both keys below are derived from what the
 * request observed, and a request that failed changed nothing it could observe — so without a
 * window the next attempt would send the same key and be refused the same saved failure for a
 * day. With one, for ten minutes at most.
 *
 * A fresh key after a 500 is what Stripe advises against, because the first request may still
 * have created its object. Here that object is harmless: a Customer it created is found by the
 * next attempt's listings (`taggedCircleCustomers`), and a Session it created is expired by the next
 * attempt's sweep.
 *
 * What the window costs: two requests whose ladders overlap — a few seconds of Stripe round trips
 * — and that started on either side of a ten-minute mark do not share a key. They are settled
 * after minting instead (step 5 of `createCircleCheckout`): the newest open Session survives.
 */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

/** The window `now` falls in — the last segment of both keys. */
export const idempotencyWindow = (now: Date): number =>
  Math.floor(now.getTime() / IDEMPOTENCY_WINDOW_MS);

/**
 * #759 — keyed on the member: two first attempts racing each other, before either Customer
 * exists to be listed, get ONE Customer back from Stripe. Reuse across attempts does not depend
 * on it — a member with no row is matched to the Customers they hold by
 * `taggedCircleCustomers` — so the window can be short.
 *
 * Stripe errors when a key is reused with different parameters: two racing attempts sent with
 * different auth emails inside one window get one Customer and one refusal (500).
 */
export const customerIdempotencyKey = (profileId: string, window: number): string =>
  `circle-customer:${profileId}:${window}`;

/**
 * #759 — anchored to the newest Session the Customer has (any status), read BEFORE the sweep.
 * Requests racing past every other gate observe the same newest Session, so they send the same
 * key and Stripe answers all of them with the same Session. The moment that Session exists it is
 * the newest, so the next attempt keys differently and gets a fresh one — a completed or expired
 * Session is never replayed to a later attempt. What a replay returns is Stripe's saved snapshot,
 * whose `status` still reads `open`; step 5 of `createCircleCheckout` asks Stripe instead.
 *
 * The Price is deliberately NOT in the key. Monthly on one device and annual on another, racing,
 * would otherwise be two keys and two payable Sessions — the sweep of each ran before the other
 * minted. Sharing one key, the later request carries different parameters and Stripe refuses it
 * rather than minting a second Session.
 */
export const sessionIdempotencyKey = (
  customerId: string,
  latestSessionId: string | null,
  window: number,
): string => `circle-checkout:${customerId}:${latestSessionId ?? 'none'}:${window}`;

export type CircleCheckoutInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
  /** the caller's auth email — narrows the #759 Customer lookup, and is set on a new Customer */
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
 * live subscription and one payable Session per member (#759). The membership row is written by
 * the webhook (W5/W11), never here (rule #6). Returns the { kind:'url' } indirection;
 * { kind:'iap' } is M10 (S-IAP-1 OPEN).
 *
 * The Price gate puts one Stripe read in front of `sessions.create`, so a Stripe read outage
 * now blocks subscribing where it used to block only the quote. That is the trade, chosen
 * deliberately for the money path (#674 item 7): a checkout that cannot verify what it is
 * about to charge must not charge it — the opposite of `version-gate.ts`, whose courtesy
 * check fails open because it protects nothing that money depends on. #759's gates make the
 * same trade: every Stripe call they add fails closed.
 *
 * #759 — the Customers first. With a row, the one it names. Without one, every Customer Stripe
 * holds tagged with this member (`taggedCircleCustomers`); the newest is the one a Session is
 * minted on, and only if there is none is a Customer created. Then, in order — the order is the
 * guarantee:
 *   1. note the minting Customer's newest Session (the idempotency anchor,
 *      `sessionIdempotencyKey`);
 *   2. expire the open Circle Sessions: on every other Customer the member holds, all of them;
 *      on the minting Customer, the anchor and anything older. A newer one was minted by a
 *      request racing this one after step 1 — step 5 decides between them;
 *   3. ask Stripe for every held Customer's subscriptions; any that `blocksNewSubscription` →
 *      409 `circle already subscribed`, which the app maps to «already in the Circle → Manage».
 *      After step 2 on purpose: a Session paid between this listing and its own expiry would
 *      be a subscription the listing never saw. Expired first, it can no longer complete;
 *   4. mint the Session under the step-1 key;
 *   5. settle: list the minting Customer's open Circle Sessions again. The newest survives —
 *      every racer orders them the same way — and every other one is expired. If ours is not
 *      open (a racer expired it, or Stripe replayed one that was) or not the newest, 500 and no
 *      URL. Racers that shared the key were handed the same Session and agree; racers that did
 *      not (a ten-minute boundary between them, see `IDEMPOTENCY_WINDOW_MS`) leave one Session.
 */
export async function createCircleCheckout(
  ctx: CircleCheckoutCtx,
  input: CircleCheckoutInput,
): Promise<Response> {
  const {
    userClient,
    listCustomersByEmail,
    searchCustomersByTag,
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
    now,
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

  // The Customer the membership row names (RLS select-own). Only its id is read — whether a
  // subscription is live is Stripe's answer (#759). Fail closed (#759): a failed read used to
  // pass as «no membership», minting a fresh Customer and a fresh subscription for someone who
  // may already hold one.
  const { data: existing, error: membershipError } = await userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (membershipError) return error('membership lookup failed', 500);

  const keyWindow = idempotencyWindow(now());
  // Which Stripe call is in flight, so the log names the one that failed — every call below
  // shares one catch, and the operator needs to tell a refused expiry from an outage.
  let step = 'customers.list';
  try {
    // #759 — the Customers this member holds, newest first. No row names one until the first
    // webhook lands, but an earlier attempt may have made one (backed out of Checkout, or paid a
    // moment ago) — or several, under an earlier email. Minting on a second Customer while the
    // first still has a payable Session or a live subscription is the double charge.
    const rowCustomer: string | null = existing?.stripe_customer_id ?? null;
    let held: string[] = [];
    if (rowCustomer) {
      held = [rowCustomer];
    } else {
      const byEmail = email ? await listCustomersByEmail(email) : [];
      step = 'customers.search';
      const tagQuery = circleCustomerTagQuery(profileId);
      const byTag = tagQuery ? await searchCustomersByTag(tagQuery) : [];
      held = taggedCircleCustomers([byEmail, byTag], profileId).map((c) => c.id);
    }
    let customerId = held[0];
    if (!customerId) {
      step = 'customers.create';
      const customer = await createCustomer(
        { email, metadata: { profile_id: profileId } },
        { idempotencyKey: customerIdempotencyKey(profileId, keyWindow) },
      );
      customerId = customer.id;
      held = [customerId];
    }

    // #759 step 1 — the idempotency anchor, read before the sweep.
    step = 'checkout.sessions.list latest';
    const latest = await latestCheckoutSession(customerId);

    // #759 step 2 — only subscription-mode Sessions: the sweep retires what this function mints
    // and nothing else. An expiry Stripe refuses throws into the catch below — the likeliest
    // cause is that the Session completed a moment ago, and a fresh one minted now would be the
    // double charge.
    for (const heldId of held) {
      step = 'checkout.sessions.list open';
      for (const open of await listOpenCheckoutSessions(heldId)) {
        if (open.mode !== 'subscription') continue;
        if (heldId === customerId && !atOrBeforeAnchor(open, latest)) continue;
        step = 'checkout.sessions.expire';
        await expireCheckoutSession(open.id);
      }
    }

    // #759 step 3 — Stripe is the source of truth (rule #6); the cached row lags webhooks and
    // folds `unpaid`/`paused` into `canceled`.
    step = 'subscriptions.list';
    for (const heldId of held) {
      const subscriptions = await listSubscriptions(heldId);
      if (subscriptions.some((s) => blocksNewSubscription(s.status))) {
        return error('circle already subscribed', 409);
      }
    }

    // #759 step 4.
    step = 'checkout.sessions.create';
    const session = await createCheckoutSession(
      buildCircleSessionParams(priceId, customerId, profileId, appBase),
      { idempotencyKey: sessionIdempotencyKey(customerId, latest?.id ?? null, keyWindow) },
    );

    // #759 step 5 — the newest open Circle Session survives; ours must be it.
    step = 'checkout.sessions.list open';
    const openNow = (await listOpenCheckoutSessions(customerId)).filter(
      (s) => s.mode === 'subscription',
    );
    if (!openNow.some((s) => s.id === session.id)) return error('could not start checkout', 500);
    if (newestSession(openNow).id !== session.id) {
      step = 'checkout.sessions.expire';
      await expireCheckoutSession(session.id);
      return error('could not start checkout', 500);
    }
    for (const other of openNow) {
      if (other.id === session.id) continue;
      step = 'checkout.sessions.expire';
      await expireCheckoutSession(other.id);
    }
    if (!session.url) return error('could not start checkout', 500);
    return json({ kind: 'url', url: session.url });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure(`${FN}: ${step}`, e, stripeFailureSink);
    return error('could not start checkout', 500);
  }
}

/**
 * #759 step 2 — whether an open Session was already there when the anchor was read: the anchor
 * itself, or anything created before it. With no anchor there was no Session at all, so an open
 * one now was minted by a racing request. Same-second Sessions other than the anchor count as
 * newer and are left to step 5, which settles them.
 */
function atOrBeforeAnchor(
  open: Stripe.Checkout.Session,
  anchor: Stripe.Checkout.Session | null,
): boolean {
  if (!anchor) return false;
  return open.id === anchor.id || open.created < anchor.created;
}

/**
 * #759 step 5 — the newest of the open Sessions, by `created` then id, so every request that
 * sees the same set picks the same survivor.
 */
function newestSession(sessions: Stripe.Checkout.Session[]): Stripe.Checkout.Session {
  return sessions.reduce((a, b) =>
    b.created > a.created || (b.created === a.created && b.id > a.id) ? b : a,
  );
}
