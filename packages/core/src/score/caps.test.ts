import { expect, test } from 'vitest';
import { applyCap } from './caps';

test('capped type within window is awardable', () => {
  expect(applyCap('event_attended', 3)).toBe(true); // limit 4 → prior 3 ok
});
test('capped type at/over the limit is not awardable', () => {
  expect(applyCap('event_attended', 4)).toBe(false);
  expect(applyCap('post_starred', 10)).toBe(false);
});
test('identity is lifetime-capped at 1', () => {
  expect(applyCap('identity_verified', 0)).toBe(true);
  expect(applyCap('identity_verified', 1)).toBe(false);
});
test('uncapped types are always awardable', () => {
  expect(applyCap('milestone_help', 999)).toBe(true);
  expect(applyCap('own_milestone', 999)).toBe(true);
});
