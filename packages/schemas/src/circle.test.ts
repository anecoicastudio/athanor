import { describe, expect, test } from 'vitest';
import {
  circleCheckoutInputSchema,
  circleCheckoutResultSchema,
  circleMembershipSchema,
  circlePlanSchema,
  circleStatusSchema,
} from './circle';

describe('circle schemas', () => {
  test('parses a valid membership row', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      profile_id: '00000000-0000-0000-0000-000000000002',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
      plan: 'monthly',
      status: 'active',
      current_period_end: '2026-12-31T00:00:00Z',
      founding_member: true,
      created_at: '2026-06-18T00:00:00Z',
      updated_at: '2026-06-18T00:00:00Z',
    };
    expect(circleMembershipSchema.parse(row).plan).toBe('monthly');
  });

  test('rejects an unknown plan', () => {
    expect(() => circleCheckoutInputSchema.parse({ plan: 'lifetime' })).toThrow();
  });

  test('accepts both checkout-result kinds (iOS IAP indirection)', () => {
    expect(circleCheckoutResultSchema.parse({ kind: 'url', url: 'https://x' }).kind).toBe('url');
    expect(circleCheckoutResultSchema.parse({ kind: 'iap', productId: 'p' }).kind).toBe('iap');
  });
});

// The Stripe subscription mirror — the literal list, never a loop over the constant.
describe('circle vocabularies', () => {
  test('plan is monthly | annual', () => {
    expect(circlePlanSchema.options).toEqual(['monthly', 'annual']);
  });

  test('status is active | past_due | canceled | incomplete — the four the webhook caches', () => {
    expect(circleStatusSchema.options).toEqual(['active', 'past_due', 'canceled', 'incomplete']);
    for (const bad of ['trialing', 'unpaid', 'cancelled', '']) {
      expect(circleStatusSchema.safeParse(bad).success).toBe(false);
    }
  });
});
