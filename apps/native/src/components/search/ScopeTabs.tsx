import { t } from '@athanor/i18n';
import type { Locale, SearchScope } from '@athanor/schemas';
import { Pressable, ScrollView, Text, View } from '@/tw';

/**
 * Horizontal scope-tab row for the search screen (M8 §3.3 / §4).
 *
 * Active state: ink/cosmo — `bg-foreground` / `text-cosmo` (inverted, dark-on-light).
 * This deliberately does NOT use cyan (rule #4): scope tabs are navigation controls,
 * not aura/moment events. Mirror the active treatment from SegmentedToggle.tsx
 * but with a pill shape instead of a full toggle container.
 *
 * Inactive state: `border-hair` + `bg-raise-2` + `text-foreground` — same as Chip
 * idle state, consistent with the filter-chip vocabulary.
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
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="flex-row gap-2 px-5 py-2"
    >
      {SCOPES.map((s) => {
        const active = s === scope;
        return (
          <Pressable
            key={s}
            className={
              active
                ? 'rounded-full bg-foreground px-4 py-2'
                : 'rounded-full border border-hair bg-raise-2 px-4 py-2'
            }
            style={{ minHeight: 44, justifyContent: 'center' }}
            onPress={() => onChange(s)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(SCOPE_KEY[s], locale)}
          >
            <Text
              className={`text-[14px] font-semibold ${active ? 'text-cosmo' : 'text-foreground'}`}
            >
              {t(SCOPE_KEY[s], locale)}
            </Text>
          </Pressable>
        );
      })}
      {/* Trailing spacer so last chip scrolls fully into view */}
      <View style={{ width: 4 }} />
    </ScrollView>
  );
}
