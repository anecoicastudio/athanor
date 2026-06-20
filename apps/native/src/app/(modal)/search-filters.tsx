import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { semantic } from '@athanor/config';
import { t } from '@athanor/i18n';
import type { SearchFilters } from '@athanor/schemas';
import { Pressable, ScrollView, Text, TextInput, View } from '@/tw';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { useAuth } from '@/lib/auth-context';
import { useEntitlement } from '@/lib/useEntitlement';
import { MODAL_A11Y } from '@/lib/a11y';

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

type AuraBucket = 'any' | '500' | '700' | '850';
type StarValue = NonNullable<SearchFilters['star']>;

const AURA_BUCKETS: AuraBucket[] = ['any', '500', '700', '850'];
const STAR_VALUES: StarValue[] = [
  'visionario',
  'creatore',
  'mentor',
  'innovatore',
  'collaboratore',
  'ambasciatore',
];

function auraMinFromBucket(bucket: AuraBucket): number | undefined {
  if (bucket === 'any') return undefined;
  return Number(bucket);
}

function bucketFromAuraMin(auraMin?: string): AuraBucket {
  if (!auraMin) return 'any';
  if (auraMin === '500') return '500';
  if (auraMin === '700') return '700';
  if (auraMin === '850') return '850';
  return 'any';
}

export default function SearchFiltersScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const locale = profile?.locale ?? 'it';

  // ── Member guard (defence-in-depth) ──────────────────────────────────────────
  const { data: entitlement, isLoading: entitlementLoading } = useEntitlement();

  // ── Pre-fill from route params (written by the search screen) ─────────────────
  const params = useLocalSearchParams<{ auraMin?: string; city?: string; star?: string }>();

  // ── Local draft state ─────────────────────────────────────────────────────────
  const [auraBucket, setAuraBucket] = useState<AuraBucket>(() => bucketFromAuraMin(params.auraMin));
  const [city, setCity] = useState(params.city ?? '');
  const [star, setStar] = useState<StarValue | undefined>(() => {
    const raw = params.star;
    return raw !== undefined && (STAR_VALUES as string[]).includes(raw)
      ? (raw as StarValue)
      : undefined;
  });

  // ── Guard: while loading render nothing (avoid false "lapsed" flash) ──────────
  if (entitlementLoading) {
    return <View className="flex-1 bg-background" />;
  }

  // ── Guard: if entitlement lapsed mid-session, redirect to Circle upsell ───────
  if (!entitlement?.features.advancedFilters) {
    // Use replace so back-press doesn't loop back here
    router.replace('/(modal)/circle' as Parameters<typeof router.replace>[0]);
    return null;
  }

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleApply = () => {
    const auraMin = auraMinFromBucket(auraBucket);
    const filledCity = city.trim();
    const params: Record<string, string> = {};
    if (auraMin !== undefined) params.auraMin = String(auraMin);
    if (filledCity) params.city = filledCity;
    if (star) params.star = star;

    // dismissTo pops this sheet and returns to the already-stacked /search screen
    // with updated params, triggering an automatic re-query on that screen.
    // expo-router v6 Href object: { pathname, params } — both passed in one call.
    // Double-cast: typed routes don't include '/(modal)/search' until pnpm gen:types
    // reruns (new route added). The runtime route is correct; the cast silences tsc.
    router.dismissTo({
      pathname: '/(modal)/search',
      params,
    } as unknown as Parameters<typeof router.dismissTo>[0]);
  };

  const handleReset = () => {
    setAuraBucket('any');
    setCity('');
    setStar(undefined);
  };

  return (
    <ScrollView
      {...MODAL_A11Y}
      className="flex-1 bg-background"
      contentContainerClassName="gap-6 px-5 pb-16 pt-12"
      keyboardShouldPersistTaps="handled"
    >
      {/* ── Header ── */}
      <View className="flex-row items-center gap-4">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
        >
          <Text className="text-2xl text-foreground">‹</Text>
        </Pressable>
        <Text accessibilityRole="header" className="flex-1 text-xl font-semibold text-foreground">
          {t('search.filterSheet.title', locale)}
        </Text>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel', locale)}
          hitSlop={8}
        >
          <Text className="text-[22px] text-muted-foreground">×</Text>
        </Pressable>
      </View>

      {/* ── Sub ── */}
      <Text className="text-[14px] leading-relaxed text-muted-foreground">
        {t('search.filterSheet.sub', locale)}
      </Text>

      {/* ── Aura minima ── */}
      <View className="gap-3">
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
          {t('search.filter.section.aura', locale)}
        </Text>
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
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
          {t('search.filter.section.city', locale)}
        </Text>
        <TextInput
          className="rounded-hero border border-hair bg-raise px-5 py-3.5 text-[15px] text-foreground"
          placeholder={t('search.filter.city.placeholder', locale)}
          placeholderTextColor={semantic.foregroundMuted}
          value={city}
          onChangeText={setCity}
          autoCorrect={false}
          autoCapitalize="words"
          returnKeyType="done"
        />
      </View>

      {/* ── Stella ── */}
      <View className="gap-3">
        <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
          {t('search.filter.section.star', locale)}
        </Text>
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
          <Text className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
            {t('search.filter.section.availability', locale)}
          </Text>
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
  );
}
