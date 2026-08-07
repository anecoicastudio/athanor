import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { resolveBootDecision, type GateSnapshot } from '@athanor/core';
import { View } from '@/tw';
import { useRemoteConfig } from '@/hooks/use-remote-config';
import { loadConfigSnapshot } from '@/lib/config-snapshot';
import { isClientOutdated, subscribeClientOutdated } from '@/lib/outdated-client';
import { ForceUpdateScreen } from '@/components/boot/ForceUpdateScreen';
import { MaintenanceScreen } from '@/components/boot/MaintenanceScreen';

/** Boot budget: how long the gate may hold a blank view (under BrandSplash) before failing open. */
const BOOT_TIMEOUT_MS = 3000;

/**
 * Boot/resume kill-switch gate (frontend 12 §2.1/§2.2/§10). Reads remote_config and renders a
 * BLOCKING screen above the navigator when the running build is below the min version or the team
 * has flipped maintenance. LAST-KNOWN-GOOD: fresh config wins; on fetch error the last persisted
 * snapshot is enforced; fail-open only on first install (no snapshot) or when the boot budget
 * elapses first — a network blip must never strand a *new* user, and an already-flagged one can't
 * dodge the gate by going offline. A 426 from any edge function (server backstop) pins
 * force-update for the process lifetime. Re-checks on resume so a window opened while
 * backgrounded surfaces without a cold start.
 */
export function BootGate({ children }: { children: React.ReactNode }) {
  const { data, status, refetch } = useRemoteConfig();
  const [cached, setCached] = useState<GateSnapshot | null | 'loading'>('loading');
  const [timedOut, setTimedOut] = useState(false);
  const serverRejectedVersion = useSyncExternalStore(subscribeClientOutdated, isClientOutdated);

  useEffect(() => {
    let alive = true;
    void loadConfigSnapshot().then((snap) => {
      if (alive) setCached(snap);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), BOOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const decision = resolveBootDecision({
    platform,
    currentVersion: Constants.expoConfig?.version,
    fresh: data ?? null,
    fetchState: status,
    cached,
    timedOut,
    serverRejectedVersion,
  });

  // BrandSplash (mounted above in _layout) covers this beat — no text, no spinner.
  if (decision.kind === 'waiting') return <View className="flex-1 bg-background" />;
  if (decision.kind === 'force-update') return <ForceUpdateScreen />;
  if (decision.kind === 'maintenance') {
    return <MaintenanceScreen eta={decision.eta} onRetry={() => void refetch()} />;
  }
  return <>{children}</>;
}
