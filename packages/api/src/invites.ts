import type { AthanorClient } from './client';

/** TanStack Query key factory (rule: per-entity factories). */
export const inviteKeys = {
  all: ['invites'] as const,
  code: () => ['invites', 'code'] as const,
  stats: () => ['invites', 'stats'] as const,
};

/** Caller's stable referral code — set-once server-side, idempotent RPC. */
export async function getMyReferralCode(client: AthanorClient): Promise<string> {
  const { data, error } = await client.rpc('ensure_referral_code');
  if (error) throw error;
  return data as string;
}

/** Owner-private activation count (RLS select_party scopes to own rows). Never public (rule #3). */
export async function getInviteStats(client: AthanorClient): Promise<{ activated: number }> {
  const { count, error } = await client
    .from('invites')
    .select('id', { count: 'exact', head: true })
    .not('activated_at', 'is', null);
  if (error) throw error;
  return { activated: count ?? 0 };
}
