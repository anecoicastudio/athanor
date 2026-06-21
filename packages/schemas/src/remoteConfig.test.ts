import { describe, expect, it } from 'vitest';
import {
  featureFlagSchema,
  maintenanceModeSchema,
  minAppVersionSchema,
  remoteConfigRowSchema,
} from './remoteConfig';

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

  it('parses a raw row (value is opaque jsonb)', () => {
    const row = remoteConfigRowSchema.parse({
      key: 'maintenance_mode',
      value: { enabled: false },
      updated_at: '2026-06-21T00:00:00Z',
    });
    expect(row.key).toBe('maintenance_mode');
  });
});
