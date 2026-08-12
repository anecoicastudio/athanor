import type { MomentoDeckCard } from '@athanor/schemas';

/**
 * What the Home «Hai un Momento» block shows: THE top waiting proposal, or nothing (issue #185).
 *
 * One card, never a count. Rule #3 is spelled out on the tab-bar badge itself — "a single cyan
 * spark … never a numeric count" (`(tabs)/_layout.tsx:18-19`) — and Home is the same claim in a
 * bigger frame, so it must not turn `deck.data.length` into «3 Momenti ti aspettano». Returning
 * the card rather than a boolean is what keeps that impossible to write by accident: the caller
 * never holds the array.
 *
 * The order is the server's — `(proposed_on desc, daily_rank asc)` inside `get_momenti_deck()`
 * since #273, already capped at 3 and filtered to `pending` + dream-bearing + not-blocked. Home
 * does NOT re-rank: it reads the same cache entry the tab deals its swipe deck from
 * (`momentiKeys.deck()`), and any client sort here would make the card you tap on Home differ
 * from the card the tab hands you.
 *
 * `undefined` covers all three non-answers — loading, idle, and a cold error with no cached
 * data — and collapses with `[]` into the same `null`. That is deliberate, not a shortcut: the
 * ✦ badge already carries has/hasn't, so an absent block and an unknown one look identical on
 * purpose. See `MomentiCard.tsx` for why this Home block has no placeholder at all.
 *
 * Extracted from the .tsx for the same reason as `starsBlockMode` (`lib/star.ts:77-82`): this
 * app's vitest harness is `environment: 'node'` with an `src/**\/*.test.ts` glob, so a rule left
 * inside a component is structurally unassertable.
 */
export function topWaitingMomento(cards: MomentoDeckCard[] | undefined): MomentoDeckCard | null {
  // `noUncheckedIndexedAccess` (tsconfig.json:5) already types `[0]` as possibly-undefined, so
  // the empty deck and the missing deck fall through the same `??` — no length check needed.
  return cards?.[0] ?? null;
}
