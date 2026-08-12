import { expect, test } from 'vitest';
import { applyCap } from './caps.ts';
import { pointsFor, type AwardContext } from './award.ts';
import type { ScoringType } from './weights.ts';

// Walk N qualifying events of one type, asking the cap whether the i-th is still inside
// the allowance and summing what is awarded. Deliberately timestamp-free: the window
// semantics of PRD §4.9 ("per week", "per month") are not defined in this package, so
// composing on the index cannot bless one reading of them over another.
function ledgerTotal(type: ScoringType, count: number, ctx: AwardContext = {}): number {
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    total += pointsFor(type, { ...ctx, withinCap: applyCap(type, i) });
  }
  return total;
}

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
// The cap has to stop points accruing, not merely report false — so these compose it with
// the award. Totals are the PRD §4.9 allowances: identity once, 4 check-ins, 2 organized
// events, 10 momento conversations.
test('identity pays 50 once, not 100 twice', () => {
  expect(ledgerTotal('identity_verified', 2)).toBe(50);
});
test('a 5th check-in inside the window pays nothing', () => {
  expect(ledgerTotal('event_attended', 5)).toBe(60);
});
test('a 3rd organized event inside the window pays nothing', () => {
  expect(ledgerTotal('event_organized', 3)).toBe(60);
});
test('an 11th momento conversation inside the window pays nothing', () => {
  expect(ledgerTotal('momento_conversation', 11)).toBe(50);
});
// Stated as a count of 10, so this asserts the 11th adds nothing without naming a per-✦
// value — the reviewer weighting that decides that value is unspecified.
test('an 11th ✦ inside the window pays nothing', () => {
  const ten = ledgerTotal('post_starred', 10, { reviewerScore: 301 });
  expect(ten).toBeGreaterThan(0);
  expect(ledgerTotal('post_starred', 11, { reviewerScore: 301 })).toBe(ten);
});
test('milestone help stays uncapped across a long run', () => {
  expect(ledgerTotal('milestone_help', 50)).toBe(2000);
});
