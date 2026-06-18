import { z } from 'zod';
import { circlePlanSchema, circleStatusSchema } from './circle';

/** Server-derived (entitlements view). Read-only; the app never recomputes "is allowed". */
export const entitlementsSchema = z.object({
  profile_id: z.string().uuid(),
  is_member: z.boolean(),
  plan: circlePlanSchema.nullish(),
  status: circleStatusSchema.nullish(),
  founding: z.boolean(),
  advanced_filters: z.boolean(),
  premium_events: z.boolean(),
  analytics: z.boolean(),
  market_reduced_fee: z.boolean(),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;
