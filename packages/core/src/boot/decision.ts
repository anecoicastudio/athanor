import { resolveBootGate } from './gate';

export type GateSnapshot = {
  minAppVersion: { ios: string; android: string } | null;
  maintenance: { enabled: boolean; eta: string | null } | null;
};

export type BootDecision =
  | { kind: 'waiting' }
  | { kind: 'ok' }
  | { kind: 'force-update' }
  | { kind: 'maintenance'; eta: string | null };

/**
 * Boot decision under the LAST-KNOWN-GOOD contract (supersedes plain fail-open):
 * fresh config always wins; on fetch error the last persisted snapshot is enforced;
 * fail-open only when no snapshot has ever been saved (first install) or the boot
 * budget elapses before the snapshot read settles. `timedOut` is computed by the
 * caller so this stays pure (no clock).
 */
export function resolveBootDecision(input: {
  platform: 'ios' | 'android';
  currentVersion: string | null | undefined;
  fresh: GateSnapshot | null;
  fetchState: 'pending' | 'success' | 'error';
  cached: GateSnapshot | null | 'loading';
  timedOut: boolean;
  serverRejectedVersion: boolean;
}): BootDecision {
  // `input.cached !== null` is an equivalent mutant target: when cached IS null the ternary
  // yields `input.cached`, which is that same null. Kept for symmetry with the 'loading' arm.
  const snapshot =
    input.fresh ?? (input.cached !== 'loading' && input.cached !== null ? input.cached : null);

  if (snapshot) {
    const gate = resolveBootGate({
      platform: input.platform,
      currentVersion: input.currentVersion,
      minAppVersion: snapshot.minAppVersion,
      maintenance: snapshot.maintenance,
    });
    if (gate === 'maintenance') {
      // The `?.` cannot fire: this arm is only reached when maintenance.enabled is true, so
      // maintenance is non-null here. Equivalent mutant, kept because the type is nullable.
      return { kind: 'maintenance', eta: snapshot.maintenance?.eta ?? null };
    }
    if (gate === 'force-update') return { kind: 'force-update' };
    return input.serverRejectedVersion ? { kind: 'force-update' } : { kind: 'ok' };
  }

  // No config available. cached === null with the fetch settled (or timed out) is the
  // first-install fail-open branch; a still-loading snapshot read gets the boot budget.
  if (input.cached === 'loading' && !input.timedOut) return { kind: 'waiting' };
  if (input.fetchState === 'pending' && !input.timedOut) return { kind: 'waiting' };
  return input.serverRejectedVersion ? { kind: 'force-update' } : { kind: 'ok' };
}
