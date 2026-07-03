import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { PostCategory } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';

export type FeedFilter = PostCategory | 'all';
const FILTERS: FeedFilter[] = ['all', 'business', 'human', 'creative', 'evolution'];

/**
 * Horizontal feed-tab row (DESIGN §9 Tabs): text pills, active = foreground
 * text + 2px foreground underline, inactive = foregroundMuted. Tabs are
 * navigation, not moments — no aura here.
 */
export function CategoryTabs({
  active,
  onChange,
  locale,
}: {
  active: FeedFilter;
  onChange: (f: FeedFilter) => void;
  locale: Locale;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-5"
    >
      {FILTERS.map((f) => {
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
