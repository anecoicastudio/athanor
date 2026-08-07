/**
 * Sticky "server rejected this build" flag (HTTP 426 from an edge function — the
 * version-gate backstop). Once tripped it stays set for the process lifetime: the
 * server has declared this build unsupported, so BootGate pins ForceUpdateScreen
 * until the app restarts (by which point the user has updated, or the fix to a
 * misconfigured min_app_version has propagated).
 */
let outdated = false;
const listeners = new Set<() => void>();

export function isClientOutdated(): boolean {
  return outdated;
}

export function markClientOutdated(): void {
  if (outdated) return;
  outdated = true;
  for (const cb of listeners) cb();
}

export function subscribeClientOutdated(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
