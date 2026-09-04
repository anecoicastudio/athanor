import { describe, expect, test } from 'vitest';
import {
  circleCheckoutInputSchema,
  circleCheckoutResultSchema,
  circlePriceSchema,
  circlePricesSchema,
  circleMembershipSchema,
  circlePlanSchema,
  circleStatusSchema,
} from './circle.ts';

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
      cancel_at_period_end: false,
      founding_member: true,
      created_at: '2026-06-18T00:00:00Z',
      updated_at: '2026-06-18T00:00:00Z',
    };
    expect(circleMembershipSchema.parse(row).plan).toBe('monthly');
  });

  // #511 — the app can only tell «renews on» from «ends on» if this field survives the parse.
  // Zod strips unknown keys, so a column missing from the schema is invisible to every caller;
  // that silent strip is exactly how the bug shipped, and this is what would catch it again.
  test('keeps the pending-cancellation flag rather than stripping it', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      profile_id: '00000000-0000-0000-0000-000000000002',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
      plan: 'annual',
      status: 'active',
      current_period_end: '2026-12-31T00:00:00Z',
      cancel_at_period_end: true,
      founding_member: false,
      created_at: '2026-06-18T00:00:00Z',
      updated_at: '2026-06-18T00:00:00Z',
    };
    const parsed = circleMembershipSchema.parse(row);
    expect(parsed.cancel_at_period_end).toBe(true);
    expect(parsed.status).toBe('active'); // still a member for the period already paid for
  });

  test('rejects a membership row missing the pending-cancellation flag', () => {
    const { cancel_at_period_end: _omitted, ...row } = {
      id: '00000000-0000-0000-0000-000000000001',
      profile_id: '00000000-0000-0000-0000-000000000002',
      stripe_customer_id: 'cus_x',
      stripe_subscription_id: 'sub_x',
      plan: 'monthly',
      status: 'active',
      current_period_end: '2026-12-31T00:00:00Z',
      cancel_at_period_end: false,
      founding_member: true,
      created_at: '2026-06-18T00:00:00Z',
      updated_at: '2026-06-18T00:00:00Z',
    };
    expect(() => circleMembershipSchema.parse(row)).toThrow();
  });

  test('rejects an unknown plan', () => {
    expect(() => circleCheckoutInputSchema.parse({ plan: 'lifetime' })).toThrow();
  });

  test('accepts both checkout-result kinds (iOS IAP indirection)', () => {
    expect(circleCheckoutResultSchema.parse({ kind: 'url', url: 'https://x' }).kind).toBe('url');
    expect(circleCheckoutResultSchema.parse({ kind: 'iap', productId: 'p' }).kind).toBe('iap');
  });
});

// #644 — the live-amount boundary. The CTA and the savings line are rendered from these two
// numbers, so a shape that parses loosely is a wrong price on a purchase screen.
describe('circlePricesSchema', () => {
  const eur = { unitAmount: 1200, currency: 'eur' };

  test('accepts the shape get-circle-prices serves', () => {
    const parsed = circlePricesSchema.parse({
      monthly: eur,
      annual: { unitAmount: 9900, currency: 'eur' },
    });
    expect(parsed.monthly.unitAmount).toBe(1200);
    expect(parsed.annual.currency).toBe('eur');
  });

  test('accepts a free plan, because zero is a price', () => {
    expect(circlePriceSchema.parse({ unitAmount: 0, currency: 'eur' }).unitAmount).toBe(0);
  });

  test('rejects a negative or fractional amount — Stripe unit_amount is a whole minor unit', () => {
    for (const unitAmount of [-1, 12.5]) {
      expect(circlePriceSchema.safeParse({ unitAmount, currency: 'eur' }).success).toBe(false);
    }
  });

  test('rejects an amount that arrived as a string', () => {
    // The failure this catches: `'1200'` renders as «€12,00» through a cast and as NaN through
    // arithmetic, so the CTA would be right and the savings line silently wrong.
    expect(circlePriceSchema.safeParse({ unitAmount: '1200', currency: 'eur' }).success).toBe(
      false,
    );
  });

  test('rejects a currency that is not a three-letter ISO code', () => {
    for (const currency of ['', 'e', 'euro']) {
      expect(circlePriceSchema.safeParse({ unitAmount: 1200, currency }).success).toBe(false);
    }
  });

  test('rejects a half-served pair — one plan missing is not a usable price screen', () => {
    expect(circlePricesSchema.safeParse({ monthly: eur }).success).toBe(false);
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
