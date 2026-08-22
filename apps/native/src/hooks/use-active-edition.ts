import { getActiveEdition, fundKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * The current non-closed fund cycle — `fund_editions_one_active` guarantees at most one (#215),
 * which is why the key takes no id and every fund surface shares the single entry: Home's hero,
 * the annual screen, the candidacy wizard, a candidacy detail, the plan, the progress screen and
 * the contribution disclosure. Several of them invalidate `fundKeys.activeEdition()` when the
 * server refuses on a stale window, and that only reconciles the others because the key is one.
 *
 * The cycle RULES live in `@athanor/core` (`fund/phase.ts`) — this hook moves wiring only.
 */
export function activeEditionQuery() {
  return queryOptions({
    queryKey: fundKeys.activeEdition(),
    queryFn: () => getActiveEdition(supabase),
  });
}

/**
 * `refetchInterval` is per-observer, so Home can poll the shared entry for its live ticker
 * without every other screen inheriting the poll.
 */
export function useActiveEdition(overrides?: { refetchInterval?: number }) {
  return useQuery({ ...activeEditionQuery(), ...overrides });
}
