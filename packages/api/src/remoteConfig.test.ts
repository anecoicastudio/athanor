import { describe, expect, it } from 'vitest';
import { getRemoteConfig, remoteConfigKeys } from './remoteConfig';
import type { AthanorClient } from './client';

function stub(rows: Array<{ key: string; value: unknown; updated_at: string }>): AthanorClient {
  return {
    from: () => ({ select: async () => ({ data: rows, error: null }) }),
  } as unknown as AthanorClient;
}

describe('remoteConfigKeys', () => {
  it('boot key is stable', () => {
    expect(remoteConfigKeys.boot()).toEqual(['remoteConfig', 'boot']);
  });
});

describe('getRemoteConfig', () => {
  it('maps the well-known keys + collects flags', async () => {
    const snap = await getRemoteConfig(
      stub([
        { key: 'min_app_version', value: { ios: '1.2.0', android: '1.2.0' }, updated_at: 't' },
        { key: 'maintenance_mode', value: { enabled: true, eta: '18:00' }, updated_at: 't' },
        { key: 'prime_stelle_enabled', value: { enabled: false }, updated_at: 't' },
        { key: 'fund_contributions_enabled', value: { enabled: true }, updated_at: 't' },
      ]),
    );
    expect(snap.minAppVersion).toEqual({ ios: '1.2.0', android: '1.2.0' });
    expect(snap.maintenance).toEqual({ enabled: true, eta: '18:00' });
    expect(snap.flags).toEqual({ prime_stelle_enabled: false, fund_contributions_enabled: true });
  });

  it('fail-open: empty table → all null / empty flags', async () => {
    const snap = await getRemoteConfig(stub([]));
    expect(snap).toEqual({ minAppVersion: null, maintenance: null, flags: {} });
  });

  it('fail-open: a malformed row is skipped, not thrown', async () => {
    const snap = await getRemoteConfig(
      stub([{ key: 'min_app_version', value: { ios: 1 }, updated_at: 't' }]),
    );
    expect(snap.minAppVersion).toBeNull();
  });
});
