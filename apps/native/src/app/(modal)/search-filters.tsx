import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { t } from '@athanor/i18n';
import { Pressable, ScrollView, Text, View } from '@/tw';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ModalHeader } from '@/components/ModalHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { useEntitlement } from '@/hooks/use-entitlement';
import { useLocale } from '@/hooks/use-locale';
import { MODAL_A11Y } from '@/lib/a11y';
import { useGuardedBack } from '@/lib/modal-exit';
import { Screen } from '@/components/Screen';
import {
  AURA_BUCKETS,
  type AuraBucket,
  STAR_VALUES,
  type StarValue,
  auraMinFromBucket,
  bucketFromAuraMin,
  parseStar,
  serializeFilters,
} from '@/lib/search-filters';

/**
 * Advanced-filter sheet (M8 §3.5, Task 9) — member-only.
 *
 * Opened from the search screen's CircleGate pill (member → router.push('/search-filters')).
 * On Apply, navigates back to the search screen via router.dismissTo with the selected
 * filters as string route params — the search screen re-derives SearchFilters from them and
 * re-runs the query automatically (useLocalSearchParams round-trip contract).
 *
 * Why dismissTo: dismissTo('/(modal)/search', params) pops this sheet off the stack and
 * returns to the already-mounted /search screen while passing updated params — a single
 * operation that both dismisses and delivers filter state without a fresh push. This is
 * the correct mechanism in expo-router v6 for "return to parent with params". It will
 * fall back to replace if /search is not in the stack, which is safe for all callers.
 *
 * Disponibilità chips are intentionally rendered disabled/non-functional: the backend
 * search endpoint (13-search.md §2.3/§8) does not yet accept an `availability` filter;
 * wiring them now would silently pass an ignored param. They show «in arrivo» to be
 * honest about the status.
 *
 * Rule #4: cyan chips (auraSoft) are CORRECT here — selected advanced-filter chips are
 * an active accent / selection affordance, not a glow. No literal hex below.
 */

export default function SearchFiltersScreen() {
  const router = useRouter();
  /** Cancel lands where Apply does — the search screen this sheet filters. */
  const cancel = useGuardedBack('/(modal)/search');
  const locale = useLocale();

  // ── Member guard (defence-in-depth) ──────────────────────────────────────────
  const { data: entitlement, isLoading: entitlementLoading } = useEntitlement();

  // ── Pre-fill from route params (written by the search screen) ─────────────────
  const params = useLocalSearchParams<{ auraMin?: string; city?: string; star?: string }>();

  // ── Local draft state ─────────────────────────────────────────────────────────
  const [auraBucket, setAuraBucket] = useState<AuraBucket>(() => bucketFromAuraMin(params.auraMin));
  const [city, setCity] = useState(params.city ?? '');
  const [star, setStar] = useState<StarValue | undefined>(() => parseStar(params.star));

  // ── Guard: while loading render nothing (avoid false "lapsed" flash) ──────────
  if (entitlementLoading) {
    return <Screen />;
  }

  // ── Guard: if entitlement lapsed mid-session, redirect to Circle upsell ───────
  if (!entitlement?.features.advancedFilters) {
    // Use replace so back-press doesn't loop back here
    router.replace('/(modal)/circle' as Parameters<typeof router.replace>[0]);
    return null;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleApply = () => {
    const params = serializeFilters({ auraMin: auraMinFromBucket(auraBucket), city, star });

    // dismissTo pops this sheet and returns to the already-stacked /search screen
    // with updated params, triggering an automatic re-query on that screen.
    // expo-router v6 Href object: { pathname, params } — both passed in one call.
    router.dismissTo({ pathname: '/(modal)/search', params });
  };

  const handleReset = () => {
    setAuraBucket('any');
    setCity('');
    setStar(undefined);
  };

  return (
    <Screen {...MODAL_A11Y}>
      {/* ── Header ── */}
      <ModalHeader
        title={t('search.filterSheet.title', locale)}
        backLabel={t('common.back', locale)}
        right={
          <Pressable
            onPress={cancel}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel', locale)}
            hitSlop={8}
          >
            <Text className="text-[22px] text-muted-foreground">×</Text>
          </Pressable>
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pb-16"
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Sub ── */}
        <Text className="text-[14px] leading-relaxed text-muted-foreground">
          {t('search.filterSheet.sub', locale)}
        </Text>

        {/* ── Aura minima ── */}
        <View className="gap-3">
          <SectionLabel tone="foreground">{t('search.filter.section.aura', locale)}</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {AURA_BUCKETS.map((bucket) => (
              <Chip
                key={bucket}
                label={t(`search.filter.aura.${bucket}`, locale)}
                selected={auraBucket === bucket}
                onPress={() => setAuraBucket(bucket)}
              />
            ))}
          </View>
        </View>

        {/* ── Città ── */}
        <View className="gap-3">
          <SectionLabel tone="foreground">{t('search.filter.section.city', locale)}</SectionLabel>
          <Input
            placeholder={t('search.filter.city.placeholder', locale)}
            value={city}
            onChangeText={setCity}
            autoCorrect={false}
            autoCapitalize="words"
            returnKeyType="done"
          />
        </View>

        {/* ── Stella ── */}
        <View className="gap-3">
          <SectionLabel tone="foreground">{t('search.filter.section.star', locale)}</SectionLabel>
          <View className="flex-row flex-wrap gap-2">
            {STAR_VALUES.map((s) => (
              <Chip
                key={s}
                label={t(`star.${s}`, locale)}
                selected={star === s}
                onPress={() => setStar((prev) => (prev === s ? undefined : s))}
              />
            ))}
          </View>
        </View>

        {/* ── Disponibilità (disabled — backend param not yet implemented) ── */}
        <View className="gap-3 opacity-40">
          <View className="flex-row items-center gap-2">
            <SectionLabel tone="foreground">
              {t('search.filter.section.availability', locale)}
            </SectionLabel>
            <Text className="text-[11px] text-muted-foreground">
              ({t('circle.benefit.soon', locale)})
            </Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {(['now', 'week', 'project'] as const).map((slot) => (
              <View
                key={slot}
                className="rounded-full border border-hair bg-raise-2 px-5 py-3"
                // Not a Pressable — intentionally non-interactive until backend ships
                accessibilityElementsHidden
              >
                <Text className="text-foreground">
                  {t(`search.filter.availability.${slot}`, locale)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Footer ── */}
        <View className="gap-3 pt-2">
          <Button label={t('common.apply', locale)} variant="light" onPress={handleApply} />
          <Button label={t('common.reset', locale)} variant="ghost" onPress={handleReset} />
        </View>
      </ScrollView>
    </Screen>
  );
}
