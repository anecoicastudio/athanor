import { featureFlagSchema, maintenanceModeSchema, minAppVersionSchema } from '@athanor/schemas';
import type { AthanorClient } from './client';

/** Query-key factory (one per entity). The boot gate reads a single bounded snapshot. */
export const remoteConfigKeys = {
  all: ['remoteConfig'] as const,
  boot: () => [...remoteConfigKeys.all, 'boot'] as const,
};

export interface RemoteConfigSnapshot {
  minAppVersion: { ios: string; android: string } | null;
  maintenance: { enabled: boolean; eta: string | null } | null;
  /** Feature-flag key → enabled. (e.g. `prime_stelle_enabled`, `fund_surfaces_enabled`.) */
  flags: Record<string, boolean>;
}

/**
 * Reads the whole `remote_config` table (public-read; read pre-auth at boot — frontend 12 §2.1)
 * and narrows the well-known keys through their zod shapes. This is a bounded config table (a few
 * well-known keys), so a full select is correct — rule #9 (cursor pagination) governs user-data
 * lists, not this. DEFENSIVE: a row that fails its shape parse is skipped, never thrown, so one bad
 * value can't blank the gate (fail-open, paired with resolveBootGate's fail-open).
 */
export async function getRemoteConfig(client: AthanorClient): Promise<RemoteConfigSnapshot> {
  const { data, error } = await client.from('remote_config').select('key, value, updated_at');
  if (error) throw error;

  const snap: RemoteConfigSnapshot = { minAppVersion: null, maintenance: null, flags: {} };
  for (const row of data ?? []) {
    if (row.key === 'min_app_version') {
      const r = minAppVersionSchema.safeParse(row.value);
      if (r.success) snap.minAppVersion = r.data;
    } else if (row.key === 'maintenance_mode') {
      const r = maintenanceModeSchema.safeParse(row.value);
      if (r.success) snap.maintenance = { enabled: r.data.enabled, eta: r.data.eta ?? null };
    } else {
      const r = featureFlagSchema.safeParse(row.value);
      if (r.success) snap.flags[row.key] = r.data.enabled;
    }
  }
  return snap;
}
