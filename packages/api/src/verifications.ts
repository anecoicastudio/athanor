import type { VerificationStatus } from '@athanor/schemas';
import type { AthanorClient } from './client';
import { channelTopic } from './realtime';

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
 * The server's `{error}` string, carried to the screen so it can say which failure this was
 * (#416). Mirrors ContributionSessionError (`fund.ts`) — the #103 idiom: the edge function's
 * error string is the stable contract, the screen owns the words.
 */
export class VerificationSessionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`create-verification-session refused: ${code} (${status})`);
    this.name = 'VerificationSessionError';
  }
}

/**
 * Starts a Stripe Identity VerificationSession server-side via the `create-verification-session`
 * edge function (Stripe keys never on the client, rule #6) and returns the hosted URL / client
 * secret. The app opens the Stripe flow, then polls `verifyKeys.status()` until W9 flips the flag.
 */
export async function requestVerification(
  client: AthanorClient,
): Promise<{ url: string } | { clientSecret: string }> {
  const res = await client.functions.invoke<unknown>('create-verification-session', { body: {} });
  if (res.error) {
    // On a non-2xx, FunctionsHttpError hangs the Response off `.context` — the JSON body is the
    // only place the server's reason survives. Before #416 nobody read it, so «Riprova» was the
    // only thing the sheet could ever say. An unreadable body falls back to the raw error.
    const ctx = (res.error as { context?: { status?: number; json?: () => Promise<unknown> } })
      .context;
    if (ctx && typeof ctx.json === 'function' && typeof ctx.status === 'number') {
      let code: unknown;
      try {
        code = ((await ctx.json()) as { error?: unknown } | null)?.error;
      } catch {
        // body unreadable — rethrow the raw error below
      }
      if (typeof code === 'string') throw new VerificationSessionError(code, ctx.status);
    }
    // supabase-js types FunctionsResponse.error as `any`; every concrete case
    // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
    throw res.error as Error;
  }
  const result = res.data as { url: string } | { clientSecret: string } | null;
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
    .channel(channelTopic(`profile:${me}:verify`))
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
