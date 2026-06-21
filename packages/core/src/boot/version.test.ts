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

test('fail-open: missing or non-numeric input is never "below"', () => {
  expect(isVersionBelow(undefined, '1.0.0')).toBe(false);
  expect(isVersionBelow('1.0.0', null)).toBe(false);
  expect(isVersionBelow('', '1.0.0')).toBe(false);
  expect(isVersionBelow('abc', '1.0.0')).toBe(false);
  expect(isVersionBelow('1.0.0', 'x.y.z')).toBe(false);
});
