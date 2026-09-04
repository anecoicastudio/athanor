import { type Locale, type MessageKey, t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { FEED_TABS, type FeedFilter, type FeedTab } from '@/lib/feed-tabs';

// The two unions and the narrowing live in @/lib/feed-tabs (no JSX → reachable from the node
// test runner, which is where the "the events tab has no posts source" assertions run).
// Re-exported so the screen keeps importing them here.
export type { FeedFilter, FeedTab };

/**
 * Horizontal feed-tab row (DESIGN §9 Tabs): text pills, active = foreground
 * text + 2px foreground underline, inactive = foregroundMuted. Tabs are
 * navigation, not moments — no aura here.
 *
 * Six tabs since #153: the sixth, «Eventi», is a window into Athanor Live rather than a post
 * category, so it looks identical and sources differently. The pill itself knows nothing about
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-5"
    >
      {FEED_TABS.map((f) => {
        const isActive = f === active;
        return (
          <Pressable
            key={f}
            onPress={() => onChange(f)}
            className="min-h-[44px] items-center justify-center px-4"
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text
              className={`text-[13px] ${
                isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }`}
            >
              {t(`feed.filter.${f}` as MessageKey, locale)}
            </Text>
            <View
              className={`mt-1 h-[2px] self-stretch rounded-full ${
                isActive ? 'bg-foreground' : 'bg-transparent'
              }`}
            />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
