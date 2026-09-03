import {
  type CircleMembership,
  circleMembershipSchema,
  type CircleCheckoutInput,
  type CircleCheckoutResult,
  circleCheckoutResultSchema,
  type CirclePrices,
  circlePricesSchema,
  type Entitlements,
  entitlementsSchema,
} from '@athanor/schemas';
import type { AthanorClient } from './client';

export const circleKeys = {
  all: ['circle'] as const,
  plans: () => [...circleKeys.all, 'plans'] as const,
  subscription: (profileId: string) => [...circleKeys.all, 'subscription', profileId] as const,
};

export const entitlementKeys = {
  all: ['entitlement'] as const,
  me: () => [...entitlementKeys.all, 'me'] as const,
};

/** The caller's own membership row (RLS select-own); null for non-members. */
export async function getMyMembership(
  client: AthanorClient,
  profileId: string,
): Promise<CircleMembership | null> {
  const { data, error } = await client
    .from('circle_memberships')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle();
  if (error) throw error;
  return data ? circleMembershipSchema.parse(data) : null;
}

/** Server-derived entitlements (security_invoker view → caller's own row only). */
export async function getMyEntitlements(client: AthanorClient): Promise<Entitlements | null> {
  const { data, error } = await client.from('entitlements').select('*').maybeSingle();
  if (error) throw error;
  return data ? entitlementsSchema.parse(data) : null;
}

/**
 * Open a Stripe Checkout (subscription mode) for the selected plan via create-circle-checkout.
 * No client mutation grants membership (rule #6) — circle_memberships flips only when the webhook
 * (W5/W11) lands. Returns the IAP indirection: M8 ships { kind:'url' }; { kind:'iap' } is M10.
 */
export async function startCheckout(
  client: AthanorClient,
  input: CircleCheckoutInput,
): Promise<CircleCheckoutResult> {
  const res = await client.functions.invoke<unknown>('create-circle-checkout', {
    body: { plan: input.plan },
  });
  // supabase-js types FunctionsResponse.error as `any`; every concrete case
  // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
  if (res.error) throw res.error as Error;
  return circleCheckoutResultSchema.parse(res.data);
}

/**
 * The two Circle plans' LIVE Stripe amounts, via get-circle-prices (#644).
 *
 * Rule #6 both ways: the server owns the price on the way in (`startCheckout` sends only the
 * plan) and owns it on the way out too. Nothing here may fall back to a literal — a stale
 * number rendered next to a different charge is exactly the drift this endpoint closes, so a
 * failure throws and the caller shows its error arm.
 * Query key: `circleKeys.plans()`.
 */
export async function getCirclePrices(client: AthanorClient): Promise<CirclePrices> {
  const res = await client.functions.invoke<unknown>('get-circle-prices', { body: {} });
  // supabase-js types FunctionsResponse.error as `any`; every concrete case
  // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
  if (res.error) throw res.error as Error;
  return circlePricesSchema.parse(res.data);
}

/** Open the Stripe Billing Customer Portal (plan change / card / cancel happen only there). */
export async function openCustomerPortal(client: AthanorClient): Promise<{ url: string }> {
  const res = await client.functions.invoke<unknown>('create-circle-portal', { body: {} });
  // supabase-js types FunctionsResponse.error as `any`; every concrete case
  // (FunctionsHttpError/RelayError/FetchError) extends FunctionsError extends Error.
  if (res.error) throw res.error as Error;
  const url = (res.data as { url?: string } | null)?.url;
  if (!url) throw new Error('customer portal did not return a url');
  return { url };
}

export type { CircleMembership, CirclePrices, Entitlements };
