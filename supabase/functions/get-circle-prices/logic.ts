import type Stripe from 'npm:stripe@22';
import type { CirclePlan, CirclePrices } from '@athanor/schemas';
import { error, json } from '../_shared/respond.ts';
import { logStripeFailure } from '../_shared/stripe-error.ts';
import { logPriceRefusal, servableAmount, type PriceRefusalSink } from '../_shared/circle-price.ts';
import type { CirclePriceIds } from '../_shared/stripe.ts';

// Live-amount read extracted from index.ts so it is unit-testable (deno test): index.ts keeps
// the transport shell (OPTIONS/method guard, requireUser, version gate, env + singleton wiring)
// and injects everything here (repo convention: DI over mocks). Deliberately does NOT import
// ../_shared/stripe.ts at runtime — only type-level `npm:stripe` and the ids' TYPE: the Stripe
// capability arrives injected. The plan and price shapes come from `@athanor/schemas`, type-only
// (#674 item 4): a third plan added there fails to compile in `_shared/circle-price.ts` rather
// than being silently never served, and the response is typed as exactly what the app parses.

export type CirclePricesCtx = {
  /** stripe.prices.retrieve — the only outbound Stripe call */
  retrievePrice: (id: string) => Promise<Stripe.Price>;
  /** Price IDs from secrets, via `circlePriceIds()` — the same two `create-circle-checkout` charges */
  priceIds: CirclePriceIds;
  /** Injectable clock for the memo below; production leaves the default. */
  now?: () => number;
  /** Where a refused gate is logged; production leaves the default (function logs). */
  refusalSink?: PriceRefusalSink;
};

const FN = 'get-circle-prices';

/**
 * Per-isolate memo of a SUCCESSFUL read, 60s (#674 item 5).
 *
 * Every Circle open used to cost two live Stripe reads. The client accepts five minutes of
 * staleness (`staleTime` in circle.tsx) and `version-gate.ts` memoizes its own config row for
 * 60s with that exact reasoning, so a 60s memo here trims the reads without moving the
 * freshness the app already lives with. Only a success is memoized: a failed read is retried
 * on the next request, so a refusal never sticks for a minute after the operator fixes it.
 * Per isolate, not per deployment — a Dashboard edit reaches the app within 60s plus
 * `staleTime`, the same window the version gate documents.
 */
const CACHE_TTL_MS = 60_000;
let memo: { prices: CirclePrices; at: number } | null = null;

export function _resetCirclePricesCacheForTest(): void {
  memo = null;
}

/**
 * Reads both Circle Prices from Stripe and serves their amounts (#644).
 *
 * Rule 6: Stripe is the source of truth. The app used to carry «€12/mese» and «€99/anno» as
 * catalog literals while the charge came from these two Price ids, so a Dashboard edit shipped
 * an app that quoted one number and charged another. Every way a Price can fail to price its
 * plan is refused (`servableAmount`, shared with the checkout path) and logged by gate.
 */
export async function getCirclePrices(ctx: CirclePricesCtx): Promise<Response> {
  const { retrievePrice, priceIds, now = Date.now, refusalSink } = ctx;
  const plans: CirclePlan[] = ['monthly', 'annual'];

  let unset = false;
  for (const plan of plans) {
    if (!priceIds[plan]) {
      logPriceRefusal({ fn: FN, plan, reason: 'unset' }, refusalSink);
      unset = true;
    }
  }
  if (unset || !priceIds.monthly || !priceIds.annual) return error('price not configured', 500);

  if (memo && now() - memo.at < CACHE_TTL_MS) return json(memo.prices);

  try {
    const [monthlyPrice, annualPrice] = await Promise.all([
      retrievePrice(priceIds.monthly),
      retrievePrice(priceIds.annual),
    ]);
    const monthly = servableAmount('monthly', monthlyPrice);
    const annual = servableAmount('annual', annualPrice);
    if (!monthly.ok) {
      logPriceRefusal(
        { fn: FN, plan: 'monthly', reason: monthly.reason, priceId: priceIds.monthly },
        refusalSink,
      );
    }
    if (!annual.ok) {
      logPriceRefusal(
        { fn: FN, plan: 'annual', reason: annual.reason, priceId: priceIds.annual },
        refusalSink,
      );
    }
    if (!monthly.ok || !annual.ok) return error('price not configured', 500);
    const prices: CirclePrices = { monthly: monthly.amount, annual: annual.amount };
    memo = { prices, at: now() };
    return json(prices);
  } catch (e) {
    // Bound, not bare (#416): the response stays exactly as generic as it was, but the Stripe
    // reason now reaches the function logs instead of vanishing.
    logStripeFailure('get-circle-prices: prices.retrieve', e);
    return error('could not load prices', 500);
  }
}
