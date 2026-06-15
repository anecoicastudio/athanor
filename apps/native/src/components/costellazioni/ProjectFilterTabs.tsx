import { type Locale, type MessageKey, t } from '@athanor/i18n';
import type { ProjectCategory } from '@athanor/schemas';
import { Pressable, ScrollView, Text } from '@/tw';

export type ProjectFilter = ProjectCategory | 'all';
const FILTERS: ProjectFilter[] = [
  'all',
  'startup',
  'artistic',
  'business',
  'scientific',
  'volunteer',
];

/**
 * Horizontal board filter row. Active chip = aura-soft fill + aura-line border
 * (the Chip vocabulary, DESIGN.md), idle = hairline-bordered raised surface.
 */
export function ProjectFilterTabs({
  active,
  onChange,
  locale,
}: {
  active: ProjectFilter;
  onChange: (f: ProjectFilter) => void;
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
            className={`rounded-ctl border px-4 py-2 ${
              isActive ? 'border-aura-line bg-aura-soft' : 'border-hair bg-raise'
            }`}
          >
            <Text className={`text-[13px] ${isActive ? 'text-aura' : 'text-faint'}`}>
              {t(`costellazioni.filter.${f}` as MessageKey, locale)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
