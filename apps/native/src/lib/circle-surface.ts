/**
 * What a Circle-gated surface shows a person (#761), decided once for every surface that
 * locks something behind Circle membership: the `CircleGate` variants, the `EventRow` lock chip,
 * the Settings row and the advanced-filter sheet's lapsed-member redirect.
 *
 * - `unlocked` — a member (or, for a feature gate, a member whose plan carries the feature).
 *   Every platform; the entitlement read is the only input that decides it.
 * - `reserved` — an iOS non-member (ruling 2026-09-22). A neutral, non-tappable label: no
 *   «Sblocca», no «not open yet» line, no route to the Circle screen. The Settings row is absent.
 * - `open` — an Android/web non-member while `circle_checkout_enabled` is on: the unlock
 *   affordance, routed to the Circle screen.
 * - `closed` — the same person while the flag is off (ruling 2026-09-19): still locked, plus
 *   the Circle screen's own «La membership non è ancora aperta.». Nothing promises a join that
 *   cannot happen.
 * - `pending` — the flag's first read is in flight. `CircleGate` renders it as the neutral
 *   label rather than flash one line and swap it for another; the Settings row keeps its
 *   ordinary copy, and the filter sheet's redirect still goes to the Circle screen, which
 *   shows its own spinner until the flag answers.
 *
 * `os` is an argument rather than a `Platform.OS` read so a node-environment test can reach
 * every row of the table (`src/lib/dirty-guard.ts` states the same reason).
 */
export type CircleSurface = 'unlocked' | 'reserved' | 'pending' | 'closed' | 'open';

export function circleSurface({
  member,
  os,
  checkout,
}: {
  member: boolean;
  os: string;
  checkout: 'loading' | 'open' | 'closed';
}): CircleSurface {
  if (member) return 'unlocked';
  if (os === 'ios') return 'reserved';
  if (checkout === 'loading') return 'pending';
  return checkout;
}
