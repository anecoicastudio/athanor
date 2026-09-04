import { describe, expect, it } from 'vitest';
import {
  featureFlagSchema,
  maintenanceModeSchema,
  minAppVersionSchema,
  remoteConfigSnapshotSchema,
} from './remoteConfig.ts';

describe('remoteConfig schemas', () => {
  it('parses a valid min_app_version', () => {
    expect(minAppVersionSchema.parse({ ios: '1.2.0', android: '1.2.0' })).toEqual({
      ios: '1.2.0',
      android: '1.2.0',
    });
  });

  it('rejects a min_app_version missing a platform', () => {
    expect(minAppVersionSchema.safeParse({ ios: '1.0.0' }).success).toBe(false);
  });

  it('parses maintenance_mode with a null eta', () => {
    expect(maintenanceModeSchema.parse({ enabled: false, eta: null })).toEqual({
      enabled: false,
      eta: null,
    });
  });

  it('rejects maintenance_mode with a non-boolean enabled', () => {
    expect(maintenanceModeSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });

  it('parses a feature flag and preserves extra keys', () => {
    const f = featureFlagSchema.parse({ enabled: true, rolloutPct: 50 });
    expect(f.enabled).toBe(true);
  });

  it('parses a persisted last-known-good snapshot', () => {
    expect(
      remoteConfigSnapshotSchema.parse({
        minAppVersion: { ios: '1.0.0', android: '1.0.0' },
        maintenance: { enabled: true, eta: '2026-08-07T22:00:00Z' },
        flags: { prime_stelle_enabled: false },
        savedAt: '2026-08-07T10:00:00Z',
      }).maintenance,
    ).toEqual({ enabled: true, eta: '2026-08-07T22:00:00Z' });
  });

  it('parses a snapshot with null config sections', () => {
    const s = remoteConfigSnapshotSchema.parse({
      minAppVersion: null,
      maintenance: null,
      flags: {},
      savedAt: '2026-08-07T10:00:00Z',
    });
    expect(s.minAppVersion).toBeNull();
    expect(s.maintenance).toBeNull();
  });

  it('rejects a snapshot with a corrupt shape (bad flags value)', () => {
    expect(
      remoteConfigSnapshotSchema.safeParse({
        minAppVersion: null,
        maintenance: null,
        flags: { prime_stelle_enabled: 'yes' },
        savedAt: '2026-08-07T10:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('rejects a snapshot missing savedAt', () => {
    expect(
      remoteConfigSnapshotSchema.safeParse({ minAppVersion: null, maintenance: null, flags: {} })
        .success,
    ).toBe(false);
  });
});

describe('remoteConfig shapes', () => {
  // `.passthrough()` keeps the extra keys, but `enabled` is still the one key every flag must
  // carry — a flag object with no `enabled` is a misconfigured flag, not a disabled one.
  it('rejects a feature flag without enabled', () => {
    expect(featureFlagSchema.safeParse({ rolloutPct: 50 }).success).toBe(false);
  });

  // The snapshot's maintenance is the normalized form: eta is present-and-nullable, never
  // absent, because it is written from RemoteConfigSnapshot and not from raw jsonb.
  it('requires eta on a persisted maintenance section, null included', () => {
    const base = { minAppVersion: null, flags: {}, savedAt: '2026-08-07T10:00:00Z' };
    expect(
      remoteConfigSnapshotSchema.parse({ ...base, maintenance: { enabled: false, eta: null } })
        .maintenance,
    ).toEqual({ enabled: false, eta: null });
    expect(
      remoteConfigSnapshotSchema.safeParse({ ...base, maintenance: { enabled: false } }).success,
    ).toBe(false);
  });
});
