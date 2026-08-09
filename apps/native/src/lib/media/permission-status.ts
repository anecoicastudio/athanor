/**
 * Permission state the priming UI reacts to.
 * - `undetermined` — never asked; show the primer, then fire the OS prompt.
 * - `granted` — go ahead.
 * - `denied` — declined but the OS will still ask again next time.
 * - `blocked` — declined and the OS won't ask again → deep-link to Settings.
 */
export type PermStatus = 'undetermined' | 'granted' | 'denied' | 'blocked';

/** Verdict after an OS prompt has actually run. */
export function toStatus(res: { granted: boolean; canAskAgain: boolean }): PermStatus {
  if (res.granted) return 'granted';
  return res.canAskAgain ? 'denied' : 'blocked';
}

/** Verdict from a read that never prompted. */
export function toPeekStatus(res: { granted: boolean; canAskAgain: boolean }): PermStatus {
  if (res.granted) return 'granted';
  // Never asked yet → still `undetermined` (the OS can prompt). Declined and the
  // OS won't ask again → `blocked`. We don't surface `denied` from a peek: a
  // never-asked-or-declined-but-askable state both read as `undetermined` so the
  // primer offers «Consenti» rather than a dead Settings link.
  return res.canAskAgain ? 'undetermined' : 'blocked';
}
