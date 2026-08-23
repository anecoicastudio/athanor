import { postCategorySchema } from '@athanor/schemas';
import { describe, expect, it } from 'vitest';
import { EVENTS_TAB, FEED_TABS, type FeedTab, postsFilter } from './feed-tabs';

/**
 * The sixth tab is a window into Athanor Live, not a sixth post category (#153).
 *
 * What has to stay true is one thing: the events tab NEVER produces a posts filter. Nothing
 * downstream would say so if it did — `getFeedPage` builds `.eq('category', 'eventi')` against
 * an enum that has four values, so the failure is a PostgREST 400 at runtime on a screen that
 * type-checks. These assertions are exhaustive over `FEED_TABS` rather than spot-checks so
 * that a sixth-and-a-half tab, a renamed member, or a `postsFilter` that stops returning `null`
 * all go red.
 */
describe('feed tabs', () => {
  it('is the five post filters plus events, in DESIGN §8.3 order', () => {
    expect(FEED_TABS).toEqual(['all', 'business', 'human', 'creative', 'evolution', 'eventi']);
  });

  it('lists every post category exactly once', () => {
    const fromTabs = FEED_TABS.map(postsFilter).filter((f): f is Exclude<typeof f, null> =>
      Boolean(f),
    );
    expect([...fromTabs].sort()).toEqual([...postCategorySchema.options, 'all'].sort());
  });

  it('narrows every non-events tab to itself', () => {
    for (const tab of FEED_TABS) {
      if (tab === EVENTS_TAB) continue;
      expect(postsFilter(tab), `${tab} should filter the posts feed by itself`).toBe(tab);
    }
  });

  it('gives the events tab no posts filter', () => {
    expect(postsFilter(EVENTS_TAB)).toBeNull();
  });

  it('has exactly one tab without a posts source', () => {
    const sourceless = FEED_TABS.filter((tab) => postsFilter(tab) === null);
    expect(sourceless).toEqual([EVENTS_TAB]);
  });

  /**
   * The teeth of Reading B: if `'eventi'` were ever added to `post_category` (Reading A, ruled
   * out 2026-08-23), `postsFilter` returning `null` would stop being a narrowing and start
   * being a hole — the tab would have a posts source and this file would still pass. Pin the
   * premise itself.
   */
  it('does not name a post category', () => {
    expect(postCategorySchema.options).not.toContain(EVENTS_TAB);
    expect(postCategorySchema.safeParse(EVENTS_TAB).success).toBe(false);
  });

  it('accepts no tab outside the row', () => {
    // Every value the union admits is in FEED_TABS — a member added to `FeedTab` and not to the
    // row would render nowhere, silently.
    const admitted: FeedTab[] = ['all', 'business', 'human', 'creative', 'evolution', 'eventi'];
    expect(new Set(FEED_TABS)).toEqual(new Set(admitted));
    expect(FEED_TABS).toHaveLength(admitted.length);
  });
});
