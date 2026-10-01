/**
 * Permission state the media and push surfaces react to.
 * - `undetermined` — never asked; the OS prompt fires on the tap, with nothing of ours before it.
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
  // never-asked-or-declined-but-askable state both read as `undetermined`, so a
  // caller asks the OS rather than showing a dead Settings link.
  return res.canAskAgain ? 'undetermined' : 'blocked';
}
