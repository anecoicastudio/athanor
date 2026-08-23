import { expect, test, vi } from 'vitest';
import { makeFakeClient } from './test-support/fake-client';
import type { AthanorClient } from './client';
import {
  circleKeys,
  entitlementKeys,
  getMyEntitlements,
  getMyMembership,
  openCustomerPortal,
  startCheckout,
} from './circle';

test('circleKeys factory shape', () => {
  expect(circleKeys.subscription('p1')).toEqual(['circle', 'subscription', 'p1']);
  expect(circleKeys.plans()).toEqual(['circle', 'plans']);
});

test('entitlementKeys factory shape', () => {
  expect(entitlementKeys.me()).toEqual(['entitlement', 'me']);
});

// ---------------------------------------------------------------------------
// Behaviour. Rule #6: money state is a cache of Stripe webhooks — nothing here
// grants membership, and no price ever leaves the client.
// ---------------------------------------------------------------------------

const P = '00000000-0000-0000-0000-0000000000a1';

const membershipRow = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-0000-0000-0000000000b1',
  profile_id: P,
  stripe_customer_id: 'cus_123',
  stripe_subscription_id: 'sub_123',
  plan: 'monthly',
  status: 'active',
  current_period_end: '2026-09-01T00:00:00Z',
  cancel_at_period_end: false,
  founding_member: true,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
  ...over,
});

const entitlementsRow = (over: Record<string, unknown> = {}) => ({
  profile_id: P,
  is_member: true,
  plan: 'monthly',
  status: 'active',
  founding: true,
  advanced_filters: true,
  premium_events: true,
  analytics: true,
  market_reduced_fee: false,
  ...over,
});

function withFn(
  invoke: ReturnType<typeof vi.fn>,
  script: Record<string, { data?: unknown; error?: unknown }[]> = {},
) {
  const fake = makeFakeClient(script);
  return { fake, client: { ...fake, functions: { invoke } } as unknown as AthanorClient };
}

const asClient = (fake: ReturnType<typeof makeFakeClient>) => fake as unknown as AthanorClient;

test('startCheckout sends only the plan — the server owns the price (rule #6)', async () => {
  const invoke = vi.fn().mockResolvedValue({
    data: { kind: 'url', url: 'https://checkout.stripe/sub' },
    error: null,
  });
  const { client } = withFn(invoke);

  await expect(startCheckout(client, { plan: 'annual' })).resolves.toEqual({
    kind: 'url',
    url: 'https://checkout.stripe/sub',
  });

  const [fnName, opts] = invoke.mock.calls[0]!;
  expect(fnName).toBe('create-circle-checkout');
  expect(opts.body).toEqual({ plan: 'annual' });
  for (const forbidden of ['price', 'priceId', 'amount', 'amountCents', 'currency', 'trialDays']) {
    expect(Object.keys(opts.body as object)).not.toContain(forbidden);
  }
});

test('startCheckout grants no membership client-side — the webhook does (rule #6)', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: { kind: 'url', url: 'https://c' }, error: null });
  const { fake, client } = withFn(invoke);
  await startCheckout(client, { plan: 'monthly' });
  expect(fake.calls).toEqual([]);
});

test('startCheckout awards no Aura — Circle membership is worth zero points (PRD §4.9)', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: { kind: 'url', url: 'https://c' }, error: null });
  const { fake, client } = withFn(invoke);
  await startCheckout(client, { plan: 'monthly' });
  expect(fake.calls.filter((c) => ['aura_events', 'aura_scores'].includes(c.table))).toEqual([]);
});

test('startCheckout passes the iap branch through', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: { kind: 'iap', productId: 'circle_monthly' }, error: null });
  const { client } = withFn(invoke);
  await expect(startCheckout(client, { plan: 'monthly' })).resolves.toEqual({
    kind: 'iap',
    productId: 'circle_monthly',
  });
});

test('startCheckout rejects a result outside the checkout union', async () => {
  const invoke = vi.fn().mockResolvedValue({ data: { url: 'https://no-kind' }, error: null });
  const { client } = withFn(invoke);
  await expect(startCheckout(client, { plan: 'monthly' })).rejects.toThrow();
});

test('startCheckout surfaces an edge-function failure', async () => {
  const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('stripe down') });
  const { client } = withFn(invoke);
  await expect(startCheckout(client, { plan: 'monthly' })).rejects.toThrow();
});

test('openCustomerPortal defers plan changes and cancellation to Stripe', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: { url: 'https://billing.stripe/p' }, error: null });
  const { fake, client } = withFn(invoke);

  await expect(openCustomerPortal(client)).resolves.toEqual({ url: 'https://billing.stripe/p' });
  expect(invoke.mock.calls[0]![0]).toBe('create-circle-portal');
  expect(fake.calls).toEqual([]);
});

test('openCustomerPortal surfaces an edge-function failure', async () => {
  const invoke = vi.fn().mockResolvedValue({ data: null, error: new Error('no customer') });
  const { client } = withFn(invoke);
  await expect(openCustomerPortal(client)).rejects.toThrow();
});

test('getMyMembership reads only the caller"s own row', async () => {
  const fake = makeFakeClient({ 'circle_memberships.select': [{ data: [membershipRow()] }] });
  await expect(getMyMembership(asClient(fake), P)).resolves.toMatchObject({
    plan: 'monthly',
    status: 'active',
  });
  expect(fake.calls[0]!.filters).toEqual(expect.arrayContaining([['eq', 'profile_id', P]]));
  expect(fake.calls[0]!.op).toBe('select');
});

test('getMyMembership returns null for a non-member', async () => {
  const fake = makeFakeClient({ 'circle_memberships.select': [{ data: [] }] });
  await expect(getMyMembership(asClient(fake), P)).resolves.toBeNull();
});

test('getMyMembership throws when the database errors', async () => {
  const fake = makeFakeClient({ 'circle_memberships.select': [{ error: { message: 'boom' } }] });
  await expect(getMyMembership(asClient(fake), P)).rejects.toThrow();
});

test('getMyEntitlements reads the server-derived view rather than recomputing access', async () => {
  const fake = makeFakeClient({ 'entitlements.select': [{ data: [entitlementsRow()] }] });
  await expect(getMyEntitlements(asClient(fake))).resolves.toMatchObject({
    is_member: true,
    advanced_filters: true,
  });
  expect(fake.calls[0]!.table).toBe('entitlements');
  expect(fake.calls[0]!.op).toBe('select');
});

test('getMyEntitlements returns null when the view has no row for the caller', async () => {
  const fake = makeFakeClient({ 'entitlements.select': [{ data: [] }] });
  await expect(getMyEntitlements(asClient(fake))).resolves.toBeNull();
});

test('getMyEntitlements throws when the database errors', async () => {
  const fake = makeFakeClient({ 'entitlements.select': [{ error: { message: 'boom' } }] });
  await expect(getMyEntitlements(asClient(fake))).rejects.toThrow();
});

test('no exported call writes the membership cache (rule #6)', async () => {
  const invoke = vi
    .fn()
    .mockResolvedValue({ data: { kind: 'url', url: 'https://c' }, error: null });
  const { fake, client } = withFn(invoke, {
    'circle_memberships.select': [{ data: [membershipRow()] }],
    'entitlements.select': [{ data: [entitlementsRow()] }],
  });

  await getMyMembership(client, P);
  await getMyEntitlements(client);
  await startCheckout(client, { plan: 'monthly' });
  await openCustomerPortal(client);

  expect(fake.calls.every((c) => c.op === 'select')).toBe(true);
});
