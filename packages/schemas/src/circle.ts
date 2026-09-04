import { z } from 'zod';

export const circlePlanSchema = z.enum(['monthly', 'annual']);
export type CirclePlan = z.infer<typeof circlePlanSchema>;

export const circleStatusSchema = z.enum(['active', 'past_due', 'canceled', 'incomplete']);
export type CircleStatus = z.infer<typeof circleStatusSchema>;

/** Read-own model of the SRW circle_memberships cache. No client insert/update shape exists (rule #6). */
export const circleMembershipSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  stripe_customer_id: z.string(),
  stripe_subscription_id: z.string().nullish(),
  plan: circlePlanSchema,
  status: circleStatusSchema,
  current_period_end: z.string().nullish(),
  /** true = cancelled, access ends at current_period_end instead of renewing (#511). */
  cancel_at_period_end: z.boolean(),
  founding_member: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CircleMembership = z.infer<typeof circleMembershipSchema>;

/** startCheckout input. */
export const circleCheckoutInputSchema = z.object({ plan: circlePlanSchema });
export type CircleCheckoutInput = z.infer<typeof circleCheckoutInputSchema>;

/**
 * One plan's live Stripe amount, as `get-circle-prices` serves it (#644).
 *
 * `unitAmount` is Stripe's `unit_amount`: a whole number of minor units. Parsed, never cast —
 * a string that slipped through renders as a plausible price through `formatPrice` and as
 * `NaN` through the savings arithmetic, so the screen would be wrong in one place only.
 */
export const circlePriceSchema = z.object({
  unitAmount: z.number().int().nonnegative(),
  currency: z.string().length(3),
});
export type CirclePrice = z.infer<typeof circlePriceSchema>;

/** Both Circle plans' live amounts. Both or neither: one plan alone cannot price the screen. */
export const circlePricesSchema = z.object({
  monthly: circlePriceSchema,
  annual: circlePriceSchema,
});
export type CirclePrices = z.infer<typeof circlePricesSchema>;

/** iOS IAP indirection (S-IAP-1): M8 returns 'url'; the 'iap' branch is reserved for M10. */
export const circleCheckoutResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('iap'), productId: z.string() }),
]);
export type CircleCheckoutResult = z.infer<typeof circleCheckoutResultSchema>;
