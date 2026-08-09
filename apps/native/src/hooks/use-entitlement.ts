import { useQuery } from '@tanstack/react-query';
import { entitlementKeys, getMyEntitlements } from '@athanor/api';
import { type EntitlementView, toEntitlementView } from '@/lib/entitlement';
import { supabase } from '@/lib/supabase';

export type { EntitlementView };

/**
 * Read the caller's Circle entitlements from the server-derived `entitlements` view.
 * The snake_case → camelCase mapping (and its fail-safe defaults) lives in
 * `@/lib/entitlement`. staleTime 30s — invalidated on Checkout/Portal return so
 * membership state always reflects the latest webhook.
 * Mirrors the supabase + useAuth pattern from apps/native/src/app/(modal)/annual.tsx.
 */
export function useEntitlement() {
  return useQuery({
    queryKey: entitlementKeys.me(),
    staleTime: 30_000,
    queryFn: async (): Promise<EntitlementView> =>
      toEntitlementView(await getMyEntitlements(supabase)),
  });
}
