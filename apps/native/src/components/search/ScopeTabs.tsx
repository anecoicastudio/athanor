import { useEffect, useRef } from 'react';
import type { ScrollView as RNScrollView } from 'react-native';
import { t } from '@athanor/i18n';
import type { Locale, SearchScope } from '@athanor/schemas';
import { ScrollView, View } from '@/tw';
import { Chip } from '@/components/Chip';

/**
 * The search screen's scope row (M8 §3.3 / §4; DESIGN §9 «Tabs (feed)»): a horizontally
 * scrolling row of `Chip`s, 8 apart, the selected one filled with the foreground. It was the
 * last underlined tab row in the app until 2026-10-06 (#921); the feed's `CategoryTabs` is
 * the same row. No cyan: a scope is navigation, not a moment.
 *
 * `py-1.5` keeps 6 above and below the 32pt chips inside the scroll view, which is where the
 * chip's `hitSlop` reaches for its 44pt target; the screen takes those 6 off the gap under
 * the row.
 *
 * `shrink-0 grow-0` on the scroll view: this row is a child of the screen's flex column. A
 * horizontal `ScrollView` there grew to fill the leftover height (#640, 345px of tab row),
 * which is why the row wrapped from #640 until this day; and without `shrink-0` the results
 * list took 9.5pt off the chips at the largest text size (46.5 to 37, iPhone SE simulator at
 * AX5, 2026-10-06).
 *
 * The selected chip is brought into view when it is laid out and when the selection changes,
 * as `CategoryTabs` does: on that simulator at the default size «Marketplace», the fifth
 * chip, starts at x 337.5 of 375 and is 109 wide.
 *
 * i18n note: the marketplace scope key is `search.scope.market` (not `.marketplace`).
 */

const SCOPES: SearchScope[] = ['all', 'people', 'projects', 'events', 'marketplace'];

const SCOPE_KEY: Record<SearchScope, Parameters<typeof t>[0]> = {
  all: 'search.scope.all',
  people: 'search.scope.people',
  projects: 'search.scope.projects',
  events: 'search.scope.events',
  marketplace: 'search.scope.market',
};

export function ScopeTabs({
  scope,
  onChange,
  locale,
}: {
  scope: SearchScope;
  onChange: (s: SearchScope) => void;
  locale: Locale;
}) {
  const scroller = useRef<RNScrollView>(null);
  /** Where each chip starts in the row, as laid out. */
  const starts = useRef<Partial<Record<SearchScope, number>>>({});
  const reveal = (x: number) => scroller.current?.scrollTo({ x: x - 20, animated: false });
  useEffect(() => {
    const x = starts.current[scope];
    if (x !== undefined) reveal(x);
  }, [scope]);
  return (
    <ScrollView
      ref={scroller}
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      className="shrink-0 grow-0"
      contentContainerClassName="items-center gap-2 px-5 py-1.5"
    >
      {SCOPES.map((s) => (
        <View
          key={s}
          onLayout={(e) => {
            starts.current[s] = e.nativeEvent.layout.x;
            if (s === scope) reveal(e.nativeEvent.layout.x);
          }}
        >
          <Chip
            label={t(SCOPE_KEY[s], locale)}
            selected={s === scope}
            onPress={() => onChange(s)}
          />
        </View>
      ))}
    </ScrollView>
  );
}
