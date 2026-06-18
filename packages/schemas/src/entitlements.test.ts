import { expect, test } from 'vitest';
import { entitlementsSchema } from './entitlements';

test('parses a non-member row (null plan/status)', () => {
  const e = entitlementsSchema.parse({
    profile_id: '00000000-0000-0000-0000-000000000002',
    is_member: false,
    plan: null,
    status: null,
    founding: false,
    advanced_filters: false,
    premium_events: false,
    analytics: false,
    market_reduced_fee: false,
  });
  expect(e.is_member).toBe(false);
});
