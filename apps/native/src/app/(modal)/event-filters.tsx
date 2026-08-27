import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { ScrollView, Text, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { ModalHeader, HeaderClose } from '@/components/ModalHeader';
import { Screen } from '@/components/Screen';
import { SectionLabel } from '@/components/SectionLabel';
import { useLocale } from '@/hooks/use-locale';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import {
  DATE_PRESETS,
  EMPTY_EVENT_FILTER_PARAMS,
  EVENT_CATEGORIES,
  draftFromParams,
  serializeEventFilters,
  type DatePreset,
  type EventFilterParamsIn,
} from '@/lib/event-filters';
import type { EventCategory } from '@athanor/schemas';

/**
 * Events discovery filter sheet (#151, PRD §4.6 «Filter by category/city/date»).
 *
 * Opened from the Calendario panel's trigger; on Apply it `dismissTo`s back to the
 * already-mounted /(modal)/live with the draft as string route params, exactly the
 * round-trip `search-filters.tsx` documents.
 *
 * NOT Circle-gated, unlike that sheet: PRD §4.6 lists category/city/date as a base Live
 * capability, and `features.advancedFilters` is the people-search perk. Copying the
 * entitlement guard here would invent a paywall the product never asked for.
 *
 * Rule #4: cyan `Chip` fills are correct here — a selected filter is an active accent,
 * not a moment-grade glow. No literal hex below; every colour is a token class.
 */

export default function EventFiltersScreen() {
  const router = useRouter();
  /** Cancel lands where Apply does — the Live screen this sheet filters. */
  const cancel = useGuardedBack('/(modal)/live');
  const locale = useLocale();

  const params = useLocalSearchParams<EventFilterParamsIn>();
  const initial = draftFromParams(params);

  const [category, setCategory] = useState<EventCategory | undefined>(initial.category);
  const [city, setCity] = useState(initial.city);
  const [date, setDate] = useState<DatePreset>(initial.date);

  const handleApply = () => {
    // Spread over the empty set so every key reaches the route even when the member cleared
    // it — see EMPTY_EVENT_FILTER_PARAMS for why an omitted key is not enough.
    const next = {
      ...EMPTY_EVENT_FILTER_PARAMS,
      ...serializeEventFilters({ category, city, date }),
    };
    router.dismissTo({ pathname: '/(modal)/live', params: next });
  };

  const handleReset = () => {
    setCategory(undefined);
    setCity('');
    setDate('sempre');
  };

  return (
    <Screen {...MODAL_A11Y}>
      <ModalHeader
        title={t('live.filterSheet.title', locale)}
        leading="none"
        right={<HeaderClose label={t('common.cancel', locale)} onPress={cancel} />}
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-gutter pb-16"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-[14px] leading-relaxed text-muted-foreground">
          {t('live.filterSheet.sub', locale)}
        </Text>

        {/* ── Categoria ── */}
        <View className="gap-3">
          <SectionLabel tone="foreground">{t('live.filter.section.category', locale)}</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            <Chip
              label={t('live.filter.category.any', locale)}
              selected={category === undefined}
              onPress={() => setCategory(undefined)}
            />
            {EVENT_CATEGORIES.map((c) => (
              <Chip
                key={c}
                label={t(`event.cat.${c}` as 'event.cat.arte', locale)}
                selected={category === c}
                onPress={() => setCategory((prev) => (prev === c ? undefined : c))}
              />
            ))}
          </View>
        </View>

        {/* ── Città ── */}
        <View className="gap-3">
          <SectionLabel tone="foreground">{t('live.filter.section.city', locale)}</SectionLabel>
          <Input
            placeholder={t('live.filter.city.placeholder', locale)}
            value={city}
            onChangeText={setCity}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        {/* ── Quando ── */}
        <View className="gap-3">
          <SectionLabel tone="foreground">{t('live.filter.section.date', locale)}</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {DATE_PRESETS.map((p) => (
              <Chip
                key={p}
                label={t(`live.filter.date.${p}` as 'live.filter.date.sempre', locale)}
                selected={date === p}
                onPress={() => setDate(p)}
              />
            ))}
          </View>
        </View>

        <View className="gap-3 pt-2">
          <Button label={t('common.apply', locale)} variant="light" onPress={handleApply} />
          <Button label={t('common.reset', locale)} variant="ghost" onPress={handleReset} />
        </View>
      </ScrollView>
    </Screen>
  );
}
