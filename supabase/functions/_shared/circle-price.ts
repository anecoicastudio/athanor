import type Stripe from 'npm:stripe@22';
import type { CirclePlan, CirclePrice } from '@athanor/schemas';

// The Circle price gate — what a Stripe Price MUST be for a plan's own name to be true.
//
// Lifted out of get-circle-prices (#674 item 7): the quote path refused to serve an archived,
// one-off, wrong-interval, multi-period or tiered Price, while create-circle-checkout charged
// whatever the env id resolved to. A misconfigured Price therefore made new builds refuse to
// quote while any build could still be charged the wrong thing. One gate, two callers.
//
// Deliberately imports NOTHING from ./stripe.ts — only type-level `npm:stripe` — so the two
// logic modules that use it keep their DI boundary (the Stripe capability arrives injected).
// `@athanor/schemas` is type-only as well: the deploy-graph walker erases `import type`, so the
// schemas barrel stays out of the deployed runtime graph (see deploy-graph.test.ts).

/**
 * What each plan MUST bill on for its own name to be true.
 *
 * The screen renders «{price}/mese» and «{price}/anno» beside these amounts and derives the
 * savings line by multiplying the monthly one by twelve. A Price id pointed at the wrong
 * recurrence would make every one of those strings a confident lie, so the recurrence is
 * asserted here rather than assumed — this gate exists precisely because the number and the
 * claim had drifted apart once already (#644).
 *
 * Typed against the schemas enum: a third plan added there fails to compile here, instead of
 * being silently never served.
 */
export const EXPECTED_INTERVAL: Record<CirclePlan, Stripe.Price.Recurring.Interval> = {
  monthly: 'month',
  annual: 'year',
};

/** Why a Price cannot price a plan. `unset` is the id never configured, the sixth arm. */
export type PriceRefusal =
  | 'unset'
  | 'inactive'
  | 'one_off'
  | 'wrong_interval'
  | 'multi_period'
  | 'no_unit_amount';

export type ServableAmount =
  | { ok: true; amount: CirclePrice }
  | { ok: false; reason: PriceRefusal };

/**
 * The servable amount of a Price, or the gate it failed. Five ways it can fail, and this list
 * is the whole gate: an archived Price, a one-off Price, a Price on the wrong or a multi-period
 * recurrence, or a tiered Price (which carries no `unit_amount` at all).
 *
 * `active` is in there for the same reason as the rest: an inactive Price still RETRIEVES, so
 * its amount would render on the CTA — and then Checkout cannot build a session from it.
 * Quoting a number nobody can be charged is «quotes one number, charges another» in a new
 * shape. Refusing is deliberate throughout: a wrong price on a purchase screen is the defect,
 * an absent one is an outage the screen already knows how to say.
 *
 * Gates are checked in a fixed order and the FIRST failing one is the reason, so the log line
 * an operator reads points at one thing to fix.
 */
export function servableAmount(plan: CirclePlan, price: Stripe.Price): ServableAmount {
  if (!price.active) return { ok: false, reason: 'inactive' };
  const recurring = price.recurring;
  if (!recurring) return { ok: false, reason: 'one_off' };
  if (recurring.interval !== EXPECTED_INTERVAL[plan])
    return { ok: false, reason: 'wrong_interval' };
  if (recurring.interval_count !== 1) return { ok: false, reason: 'multi_period' };
  if (typeof price.unit_amount !== 'number') return { ok: false, reason: 'no_unit_amount' };
  return { ok: true, amount: { unitAmount: price.unit_amount, currency: price.currency } };
}

/** Where a refusal line goes. Injectable so a test can assert the line exists and read it. */
export type PriceRefusalSink = (line: string) => void;

/** console.error reaches the Supabase function logs, which is the only place an operator looks. */
export const consoleRefusalSink: PriceRefusalSink = (line) => console.error(line);

/**
 * One line per refused gate, naming the function, the plan, the gate and the Price id (#674
 * item 8). Every one of these arms used to return the same unlogged generic 500 — only the
 * Stripe-throw arm logged, so a misconfigured Price was invisible until a device session found
 * it. Carries configuration only: no profile id, no email, nothing a member typed.
 */
export function logPriceRefusal(
  refusal: { fn: string; plan: CirclePlan; reason: PriceRefusal; priceId?: string },
  sink: PriceRefusalSink = consoleRefusalSink,
): void {
  const { fn, plan, reason, priceId } = refusal;
  const facts = priceId === undefined ? { plan, reason } : { plan, reason, priceId };
  sink(`[circle] ${fn}: price refused ${JSON.stringify(facts)}`);
}
