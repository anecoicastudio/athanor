import type { Profile } from '@athanor/schemas';

/**
 * The member-visible sanction state (#312, PRD §4.13). A ban is a fact, not a
 * timer (banned_at), and outranks a concurrent suspension window. A
 * `suspended_until` at or before `now` is a lapsed suspension — the server's
 * `athanor.is_active()` compares the same way, so the banner and the RLS gate
 * agree without a sweeper on either side.
 *
 * `now` is injected (core rule: no inline clock reads) — callers pass
 * `Date.now()`.
 */
export type SanctionState = { kind: 'banned' } | { kind: 'suspended'; until: string } | null;

export function sanctionState(
  profile: Pick<Profile, 'suspended_until' | 'banned_at'> | null,
  now: number,
): SanctionState {
  if (!profile) return null;
  if (profile.banned_at) return { kind: 'banned' };
  const until = profile.suspended_until;
  if (until && new Date(until).getTime() > now) return { kind: 'suspended', until };
  return null;
}
