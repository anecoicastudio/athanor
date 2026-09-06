import { payoutAccountSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

/** Query-key factory (one per entity). */
export const payoutKeys = {
  all: ['payout'] as const,
  mine: () => [...payoutKeys.all, 'mine'] as const,
};

/**
 * The three fields the composer needs, picked from the full read-model rather than re-declared —
 * `stripe_account_id` is deliberately NOT among them. The client may read its own row, but the
 * account id has no use on screen and no reason to sit in a query cache.
 */
const myPayoutAccountSchema = payoutAccountSchema.pick({
  charges_enabled: true,
  payouts_enabled: true,
  onboarded_at: true,
});

export type MyPayoutAccount = {
  /** false when no row exists at all — the organiser has never started onboarding */
  hasAccount: boolean;
  /** the gate: paid events need this true, and only stripe-webhook's W13 arm ever sets it */
  payoutsEnabled: boolean;
  /** set on the first account.updated carrying details_submitted; null while Stripe is still asking */
  onboardedAt: string | null;
};

/**
 * Reads the caller's own Connect account cache. `payout_accounts` is select-own under RLS and the
 * client holds no write path at all (#245), so this is a pure read of state Stripe owns.
 *
 * No row is a legitimate answer, not an error: an organiser who has never opened the onboarding
 * flow simply has none, and that is the state the composer's CTA exists for.
 *
 * `charges_enabled` is read and deliberately not exposed. create-payout-onboarding requests only
 * the `transfers` capability, so that flag never becomes true on these accounts and anything that
 * gated on it would refuse every organiser forever. It stays in the parse so a schema drift is
 * still caught, and out of the return type so nothing can accidentally gate on it.
 */
export async function getMyPayoutAccount(client: AthanorClient): Promise<MyPayoutAccount> {
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error('not authenticated');

  const { data, error } = await client
    .from('payout_accounts')
    .select('charges_enabled,payouts_enabled,onboarded_at')
    .eq('profile_id', userData.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { hasAccount: false, payoutsEnabled: false, onboardedAt: null };

  // Parsed, never cast (rules/api.md): the flags decide whether a paid event may be published, so
  // a shape that no longer matches must fail loudly here rather than read as "not yet enabled".
  const row = myPayoutAccountSchema.parse(data);
  return {
    hasAccount: true,
    payoutsEnabled: row.payouts_enabled,
    onboardedAt: row.onboarded_at,
  };
}

/**
 * The server's `{error}` string, carried to the screen so it can say which failure this was.
 * Mirrors VerificationSessionError (`verifications.ts`) — the #103 idiom: the edge function's
 * error string is the stable contract, the screen owns the words.
 */
export class PayoutOnboardingError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`create-payout-onboarding refused: ${code} (${status})`);
    this.name = 'PayoutOnboardingError';
  }
}

/**
 * Mints a fresh Stripe Express onboarding URL through the `create-payout-onboarding` edge function
 * (Stripe keys never on the client, rule #6). Account Links are single-use and expire in minutes,
 * so every call returns a new one and none may be cached.
 *
 * The app opens the returned URL with `expo-web-browser` — the hosted-Checkout precedent, never a
 * native Stripe module (rules/mobile.md). Stripe then redirects to the `apps/web` return page,
 * which deep-links back; the flag itself flips when W13 receives `account.updated`, so the screen
 * refetches `payoutKeys.mine()` on focus rather than trusting the redirect.
 */
export async function requestPayoutOnboarding(client: AthanorClient): Promise<{ url: string }> {
  const res = await client.functions.invoke<unknown>('create-payout-onboarding', { body: {} });
  if (res.error) {
    // On a non-2xx, FunctionsHttpError hangs the Response off `.context` — the JSON body is the
    // only place the server's reason survives (#416). An unreadable body falls back to the raw
    // error, which is the same degrade path verifications.ts takes.
    const ctx = (res.error as { context?: { status?: number; json?: () => Promise<unknown> } })
      .context;
    if (ctx && typeof ctx.json === 'function' && typeof ctx.status === 'number') {
      let code: unknown;
      try {
        code = ((await ctx.json()) as { error?: unknown } | null)?.error;
      } catch {
        // body unreadable — rethrow the raw error below
      }
      if (typeof code === 'string') throw new PayoutOnboardingError(code, ctx.status);
    }
    throw res.error as Error;
  }
  const result = res.data as { url?: unknown } | null;
  if (!result || typeof result.url !== 'string') throw new Error('no onboarding url returned');
  return { url: result.url };
}
