import type { QueryClient } from '@tanstack/react-query';
import {
  blockKeys,
  connectionKeys,
  dreamKeys,
  momentKeys,
  profileKeys,
  storyKeys,
} from '@athanor/api';

/**
 * The per-person queries whose answer is gated by `athanor.not_blocked(peerId)`, plus the block
 * rows themselves. Every `blockUser` / `unblockUser` call site invalidates through here
 * (source-audit §32), for one reason: `getProfileById` resolves to `null` for a blocked pair,
 * and that `null` is a cached SUCCESS. `useProfile` holds it for five minutes, the shared
 * client keeps it 24h and persists it to AsyncStorage — so an unblock that only touched
 * `blockKeys` removed the row from «Profili bloccati» and left the person «non disponibile»
 * until the window ran out, or until a block-then-unblock from the profile kebab (which did
 * invalidate the profile) repaired it by hand. The block direction had the mirror bug from the
 * report sheet and the chat kebab: a member you just blocked rendered normally for five minutes.
 *
 * `profileKeys.detail(peerId)` is a prefix of `profileKeys.statCounts(peerId)`, and
 * `blockKeys.all` of `blockKeys.status(peerId)`, so both ride along. The connection status
 * (`ConnectButton` sits on the profile screen that stays mounted) and the person's stories
 * (`story_segments` select is `not_blocked(author_id)`-gated) are keyed per person too.
 *
 * Not here, on purpose: `conversationKeys.list()` and `storyKeys.rail()` are gated by the same
 * predicate but keyed per viewer, not per person, and hold the default 30s `staleTime` — the
 * screens that read them refetch on their next mount, which is the only way they are reached.
 */
export function blockDependentKeys(peerId: string) {
  return [
    blockKeys.all,
    profileKeys.detail(peerId),
    dreamKeys.byProfile(peerId),
    momentKeys.list(peerId),
    connectionKeys.status(peerId),
    storyKeys.person(peerId),
  ] as const;
}

/**
 * Call once a block or unblock has landed. Invalidate, never remove: the profile screen is one
 * of the callers and stays mounted after an unblock, so its active observer must refetch over
 * the data it holds rather than lose it. For a screen that is not mounted, the flag is enough —
 * `isInvalidated` lives in `query.state`, which `dehydrate` copies whole
 * (`@tanstack/query-core@5.101.0`, `build/modern/hydration.js:33`), so it survives an app kill
 * and the next mount refetches regardless of `staleTime`.
 */
export function invalidateBlockDependents(qc: QueryClient, peerId: string): void {
  for (const queryKey of blockDependentKeys(peerId)) void qc.invalidateQueries({ queryKey });
}
