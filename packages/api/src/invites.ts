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

/**
 * Owner-private activation count: invites the caller SENT that activated. Never public
 * (rule #3). select_party RLS also returns rows where the caller is the INVITEE, so this
 * must scope to `inviter_id` explicitly — otherwise an invited (not inviting) user's own
 * activated-invite row would inflate their own count to 1.
 */
export async function getInviteStats(
  client: AthanorClient,
  profileId: string,
): Promise<{ activated: number }> {
  const { count, error } = await client
    .from('invites')
    .select('id', { count: 'exact', head: true })
    .eq('inviter_id', profileId)
    .not('activated_at', 'is', null);
  if (error) throw error;
  return { activated: count ?? 0 };
}
