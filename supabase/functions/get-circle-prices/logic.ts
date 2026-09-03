import type Stripe from 'npm:stripe@22';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';

// Live-amount read extracted from index.ts so it is unit-testable (deno test): index.ts keeps
// the transport shell (OPTIONS/method guard, requireUser, version gate, env + singleton wiring)
// and injects everything here (repo convention: DI over mocks). Deliberately does NOT import
// ../_shared/stripe.ts — only type-level `npm:stripe`: the Stripe capability arrives injected.

export type CirclePlan = 'monthly' | 'annual';

/** One plan's live amount, in Stripe's own minor units and currency code. */
export type CirclePriceAmount = { unitAmount: number; currency: string };

export type CirclePricesCtx = {
  /** stripe.prices.retrieve — the only outbound Stripe call */
  retrievePrice: (id: string) => Promise<Stripe.Price>;
  /** Price IDs from secrets — the same two `create-circle-checkout` charges; undefined when unset */
  priceIds: { monthly?: string; annual?: string };
};

/**
 * What each plan MUST bill on for its own name to be true.
 *
 * The screen renders «{price}/mese» and «{price}/anno» beside these amounts and derives the
 * savings line by multiplying the monthly one by twelve. A Price id pointed at the wrong
 * recurrence would make every one of those strings a confident lie, so the recurrence is
 * asserted here rather than assumed — this endpoint exists precisely because the number and
 * the claim had drifted apart once already (#644).
 */
const EXPECTED_INTERVAL: Record<CirclePlan, Stripe.Price.Recurring.Interval> = {
  monthly: 'month',
  annual: 'year',
};

/**
 * The servable amount of a Price, or null when it cannot price this plan. Four ways it cannot,
 * and this list is the whole gate: an archived Price, a one-off Price, a Price on the wrong or
 * a multi-period recurrence, or a tiered Price (which carries no `unit_amount` at all).
 *
 * `active` is in there for the same reason as the rest: an inactive Price still RETRIEVES, so
 * its amount would render on the CTA — and then `create-circle-checkout` cannot build a session
 * from it. Quoting a number nobody can be charged is «quotes one number, charges another» in a
 * new shape. Null is deliberate throughout: a wrong price on a purchase screen is the defect,
 * an absent one is an outage the screen already knows how to say.
 */
export function servableAmount(plan: CirclePlan, price: Stripe.Price): CirclePriceAmount | null {
  if (!price.active) return null;
  const recurring = price.recurring;
  if (!recurring) return null;
  if (recurring.interval !== EXPECTED_INTERVAL[plan]) return null;
  if (recurring.interval_count !== 1) return null;
  if (typeof price.unit_amount !== 'number') return null;
  return { unitAmount: price.unit_amount, currency: price.currency };
}

/**
 * Reads both Circle Prices from Stripe and serves their amounts (#644).
 *
 * Rule 6: Stripe is the source of truth. The app used to carry «€12/mese» and «€99/anno» as
 * catalog literals while the charge came from these two Price ids, so a Dashboard edit shipped
 * an app that quoted one number and charged another. Nothing is cached here on purpose — a
 * per-isolate memo would reintroduce exactly the staleness this closes; freshness is the
 * client's `staleTime` to choose.
 */
export async function getCirclePrices(ctx: CirclePricesCtx): Promise<Response> {
  const { retrievePrice, priceIds } = ctx;
  if (!priceIds.monthly || !priceIds.annual) return error('price not configured', 500);

  try {
    const [monthlyPrice, annualPrice] = await Promise.all([
      retrievePrice(priceIds.monthly),
      retrievePrice(priceIds.annual),
    ]);
    const monthly = servableAmount('monthly', monthlyPrice);
    const annual = servableAmount('annual', annualPrice);
    if (!monthly || !annual) return error('price not configured', 500);
    return json({ monthly, annual });
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('get-circle-prices: prices.retrieve', e);
    return error('could not load prices', 500);
  }
}
