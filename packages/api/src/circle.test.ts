import { expect, test } from 'vitest';
import { circleKeys, entitlementKeys } from './circle';

test('circleKeys factory shape', () => {
  expect(circleKeys.subscription('p1')).toEqual(['circle', 'subscription', 'p1']);
  expect(circleKeys.plans()).toEqual(['circle', 'plans']);
});

test('entitlementKeys factory shape', () => {
  expect(entitlementKeys.me()).toEqual(['entitlement', 'me']);
});
