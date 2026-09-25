import type Stripe from 'npm:stripe@22';

/**
 * The caller's Circle Customers, newest first, from any number of Stripe listings (#759).
 *
 * `create-circle-checkout` tags every Customer it creates with `metadata.profile_id`, and that
 * tag is the ONLY proof of ownership read here — the listings just narrow the search. An address
 * can belong to a Customer someone else made (an erased account re-registered under the same
 * email has a new profile id), and a member cannot write Customer metadata, so the tag cannot be
 * claimed from the client side.
 *
 * Needed wherever no membership row names the Customer yet, because the row is written only by
 * the webhook: between a paid Checkout and its webhook, or if that webhook never lands. The
 * callers feed it two listings, because each misses what the other finds:
 *   - `customers.list({ email })` — read-after-write consistent, so a Customer made seconds ago
 *     is found; but its email filter is exact and case-sensitive, so a Customer made under an
 *     earlier auth email is not.
 *   - `customers.search` on the tag (`circleCustomerTagQuery`) — finds that one whatever its
 *     email; but Stripe documents search as lagging writes by up to a minute, an hour in an
 *     outage (docs.stripe.com/search, read 2026-09-18), so it can miss the fresh one.
 *
 * Ordered by `created`, then id: two requests racing each other must agree which one is newest.
 *
 * The erasure cascade clears this tag (#763, `erasure-job/untag.ts`, step 3b-ter) before it
 * pseudonymises the membership row. Without that, an erasure stopped after the pseudonymisation
 * and then withdrawn would leave an account with no row, this lookup would return the old
 * Customer, and the webhook would cache the new subscription against the pseudonymised row — the
 * member billed and not a member in the app. The fix lives in the cascade, not here.
 */
export function taggedCircleCustomers(
  listings: Stripe.Customer[][],
  profileId: string,
): Stripe.Customer[] {
  const byId = new Map<string, Stripe.Customer>();
  for (const c of listings.flat()) {
    if (c.metadata?.profile_id === profileId) byId.set(c.id, c);
  }
  return [...byId.values()].sort((a, b) =>
    a.created !== b.created ? b.created - a.created : a.id < b.id ? 1 : a.id > b.id ? -1 : 0,
  );
}

/**
 * The `customers.search` query for Customers tagged with this profile id, or null when the id
 * is not a uuid. It always is — it comes from getUser() — but it is spliced into a query string,
 * where a quote would end the value and let the rest rewrite the query.
 */
export function circleCustomerTagQuery(profileId: string): string | null {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profileId)) {
    return null;
  }
  return `metadata['profile_id']:'${profileId}'`;
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
 * Shared with create-circle-portal, which opens the portal on the Customer holding such a
 * subscription. The cached `circle_memberships.status` cannot answer this: `mapSubStatus`
 * folds `unpaid` and `paused` into `canceled`, and the row lags any webhook that has not
 * landed yet.
 */
export function blocksNewSubscription(status: string): boolean {
  return status !== 'canceled' && status !== 'incomplete_expired';
}
