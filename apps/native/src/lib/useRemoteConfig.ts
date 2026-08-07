import { useQuery } from '@tanstack/react-query';
import { getRemoteConfig, remoteConfigKeys, type RemoteConfigSnapshot } from '@athanor/api';
import { supabase } from './supabase';
import { saveConfigSnapshot } from './config-snapshot';

/**
 * Boot/resume read of the remote kill-switch config (force-update / maintenance / flags).
 * LAST-KNOWN-GOOD contract (RELEASE-RUNBOOK §6): every successful fetch persists a snapshot;
 * on fetch failure BootGate enforces that snapshot, failing open only on first install.
 * staleTime keeps it cheap; BootGate refetches on resume (frontend 12 §2.2).
 */
export function useRemoteConfig() {
  return useQuery<RemoteConfigSnapshot>({
    queryKey: remoteConfigKeys.boot(),
    queryFn: async () => {
      const snap = await getRemoteConfig(supabase);
      saveConfigSnapshot(snap);
      return snap;
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/** The feature-flags slice (read-only on client) — gates contributions / Prime Stelle / Fase 2 tiles (M10 R-2). */
export function useFeatureFlags(): Record<string, boolean> {
  return useRemoteConfig().data?.flags ?? {};
}
