import { z } from 'zod';
import { circlePlanSchema, circleStatusSchema } from './circle';

/**
 * One feature bit as the view emits it, defaulting to false.
 *
 * Postgres does not track view-column nullability, so PostgREST types every column of
 * `entitlements` as `boolean | null` even though the view coalesces each bit and hardcodes
 * market_reduced_fee to false. Absence therefore has to mean "no feature" rather than a
 * thrown parse: `toEntitlementView` already documents that contract, and a schema that threw
 * would turn a future dropped coalesce into a member who cannot load the Circle screen at all
 * instead of one who sees the feature as off. pgTAP 0047 asserts the view emits no null.
 */
const featureBit = z
  .boolean()
  .nullish()
  .transform((v) => v ?? false);

/** Server-derived (entitlements view). Read-only; the app never recomputes "is allowed". */
export const entitlementsSchema = z.object({
  // Identity, not a permission: there is no fail-safe default for "whose row is this", so it
  // stays strict and a row without one is a parse error.
  profile_id: z.string().uuid(),
  is_member: featureBit,
  plan: circlePlanSchema.nullish(),
  status: circleStatusSchema.nullish(),
  founding: featureBit,
  advanced_filters: featureBit,
  premium_events: featureBit,
  analytics: featureBit,
  market_reduced_fee: featureBit, // PARKED(Fase-2): marketplace unbuilt; bit stays false-only at launch (PRODUCTION-READINESS P5)
});
export type Entitlements = z.infer<typeof entitlementsSchema>;
