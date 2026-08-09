import { expect, test } from 'vitest';
import { isVersionBelow } from './version';

test('equal versions are not below', () => {
  expect(isVersionBelow('1.2.0', '1.2.0')).toBe(false);
});

test('lower patch / minor / major is below', () => {
  expect(isVersionBelow('1.2.0', '1.2.1')).toBe(true);
  expect(isVersionBelow('1.1.9', '1.2.0')).toBe(true);
  expect(isVersionBelow('0.9.0', '1.0.0')).toBe(true);
});

test('higher current is not below', () => {
  expect(isVersionBelow('2.0.0', '1.9.9')).toBe(false);
  expect(isVersionBelow('1.2.3', '1.2.0')).toBe(false);
});

test('differing segment counts compare numerically (1.2 == 1.2.0)', () => {
  expect(isVersionBelow('1.2', '1.2.0')).toBe(false);
  expect(isVersionBelow('1.2', '1.2.1')).toBe(true);
});

// Every segment above is a single digit, so a per-segment pattern narrowed to `^\d$` still
// parsed all of them. A two-digit segment is the first real release to break that: the parse
// would fail and the gate would fail open, letting an out-of-date build straight through.
test('multi-digit segments parse and compare numerically (10 > 9)', () => {
  expect(isVersionBelow('1.0.0', '1.0.10')).toBe(true);
  expect(isVersionBelow('1.0.10', '1.0.9')).toBe(false);
  expect(isVersionBelow('1.9.0', '1.10.0')).toBe(true);
});

test('fail-open: missing or non-numeric input is never "below"', () => {
  expect(isVersionBelow(undefined, '1.0.0')).toBe(false);
  expect(isVersionBelow('1.0.0', null)).toBe(false);
  expect(isVersionBelow('', '1.0.0')).toBe(false);
  expect(isVersionBelow('abc', '1.0.0')).toBe(false);
  expect(isVersionBelow('1.0.0', 'x.y.z')).toBe(false);
});

// The junk above fails the segment pattern at both ends at once, so anchoring it at only one end
// would still have rejected all of it. Whitespace is the input that separates them: `Number(' 2')`
// is 2, so a half-anchored pattern would quietly accept ' 2' as a segment and start gating users
// on a version string nobody validated. The min-version gate is fail-open by contract — a value
// this malformed must never lock anyone out.
test('fail-open: a segment padded with whitespace is malformed, not a number', () => {
  expect(isVersionBelow('1. 2', '1.3')).toBe(false);
  expect(isVersionBelow('1.2 ', '1.3')).toBe(false);
});
