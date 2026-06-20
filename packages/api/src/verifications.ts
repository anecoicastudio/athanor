import type { VerificationStatus } from '@athanor/schemas';
import type { AthanorClient } from './client';

/** Query-key factory (one per entity). */
export const verifyKeys = {
  all: ['verify'] as const,
  status: () => [...verifyKeys.all, 'status'] as const,
};

/**
 * Reads the caller's verification state: the server-set `profiles.identity_verified` flag plus
 * the status of their latest `verifications` row. Both are owner-readable under RLS. The client
 * never writes either — the webhook does (rule #6). limit(1) on the profile_latest index (rule #9).
 */
export async function getVerificationStatus(
  client: AthanorClient,
): Promise<{ identityVerified: boolean; latestStatus: VerificationStatus | null }> {
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error('not authenticated');
  const me = userData.user.id;

  const [{ data: profile, error: pErr }, { data: latest, error: vErr }] = await Promise.all([
    client.from('profiles').select('identity_verified').eq('id', me).maybeSingle(),
    client
      .from('verifications')
      .select('status')
      .eq('profile_id', me)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (pErr) throw pErr;
  if (vErr) throw vErr;

  return {
    identityVerified: profile?.identity_verified ?? false,
    latestStatus: (latest?.status as VerificationStatus | undefined) ?? null,
  };
}

/**
 * Starts a Stripe Identity VerificationSession server-side via the `create-verification-session`
 * edge function (Stripe keys never on the client, rule #6) and returns the hosted URL / client
 * secret. The app opens the Stripe flow, then polls `verifyKeys.status()` until W9 flips the flag.
 */
export async function requestVerification(
  client: AthanorClient,
): Promise<{ url: string } | { clientSecret: string }> {
  const { data, error } = await client.functions.invoke('create-verification-session', {
    body: {},
  });
  if (error) throw error;
  const result = data as { url: string } | { clientSecret: string } | null;
  if (!result) throw new Error('no verification session returned');
  return result;
}

/**
 * Realtime: observe the caller's own `profiles` row UPDATE so the Identità chip flips when the
 * webhook sets `identity_verified` (backend 09 C14). Returns an unsubscribe cleanup (rule: api
 * subscriptions return cleanup fns). Caller invalidates `verifyKeys.status()` in onChange.
 */
export function subscribeVerifyStatus(
  client: AthanorClient,
  me: string,
  onChange: () => void,
): () => void {
  const channel = client
    .channel(`profile:${me}:verify`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${me}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
