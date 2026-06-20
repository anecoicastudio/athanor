import { type Locale, t } from '@athanor/i18n';
import { Pressable, ScrollView, Text } from '@/tw';

export type LivePanel = 'vicino' | 'calendario' | 'mappa' | 'online';
const PANELS: LivePanel[] = ['vicino', 'calendario', 'mappa', 'online'];

/** Segmented 4-way panel selector. Active is ink-on-cosmo (foreground fill), not cyan. */
export function PanelTabs({
  active,
  onChange,
  locale,
}: {
  active: LivePanel;
  onChange: (p: LivePanel) => void;
  locale: Locale;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-5"
    >
      {PANELS.map((p) => {
        const on = p === active;
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            className={`rounded-full px-4 py-2 min-h-[44px] justify-center ${on ? 'bg-foreground' : 'border border-hair bg-raise'}`}
          >
            <Text className={`text-[13px] ${on ? 'font-semibold text-background' : 'text-faint'}`}>
              {t(`live.tab.${p}` as 'live.tab.vicino', locale)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
