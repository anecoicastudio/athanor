import { getMyReferralCode, inviteKeys } from '@athanor/api';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * The caller's stable referral code, appended to every share link (P4.1). Set-once server-side
 * through an idempotent RPC, so the four surfaces that share it — Impostazioni' invite row,
 * `InviteCard`, `PrimeStelleCard` and the fund's `ViralCard` — mint it at most once between them.
 *
 * `enabled` exists because two of those cards sit behind a feature flag and the RPC WRITES on
 * first call: firing it from a card that never renders would create a code for a member who was
 * never offered one.
 */
export function referralCodeQuery(enabled = true) {
  return queryOptions({
    queryKey: inviteKeys.code(),
    queryFn: () => getMyReferralCode(supabase),
    enabled,
  });
}

export function useReferralCode(enabled = true) {
  return useQuery(referralCodeQuery(enabled));
}
