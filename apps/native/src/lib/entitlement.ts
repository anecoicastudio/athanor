import type { Entitlements } from '@athanor/schemas';

export interface EntitlementView {
  isMember: boolean;
  plan: 'monthly' | 'annual' | null;
  status: 'active' | 'past_due' | 'canceled' | 'incomplete' | null;
  founding: boolean;
  features: {
    advancedFilters: boolean;
    premiumEvents: boolean;
    analytics: boolean;
    marketReducedFee: boolean; // PARKED(Fase-2): marketplace unbuilt (PRODUCTION-READINESS P5)
  };
}

/**
 * Map the server-derived `entitlements` row → the camelCase view the app reads.
 * Every default is fail-safe: a missing row, or a column the view did not fill,
 * means NOT a member and NO feature. Access is never inferred from absence.
 */
export function toEntitlementView(e: Entitlements | null | undefined): EntitlementView {
  return {
    isMember: e?.is_member ?? false,
    plan: e?.plan ?? null,
    status: e?.status ?? null,
    founding: e?.founding ?? false,
    features: {
      advancedFilters: e?.advanced_filters ?? false,
      premiumEvents: e?.premium_events ?? false,
      analytics: e?.analytics ?? false,
      marketReducedFee: e?.market_reduced_fee ?? false, // PARKED(Fase-2): marketplace unbuilt (PRODUCTION-READINESS P5)
    },
  };
}
