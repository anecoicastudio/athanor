import { useLocalSearchParams } from 'expo-router';
import { localeTag, t, type MessageKey } from '@athanor/i18n';
import { starKeySchema } from '@athanor/schemas';
import { ScrollView, Text, View } from '@/tw';
import { ModalHeader } from '@/components/ModalHeader';
import { ProgressBar } from '@/components/ProgressBar';
import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/hooks/use-locale';
import { useStars } from '@/hooks/use-stars';
import { MODAL_A11Y } from '@/lib/a11y';
import { starsOrNull } from '@/lib/aura-display';
import { starCellState, starGlyph } from '@/lib/star';
import { Screen } from '@/components/Screen';

/**
 * Star detail sheet (M6 §3.2).
 * Reads own `stars` rows from TanStack cache; shows glyph + name + state chip
 * + criteria line. Unearned → progress bar + {done}/{total} {unit}.
 * Earned → «Accesa il {date}» formatted like ledger short-date.
 * Rule #1: read-only, no Aura writes.
 */
export default function StarScreen() {
  const { session } = useAuth();
  const locale = useLocale();
  const me = session?.user.id ?? '';

  const { starId: rawStarId } = useLocalSearchParams<{ starId: string }>();

  // Validate the param — if invalid, nothing meaningful to show.
  const parseResult = starKeySchema.safeParse(rawStarId);
  const starId = parseResult.success ? parseResult.data : null;

  const query = useStars(me);

  // `null` = the read failed. This screen has its own query, so it can fail on its own terms
  // even when the grid that linked here rendered fine — and `?? []` made every star look
  // «spenta», i.e. earned-and-lost-nothing, on a network blip (issue #16). Unknown swaps the
  // glyph and the state word and drops the progress bar; the criteria line stays, because it is
  // static copy about how the star is earned, true whether or not we could read this member's.
  //
  // State via `starCellState` rather than a local `stars == null`, so this screen cannot drift
  // from the grid that links to it — the whole reason that helper exists.
  const stars = starsOrNull(query.data, query.isError);
  const state = starId != null ? starCellState(stars, starId) : 'unknown';
  const unknown = state === 'unknown';
  const row = starId != null ? (stars?.find((s) => s.starId === starId) ?? null) : null;
  const earned = state === 'lit';
  const starName = starId != null ? t(`star.${starId}` as MessageKey, locale) : '';

  const criteriaKey = starId != null ? (`star.criteria.${starId}` as MessageKey) : null;

  // Format grantedAt like the ledger short-date: day + month short, locale-aware.
  const earnedDateStr =
    earned && row?.grantedAt
      ? new Date(row.grantedAt).toLocaleDateString(localeTag(locale), {
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
    <Screen {...MODAL_A11Y}>
      {/* Header — chevron-only (star name is the in-body header below) */}
      <ModalHeader title="" backLabel={t('common.back', locale)} />

      <ScrollView contentContainerClassName="px-5 pb-12">
        {starId != null ? (
          <View className="gap-5">
            {/* Glyph + name + state chip */}
            <View
              className="items-center gap-3 py-6"
              accessible={true}
              accessibilityLabel={t(
                unknown ? 'star.a11y.unknown' : earned ? 'star.a11y.lit' : 'star.a11y.unlit',
                locale,
                { star: starName },
              )}
            >
              {/* One glyph, three states, from lib/star.ts. DESIGN §11 (2026-08-08 (c)) named
                  this `text-5xl` pair as the site that had already drifted once. */}
              <Text className="text-5xl">
                <Text
                  className={`text-5xl ${earned ? 'text-aura' : 'text-faint'}`}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {starGlyph(state)}
                </Text>
              </Text>
              <Text
                accessibilityRole="header"
                className="text-[20px] font-semibold text-foreground"
              >
                {starName}
              </Text>
              {/* `earned` is already false when unknown (no rows → no row → no grantedAt), so
                  the accent branch needs no extra guard — only the WORD changes. */}
              <View className={`rounded-full px-3 py-1 ${earned ? 'bg-aura-soft' : 'bg-raise'}`}>
                <Text className={`text-[12px] font-medium ${earned ? 'text-aura' : 'text-faint'}`}>
                  {t(unknown ? 'star.unknown' : earned ? 'star.lit' : 'star.unlit', locale)}
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
    </Screen>
  );
}
