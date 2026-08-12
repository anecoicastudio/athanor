import type { AthanorClient } from './client';

/** TanStack Query key factory (rule: per-entity factories). */
export const inviteKeys = {
  all: ['invites'] as const,
  code: () => ['invites', 'code'] as const,
};

/** Caller's stable referral code — set-once server-side, idempotent RPC. */
export async function getMyReferralCode(client: AthanorClient): Promise<string> {
  const { data, error } = await client.rpc('ensure_referral_code');
  if (error) throw error;
  return data;
}
