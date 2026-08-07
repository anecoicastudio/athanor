import AsyncStorage from '@react-native-async-storage/async-storage';
import { remoteConfigSnapshotSchema } from '@athanor/schemas';
import type { RemoteConfigSnapshot } from '@athanor/api';
import type { GateSnapshot } from '@athanor/core';

/**
 * Last-known-good remote-config snapshot (LKG contract — RELEASE-RUNBOOK §6).
 * Written on every successful fetch, read once at BootGate mount. Deliberately NOT
 * the TanStack persisted cache: that one expires (24h gcTime), restores async, and
 * isn't validated on read. This snapshot never expires.
 *
 * `flags` are persisted but deliberately NOT served from here: feature flags fail
 * CLOSED on fetch error (useFeatureFlags falls back to {}) — a legal/cohort gate
 * (fund contributions, Prime Stelle) must never turn ON from a stale snapshot.
 * Only the blocking gate inputs (min version, maintenance) are enforced from cache.
 */
const LKG_KEY = 'athanor.remote-config.lkg.v1';

export function saveConfigSnapshot(snap: RemoteConfigSnapshot): void {
  const payload = { ...snap, savedAt: new Date().toISOString() };
  AsyncStorage.setItem(LKG_KEY, JSON.stringify(payload)).catch(() => {
    // Fire-and-forget: a failed write just means the previous snapshot stays in place.
  });
}

export async function loadConfigSnapshot(): Promise<GateSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(LKG_KEY);
    if (!raw) return null;
    const parsed = remoteConfigSnapshotSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    return { minAppVersion: parsed.data.minAppVersion, maintenance: parsed.data.maintenance };
  } catch {
    return null;
  }
}
