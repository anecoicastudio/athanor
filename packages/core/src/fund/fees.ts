import { MIN_CONTRIBUTION_CENTS } from './amount';

/**
 * Stripe's EU standard rate for European cards, in one module (rule #10) so the two
 * numbers a payer sees quoted are never spelled twice. 1.5% + €0,25.
 *
 * The edge function `create-contribution-session` carries a Deno-native copy of both
 * constants and of the formula below — `supabase/functions` is outside the pnpm
 * workspace and cannot import `@athanor/core`. That copy is the AUTHORITY (the server
 * recomputes; the client's figure is display only); this one exists so the disclosure
 * screen can show the payer the same number before they consent. Change one, change both:
 * `create-contribution-session/logic.test.ts` pins the same fixture values these tests do.
 */
export const STRIPE_FEE_BPS = 150;
export const STRIPE_FEE_FIXED_CENTS = 25;

/** The three figures of a fee-covered contribution. `gift + coverage === charged`, always. */
export type FeeCoverage = {
  /** what the fund keeps — the only figure the ticker, the §20 report and a refund use */
  giftCents: number;
  /** the optional top-up that pays Stripe. Never returned on a refund (FUND-51) */
  coverageCents: number;
  /** what the card is actually charged, i.e. Stripe's `amount_total` */
  chargedCents: number;
};

/**
 * Gross up a gift so the fund nets it whole after Stripe's cut (FUND-51, #236).
 *
 * The cut is a percentage of the CHARGE, not of the gift, so the equation is recursive:
 * `charged - (charged·pct + fixed) >= gift`  ⟹  `charged = ceil((gift + fixed) / (1 - pct))`.
 * Adding `gift·pct + fixed` instead — the obvious wrong answer — leaves the fund short by
 * the percentage of the fee itself, ~€0,004 on a €1 gift and growing with the amount.
 *
 * Rounds UP to the cent: the alternative hands the last cent to whichever way Stripe
 * happens to round its own fee. The overshoot is at most one cent, asserted both ways
 * in the tests, so the coverage stays a cost and never becomes an undisclosed margin.
 *
 * Integer arithmetic throughout — a cents value must never arrive at a payment boundary
 * carrying a binary-fraction artifact.
 *
 * @throws RangeError below the €1 floor or on non-integer minor units. The floor is on
 * the GIFT: coverage may not push a sub-€1 contribution over the line.
 */
export function feeCoverage(giftCents: number): FeeCoverage {
  if (!Number.isInteger(giftCents) || giftCents < MIN_CONTRIBUTION_CENTS) {
    throw new RangeError(`gift must be an integer of at least ${MIN_CONTRIBUTION_CENTS} cents`);
  }
  const numerator = (giftCents + STRIPE_FEE_FIXED_CENTS) * 10_000;
  const denominator = 10_000 - STRIPE_FEE_BPS;
  const chargedCents = Math.floor(numerator / denominator) + (numerator % denominator > 0 ? 1 : 0);
  return { giftCents, coverageCents: chargedCents - giftCents, chargedCents };
}
