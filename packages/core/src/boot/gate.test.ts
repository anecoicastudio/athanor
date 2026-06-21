import { expect, test } from 'vitest';
import { resolveBootGate } from './gate';

const base = {
  platform: 'ios' as const,
  currentVersion: '1.0.0',
  minAppVersion: { ios: '1.0.0', android: '1.0.0' },
  maintenance: { enabled: false },
};

test('all clear → ok', () => {
  expect(resolveBootGate(base)).toBe('ok');
});

test('below the platform min → force-update', () => {
  expect(resolveBootGate({ ...base, currentVersion: '0.9.0' })).toBe('force-update');
});

test('uses the per-platform min', () => {
  const cfg = {
    ...base,
    platform: 'android' as const,
    currentVersion: '1.1.0',
    minAppVersion: { ios: '2.0.0', android: '1.0.0' },
  };
  expect(resolveBootGate(cfg)).toBe('ok'); // android min is 1.0.0, current 1.1.0
});

test('maintenance wins over an outdated version', () => {
  expect(
    resolveBootGate({ ...base, currentVersion: '0.1.0', maintenance: { enabled: true } }),
  ).toBe('maintenance');
});

test('fail-open: null config → ok', () => {
  expect(resolveBootGate({ ...base, minAppVersion: null, maintenance: null })).toBe('ok');
});

test('fail-open: missing current version never force-updates', () => {
  expect(resolveBootGate({ ...base, currentVersion: undefined })).toBe('ok');
});
