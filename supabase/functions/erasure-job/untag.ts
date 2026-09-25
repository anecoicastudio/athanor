import { isPermanentStripeError } from './logic.ts';

// Erasure cascade step (3b-ter), #763: clear `metadata.profile_id` off the Stripe Customer the
// membership row names, before (3c) pseudonymises that row.
//
// Why the cascade has to: `create-circle-checkout` tags every Customer it creates with the
// member's profile id, and since #759 `create-circle-checkout` / `create-circle-portal` find a
// member's Customer BY THAT TAG whenever no `circle_memberships` row names one
// (`_shared/circle-customer.ts`). (3c) nulls the row's `profile_id`, so a member whose erasure
// stops after (3c) and is then withdrawn (RELEASE-RUNBOOK §7.5 — an operator act on a `failed`
// row) has an account and no row — and the tag lookup hands back the OLD Customer. A
// subscription minted on it resolves in the webhook by customer id onto the pseudonymised row:
// the member pays, the app shows no membership, and the retained record's money columns are
// overwritten. With the tag gone, the lookup finds nothing and checkout makes a fresh Customer.
//
// Only the ROW'S Customer, deliberately. The harm runs through `stripe-webhook`'s
// resolve-by-customer-id, and that can only land on the pseudonymised row through the Customer id
// the row itself holds. A tagged Customer no row names (an abandoned checkout) resolves to no row,
// so a subscription on it inserts a fresh membership for the member — correct. Sweeping those too
// would need `customers.search` on every erasure, making Stripe's availability a dependency of
// erasing members who never touched Circle, and would hide their open Checkout Sessions from
// #759's double-charge sweep if the erasure were later withdrawn.
//
// The write provokes `customer.updated`, whose `data.object` no longer carries the tag, so the
// #725 ledger redaction would not match it. Neither webhook endpoint subscribes to `customer.*`
// (staging checked 2026-09-25); adding it there owes that redaction a new match arm first.
//
// Split out of index.ts so it can be tested — index.ts is a `Deno.serve` shell nothing executes
// (#542). This is a metadata write, not a Stripe state transition: it bills, refunds and cancels
// nothing (rules/supabase-functions.md, Money).

/** The two Stripe calls this step makes, as a port so ./untag.test.ts can stand in for them. */
export type CustomerTagApi = {
  /** `customers.retrieve` — rejects for an id Stripe does not have */
  retrieveCustomer: (
    id: string,
  ) => Promise<{ id: string; deleted?: unknown; metadata?: Record<string, string> | null }>;
  /** `customers.update(id, { metadata: { profile_id: '' } })`. «Individual keys can be unset by
   * posting an empty value to them» (docs.stripe.com/api/customers/update, read 2026-09-25). */
  clearProfileTag: (id: string) => Promise<unknown>;
};

/**
 * Untag the membership row's Customer. Resolves true when it wrote, false when there was nothing
 * to write; rejects on any other failure, so the loop halts before (3c) rather than finishing over
 * a tag.
 *
 * RETRIEVED first and written only if the tag is still this profile's: a Customer tagged with
 * someone else is left alone, a deleted one is skipped, and a re-driven pass (#717) finds the tag
 * already gone and writes nothing. A Customer this key cannot reach (`isPermanentStripeError`,
 * the codes the cancel step shares) carries no tag this key's lookup could find, so it is nothing
 * to do — unlike the cancel, where the same error hides a charge.
 */
export const customerUntagger =
  (api: CustomerTagApi) =>
  async (profileId: string, customerId: string): Promise<boolean> => {
    let customer: Awaited<ReturnType<CustomerTagApi['retrieveCustomer']>>;
    try {
      customer = await api.retrieveCustomer(customerId);
    } catch (e) {
      if (isPermanentStripeError(e)) return false;
      throw e;
    }
    if (customer.deleted || customer.metadata?.profile_id !== profileId) return false;
    await api.clearProfileTag(customerId);
    return true;
  };
