import { circleCustomerTagQuery } from '../_shared/circle-customer.ts';

// Erasure cascade step (3b-ter), #763: clear `metadata.profile_id` off the member's Stripe
// Customers before (3c) pseudonymises the membership row.
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
// Split out of index.ts so it can be tested — index.ts is a `Deno.serve` shell nothing executes
// (#542). This is a metadata write, not a Stripe state transition: it bills, refunds and cancels
// nothing (rules/supabase-functions.md, Money).

/** The three Stripe calls this step makes, as a port so ./untag.test.ts can stand in for them. */
export type CustomerTagApi = {
  /** `customers.search`, EVERY page — the ids of the Customers matching `query` */
  searchCustomers: (query: string) => Promise<string[]>;
  /** `customers.retrieve` — rejects for an id Stripe does not have */
  retrieveCustomer: (
    id: string,
  ) => Promise<{ id: string; deleted?: unknown; metadata?: Record<string, string> | null }>;
  /** `customers.update(id, { metadata: { profile_id: '' } })`. «Individual keys can be unset by
   * posting an empty value to them» (docs.stripe.com/api/customers/update, read 2026-09-25). */
  clearProfileTag: (id: string) => Promise<unknown>;
};

/**
 * The same two codes `logic.ts` treats as permanent (docs.stripe.com/error-codes): the id names
 * nothing this key can reach. A Customer this key cannot see carries no tag this key's lookup can
 * find, so for THIS step it is simply nothing to do — unlike the cancel, where it hides a charge.
 */
const UNREACHABLE_CODES = new Set(['resource_missing', 'livemode_mismatch']);

/**
 * Untag every Customer carrying this profile's tag. Returns how many were written; rejects on any
 * failure it cannot classify, so the loop halts before (3c) rather than finishing over a tag.
 *
 * Two sources, because each misses what the other finds (the same pairing #759 made for the
 * lookup): the membership row's `stripe_customer_id`, reached by id so search's indexing lag
 * (up to a minute, docs.stripe.com/search) cannot hide it; and `customers.search` on the tag,
 * which reaches Customers no row names — a checkout the member abandoned leaves a tagged
 * Customer and no membership.
 *
 * Every Customer is RETRIEVED and written only if its tag is still this profile's. A row's
 * Customer tagged with someone else is left alone, and a re-driven pass (#717) finds the tag
 * already gone and writes nothing.
 */
export const customerUntagger =
  (api: CustomerTagApi) =>
  async (profileId: string, knownCustomerId: string | null): Promise<number> => {
    const query = circleCustomerTagQuery(profileId);
    if (query === null)
      throw new Error('erasure-job: profile id is not a uuid, refusing to search');
    const ids = new Set(await api.searchCustomers(query));
    if (knownCustomerId) ids.add(knownCustomerId);

    let cleared = 0;
    for (const id of ids) {
      const customer = await api.retrieveCustomer(id).catch((e: unknown) => {
        const code = (e as { code?: unknown } | null)?.code;
        if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) return null;
        throw e;
      });
      if (!customer || customer.deleted || customer.metadata?.profile_id !== profileId) continue;
      await api.clearProfileTag(id);
      cleared++;
    }
    return cleared;
  };
