import { expect, test } from 'vitest';
import { applyCap } from './caps';

test('capped type within window is awardable', () => {
  expect(applyCap('EVENT_ATTENDED', 3)).toBe(true); // limit 4 → prior 3 ok
});
test('capped type at/over the limit is not awardable', () => {
  expect(applyCap('EVENT_ATTENDED', 4)).toBe(false);
  expect(applyCap('POST_REACTION', 10)).toBe(false);
});
test('identity is lifetime-capped at 1', () => {
  expect(applyCap('IDENTITY_VERIFIED', 0)).toBe(true);
  expect(applyCap('IDENTITY_VERIFIED', 1)).toBe(false);
});
test('uncapped types are always awardable', () => {
  expect(applyCap('MILESTONE_HELP', 999)).toBe(true);
  expect(applyCap('OWN_MILESTONE', 999)).toBe(true);
});
