import { isVersionBelow } from './version';

export type BootGate = 'ok' | 'force-update' | 'maintenance';

/**
 * The boot/resume gate decision (frontend 12 §2.1/§2.2/§10). Maintenance takes precedence over
 * force-update (§2.1 routes maintenance first). FAIL-OPEN: null config or a missing/unparseable
 * version yields 'ok' — a network/parse failure or a missing app version must never strand a user.
 */
export function resolveBootGate(input: {
  platform: 'ios' | 'android';
  currentVersion: string | null | undefined;
  minAppVersion: { ios: string; android: string } | null;
  maintenance: { enabled: boolean } | null;
}): BootGate {
  if (input.maintenance?.enabled) return 'maintenance';
  const min = input.minAppVersion?.[input.platform];
  if (min && isVersionBelow(input.currentVersion, min)) return 'force-update';
  return 'ok';
}
