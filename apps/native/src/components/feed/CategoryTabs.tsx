import { useRef } from 'react';
import type { ScrollView as RNScrollView } from 'react-native';
import { type Locale, type MessageKey, t } from '@athanor/i18n';
import { ScrollView, View } from '@/tw';
import { Chip } from '@/components/Chip';
import { FEED_TABS, type FeedFilter, type FeedTab } from '@/lib/feed-tabs';

// The two unions and the narrowing live in @/lib/feed-tabs (no JSX → reachable from the node
// test runner, which is where the "the events tab has no posts source" assertions run).
// Re-exported so the screen keeps importing them here.
export type { FeedFilter, FeedTab };

/**
 * The feed's filter row (DESIGN §9 «Tabs (feed)»): a horizontally scrolling row of `Chip`s, 8
 * apart, the selected one filled with the foreground. No underline and no cyan: a filter is
 * navigation, not a moment.
 *
 * `py-1.5` keeps 6 above and below the 32pt chips inside the scroll view, which is where the
 * chip's `hitSlop` reaches for its 44pt target; the screen takes those 6 off the gap around
 * the row.
 *
 * The selected chip is brought into view when it is laid out. The screen draws this row inside
 * two different lists (posts, events), so choosing «Eventi», the sixth chip, mounts a new row
 * at offset 0 with the selected chip off the right edge of an iPhone SE (seen on the
 * simulator, 2026-10-05).
 *
 * Six tabs since #153: the sixth, «Eventi», is a window into Athanor Live rather than a post
 * category, so it looks identical and sources differently. The chip itself knows nothing about
 * that — the screen branches on `postsFilter`.
 */
export function CategoryTabs({
  active,
  onChange,
  locale,
}: {
  active: FeedTab;
  onChange: (f: FeedTab) => void;
  locale: Locale;
}) {
  const scroller = useRef<RNScrollView>(null);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="items-center gap-2 px-5 py-1.5"
    >
      {FEED_TABS.map((f) => (
        <View
          key={f}
          onLayout={
            f === active
              ? (e) =>
                  scroller.current?.scrollTo({ x: e.nativeEvent.layout.x - 20, animated: false })
              : undefined
          }
        >
          <Chip
            label={t(`feed.filter.${f}` as MessageKey, locale)}
            selected={f === active}
            onPress={() => onChange(f)}
          />
        </View>
      ))}
    </ScrollView>
  );
}
