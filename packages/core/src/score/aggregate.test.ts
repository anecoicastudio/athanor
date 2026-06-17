import { expect, test } from 'vitest';
import { aggregateScore, bucketOf } from './aggregate';

test('type → bucket mapping', () => {
  expect(bucketOf('own_milestone')).toBe('contributi');
  expect(bucketOf('event_attended')).toBe('eventi');
  expect(bucketOf('milestone_help')).toBe('collaborazioni');
  expect(bucketOf('identity_verified')).toBe('affidabilita');
  expect(bucketOf('decay')).toBeNull();
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
