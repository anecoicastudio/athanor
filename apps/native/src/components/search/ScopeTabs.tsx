import { t } from '@athanor/i18n';
import type { Locale, SearchScope } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';

/**
 * Wrapping scope-tab row for the search screen (M8 §3.3 / §4).
 *
 * DESIGN §9 Tabs: text pills, active = foreground text + 2px foreground
 * underline, inactive = foregroundMuted. Deliberately NO cyan (rule #4):
 * scope tabs are navigation controls, not aura/moment events. Same pattern
 * as feed CategoryTabs.
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
  // WRAPS rather than scrolls (#640): a horizontal ScrollView in the search screen's flex
  // column grew to fill the leftover height (345px of tab row). DESIGN §6 reserves
  // horizontal carousels for Home's event cards, and §8.3's own tab row wraps to two lines.
  return (
    <View className="flex-row flex-wrap gap-2 px-5 py-2">
      {SCOPES.map((s) => {
        const active = s === scope;
        return (
          <Pressable
            key={s}
            className="min-h-[44px] items-center justify-center px-4"
            onPress={() => onChange(s)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t(SCOPE_KEY[s], locale)}
          >
            <Text
              className={`text-[14px] ${
                active ? 'font-semibold text-foreground' : 'text-muted-foreground'
              }`}
            >
              {t(SCOPE_KEY[s], locale)}
            </Text>
            <View
              className={`mt-1 h-[2px] self-stretch rounded-full ${
                active ? 'bg-foreground' : 'bg-transparent'
              }`}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
