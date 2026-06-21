import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { PostCategory } from '@athanor/schemas';
import { Pressable, ScrollView, Text } from '@/tw';

export type FeedFilter = PostCategory | 'all';
const FILTERS: FeedFilter[] = ['all', 'business', 'human', 'creative', 'evolution'];

/**
 * Horizontal filter row. Active chip = aura-soft fill + aura-line border
 * (the Chip vocabulary, DESIGN.md), idle = hairline-bordered raised surface.
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
            className={`rounded-ctl border px-4 py-2 min-h-[44px] justify-center ${
              isActive ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
            }`}
          >
            <Text className={`text-[13px] ${isActive ? 'text-aura' : 'text-muted-foreground'}`}>
              {t(`feed.filter.${f}` as MessageKey, locale)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
