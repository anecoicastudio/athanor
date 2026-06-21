import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { getStars, starKeys } from '@athanor/api';
import { t, type MessageKey } from '@athanor/i18n';
import { starKeySchema, type Locale } from '@athanor/schemas';
import { Pressable, Text, View } from '@/tw';
import { ProgressBar } from '@/components/ProgressBar';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { MODAL_A11Y } from '@/lib/a11y';

/**
 * Star detail sheet (M6 §3.2).
 * Reads own `stars` rows from TanStack cache; shows glyph + name + state chip
 * + criteria line. Unearned → progress bar + {done}/{total} {unit}.
 * Earned → «Accesa il {date}» formatted like ledger short-date.
 * Rule #1: read-only, no Aura writes.
 */
export default function StarScreen() {
  const router = useRouter();
  const { session, profile } = useAuth();
  const locale: Locale = profile?.locale ?? 'it';
  const me = session?.user.id ?? '';

  const { starId: rawStarId } = useLocalSearchParams<{ starId: string }>();

  // Validate the param — if invalid, nothing meaningful to show.
  const parseResult = starKeySchema.safeParse(rawStarId);
  const starId = parseResult.success ? parseResult.data : null;

  const query = useQuery({
    queryKey: starKeys.list(me),
    queryFn: () => getStars(supabase, me),
    enabled: !!me,
  });

  const stars = query.data ?? [];
  const row = starId != null ? stars.find((s) => s.starId === starId) : null;
  const earned = row?.grantedAt != null;
  const starName = starId != null ? t(`star.${starId}` as MessageKey, locale) : '';

  const criteriaKey = starId != null ? (`star.criteria.${starId}` as MessageKey) : null;

  // Format grantedAt like live.tsx / relative-time.ts: day + month short, locale-aware.
  const earnedDateStr =
    earned && row?.grantedAt
      ? new Date(row.grantedAt).toLocaleDateString(locale === 'it' ? 'it-IT' : 'en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      : null;

  const unit =
    row?.progress.unit != null ? t(`star.unit.${row.progress.unit}` as MessageKey, locale) : '';
  const done = row?.progress.done ?? 0;
  const total = row?.progress.total ?? 0;
  const progressWidth = total > 0 ? done / total : 0;

  return (
    <View {...MODAL_A11Y} className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center gap-4 px-5 pb-3 pt-14">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back', locale)}
          hitSlop={8}
          onPress={() => router.back()}
        >
          <Text className="text-2xl text-faint">‹</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 48 }}>
        {starId != null ? (
          <View className="gap-5">
            {/* Glyph + name + state chip */}
            <View
              className="items-center gap-3 py-6"
              accessible={true}
              accessibilityLabel={t(earned ? 'star.a11y.lit' : 'star.a11y.unlit', locale, {
                star: starName,
              })}
            >
              <Text className="text-5xl">
                {earned ? (
                  <Text
                    className="text-5xl text-aura"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    ✦
                  </Text>
                ) : (
                  <Text
                    className="text-5xl text-faint"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    ✧
                  </Text>
                )}
              </Text>
              <Text
                accessibilityRole="header"
                className="text-[20px] font-semibold text-foreground"
              >
                {starName}
              </Text>
              <View className={`rounded-full px-3 py-1 ${earned ? 'bg-aura-soft' : 'bg-raise'}`}>
                <Text className={`text-[12px] font-medium ${earned ? 'text-aura' : 'text-faint'}`}>
                  {t(earned ? 'star.lit' : 'star.unlit', locale)}
                </Text>
              </View>
            </View>

            {/* Criteria */}
            {criteriaKey != null ? (
              <Text className="text-[14px] leading-relaxed text-foreground">
                {t(criteriaKey, locale)}
              </Text>
            ) : null}

            {/* Earned: date */}
            {earned && earnedDateStr != null ? (
              <Text className="text-[13px] text-muted-foreground">
                {t('star.earnedOn', locale, { date: earnedDateStr })}
              </Text>
            ) : null}

            {/* Unearned: progress bar */}
            {!earned && row != null ? (
              <View className="gap-2">
                <Text className="text-[13px] text-faint">
                  {t('star.next.progress', locale, { done, total, unit })}
                </Text>
                <ProgressBar width={progressWidth} />
              </View>
            ) : null}
          </View>
        ) : (
          <View className="items-center py-12">
            <Text className="text-faint">{t('common.back', locale)}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
