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

/**
 * Redeem a stashed invite code for the caller (#78). The only redemption path an OAuth signup
 * has: Google and Apple carry no `referral_code` in user_metadata, and the two auth.users
 * triggers can only redeem what that metadata carries.
 *
 * Server-side and confirmation-gated, like the trigger path it backs up: the RPC derives the
 * invitee from `auth.uid()` rather than from an argument, refuses an unconfirmed caller, one
 * already attributed, or an account past the age window, and writes `invites` through the
 * same SECURITY DEFINER body the triggers use — clients hold no INSERT on that table.
 *
 * Resolving means the server ruled, not that an invite was created: every refusal is a silent
 * no-op. Callers treat a rejection as "no verdict yet" and nothing else.
 *
 * One cost of the confirmation gate, named rather than missed: a provider that hands back an
 * unverified address leaves the member unconfirmed, so this refuses and the caller drops the
 * stash — attribution is lost rather than deferred. Google and Apple both verify, so the case
 * is theoretical; signalling it back would mean giving this RPC a return value, and a refusal
 * the client can distinguish is a stash the client keeps, which is the mis-attribution the
 * single consumer exists to prevent.
 */
export async function redeemPendingReferral(client: AthanorClient, code: string): Promise<void> {
  const { error } = await client.rpc('redeem_pending_referral', { p_code: code });
  if (error) throw error;
}
