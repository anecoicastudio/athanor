import type { PostCategory } from '@athanor/schemas';

/**
 * The feed's tab row, and the one narrowing that keeps its sixth tab out of the posts query
 * (#153).
 *
 * Five of the six tabs are post categories; «Eventi» is not one. It is a window into Athanor
 * Live — real `events` rows rendered as feed cards — so `'eventi'` is deliberately NOT a
 * `post_category` value, no migration is owed, and the composer gains nothing.
 *
 * The two unions are kept apart for a reason the compiler then enforces: `postKeys.feed` and
 * `getFeedPage` are typed `FeedFilter`, so a tab value can only reach them through
 * `postsFilter`, and `getFeedPage` does `.eq('category', …)` against the enum — handing it
 * `'eventi'` would be a PostgREST 400, not a type error, if the two unions were one.
 */

/** The five tabs whose source is the posts feed. Never widened — see `FeedTab`. */
export type FeedFilter = PostCategory | 'all';

/** The sixth tab: events, not posts. */
export const EVENTS_TAB = 'eventi';

/** What the tab row can be showing. A superset of `FeedFilter` by exactly one member. */
export type FeedTab = FeedFilter | typeof EVENTS_TAB;

/** Tab order, left to right (DESIGN §8.3: «Tutti Business Human / Creativi Evoluz. Ev.»). */
export const FEED_TABS: FeedTab[] = [
  'all',
  'business',
  'human',
  'creative',
  'evolution',
  EVENTS_TAB,
];

/**
 * The posts filter a tab stands for, or `null` when it has no posts source.
 *
 * The single door between tab state and the posts query. `null` is the instruction to render
 * the other source entirely — not to fall back to `'all'`, which would quietly show posts
 * under an events tab.
 */
export function postsFilter(tab: FeedTab): FeedFilter | null {
  return tab === EVENTS_TAB ? null : tab;
}
