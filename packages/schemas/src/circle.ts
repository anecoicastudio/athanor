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
  founding_member: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CircleMembership = z.infer<typeof circleMembershipSchema>;

/** startCheckout input. */
export const circleCheckoutInputSchema = z.object({ plan: circlePlanSchema });
export type CircleCheckoutInput = z.infer<typeof circleCheckoutInputSchema>;

/** iOS IAP indirection (S-IAP-1): M8 returns 'url'; the 'iap' branch is reserved for M10. */
export const circleCheckoutResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string().url() }),
  z.object({ kind: z.literal('iap'), productId: z.string() }),
]);
export type CircleCheckoutResult = z.infer<typeof circleCheckoutResultSchema>;
