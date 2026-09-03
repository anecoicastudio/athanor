import type { CirclePrice } from '@athanor/schemas';

/** How many monthly charges a year of the monthly plan costs. */
export const MONTHS_PER_YEAR = 12;

/**
 * What a year on the annual plan saves against paying monthly, derived from the two live
 * amounts (#644).
 *
 * The Circle screen used to assert the saving as a catalog literal, decoupled from the Price
 * objects Stripe actually charges — «Risparmi €45 all'anno» was true only for as long as
 * nobody touched the Dashboard. Deriving it means the line cannot outlive the number.
 *
 * Returns `null` rather than a number wherever the claim would be unsound: the annual plan is
 * not cheaper (nothing to boast), or the two plans are priced in different currencies (the
 * subtraction has no meaning). A missing line is honest; a wrong one is the defect.
 */
export function circleAnnualSavings(
  monthly: CirclePrice,
  annual: CirclePrice,
): { cents: number; currency: string } | null {
  if (monthly.currency !== annual.currency) return null;
  const cents = monthly.unitAmount * MONTHS_PER_YEAR - annual.unitAmount;
  if (cents <= 0) return null;
  return { cents, currency: annual.currency };
}
