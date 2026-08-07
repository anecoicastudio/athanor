import { expect, test } from 'vitest';
import { resolveBootDecision } from './decision';
import type { GateSnapshot } from './decision';

const okSnapshot: GateSnapshot = {
  minAppVersion: { ios: '1.0.0', android: '1.0.0' },
  maintenance: { enabled: false, eta: null },
};

const maintenanceSnapshot: GateSnapshot = {
  minAppVersion: { ios: '1.0.0', android: '1.0.0' },
  maintenance: { enabled: true, eta: '2026-08-07T22:00:00Z' },
};

const forceUpdateSnapshot: GateSnapshot = {
  minAppVersion: { ios: '2.0.0', android: '2.0.0' },
  maintenance: { enabled: false, eta: null },
};

const base = {
  platform: 'ios' as const,
  currentVersion: '1.0.0',
  fresh: null,
  fetchState: 'pending' as const,
  cached: 'loading' as const,
  timedOut: false,
  serverRejectedVersion: false,
};

test('fresh data all clear → ok', () => {
  expect(resolveBootDecision({ ...base, fresh: okSnapshot, fetchState: 'success' })).toEqual({
    kind: 'ok',
  });
});

test('fresh maintenance gates regardless of cache or fetch state', () => {
  expect(
    resolveBootDecision({ ...base, fresh: maintenanceSnapshot, fetchState: 'success' }),
  ).toEqual({
    kind: 'maintenance',
    eta: '2026-08-07T22:00:00Z',
  });
});

test('fresh below-min version → force-update', () => {
  expect(
    resolveBootDecision({ ...base, fresh: forceUpdateSnapshot, fetchState: 'success' }),
  ).toEqual({
    kind: 'force-update',
  });
});

test('hydrated fresh data while refetching (pending) still gates', () => {
  // PersistQueryClientProvider can hydrate data while a refetch is in flight.
  expect(
    resolveBootDecision({ ...base, fresh: maintenanceSnapshot, fetchState: 'pending' }),
  ).toEqual({
    kind: 'maintenance',
    eta: '2026-08-07T22:00:00Z',
  });
});

test('fetch error + cached snapshot → gates on cache (last-known-good)', () => {
  expect(
    resolveBootDecision({ ...base, fetchState: 'error', cached: maintenanceSnapshot }),
  ).toEqual({
    kind: 'maintenance',
    eta: '2026-08-07T22:00:00Z',
  });
});

test('fetch error + cached force-update snapshot → force-update from cache', () => {
  expect(
    resolveBootDecision({ ...base, fetchState: 'error', cached: forceUpdateSnapshot }),
  ).toEqual({
    kind: 'force-update',
  });
});

test('fetch error + no snapshot (first install) → ok (fail-open)', () => {
  expect(resolveBootDecision({ ...base, fetchState: 'error', cached: null })).toEqual({
    kind: 'ok',
  });
});

test('fetch error + snapshot still loading → waiting', () => {
  expect(resolveBootDecision({ ...base, fetchState: 'error', cached: 'loading' })).toEqual({
    kind: 'waiting',
  });
});

test('fetch error + snapshot still loading + timed out → ok (fail-open)', () => {
  expect(
    resolveBootDecision({ ...base, fetchState: 'error', cached: 'loading', timedOut: true }),
  ).toEqual({ kind: 'ok' });
});

test('pending + cached snapshot → gates on cache immediately (no wait)', () => {
  expect(resolveBootDecision({ ...base, cached: maintenanceSnapshot })).toEqual({
    kind: 'maintenance',
    eta: '2026-08-07T22:00:00Z',
  });
});

test('pending + cached ok snapshot → ok immediately', () => {
  expect(resolveBootDecision({ ...base, cached: okSnapshot })).toEqual({ kind: 'ok' });
});

test('pending + no snapshot → waiting until timeout', () => {
  expect(resolveBootDecision({ ...base, cached: null })).toEqual({ kind: 'waiting' });
  expect(resolveBootDecision({ ...base, cached: 'loading' })).toEqual({ kind: 'waiting' });
});

test('pending + no snapshot + timed out → ok (fail-open)', () => {
  expect(resolveBootDecision({ ...base, cached: null, timedOut: true })).toEqual({ kind: 'ok' });
  expect(resolveBootDecision({ ...base, cached: 'loading', timedOut: true })).toEqual({
    kind: 'ok',
  });
});

test('server rejection upgrades ok → force-update', () => {
  expect(
    resolveBootDecision({
      ...base,
      fresh: okSnapshot,
      fetchState: 'success',
      serverRejectedVersion: true,
    }),
  ).toEqual({ kind: 'force-update' });
});

test('server rejection with no config at all → force-update', () => {
  expect(
    resolveBootDecision({
      ...base,
      fetchState: 'error',
      cached: null,
      serverRejectedVersion: true,
    }),
  ).toEqual({ kind: 'force-update' });
});

test('maintenance still wins over server rejection', () => {
  expect(
    resolveBootDecision({
      ...base,
      fresh: maintenanceSnapshot,
      fetchState: 'success',
      serverRejectedVersion: true,
    }),
  ).toEqual({ kind: 'maintenance', eta: '2026-08-07T22:00:00Z' });
});

test('maintenance eta passthrough is null when absent', () => {
  const snap: GateSnapshot = { minAppVersion: null, maintenance: { enabled: true, eta: null } };
  expect(resolveBootDecision({ ...base, fresh: snap, fetchState: 'success' })).toEqual({
    kind: 'maintenance',
    eta: null,
  });
});

test('missing current version never force-updates (fail-open, matches gate.ts)', () => {
  expect(
    resolveBootDecision({
      ...base,
      currentVersion: undefined,
      fresh: forceUpdateSnapshot,
      fetchState: 'success',
    }),
  ).toEqual({ kind: 'ok' });
});
