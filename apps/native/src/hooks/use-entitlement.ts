import { useQuery } from '@tanstack/react-query';
import { entitlementKeys, getMyEntitlements } from '@athanor/api';
import { supabase } from '@/lib/supabase';

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
 * Read the caller's Circle entitlements from the server-derived `entitlements` view.
 * Maps snake_case columns → camelCase shape. staleTime 30s — invalidated on
 * Checkout/Portal return so membership state always reflects the latest webhook.
 * Mirrors the supabase + useAuth pattern from apps/native/src/app/(modal)/annual.tsx.
 */
export function useEntitlement() {
  return useQuery({
    queryKey: entitlementKeys.me(),
    staleTime: 30_000,
    queryFn: async (): Promise<EntitlementView> => {
      const e = await getMyEntitlements(supabase);
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
    },
  });
}
