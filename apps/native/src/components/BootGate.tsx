import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import Constants from 'expo-constants';
import { resolveBootGate } from '@athanor/core';
import { useRemoteConfig } from '@/lib/useRemoteConfig';
import { ForceUpdateScreen } from '@/components/boot/ForceUpdateScreen';
import { MaintenanceScreen } from '@/components/boot/MaintenanceScreen';

/**
 * Boot/resume kill-switch gate (frontend 12 §2.1/§2.2/§10). Reads remote_config and renders a
 * BLOCKING screen above the navigator when the running build is below the min version or the team
 * has flipped maintenance. FAIL-OPEN: while loading/errored or with no data, render children — a
 * network blip must never strand a user. Re-checks on resume so a window opened while backgrounded
 * surfaces without a cold start.
 */
export function BootGate({ children }: { children: React.ReactNode }) {
  const { data, refetch } = useRemoteConfig();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refetch();
    });
    return () => sub.remove();
  }, [refetch]);

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const gate = data
    ? resolveBootGate({
        platform,
        currentVersion: Constants.expoConfig?.version,
        minAppVersion: data.minAppVersion,
        maintenance: data.maintenance,
      })
    : 'ok';

  if (gate === 'force-update') return <ForceUpdateScreen />;
  if (gate === 'maintenance') {
    return <MaintenanceScreen eta={data?.maintenance?.eta} onRetry={() => void refetch()} />;
  }
  return <>{children}</>;
}
