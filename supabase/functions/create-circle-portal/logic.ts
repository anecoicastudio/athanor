import type Stripe from 'npm:stripe@22';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';
import {
  blocksNewSubscription,
  circleCustomerTagQuery,
  taggedCircleCustomers,
} from '../_shared/circle-customer.ts';

// Portal-session construction extracted from index.ts so it is unit-testable (deno test):
// index.ts keeps the transport shell (OPTIONS/method guard, requireUser, version gate,
// env + singleton wiring) and injects everything here (repo convention: DI over mocks).
// Deliberately does NOT import ../_shared/stripe.ts — only type-level `npm:stripe`: the
// Stripe capabilities arrive injected. #541 made that module lazy, so the import would no
// longer demand STRIPE_SECRET_KEY in a test env; the boundary stays because DI is the point.

export type CirclePortalCtx = {
  /** the caller's own client — circle_memberships is RLS select-own */
  userClient: SupabaseClient;
  /**
   * #759 — read only when no membership row names the Customer yet. stripe.customers.list
   * ({ email }) and stripe.customers.search on the tag, EVERY match (index.ts auto-paginates);
   * then each tagged Customer's non-canceled subscriptions, to open the one that holds a live one.
   */
  listCustomersByEmail: (email: string) => Promise<Stripe.Customer[]>;
  searchCustomersByTag: (query: string) => Promise<Stripe.Customer[]>;
  listSubscriptions: (customerId: string) => Promise<Stripe.Subscription[]>;
  /** stripe.billingPortal.sessions.create */
  createPortalSession: (
    params: Stripe.BillingPortal.SessionCreateParams,
  ) => Promise<Stripe.BillingPortal.Session>;
  /** APP_DEEPLINK_BASE (default 'athanor://') */
  appBase: string;
};

export type CirclePortalInput = {
  /** the verified caller (requireUser) — NEVER trusted from the body */
  profileId: string;
  /** the caller's auth email (requireUser) — narrows the #759 Customer lookup, proves nothing */
  email?: string;
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
 * Reads the caller's own membership (RLS select-own) for the Customer. With no row yet, falls
 * back to the Customers Stripe holds tagged with the caller (#759, `taggedCircleCustomers`) —
 * the one holding a live subscription, else the newest: the row is written only by the
 * webhook, and create-circle-checkout's «already subscribed» refusal sends a member here in
 * exactly the window before it lands. 404 when neither names one. Plan change, card update,
 * and cancellation happen ONLY in the portal; the resulting state lands via W6/W7.
 */
export async function createCirclePortal(
  ctx: CirclePortalCtx,
  input: CirclePortalInput,
): Promise<Response> {
  const {
    userClient,
    listCustomersByEmail,
    searchCustomersByTag,
    listSubscriptions,
    createPortalSession,
    appBase,
  } = ctx;

  const { data: membership, error: mErr } = await userClient
    .from('circle_memberships')
    .select('stripe_customer_id')
    .eq('profile_id', input.profileId)
    .maybeSingle();
  if (mErr) return error('membership lookup failed', 500);

  let customerId: string | null = membership?.stripe_customer_id ?? null;
  if (!customerId) {
    let step = 'customers.list';
    try {
      const byEmail = input.email ? await listCustomersByEmail(input.email) : [];
      step = 'customers.search';
      const tagQuery = circleCustomerTagQuery(input.profileId);
      const byTag = tagQuery ? await searchCustomersByTag(tagQuery) : [];
      const tagged = taggedCircleCustomers([byEmail, byTag], input.profileId);
      // With more than one, open the Customer that holds a live subscription — the newest may
      // hold none. With one, there is nothing to choose between.
      if (tagged.length > 1) {
        step = 'subscriptions.list';
        for (const c of tagged) {
          const subs = await listSubscriptions(c.id);
          if (subs.some((s) => blocksNewSubscription(s.status))) {
            customerId = c.id;
            break;
          }
        }
      }
      customerId ??= tagged[0]?.id ?? null;
    } catch (e) {
      logStripeFailure(`create-circle-portal: ${step}`, e);
      return error('could not open portal', 500);
    }
  }
  if (!customerId) return error('no membership', 404);

  try {
    const session = await createPortalSession(buildPortalSessionParams(customerId, appBase));
    return json({ url: session.url });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('create-circle-portal: billingPortal.sessions.create', e);
    return error('could not open portal', 500);
  }
}
