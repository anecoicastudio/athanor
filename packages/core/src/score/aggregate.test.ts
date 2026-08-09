import { expect, test } from 'vitest';
import { aggregateScore, bucketOf, type LedgerLine } from './aggregate';

test('type → bucket mapping', () => {
  expect(bucketOf('own_milestone')).toBe('contributi');
  expect(bucketOf('event_attended')).toBe('eventi');
  expect(bucketOf('milestone_help')).toBe('collaborazioni');
  expect(bucketOf('identity_verified')).toBe('affidabilita');
  expect(bucketOf('decay')).toBeNull();
});
test('paid-for types map to no bucket', () => {
  expect(bucketOf('circle_membership')).toBeNull();
  expect(bucketOf('fund_contribution')).toBeNull();
});
test('re-aggregation is order-independent and clamped', () => {
  const a = aggregateScore([
    { type: 'identity_verified', points: 50 },
    { type: 'milestone_help', points: 40 },
    { type: 'own_milestone', points: 10 },
  ]);
  const b = aggregateScore([
    { type: 'own_milestone', points: 10 },
    { type: 'identity_verified', points: 50 },
    { type: 'milestone_help', points: 40 },
  ]);
  expect(a).toEqual(b);
  expect(a.score).toBe(100);
  expect(a.breakdown.collaborazioni).toBe(40);
  expect(a.breakdown.affidabilita).toBe(50);
  expect(a.breakdown.contributi).toBe(10);
  expect(a.breakdown.valore).toBe(0);
  expect(a.breakdown.recensioni).toBe(0);
});
test('decay reduces headline but not buckets; score floored at 0', () => {
  const r = aggregateScore([
    { type: 'own_milestone', points: 10 },
    { type: 'decay', points: -50 },
  ]);
  expect(r.score).toBe(0); // 10 − 50 → clamp 0
  expect(r.breakdown.contributi).toBe(10);
});
// PRD §4.9: "Athanor Circle membership and fund contributions yield zero points."
// `LedgerLine.type` is a bare string, so a paid-for row can physically reach the
// aggregator — it must refuse to credit one whatever `points` it carries.
test('a circle-membership row credits nothing', () => {
  expect(aggregateScore([{ type: 'circle_membership', points: 500 }]).score).toBe(0);
});
test('a fund-contribution row credits nothing', () => {
  expect(aggregateScore([{ type: 'fund_contribution', points: 500 }]).score).toBe(0);
});
test('paid-for rows are not laundered by earned rows beside them', () => {
  const r = aggregateScore([
    { type: 'event_attended', points: 15 },
    { type: 'circle_membership', points: 500 },
    { type: 'fund_contribution', points: 500 },
  ]);
  expect(r.score).toBe(15);
});
test('a ledger summing past the maximum clamps to 1000', () => {
  const events: LedgerLine[] = Array.from({ length: 40 }, () => ({
    type: 'milestone_help',
    points: 40,
  }));
  expect(aggregateScore(events).score).toBe(1000);
});
