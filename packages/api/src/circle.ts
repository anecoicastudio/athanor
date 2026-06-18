import {
  type CircleMembership,
  circleMembershipSchema,
  type CircleCheckoutInput,
  type CircleCheckoutResult,
  circleCheckoutResultSchema,
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
  const { data, error } = await client.functions.invoke('create-circle-checkout', {
    body: { plan: input.plan },
  });
  if (error) throw error;
  return circleCheckoutResultSchema.parse(data);
}

/** Open the Stripe Billing Customer Portal (plan change / card / cancel happen only there). */
export async function openCustomerPortal(client: AthanorClient): Promise<{ url: string }> {
  const { data, error } = await client.functions.invoke('create-circle-portal', { body: {} });
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error('customer portal did not return a url');
  return { url };
}

export type { CircleMembership, Entitlements };
